from __future__ import annotations

import csv
import math
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import f as f_distribution

from .matrix_transformation_service import (
    MatrixTransformationError,
    read_expression_frame,
)


GENE_ORDERING_ENGINE = "grnscope-polynomial-trajectory"
GENE_ORDERING_VERSION = 1
MAX_POLYNOMIAL_DEGREE = 3


class GeneOrderingGenerationError(ValueError):
    pass


def _detect_delimiter(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as source_file:
        sample = source_file.read(65_536)
    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t;").delimiter
    except csv.Error:
        return "\t" if "\t" in sample.partition("\n")[0] else ","


def _read_pseudotime_frame(
    pseudotime_path: Path,
    expression_cells: pd.Index,
) -> pd.DataFrame:
    delimiter = _detect_delimiter(pseudotime_path)
    try:
        raw = pd.read_csv(
            pseudotime_path,
            sep=delimiter,
            header=None,
            dtype=str,
            keep_default_na=False,
        )
    except (OSError, UnicodeError, ValueError, pd.errors.ParserError) as exc:
        raise GeneOrderingGenerationError(
            f"Pseudotime CSV could not be loaded: {exc}"
        ) from exc

    if raw.empty:
        raise GeneOrderingGenerationError("Pseudotime CSV is empty.")

    expected_cells = pd.Index(str(value).strip() for value in expression_cells)

    if raw.shape[1] == 1:
        values = pd.to_numeric(raw.iloc[:, 0], errors="coerce")
        if values.isna().iloc[0] and values.iloc[1:].notna().all():
            values = values.iloc[1:]
        if len(values) != len(expected_cells) or values.isna().any():
            raise GeneOrderingGenerationError(
                "Single-column pseudotime must contain one numeric value for "
                "every expression-matrix cell."
            )
        return pd.DataFrame(
            {"PseudoTime1": values.to_numpy(dtype=float)},
            index=expected_cells,
        )

    # BEELINE/Slingshot format: the first column contains cell identifiers and
    # the remaining columns contain one or more lineage-specific trajectories.
    first_data_values = pd.to_numeric(raw.iloc[0, 1:], errors="coerce")
    has_header = bool(first_data_values.isna().all())
    if has_header:
        column_names = [
            str(value).strip() or f"PseudoTime{index}"
            for index, value in enumerate(raw.iloc[0, 1:], start=1)
        ]
        raw = raw.iloc[1:].reset_index(drop=True)
    else:
        column_names = [
            f"PseudoTime{index}" for index in range(1, raw.shape[1])
        ]

    cell_ids = pd.Index(str(value).strip() for value in raw.iloc[:, 0])
    if cell_ids.has_duplicates:
        raise GeneOrderingGenerationError(
            "Pseudotime CSV contains duplicate cell identifiers."
        )
    if set(cell_ids) != set(expected_cells):
        raise GeneOrderingGenerationError(
            "Pseudotime cell identifiers must match the expression-matrix cells."
        )

    trajectory_frame = raw.iloc[:, 1:].copy()
    trajectory_frame.columns = column_names
    trajectory_frame.index = cell_ids
    trajectory_frame = trajectory_frame.apply(pd.to_numeric, errors="coerce")
    trajectory_frame = trajectory_frame.reindex(expected_cells)
    if not any(trajectory_frame[column].notna().sum() >= 3 for column in trajectory_frame):
        raise GeneOrderingGenerationError(
            "Pseudotime CSV does not contain enough numeric values to calculate "
            "gene ordering."
        )
    return trajectory_frame


def _trajectory_p_values(
    expression_values: np.ndarray,
    pseudotime_values: np.ndarray,
) -> np.ndarray | None:
    valid = np.isfinite(pseudotime_values)
    sample_count = int(np.count_nonzero(valid))
    if sample_count < 3:
        return None

    pseudotime = pseudotime_values[valid].astype(np.float64, copy=False)
    unique_count = int(np.unique(pseudotime).size)
    degree = min(MAX_POLYNOMIAL_DEGREE, unique_count - 1, sample_count - 2)
    if degree < 1:
        return None

    centered = pseudotime - float(np.mean(pseudotime))
    scale = float(np.std(centered))
    if not math.isfinite(scale) or scale <= 0:
        return None
    scaled = centered / scale
    design = np.column_stack(
        [np.ones(sample_count)]
        + [np.power(scaled, power) for power in range(1, degree + 1)]
    )
    rank = int(np.linalg.matrix_rank(design))
    model_degrees_of_freedom = rank - 1
    residual_degrees_of_freedom = sample_count - rank
    if model_degrees_of_freedom <= 0 or residual_degrees_of_freedom <= 0:
        return None

    responses = expression_values[:, valid].T
    coefficients, *_ = np.linalg.lstsq(design, responses, rcond=None)
    residuals = responses - design @ coefficients
    full_sse = np.sum(np.square(residuals), axis=0)
    null_sse = np.sum(
        np.square(responses - np.mean(responses, axis=0, keepdims=True)),
        axis=0,
    )
    explained_sse = np.maximum(0.0, null_sse - full_sse)

    p_values = np.ones(responses.shape[1], dtype=np.float64)
    usable = (null_sse > 0) & (full_sse > np.finfo(np.float64).eps)
    f_statistics = np.zeros(responses.shape[1], dtype=np.float64)
    f_statistics[usable] = (
        explained_sse[usable] / model_degrees_of_freedom
    ) / (full_sse[usable] / residual_degrees_of_freedom)
    p_values[usable] = f_distribution.sf(
        f_statistics[usable],
        model_degrees_of_freedom,
        residual_degrees_of_freedom,
    )
    perfect_fit = (null_sse > 0) & ~usable
    p_values[perfect_fit] = 0.0
    return np.clip(p_values, 0.0, 1.0)


def generate_gene_ordering_csv(
    *,
    source_expression: Path,
    pseudotime_path: Path,
    destination_path: Path,
) -> dict:
    try:
        expression_frame = read_expression_frame(source_expression)
    except MatrixTransformationError as exc:
        raise GeneOrderingGenerationError(str(exc)) from exc

    pseudotime_frame = _read_pseudotime_frame(
        pseudotime_path,
        expression_frame.columns,
    )
    expression_values = expression_frame.to_numpy(dtype=np.float64, copy=False)
    lineage_p_values: list[np.ndarray] = []
    used_lineages: list[str] = []
    for lineage_name in pseudotime_frame.columns:
        p_values = _trajectory_p_values(
            expression_values,
            pseudotime_frame[lineage_name].to_numpy(dtype=np.float64),
        )
        if p_values is None:
            continue
        lineage_p_values.append(p_values)
        used_lineages.append(str(lineage_name))

    if not lineage_p_values:
        raise GeneOrderingGenerationError(
            "Pseudotime does not contain a usable trajectory for gene-ordering "
            "calculation."
        )

    # A gene may be associated with any lineage. Correct the best lineage
    # p-value for the number of lineages examined for that gene.
    stacked_p_values = np.vstack(lineage_p_values)
    combined_p_values = np.minimum(
        1.0,
        np.min(stacked_p_values, axis=0) * len(lineage_p_values),
    )
    variances = np.var(expression_values, axis=1)
    ordering_frame = pd.DataFrame(
        {
            "VGAMpValue": combined_p_values,
            "Variance": variances,
        },
        index=expression_frame.index,
    )
    ordering_frame.index.name = expression_frame.index.name or "Gene"
    ordering_frame = ordering_frame.sort_values(
        ["VGAMpValue", "Variance"],
        ascending=[True, False],
        kind="stable",
    )
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    ordering_frame.to_csv(
        destination_path,
        float_format="%.10g",
        lineterminator="\n",
    )
    return {
        "engine": GENE_ORDERING_ENGINE,
        "version": GENE_ORDERING_VERSION,
        "method": "polynomial_f_test",
        "polynomial_degree": MAX_POLYNOMIAL_DEGREE,
        "lineage_count": len(used_lineages),
        "lineages": used_lineages,
        "gene_count": int(ordering_frame.shape[0]),
        "cell_count": int(expression_frame.shape[1]),
        "path": str(destination_path),
    }
