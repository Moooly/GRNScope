from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, Request, Response

from ..config import PROJECTS_ROOT
from .client_identity import (
    get_or_create_client_id,
    project_belongs_to_client,
    require_project_owner,
)
from ..repositories.job_repository import read_jobs_manifest, write_jobs_manifest
from ..repositories.project_repository import (
    list_project_directories,
    read_project_manifest,
)
from ..storage import move_temp_upload_to_project, temp_metadata_path
from ..schemas import (
    CreateProjectFromTempRequest,
    CreateProjectFromTempResponse,
    CreateProjectResponse,
)
from ..services.job_service import launch_independent_algorithm_tasks
from ..services.demo_service import get_demo_project, is_demo_project, load_demo_manifest

router = APIRouter()


def load_known_tf_gene_names() -> list[str]:
    candidate_paths = [
        PROJECTS_ROOT.parent / "data" / "known_tf_gene_names.txt",
        PROJECTS_ROOT.parent / "reference" / "known_tf_gene_names.txt",
        PROJECTS_ROOT.parent / "data" / "human_tf_gene_names.txt",
        PROJECTS_ROOT.parent / "reference" / "human_tf_gene_names.txt",
    ]

    for path in candidate_paths:
        if path.exists() and path.is_file():
            return [
                line.strip()
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]

    return []


