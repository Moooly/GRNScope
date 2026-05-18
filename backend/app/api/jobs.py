from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response

from ..config import PROJECTS_ROOT
from .client_identity import get_or_create_client_id, require_project_owner
from ..repositories.job_repository import read_jobs_manifest

router = APIRouter()

@router.get("/api/projects/{project_id}/jobs")
async def get_project_jobs(project_id: str, request: Request, response: Response):
    owner_id = get_or_create_client_id(request, response)
    project_dir = PROJECTS_ROOT / project_id

    require_project_owner(project_dir, owner_id)

    try:
        jobs_manifest = read_jobs_manifest(project_dir)
        return {
            "ok": True,
            "project_id": project_id,
            "jobs": jobs_manifest,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
