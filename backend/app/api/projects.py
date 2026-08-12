from __future__ import annotations

import json
import math
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
    get_algorithm_by_id,
    resolve_selected_algorithm_parameters,
    sort_algorithm_ids_by_difficulty,
    validate_selected_algorithm_parameters,
)
from ..atomic_io import atomic_write_json
from ..config import JOB_FILE_LOCK, PROJECTS_ROOT
from ..preprocessing_contract import build_preprocessing_config
from ..matrix_state_detection import detect_matrix_state
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
from ..storage import save_upload_file
from ..schemas import (
    CreateProjectResponse,
    UpdateConfidenceRecoveryRankRequest,
    UpdateNotificationEmailRequest,
    UpdateProjectNameRequest,
)
from ..validators import validate_csv_extension
from ..services.beeline_service import (
    CONFIDENCE_RUN_MODE_FIXED,
    DEFAULT_CONFIDENCE_MAX_RUNS,
    collect_expression_matrix_issues,
    count_expression_gene_rows,
    normalize_confidence_bootstrap_runs,
    normalize_confidence_evidence_threshold,
    normalize_confidence_run_mode,
    recalculate_confidence_result_payload,
    read_delimited_header,
    resolve_ranked_edges_per_target_limit,
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
from ..services.result_service import read_algorithm_result, write_algorithm_result
from ..services.demo_service import get_demo_project, is_demo_project, load_demo_manifest
from ..services.visualization_context_service import read_ground_truth_edges
from ..services.tf_reference_service import (
    load_custom_tf_reference,
    load_species_tf_reference,
)

router = APIRouter()


def load_known_tf_gene_names(dataset_species: str = "human") -> list[str]:
    genes, _reference = load_species_tf_reference(
        dataset_species,
        reference_root=PROJECTS_ROOT.parent,
    )
    return genes


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
    if not parsed:
        raise ValueError("Select at least one algorithm.")

    normalized_ids: list[str] = []
    seen_ids: set[str] = set()
    for raw_algorithm_id in parsed:
        algorithm_id = str(raw_algorithm_id).strip().upper()
        if not algorithm_id:
            raise ValueError("Selected algorithm IDs cannot be blank.")
        if algorithm_id in seen_ids:
            raise ValueError(f"Algorithm selected more than once: {algorithm_id}.")

        try:
            algorithm = get_algorithm_by_id(algorithm_id)
        except KeyError as exc:
            raise ValueError(f"Unsupported algorithm: {algorithm_id}.") from exc
        if not algorithm.get("active", False):
            raise ValueError(f"Algorithm is not currently available: {algorithm_id}.")

        seen_ids.add(algorithm_id)
        normalized_ids.append(algorithm_id)

    return sort_algorithm_ids_by_difficulty(normalized_ids)


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
    *,
    dataset_species: str | None = None,
) -> tuple[str, str]:
    normalized_species = (celloracle_species or "human").strip()
    normalized_base_grn = (celloracle_base_grn or "auto").strip()

    normalized_dataset_species = str(dataset_species or "").strip()
    if normalized_dataset_species:
        if normalized_dataset_species not in CELLORACLE_SPECIES_OPTIONS:
            raise ValueError(
                "CellOracle requires one of the supported built-in dataset "
                "species; Other / Not listed cannot use its built-in prior."
            )
        normalized_species = normalized_dataset_species

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
    matrix_state: str = Form(...),
    matrix_state_source: str = Form("user_override"),
    dataset_species: str = Form(...),
    enabled_gene_selection_stages: str = Form(...),
    detection_threshold_percent: str = Form("10"),
    variance_gene_count: str = Form("500"),
    include_known_tfs: str = Form(...),
    gene_ordering_source: str = Form("calculate"),
    gene_ordering_filename: str = Form(""),
    trajectory_p_value: str = Form("0.01"),
    trajectory_bonferroni: str = Form("true"),
    include_significant_tfs: str = Form("true"),
    ranked_edges_per_target: str = Form("20"),
    confidence_run_mode: str = Form("automatic"),
    confidence_bootstrap_runs: str = Form("15"),
    confidence_evidence_threshold: str = Form("0.8"),
    selected_algorithms: str = Form(...),
    ensemble_enabled: str = Form(...),
    celloracle_species: str = Form("human"),
    celloracle_base_grn: str = Form("auto"),
    algorithm_parameters: str = Form("{}"),
    expression_filename: str = Form(""),
    pseudotime_filename: str = Form(""),
    ground_truth_filename: str = Form(""),
    cluster_labels_filename: str = Form(""),
    custom_tf_list_filename: str = Form(""),
    estimate_pseudotime: str = Form("false"),
):
    owner_id = get_or_create_client_id(request, response)
    project_id = uuid.uuid4().hex[:12]
    job_id = uuid.uuid4().hex[:12]

    try:
        selected_algorithms_list = parse_selected_algorithms(selected_algorithms)
        validated_algorithm_parameters = parse_algorithm_parameters(
            algorithm_parameters, selected_algorithms_list
        )
        resolved_algorithm_parameters = resolve_selected_algorithm_parameters(
            selected_algorithms_list, validated_algorithm_parameters
        )
        preprocessing_config = build_preprocessing_config(
            matrix_state=matrix_state,
            matrix_state_source=matrix_state_source,
            dataset_species=dataset_species,
            enabled_gene_selection_stages=enabled_gene_selection_stages,
            detection_threshold_percent=detection_threshold_percent,
            variance_gene_count=variance_gene_count,
            include_known_tfs=include_known_tfs,
            gene_ordering_source=gene_ordering_source,
            gene_ordering_filename=gene_ordering_filename,
            trajectory_p_value=trajectory_p_value,
            trajectory_bonferroni=trajectory_bonferroni,
            include_significant_tfs=include_significant_tfs,
        )
        normalized_celloracle_species, normalized_celloracle_base_grn = (
            normalize_celloracle_settings(
                celloracle_species,
                celloracle_base_grn,
                dataset_species=(
                    preprocessing_config["dataset_species"]
                    if "CELLORACLE" in selected_algorithms_list
                    else None
                ),
            )
        )
        normalized_confidence_run_mode = normalize_confidence_run_mode(
            confidence_run_mode
        )
        normalized_confidence_bootstrap_runs = (
            normalize_confidence_bootstrap_runs(
                confidence_bootstrap_runs,
                mode=normalized_confidence_run_mode,
            )
            if normalized_confidence_run_mode == CONFIDENCE_RUN_MODE_FIXED
            else DEFAULT_CONFIDENCE_MAX_RUNS
        )
        normalized_confidence_evidence_threshold = (
            normalize_confidence_evidence_threshold(confidence_evidence_threshold)
        )
    except Exception as exc:
        return CreateProjectResponse(ok=False, errors=[str(exc)])

    project_dir = PROJECTS_ROOT / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    known_tf_gene_names, known_tf_reference = load_species_tf_reference(
        preprocessing_config["dataset_species"],
        reference_root=PROJECTS_ROOT.parent,
    )

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
        "preprocessing": preprocessing_config,
        "ranked_edges_per_target_limit": normalize_ranked_edges_per_target(ranked_edges_per_target),
        "confidence_run_mode": normalized_confidence_run_mode,
        "confidence_bootstrap_runs": normalized_confidence_bootstrap_runs,
        "confidence_evidence_threshold": normalized_confidence_evidence_threshold,
        "selected_algorithms": selected_algorithms_list,
        "algorithm_parameters": validated_algorithm_parameters,
        "resolved_algorithm_parameters": resolved_algorithm_parameters,
        "ensemble_enabled": ensemble_enabled,
        "expression_path": None,
        "pseudotime_path": None,
        "ground_truth_path": None,
        "ground_truth_filename": ground_truth_filename or None,
        "cluster_labels_path": None,
        "gene_ordering_path": None,
        "custom_tf_list_path": None,
        "custom_tf_list_filename": custom_tf_list_filename or None,
        "known_tf_gene_names": known_tf_gene_names,
        "known_tf_reference": known_tf_reference,
        "gene_ordering_validation": {
            "status": (
                "waiting_for_upload"
                if preprocessing_config["trajectory"]["enabled"]
                and preprocessing_config["trajectory"]["gene_ordering_source"] == "upload"
                else "not_required"
            ),
        },
        "estimate_pseudotime": estimate_pseudotime,
        "preprocessed_expression_path": str(
            project_dir / "preprocessed" / "ExpressionData.csv"
        ),
        "preprocessing_status": "waiting_for_upload",
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
        "ground_truth_filename": ground_truth_filename or None,
        "cluster_labels_filename": cluster_labels_filename or None,
        "gene_ordering_filename": (
            preprocessing_config["trajectory"]["gene_ordering_filename"]
            if preprocessing_config["trajectory"]["enabled"]
            and preprocessing_config["trajectory"]["gene_ordering_source"] == "upload"
            else None
        ),
        "gene_count": None,
        "cell_count": None,
        "gene_names": [],
        "cell_names": [],
        "known_tf_gene_names": known_tf_gene_names,
        "known_tf_reference": known_tf_reference,
        "custom_tf_list_filename": custom_tf_list_filename or None,
        "has_custom_tf_list": False,
        "has_pseudotime": bool(pseudotime_filename),
        "has_ground_truth": bool(ground_truth_filename),
        "pseudotime_count": None,
        "has_cluster_labels": bool(cluster_labels_filename),
        "has_gene_ordering": False,
        "gene_ordering_validation": {
            "status": (
                "waiting_for_upload"
                if preprocessing_config["trajectory"]["enabled"]
                and preprocessing_config["trajectory"]["gene_ordering_source"] == "upload"
                else "not_required"
            ),
        },
        "cluster_label_count": None,
        "cluster_count": None,
        "cluster_names": [],
        "cluster_cell_counts": {},
        "preprocessing": preprocessing_config,
        "preprocessing_status": "waiting_for_upload",
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
    ground_truth: UploadFile | None = File(default=None),
    cluster_labels: UploadFile | None = File(default=None),
    gene_ordering: UploadFile | None = File(default=None),
    custom_tf_list: UploadFile | None = File(default=None),
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
        if ground_truth:
            ground_truth_ext_error = validate_csv_extension(
                ground_truth.filename or ""
            )
            if ground_truth_ext_error:
                errors.append(
                    f"Ground-truth network: {ground_truth_ext_error}"
                )
        if cluster_labels:
            cluster_ext_error = validate_csv_extension(cluster_labels.filename or "")
            if cluster_ext_error:
                errors.append(f"Cluster labels: {cluster_ext_error}")
        if gene_ordering:
            ordering_ext_error = validate_csv_extension(gene_ordering.filename or "")
            if ordering_ext_error:
                errors.append(f"GeneOrdering: {ordering_ext_error}")
        if custom_tf_list:
            tf_list_ext_error = validate_csv_extension(custom_tf_list.filename or "")
            if tf_list_ext_error:
                errors.append(f"Custom TF list: {tf_list_ext_error}")
            dataset_species = str(
                project_manifest.get("preprocessing", {}).get("dataset_species") or ""
            )
            if dataset_species != "other":
                errors.append(
                    "A custom TF list can only be used when dataset species is "
                    "Other / Not listed."
                )

        trajectory_config = (
            project_manifest.get("preprocessing", {}).get("trajectory", {})
        )
        gene_ordering_required = bool(trajectory_config.get("enabled")) and (
            trajectory_config.get("gene_ordering_source") == "upload"
        )
        if gene_ordering_required and gene_ordering is None:
            errors.append(
                "GeneOrdering CSV is required when trajectory-aware filtering "
                "uses an uploaded ordering."
            )

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

        preprocessing_config = project_manifest.setdefault("preprocessing", {})
        matrix_state_selection = preprocessing_config.setdefault(
            "matrix_state_selection",
            {
                "source": "user_override",
                "selected_state": preprocessing_config.get("matrix_state"),
            },
        )
        try:
            server_detection = detect_matrix_state(expression_path)
        except Exception as exc:
            server_detection = {
                "version": 1,
                "detected_state": None,
                "confidence": "low",
                "reasons": [f"Automatic detection could not be completed: {exc}"],
            }
        matrix_state_selection["server_detection"] = server_detection
        detected_state = server_detection.get("detected_state")
        if (
            matrix_state_selection.get("source") == "automatic"
            and detected_state in {"raw", "normalized", "log_normalized"}
        ):
            preprocessing_config["matrix_state"] = detected_state
            matrix_state_selection["selected_state"] = detected_state
        matrix_state_selection["agrees_with_server"] = (
            detected_state is None
            or detected_state == preprocessing_config.get("matrix_state")
        )

        pseudotime_path: Path | None = None
        if pseudotime:
            pseudotime_path = (
                project_dir
                / f"pseudotime__{Path(pseudotime.filename or 'pseudotime.csv').name}"
            )
            save_upload_file(pseudotime, pseudotime_path)

        ground_truth_path: Path | None = None
        if ground_truth:
            ground_truth_path = (
                project_dir
                / (
                    "ground_truth__"
                    f"{Path(ground_truth.filename or 'ground_truth.csv').name}"
                )
            )
            save_upload_file(ground_truth, ground_truth_path)
            try:
                ground_truth_edges = read_ground_truth_edges(ground_truth_path)
            except Exception as exc:
                raise ValueError(
                    f"Ground-truth network could not be read: {exc}"
                ) from exc
            if not ground_truth_edges:
                raise ValueError(
                    "Ground-truth network does not contain any valid regulator-target edges."
                )

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

        gene_ordering_path: Path | None = None
        if gene_ordering:
            gene_ordering_path = (
                project_dir
                / (
                    "gene_ordering__"
                    f"{Path(gene_ordering.filename or 'GeneOrdering.csv').name}"
                )
            )
            save_upload_file(gene_ordering, gene_ordering_path)

        custom_tf_list_path: Path | None = None
        if custom_tf_list:
            custom_tf_list_path = (
                project_dir
                / (
                    "custom_tf_list__"
                    f"{Path(custom_tf_list.filename or 'custom_tf_list.csv').name}"
                )
            )
            save_upload_file(custom_tf_list, custom_tf_list_path)
            custom_tf_gene_names, custom_tf_reference = load_custom_tf_reference(
                custom_tf_list_path,
                dataset_species=project_manifest.get("preprocessing", {}).get(
                    "dataset_species", "other"
                ),
            )
            custom_tf_reference["source_filename"] = custom_tf_list.filename
            project_manifest["known_tf_gene_names"] = custom_tf_gene_names
            project_manifest["known_tf_reference"] = custom_tf_reference

        project_manifest["expression_path"] = str(expression_path)
        project_manifest["pseudotime_path"] = (
            str(pseudotime_path) if pseudotime_path else None
        )
        project_manifest["pseudotime_estimated"] = False
        project_manifest.pop("pseudotime_source_path", None)
        project_manifest.pop("pseudotime_canonicalization", None)
        project_manifest.pop("pseudotime_input_contract", None)
        project_manifest["ground_truth_path"] = (
            str(ground_truth_path) if ground_truth_path else None
        )
        project_manifest["ground_truth_filename"] = (
            ground_truth.filename if ground_truth else None
        )
        project_manifest["cluster_labels_path"] = (
            str(cluster_labels_path) if cluster_labels_path else None
        )
        project_manifest["gene_ordering_path"] = (
            str(gene_ordering_path) if gene_ordering_path else None
        )
        project_manifest["custom_tf_list_path"] = (
            str(custom_tf_list_path) if custom_tf_list_path else None
        )
        project_manifest["custom_tf_list_filename"] = (
            custom_tf_list.filename if custom_tf_list else None
        )
        project_manifest["gene_ordering_validation"] = {
            "status": "pending" if gene_ordering_path else "not_required",
        }
        project_manifest["upload_status"] = "uploaded"
        project_manifest["preprocessing_status"] = "pending"
        project_manifest.pop("preprocessing_result", None)
        project_manifest.pop("preprocessing_error", None)
        write_project_manifest(project_dir, project_manifest)

        metadata_path = project_dir / "metadata.json"
        metadata_manifest = {}
        if metadata_path.exists():
            metadata_manifest = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata_manifest.update(
            {
                "expression_filename": expression_matrix.filename,
                "pseudotime_filename": pseudotime.filename if pseudotime else None,
                "ground_truth_filename": (
                    ground_truth.filename if ground_truth else None
                ),
                "cluster_labels_filename": (
                    cluster_labels.filename if cluster_labels else None
                ),
                "has_pseudotime": pseudotime is not None,
                "has_ground_truth": ground_truth is not None,
                "has_cluster_labels": cluster_labels is not None,
                "gene_ordering_filename": (
                    gene_ordering.filename if gene_ordering else None
                ),
                "has_gene_ordering": gene_ordering is not None,
                "custom_tf_list_filename": (
                    custom_tf_list.filename if custom_tf_list else None
                ),
                "has_custom_tf_list": custom_tf_list is not None,
                "known_tf_gene_names": project_manifest.get(
                    "known_tf_gene_names", []
                ),
                "known_tf_reference": project_manifest.get(
                    "known_tf_reference", {}
                ),
                "preprocessing": preprocessing_config,
                "gene_ordering_validation": {
                    "status": "pending" if gene_ordering_path else "not_required",
                },
                "upload_status": "uploaded",
                "preprocessing_status": "pending",
            }
        )
        metadata_manifest.pop("preprocessing_result", None)
        metadata_manifest.pop("preprocessing_error", None)
        atomic_write_json(metadata_path, metadata_manifest)

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


