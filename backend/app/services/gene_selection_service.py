from __future__ import annotations

import csv
import hashlib
import math
from pathlib import Path

import numpy as np
import pandas as pd

from .matrix_transformation_service import (
    MatrixTransformationError,
    read_expression_frame,
)
from .tf_reference_service import (
    match_known_tf_identifiers,
    normalize_tf_identifier,
)


GENE_SELECTION_ENGINE = "grnscope"
GENE_SELECTION_VERSION = 3


class GeneSelectionError(ValueError):
    pass


def detection_filter_signature(preprocessing_config: dict) -> dict:
    detection_config = preprocessing_config.get("detection") or {}
    enabled = bool(detection_config.get("enabled"))
    return {
        "engine": GENE_SELECTION_ENGINE,
        "version": GENE_SELECTION_VERSION,
        "enabled": enabled,
        "minimum_cell_percent": (
            float(detection_config.get("minimum_cell_percent", 10))
            if enabled
            else None
        ),
    }


def trajectory_filter_signature(project_manifest: dict) -> dict:
    preprocessing_config = project_manifest.get("preprocessing") or {}
    trajectory_config = preprocessing_config.get("trajectory") or {}
    enabled = bool(trajectory_config.get("enabled"))
    source = str(
        trajectory_config.get("gene_ordering_source") or "calculate"
    ).strip().lower()
    signature = {
        "engine": GENE_SELECTION_ENGINE,
        "version": GENE_SELECTION_VERSION,
        "enabled": enabled,
        "gene_ordering_source": source if enabled else None,
        "p_value_threshold": (
            float(trajectory_config.get("p_value_threshold", 0.01))
            if enabled
            else None
        ),
        "bonferroni_correction": (
            bool(trajectory_config.get("bonferroni_correction"))
            if enabled
            else None
        ),
        "retain_significant_tfs": (
            bool(trajectory_config.get("retain_significant_tfs"))
            if enabled
            else None
        ),
    }

    ordering_path_value = project_manifest.get("gene_ordering_path")
    pseudotime_path_value = project_manifest.get("pseudotime_path")
    if enabled and source == "upload" and ordering_path_value:
        ordering_path = Path(str(ordering_path_value))
        if ordering_path.exists():
            ordering_stat = ordering_path.stat()
            signature.update(
                {
                    "gene_ordering_path": str(ordering_path.resolve()),
                    "gene_ordering_size": ordering_stat.st_size,
                    "gene_ordering_mtime_ns": ordering_stat.st_mtime_ns,
                }
            )
        else:
            signature["gene_ordering_path"] = str(ordering_path)
    elif enabled and source == "calculate" and pseudotime_path_value:
        pseudotime_path = Path(str(pseudotime_path_value))
        if pseudotime_path.exists():
            pseudotime_stat = pseudotime_path.stat()
            signature.update(
                {
                    "pseudotime_path": str(pseudotime_path.resolve()),
                    "pseudotime_size": pseudotime_stat.st_size,
                    "pseudotime_mtime_ns": pseudotime_stat.st_mtime_ns,
                }
            )
        else:
            signature["pseudotime_path"] = str(pseudotime_path)
        signature["gene_ordering_path"] = None
    else:
        signature["gene_ordering_path"] = None
        signature["pseudotime_path"] = None
    return signature


