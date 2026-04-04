from __future__ import annotations

from pathlib import Path
from typing import Optional
import csv
import uuid

MAX_FILE_SIZE = 500 * 1024 * 1024  # 500 MB


def generate_project_id() -> str:
    return str(uuid.uuid4())


def ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def save_upload_file(upload_file, destination: Path) -> int:
    """
    Save uploaded file to destination and return file size in bytes.
    """
    ensure_directory(destination.parent)

    total_size = 0
    with destination.open("wb") as buffer:
        while True:
            chunk = upload_file.file.read(1024 * 1024)
            if not chunk:
                break
            total_size += len(chunk)
            buffer.write(chunk)

    upload_file.file.close()
    return total_size


def validate_csv_extension(filename: Optional[str]) -> bool:
    if not filename:
        return False
    return filename.lower().endswith(".csv")


def validate_expression_matrix_csv(file_path: Path) -> tuple[list[str], dict]:
    """
    Validate expression matrix CSV.
    Requirements:
    - first row contains cell identifiers
    - first column contains gene names
    - interior values are numeric
    """
    errors: list[str] = []

    with file_path.open("r", newline="", encoding="utf-8-sig") as f:
        reader = list(csv.reader(f))

    if len(reader) < 2:
        errors.append("Expression matrix must contain at least 2 rows.")
        return errors, {}

    header = reader[0]
    if len(header) < 2:
        errors.append("Expression matrix must contain at least 2 columns.")
        return errors, {}

    cell_ids = header[1:]
    if not all(cell_id.strip() for cell_id in cell_ids):
        errors.append("The first row must contain valid cell identifiers.")

    gene_names: list[str] = []

    for row_index, row in enumerate(reader[1:], start=2):
        if len(row) != len(header):
            errors.append(
                f"Row {row_index} has {len(row)} columns, expected {len(header)}."
            )
            continue

        gene_name = row[0].strip()
        if not gene_name:
            errors.append(f"Row {row_index} has an empty gene name in the first column.")
        gene_names.append(gene_name)

        for col_index, value in enumerate(row[1:], start=2):
            try:
                float(value)
            except ValueError:
                errors.append(
                    f"Non-numeric value found at row {row_index}, column {col_index}."
                )

    metadata = {
        "gene_count": len(reader) - 1,
        "cell_count": len(header) - 1,
        "gene_names": gene_names,
    }

    return errors, metadata


def validate_pseudotime_csv(file_path: Path, expected_cell_count: int) -> list[str]:
    """
    Validate pseudotime CSV:
    - single column
    - one numeric value per cell
    """
    errors: list[str] = []

    with file_path.open("r", newline="", encoding="utf-8-sig") as f:
        reader = list(csv.reader(f))

    if len(reader) == 0:
        errors.append("Pseudotime file is empty.")
        return errors

    values = []
    for row_index, row in enumerate(reader, start=1):
        if len(row) != 1:
            errors.append(
                f"Pseudotime file row {row_index} must contain exactly one value."
            )
            continue

        value = row[0].strip()
        try:
            float(value)
            values.append(value)
        except ValueError:
            errors.append(f"Pseudotime row {row_index} contains a non-numeric value.")

    if len(values) != expected_cell_count:
        errors.append(
            f"Pseudotime file must contain exactly {expected_cell_count} values, but found {len(values)}."
        )

    return errors