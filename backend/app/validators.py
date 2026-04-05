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
    try:
        df = pd.read_csv(csv_path, header=None)
    except Exception as exc:
        raise ValueError(f"Pseudotime file could not be parsed as CSV: {exc}") from exc

    if df.empty:
        raise ValueError("Pseudotime file is empty.")

    if df.shape[1] != 1:
        raise ValueError("Pseudotime file must be a single-column CSV.")

    values = pd.to_numeric(df.iloc[:, 0], errors="coerce")
    if values.isna().any():
        raise ValueError("Pseudotime file contains missing or non-numeric values.")

    if len(values) != expected_cell_count:
        raise ValueError(
            f"Pseudotime row count ({len(values)}) does not match cell count ({expected_cell_count})."
        )

    return {
        "pseudotime_count": int(len(values)),
    }