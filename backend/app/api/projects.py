from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import FileResponse

from ..algorithm_registry import (
    CELLORACLE_BASE_GRN_OPTIONS,
    CELLORACLE_SPECIES_OPTIONS,
    resolve_selected_algorithm_parameters,
    sort_algorithm_ids_by_difficulty,
    validate_selected_algorithm_parameters,
)
from ..atomic_io import atomic_write_json
from ..config import JOB_FILE_LOCK, PROJECTS_ROOT
from .client_identity import (
    get_or_create_client_id,
    project_belongs_to_client,
    require_project_owner,
)
from ..repositories.job_repository import (
    jobs_manifest_lock,
    read_jobs_manifest,
    write_jobs_manifest,
)
from ..repositories.project_repository import (
    list_project_directories,
    read_project_manifest,
    write_project_manifest,
)
from ..storage import move_temp_upload_to_project, temp_metadata_path
from ..storage import save_upload_file
from ..schemas import (
    CreateProjectFromTempRequest,
    CreateProjectFromTempResponse,
    CreateProjectResponse,
    UpdateNotificationEmailRequest,
    UpdateProjectNameRequest,
)
from ..validators import validate_csv_extension
from ..services.beeline_service import (
    collect_expression_matrix_issues,
    count_expression_gene_rows,
    read_delimited_header,
    summarize_expression_matrix_issues,
)
from ..services.email_service import normalize_notification_email
from ..services.job_service import (
    finalize_project_stop,
    launch_independent_algorithm_tasks,
    mark_project_setup_failure,
    request_project_stop,
    send_job_completion_notification_if_needed,
    stop_and_delete_project,
    update_job_state,
)
from ..services.worker_queue import enqueue_algorithm_job, queue_enabled
from ..services.pseudotime_service import get_pseudotime_estimation_state
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


def backfill_dataset_dimensions(
    project_dir: Path,
    project_manifest: dict,
    metadata_manifest: dict,
) -> tuple[dict, dict]:
    if metadata_manifest.get("gene_count") and metadata_manifest.get("cell_count"):
        return project_manifest, metadata_manifest

    expression_path = project_manifest.get("expression_path")
    if not expression_path:
        return project_manifest, metadata_manifest

    source_expression = Path(str(expression_path))
    if not source_expression.exists():
        return project_manifest, metadata_manifest

    try:
        header, _dialect = read_delimited_header(source_expression)
        gene_count = count_expression_gene_rows(source_expression)
        cell_count = max(0, len(header) - 1)
    except Exception:
        return project_manifest, metadata_manifest

    if gene_count <= 0 or cell_count <= 0:
        return project_manifest, metadata_manifest

    project_manifest["gene_count"] = gene_count
    project_manifest["cell_count"] = cell_count
    metadata_manifest["gene_count"] = gene_count
    metadata_manifest["cell_count"] = cell_count

    try:
        write_project_manifest(project_dir, project_manifest)
        atomic_write_json(project_dir / "metadata.json", metadata_manifest)
    except Exception:
        pass

    return project_manifest, metadata_manifest


def parse_selected_algorithms(selected_algorithms: str) -> list[str]:
    parsed = json.loads(selected_algorithms)
    if not isinstance(parsed, list):
        raise ValueError("Selected algorithms must be a list.")
    return sort_algorithm_ids_by_difficulty(
        [str(algorithm_id) for algorithm_id in parsed]
    )


def parse_algorithm_parameters(
    raw_algorithm_parameters: str,
    selected_algorithms_list: list[str],
) -> dict[str, dict]:
    """Parse and validate the per-algorithm parameter overrides form field.

    ``raw_algorithm_parameters`` is a JSON object string of the shape
    ``{"GENIE3": {"nEstimators": 500}, ...}``. Values are validated against the
    algorithm registry (known params, types, options, numeric bounds) and only
    kept for algorithms in ``selected_algorithms_list``. An empty or missing
    field yields ``{}``. Raises ValueError on malformed JSON or invalid values.
    """
    if not raw_algorithm_parameters or not raw_algorithm_parameters.strip():
        return {}
    try:
        parsed = json.loads(raw_algorithm_parameters)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid algorithm parameters: {exc}.") from exc
    return validate_selected_algorithm_parameters(
        selected_algorithms_list, parsed
    )


def normalize_celloracle_settings(
    celloracle_species: str,
    celloracle_base_grn: str,
) -> tuple[str, str]:
    normalized_species = (celloracle_species or "human").strip()
    normalized_base_grn = (celloracle_base_grn or "auto").strip()

    if normalized_species not in CELLORACLE_SPECIES_OPTIONS:
        raise ValueError(f"Unsupported CellOracle species: {normalized_species}.")
    if normalized_base_grn not in CELLORACLE_BASE_GRN_OPTIONS:
        raise ValueError(f"Unsupported CellOracle base GRN: {normalized_base_grn}.")
    if normalized_base_grn == "mouse_scATAC_atlas" and normalized_species != "mouse":
        raise ValueError("CellOracle mouse scATAC atlas base GRN is only available for mouse.")

    return normalized_species, normalized_base_grn


# Bounds for the project "Max edges per target" setting. The upper bound matches
# the frontend cap; the backend still clamps to the actual gene count at run time.
RANKED_EDGES_PER_TARGET_DEFAULT = 20
RANKED_EDGES_PER_TARGET_MAX = 100


def normalize_ranked_edges_per_target(raw: str) -> int:
    """Parse and bound the 'Max edges per target' form value to [1, 100]."""
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return RANKED_EDGES_PER_TARGET_DEFAULT
    return max(1, min(value, RANKED_EDGES_PER_TARGET_MAX))


def build_queued_task(algorithm_id: str, progress_label: str = "Queued") -> dict:
    return {
        "algorithm_id": algorithm_id,
        "status": "Queued",
        "elapsed_seconds": 0,
        "error_message": None,
        "error_type": None,
        "result_path": None,
        "started_at": None,
        "started_at_timestamp": None,
        "completed_at": None,
        "completed_at_timestamp": None,
        "progress_percent": 0,
        "progress_label": progress_label,
    }


def build_job_manifest(
    project_id: str,
    job_id: str,
    selected_algorithms_list: list[str],
    ensemble_enabled: str,
    overall_status: str = "Queued",
    progress_label: str = "Queued",
    algorithm_parameters: dict | None = None,
    resolved_algorithm_parameters: dict | None = None,
) -> dict:
    return {
        "job_id": job_id,
        "project_id": project_id,
        "overall_status": overall_status,
        "ensemble_enabled": ensemble_enabled,
        # Keep the compact overrides for display/backward compatibility and a
        # complete immutable snapshot for reproducible execution and reruns.
        "algorithm_parameters": algorithm_parameters or {},
        "algorithm_parameter_overrides": algorithm_parameters or {},
        "resolved_algorithm_parameters": resolved_algorithm_parameters or {},
        "tasks": [
            build_queued_task(algorithm_id, progress_label=progress_label)
            for algorithm_id in selected_algorithms_list
        ],
    }


def mark_upload_failure(project_dir: Path, job_id: str, message: str) -> None:
    mark_project_setup_failure(
        project_dir,
        job_id,
        message,
        error_type="upload",
    )


def migrate_legacy_matrix_validation_failure(
    project_dir: Path,
    jobs_manifest: list[dict],
) -> list[dict]:
    """Upgrade jobs created before matrix validation became a setup phase."""

    job = jobs_manifest[-1] if jobs_manifest else None
    if not isinstance(job, dict):
        return jobs_manifest

    try:
        project_manifest = read_project_manifest(project_dir)
        needs_structured_issues = (
            project_manifest.get("dataset_validation_status") == "failed"
            and (
                not project_manifest.get("dataset_validation_issues")
                or not (project_dir / "matrix_validation_issues.csv").exists()
            )
        )
        expression_path = project_manifest.get("expression_path")
        if needs_structured_issues and expression_path and Path(expression_path).exists():
            validation_issues = collect_expression_matrix_issues(
                Path(expression_path),
                report_path=project_dir / "matrix_validation_issues.csv",
            )
            if validation_issues:
                mark_project_setup_failure(
                    project_dir,
                    str(job.get("job_id") or ""),
                    summarize_expression_matrix_issues(validation_issues),
                    error_type="matrix_validation",
                    validation_issues=validation_issues,
                )
                return read_jobs_manifest(project_dir)
    except Exception:
        pass

    validation_task = next(
        (
            task
            for task in job.get("tasks", [])
            if isinstance(task, dict)
            and task.get("error_type") == "matrix_validation"
        ),
        None,
    )
    if validation_task is not None:
        mark_project_setup_failure(
            project_dir,
            str(job.get("job_id") or ""),
            str(
                validation_task.get("error_message")
                or "The uploaded expression matrix could not be validated."
            ),
            error_type="matrix_validation",
        )
        return read_jobs_manifest(project_dir)
    return jobs_manifest


