from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..config import PROJECTS_ROOT

router = APIRouter()


@router.get("/api/projects/{project_id}/download/expression")
async def download_expression_file(project_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    metadata_path = project_dir / "metadata.json"
    project_manifest_path = project_dir / "project.json"

    if not metadata_path.exists() or not project_manifest_path.exists():
        raise HTTPException(status_code=404, detail="Project metadata not found.")

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        project_manifest = json.loads(project_manifest_path.read_text(encoding="utf-8"))

        expression_path = project_manifest.get("expression_path")
        expression_filename = metadata.get("expression_filename") or "dataset.csv"

        if not expression_path:
            raise HTTPException(status_code=404, detail="Expression file path not found.")

        file_path = Path(expression_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Expression file not found.")

        return FileResponse(
            path=file_path,
            filename=expression_filename,
            media_type="text/csv",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/projects/{project_id}/download/pseudotime")
async def download_pseudotime_file(project_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    metadata_path = project_dir / "metadata.json"
    project_manifest_path = project_dir / "project.json"

    if not metadata_path.exists() or not project_manifest_path.exists():
        raise HTTPException(status_code=404, detail="Project metadata not found.")

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        project_manifest = json.loads(project_manifest_path.read_text(encoding="utf-8"))

        pseudotime_path = project_manifest.get("pseudotime_path")
        pseudotime_filename = metadata.get("pseudotime_filename") or "pseudotime.csv"

        if not pseudotime_path:
            raise HTTPException(status_code=404, detail="Pseudotime file path not found.")

        file_path = Path(pseudotime_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Pseudotime file not found.")

        return FileResponse(
            path=file_path,
            filename=pseudotime_filename,
            media_type="text/csv",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc