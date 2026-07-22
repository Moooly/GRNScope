from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from ..config import PROJECTS_ROOT
from .client_identity import get_or_create_client_id, require_project_owner
from ..services.demo_service import is_demo_project
from ..services.pseudotime_service import (
    PseudotimeEstimationError,
    get_pseudotime_estimation_state,
    start_pseudotime_estimation,
    stop_pseudotime_estimation,
)

router = APIRouter()


class EstimatePseudotimeRequest(BaseModel):
    start_cluster: str | None = None


@router.get("/api/projects/{project_id}/pseudotime/status")
async def pseudotime_status(project_id: str, request: Request, response: Response):
    owner_id = get_or_create_client_id(request, response)
    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)

    return {
        "ok": True,
        "project_id": project_id,
        "estimation": get_pseudotime_estimation_state(project_dir),
    }


@router.post("/api/projects/{project_id}/pseudotime/estimate")
async def estimate_pseudotime(
    project_id: str,
    payload: EstimatePseudotimeRequest,
    request: Request,
    response: Response,
):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        raise HTTPException(status_code=403, detail="Demo project is read-only.")
    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)

    try:
        estimation = start_pseudotime_estimation(project_id, payload.start_cluster)
        return {"ok": True, "project_id": project_id, "estimation": estimation}
    except PseudotimeEstimationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/api/projects/{project_id}/pseudotime/stop")
async def stop_pseudotime(project_id: str, request: Request, response: Response):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        raise HTTPException(status_code=403, detail="Demo project is read-only.")
    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)

    try:
        estimation = stop_pseudotime_estimation(project_id)
        return {"ok": True, "project_id": project_id, "estimation": estimation}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