@router.post("/api/projects/create-pending", response_model=CreateProjectResponse)
async def create_pending_project(
    request: Request,
    response: Response,
    project_name: str = Form(...),
    project_description: str = Form(""),
    top_variable_genes: str = Form(...),
    include_all_tfs: str = Form(...),
    normalize_enabled: str = Form(...),
    log_transform_enabled: str = Form(...),
    ranked_edges_per_target: str = Form("20"),
    selected_algorithms: str = Form(...),
    ensemble_enabled: str = Form(...),
    celloracle_species: str = Form("human"),
    celloracle_base_grn: str = Form("auto"),
    algorithm_parameters: str = Form("{}"),
    expression_filename: str = Form(""),
    pseudotime_filename: str = Form(""),
    cluster_labels_filename: str = Form(""),
    estimate_pseudotime: str = Form("false"),
):
    owner_id = get_or_create_client_id(request, response)
    project_id = uuid.uuid4().hex[:12]
    job_id = uuid.uuid4().hex[:12]

    try:
        selected_algorithms_list = parse_selected_algorithms(selected_algorithms)
        normalized_celloracle_species, normalized_celloracle_base_grn = (
            normalize_celloracle_settings(celloracle_species, celloracle_base_grn)
        )
        validated_algorithm_parameters = parse_algorithm_parameters(
            algorithm_parameters, selected_algorithms_list
        )
        resolved_algorithm_parameters = resolve_selected_algorithm_parameters(
            selected_algorithms_list, validated_algorithm_parameters
        )
    except Exception as exc:
        return CreateProjectResponse(ok=False, errors=[str(exc)])

    project_dir = PROJECTS_ROOT / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    known_tf_gene_names = load_known_tf_gene_names()

    job_manifest = build_job_manifest(
        project_id,
        job_id,
        selected_algorithms_list,
        ensemble_enabled,
        progress_label="Waiting for dataset upload",
        algorithm_parameters=validated_algorithm_parameters,
        resolved_algorithm_parameters=resolved_algorithm_parameters,
    )

    project_manifest = {
        "project_id": project_id,
        "owner_id": owner_id,
        "project_name": project_name,
        "project_description": project_description,
        "created_at": time.time(),
        "created_at_display": time.strftime("%Y-%m-%d %H:%M", time.localtime()),
        "notification_email": None,
        "top_variable_genes": top_variable_genes,
        "include_all_tfs": include_all_tfs,
        "normalize_enabled": normalize_enabled,
        "log_transform_enabled": log_transform_enabled,
        "ranked_edges_per_target_limit": normalize_ranked_edges_per_target(ranked_edges_per_target),
        "selected_algorithms": selected_algorithms_list,
        "algorithm_parameters": validated_algorithm_parameters,
        "resolved_algorithm_parameters": resolved_algorithm_parameters,
        "ensemble_enabled": ensemble_enabled,
        "expression_path": None,
        "pseudotime_path": None,
        "cluster_labels_path": None,
        "estimate_pseudotime": estimate_pseudotime,
        "preprocessed_expression_path": str(
            project_dir / "preprocessed" / "ExpressionData.csv"
        ),
        "upload_status": "waiting_for_upload",
        "celloracle": {
            "species": normalized_celloracle_species,
            "base_grn": normalized_celloracle_base_grn,
        },
        "latest_job_id": job_id,
    }

    metadata_manifest = {
        "project_id": project_id,
        "owner_id": owner_id,
        "project_name": project_name,
        "project_description": project_description,
        "expression_filename": expression_filename or None,
        "pseudotime_filename": pseudotime_filename or None,
        "cluster_labels_filename": cluster_labels_filename or None,
        "gene_count": None,
        "cell_count": None,
        "gene_names": [],
        "cell_names": [],
        "known_tf_gene_names": known_tf_gene_names,
        "has_pseudotime": bool(pseudotime_filename),
        "pseudotime_count": None,
        "has_cluster_labels": bool(cluster_labels_filename),
        "cluster_label_count": None,
        "cluster_count": None,
        "cluster_names": [],
        "cluster_cell_counts": {},
        "preprocessing": {
            "top_variable_genes": top_variable_genes,
            "include_all_tfs": include_all_tfs,
            "normalize_enabled": normalize_enabled,
            "log_transform_enabled": log_transform_enabled,
        },
        "celloracle": {
            "species": normalized_celloracle_species,
            "base_grn": normalized_celloracle_base_grn,
        },
        "selected_algorithms": selected_algorithms_list,
        "algorithm_parameters": validated_algorithm_parameters,
        "resolved_algorithm_parameters": resolved_algorithm_parameters,
        "results_directory": str(project_dir / "results"),
        "ensemble_enabled": ensemble_enabled,
        "upload_status": "waiting_for_upload",
        "job": {
            "job_id": job_id,
            "overall_status": "Queued",
        },
    }

    try:
        write_project_manifest(project_dir, project_manifest)
        atomic_write_json(project_dir / "metadata.json", metadata_manifest)
        atomic_write_json(project_dir / "jobs.json", [job_manifest])
    except Exception as exc:
        shutil.rmtree(project_dir, ignore_errors=True)
        return CreateProjectResponse(ok=False, errors=[str(exc)])

    return CreateProjectResponse(
        ok=True,
        project_id=project_id,
        job_id=job_id,
        errors=[],
    )


