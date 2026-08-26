from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import numpy as np
from scipy import sparse

from ..matrix_state_detection import (
    INVERSE_LOG_TRANSFORMS,
    MATRIX_STATE_DETECTION_VERSION,
    classify_matrix_state,
)

H5AD_EXTENSION = ".h5ad"
H5AD_SAMPLE_CELL_LIMIT = 96
H5AD_SAMPLE_GENE_LIMIT = 2048
H5AD_EXPORT_GENE_CHUNK_SIZE = 128


def is_h5ad_filename(filename: str) -> bool:
    return Path(filename).suffix.lower() == H5AD_EXTENSION


def _load_h5ad(path: Path):
    try:
        from anndata import read_h5ad

        return read_h5ad(path, backed="r")
    except Exception as exc:
        raise ValueError(f"AnnData file could not be opened: {exc}") from exc


def _close_h5ad(adata: Any) -> None:
    file_manager = getattr(adata, "file", None)
    close = getattr(file_manager, "close", None)
    if callable(close):
        close()


def _sample_indexes(count: int, limit: int) -> list[int]:
    if count <= limit:
        return list(range(count))
    if limit <= 1:
        return [0]
    return sorted(
        {
            round(index * (count - 1) / (limit - 1))
            for index in range(limit)
        }
    )


def _dense_array(matrix: Any) -> np.ndarray:
    to_memory = getattr(matrix, "to_memory", None)
    if callable(to_memory):
        matrix = to_memory()
    if sparse.issparse(matrix):
        matrix = matrix.toarray()
    return np.asarray(matrix, dtype=np.float64)


def _matrix_values(matrix: Any, row_indexes: list[int], column_indexes: list[int]) -> np.ndarray:
    try:
        sampled = matrix[row_indexes, :]
        sampled = sampled[:, column_indexes]
        values = _dense_array(sampled)
    except Exception as exc:
        raise ValueError(f"AnnData expression values could not be read: {exc}") from exc

    if values.ndim != 2:
        raise ValueError("AnnData expression matrix must be two-dimensional.")
    return values


def _detect_matrix_state(matrix: Any, cell_count: int, gene_count: int) -> dict:
    cell_indexes = _sample_indexes(cell_count, H5AD_SAMPLE_CELL_LIMIT)
    gene_indexes = _sample_indexes(gene_count, H5AD_SAMPLE_GENE_LIMIT)
    if not cell_indexes or not gene_indexes:
        return {
            "version": MATRIX_STATE_DETECTION_VERSION,
            "sampled_cells": 0,
            "detected_state": None,
            "confidence": "low",
            "reasons": ["Not enough numeric values were available to classify the matrix."],
        }

    values = _matrix_values(matrix, cell_indexes, gene_indexes)
    finite_values = values[np.isfinite(values)]
    if finite_values.size == 0:
        return {
            "version": MATRIX_STATE_DETECTION_VERSION,
            "sampled_cells": len(cell_indexes),
            "detected_state": None,
            "confidence": "low",
            "reasons": ["The AnnData matrix does not contain finite numeric values."],
        }

    linear_sums = np.sum(values, axis=1)
    inverse_sums: dict[str, list[float]] = {}
    for base, (maximum, _inverse_function) in INVERSE_LOG_TRANSFORMS.items():
        if np.all((values >= 0) & (values <= maximum) & np.isfinite(values)):
            if base == "natural":
                inverse_values = np.expm1(values)
            elif base == "2":
                inverse_values = np.power(2, values) - 1
            else:
                inverse_values = np.power(10, values) - 1
            inverse_sums[base] = np.sum(inverse_values, axis=1).tolist()

    result = classify_matrix_state(
        sampled_value_count=int(finite_values.size),
        integer_like_count=int(
            np.count_nonzero(np.abs(finite_values - np.round(finite_values)) <= 1e-6)
        ),
        negative_count=int(np.count_nonzero(finite_values < 0)),
        maximum_value=float(np.max(finite_values)),
        linear_column_sums=linear_sums.tolist(),
        inverse_log_candidates=inverse_sums,
    )
    return {
        "version": MATRIX_STATE_DETECTION_VERSION,
        "sampled_cells": len(cell_indexes),
        **result,
    }


def _clean_names(names: Any, name_type: str) -> list[str]:
    cleaned = [str(name).strip() for name in names]
    if not cleaned or any(not name for name in cleaned):
        raise ValueError(f"AnnData {name_type} names cannot be blank.")
    if len(set(cleaned)) != len(cleaned):
        raise ValueError(f"AnnData {name_type} names must be unique.")
    return cleaned


