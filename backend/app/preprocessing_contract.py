from __future__ import annotations

import json
import math


PREPROCESSING_SCHEMA_VERSION = 1
PREPROCESSING_STAGE_ORDER = ("detection", "trajectory", "variance")
MATRIX_STATE_OPTIONS = {"raw", "normalized", "log_normalized"}
DATASET_SPECIES_OPTIONS = {
    "human",
    "mouse",
    "rat",
    "pig",
    "chicken",
    "zebrafish",
    "xenopus_tropicalis",
    "drosophila",
    "c_elegans",
    "s_cerevisiae",
    "other",
}


def parse_strict_bool(raw: str, field_name: str) -> bool:
    normalized = str(raw).strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    raise ValueError(f"{field_name} must be true or false.")


def parse_bounded_float(
    raw: str,
    field_name: str,
    *,
    minimum_exclusive: float,
    maximum_inclusive: float,
) -> float:
    try:
        value = float(str(raw).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be a number.") from exc
    if (
        not math.isfinite(value)
        or value <= minimum_exclusive
        or value > maximum_inclusive
    ):
        raise ValueError(
            f"{field_name} must be greater than {minimum_exclusive:g} "
            f"and at most {maximum_inclusive:g}."
        )
    return value


def parse_positive_int(raw: str, field_name: str) -> int:
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be a positive integer.") from exc
    if value <= 0:
        raise ValueError(f"{field_name} must be a positive integer.")
    return value


def parse_enabled_preprocessing_stages(raw: str) -> list[str]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("Enabled preprocessing stages must be a JSON list.") from exc
    if not isinstance(parsed, list) or any(not isinstance(item, str) for item in parsed):
        raise ValueError("Enabled preprocessing stages must be a list of stage names.")

    normalized = [item.strip().lower() for item in parsed]
    unknown = sorted(set(normalized) - set(PREPROCESSING_STAGE_ORDER))
    if unknown:
        raise ValueError(f"Unsupported preprocessing stage(s): {', '.join(unknown)}.")
    if len(normalized) != len(set(normalized)):
        raise ValueError("Enabled preprocessing stages cannot contain duplicates.")
    return [stage for stage in PREPROCESSING_STAGE_ORDER if stage in normalized]


def build_preprocessing_config(
    *,
    matrix_state: str,
    dataset_species: str,
    enabled_gene_selection_stages: str,
    detection_threshold_percent: str,
    variance_gene_count: str,
    include_known_tfs: str,
    gene_ordering_source: str,
    gene_ordering_filename: str,
    trajectory_p_value: str,
    trajectory_bonferroni: str,
    include_significant_tfs: str,
) -> dict:
    normalized_matrix_state = str(matrix_state).strip().lower()
    if normalized_matrix_state not in MATRIX_STATE_OPTIONS:
        raise ValueError(f"Unsupported matrix state: {normalized_matrix_state or 'empty'}.")

    normalized_species = str(dataset_species).strip().lower()
    if normalized_species not in DATASET_SPECIES_OPTIONS:
        raise ValueError(f"Unsupported dataset species: {normalized_species or 'empty'}.")

    enabled_stages = parse_enabled_preprocessing_stages(
        enabled_gene_selection_stages
    )
    detection_threshold = parse_bounded_float(
        detection_threshold_percent,
        "Detection threshold",
        minimum_exclusive=0,
        maximum_inclusive=100,
    )
    parsed_variance_gene_count = parse_positive_int(
        variance_gene_count, "Variable-gene count"
    )
    retain_known_tfs = parse_strict_bool(include_known_tfs, "Include known TFs")

    normalized_ordering_source = str(gene_ordering_source).strip().lower()
    if normalized_ordering_source not in {"calculate", "upload"}:
        raise ValueError(
            f"Unsupported gene ordering source: {normalized_ordering_source or 'empty'}."
        )
    normalized_ordering_filename = str(gene_ordering_filename).strip() or None
    if (
        "trajectory" in enabled_stages
        and normalized_ordering_source == "upload"
        and not normalized_ordering_filename
    ):
        raise ValueError(
            "A GeneOrdering CSV filename is required when upload is selected."
        )

    trajectory_threshold = parse_bounded_float(
        trajectory_p_value,
        "Trajectory p-value threshold",
        minimum_exclusive=0,
        maximum_inclusive=1,
    )
    bonferroni_correction = parse_strict_bool(
        trajectory_bonferroni, "Trajectory Bonferroni correction"
    )
    retain_significant_tfs = parse_strict_bool(
        include_significant_tfs, "Retain significant TFs"
    )

    return {
        "schema_version": PREPROCESSING_SCHEMA_VERSION,
        "matrix_state": normalized_matrix_state,
        "dataset_species": normalized_species,
        "enabled_stages": enabled_stages,
        "detection": {
            "enabled": "detection" in enabled_stages,
            "minimum_cell_percent": detection_threshold,
        },
        "trajectory": {
            "enabled": "trajectory" in enabled_stages,
            "gene_ordering_source": normalized_ordering_source,
            "gene_ordering_filename": normalized_ordering_filename,
            "p_value_threshold": trajectory_threshold,
            "bonferroni_correction": bonferroni_correction,
            "retain_significant_tfs": retain_significant_tfs,
        },
        "variance": {
            "enabled": "variance" in enabled_stages,
            "gene_count": parsed_variance_gene_count,
            "include_known_tfs": retain_known_tfs,
        },
    }
