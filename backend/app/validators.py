from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd


MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024


def validate_csv_extension(filename: str) -> str | None:
    if not filename.lower().endswith(".csv"):
        return "File must be a CSV file."
    return None


def validate_file_size(size_bytes: int) -> str | None:
    if size_bytes > MAX_FILE_SIZE_BYTES:
        return "File size must be 500 MB or smaller."
    return None


def parse_expression_matrix(csv_path: Path) -> dict[str, Any]:
    try:
        df = pd.read_csv(csv_path)
    except Exception as exc:
        raise ValueError(f"Expression matrix could not be parsed as CSV: {exc}") from exc

    if df.empty:
        raise ValueError("Expression matrix is empty.")

    if df.shape[1] < 2:
        raise ValueError(
            "Expression matrix must contain a first column of gene names and at least one cell column."
        )

    if df.shape[0] < 1:
        raise ValueError("Expression matrix must contain at least one gene row.")

    if df.columns.isna().any():
        raise ValueError("Header row contains missing identifiers.")

    raw_headers = [str(col).strip() for col in df.columns.tolist()]
    if any(header == "" for header in raw_headers):
        raise ValueError("Header row contains blank identifiers.")

    first_col_name = df.columns[0]
    first_col_label = str(first_col_name).strip()
    if first_col_label == "":
        raise ValueError("The first column header is missing.")

    cell_names = [str(col).strip() for col in df.columns[1:].tolist()]
    if not cell_names:
        raise ValueError("Expression matrix must include at least one cell identifier.")

    if any(name == "" for name in cell_names):
        raise ValueError("Header row contains blank cell identifiers.")

    if len(set(cell_names)) != len(cell_names):
        raise ValueError("Cell identifiers must be unique.")

    gene_names = df[first_col_name].astype(str).str.strip().tolist()
    if not gene_names:
        raise ValueError("Expression matrix must include gene names in the first column.")

    if any(name == "" for name in gene_names):
        raise ValueError("First column contains blank gene names.")

    if len(set(gene_names)) != len(gene_names):
        raise ValueError("Gene names must be unique.")

    numeric_df = df.iloc[:, 1:].apply(pd.to_numeric, errors="coerce")
    if numeric_df.isna().any().any():
        raise ValueError(
            "Expression matrix contains missing or non-numeric interior values."
        )

    return {
        "gene_count": len(gene_names),
        "cell_count": len(cell_names),
        "gene_names": gene_names,
        "cell_names": cell_names,
    }


def parse_pseudotime(csv_path: Path, expected_cell_count: int) -> dict[str, Any]:
    """Validate a pseudotime CSV.

    Supported formats:
    1. Simple format: one pseudotime value per row.
    2. BEELINE-style format: first column is cell IDs, remaining columns are
       pseudotime trajectories such as PseudoTime1, PseudoTime2, etc.
       Blank/NA values are allowed in trajectory columns because a cell may
       belong to only one branch.
    """

    try:
        raw_df = pd.read_csv(csv_path, header=None, dtype=str, keep_default_na=False)
    except Exception as exc:
        raise ValueError(f"Pseudotime file could not be parsed as CSV: {exc}") from exc

    if raw_df.empty:
        raise ValueError("Pseudotime file is empty.")

    missing_tokens = {"", "NA", "N/A", "NaN", "nan", "null", "NULL"}

    if raw_df.shape[1] == 1:
        raw_values = raw_df.iloc[:, 0].astype(str).str.strip()

        # Allow either a headerless one-column file or a one-column file with a
        # header such as "pseudotime".
        first_value = raw_values.iloc[0] if len(raw_values) > 0 else ""
        first_numeric = pd.to_numeric(pd.Series([first_value]), errors="coerce").iloc[0]
        if pd.isna(first_numeric):
            raw_values = raw_values.iloc[1:]

        values = pd.to_numeric(raw_values, errors="coerce")
        if values.isna().any():
            raise ValueError("Pseudotime file contains missing or non-numeric values.")

        if len(values) != expected_cell_count:
            raise ValueError(
                f"Pseudotime row count ({len(values)}) does not match cell count ({expected_cell_count})."
            )

        return {
            "pseudotime_count": int(len(values)),
            "pseudotime_trajectory_count": 1,
            "pseudotime_format": "single_column",
        }

    try:
        df = pd.read_csv(csv_path, header=0, dtype=str, keep_default_na=False)
    except Exception as exc:
        raise ValueError(f"Pseudotime file could not be parsed as CSV: {exc}") from exc

    if df.empty:
        raise ValueError("Pseudotime file is empty.")

    if df.shape[1] < 2:
        raise ValueError(
            "Pseudotime file must contain either one pseudotime column or a first column of cell IDs followed by one or more pseudotime columns."
        )

    raw_headers = [str(col).strip() for col in df.columns.tolist()]
    if any(header == "" for header in raw_headers[1:]):
        raise ValueError("Pseudotime file contains blank trajectory column names.")

    cell_ids = df.iloc[:, 0].astype(str).str.strip().tolist()
    if any(cell_id == "" for cell_id in cell_ids):
        raise ValueError("Pseudotime file contains blank cell identifiers.")

    if len(set(cell_ids)) != len(cell_ids):
        raise ValueError("Pseudotime file cell identifiers must be unique.")

    if len(cell_ids) != expected_cell_count:
        raise ValueError(
            f"Pseudotime row count ({len(cell_ids)}) does not match cell count ({expected_cell_count})."
        )

    trajectory_df = df.iloc[:, 1:].apply(lambda col: col.astype(str).str.strip())
    cleaned_trajectory_df = trajectory_df.mask(trajectory_df.isin(missing_tokens))

    if cleaned_trajectory_df.notna().sum().sum() == 0:
        raise ValueError("Pseudotime file must contain at least one numeric pseudotime value.")

    numeric_trajectory_df = cleaned_trajectory_df.apply(pd.to_numeric, errors="coerce")
    invalid_mask = cleaned_trajectory_df.notna() & numeric_trajectory_df.isna()
    if invalid_mask.any().any():
        raise ValueError("Pseudotime file contains non-numeric values outside blank/NA cells.")

    empty_trajectory_columns = [
        str(column)
        for column in numeric_trajectory_df.columns
        if numeric_trajectory_df[column].notna().sum() == 0
    ]
    if empty_trajectory_columns:
        raise ValueError(
            "Pseudotime trajectory columns must contain at least one numeric value. Empty columns: "
            + ", ".join(empty_trajectory_columns)
        )

    return {
        "pseudotime_count": int(len(cell_ids)),
        "pseudotime_trajectory_count": int(numeric_trajectory_df.shape[1]),
        "pseudotime_format": "cell_id_trajectory_columns",
    }