from __future__ import annotations

import csv
import math
from pathlib import Path
from statistics import fmean, pstdev

from .validators import detect_csv_dialect_from_file, iter_non_empty_csv_rows


MATRIX_STATE_DETECTION_VERSION = 1
MAX_SAMPLED_CELLS = 96
INTEGER_TOLERANCE = 1e-6


def _inverse_log2(value: float) -> float:
    return math.pow(2, value) - 1


def _inverse_log10(value: float) -> float:
    return math.pow(10, value) - 1


INVERSE_LOG_TRANSFORMS = {
    "natural": (50, math.expm1),
    "2": (100, _inverse_log2),
    "10": (20, _inverse_log10),
}


def _coefficient_of_variation(values: list[float]) -> float | None:
    positive_values = [value for value in values if value > 0 and math.isfinite(value)]
    if len(positive_values) < 2:
        return None
    mean_value = fmean(positive_values)
    if mean_value <= 0:
        return None
    return pstdev(positive_values) / mean_value


def _sample_column_indexes(cell_count: int) -> list[int]:
    if cell_count <= MAX_SAMPLED_CELLS:
        return list(range(cell_count))
    if MAX_SAMPLED_CELLS == 1:
        return [0]
    return sorted(
        {
            round(index * (cell_count - 1) / (MAX_SAMPLED_CELLS - 1))
            for index in range(MAX_SAMPLED_CELLS)
        }
    )


def _rounded_metric(value: float | None) -> float | None:
    return round(value, 6) if value is not None and math.isfinite(value) else None


def classify_matrix_state(
    *,
    sampled_value_count: int,
    integer_like_count: int,
    negative_count: int,
    maximum_value: float,
    linear_column_sums: list[float],
    inverse_log_candidates: dict[str, list[float]],
) -> dict:
    if sampled_value_count <= 0:
        return {
            "detected_state": None,
            "confidence": "low",
            "reasons": ["Not enough numeric values were available to classify the matrix."],
        }

    integer_fraction = integer_like_count / sampled_value_count
    linear_sum_cv = _coefficient_of_variation(linear_column_sums)
    inverse_log_cvs = {
        base: _coefficient_of_variation(column_sums)
        for base, column_sums in inverse_log_candidates.items()
    }
    viable_inverse_log_cvs = {
        base: cv
        for base, cv in inverse_log_cvs.items()
        if cv is not None
    }
    best_inverse_log_base = (
        min(viable_inverse_log_cvs, key=viable_inverse_log_cvs.get)
        if viable_inverse_log_cvs
        else None
    )
    inverse_log_sum_cv = (
        viable_inverse_log_cvs[best_inverse_log_base]
        if best_inverse_log_base is not None
        else None
    )

    metrics = {
        "sampled_values": sampled_value_count,
        "integer_fraction": _rounded_metric(integer_fraction),
        "negative_values": negative_count,
        "maximum_value": _rounded_metric(maximum_value),
        "linear_sum_cv": _rounded_metric(linear_sum_cv),
        "inverse_log_sum_cv": _rounded_metric(inverse_log_sum_cv),
        "inverse_log_base": best_inverse_log_base,
    }

    if negative_count:
        return {
            "detected_state": None,
            "confidence": "low",
            "reasons": [
                "Negative values suggest scaled or centered data.",
                "Raw, normalized, and log-normalized matrices are expected to be non-negative.",
            ],
            "metrics": metrics,
        }

    linear_sums_are_constant = linear_sum_cv is not None and linear_sum_cv <= 0.03
    inverse_sums_are_constant = (
        inverse_log_sum_cv is not None and inverse_log_sum_cv <= 0.03
    )
    inverse_is_clearly_better = (
        inverse_log_sum_cv is not None
        and linear_sum_cv is not None
        and inverse_log_sum_cv <= max(0.01, linear_sum_cv * 0.45)
    )

    if integer_fraction >= 0.999:
        if linear_sums_are_constant:
            return {
                "detected_state": "normalized",
                "confidence": "medium",
                "reasons": [
                    "Values are integer-like, but cell totals are nearly constant.",
                    "This pattern is more consistent with rounded normalized values than raw counts.",
                ],
                "metrics": metrics,
            }
        return {
            "detected_state": "raw",
            "confidence": "high",
            "reasons": [
                "Nearly all sampled values are non-negative integers.",
                "Cell totals vary, which is typical of unnormalized count data.",
            ],
            "metrics": metrics,
        }

    if inverse_sums_are_constant and inverse_is_clearly_better:
        return {
            "detected_state": "log_normalized",
            "confidence": "high",
            "reasons": [
                "Values are non-integer and compressed.",
                (
                    "Reversing the likely log transform produces nearly "
                    "constant cell totals."
                ),
            ],
            "metrics": metrics,
        }

    if linear_sums_are_constant:
        return {
            "detected_state": "normalized",
            "confidence": "high",
            "reasons": [
                "Values are non-integer and cell totals are nearly constant.",
                "This is typical of library-size normalized expression.",
            ],
            "metrics": metrics,
        }

    if maximum_value <= 30:
        return {
            "detected_state": "log_normalized",
            "confidence": "medium",
            "reasons": [
                "Values are non-integer with a compressed non-negative range.",
                "The original normalization method cannot be proven from values alone.",
            ],
            "metrics": metrics,
        }

    return {
        "detected_state": "normalized",
        "confidence": "medium",
        "reasons": [
            "Values are non-integer and remain on an uncompressed scale.",
            "The original normalization method cannot be proven from values alone.",
        ],
        "metrics": metrics,
    }