@router.patch("/api/projects/{project_id}/confidence-recovery-rank")
async def update_confidence_recovery_rank(
    project_id: str,
    payload: UpdateConfidenceRecoveryRankRequest,
    request: Request,
    response: Response,
):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        raise HTTPException(status_code=403, detail="Demo project is read-only.")

    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)

    if not math.isfinite(payload.recovery_top_fraction):
        raise HTTPException(status_code=400, detail="Recovery rank must be a number.")

    top_fraction = max(0.01, min(0.99, float(payload.recovery_top_fraction)))
    evidence_threshold = normalize_confidence_evidence_threshold(1.0 - top_fraction)

    try:
        project_manifest = read_project_manifest(project_dir)
        jobs_manifest = read_jobs_manifest(project_dir)
        latest_job = jobs_manifest[-1] if jobs_manifest else None
        if isinstance(latest_job, dict) and any(
            task.get("status") in {"Queued", "Running", "Stopping"}
            for task in latest_job.get("tasks", [])
            if isinstance(task, dict)
        ):
            raise HTTPException(
                status_code=409,
                detail="Wait until the current analysis finishes before changing the recovery rank.",
            )

        selected_algorithms = project_manifest.get("selected_algorithms") or []
        updated_algorithms = 0
        updated_scopes = 0
        for algorithm_id in selected_algorithms:
            try:
                result_payload = read_algorithm_result(project_dir, str(algorithm_id))
            except FileNotFoundError:
                continue

            max_edges_per_target = resolve_ranked_edges_per_target_limit(
                str(algorithm_id),
                project_manifest,
            )
            changed_scopes = recalculate_confidence_result_payload(
                result_payload,
                evidence_threshold=evidence_threshold,
                max_edges_per_target=max_edges_per_target,
            )
            if changed_scopes <= 0:
                continue

            write_algorithm_result(project_dir, str(algorithm_id), result_payload)
            updated_algorithms += 1
            updated_scopes += changed_scopes

        if updated_algorithms <= 0:
            raise HTTPException(
                status_code=409,
                detail="This analysis does not contain the archived confidence runs needed to recalculate the recovery rank.",
            )

        project_manifest["confidence_evidence_threshold"] = evidence_threshold
        write_project_manifest(project_dir, project_manifest)

        return {
            "ok": True,
            "project_id": project_id,
            "confidence_evidence_threshold": evidence_threshold,
            "recovery_top_fraction": 1.0 - evidence_threshold,
            "updated_algorithms": updated_algorithms,
            "updated_scopes": updated_scopes,
            "project": project_manifest,
        }
    except HTTPException:
        raise
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
def stop_project(
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