def _resolve_matrix(adata: Any, matrix_key: str) -> tuple[Any, list[str], list[str], str]:
    normalized_key = str(matrix_key or "X").strip()
    cell_names = _clean_names(adata.obs_names, "cell")

    if normalized_key == "X":
        matrix = adata.X
        gene_names = _clean_names(adata.var_names, "gene")
        label = "Main matrix (X)"
    elif normalized_key == "raw":
        raw = getattr(adata, "raw", None)
        matrix = getattr(raw, "X", None)
        if matrix is None:
            raise ValueError("This AnnData file does not contain a raw matrix.")
        gene_names = _clean_names(raw.var_names, "gene")
        label = "Raw matrix"
    elif normalized_key.startswith("layer:"):
        layer_name = normalized_key.removeprefix("layer:")
        if layer_name not in adata.layers:
            raise ValueError(f"AnnData layer '{layer_name}' was not found.")
        matrix = adata.layers[layer_name]
        gene_names = _clean_names(adata.var_names, "gene")
        label = f"Layer: {layer_name}"
    else:
        raise ValueError("AnnData matrix selection is invalid.")

    if matrix is None:
        raise ValueError(f"{label} is empty and cannot be analyzed.")
    if len(getattr(matrix, "shape", ())) != 2:
        raise ValueError(f"{label} must be two-dimensional.")
    if matrix.shape != (len(cell_names), len(gene_names)):
        raise ValueError(
            f"{label} has shape {matrix.shape}, but its annotations describe "
            f"{len(cell_names)} cells and {len(gene_names)} genes."
        )
    return matrix, gene_names, cell_names, label


def _matrix_summary(adata: Any, matrix_key: str, *, default: bool = False) -> dict:
    matrix, gene_names, cell_names, label = _resolve_matrix(adata, matrix_key)
    detection = _detect_matrix_state(matrix, len(cell_names), len(gene_names))
    return {
        "key": matrix_key,
        "label": label,
        "gene_count": len(gene_names),
        "cell_count": len(cell_names),
        "gene_names": gene_names[:1000],
        "detection": detection,
        "default": default,
    }


def inspect_h5ad_expression(source_path: Path) -> dict:
    adata = _load_h5ad(source_path)
    try:
        if adata.X is None:
            raise ValueError("AnnData file does not contain a main expression matrix in X.")

        matrix_keys = ["X"]
        if getattr(adata, "raw", None) is not None and getattr(adata.raw, "X", None) is not None:
            matrix_keys.append("raw")
        matrix_keys.extend(f"layer:{name}" for name in adata.layers.keys())
        matrices = [
            _matrix_summary(adata, matrix_key, default=matrix_key == "X")
            for matrix_key in matrix_keys
        ]
        selected = matrices[0]
        return {
            "format": "h5ad",
            "selected_matrix": selected["key"],
            "matrices": matrices,
            "gene_count": selected["gene_count"],
            "cell_count": selected["cell_count"],
            "gene_names": selected["gene_names"],
            "detection": selected["detection"],
        }
    finally:
        _close_h5ad(adata)


def convert_h5ad_to_csv(
    *,
    source_path: Path,
    destination_path: Path,
    matrix_key: str,
) -> dict:
    adata = _load_h5ad(source_path)
    try:
        matrix, gene_names, cell_names, label = _resolve_matrix(adata, matrix_key)
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        with destination_path.open("w", encoding="utf-8", newline="") as output:
            writer = csv.writer(output, lineterminator="\n")
            writer.writerow(["", *cell_names])
            for start in range(0, len(gene_names), H5AD_EXPORT_GENE_CHUNK_SIZE):
                end = min(start + H5AD_EXPORT_GENE_CHUNK_SIZE, len(gene_names))
                values = _dense_array(matrix[:, start:end])
                if values.shape != (len(cell_names), end - start):
                    raise ValueError(f"{label} could not be converted to a rectangular matrix.")
                if not np.isfinite(values).all():
                    raise ValueError(f"{label} contains missing or non-finite values.")
                for offset, gene_name in enumerate(gene_names[start:end]):
                    writer.writerow([gene_name, *values[:, offset].tolist()])

        return {
            "gene_count": len(gene_names),
            "cell_count": len(cell_names),
            "gene_names": gene_names[:1000],
            "selected_matrix": matrix_key,
            "selected_matrix_label": label,
        }
    except Exception:
        destination_path.unlink(missing_ok=True)
        raise
    finally:
        _close_h5ad(adata)