@router.post("/api/projects/{project_id}/upload-and-start")
async def upload_project_dataset_and_start(
    project_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
    response: Response,
    expression_matrix: UploadFile = File(...),
    pseudotime: UploadFile | None = File(default=None),
    cluster_labels: UploadFile | None = File(default=None),
):
    owner_id = get_or_create_client_id(request, response)
    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)

    try:
        project_manifest = read_project_manifest(project_dir)
        selected_algorithms_list = [
            str(algorithm_id)
            for algorithm_id in project_manifest.get("selected_algorithms", [])
        ]
        job_id = str(project_manifest.get("latest_job_id") or "")
        if not job_id:
            raise RuntimeError("Project is missing its pending job id.")

        errors: list[str] = []
        expression_ext_error = validate_csv_extension(expression_matrix.filename or "")
        if expression_ext_error:
            errors.append(f"Expression matrix: {expression_ext_error}")
        if pseudotime:
            pseudo_ext_error = validate_csv_extension(pseudotime.filename or "")
            if pseudo_ext_error:
                errors.append(f"Pseudotime: {pseudo_ext_error}")
        if cluster_labels:
            cluster_ext_error = validate_csv_extension(cluster_labels.filename or "")
            if cluster_ext_error:
                errors.append(f"Cluster labels: {cluster_ext_error}")

        if errors:
            message = "\n".join(errors)
            mark_upload_failure(project_dir, job_id, message)
            return {
                "ok": False,
                "project_id": project_id,
                "job_id": job_id,
                "errors": errors,
            }

        expression_path = (
            project_dir
            / f"expression__{Path(expression_matrix.filename or 'expression.csv').name}"
        )
        save_upload_file(expression_matrix, expression_path)

        pseudotime_path: Path | None = None
        if pseudotime:
            pseudotime_path = (
                project_dir
                / f"pseudotime__{Path(pseudotime.filename or 'pseudotime.csv').name}"
            )
            save_upload_file(pseudotime, pseudotime_path)

        cluster_labels_path: Path | None = None
        if cluster_labels:
            cluster_labels_path = (
                project_dir
                / (
                    "cluster_labels__"
                    f"{Path(cluster_labels.filename or 'cluster_labels.csv').name}"
                )
            )
            save_upload_file(cluster_labels, cluster_labels_path)

        project_manifest["expression_path"] = str(expression_path)
        project_manifest["pseudotime_path"] = (
            str(pseudotime_path) if pseudotime_path else None
        )
        project_manifest["cluster_labels_path"] = (
            str(cluster_labels_path) if cluster_labels_path else None
        )
        project_manifest["upload_status"] = "uploaded"
        write_project_manifest(project_dir, project_manifest)

        metadata_path = project_dir / "metadata.json"
        metadata_manifest = {}
        if metadata_path.exists():
            metadata_manifest = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata_manifest.update(
            {
                "expression_filename": expression_matrix.filename,
                "pseudotime_filename": pseudotime.filename if pseudotime else None,
                "cluster_labels_filename": (
                    cluster_labels.filename if cluster_labels else None
                ),
                "has_pseudotime": pseudotime is not None,
                "has_cluster_labels": cluster_labels is not None,
                "upload_status": "uploaded",
            }
        )
        metadata_path.write_text(
            json.dumps(metadata_manifest, indent=2),
            encoding="utf-8",
        )

        update_job_state(project_dir, job_id, overall_status="Queued")
        for algorithm_id in selected_algorithms_list:
            update_job_state(
                project_dir,
                job_id,
                algorithm_id=algorithm_id,
                task_status="Queued",
                progress_percent=0,
                progress_label="Queued",
            )

        if queue_enabled():
            enqueue_algorithm_job(project_id, job_id, selected_algorithms_list)
        else:
            background_tasks.add_task(
                launch_independent_algorithm_tasks,
                project_id,
                job_id,
                selected_algorithms_list,
            )

        return {"ok": True, "project_id": project_id, "job_id": job_id, "errors": []}
    except Exception as exc:
        try:
            project_manifest = read_project_manifest(project_dir)
            job_id = str(project_manifest.get("latest_job_id") or "")
            if job_id:
                mark_upload_failure(project_dir, job_id, str(exc))
        except Exception:
            pass
        return {"ok": False, "project_id": project_id, "errors": [str(exc)]}


@router.post("/api/projects/{project_id}/upload-failed")
async def mark_project_upload_failed(
    project_id: str,
    request: Request,
    response: Response,
    message: str = Form("Dataset upload failed before analysis could start."),
):
    owner_id = get_or_create_client_id(request, response)
    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)

    try:
        project_manifest = read_project_manifest(project_dir)
        job_id = str(project_manifest.get("latest_job_id") or "")
        if not job_id:
            raise RuntimeError("Project is missing its pending job id.")

        project_manifest["upload_status"] = "failed"
        write_project_manifest(project_dir, project_manifest)

        metadata_path = project_dir / "metadata.json"
        if metadata_path.exists():
            metadata_manifest = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata_manifest["upload_status"] = "failed"
            metadata_path.write_text(
                json.dumps(metadata_manifest, indent=2),
                encoding="utf-8",
            )

        mark_upload_failure(project_dir, job_id, message)
        return {"ok": True, "project_id": project_id, "job_id": job_id, "errors": []}
    except Exception as exc:
        return {"ok": False, "project_id": project_id, "errors": [str(exc)]}


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
    ranked_edges_per_target: str = Form("20"),
    selected_algorithms: str = Form(...),
    ensemble_enabled: str = Form(...),
    celloracle_species: str = Form("human"),
    celloracle_base_grn: str = Form("auto"),
    algorithm_parameters: str = Form("{}"),
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
        selected_algorithms_list = sort_algorithm_ids_by_difficulty(
            json.loads(selected_algorithms)
        )
        normalized_celloracle_species = (celloracle_species or "human").strip()
        normalized_celloracle_base_grn = (celloracle_base_grn or "auto").strip()

        if normalized_celloracle_species not in CELLORACLE_SPECIES_OPTIONS:
            return CreateProjectResponse(
                ok=False,
                errors=[
                    "Unsupported CellOracle species: "
                    f"{normalized_celloracle_species}."
                ],
            )
        if normalized_celloracle_base_grn not in CELLORACLE_BASE_GRN_OPTIONS:
            return CreateProjectResponse(
                ok=False,
                errors=[
                    "Unsupported CellOracle base GRN: "
                    f"{normalized_celloracle_base_grn}."
                ],
            )

        validated_algorithm_parameters = parse_algorithm_parameters(
            algorithm_parameters, selected_algorithms_list
        )
        resolved_algorithm_parameters = resolve_selected_algorithm_parameters(
            selected_algorithms_list, validated_algorithm_parameters
        )

        move_result = move_temp_upload_to_project(temp_upload_id, project_id)
        project_dir = Path(move_result["project_dir"])

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
            "algorithm_parameters": validated_algorithm_parameters,
            "algorithm_parameter_overrides": validated_algorithm_parameters,
            "resolved_algorithm_parameters": resolved_algorithm_parameters,
            "tasks": [
                {
                    "algorithm_id": algorithm_id,
                    "status": "Queued",
                    "elapsed_seconds": 0,
                    "error_message": None,
                    "error_type": None,
                    "result_path": None,
                    "started_at": None,
                    "started_at_timestamp": None,
                    "completed_at": None,
                    "completed_at_timestamp": None,
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
            "notification_email": None,
            "top_variable_genes": top_variable_genes,
            "include_all_tfs": include_all_tfs,
            "normalize_enabled": normalize_enabled,
            "log_transform_enabled": log_transform_enabled,
            "ranked_edges_per_target_limit": normalize_ranked_edges_per_target(ranked_edges_per_target),
            "selected_algorithms": selected_algorithms_list,
            "algorithm_parameters": validated_algorithm_parameters,
            "resolved_algorithm_parameters": resolved_algorithm_parameters,
            "ensemble_enabled": ensemble_enabled,
            "expression_path": move_result["expression_path"],
            "pseudotime_path": move_result.get("pseudotime_path"),
            "cluster_labels_path": move_result.get("cluster_labels_path"),
            "preprocessed_expression_path": str(
                project_dir / "preprocessed" / "ExpressionData.csv"
            ),
            "celloracle": {
                "species": normalized_celloracle_species,
                "base_grn": normalized_celloracle_base_grn,
            },
            "latest_job_id": job_id,
        }

        metadata_manifest = {
            "project_id": project_id,
            "owner_id": owner_id,
            "project_name": project_name,
            "project_description": project_description,
            "expression_filename": upload_metadata.get("expression_filename"),
            "pseudotime_filename": upload_metadata.get("pseudotime_filename"),
            "cluster_labels_filename": upload_metadata.get("cluster_labels_filename"),
            "gene_count": upload_metadata.get("gene_count"),
            "cell_count": upload_metadata.get("cell_count"),
            "gene_names": upload_metadata.get("gene_names", []),
            "cell_names": upload_metadata.get("cell_names", []),
            "known_tf_gene_names": known_tf_gene_names,
            "has_pseudotime": upload_metadata.get("has_pseudotime"),
            "pseudotime_count": upload_metadata.get("pseudotime_count"),
            "has_cluster_labels": upload_metadata.get("has_cluster_labels"),
            "cluster_label_count": upload_metadata.get("cluster_label_count"),
            "cluster_count": upload_metadata.get("cluster_count"),
            "cluster_names": upload_metadata.get("cluster_names", []),
            "cluster_cell_counts": upload_metadata.get("cluster_cell_counts", {}),
            "preprocessing": {
                "top_variable_genes": top_variable_genes,
                "include_all_tfs": include_all_tfs,
                "normalize_enabled": normalize_enabled,
                "log_transform_enabled": log_transform_enabled,
            },
            "celloracle": {
                "species": normalized_celloracle_species,
                "base_grn": normalized_celloracle_base_grn,
            },
            "selected_algorithms": selected_algorithms_list,
            "algorithm_parameters": validated_algorithm_parameters,
            "resolved_algorithm_parameters": resolved_algorithm_parameters,
            "results_directory": str(project_dir / "results"),
            "ensemble_enabled": ensemble_enabled,
            "job": {
                "job_id": job_id,
                "overall_status": "Queued",
            },
        }

        atomic_write_json(project_dir / "project.json", project_manifest)
        atomic_write_json(project_dir / "metadata.json", metadata_manifest)
        atomic_write_json(project_dir / "jobs.json", [job_manifest])

        if upload_metadata_path.exists():
            upload_metadata_path.unlink()

        if queue_enabled():
            enqueue_algorithm_job(project_id, job_id, selected_algorithms_list)
        else:
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


@router.patch("/api/projects/{project_id}/notification-email")
async def update_project_notification_email(
    project_id: str,
    payload: UpdateNotificationEmailRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    response: Response,
):
    owner_id = get_or_create_client_id(request, response)
    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)

    raw_email = (payload.notification_email or "").strip()
    notification_email = normalize_notification_email(raw_email)
    if raw_email and not notification_email:
        raise HTTPException(status_code=400, detail="Invalid notification email.")

    try:
        project_manifest = read_project_manifest(project_dir)
        project_manifest["notification_email"] = notification_email
        write_project_manifest(project_dir, project_manifest)

        latest_job = None
        with JOB_FILE_LOCK, jobs_manifest_lock(project_dir):
            jobs_manifest = read_jobs_manifest(project_dir)
            if jobs_manifest:
                latest_job = jobs_manifest[-1]
                if isinstance(latest_job, dict):
                    latest_job.pop("notification_sent_at", None)
                    latest_job.pop("notification_started_at", None)
                    latest_job.pop("notification_error", None)
                    latest_job.pop("notification_attempted_at", None)
                    write_jobs_manifest(project_dir, jobs_manifest)

        if (
            notification_email
            and isinstance(latest_job, dict)
            and latest_job.get("overall_status") in {"Completed", "Failed", "Stopped"}
            and latest_job.get("job_id")
        ):
            background_tasks.add_task(
                send_job_completion_notification_if_needed,
                project_dir,
                str(latest_job.get("job_id")),
            )

        return {
            "ok": True,
            "project_id": project_id,
            "notification_email": notification_email,
            "project": project_manifest,
            "latest_job": latest_job,
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/api/projects/{project_id}/name")
async def update_project_name(
    project_id: str,
    payload: UpdateProjectNameRequest,
    request: Request,
    response: Response,
):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        raise HTTPException(status_code=403, detail="Demo project is read-only.")

    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)

    new_name = (payload.project_name or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty.")
    if len(new_name) > 200:
        raise HTTPException(status_code=400, detail="Project name is too long.")

    try:
        project_manifest = read_project_manifest(project_dir)
        project_manifest["project_name"] = new_name
        write_project_manifest(project_dir, project_manifest)

        return {
            "ok": True,
            "project_id": project_id,
            "project_name": new_name,
            "project": project_manifest,
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


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

    
@router.delete("/api/projects/{project_id}")
def delete_project(project_id: str, request: Request, response: Response):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        raise HTTPException(status_code=403, detail="Demo project is read-only.")
    project_dir = PROJECTS_ROOT / project_id

    require_project_owner(project_dir, owner_id)

    try:
        stop_and_delete_project(project_id)
        return {
            "ok": True,
            "project_id": project_id,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/api/projects/{project_id}/stop")
async def stop_project(
    project_id: str,
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        raise HTTPException(status_code=403, detail="Demo project is read-only.")
    project_dir = PROJECTS_ROOT / project_id

    require_project_owner(project_dir, owner_id)

    try:
        summary = request_project_stop(project_id)
        stopping_targets = summary.get("stopping_targets", [])
        if stopping_targets:
            background_tasks.add_task(
                finalize_project_stop,
                project_id,
                stopping_targets,
            )
        jobs_manifest = read_jobs_manifest(project_dir)
        latest_job = jobs_manifest[-1] if jobs_manifest else None
        return {
            "ok": True,
            "project_id": project_id,
            "stopping_count": len(stopping_targets),
            "cancelled_queue_jobs": summary.get("cancelled_queue_jobs", 0),
            "latest_job": latest_job,
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
