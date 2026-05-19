from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response

from ..config import PROJECTS_ROOT
from .client_identity import get_or_create_client_id, require_project_owner
from ..repositories.job_repository import read_jobs_manifest
from ..services.job_service import rerun_algorithm_task, stop_algorithm_task

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


@router.post("/api/projects/{project_id}/jobs/{job_id}/tasks/{algorithm_id}/stop")
async def stop_project_algorithm(
    project_id: str,
    job_id: str,
    algorithm_id: str,
    request: Request,
    response: Response,
):
    owner_id = get_or_create_client_id(request, response)
    project_dir = PROJECTS_ROOT / project_id

    require_project_owner(project_dir, owner_id)

    try:
        task = stop_algorithm_task(project_id, job_id, algorithm_id)
        jobs_manifest = read_jobs_manifest(project_dir)
        latest_job = jobs_manifest[-1] if jobs_manifest else None
        return {
            "ok": True,
            "project_id": project_id,
            "job_id": job_id,
            "algorithm_id": algorithm_id,
            "task": task,
            "latest_job": latest_job,
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/api/projects/{project_id}/jobs/{job_id}/tasks/{algorithm_id}/rerun")
async def rerun_project_algorithm(
    project_id: str,
    job_id: str,
    algorithm_id: str,
    request: Request,
    response: Response,
):
    owner_id = get_or_create_client_id(request, response)
    project_dir = PROJECTS_ROOT / project_id

    require_project_owner(project_dir, owner_id)

    try:
        task = rerun_algorithm_task(project_id, job_id, algorithm_id)
        jobs_manifest = read_jobs_manifest(project_dir)
        latest_job = jobs_manifest[-1] if jobs_manifest else None
        return {
            "ok": True,
            "project_id": project_id,
            "job_id": job_id,
            "algorithm_id": algorithm_id,
            "task": task,
            "latest_job": latest_job,
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
