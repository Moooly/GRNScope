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
CELL_ID_HEADER_NAMES = {
    "cell",
    "cell_id",
    "cellid",
    "cell id",
    "cells",
    "sample",
    "sample_id",
    "sampleid",
    "sample id",
}
CLUSTER_LABEL_HEADER_NAMES = {
    "cluster",
    "cluster_id",
    "clusterid",
    "cluster id",
    "cell_type",
    "celltype",
    "cell type",
    "label",
    "group",
}
DEFAULT_EXPRESSION_FULL_NUMERIC_CHECK_ROWS = 5
DEFAULT_EXPRESSION_EDGE_NUMERIC_CHECK_COLUMNS = 4
DEFAULT_EXPRESSION_FAST_SAMPLE_ROWS = 20
DEFAULT_UPLOAD_NAME_PREVIEW_LIMIT = 1000
STRICT_UPLOAD_VALIDATION_MODE = "strict"


def get_non_negative_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return max(0, int(raw_value))
    except ValueError:
        return default


EXPRESSION_FULL_NUMERIC_CHECK_ROWS = get_non_negative_int_env(
    "GRNSCOPE_UPLOAD_FULL_NUMERIC_CHECK_ROWS",
    DEFAULT_EXPRESSION_FULL_NUMERIC_CHECK_ROWS,
)
EXPRESSION_EDGE_NUMERIC_CHECK_COLUMNS = get_non_negative_int_env(
    "GRNSCOPE_UPLOAD_EDGE_NUMERIC_CHECK_COLUMNS",
    DEFAULT_EXPRESSION_EDGE_NUMERIC_CHECK_COLUMNS,
)
EXPRESSION_FAST_SAMPLE_ROWS = get_non_negative_int_env(
    "GRNSCOPE_UPLOAD_FAST_SAMPLE_ROWS",
    DEFAULT_EXPRESSION_FAST_SAMPLE_ROWS,
)
UPLOAD_NAME_PREVIEW_LIMIT = get_non_negative_int_env(
    "GRNSCOPE_UPLOAD_NAME_PREVIEW_LIMIT",
    DEFAULT_UPLOAD_NAME_PREVIEW_LIMIT,
)


def upload_validation_mode() -> str:
    return os.getenv(
        "GRNSCOPE_UPLOAD_VALIDATION_MODE", STRICT_UPLOAD_VALIDATION_MODE
    ).strip().lower()


def validate_csv_extension(filename: str) -> str | None:
    if not filename.lower().endswith(".csv"):
        return "File must be a CSV file."
    return None


def validate_file_size(size_bytes: int) -> str | None:
    if size_bytes > MAX_FILE_SIZE_BYTES:
        return "File size must be 500 MB or smaller."
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


def count_non_empty_text_lines(csv_path: Path) -> int:
    line_count = 0
    with csv_path.open("r", encoding="utf-8", newline="") as csv_file:
        for line in csv_file:
            if line.strip():
                line_count += 1
    return line_count


def preview_items(items: list[str]) -> list[str]:
    if UPLOAD_NAME_PREVIEW_LIMIT <= 0:
        return []
    return items[:UPLOAD_NAME_PREVIEW_LIMIT]


def parse_required_finite_float(value: object, error_message: str) -> None:
    text = str(value).strip()
    if text in MISSING_TOKENS:
        raise ValueError(error_message)
    try:
        parsed = float(text)
    except (TypeError, ValueError) as exc:
        raise ValueError(error_message) from exc
    if not isfinite(parsed):
        raise ValueError(error_message)


def parse_optional_finite_float(value: object) -> bool:
    text = str(value).strip()
    if text in MISSING_TOKENS:
        return False
    try:
        parsed = float(text)
    except (TypeError, ValueError) as exc:
        raise ValueError("Pseudotime file contains non-numeric values outside blank/NA cells.") from exc
    if not isfinite(parsed):
        raise ValueError("Pseudotime file contains non-numeric values outside blank/NA cells.")
    return True


