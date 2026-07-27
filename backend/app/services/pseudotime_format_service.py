from __future__ import annotations

import csv
import json
import os
from pathlib import Path
import threading

import numpy as np
import pandas as pd

from .matrix_transformation_service import detect_delimiter


PSEUDOTIME_CANONICALIZATION_VERSION = 1
CANONICAL_PSEUDOTIME_FILENAME = "PseudoTime.csv"
CANONICAL_PSEUDOTIME_MANIFEST_FILENAME = "pseudotime_manifest.json"
CELL_ID_HEADERS = {"cell", "cell_id", "cellid", "cell id", "cells"}
MISSING_VALUES = {"", "na", "nan", "null", "none"}


class PseudotimeFormatError(ValueError):
    pass


def _uniquify_headers(raw_headers: list[str]) -> list[str]:
    headers: list[str] = []
    seen: set[str] = set()
    for index, raw_header in enumerate(raw_headers, start=1):
        base = str(raw_header).strip() or f"PseudoTime{index}"
        header = base
        suffix = 2
        while header in seen:
            header = f"{base}_{suffix}"
            suffix += 1
        headers.append(header)
        seen.add(header)
    return headers


def _read_rows(path: Path) -> list[list[str]]:
    try:
        delimiter = detect_delimiter(path)
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            return [
                [str(value).strip() for value in row]
                for row in csv.reader(source, delimiter=delimiter)
                if any(str(value).strip() for value in row)
            ]
    except (OSError, UnicodeError, csv.Error) as exc:
        raise PseudotimeFormatError(
            f"Pseudotime CSV could not be loaded: {exc}"
        ) from exc


def _required_float(raw_value: str) -> float:
    try:
        value = float(str(raw_value).strip())
    except (TypeError, ValueError) as exc:
        raise PseudotimeFormatError(
            "Single-column pseudotime must contain one numeric value for "
            "every expression-matrix cell."
        ) from exc
    if not np.isfinite(value):
        raise PseudotimeFormatError(
            "Single-column pseudotime must contain one finite numeric value "
            "for every expression-matrix cell."
        )
    return value


def _optional_float(raw_value: str) -> float:
    text = str(raw_value).strip()
    if text.lower() in MISSING_VALUES:
        return np.nan
    try:
        value = float(text)
    except (TypeError, ValueError) as exc:
        raise PseudotimeFormatError(
            "Pseudotime contains a non-numeric value outside blank/NA cells."
        ) from exc
    if not np.isfinite(value):
        raise PseudotimeFormatError(
            "Pseudotime contains a non-finite value outside blank/NA cells."
        )
    return value


def _single_column_frame(
    rows: list[list[str]],
    expression_cells: pd.Index,
) -> tuple[pd.DataFrame, str]:
    first_value = str(rows[0][0]).strip()
    try:
        float(first_value)
        has_header = False
    except ValueError:
        has_header = True

    data_rows = rows[1:] if has_header else rows
    if len(data_rows) != len(expression_cells):
        raise PseudotimeFormatError(
            f"Pseudotime row count ({len(data_rows)}) does not match "
            f"expression cell count ({len(expression_cells)})."
        )
    values = [_required_float(row[0]) for row in data_rows]
    trajectory_name = first_value if has_header and first_value else "PseudoTime1"
    return (
        pd.DataFrame(
            {trajectory_name: values},
            index=expression_cells,
        ),
        "single_column",
    )


def _table_layout(
    header: list[str],
    first_data_row: list[str] | None,
) -> tuple[list[str], int]:
    first_header = str(header[0]).strip()
    first_data_width = len(first_data_row) if first_data_row is not None else len(header)
    explicit_cell_header = (
        first_header == "" or first_header.lower() in CELL_ID_HEADERS
    )
    shifted_headers = (
        not explicit_cell_header
        and (
            first_data_width == len(header) + 1
            or (str(header[-1]).strip() == "" and first_data_width == len(header))
        )
    )
    if shifted_headers:
        if str(header[-1]).strip() == "" and first_data_width == len(header):
            return _uniquify_headers(header[:-1]), len(header)
        return _uniquify_headers(header), len(header) + 1
    return _uniquify_headers(header[1:]), len(header)


def _named_table_frame(
    rows: list[list[str]],
    expression_cells: pd.Index,
    *,
    allow_empty_trajectories: bool,
) -> tuple[pd.DataFrame, str]:
    header = rows[0]
    data_rows = rows[1:]
    trajectory_headers, expected_width = _table_layout(
        header,
        data_rows[0] if data_rows else None,
    )
    if not trajectory_headers:
        raise PseudotimeFormatError(
            "Pseudotime must contain at least one trajectory column."
        )

    cell_ids: list[str] = []
    values: list[list[float]] = []
    seen: set[str] = set()
    for row_number, row in enumerate(data_rows, start=2):
        if len(row) > expected_width:
            raise PseudotimeFormatError(
                f"Pseudotime row {row_number} has {len(row)} columns; "
                f"expected {expected_width}."
            )
        padded = [*row, *([""] * (expected_width - len(row)))]
        cell_id = str(padded[0]).strip()
        if not cell_id:
            raise PseudotimeFormatError(
                "Pseudotime contains a blank cell identifier."
            )
        if cell_id in seen:
            raise PseudotimeFormatError(
                f"Pseudotime contains duplicate cell identifier: {cell_id}."
            )
        seen.add(cell_id)
        cell_ids.append(cell_id)
        values.append(
            [
                _optional_float(raw_value)
                for raw_value in padded[1 : len(trajectory_headers) + 1]
            ]
        )

    expected_set = set(expression_cells)
    observed_set = set(cell_ids)
    missing = [cell for cell in expression_cells if cell not in observed_set]
    unknown = [cell for cell in cell_ids if cell not in expected_set]
    if missing or unknown:
        details: list[str] = []
        if missing:
            details.append(
                f"missing {len(missing)} expression cells "
                f"({', '.join(missing[:5])})"
            )
        if unknown:
            details.append(
                f"contains {len(unknown)} unknown cells "
                f"({', '.join(unknown[:5])})"
            )
        raise PseudotimeFormatError(
            "Pseudotime cell identifiers must match the expression matrix "
            f"exactly: {'; '.join(details)}."
        )

    frame = pd.DataFrame(
        values,
        index=pd.Index(cell_ids),
        columns=trajectory_headers,
        dtype=float,
    ).reindex(expression_cells)
    empty_trajectories = [
        str(column) for column in frame.columns if not frame[column].notna().any()
    ]
    if empty_trajectories and not allow_empty_trajectories:
        raise PseudotimeFormatError(
            "Pseudotime trajectory columns must contain at least one numeric "
            f"value: {', '.join(empty_trajectories)}."
        )
    return frame, "cell_id_trajectory_columns"


