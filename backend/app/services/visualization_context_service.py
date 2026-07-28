from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.interpolate import make_smoothing_spline
from sklearn.manifold import TSNE

from .gene_ordering_service import (
    GeneOrderingGenerationError,
    _read_pseudotime_frame,
)
from .matrix_transformation_service import (
    MatrixTransformationError,
    read_expression_frame,
)


MAX_TRAJECTORY_GENES = 8
MAX_TRAJECTORY_EXPRESSION_POINTS = 2_000
TRAJECTORY_SPLINE_POINT_COUNT = 100
MAX_TRAJECTORY_EMBEDDING_CELLS = 700
MAX_TRAJECTORY_EMBEDDING_GENES = 500
TRAJECTORY_PATH_BIN_COUNT = 24
TRAJECTORY_EMBEDDING_CACHE_LIMIT = 8

_trajectory_embedding_cache: dict[tuple, dict | None] = {}


def _existing_path(
    project_dir: Path,
    manifest: dict,
    *,
    path_keys: tuple[str, ...],
    filename_keys: tuple[str, ...],
    fallback_patterns: tuple[str, ...],
) -> Path | None:
    for key in path_keys:
        raw_path = manifest.get(key)
        if raw_path:
            candidate = Path(str(raw_path))
            if candidate.exists():
                return candidate
            local_candidate = project_dir / candidate.name
            if local_candidate.exists():
                return local_candidate

    for key in filename_keys:
        filename = manifest.get(key)
        if not filename:
            continue
        for parent in (project_dir, project_dir / "inputs"):
            candidate = parent / str(filename)
            if candidate.exists():
                return candidate

    for pattern in fallback_patterns:
        matches = sorted(project_dir.glob(pattern))
        if matches:
            return matches[0]
        input_matches = sorted((project_dir / "inputs").glob(pattern))
        if input_matches:
            return input_matches[0]
    return None


def _expression_path(project_dir: Path, manifest: dict) -> Path | None:
    return _existing_path(
        project_dir,
        manifest,
        path_keys=("expression_path",),
        filename_keys=("expression_filename",),
        fallback_patterns=("expression__*.csv", "*Expression*.csv"),
    )


def _analysis_expression_path(
    project_dir: Path,
    manifest: dict,
) -> tuple[Path | None, bool]:
    preprocessed_path = _existing_path(
        project_dir,
        manifest,
        path_keys=("preprocessed_expression_path",),
        filename_keys=(),
        fallback_patterns=(),
    )
    if preprocessed_path:
        return preprocessed_path, True
    return _expression_path(project_dir, manifest), False


def _pseudotime_path(project_dir: Path, manifest: dict) -> Path | None:
    return _existing_path(
        project_dir,
        manifest,
        path_keys=("pseudotime_path",),
        filename_keys=("pseudotime_filename",),
        fallback_patterns=("pseudotime__*.csv", "*PseudoTime*.csv", "*pseudotime*.csv"),
    )


def _ground_truth_path(project_dir: Path, manifest: dict) -> Path | None:
    explicit = _existing_path(
        project_dir,
        manifest,
        path_keys=("ground_truth_path", "gold_standard_path", "reference_network_path"),
        filename_keys=(
            "ground_truth_filename",
            "gold_standard_filename",
            "reference_network_filename",
        ),
        fallback_patterns=(),
    )
    if explicit:
        return explicit

    for parent in (project_dir, project_dir / "inputs"):
        if not parent.exists():
            continue
        for candidate in sorted(parent.iterdir()):
            if not candidate.is_file():
                continue
            normalized_name = candidate.name.lower().replace("-", "_")
            if any(
                marker in normalized_name
                for marker in ("ground_truth", "gold_standard", "goldstandard", "reference_network")
            ):
                return candidate
    return None


def _fit_expression_spline(
    pseudotime: np.ndarray,
    expression: np.ndarray,
) -> list[dict]:
    """Fit a descriptive cubic smoothing spline to cell-level expression."""
    finite = np.isfinite(pseudotime) & np.isfinite(expression)
    x_values = np.asarray(pseudotime[finite], dtype=float)
    y_values = np.asarray(expression[finite], dtype=float)
    if not len(x_values):
        return []

    order = np.argsort(x_values, kind="stable")
    x_values = x_values[order]
    y_values = y_values[order]
    unique_x, inverse, counts = np.unique(
        x_values,
        return_inverse=True,
        return_counts=True,
    )
    y_sums = np.bincount(inverse, weights=y_values)
    unique_y = y_sums / counts

    if len(unique_x) == 1:
        return [
            {
                "pseudotime": float(unique_x[0]),
                "expression": float(unique_y[0]),
            }
        ]

    grid = np.linspace(
        float(unique_x[0]),
        float(unique_x[-1]),
        TRAJECTORY_SPLINE_POINT_COUNT,
    )
    if len(unique_x) >= 5 and float(np.ptp(unique_y)) > 0:
        try:
            spline = make_smoothing_spline(
                unique_x,
                unique_y,
                w=counts.astype(float),
            )
            fitted = np.asarray(spline(grid), dtype=float)
        except (ValueError, np.linalg.LinAlgError):
            fitted = np.interp(grid, unique_x, unique_y)
    else:
        fitted = np.interp(grid, unique_x, unique_y)

    observed_min = float(np.min(y_values))
    observed_max = float(np.max(y_values))
    fitted = np.clip(fitted, observed_min, observed_max)
    return [
        {
            "pseudotime": float(x_value),
            "expression": float(y_value),
        }
        for x_value, y_value in zip(grid, fitted, strict=True)
    ]


def _expression_label(manifest: dict, *, preprocessed: bool) -> str:
    if preprocessed:
        return "Log-normalized expression"
    matrix_state = str(
        (manifest.get("preprocessing") or {}).get("matrix_state") or ""
    ).strip().lower()
    return {
        "raw": "Raw expression",
        "normalized": "Normalized expression",
        "log_normalized": "Log-normalized expression",
    }.get(matrix_state, "Expression")


def _principal_component_embedding(values: np.ndarray) -> np.ndarray:
    centered = values - np.mean(values, axis=0, keepdims=True)
    left_vectors, singular_values, _ = np.linalg.svd(centered, full_matrices=False)
    component_count = min(2, len(singular_values))
    coordinates = left_vectors[:, :component_count] * singular_values[:component_count]
    if component_count < 2:
        coordinates = np.pad(
            coordinates,
            ((0, 0), (0, 2 - component_count)),
            mode="constant",
        )
    return coordinates


