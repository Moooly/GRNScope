from __future__ import annotations

import csv
from itertools import chain
import os
from math import isfinite
from pathlib import Path
from typing import Any


MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024
CSV_SNIFF_SAMPLE_BYTES = 65536
MISSING_TOKENS = {"", "NA", "N/A", "NaN", "nan", "null", "NULL"}
DEFAULT_UPLOAD_NAME_PREVIEW_LIMIT = 1000


def get_non_negative_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return max(0, int(raw_value))
    except ValueError:
        return default


UPLOAD_NAME_PREVIEW_LIMIT = get_non_negative_int_env(
    "GRNSCOPE_UPLOAD_NAME_PREVIEW_LIMIT",
    DEFAULT_UPLOAD_NAME_PREVIEW_LIMIT,
)


def validate_csv_extension(filename: str) -> str | None:
    if not filename.lower().endswith(".csv"):
        return "File must be a CSV file."
    return None


def validate_expression_extension(filename: str) -> str | None:
    normalized_filename = filename.lower()
    if not normalized_filename.endswith((".csv", ".h5ad")):
        return "File must be a CSV or AnnData (.h5ad) file."
    return None


def detect_csv_dialect_from_file(csv_path: Path) -> csv.Dialect | type[csv.Dialect]:
    try:
        with csv_path.open("r", encoding="utf-8", newline="") as csv_file:
            sample = csv_file.read(CSV_SNIFF_SAMPLE_BYTES)
    except Exception as exc:
        raise ValueError(f"CSV file could not be opened: {exc}") from exc

    if not sample.strip():
        raise ValueError("CSV file is empty.")

    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t;")
    except csv.Error:
        first_line = sample.splitlines()[0] if sample.splitlines() else ""
        if "\t" in first_line:
            return csv.excel_tab
        if ";" in first_line:
            class SemicolonDialect(csv.excel):
                delimiter = ";"
            return SemicolonDialect
        return csv.excel


def iter_non_empty_csv_rows(
    csv_path: Path,
    dialect: csv.Dialect | type[csv.Dialect],
):
    with csv_path.open("r", encoding="utf-8", newline="") as csv_file:
        reader = csv.reader(csv_file, dialect=dialect)
        for row in reader:
            if not row or all(str(value).strip() == "" for value in row):
                continue
            yield row


def read_expression_gene_names(csv_path: Path) -> set[str]:
    """Read the complete expression-matrix gene index for artifact matching."""

    dialect = detect_csv_dialect_from_file(csv_path)
    rows = iter_non_empty_csv_rows(csv_path, dialect)
    next(rows, None)
    return {
        str(row[0]).strip()
        for row in rows
        if row and str(row[0]).strip()
    }


def _parse_gene_ordering_number(
    value: object,
    *,
    row_number: int,
    field_name: str,
) -> float:
    text = str(value).strip()
    try:
        parsed = float(text)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"GeneOrdering CSV row {row_number} has a non-numeric {field_name}."
        ) from exc
    if not isfinite(parsed):
        raise ValueError(
            f"GeneOrdering CSV row {row_number} has a non-finite {field_name}."
        )
    return parsed


def _gene_ordering_first_row_is_header(row: list[str]) -> bool:
    if len(row) < 2:
        return False

    first = str(row[0]).strip().lower()
    second = str(row[1]).strip().lower().replace("-", "_").replace(" ", "_")
    return (
        first in {"", "gene", "genes", "gene_name", "gene_id"}
        and second
        in {
            "p",
            "pval",
            "p_val",
            "pvalue",
            "p_value",
            "pvalues",
            "p_values",
            "vgampvalue",
            "vgam_p_value",
        }
    )


def validate_gene_ordering_csv(
    csv_path: Path,
    expression_gene_names: set[str],
) -> dict[str, Any]:
    """Validate BEELINE GeneOrdering.csv data and its expression-gene overlap.

    BEELINE treats the first column as the gene index, the first data column as
    p-value, and an optional second data column as variance. Ordering rows that
    are absent from the expression matrix are allowed and reported because
    BEELINE drops them before filtering.
    """

    dialect = detect_csv_dialect_from_file(csv_path)
    rows = iter_non_empty_csv_rows(csv_path, dialect)
    try:
        first_row = next(rows)
    except StopIteration as exc:
        raise ValueError("GeneOrdering CSV is empty.") from exc

    if len(first_row) < 2:
        raise ValueError(
            "GeneOrdering CSV must contain a gene column and a p-value column."
        )

    has_header = _gene_ordering_first_row_is_header(first_row)
    data_rows = enumerate(rows, start=2)
    if not has_header:
        data_rows = chain([(1, first_row)], data_rows)

    seen_genes: set[str] = set()
    matching_genes: set[str] = set()
    unmatched_genes: list[str] = []
    has_variance = False

    try:
        for row_number, row in data_rows:
            if len(row) < 2:
                raise ValueError(
                    f"GeneOrdering CSV row {row_number} has fewer than 2 columns."
                )

            gene_name = str(row[0]).strip()
            if not gene_name:
                raise ValueError("GeneOrdering CSV contains a blank gene name.")
            if gene_name in seen_genes:
                raise ValueError(
                    f"GeneOrdering CSV contains duplicate gene name: {gene_name}."
                )

            p_value = _parse_gene_ordering_number(
                row[1],
                row_number=row_number,
                field_name="p-value",
            )
            if p_value < 0 or p_value > 1:
                raise ValueError(
                    f"GeneOrdering CSV row {row_number} has a p-value outside 0–1."
                )

            if len(row) >= 3 and str(row[2]).strip() not in MISSING_TOKENS:
                variance = _parse_gene_ordering_number(
                    row[2],
                    row_number=row_number,
                    field_name="variance",
                )
                if variance < 0:
                    raise ValueError(
                        f"GeneOrdering CSV row {row_number} has a negative variance."
                    )
                has_variance = True

            seen_genes.add(gene_name)
            if gene_name in expression_gene_names:
                matching_genes.add(gene_name)
            elif len(unmatched_genes) < UPLOAD_NAME_PREVIEW_LIMIT:
                unmatched_genes.append(gene_name)
    except csv.Error as exc:
        raise ValueError(f"GeneOrdering CSV could not be parsed: {exc}") from exc

    if not seen_genes:
        raise ValueError("GeneOrdering CSV must contain at least one gene row.")
    if not matching_genes:
        raise ValueError(
            "GeneOrdering CSV has no genes in common with the expression matrix."
        )

    unmatched_count = len(seen_genes) - len(matching_genes)
    return {
        "status": "validated",
        "gene_count": len(seen_genes),
        "matching_gene_count": len(matching_genes),
        "unmatched_gene_count": unmatched_count,
        "unmatched_gene_names": unmatched_genes,
        "has_variance": has_variance,
    }