def read_canonical_pseudotime_frame(
    pseudotime_path: Path,
    expression_cells: list[str] | pd.Index,
    *,
    allow_empty_trajectories: bool = False,
) -> tuple[pd.DataFrame, str]:
    rows = _read_rows(pseudotime_path)
    if not rows:
        raise PseudotimeFormatError("Pseudotime CSV is empty.")

    normalized_cells = pd.Index(
        [str(value).strip() for value in expression_cells],
        dtype=object,
    )
    if normalized_cells.has_duplicates:
        raise PseudotimeFormatError(
            "Expression matrix cell identifiers must be unique."
        )
    if any(not cell for cell in normalized_cells):
        raise PseudotimeFormatError(
            "Expression matrix contains a blank cell identifier."
        )

    if all(len(row) == 1 for row in rows):
        frame, source_format = _single_column_frame(rows, normalized_cells)
    else:
        if len(rows[0]) < 2:
            raise PseudotimeFormatError(
                "Pseudotime must contain one value per row or a cell-ID "
                "column followed by trajectory columns."
            )
        frame, source_format = _named_table_frame(
            rows,
            normalized_cells,
            allow_empty_trajectories=allow_empty_trajectories,
        )

    frame.index.name = None
    return frame, source_format


def _path_signature(path: Path) -> dict:
    stat = path.stat()
    return {
        "path": str(path.resolve()),
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
    }


def _expression_cell_names(expression_path: Path) -> list[str]:
    delimiter = detect_delimiter(expression_path)
    try:
        columns = pd.read_csv(
            expression_path,
            sep=delimiter,
            nrows=0,
        ).columns
    except (OSError, UnicodeError, ValueError, pd.errors.ParserError) as exc:
        raise PseudotimeFormatError(
            f"Expression matrix header could not be read: {exc}"
        ) from exc
    if len(columns) < 2:
        raise PseudotimeFormatError(
            "Expression matrix must contain at least one cell column."
        )
    return [str(value).strip() for value in columns[1:]]


def ensure_canonical_project_pseudotime(
    *,
    project_dir: Path,
    expression_path: Path,
    source_pseudotime: Path,
) -> tuple[Path, dict]:
    destination_dir = project_dir / "preprocessed"
    destination = destination_dir / CANONICAL_PSEUDOTIME_FILENAME
    manifest_path = destination_dir / CANONICAL_PSEUDOTIME_MANIFEST_FILENAME
    expression_cells = _expression_cell_names(expression_path)
    signature = {
        "version": PSEUDOTIME_CANONICALIZATION_VERSION,
        "source_pseudotime": _path_signature(source_pseudotime),
        "source_expression": _path_signature(expression_path),
        "expression_cell_count": len(expression_cells),
    }

    try:
        cached_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        cached_manifest = None
    if (
        destination.is_file()
        and destination.stat().st_size > 0
        and isinstance(cached_manifest, dict)
        and cached_manifest.get("signature") == signature
    ):
        return destination, cached_manifest

    frame, source_format = read_canonical_pseudotime_frame(
        source_pseudotime,
        expression_cells,
    )
    destination_dir.mkdir(parents=True, exist_ok=True)
    temporary_destination = destination.with_name(
        f".{destination.name}.{os.getpid()}.{threading.get_ident()}.tmp"
    )
    temporary_manifest = manifest_path.with_name(
        f".{manifest_path.name}.{os.getpid()}.{threading.get_ident()}.tmp"
    )
    canonical_manifest = {
        "signature": signature,
        "source_format": source_format,
        "trajectory_count": int(frame.shape[1]),
        "cell_count": int(frame.shape[0]),
        "trajectory_names": [str(value) for value in frame.columns],
    }
    try:
        frame.to_csv(
            temporary_destination,
            index=True,
            index_label="",
            float_format="%.10g",
            na_rep="NA",
            lineterminator="\n",
        )
        temporary_manifest.write_text(
            json.dumps(canonical_manifest, indent=2),
            encoding="utf-8",
        )
        temporary_destination.replace(destination)
        temporary_manifest.replace(manifest_path)
    finally:
        temporary_destination.unlink(missing_ok=True)
        temporary_manifest.unlink(missing_ok=True)

    return destination, canonical_manifest
