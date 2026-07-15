from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..config import PROJECTS_ROOT
from .client_identity import get_or_create_client_id, require_project_owner
from ..services.demo_service import is_demo_project
from ..services.perturbation_service import (
    create_perturbation_run,
    get_gene_expression_profile,
    get_perturbation_result,
    get_perturbation_state,
    launch_perturbation_thread,
    perturbation_download_path,
)
from ..services.worker_queue import enqueue_perturbation_run, queue_enabled


router = APIRouter()


class PerturbationRunRequest(BaseModel):
    gene: str = Field(min_length=1, max_length=128)
    perturbation_value: float = Field(default=0.0, ge=0)
    n_propagation: int = Field(default=3, ge=1, le=5)
    clip_delta_x: bool = False


@router.get("/api/projects/{project_id}/perturbations")
async def get_project_perturbations(
    project_id: str,
    request: Request,
    response: Response,
):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        return {
            "ok": True,
            "project_id": project_id,
            "perturbations": {
                "available": False,
                "reason": "Perturbation runs are disabled for the read-only demo project.",
                "eligible_genes": [],
                "runs": [],
                "latest_result": None,
            },
        }

    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)
    try:
        return {
            "ok": True,
            "project_id": project_id,
            "perturbations": get_perturbation_state(project_dir),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/projects/{project_id}/perturbations/expression-profile/{gene}")
async def get_project_perturbation_expression_profile(
    project_id: str,
    gene: str,
    request: Request,
    response: Response,
):
    owner_id = get_or_create_client_id(request, response)
    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)
    try:
        return {
            "ok": True,
            "project_id": project_id,
            "profile": get_gene_expression_profile(project_dir, gene),
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/projects/{project_id}/perturbations/{run_id}")
async def get_project_perturbation_result(
    project_id: str,
    run_id: str,
    request: Request,
    response: Response,
):
    owner_id = get_or_create_client_id(request, response)
    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)
    try:
        return {
            "ok": True,
            "project_id": project_id,
            "result": get_perturbation_result(project_dir, run_id),
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/api/projects/{project_id}/perturbations", status_code=202)
async def start_project_perturbation(
    project_id: str,
    payload: PerturbationRunRequest,
    request: Request,
    response: Response,
):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        raise HTTPException(status_code=403, detail="The demo project is read-only.")

    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)
    try:
        status = create_perturbation_run(
            project_dir,
            gene=payload.gene,
            perturbation_value=payload.perturbation_value,
            n_propagation=payload.n_propagation,
            clip_delta_x=payload.clip_delta_x,
        )
        if queue_enabled():
            enqueue_perturbation_run(project_id, str(status["run_id"]))
        else:
            launch_perturbation_thread(project_id, str(status["run_id"]))
        return {
            "ok": True,
            "project_id": project_id,
            "run": status,
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/api/projects/{project_id}/perturbations/{run_id}/downloads/{filename}"
)
async def download_perturbation_result(
    project_id: str,
    run_id: str,
    filename: str,
    request: Request,
    response: Response,
):
    owner_id = get_or_create_client_id(request, response)
    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)
    try:
        path = perturbation_download_path(project_dir, run_id, filename)
        return FileResponse(path, filename=filename, media_type="text/csv")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
