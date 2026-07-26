from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
import pandas as pd

from .gene_ordering_service import (
    GeneOrderingGenerationError,
    _read_pseudotime_frame,
)
from .matrix_transformation_service import (
    MatrixTransformationError,
    read_expression_frame,
)


MAX_TRAJECTORY_GENES = 8
TRAJECTORY_BIN_COUNT = 30
MAX_GROUND_TRUTH_EDGES = 250_000


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


def _scale_series(values: np.ndarray) -> np.ndarray:
    finite = np.isfinite(values)
    if not finite.any():
        return np.zeros_like(values, dtype=float)
    minimum = float(np.nanmin(values[finite]))
    maximum = float(np.nanmax(values[finite]))
    if maximum <= minimum:
        return np.zeros_like(values, dtype=float)
    scaled = (values - minimum) / (maximum - minimum)
    scaled[~finite] = np.nan
    return scaled


def build_trajectory_context(
    *,
    project_dir: Path,
    manifest: dict,
    requested_genes: list[str],
) -> dict:
    expression_path = _expression_path(project_dir, manifest)
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

    lineages: list[dict] = []
    for lineage_name in pseudotime.columns:
        lineage_values = pseudotime[lineage_name].to_numpy(dtype=float)
        valid = np.isfinite(lineage_values)
        valid_count = int(valid.sum())
        if valid_count < 3:
            continue

        ranks = pd.Series(lineage_values[valid]).rank(method="first")
        bin_count = min(TRAJECTORY_BIN_COUNT, valid_count)
        bin_ids = pd.qcut(ranks, q=bin_count, labels=False, duplicates="drop")
        valid_cells = expression.columns[valid]
        lineage_bins: list[dict] = []

        for bin_id in sorted(int(value) for value in pd.unique(bin_ids)):
            selected = np.asarray(bin_ids == bin_id)
            selected_cells = valid_cells[selected]
            pseudotime_values = lineage_values[valid][selected]
            expression_means = expression.loc[genes, selected_cells].mean(axis=1)
            lineage_bins.append(
                {
                    "pseudotime": float(np.mean(pseudotime_values)),
                    "cell_count": int(len(selected_cells)),
                    "raw_expression": {
                        gene: float(expression_means.loc[gene]) for gene in genes
                    },
                }
            )

        for gene in genes:
            raw_values = np.asarray(
                [bin_payload["raw_expression"][gene] for bin_payload in lineage_bins],
                dtype=float,
            )
            scaled_values = _scale_series(raw_values)
            for bin_payload, scaled_value in zip(lineage_bins, scaled_values, strict=True):
                bin_payload.setdefault("scaled_expression", {})[gene] = (
                    None if not np.isfinite(scaled_value) else float(scaled_value)
                )

        lineages.append(
            {
                "name": str(lineage_name),
                "cell_count": valid_count,
                "bins": lineage_bins,
            }
        )

    if not lineages:
        return {"available": False, "reason": "No usable pseudotime trajectory was found."}

    return {
        "available": True,
        "genes": genes,
        "lineages": lineages,
        "expression_file": expression_path.name,
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
            for name in ("sign", "effect", "interaction", "edge_type")
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
        if len(edges) >= MAX_GROUND_TRUTH_EDGES:
            break
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