def detect_matrix_state(source_expression: Path) -> dict:
    dialect = detect_csv_dialect_from_file(source_expression)
    rows = iter_non_empty_csv_rows(source_expression, dialect)
    try:
        header = next(rows)
    except StopIteration:
        return {
            "version": MATRIX_STATE_DETECTION_VERSION,
            "detected_state": None,
            "confidence": "low",
            "reasons": ["The expression matrix is empty."],
        }

    cell_count = max(0, len(header) - 1)
    sampled_indexes = _sample_column_indexes(cell_count)
    linear_sums = [0.0] * len(sampled_indexes)
    inverse_sums = {
        "natural": [0.0] * len(sampled_indexes),
        "2": [0.0] * len(sampled_indexes),
        "10": [0.0] * len(sampled_indexes),
    }
    inverse_sums_available = {base: True for base in inverse_sums}
    sampled_value_count = 0
    integer_like_count = 0
    negative_count = 0
    maximum_value = 0.0

    try:
        for row in rows:
            for sample_position, cell_index in enumerate(sampled_indexes):
                value_index = cell_index + 1
                if value_index >= len(row):
                    continue
                try:
                    value = float(str(row[value_index]).strip())
                except (TypeError, ValueError):
                    continue
                if not math.isfinite(value):
                    continue

                sampled_value_count += 1
                if value < 0:
                    negative_count += 1
                if abs(value - round(value)) <= INTEGER_TOLERANCE:
                    integer_like_count += 1
                maximum_value = max(maximum_value, value)
                linear_sums[sample_position] += value

                for base, (
                    maximum,
                    inverse_function,
                ) in INVERSE_LOG_TRANSFORMS.items():
                    if inverse_sums_available[base] and 0 <= value <= maximum:
                        inverse_sums[base][sample_position] += inverse_function(value)
                    else:
                        inverse_sums_available[base] = False
    except csv.Error as exc:
        return {
            "version": MATRIX_STATE_DETECTION_VERSION,
            "detected_state": None,
            "confidence": "low",
            "reasons": [f"The expression matrix could not be sampled: {exc}"],
        }

    result = classify_matrix_state(
        sampled_value_count=sampled_value_count,
        integer_like_count=integer_like_count,
        negative_count=negative_count,
        maximum_value=maximum_value,
        linear_column_sums=linear_sums,
        inverse_log_candidates={
            base: column_sums
            for base, column_sums in inverse_sums.items()
            if inverse_sums_available[base]
        },
    )
    return {
        "version": MATRIX_STATE_DETECTION_VERSION,
        "sampled_cells": len(sampled_indexes),
        **result,
    }
