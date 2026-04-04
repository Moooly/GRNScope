from __future__ import annotations

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import json

from app.schemas import UploadSuccessResponse, UploadErrorResponse
from app.utils import (
    MAX_FILE_SIZE,
    generate_project_id,
    save_upload_file,
    validate_csv_extension,
    validate_expression_matrix_csv,
    validate_pseudotime_csv,
    ensure_directory,
)

app = FastAPI(title="GRNScope Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_ROOT = Path("data/uploads")
ensure_directory(UPLOAD_ROOT)


@app.get("/")
def root():
    return {"ok": True, "message": "GRNScope backend is running."}


@app.post("/api/projects/create-with-dataset")
async def create_project_with_dataset(
    project_name: str = Form(...),
    project_description: str = Form(""),
    expression_matrix: UploadFile = File(...),
    pseudotime: UploadFile | None = File(None),
):
    errors: list[str] = []

    # Basic project validation
    if not project_name.strip():
        errors.append("Project name is required.")

    # File presence / extension checks
    if not expression_matrix.filename:
        errors.append("Expression matrix file is required.")
    elif not validate_csv_extension(expression_matrix.filename):
        errors.append("Expression matrix must be a CSV file.")

    if pseudotime and pseudotime.filename and not validate_csv_extension(pseudotime.filename):
        errors.append("Pseudotime file must be a CSV file.")

    if errors:
        return {"ok": False, "errors": errors}

    project_id = generate_project_id()
    project_dir = UPLOAD_ROOT / project_id
    ensure_directory(project_dir)

    expression_path = project_dir / "expression.csv"
    expression_size = save_upload_file(expression_matrix, expression_path)

    if expression_size > MAX_FILE_SIZE:
        expression_path.unlink(missing_ok=True)
        return {
            "ok": False,
            "errors": ["Expression matrix exceeds the 500 MB size limit."],
        }

    expression_errors, metadata = validate_expression_matrix_csv(expression_path)
    errors.extend(expression_errors)

    pseudotime_path = None
    if pseudotime and pseudotime.filename:
        pseudotime_path = project_dir / "pseudotime.csv"
        pseudotime_size = save_upload_file(pseudotime, pseudotime_path)

        if pseudotime_size > MAX_FILE_SIZE:
            errors.append("Pseudotime file exceeds the 500 MB size limit.")
        else:
            errors.extend(
                validate_pseudotime_csv(
                    pseudotime_path,
                    expected_cell_count=metadata.get("cell_count", 0),
                )
            )

    if errors:
        # remove invalid saved files
        expression_path.unlink(missing_ok=True)
        if pseudotime_path:
            pseudotime_path.unlink(missing_ok=True)
        return {"ok": False, "errors": errors}

    # save metadata JSON for now
    metadata_path = project_dir / "metadata.json"
    metadata_json = {
        "project_id": project_id,
        "project_name": project_name,
        "project_description": project_description,
        "expression_filename": expression_matrix.filename,
        "pseudotime_filename": pseudotime.filename if pseudotime and pseudotime.filename else None,
        "gene_count": metadata["gene_count"],
        "cell_count": metadata["cell_count"],
        "gene_names": metadata["gene_names"],
    }
    metadata_path.write_text(json.dumps(metadata_json, indent=2), encoding="utf-8")

    return {
        "ok": True,
        "project_id": project_id,
        "project_name": project_name,
        "description": project_description or None,
        "dataset": {
            "gene_count": metadata["gene_count"],
            "cell_count": metadata["cell_count"],
            "has_pseudotime": pseudotime_path is not None,
            "expression_filename": expression_matrix.filename,
            "pseudotime_filename": pseudotime.filename if pseudotime and pseudotime.filename else None,
        },
    }


@app.get("/api/projects/{project_id}/algorithms")
def get_algorithm_page_info(project_id: str):
    return {
        "ok": True,
        "project_id": project_id,
        "message": "Ready for algorithm selection.",
    }