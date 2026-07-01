from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..schemas import TempUploadResponse
from ..storage import (
    create_temp_upload_id,
    save_json,
    save_upload_file,
    temp_cluster_labels_path,
    temp_expression_path,
    temp_metadata_path,
    temp_pseudotime_path,
)
from ..validators import (
    parse_cluster_labels,
    parse_expression_matrix,
    parse_pseudotime,
    read_expression_cell_names,
    validate_csv_extension,
)
router = APIRouter()

METADATA_NAME_PREVIEW_LIMIT = 1000


def preview_names(names: list[str]) -> list[str]:
    return names[:METADATA_NAME_PREVIEW_LIMIT]


@router.post("/api/uploads/temp-dataset", response_model=TempUploadResponse)
async def temp_dataset_upload(
    expression_matrix: UploadFile = File(...),
    pseudotime: UploadFile | None = File(default=None),
    cluster_labels: UploadFile | None = File(default=None),
    defer_validation: bool = Form(False),
):
    errors: list[str] = []

    expression_ext_error = validate_csv_extension(expression_matrix.filename or "")
    if expression_ext_error:
        errors.append(f"Expression matrix: {expression_ext_error}")

    if pseudotime:
        pseudo_ext_error = validate_csv_extension(pseudotime.filename or "")
        if pseudo_ext_error:
            errors.append(f"Pseudotime: {pseudo_ext_error}")

    if cluster_labels:
        cluster_ext_error = validate_csv_extension(cluster_labels.filename or "")
        if cluster_ext_error:
            errors.append(f"Cluster labels: {cluster_ext_error}")

    if errors:
        return TempUploadResponse(ok=False, errors=errors)

    temp_upload_id = create_temp_upload_id()
    expression_path = temp_expression_path(
        temp_upload_id, expression_matrix.filename or "expression.csv"
    )

    pseudotime_path: Path | None = None
    if pseudotime:
        pseudotime_path = temp_pseudotime_path(
            temp_upload_id, pseudotime.filename or "pseudotime.csv"
        )

    cluster_labels_path: Path | None = None
    if cluster_labels:
        cluster_labels_path = temp_cluster_labels_path(
            temp_upload_id, cluster_labels.filename or "cluster_labels.csv"
        )

    try:
        save_upload_file(expression_matrix, expression_path)

        if defer_validation:
            if pseudotime and pseudotime_path is not None:
                save_upload_file(pseudotime, pseudotime_path)
            if cluster_labels and cluster_labels_path is not None:
                save_upload_file(cluster_labels, cluster_labels_path)

            metadata = {
                "temp_upload_id": temp_upload_id,
                "expression_path": str(expression_path),
                "pseudotime_path": str(pseudotime_path) if pseudotime_path else None,
                "cluster_labels_path": (
                    str(cluster_labels_path) if cluster_labels_path else None
                ),
                "expression_filename": expression_matrix.filename,
                "pseudotime_filename": pseudotime.filename if pseudotime else None,
                "cluster_labels_filename": (
                    cluster_labels.filename if cluster_labels else None
                ),
                "gene_count": None,
                "cell_count": None,
                "gene_names": [],
                "cell_names": [],
                "gene_names_truncated": False,
                "cell_names_truncated": False,
                "has_pseudotime": pseudotime is not None,
                "pseudotime_count": None,
                "has_cluster_labels": cluster_labels is not None,
                "cluster_label_count": None,
                "cluster_count": None,
                "cluster_names": [],
                "cluster_cell_counts": {},
                "deferred_validation": True,
            }
            save_json(temp_metadata_path(temp_upload_id), metadata)

            return TempUploadResponse(
                ok=True,
                temp_upload_id=temp_upload_id,
                expression_filename=expression_matrix.filename,
                pseudotime_filename=pseudotime.filename if pseudotime else None,
                cluster_labels_filename=(
                    cluster_labels.filename if cluster_labels else None
                ),
                gene_count=None,
                cell_count=None,
                has_pseudotime=pseudotime is not None,
                has_cluster_labels=cluster_labels is not None,
                cluster_count=None,
                errors=[],
            )

        expression_info = parse_expression_matrix(expression_path)
        expression_cell_names = read_expression_cell_names(expression_path)

        pseudotime_info = None
        if pseudotime and pseudotime_path is not None:
            save_upload_file(pseudotime, pseudotime_path)
            pseudotime_info = parse_pseudotime(
                pseudotime_path, expression_info["cell_count"]
            )

        cluster_labels_info = None
        if cluster_labels and cluster_labels_path is not None:
            save_upload_file(cluster_labels, cluster_labels_path)
            cluster_labels_info = parse_cluster_labels(
                cluster_labels_path,
                expression_cell_names,
            )

        metadata = {
            "temp_upload_id": temp_upload_id,
            "expression_path": str(expression_path),
            "pseudotime_path": str(pseudotime_path) if pseudotime_path else None,
            "cluster_labels_path": (
                str(cluster_labels_path) if cluster_labels_path else None
            ),
            "expression_filename": expression_matrix.filename,
            "pseudotime_filename": pseudotime.filename if pseudotime else None,
            "cluster_labels_filename": (
                cluster_labels.filename if cluster_labels else None
            ),
            "gene_count": expression_info["gene_count"],
            "cell_count": expression_info["cell_count"],
            "gene_names": preview_names(expression_info["gene_names"]),
            "cell_names": preview_names(expression_info["cell_names"]),
            "gene_names_truncated": (
                expression_info["gene_count"] > METADATA_NAME_PREVIEW_LIMIT
            ),
            "cell_names_truncated": (
                expression_info["cell_count"] > METADATA_NAME_PREVIEW_LIMIT
            ),
            "has_pseudotime": pseudotime is not None,
            "pseudotime_count": (
                pseudotime_info["pseudotime_count"] if pseudotime_info else None
            ),
            "has_cluster_labels": cluster_labels is not None,
            "cluster_label_count": (
                cluster_labels_info["cluster_label_count"]
                if cluster_labels_info
                else None
            ),
            "cluster_count": (
                cluster_labels_info["cluster_count"] if cluster_labels_info else None
            ),
            "cluster_names": (
                cluster_labels_info["cluster_names"] if cluster_labels_info else []
            ),
            "cluster_cell_counts": (
                cluster_labels_info["cluster_cell_counts"]
                if cluster_labels_info
                else {}
            ),
        }
        save_json(temp_metadata_path(temp_upload_id), metadata)

        return TempUploadResponse(
            ok=True,
            temp_upload_id=temp_upload_id,
            expression_filename=expression_matrix.filename,
            pseudotime_filename=pseudotime.filename if pseudotime else None,
            cluster_labels_filename=(
                cluster_labels.filename if cluster_labels else None
            ),
            gene_count=expression_info["gene_count"],
            cell_count=expression_info["cell_count"],
            has_pseudotime=pseudotime is not None,
            has_cluster_labels=cluster_labels is not None,
            cluster_count=(
                cluster_labels_info["cluster_count"] if cluster_labels_info else None
            ),
            errors=[],
        )
    except Exception as e:
        if expression_path.exists():
            expression_path.unlink()
        if pseudotime_path and pseudotime_path.exists():
            pseudotime_path.unlink()
        if cluster_labels_path and cluster_labels_path.exists():
            cluster_labels_path.unlink()

        meta_path = temp_metadata_path(temp_upload_id)
        if meta_path.exists():
            meta_path.unlink()

        return TempUploadResponse(ok=False, errors=[str(e)])