def is_cell_id_header(value: str) -> bool:
    return value.strip().lower() in CELL_ID_HEADER_NAMES


def uniquify_pseudotime_headers(headers: list[str]) -> list[str]:
    unique_headers: list[str] = []
    seen_headers: set[str] = set()

    for index, raw_header in enumerate(headers, start=1):
        base_header = raw_header.strip() or f"PseudoTime{index}"
        header = base_header
        suffix = 2
        while header in seen_headers:
            header = f"{base_header}_{suffix}"
            suffix += 1
        seen_headers.add(header)
        unique_headers.append(header)

    return unique_headers


def resolve_pseudotime_table_layout(
    raw_headers: list[str],
    first_data_row: list[str] | None,
) -> tuple[list[str], int]:
    """Return trajectory headers and expected row width.

    Some exported pseudotime files omit the cell-ID header while keeping cell IDs
    in the first data column, producing headers like:
    PseudoTime1,PseudoTime2
    E37_5_927,114.7,NA

    Others include a trailing empty header:
    PseudoTime1,PseudoTime2,

    Treat those as shifted headers: the first data column is still cell IDs, and
    the shown headers belong to trajectory columns.
    """

    if len(raw_headers) < 2:
        raise ValueError(
            "Pseudotime file must contain either one pseudotime column or a first column of cell IDs followed by one or more pseudotime columns."
        )

    first_header = raw_headers[0].strip()
    first_data_width = len(first_data_row) if first_data_row is not None else len(raw_headers)
    has_explicit_cell_header = first_header == "" or is_cell_id_header(first_header)
    has_shifted_headers = (
        not has_explicit_cell_header
        and (
            first_data_width == len(raw_headers) + 1
            or (raw_headers[-1].strip() == "" and first_data_width == len(raw_headers))
        )
    )

    if has_shifted_headers:
        if raw_headers[-1].strip() == "" and first_data_width == len(raw_headers):
            return uniquify_pseudotime_headers(raw_headers[:-1]), len(raw_headers)
        return uniquify_pseudotime_headers(raw_headers), len(raw_headers) + 1

    return uniquify_pseudotime_headers(raw_headers[1:]), len(raw_headers)


def expression_numeric_values_to_check(row: list[str], data_row_index: int) -> list[str]:
    values = row[1:]
    if data_row_index <= EXPRESSION_FULL_NUMERIC_CHECK_ROWS:
        return values

    edge_count = EXPRESSION_EDGE_NUMERIC_CHECK_COLUMNS
    if edge_count <= 0:
        return []
    if len(values) <= edge_count * 2:
        return values
    return [*values[:edge_count], *values[-edge_count:]]


def validate_expression_header(header: list[str]) -> tuple[list[str], int]:
    if len(header) < 2:
        raise ValueError(
            "Expression matrix must contain a first column of gene names and at least one cell column."
        )

    raw_headers = [str(column).strip() for column in header]
    cell_names = raw_headers[1:]
    if not cell_names:
        raise ValueError("Expression matrix must include at least one cell identifier.")

    if any(name == "" for name in cell_names):
        raise ValueError("Header row contains blank cell identifiers.")

    if len(set(cell_names)) != len(cell_names):
        raise ValueError("Cell identifiers must be unique.")

    return cell_names, len(header)


def parse_expression_matrix_strict(csv_path: Path) -> dict[str, Any]:
    dialect = detect_csv_dialect_from_file(csv_path)
    rows = iter_non_empty_csv_rows(csv_path, dialect)

    try:
        header = next(rows)
    except StopIteration as exc:
        raise ValueError("Expression matrix is empty.")

    cell_names, expected_column_count = validate_expression_header(header)
    gene_names: list[str] = []
    seen_gene_names: set[str] = set()

    try:
        for row_number, row in enumerate(rows, start=2):
            if len(row) != expected_column_count:
                raise ValueError(
                    f"Expression matrix row {row_number} has {len(row)} columns; expected {expected_column_count}."
                )

            gene_name = str(row[0]).strip()
            if gene_name == "":
                raise ValueError("First column contains blank gene names.")
            if gene_name in seen_gene_names:
                raise ValueError("Gene names must be unique.")

            for value in row[1:]:
                parse_required_finite_float(
                    value,
                    "Expression matrix contains missing or non-numeric interior values.",
                )

            seen_gene_names.add(gene_name)
            gene_names.append(gene_name)
    except csv.Error as exc:
        raise ValueError(f"Expression matrix could not be parsed as CSV: {exc}") from exc

    if not gene_names:
        raise ValueError("Expression matrix must include gene names in the first column.")

    return {
        "gene_count": len(gene_names),
        "cell_count": len(cell_names),
        "gene_names": preview_items(gene_names),
        "cell_names": preview_items(cell_names),
    }


def parse_expression_matrix_fast(csv_path: Path) -> dict[str, Any]:
    dialect = detect_csv_dialect_from_file(csv_path)
    rows = iter_non_empty_csv_rows(csv_path, dialect)

    try:
        header = next(rows)
    except StopIteration as exc:
        raise ValueError("Expression matrix is empty.") from exc

    cell_names, expected_column_count = validate_expression_header(header)

    sampled_gene_names: list[str] = []
    seen_sampled_gene_names: set[str] = set()
    sampled_row_count = 0

    try:
        for row_number, row in enumerate(rows, start=2):
            if sampled_row_count >= EXPRESSION_FAST_SAMPLE_ROWS:
                break

            if len(row) != expected_column_count:
                raise ValueError(
                    f"Expression matrix row {row_number} has {len(row)} columns; expected {expected_column_count}."
                )

            gene_name = str(row[0]).strip()
            if gene_name == "":
                raise ValueError("First column contains blank gene names.")
            if gene_name in seen_sampled_gene_names:
                raise ValueError("Gene names must be unique in the sampled validation rows.")

            for value in expression_numeric_values_to_check(row, sampled_row_count + 1):
                parse_required_finite_float(
                    value,
                    "Expression matrix contains missing or non-numeric interior values in sampled validation rows.",
                )

            seen_sampled_gene_names.add(gene_name)
            if len(sampled_gene_names) < UPLOAD_NAME_PREVIEW_LIMIT:
                sampled_gene_names.append(gene_name)
            sampled_row_count += 1
    except csv.Error as exc:
        raise ValueError(f"Expression matrix could not be parsed as CSV: {exc}") from exc

    gene_count = max(0, count_non_empty_text_lines(csv_path) - 1)
    if gene_count <= 0 or sampled_row_count == 0:
        raise ValueError("Expression matrix must include gene names in the first column.")

    return {
        "gene_count": gene_count,
        "cell_count": len(cell_names),
        "gene_names": sampled_gene_names,
        "cell_names": preview_items(cell_names),
    }


def parse_expression_matrix(csv_path: Path) -> dict[str, Any]:
    if upload_validation_mode() == STRICT_UPLOAD_VALIDATION_MODE:
        return parse_expression_matrix_strict(csv_path)
    return parse_expression_matrix_fast(csv_path)


def read_expression_cell_names(csv_path: Path) -> list[str]:
    dialect = detect_csv_dialect_from_file(csv_path)
    rows = iter_non_empty_csv_rows(csv_path, dialect)

    try:
        header = next(rows)
    except StopIteration as exc:
        raise ValueError("Expression matrix is empty.") from exc

    cell_names, _ = validate_expression_header(header)
    return cell_names


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


def is_cluster_label_header(value: str) -> bool:
    return value.strip().lower() in CLUSTER_LABEL_HEADER_NAMES


def parse_cluster_labels(csv_path: Path, expected_cell_names: list[str]) -> dict[str, Any]:
    """Validate a CellOracle cluster-label CSV.

    Supported format:
    cell_id,cluster
    E37_5_927,Chondrocyte

    The file must label every expression-matrix cell exactly once. GRNScope later
    skips clusters that are too small for CellOracle, but the assignment itself
    should be complete so global and per-cluster outputs stay comparable.
    """

    expected_cell_set = set(expected_cell_names)
    if not expected_cell_names:
        raise ValueError("Cluster labels require an expression matrix with cell identifiers.")

    dialect = detect_csv_dialect_from_file(csv_path)
    rows = iter_non_empty_csv_rows(csv_path, dialect)

    try:
        first_row = next(rows)
    except StopIteration as exc:
        raise ValueError("Cluster label file is empty.") from exc

    if len(first_row) < 2:
        raise ValueError("Cluster label file must contain two columns: cell_id and cluster.")

    has_header = is_cell_id_header(first_row[0]) and is_cluster_label_header(first_row[1])
    data_rows = enumerate(rows, start=2)
    if not has_header:
        data_rows = chain([(1, first_row)], data_rows)

    labels: dict[str, str] = {}
    cluster_counts: dict[str, int] = {}

    try:
        for row_number, row in data_rows:
            if len(row) < 2:
                raise ValueError(
                    f"Cluster label row {row_number} has {len(row)} columns; expected at least 2."
                )

            cell_id = str(row[0]).strip()
            cluster = str(row[1]).strip()
            if not cell_id:
                raise ValueError("Cluster label file contains blank cell identifiers.")
            if not cluster:
                raise ValueError("Cluster label file contains blank cluster labels.")
            if cell_id in labels:
                raise ValueError("Cluster label file cell identifiers must be unique.")
            if cell_id not in expected_cell_set:
                raise ValueError(
                    f"Cluster label file contains a cell not present in the expression matrix: {cell_id}."
                )

            labels[cell_id] = cluster
            cluster_counts[cluster] = cluster_counts.get(cluster, 0) + 1
    except csv.Error as exc:
        raise ValueError(f"Cluster label file could not be parsed as CSV: {exc}") from exc

    missing_cells = [cell_id for cell_id in expected_cell_names if cell_id not in labels]
    if missing_cells:
        preview = ", ".join(missing_cells[:5])
        suffix = "..." if len(missing_cells) > 5 else ""
        raise ValueError(
            f"Cluster label file is missing labels for {len(missing_cells)} expression cells: {preview}{suffix}"
        )

    if not cluster_counts:
        raise ValueError("Cluster label file must contain at least one labeled cell.")

    cluster_items = sorted(cluster_counts.items(), key=lambda item: (-item[1], item[0]))

    return {
        "cluster_label_count": len(labels),
        "cluster_count": len(cluster_counts),
        "cluster_names": preview_items([name for name, _ in cluster_items]),
        "cluster_cell_counts": dict(cluster_items),
    }