def variance_filter_signature(project_manifest: dict) -> dict:
    preprocessing_config = project_manifest.get("preprocessing") or {}
    variance_config = preprocessing_config.get("variance") or {}
    trajectory_config = preprocessing_config.get("trajectory") or {}
    enabled = bool(variance_config.get("enabled"))
    configured_include_known_tfs = bool(variance_config.get("include_known_tfs"))
    retain_significant_trajectory_tfs = bool(
        trajectory_config.get("enabled")
        and trajectory_config.get("retain_significant_tfs")
    )
    include_known_tfs = (
        configured_include_known_tfs or retain_significant_trajectory_tfs
    )
    known_tfs = sorted(
        {
            normalize_tf_identifier(gene_name)
            for gene_name in (project_manifest.get("known_tf_gene_names") or [])
            if normalize_tf_identifier(gene_name)
        }
    )
    return {
        "engine": GENE_SELECTION_ENGINE,
        "version": GENE_SELECTION_VERSION,
        "enabled": enabled,
        "gene_count": (
            int(variance_config.get("gene_count", 500)) if enabled else None
        ),
        "include_known_tfs": (
            include_known_tfs if enabled else None
        ),
        "configured_include_known_tfs": (
            configured_include_known_tfs if enabled else None
        ),
        "retain_significant_trajectory_tfs": (
            retain_significant_trajectory_tfs if enabled else None
        ),
        "known_tf_gene_names_sha256": (
            hashlib.sha256("\n".join(known_tfs).encode("utf-8")).hexdigest()
            if enabled and include_known_tfs
            else None
        ),
    }


def minimum_detected_cell_count(cell_count: int, minimum_cell_percent: float) -> int:
    if cell_count <= 0:
        raise GeneSelectionError(
            "Expression matrix must include at least one cell column."
        )
    if (
        not math.isfinite(minimum_cell_percent)
        or minimum_cell_percent <= 0
        or minimum_cell_percent > 100
    ):
        raise GeneSelectionError(
            "Detection threshold must be greater than 0 and at most 100."
        )
    return max(1, math.ceil(cell_count * minimum_cell_percent / 100.0))


def apply_detection_filter(
    *,
    source_expression: Path,
    destination_expression: Path,
    minimum_cell_percent: float,
) -> dict:
    try:
        expression_frame = read_expression_frame(source_expression)
    except MatrixTransformationError as exc:
        raise GeneSelectionError(str(exc)) from exc

    minimum_cells = minimum_detected_cell_count(
        expression_frame.shape[1],
        float(minimum_cell_percent),
    )
    detected_cell_counts = np.count_nonzero(
        expression_frame.to_numpy(dtype=np.float64, copy=False) > 0,
        axis=1,
    )
    retained_mask = detected_cell_counts >= minimum_cells
    retained_frame = expression_frame.loc[retained_mask]

    if retained_frame.empty:
        raise GeneSelectionError(
            "Detection filtering removed every gene. Lower the detection "
            "threshold or check the uploaded matrix."
        )

    destination_expression.parent.mkdir(parents=True, exist_ok=True)
    retained_frame.to_csv(
        destination_expression,
        index=True,
        index_label=expression_frame.index.name or "",
        float_format="%.10g",
        lineterminator="\n",
    )
    return {
        "stage": "detection",
        "minimum_cell_percent": float(minimum_cell_percent),
        "minimum_detected_cell_count": minimum_cells,
        "input_gene_count": int(expression_frame.shape[0]),
        "retained_gene_count": int(retained_frame.shape[0]),
        "removed_gene_count": int(expression_frame.shape[0] - retained_frame.shape[0]),
        "cell_count": int(expression_frame.shape[1]),
        "retained_gene_names": [str(value) for value in retained_frame.index],
        "removed_gene_names": [
            str(value) for value in expression_frame.index[~retained_mask]
        ],
    }