def _sample_embedding_cell_indices(pseudotime: pd.DataFrame) -> np.ndarray:
    values = pseudotime.to_numpy(dtype=float)
    valid_indices = np.flatnonzero(np.isfinite(values).any(axis=1))
    if len(valid_indices) <= MAX_TRAJECTORY_EMBEDDING_CELLS:
        return valid_indices

    selected: set[int] = set()
    lineage_count = max(1, pseudotime.shape[1])
    lineage_quota = max(2, MAX_TRAJECTORY_EMBEDDING_CELLS // lineage_count)
    for column_index in range(pseudotime.shape[1]):
        lineage_values = values[:, column_index]
        lineage_indices = np.flatnonzero(np.isfinite(lineage_values))
        if not len(lineage_indices):
            continue
        ordered = lineage_indices[np.argsort(lineage_values[lineage_indices])]
        positions = np.linspace(
            0,
            len(ordered) - 1,
            min(lineage_quota, len(ordered)),
            dtype=int,
        )
        selected.update(int(ordered[position]) for position in positions)

    generator = np.random.default_rng(42)
    remaining = np.asarray(
        [index for index in valid_indices if int(index) not in selected],
        dtype=int,
    )
    if len(selected) < MAX_TRAJECTORY_EMBEDDING_CELLS and len(remaining):
        fill_count = min(
            MAX_TRAJECTORY_EMBEDDING_CELLS - len(selected),
            len(remaining),
        )
        selected.update(
            int(index)
            for index in generator.choice(remaining, size=fill_count, replace=False)
        )

    selected_indices = np.asarray(sorted(selected), dtype=int)
    if len(selected_indices) > MAX_TRAJECTORY_EMBEDDING_CELLS:
        selected_indices = np.sort(
            generator.choice(
                selected_indices,
                size=MAX_TRAJECTORY_EMBEDDING_CELLS,
                replace=False,
            )
        )
    return selected_indices


def _smooth_path(coordinates: np.ndarray) -> np.ndarray:
    if len(coordinates) < 3:
        return coordinates
    smoothed = coordinates.copy()
    smoothed[1:-1] = (
        coordinates[:-2] + (2 * coordinates[1:-1]) + coordinates[2:]
    ) / 4
    return smoothed


def _trim_terminal_hook(coordinates: np.ndarray) -> np.ndarray:
    """Remove a short endpoint reversal caused by sparse terminal bins."""
    if len(coordinates) < 8:
        return coordinates

    segment_lengths = np.linalg.norm(np.diff(coordinates, axis=0), axis=1)
    typical_length = float(np.median(segment_lengths))
    if typical_length <= 1e-9:
        return coordinates

    first_candidate = max(4, len(coordinates) - 6)
    for index in range(first_candidate, len(coordinates) - 2):
        reference = coordinates[index] - coordinates[max(0, index - 4)]
        current = coordinates[index + 1] - coordinates[index]
        following = coordinates[index + 2] - coordinates[index + 1]
        reference_length = float(np.linalg.norm(reference))
        current_length = float(np.linalg.norm(current))
        following_length = float(np.linalg.norm(following))
        if min(reference_length, current_length, following_length) <= 1e-9:
            continue
        current_alignment = float(np.dot(reference, current)) / (
            reference_length * current_length
        )
        following_alignment = float(np.dot(reference, following)) / (
            reference_length * following_length
        )
        if (
            current_alignment < -0.15
            and following_alignment < 0
            and current_length >= typical_length * 0.25
            and following_length >= typical_length * 0.25
        ):
            return coordinates[: index + 1]
    return coordinates


def _build_trajectory_embedding(
    expression: pd.DataFrame,
    pseudotime: pd.DataFrame,
) -> dict | None:
    cell_indices = _sample_embedding_cell_indices(pseudotime)
    if len(cell_indices) < 3:
        return None

    variances = expression.var(axis=1).sort_values(ascending=False)
    embedding_genes = list(variances.head(MAX_TRAJECTORY_EMBEDDING_GENES).index)
    matrix = expression.loc[embedding_genes].iloc[:, cell_indices].T.to_numpy(dtype=float)
    if not matrix.size:
        return None

    finite = np.isfinite(matrix)
    column_means = np.divide(
        np.where(finite, matrix, 0).sum(axis=0),
        np.maximum(finite.sum(axis=0), 1),
    )
    matrix = np.where(finite, matrix, column_means)
    column_standard_deviations = np.std(matrix, axis=0)
    informative = column_standard_deviations > 1e-9
    matrix = matrix[:, informative]
    if not matrix.shape[1]:
        return None
    matrix = (matrix - np.mean(matrix, axis=0)) / np.std(matrix, axis=0)
    matrix = np.clip(matrix, -8, 8)

    method = "PCA"
    coordinates = _principal_component_embedding(matrix)
    if len(cell_indices) >= 25:
        perplexity = min(30.0, max(2.0, (len(cell_indices) - 1) / 3))
        try:
            coordinates = TSNE(
                n_components=2,
                perplexity=perplexity,
                init="pca",
                learning_rate="auto",
                random_state=42,
            ).fit_transform(matrix)
            method = "t-SNE"
        except (ValueError, FloatingPointError):
            pass

    pseudotime_values = pseudotime.to_numpy(dtype=float)
    lineage_names = [str(value) for value in pseudotime.columns]
    points = []
    for coordinate, cell_index in zip(coordinates, cell_indices, strict=True):
        points.append(
            {
                "cell": str(expression.columns[cell_index]),
                "x": float(coordinate[0]),
                "y": float(coordinate[1]),
                "pseudotime": {
                    lineage_name: (
                        float(pseudotime_values[cell_index, lineage_index])
                        if np.isfinite(pseudotime_values[cell_index, lineage_index])
                        else None
                    )
                    for lineage_index, lineage_name in enumerate(lineage_names)
                },
            }
        )

    paths = []
    for lineage_index, lineage_name in enumerate(lineage_names):
        sampled_values = pseudotime_values[cell_indices, lineage_index]
        valid = np.isfinite(sampled_values)
        valid_count = int(valid.sum())
        if valid_count < 3:
            continue
        ranks = pd.Series(sampled_values[valid]).rank(method="first")
        bin_count = min(TRAJECTORY_PATH_BIN_COUNT, valid_count)
        bin_ids = pd.qcut(ranks, q=bin_count, labels=False, duplicates="drop")
        valid_coordinates = coordinates[valid]
        valid_pseudotime = sampled_values[valid]
        path_points = []
        for bin_id in sorted(int(value) for value in pd.unique(bin_ids)):
            selected = np.asarray(bin_ids == bin_id)
            path_points.append(
                {
                    "x": float(np.mean(valid_coordinates[selected, 0])),
                    "y": float(np.mean(valid_coordinates[selected, 1])),
                    "pseudotime": float(np.mean(valid_pseudotime[selected])),
                    "cell_count": int(selected.sum()),
                }
            )
        smoothed_coordinates = _smooth_path(
            np.asarray(
                [[point["x"], point["y"]] for point in path_points],
                dtype=float,
            )
        )
        smoothed_coordinates = _trim_terminal_hook(smoothed_coordinates)
        path_points = path_points[: len(smoothed_coordinates)]
        for point, smoothed_coordinate in zip(
            path_points,
            smoothed_coordinates,
            strict=True,
        ):
            point["x"] = float(smoothed_coordinate[0])
            point["y"] = float(smoothed_coordinate[1])
        paths.append({"name": lineage_name, "points": path_points})

    return {
        "method": method,
        "path_source": "pseudotime_bin_centroids",
        "sampled_cell_count": int(len(cell_indices)),
        "total_cell_count": int(len(expression.columns)),
        "points": points,
        "paths": paths,
    }


def _cached_trajectory_embedding(
    *,
    expression_path: Path,
    pseudotime_path: Path,
    expression: pd.DataFrame,
    pseudotime: pd.DataFrame,
) -> dict | None:
    expression_stat = expression_path.stat()
    pseudotime_stat = pseudotime_path.stat()
    cache_key = (
        str(expression_path.resolve()),
        expression_stat.st_size,
        expression_stat.st_mtime_ns,
        str(pseudotime_path.resolve()),
        pseudotime_stat.st_size,
        pseudotime_stat.st_mtime_ns,
        MAX_TRAJECTORY_EMBEDDING_CELLS,
        MAX_TRAJECTORY_EMBEDDING_GENES,
    )
    if cache_key in _trajectory_embedding_cache:
        return _trajectory_embedding_cache[cache_key]

    embedding = _build_trajectory_embedding(expression, pseudotime)
    if len(_trajectory_embedding_cache) >= TRAJECTORY_EMBEDDING_CACHE_LIMIT:
        oldest_key = next(iter(_trajectory_embedding_cache))
        _trajectory_embedding_cache.pop(oldest_key, None)
    _trajectory_embedding_cache[cache_key] = embedding
    return embedding


def build_trajectory_context(
    *,
    project_dir: Path,
    manifest: dict,
    requested_genes: list[str],
) -> dict:
    expression_path, uses_preprocessed_expression = _analysis_expression_path(
        project_dir,
        manifest,
    )
    pseudotime_path = _pseudotime_path(project_dir, manifest)
    if not expression_path or not pseudotime_path:
        return {"available": False, "reason": "Pseudotime is not available."}

    try:
        expression = read_expression_frame(expression_path)
        pseudotime = _read_pseudotime_frame(pseudotime_path, expression.columns)
    except (MatrixTransformationError, GeneOrderingGenerationError, OSError) as exc:
        return {"available": False, "reason": str(exc)}

    genes = [
        gene
        for gene in dict.fromkeys(str(value).strip() for value in requested_genes)
        if gene in expression.index
    ][:MAX_TRAJECTORY_GENES]
    if not genes:
        variances = expression.var(axis=1).sort_values(ascending=False)
        genes = [str(value) for value in variances.head(6).index]
    gene_positions = {
        gene: int(expression.index.get_loc(gene))
        for gene in genes
    }

    lineages: list[dict] = []
    for lineage_name in pseudotime.columns:
        lineage_values = pseudotime[lineage_name].to_numpy(dtype=float)
        valid = np.isfinite(lineage_values)
        valid_count = int(valid.sum())
        if valid_count < 3:
            continue

        valid_indices = np.flatnonzero(valid)
        ordered_indices = valid_indices[
            np.argsort(lineage_values[valid_indices], kind="stable")
        ]
        if len(ordered_indices) > MAX_TRAJECTORY_EXPRESSION_POINTS:
            sample_positions = np.linspace(
                0,
                len(ordered_indices) - 1,
                MAX_TRAJECTORY_EXPRESSION_POINTS,
                dtype=int,
            )
            displayed_indices = ordered_indices[np.unique(sample_positions)]
        else:
            displayed_indices = ordered_indices

        expression_points = [
            {
                "cell": str(expression.columns[cell_index]),
                "pseudotime": float(lineage_values[cell_index]),
                "expression": {
                    gene: float(expression.iloc[gene_positions[gene], cell_index])
                    for gene in genes
                },
            }
            for cell_index in displayed_indices
        ]
        trends = {
            gene: _fit_expression_spline(
                lineage_values[valid_indices],
                expression.loc[gene].to_numpy(dtype=float)[valid_indices],
            )
            for gene in genes
        }

        lineages.append(
            {
                "name": str(lineage_name),
                "cell_count": valid_count,
                "displayed_cell_count": int(len(displayed_indices)),
                "expression_points": expression_points,
                "trends": trends,
            }
        )

    if not lineages:
        return {"available": False, "reason": "No usable pseudotime trajectory was found."}

    embedding = _cached_trajectory_embedding(
        expression_path=expression_path,
        pseudotime_path=pseudotime_path,
        expression=expression,
        pseudotime=pseudotime,
    )

    return {
        "available": True,
        "genes": genes,
        "available_genes": [str(value) for value in expression.index],
        "lineages": lineages,
        "embedding": embedding,
        "expression_file": expression_path.name,
        "expression_label": _expression_label(
            manifest,
            preprocessed=uses_preprocessed_expression,
        ),
        "trend_method": "cubic_smoothing_spline_gcv",
        "pseudotime_file": pseudotime_path.name,
    }


def _detect_delimiter(path: Path) -> str:
    sample = path.read_text(encoding="utf-8", errors="replace")[:65_536]
    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t;").delimiter
    except csv.Error:
        return "\t" if "\t" in sample.partition("\n")[0] else ","


def _normalize_edge_header(value: str) -> str:
    return str(value).strip().lower().replace(" ", "_").replace("-", "_")


def read_ground_truth_edges(path: Path) -> list[dict]:
    delimiter = _detect_delimiter(path)
    frame = pd.read_csv(path, sep=delimiter)
    if frame.shape[1] < 2:
        raise ValueError("Ground-truth network must include regulator and target columns.")

    normalized_columns = {
        _normalize_edge_header(column): str(column) for column in frame.columns
    }
    source_column = next(
        (
            normalized_columns[name]
            for name in ("source", "regulator", "gene1", "tf", "from")
            if name in normalized_columns
        ),
        str(frame.columns[0]),
    )
    target_column = next(
        (
            normalized_columns[name]
            for name in ("target", "gene2", "to")
            if name in normalized_columns
        ),
        str(frame.columns[1]),
    )
    sign_column = next(
        (
            normalized_columns[name]
            for name in ("sign", "effect", "interaction", "edge_type", "type")
            if name in normalized_columns
        ),
        None,
    )

    edges: list[dict] = []
    seen: set[str] = set()
    for _, row in frame.iterrows():
        source = str(row[source_column]).strip()
        target = str(row[target_column]).strip()
        if not source or not target or source.lower() == "nan" or target.lower() == "nan":
            continue
        key = f"{source}\u0000{target}"
        if key in seen:
            continue
        seen.add(key)
        payload = {"source": source, "target": target}
        if sign_column is not None and pd.notna(row[sign_column]):
            payload["sign"] = str(row[sign_column]).strip()
        edges.append(payload)
    return edges


def build_ground_truth_context(*, project_dir: Path, manifest: dict) -> dict:
    path = _ground_truth_path(project_dir, manifest)
    if not path:
        return {"available": False}
    try:
        edges = read_ground_truth_edges(path)
    except (OSError, UnicodeError, ValueError, pd.errors.ParserError) as exc:
        return {"available": False, "reason": str(exc)}
    if not edges:
        return {"available": False, "reason": "Ground-truth network is empty."}
    return {
        "available": True,
        "filename": path.name,
        "edge_count": len(edges),
        "edges": edges,
    }


def read_manifest_for_visualization(project_dir: Path) -> dict:
    project_path = project_dir / "project.json"
    if project_path.exists():
        return json.loads(project_path.read_text(encoding="utf-8"))
    manifest_path = project_dir / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        dataset = manifest.get("dataset") if isinstance(manifest.get("dataset"), dict) else {}
        return {
            **manifest,
            "expression_filename": dataset.get("expression_file"),
            "pseudotime_filename": dataset.get("pseudotime_file"),
            "ground_truth_filename": dataset.get("ground_truth_file"),
        }
    raise FileNotFoundError("Project manifest not found.")


def build_visualization_context(
    *,
    project_dir: Path,
    requested_genes: list[str],
) -> dict:
    manifest = read_manifest_for_visualization(project_dir)
    return {
        "trajectory": build_trajectory_context(
            project_dir=project_dir,
            manifest=manifest,
            requested_genes=requested_genes,
        ),
        "ground_truth": build_ground_truth_context(
            project_dir=project_dir,
            manifest=manifest,
        ),
    }
