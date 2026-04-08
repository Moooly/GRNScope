from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..config import PROJECTS_ROOT
from ..repositories.job_repository import read_jobs_manifest

router = APIRouter()

@router.get("/api/projects/{project_id}/jobs")
async def get_project_jobs(project_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        jobs_manifest = read_jobs_manifest(project_dir)
        return {
            "ok": True,
            "project_id": project_id,
            "jobs": jobs_manifest,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc