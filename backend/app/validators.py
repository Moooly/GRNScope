from __future__ import annotations

import csv
import os
from math import isfinite
from pathlib import Path
from typing import Any


MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024
CSV_SNIFF_SAMPLE_BYTES = 65536
MISSING_TOKENS = {"", "NA", "N/A", "NaN", "nan", "null", "NULL"}
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
    return os.getenv("GRNSCOPE_UPLOAD_VALIDATION_MODE", "fast").strip().lower()


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

            for value in expression_numeric_values_to_check(row, row_number - 1):
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


def parse_pseudotime(csv_path: Path, expected_cell_count: int) -> dict[str, Any]:
    """Validate a pseudotime CSV.

    Supported formats:
    1. Simple format: one pseudotime value per row.
    2. BEELINE-style format: first column is cell IDs, remaining columns are
       pseudotime trajectories such as PseudoTime1, PseudoTime2, etc.
       Blank/NA values are allowed in trajectory columns because a cell may
       belong to only one branch.
    """

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

    raw_headers = [str(column).strip() for column in first_row]
    if any(header == "" for header in raw_headers[1:]):
        raise ValueError("Pseudotime file contains blank trajectory column names.")

    trajectory_count = len(raw_headers) - 1
    trajectory_numeric_counts = [0] * trajectory_count
    total_numeric_values = 0
    cell_count = 0
    seen_cell_ids: set[str] = set()

    try:
        for row_number, row in enumerate(rows, start=2):
            if len(row) > len(first_row):
                raise ValueError(
                    f"Pseudotime row {row_number} has {len(row)} columns; expected {len(first_row)}."
                )

            padded_row = [*row, *([""] * (len(first_row) - len(row)))]
            cell_id = str(padded_row[0]).strip()
            if cell_id == "":
                raise ValueError("Pseudotime file contains blank cell identifiers.")
            if cell_id in seen_cell_ids:
                raise ValueError("Pseudotime file cell identifiers must be unique.")

            seen_cell_ids.add(cell_id)
            cell_count += 1

            for index, value in enumerate(padded_row[1:]):
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
        raw_headers[index + 1]
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