@router.post("/api/projects/create-from-temp", response_model=CreateProjectResponse)
async def create_project_from_temp(
    background_tasks: BackgroundTasks,
    request: Request,
    response: Response,
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
    owner_id = get_or_create_client_id(request, response)
    meta_path = temp_metadata_path(temp_upload_id)
    if not meta_path.exists():
        return CreateProjectResponse(
            ok=False,
            errors=["Temporary upload not found or expired."],
        )

    project_id = uuid.uuid4().hex[:12]
    job_id = uuid.uuid4().hex[:12]

    try:
        move_result = move_temp_upload_to_project(temp_upload_id, project_id)

        project_dir = Path(move_result["project_dir"])
        selected_algorithms_list = json.loads(selected_algorithms)

        upload_metadata_path = project_dir / "upload_metadata.json"
        upload_metadata = {}
        if upload_metadata_path.exists():
            upload_metadata = json.loads(
                upload_metadata_path.read_text(encoding="utf-8")
            )
        known_tf_gene_names = load_known_tf_gene_names()

        job_manifest = {
            "job_id": job_id,
            "project_id": project_id,
            "overall_status": "Queued",
            "ensemble_enabled": ensemble_enabled,
            "tasks": [
                {
                    "algorithm_id": algorithm_id,
                    "status": "Queued",
                    "elapsed_seconds": 0,
                    "error_message": None,
                    "result_path": None,
                    "completed_at": None,
                    "progress_percent": 0,
                    "progress_label": "Queued",
                }
                for algorithm_id in selected_algorithms_list
            ],
        }

        project_manifest = {
            "project_id": project_id,
            "owner_id": owner_id,
            "project_name": project_name,
            "project_description": project_description,
            "created_at": time.time(),
            "created_at_display": time.strftime("%Y-%m-%d %H:%M", time.localtime()),
            "top_variable_genes": top_variable_genes,
            "include_all_tfs": include_all_tfs,
            "normalize_enabled": normalize_enabled,
            "log_transform_enabled": log_transform_enabled,
            "selected_algorithms": selected_algorithms_list,
            "ensemble_enabled": ensemble_enabled,
            "expression_path": move_result["expression_path"],
            "pseudotime_path": move_result.get("pseudotime_path"),
            "latest_job_id": job_id,
        }

        metadata_manifest = {
            "project_id": project_id,
            "owner_id": owner_id,
            "project_name": project_name,
            "project_description": project_description,
            "expression_filename": upload_metadata.get("expression_filename"),
            "pseudotime_filename": upload_metadata.get("pseudotime_filename"),
            "gene_count": upload_metadata.get("gene_count"),
            "cell_count": upload_metadata.get("cell_count"),
            "gene_names": upload_metadata.get("gene_names", []),
            "cell_names": upload_metadata.get("cell_names", []),
            "known_tf_gene_names": known_tf_gene_names,
            "has_pseudotime": upload_metadata.get("has_pseudotime"),
            "pseudotime_count": upload_metadata.get("pseudotime_count"),
            "preprocessing": {
                "top_variable_genes": top_variable_genes,
                "include_all_tfs": include_all_tfs,
                "normalize_enabled": normalize_enabled,
                "log_transform_enabled": log_transform_enabled,
            },
            "selected_algorithms": selected_algorithms_list,
            "results_directory": str(project_dir / "results"),
            "ensemble_enabled": ensemble_enabled,
            "job": {
                "job_id": job_id,
                "overall_status": "Queued",
            },
        }

        (project_dir / "project.json").write_text(
            json.dumps(project_manifest, indent=2),
            encoding="utf-8",
        )
        (project_dir / "metadata.json").write_text(
            json.dumps(metadata_manifest, indent=2),
            encoding="utf-8",
        )
        (project_dir / "jobs.json").write_text(
            json.dumps([job_manifest], indent=2),
            encoding="utf-8",
        )

        if upload_metadata_path.exists():
            upload_metadata_path.unlink()

        background_tasks.add_task(
            launch_independent_algorithm_tasks,
            project_id,
            job_id,
            selected_algorithms_list,
        )

        return CreateProjectResponse(
            ok=True,
            project_id=project_id,
            job_id=job_id,
            errors=[],
        )
    except Exception as e:
        return CreateProjectResponse(ok=False, errors=[str(e)])


# --- Job monitoring endpoints ---

@router.get("/api/projects")
async def list_projects(request: Request, response: Response):
    owner_id = get_or_create_client_id(request, response)
    try:
        project_items = []
        try:
            demo_project = get_demo_project()
            project_items.append(
                {
                    "id": demo_project["id"],
                    "name": demo_project["name"],
                    "description": demo_project["description"],
                    "createdAt": "Demo",
                    "datasetCount": demo_project.get("dataset_count", 1),
                    "jobCount": demo_project.get("job_count", 1),
                    "latestJob": {
                        "job_id": "demo",
                        "project_id": "demo",
                        "overall_status": "Completed",
                        "tasks": [
                            {
                                "algorithm_id": algorithm_id,
                                "status": "Completed",
                                "elapsed_seconds": 0,
                                "error_message": None,
                                "result_path": None,
                                "completed_at": "demo",
                                "progress_percent": 100,
                                "progress_label": "Completed",
                            }
                            for algorithm_id in demo_project.get("algorithms", [])
                        ],
                    },
                    "isDemo": True,
                    "readOnly": True,
                    "created_at_sort": float("inf"),
                }
            )
        except Exception:
            pass

        for project_dir in list_project_directories():
            try:
                project_manifest = read_project_manifest(project_dir)
                if not project_belongs_to_client(project_dir, owner_id):
                    continue
                jobs_manifest = read_jobs_manifest(project_dir)
                latest_job = jobs_manifest[-1] if jobs_manifest else None

                created_at = project_manifest.get("created_at")
                if not created_at:
                    try:
                        created_at = project_dir.stat().st_mtime
                    except Exception:
                        created_at = 0

                project_items.append(
                    {
                        "id": project_manifest.get("project_id", project_dir.name),
                        "name": project_manifest.get("project_name", project_dir.name),
                        "description": project_manifest.get(
                            "project_description",
                            "Single-cell RNA-seq dataset for GRN inference.",
                        ),
                        "createdAt": project_manifest.get(
                            "created_at_display", "Unknown"
                        ),
                        "datasetCount": 1,
                        "jobCount": len(jobs_manifest) if jobs_manifest else 0,
                        "latestJob": latest_job,
                        "created_at_sort": created_at,
                    }
                )
            except Exception:
                continue

        project_items.sort(
            key=lambda item: item.get("created_at_sort", 0), reverse=True
        )

        for item in project_items:
            item.pop("created_at_sort", None)

        return {
            "ok": True,
            "projects": project_items,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/projects/{project_id}")
async def get_project(project_id: str, request: Request, response: Response):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        demo_project = get_demo_project()
        return {
            "ok": True,
            "project": {
                "project_id": demo_project["id"],
                "project_name": demo_project["name"],
                "project_description": demo_project["description"],
                "created_at": "demo",
                "created_at_display": "Demo",
                "selected_algorithms": demo_project.get("algorithms", []),
                "ensemble_enabled": True,
                "latest_job_id": "demo",
                "is_demo": True,
                "read_only": True,
            },
            "latest_job": {
                "job_id": "demo",
                "project_id": "demo",
                "overall_status": "Completed",
                "ensemble_enabled": True,
                "tasks": [
                    {
                        "algorithm_id": algorithm_id,
                        "status": "Completed",
                        "elapsed_seconds": 0,
                        "error_message": None,
                        "result_path": None,
                        "completed_at": "demo",
                        "progress_percent": 100,
                        "progress_label": "Completed",
                    }
                    for algorithm_id in demo_project.get("algorithms", [])
                ],
            },
        }
    project_dir = PROJECTS_ROOT / project_id

    require_project_owner(project_dir, owner_id)

    try:
        project_manifest = read_project_manifest(project_dir)
        jobs_manifest = read_jobs_manifest(project_dir)

        latest_job = jobs_manifest[-1] if jobs_manifest else None

        return {
            "ok": True,
            "project": project_manifest,
            "latest_job": latest_job,
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/projects/{project_id}/metadata")
async def get_project_metadata(project_id: str, request: Request, response: Response):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        manifest = load_demo_manifest()
        dataset = manifest.get("dataset", {})
        return {
            "ok": True,
            "project_id": "demo",
            "metadata": {
                "project_id": "demo",
                "project_name": manifest.get("name", "Demo Project"),
                "project_description": manifest.get("description", ""),
                "expression_filename": dataset.get("expression_file", "ExpressionData.csv"),
                "pseudotime_filename": dataset.get("pseudotime_file", "PseudoTime.csv"),
                "gene_count": dataset.get("gene_count"),
                "cell_count": dataset.get("cell_count"),
                "gene_names": [],
                "cell_names": [],
                "known_tf_gene_names": load_known_tf_gene_names(),
                "has_pseudotime": dataset.get("has_pseudotime", True),
                "has_ground_truth": dataset.get("has_ground_truth", False),
                "preprocessing": {
                    "top_variable_genes": "All genes retained",
                    "include_all_tfs": True,
                    "normalize_enabled": True,
                    "log_transform_enabled": True,
                },
                "selected_algorithms": manifest.get("algorithms", []),
                "ensemble_enabled": True,
                "is_demo": True,
                "read_only": True,
                "input_files": manifest.get("inputs", []),
                "job": {
                    "job_id": "demo",
                    "overall_status": "Completed",
                },
            },
        }
    project_dir = PROJECTS_ROOT / project_id

    require_project_owner(project_dir, owner_id)

    metadata_path = project_dir / "metadata.json"
    if not metadata_path.exists():
        raise HTTPException(status_code=404, detail="Metadata not found.")

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        return {
            "ok": True,
            "project_id": project_id,
            "metadata": metadata,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    
@router.delete("/api/projects/{project_id}")
async def delete_project(project_id: str, request: Request, response: Response):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        raise HTTPException(status_code=403, detail="Demo project is read-only.")
    project_dir = PROJECTS_ROOT / project_id

    require_project_owner(project_dir, owner_id)

    try:
        shutil.rmtree(project_dir)
        return {
            "ok": True,
            "project_id": project_id,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
