from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..schemas import TempUploadResponse
from ..storage import (
    create_temp_upload_id,
    save_json,
    save_upload_file,
    temp_expression_path,
    temp_metadata_path,
    temp_pseudotime_path,
)
from ..validators import (
    parse_expression_matrix,
    parse_pseudotime,
    validate_csv_extension,
)
router = APIRouter()

@router.post("/api/uploads/temp-dataset", response_model=TempUploadResponse)
async def temp_dataset_upload(
    expression_matrix: UploadFile = File(...),
    pseudotime: UploadFile | None = File(default=None),
):
    errors: list[str] = []

    expression_ext_error = validate_csv_extension(expression_matrix.filename or "")
    if expression_ext_error:
        errors.append(f"Expression matrix: {expression_ext_error}")

    if pseudotime:
        pseudo_ext_error = validate_csv_extension(pseudotime.filename or "")
        if pseudo_ext_error:
            errors.append(f"Pseudotime: {pseudo_ext_error}")

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

    try:
        save_upload_file(expression_matrix, expression_path)
        expression_info = parse_expression_matrix(expression_path)

        pseudotime_info = None
        if pseudotime and pseudotime_path is not None:
            save_upload_file(pseudotime, pseudotime_path)
            pseudotime_info = parse_pseudotime(
                pseudotime_path, expression_info["cell_count"]
            )

        metadata = {
            "temp_upload_id": temp_upload_id,
            "expression_path": str(expression_path),
            "pseudotime_path": str(pseudotime_path) if pseudotime_path else None,
            "expression_filename": expression_matrix.filename,
            "pseudotime_filename": pseudotime.filename if pseudotime else None,
            "gene_count": expression_info["gene_count"],
            "cell_count": expression_info["cell_count"],
            "gene_names": expression_info["gene_names"],
            "cell_names": expression_info["cell_names"],
            "has_pseudotime": pseudotime is not None,
            "pseudotime_count": (
                pseudotime_info["pseudotime_count"] if pseudotime_info else None
            ),
        }
        save_json(temp_metadata_path(temp_upload_id), metadata)

        return TempUploadResponse(
            ok=True,
            temp_upload_id=temp_upload_id,
            expression_filename=expression_matrix.filename,
            pseudotime_filename=pseudotime.filename if pseudotime else None,
            gene_count=expression_info["gene_count"],
            cell_count=expression_info["cell_count"],
            has_pseudotime=pseudotime is not None,
            errors=[],
        )
    except Exception as e:
        if expression_path.exists():
            expression_path.unlink()
        if pseudotime_path and pseudotime_path.exists():
            pseudotime_path.unlink()

        meta_path = temp_metadata_path(temp_upload_id)
        if meta_path.exists():
            meta_path.unlink()

        return TempUploadResponse(ok=False, errors=[str(e)])