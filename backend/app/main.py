from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .schemas import CreateProjectResponse, TempUploadResponse
from .storage import (
    create_temp_upload_id,
    move_temp_upload_to_project,
    save_json,
    temp_expression_path,
    temp_metadata_path,
    temp_pseudotime_path,
)
from .validators import (
    MAX_FILE_SIZE_BYTES,
    parse_expression_matrix,
    parse_pseudotime,
    validate_csv_extension,
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def save_upload_file(upload: UploadFile, destination: Path) -> int:
    size = 0
    with destination.open("wb") as f:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE_SIZE_BYTES:
                raise ValueError("File size must be 500 MB or smaller.")
            f.write(chunk)
    await upload.close()
    return size


@app.post("/api/uploads/temp-dataset", response_model=TempUploadResponse)
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
    expression_path = temp_expression_path(temp_upload_id, expression_matrix.filename or "expression.csv")

    pseudotime_path: Path | None = None
    if pseudotime:
        pseudotime_path = temp_pseudotime_path(temp_upload_id, pseudotime.filename or "pseudotime.csv")

    try:
        await save_upload_file(expression_matrix, expression_path)
        expression_info = parse_expression_matrix(expression_path)

        pseudotime_info = None
        if pseudotime and pseudotime_path is not None:
            await save_upload_file(pseudotime, pseudotime_path)
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
            "pseudotime_count": pseudotime_info["pseudotime_count"] if pseudotime_info else None,
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


@app.post("/api/projects/create-from-temp", response_model=CreateProjectResponse)
async def create_project_from_temp(
    temp_upload_id: str = Form(...),
    project_name: str = Form(...),
    project_description: str = Form(""),
    top_variable_genes: str = Form(...),
    include_all_tfs: str = Form(...),
    normalize_enabled: str = Form(...),
    log_transform_enabled: str = Form(...),
    selected_algorithms: str = Form(...),
    ensemble_enabled: str = Form(...),
):
    meta_path = temp_metadata_path(temp_upload_id)
    if not meta_path.exists():
        return CreateProjectResponse(
            ok=False,
            errors=["Temporary upload not found or expired."],
        )

    project_id = uuid.uuid4().hex[:12]

    try:
        move_result = move_temp_upload_to_project(temp_upload_id, project_id)

        project_dir = Path(move_result["project_dir"])
        project_manifest = {
            "project_id": project_id,
            "project_name": project_name,
            "project_description": project_description,
            "top_variable_genes": top_variable_genes,
            "include_all_tfs": include_all_tfs,
            "normalize_enabled": normalize_enabled,
            "log_transform_enabled": log_transform_enabled,
            "selected_algorithms": selected_algorithms,
            "ensemble_enabled": ensemble_enabled,
            "expression_path": move_result["expression_path"],
            "pseudotime_path": move_result.get("pseudotime_path"),
        }
        (project_dir / "project.json").write_text(
            __import__("json").dumps(project_manifest, indent=2),
            encoding="utf-8",
        )

        return CreateProjectResponse(ok=True, project_id=project_id, errors=[])
    except Exception as e:
        return CreateProjectResponse(ok=False, errors=[str(e)])