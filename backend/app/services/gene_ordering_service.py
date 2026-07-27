from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import f as f_distribution

from .matrix_transformation_service import (
    MatrixTransformationError,
    read_expression_frame,
)
from .pseudotime_format_service import (
    PseudotimeFormatError,
    read_canonical_pseudotime_frame,
)


GENE_ORDERING_ENGINE = "grnscope-polynomial-trajectory"
GENE_ORDERING_VERSION = 1
MAX_POLYNOMIAL_DEGREE = 3


class GeneOrderingGenerationError(ValueError):
    pass


def _read_pseudotime_frame(
    pseudotime_path: Path,
    expression_cells: pd.Index,
) -> pd.DataFrame:
    try:
        trajectory_frame, _source_format = read_canonical_pseudotime_frame(
            pseudotime_path,
            expression_cells,
            allow_empty_trajectories=True,
        )
    except PseudotimeFormatError as exc:
        raise GeneOrderingGenerationError(str(exc)) from exc
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
