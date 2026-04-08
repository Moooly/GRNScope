from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..config import PROJECTS_ROOT
from ..repositories.job_repository import read_jobs_manifest
from ..services.result_service import read_algorithm_result

router = APIRouter()

@router.get("/api/projects/{project_id}/results")
async def get_project_results(project_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        jobs_manifest = read_jobs_manifest(project_dir)
        latest_job = jobs_manifest[-1] if jobs_manifest else None

        if not latest_job:
            return {
                "ok": True,
                "project_id": project_id,
                "results": [],
            }

        results = []
        for task in latest_job.get("tasks", []):
            results.append(
                {
                    "algorithm_id": task.get("algorithm_id"),
                    "status": task.get("status"),
                    "result_path": task.get("result_path"),
                    "completed_at": task.get("completed_at"),
                    "elapsed_seconds": task.get("elapsed_seconds"),
                    "progress_percent": task.get("progress_percent"),
                    "progress_label": task.get("progress_label"),
                }
            )

        return {
            "ok": True,
            "project_id": project_id,
            "job_id": latest_job.get("job_id"),
            "results": results,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/projects/{project_id}/results/{algorithm_id}")
async def get_algorithm_result(project_id: str, algorithm_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        result = read_algorithm_result(project_dir, algorithm_id)
        return {
            "ok": True,
            "project_id": project_id,
            "algorithm_id": algorithm_id,
            "result": result,
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc