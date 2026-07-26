from __future__ import annotations

import csv
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import pandas as pd
from scipy import sparse

if TYPE_CHECKING:
    from anndata import AnnData


MATRIX_TRANSFORMATION_ENGINE = "scanpy"
MATRIX_TRANSFORMATION_VERSION = 1
NORMALIZATION_TARGET_SUM = 10_000.0
SUPPORTED_MATRIX_STATES = {"raw", "normalized", "log_normalized"}


class MatrixTransformationError(ValueError):
    pass


def detect_delimiter(source_expression: Path) -> str:
    with source_expression.open("r", encoding="utf-8", newline="") as source_file:
        sample = source_file.read(65_536)

    if not sample.strip():
        raise MatrixTransformationError("Expression matrix file is empty.")

    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t;").delimiter
    except csv.Error:
        first_line = sample.splitlines()[0] if sample.splitlines() else ""
        if "\t" in first_line:
            return "\t"
        if ";" in first_line:
            return ";"
        return ","


def matrix_transformation_operations(matrix_state: str) -> list[str]:
    if matrix_state == "raw":
        return ["normalize_total", "log1p"]
    if matrix_state == "normalized":
        return ["log1p"]
    if matrix_state == "log_normalized":
        return []
    raise MatrixTransformationError(
        f"Unsupported matrix state: {matrix_state or 'empty'}."
    )


def matrix_transformation_signature(matrix_state: str) -> dict:
    operations = matrix_transformation_operations(matrix_state)
    return {
        "engine": MATRIX_TRANSFORMATION_ENGINE,
        "version": MATRIX_TRANSFORMATION_VERSION,
        "matrix_state": matrix_state,
        "operations": operations,
        "normalization_target_sum": (
            NORMALIZATION_TARGET_SUM if "normalize_total" in operations else None
        ),
    }


def read_expression_frame(source_expression: Path) -> pd.DataFrame:
    delimiter = detect_delimiter(source_expression)
    try:
        frame = pd.read_csv(
            source_expression,
            sep=delimiter,
            index_col=0,
        )
    except (OSError, UnicodeError, ValueError, pd.errors.ParserError) as exc:
        raise MatrixTransformationError(
            f"Expression matrix could not be loaded for transformation: {exc}"
        ) from exc

    if frame.empty or frame.shape[0] == 0:
        raise MatrixTransformationError(
            "Expression matrix must include gene rows below the header."
        )
    if frame.shape[1] == 0:
        raise MatrixTransformationError(
            "Expression matrix must include at least one cell column."
        )

    frame.index = pd.Index(
        [str(gene_name).strip() for gene_name in frame.index],
        name=frame.index.name,
    )
    frame.columns = pd.Index(
        [str(cell_name).strip() for cell_name in frame.columns]
    )

    try:
        numeric_frame = frame.apply(pd.to_numeric, errors="raise").astype(
            np.float64,
            copy=False,
        )
    except (TypeError, ValueError) as exc:
        raise MatrixTransformationError(
            "Expression matrix contains a non-numeric value."
        ) from exc

    values = numeric_frame.to_numpy(dtype=np.float64, copy=False)
    if not np.isfinite(values).all():
        raise MatrixTransformationError(
            "Expression matrix contains a non-finite value."
        )
    return numeric_frame


def build_anndata(expression_frame: pd.DataFrame) -> "AnnData":
    from anndata import AnnData

    return AnnData(
        X=expression_frame.to_numpy(dtype=np.float64, copy=True).T,
        obs=pd.DataFrame(index=expression_frame.columns.copy()),
        var=pd.DataFrame(index=expression_frame.index.copy()),
    )


def transformed_expression_frame(adata: "AnnData") -> pd.DataFrame:
    values = adata.X
    if sparse.issparse(values):
        values = values.toarray()
    return pd.DataFrame(
        np.asarray(values).T,
        index=adata.var_names.copy(),
        columns=adata.obs_names.copy(),
    )


def transform_expression_matrix(
    *,
    source_expression: Path,
    destination_expression: Path,
    matrix_state: str,
) -> dict:
    normalized_state = str(matrix_state).strip().lower()
    signature = matrix_transformation_signature(normalized_state)
    destination_expression.parent.mkdir(parents=True, exist_ok=True)

    if normalized_state == "log_normalized":
        shutil.copy2(source_expression, destination_expression)
        return signature

    expression_frame = read_expression_frame(source_expression)
    values = expression_frame.to_numpy(dtype=np.float64, copy=False)
    if (values < 0).any():
        raise MatrixTransformationError(
            "Raw and normalized expression matrices cannot contain negative values."
        )

    import scanpy as sc

    adata = build_anndata(expression_frame)
    if normalized_state == "raw":
        sc.pp.normalize_total(
            adata,
            target_sum=NORMALIZATION_TARGET_SUM,
            inplace=True,
        )
    sc.pp.log1p(adata)

    transformed_frame = transformed_expression_frame(adata)
    transformed_frame.to_csv(
        destination_expression,
        index=True,
        index_label=expression_frame.index.name or "",
        float_format="%.10g",
        lineterminator="\n",
    )
    return signature
