"""Project list, detail, metadata, and validation-report read routes."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from ..api_contracts import (
    ProjectDetailResponse,
    ProjectListResponse,
    ProjectMetadataResponse,
)
from ..config import PROJECTS_ROOT
from ..preprocessing_contract import PREPROCESSING_SCHEMA_VERSION
from ..repositories.job_repository import read_jobs_manifest
from ..repositories.project_repository import (
    list_project_directories,
    read_project_manifest,
)
from ..services.demo_service import get_demo_project, is_demo_project, load_demo_manifest
from ..services.project_read_support import (
    backfill_dataset_dimensions,
    load_known_tf_gene_names,
    migrate_legacy_matrix_validation_failure,
)
from ..services.pseudotime_service import get_pseudotime_estimation_state
from .client_identity import (
    get_or_create_client_id,
    project_belongs_to_client,
    require_project_owner,
)

router = APIRouter()


@router.get(
    "/api/projects",
    response_model=ProjectListResponse,
    response_model_exclude_unset=True,
)
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
                                "error_type": None,
                                "result_path": None,
                                "started_at": None,
                                "started_at_timestamp": None,
                                "completed_at": "demo",
                                "completed_at_timestamp": None,
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
                jobs_manifest = migrate_legacy_matrix_validation_failure(
                    project_dir,
                    read_jobs_manifest(project_dir),
                )
                latest_job = jobs_manifest[-1] if jobs_manifest else None
                metadata_manifest = {}
                metadata_path = project_dir / "metadata.json"
                if metadata_path.exists():
                    try:
                        metadata_manifest = json.loads(
                            metadata_path.read_text(encoding="utf-8")
                        )
                    except Exception:
                        metadata_manifest = {}
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
                        "createdAtTimestamp": created_at,
                        "datasetCount": 1,
                        "geneCount": metadata_manifest.get("gene_count"),
                        "cellCount": metadata_manifest.get("cell_count"),
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


@router.get(
    "/api/projects/{project_id}",
    response_model=ProjectDetailResponse,
    response_model_exclude_unset=True,
)
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
                        "error_type": None,
                        "result_path": None,
                        "started_at": None,
                        "started_at_timestamp": None,
                        "completed_at": "demo",
                        "completed_at_timestamp": None,
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
        metadata_manifest = {}
        metadata_path = project_dir / "metadata.json"
        if metadata_path.exists():
            try:
                metadata_manifest = json.loads(metadata_path.read_text(encoding="utf-8"))
            except Exception:
                metadata_manifest = {}
        project_manifest, _metadata_manifest = backfill_dataset_dimensions(
            project_dir,
            project_manifest,
            metadata_manifest,
        )
        jobs_manifest = migrate_legacy_matrix_validation_failure(
            project_dir,
            read_jobs_manifest(project_dir),
        )

        latest_job = jobs_manifest[-1] if jobs_manifest else None

        return {
            "ok": True,
            "project": project_manifest,
            "latest_job": latest_job,
            "pseudotime_estimation": get_pseudotime_estimation_state(project_dir),
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/projects/{project_id}/validation-report")
async def download_project_validation_report(
    project_id: str,
    request: Request,
    response: Response,
):
    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, get_or_create_client_id(request, response))
    report_path = project_dir / "matrix_validation_issues.csv"
    if not report_path.exists():
        raise HTTPException(status_code=404, detail="Validation report is not available.")
    return FileResponse(
        report_path,
        media_type="text/csv",
        filename=f"{project_id}-matrix-validation-issues.csv",
    )


@router.get(
    "/api/projects/{project_id}/metadata",
    response_model=ProjectMetadataResponse,
    response_model_exclude_unset=True,
)
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
                "known_tf_gene_names": load_known_tf_gene_names("human"),
                "has_pseudotime": dataset.get("has_pseudotime", True),
                "has_ground_truth": dataset.get("has_ground_truth", False),
                "preprocessing": {
                    "schema_version": PREPROCESSING_SCHEMA_VERSION,
                    "matrix_state": "log_normalized",
                    "dataset_species": "human",
                    "enabled_stages": [],
                    "detection": {
                        "enabled": False,
                        "minimum_cell_percent": 10,
                    },
                    "trajectory": {
                        "enabled": False,
                        "gene_ordering_source": "calculate",
                        "gene_ordering_filename": None,
                        "p_value_threshold": 0.01,
                        "bonferroni_correction": True,
                        "retain_significant_tfs": True,
                    },
                    "variance": {
                        "enabled": False,
                        "gene_count": 500,
                        "include_known_tfs": True,
                    },
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
        try:
            project_manifest = read_project_manifest(project_dir)
            _project_manifest, metadata = backfill_dataset_dimensions(
                project_dir,
                project_manifest,
                metadata,
            )
        except Exception:
            pass
        return {
            "ok": True,
            "project_id": project_id,
            "metadata": metadata,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