def _detect_delimiter(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as source_file:
        sample = source_file.read(65_536)
    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t;").delimiter
    except csv.Error:
        return "\t" if "\t" in sample.partition("\n")[0] else ","


def read_gene_ordering_frame(gene_ordering_path: Path) -> pd.DataFrame:
    delimiter = _detect_delimiter(gene_ordering_path)
    try:
        frame = pd.read_csv(
            gene_ordering_path,
            sep=delimiter,
            index_col=0,
        )
    except (OSError, UnicodeError, ValueError, pd.errors.ParserError) as exc:
        raise GeneSelectionError(
            f"GeneOrdering CSV could not be loaded: {exc}"
        ) from exc

    # Validation accepts headerless two-column files. Pandas otherwise treats
    # their first gene as a header, so reload them explicitly when the first
    # data-column label is numeric.
    if frame.shape[1] >= 1:
        try:
            float(str(frame.columns[0]).strip())
        except (TypeError, ValueError):
            pass
        else:
            frame = pd.read_csv(
                gene_ordering_path,
                sep=delimiter,
                index_col=0,
                header=None,
            )

    if frame.empty or frame.shape[1] < 1:
        raise GeneSelectionError(
            "GeneOrdering CSV must contain a gene column and a p-value column."
        )

    frame.index = pd.Index(str(value).strip() for value in frame.index)
    try:
        p_values = pd.to_numeric(frame.iloc[:, 0], errors="raise").astype(float)
    except (TypeError, ValueError) as exc:
        raise GeneSelectionError(
            "GeneOrdering CSV contains a non-numeric p-value."
        ) from exc
    if not np.isfinite(p_values.to_numpy()).all():
        raise GeneSelectionError(
            "GeneOrdering CSV contains a non-finite p-value."
        )
    frame = frame.copy()
    frame.iloc[:, 0] = p_values
    return frame


def apply_trajectory_filter(
    *,
    source_expression: Path,
    destination_expression: Path,
    gene_ordering_path: Path,
    p_value_threshold: float,
    bonferroni_correction: bool,
    retain_significant_tfs: bool = False,
    known_tf_gene_names: set[str] | None = None,
) -> dict:
    try:
        expression_frame = read_expression_frame(source_expression)
    except MatrixTransformationError as exc:
        raise GeneSelectionError(str(exc)) from exc
    ordering_frame = read_gene_ordering_frame(gene_ordering_path)

    threshold = float(p_value_threshold)
    if not math.isfinite(threshold) or threshold <= 0 or threshold > 1:
        raise GeneSelectionError(
            "Trajectory p-value threshold must be greater than 0 and at most 1."
        )

    tested_gene_count = int(ordering_frame.shape[0])
    effective_threshold = (
        threshold / tested_gene_count if bonferroni_correction else threshold
    )
    p_values = ordering_frame.iloc[:, 0].astype(float)
    significant_genes = set(ordering_frame.index[p_values <= effective_threshold])
    expression_genes = set(expression_frame.index)
    retained_genes = significant_genes & expression_genes

    if not retained_genes:
        raise GeneSelectionError(
            "Trajectory-aware filtering removed every gene. Increase the "
            "p-value threshold, disable Bonferroni correction, or check the "
            "GeneOrdering CSV."
        )

    # Keep the expression matrix's original order rather than the ordering
    # file's p-value order.
    retained_frame = expression_frame.loc[
        expression_frame.index.isin(retained_genes)
    ]
    destination_expression.parent.mkdir(parents=True, exist_ok=True)
    retained_frame.to_csv(
        destination_expression,
        index=True,
        index_label=expression_frame.index.name or "",
        float_format="%.10g",
        lineterminator="\n",
    )

    retained_significant_tfs = match_known_tf_identifiers(
        retained_genes,
        known_tf_gene_names or set(),
    )
    return {
        "stage": "trajectory",
        "p_value_threshold": threshold,
        "effective_p_value_threshold": effective_threshold,
        "bonferroni_correction": bool(bonferroni_correction),
        "tested_gene_count": tested_gene_count,
        "significant_gene_count": len(significant_genes),
        "input_gene_count": int(expression_frame.shape[0]),
        "retained_gene_count": int(retained_frame.shape[0]),
        "removed_gene_count": int(expression_frame.shape[0] - retained_frame.shape[0]),
        "retained_significant_tf_count": len(retained_significant_tfs),
        "retain_significant_tfs": bool(retain_significant_tfs),
        "cell_count": int(expression_frame.shape[1]),
        "retained_gene_names": [str(value) for value in retained_frame.index],
        "removed_gene_names": [
            str(value)
            for value in expression_frame.index[
                ~expression_frame.index.isin(retained_genes)
            ]
        ],
    }


def apply_variance_filter(
    *,
    source_expression: Path,
    destination_expression: Path,
    gene_count: int,
    include_known_tfs: bool,
    known_tf_gene_names: set[str] | None = None,
) -> dict:
    try:
        expression_frame = read_expression_frame(source_expression)
    except MatrixTransformationError as exc:
        raise GeneSelectionError(str(exc)) from exc

    try:
        requested_gene_count = int(gene_count)
    except (TypeError, ValueError) as exc:
        raise GeneSelectionError(
            "Variable-gene count must be a positive integer."
        ) from exc
    if requested_gene_count <= 0:
        raise GeneSelectionError(
            "Variable-gene count must be a positive integer."
        )

    input_gene_count = int(expression_frame.shape[0])
    available_known_tfs = match_known_tf_identifiers(
        expression_frame.index,
        known_tf_gene_names or set(),
    )
    retained_limit = min(requested_gene_count, input_gene_count)
    all_values = expression_frame.to_numpy(dtype=np.float64, copy=False)
    all_variances = np.var(all_values, axis=1)
    ranked_positions = np.argsort(-all_variances, kind="stable")
    globally_ranked_genes = [
        str(expression_frame.index[position]) for position in ranked_positions
    ]

    if include_known_tfs:
        # The displayed gene count is a hard total cap. Known TFs are
        # prioritized within that budget instead of being appended afterward.
        ranked_known_tfs = [
            gene for gene in globally_ranked_genes if gene in available_known_tfs
        ]
        prioritized_tfs = ranked_known_tfs[:retained_limit]
        remaining_slots = retained_limit - len(prioritized_tfs)
        ranked_non_tfs = [
            gene for gene in globally_ranked_genes if gene not in available_known_tfs
        ]
        retained_genes = set(
            [*prioritized_tfs, *ranked_non_tfs[:remaining_slots]]
        )
    else:
        prioritized_tfs = []
        retained_genes = set(globally_ranked_genes[:retained_limit])

    ranked_gene_count = len(retained_genes)

    retained_frame = expression_frame.loc[
        expression_frame.index.isin(retained_genes)
    ]
    if retained_frame.empty:
        raise GeneSelectionError(
            "Variable-gene selection removed every gene."
        )

    destination_expression.parent.mkdir(parents=True, exist_ok=True)
    retained_frame.to_csv(
        destination_expression,
        index=True,
        index_label=expression_frame.index.name or "",
        float_format="%.10g",
        lineterminator="\n",
    )

    unconstrained_top_genes = set(globally_ranked_genes[:retained_limit])
    forced_tf_genes = set(prioritized_tfs) - unconstrained_top_genes
    return {
        "stage": "variance",
        "requested_gene_count": requested_gene_count,
        "ranked_gene_count": ranked_gene_count,
        "selection_policy": (
            "known_tfs_prioritized_within_total_limit"
            if include_known_tfs
            else "highest_variance_within_total_limit"
        ),
        "hard_total_gene_limit": retained_limit,
        "ranked_non_tf_gene_count": (
            len(retained_genes - available_known_tfs)
            if include_known_tfs
            else None
        ),
        "include_known_tfs": bool(include_known_tfs),
        "available_known_tf_count": len(available_known_tfs),
        "retained_known_tf_count": len(retained_genes & available_known_tfs),
        "known_tfs_excluded_by_total_limit": max(
            0,
            len(available_known_tfs) - len(retained_genes & available_known_tfs),
        ),
        "forced_known_tf_count": (
            len(forced_tf_genes) if include_known_tfs else 0
        ),
        "input_gene_count": input_gene_count,
        "retained_gene_count": int(retained_frame.shape[0]),
        "removed_gene_count": input_gene_count - int(retained_frame.shape[0]),
        "cell_count": int(expression_frame.shape[1]),
        "retained_gene_names": [str(value) for value in retained_frame.index],
        "removed_gene_names": [
            str(value)
            for value in expression_frame.index[
                ~expression_frame.index.isin(retained_genes)
            ]
        ],
    }