def parse_pseudotime(
    csv_path: Path,
    expected_cell_count: int,
    expected_cell_names: list[str] | None = None,
) -> dict[str, Any]:
    """Validate a pseudotime CSV.

    Supported formats:
    1. Simple format: one pseudotime value per row.
    2. BEELINE-style format: first column is cell IDs, remaining columns are
       pseudotime trajectories such as PseudoTime1, PseudoTime2, etc.
       Blank/NA values are allowed in trajectory columns because a cell may
       belong to only one branch. Files with an omitted first-column header are
       also accepted when the first data column clearly contains cell IDs.
    """

    if expected_cell_names is not None:
        from .services.pseudotime_format_service import (
            read_canonical_pseudotime_frame,
        )

        if len(expected_cell_names) != expected_cell_count:
            raise ValueError(
                "Expression cell-name count does not match the expected cell count."
            )
        frame, source_format = read_canonical_pseudotime_frame(
            csv_path,
            expected_cell_names,
        )
        return {
            "pseudotime_count": int(frame.shape[0]),
            "pseudotime_trajectory_count": int(frame.shape[1]),
            "pseudotime_format": source_format,
        }

    dialect = detect_csv_dialect_from_file(csv_path)
    rows = iter_non_empty_csv_rows(csv_path, dialect)

    try:
        first_row = next(rows)
    except StopIteration as exc:
        raise ValueError("Pseudotime file is empty.")

    if len(first_row) == 1:
        value_count = 0

        first_value = str(first_row[0]).strip()
        try:
            parse_required_finite_float(
                first_value,
                "Pseudotime file contains missing or non-numeric values.",
            )
            value_count += 1
        except ValueError:
            pass

        try:
            for row_number, row in enumerate(rows, start=2):
                if len(row) != 1:
                    raise ValueError(
                        "Pseudotime file must contain either one pseudotime column or a first column of cell IDs followed by one or more pseudotime columns."
                    )
                parse_required_finite_float(
                    row[0],
                    "Pseudotime file contains missing or non-numeric values.",
                )
                value_count += 1
        except csv.Error as exc:
            raise ValueError(f"Pseudotime file could not be parsed as CSV: {exc}") from exc

        if value_count != expected_cell_count:
            raise ValueError(
                f"Pseudotime row count ({value_count}) does not match cell count ({expected_cell_count})."
            )

        return {
            "pseudotime_count": int(value_count),
            "pseudotime_trajectory_count": 1,
            "pseudotime_format": "single_column",
        }

    if len(first_row) < 2:
        raise ValueError(
            "Pseudotime file must contain either one pseudotime column or a first column of cell IDs followed by one or more pseudotime columns."
        )

    try:
        first_data_row = next(rows)
    except StopIteration:
        first_data_row = None

    raw_headers = [str(column).strip() for column in first_row]
    trajectory_headers, expected_column_count = resolve_pseudotime_table_layout(
        raw_headers,
        first_data_row,
    )
    trajectory_count = len(trajectory_headers)
    trajectory_numeric_counts = [0] * trajectory_count
    total_numeric_values = 0
    cell_count = 0
    seen_cell_ids: set[str] = set()

    try:
        first_data_rows = (
            [(2, first_data_row)]
            if first_data_row is not None
            else []
        )

        for row_number, row in chain(first_data_rows, enumerate(rows, start=3)):
            if len(row) > expected_column_count:
                raise ValueError(
                    f"Pseudotime row {row_number} has {len(row)} columns; expected {expected_column_count}."
                )

            padded_row = [*row, *([""] * (expected_column_count - len(row)))]
            cell_id = str(padded_row[0]).strip()
            if cell_id == "":
                raise ValueError("Pseudotime file contains blank cell identifiers.")
            if cell_id in seen_cell_ids:
                raise ValueError("Pseudotime file cell identifiers must be unique.")

            seen_cell_ids.add(cell_id)
            cell_count += 1

            for index, value in enumerate(padded_row[1 : trajectory_count + 1]):
                if parse_optional_finite_float(value):
                    trajectory_numeric_counts[index] += 1
                    total_numeric_values += 1
    except csv.Error as exc:
        raise ValueError(f"Pseudotime file could not be parsed as CSV: {exc}") from exc

    if cell_count != expected_cell_count:
        raise ValueError(
            f"Pseudotime row count ({cell_count}) does not match cell count ({expected_cell_count})."
        )

    if total_numeric_values == 0:
        raise ValueError("Pseudotime file must contain at least one numeric pseudotime value.")

    empty_trajectory_columns = [
        trajectory_headers[index]
        for index, numeric_count in enumerate(trajectory_numeric_counts)
        if numeric_count == 0
    ]
    if empty_trajectory_columns:
        raise ValueError(
            "Pseudotime trajectory columns must contain at least one numeric value. Empty columns: "
            + ", ".join(empty_trajectory_columns)
        )

    return {
        "pseudotime_count": int(cell_count),
        "pseudotime_trajectory_count": int(trajectory_count),
        "pseudotime_format": "cell_id_trajectory_columns",
    }
