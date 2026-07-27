from __future__ import annotations

import os
import signal
import shutil
import subprocess
import time
import threading
import traceback
import csv
import hashlib
import json
import re
from dataclasses import dataclass
from itertools import chain
from pathlib import Path

from ..algorithm_registry import sort_algorithm_ids_by_difficulty
from ..atomic_io import atomic_write_json
from ..config import JOB_FILE_LOCK, PROJECTS_ROOT
from ..repositories.job_repository import (
    jobs_manifest_lock,
    read_jobs_manifest,
    write_jobs_manifest,
)
from ..repositories.project_repository import read_project_manifest
from ..repositories.project_repository import write_project_manifest
from ..species_inference import infer_species_from_gene_names
from ..validators import read_expression_gene_names, validate_gene_ordering_csv
from ..services.beeline_service import (
    AlgorithmStoppedError,
    MatrixValidationRuntimeError,
    PreprocessingRuntimeError,
    collect_expression_matrix_issues,
    count_expression_gene_rows,
    detect_csv_dialect_from_file,
    ensure_project_preprocessed_expression,
    find_algorithm_runtime_roots,
    parse_bool,
    read_delimited_header,
    run_beeline_with_progress,
    summarize_expression_matrix_issues,
    terminate_algorithm_docker_containers,
    write_expression_subset_by_cells,
)
from ..services.email_service import (
    normalize_notification_email,
    send_job_completion_email,
    smtp_is_configured,
)
from ..services.result_service import (
    archive_beeline_failure_diagnostics,
    archive_beeline_result_artifacts,
    clear_algorithm_result_artifacts,
    write_algorithm_result,
)


@dataclass
class TaskControl:
    stop_event: "TaskStopSignal"
    process: subprocess.Popen | None = None


@dataclass
class AlgorithmScope:
    scope_id: str
    label: str
    scope_type: str
    cell_count: int
    selected_column_indices: list[int] | None = None
    skipped: bool = False
    skip_reason: str | None = None


class TaskStopSignal:
    def __init__(self, project_id: str, job_id: str, algorithm_id: str) -> None:
        self.project_id = project_id
        self.job_id = job_id
        self.algorithm_id = algorithm_id
        self.local_event = threading.Event()

    def set(self) -> None:
        self.local_event.set()

    def is_set(self) -> bool:
        if self.local_event.is_set():
            return True

        project_dir = PROJECTS_ROOT / self.project_id
        if not project_dir.exists():
            return False

        try:
            task = get_task_state(project_dir, self.job_id, self.algorithm_id)
        except Exception:
            return False

        if task is None:
            return False
        return task.get("status") in {"Stopping", "Stopped"}


TASK_CONTROLS_LOCK = threading.Lock()
TASK_CONTROLS: dict[tuple[str, str, str], TaskControl] = {}


def read_positive_int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


MAX_CONCURRENT_ALGORITHM_TASKS = read_positive_int_env(
    "GRNSCOPE_MAX_CONCURRENT_ALGORITHMS",
    2,
)
ALGORITHM_TASK_SEMAPHORE = threading.BoundedSemaphore(
    MAX_CONCURRENT_ALGORITHM_TASKS
)
TERMINAL_JOB_STATUSES = {"Completed", "Failed", "Stopped"}
MIN_CLUSTER_SCOPE_CELLS = 50


def mark_project_setup_failure(
    project_dir: Path,
    job_id: str,
    message: str,
    *,
    error_type: str = "matrix_validation",
    validation_issues: list[dict] | None = None,
) -> None:
    """Record a pre-run setup failure without blaming algorithm tasks."""

    with JOB_FILE_LOCK, jobs_manifest_lock(project_dir):
        jobs_manifest = read_jobs_manifest(project_dir)
        for job in jobs_manifest:
            if not isinstance(job, dict) or job.get("job_id") != job_id:
                continue
            job["overall_status"] = "SetupFailed"
            job["setup_error_type"] = error_type
            job["setup_error_message"] = message
            if validation_issues:
                job["setup_validation_issues"] = validation_issues
            else:
                job.pop("setup_validation_issues", None)
            for task in job.get("tasks", []):
                if not isinstance(task, dict):
                    continue
                task["status"] = "NotStarted"
                task["elapsed_seconds"] = 0
                task["error_message"] = None
                task["error_type"] = None
                task["progress_percent"] = 0
                task["progress_label"] = "Not started"
                task["started_at"] = None
                task["started_at_timestamp"] = None
                task["completed_at"] = None
                task["completed_at_timestamp"] = None
                task.pop("estimated_remaining_seconds", None)
                task.pop("estimated_remaining_min_seconds", None)
                task.pop("estimated_remaining_max_seconds", None)
                task.pop("process_pid", None)
            break
        write_jobs_manifest(project_dir, jobs_manifest)

    for manifest_name in ("project.json", "metadata.json"):
        manifest_path = project_dir / manifest_name
        if not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["setup_error_type"] = error_type
            manifest["setup_error_message"] = message
            if error_type == "matrix_validation":
                manifest["dataset_validation_status"] = "failed"
                manifest["dataset_validation_error"] = message
                if validation_issues:
                    manifest["dataset_validation_issues"] = validation_issues
                else:
                    manifest.pop("dataset_validation_issues", None)
                manifest["upload_status"] = "validation_failed"
            else:
                manifest["upload_status"] = "failed"
            if manifest_name == "project.json":
                write_project_manifest(project_dir, manifest)
            else:
                atomic_write_json(manifest_path, manifest)
        except Exception:
            continue


def mark_project_dataset_validated(project_dir: Path, job_id: str) -> None:
    (project_dir / "matrix_validation_issues.csv").unlink(missing_ok=True)
    for manifest_name in ("project.json", "metadata.json"):
        manifest_path = project_dir / manifest_name
        if not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["dataset_validation_status"] = "validated"
            manifest["upload_status"] = "validated"
            manifest.pop("dataset_validation_error", None)
            manifest.pop("dataset_validation_issues", None)
            manifest.pop("setup_error_type", None)
            manifest.pop("setup_error_message", None)
            if manifest_name == "project.json":
                write_project_manifest(project_dir, manifest)
            else:
                atomic_write_json(manifest_path, manifest)
        except Exception:
            continue

    with JOB_FILE_LOCK, jobs_manifest_lock(project_dir):
        jobs_manifest = read_jobs_manifest(project_dir)
        for job in jobs_manifest:
            if not isinstance(job, dict) or job.get("job_id") != job_id:
                continue
            job.pop("setup_error_type", None)
            job.pop("setup_error_message", None)
            job.pop("setup_validation_issues", None)
            break
        write_jobs_manifest(project_dir, jobs_manifest)


def sync_project_preprocessing_state(
    project_dir: Path,
    status: str,
    *,
    result: dict | None = None,
    error: str | None = None,
) -> None:
    for manifest_name in ("project.json", "metadata.json"):
        manifest_path = project_dir / manifest_name
        if not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        manifest["preprocessing_status"] = status
        if result is not None:
            manifest["preprocessing_result"] = result
        elif status != "completed":
            manifest.pop("preprocessing_result", None)
        if error:
            manifest["preprocessing_error"] = error
        else:
            manifest.pop("preprocessing_error", None)
        if manifest_name == "project.json":
            write_project_manifest(project_dir, manifest)
        else:
            atomic_write_json(manifest_path, manifest)


def load_preprocessing_result(
    project_dir: Path,
    preprocessed_expression: Path,
) -> dict:
    manifest_path = project_dir / "preprocessed" / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PreprocessingRuntimeError(
            "Preprocessing finished, but its result manifest could not be read."
        ) from exc
    return {
        "status": "completed",
        "completed_at": manifest.get("created_at"),
        "gene_count": manifest.get("gene_count"),
        "cell_count": manifest.get("cell_count"),
        "transformation": manifest.get("transformation"),
        "gene_selection": manifest.get("gene_selection") or [],
        "generated_gene_ordering": manifest.get("generated_gene_ordering"),
        "preprocessed_expression_path": str(preprocessed_expression),
        "manifest_path": str(manifest_path),
    }


def prepare_project_dataset_for_algorithms(project_id: str, job_id: str) -> bool:
    """Validate and preprocess the dataset before any algorithm starts."""

    project_dir = PROJECTS_ROOT / project_id
    try:
        project_manifest = read_project_manifest(project_dir)
        if project_manifest.get("dataset_validation_status") == "failed":
            return False

        expression_path = project_manifest.get("expression_path")
        if not expression_path:
            raise MatrixValidationRuntimeError("Expression matrix file is missing.")

        source_expression = Path(expression_path)
        if not source_expression.exists():
            raise MatrixValidationRuntimeError("Expression matrix file could not be found.")

        validation_report_path = project_dir / "matrix_validation_issues.csv"
        validation_issues = collect_expression_matrix_issues(
            source_expression,
            report_path=validation_report_path,
        )
        if validation_issues:
            mark_project_setup_failure(
                project_dir,
                job_id,
                summarize_expression_matrix_issues(validation_issues),
                error_type="matrix_validation",
                validation_issues=validation_issues,
            )
            return False
        validation_report_path.unlink(missing_ok=True)

        trajectory_config = (
            project_manifest.get("preprocessing", {}).get("trajectory", {})
        )
        trajectory_enabled = bool(trajectory_config.get("enabled"))
        gene_ordering_source = str(
            trajectory_config.get("gene_ordering_source") or "calculate"
        ).strip().lower()
        if trajectory_enabled and gene_ordering_source == "upload":
            gene_ordering_path_value = project_manifest.get("gene_ordering_path")
            if not gene_ordering_path_value:
                message = (
                    "GeneOrdering CSV is required for the selected "
                    "trajectory-aware filtering source."
                )
                sync_gene_ordering_validation(
                    project_dir,
                    project_manifest,
                    {"status": "failed", "error": message},
                )
                sync_project_preprocessing_state(
                    project_dir,
                    "failed",
                    error=message,
                )
                mark_project_setup_failure(
                    project_dir,
                    job_id,
                    message,
                    error_type="gene_ordering_validation",
                )
                return False

            gene_ordering_path = Path(str(gene_ordering_path_value))
            if not gene_ordering_path.exists():
                message = "The uploaded GeneOrdering CSV could not be found."
                sync_gene_ordering_validation(
                    project_dir,
                    project_manifest,
                    {"status": "failed", "error": message},
                )
                sync_project_preprocessing_state(
                    project_dir,
                    "failed",
                    error=message,
                )
                mark_project_setup_failure(
                    project_dir,
                    job_id,
                    message,
                    error_type="gene_ordering_validation",
                )
                return False

            try:
                gene_ordering_validation = validate_gene_ordering_csv(
                    gene_ordering_path,
                    read_expression_gene_names(source_expression),
                )
            except ValueError as exc:
                message = str(exc)
                sync_gene_ordering_validation(
                    project_dir,
                    project_manifest,
                    {"status": "failed", "error": message},
                )
                sync_project_preprocessing_state(
                    project_dir,
                    "failed",
                    error=message,
                )
                mark_project_setup_failure(
                    project_dir,
                    job_id,
                    message,
                    error_type="gene_ordering_validation",
                )
                return False

            sync_gene_ordering_validation(
                project_dir,
                project_manifest,
                gene_ordering_validation,
            )

        # Calculated GeneOrdering depends on pseudotime, so estimation must
        # finish before the preprocessing pipeline reaches trajectory filtering.
        # Uploaded pseudotime always wins because this only runs when no
        # pseudotime path is present.
        should_estimate_pseudotime = (
            parse_bool(project_manifest.get("estimate_pseudotime"))
            and not project_manifest.get("pseudotime_path")
        )
        if should_estimate_pseudotime:
            from .pseudotime_service import (
                ensure_estimated_pseudotime,
                read_estimation_status,
            )

            estimation_error: str | None = None
            try:
                estimated = ensure_estimated_pseudotime(project_id)
            except Exception as exc:
                estimated = False
                estimation_error = str(exc)
            project_manifest = read_project_manifest(project_dir)
            if not estimated and trajectory_enabled and gene_ordering_source == "calculate":
                estimation_status = read_estimation_status(project_dir) or {}
                message = str(
                    estimation_status.get("error_message")
                    or estimation_error
                    or (
                        "Pseudotime estimation failed, so GeneOrdering could "
                        "not be calculated."
                    )
                )
                sync_project_preprocessing_state(
                    project_dir,
                    "failed",
                    error=message,
                )
                mark_project_setup_failure(
                    project_dir,
                    job_id,
                    message,
                    error_type="pseudotime_estimation",
                )
                return False

        if (
            trajectory_enabled
            and gene_ordering_source == "calculate"
            and not project_manifest.get("pseudotime_path")
        ):
            message = (
                "Pseudotime is required to calculate GeneOrdering. Upload "
                "pseudotime or enable Slingshot estimation."
            )
            sync_project_preprocessing_state(
                project_dir,
                "failed",
                error=message,
            )
            mark_project_setup_failure(
                project_dir,
                job_id,
                message,
                error_type="gene_ordering_generation",
            )
            return False

        sync_project_preprocessing_state(project_dir, "running")
        preprocessed_expression = ensure_project_preprocessed_expression(
            project_id,
            source_expression,
            project_manifest,
        )
        preprocessing_result = load_preprocessing_result(
            project_dir,
            preprocessed_expression,
        )
        sync_project_preprocessing_state(
            project_dir,
            "completed",
            result=preprocessing_result,
        )
        sync_project_dataset_dimensions(
            project_dir,
            read_project_manifest(project_dir),
            source_expression,
        )

        mark_project_dataset_validated(project_dir, job_id)
        return True
    except MatrixValidationRuntimeError as exc:
        mark_project_setup_failure(
            project_dir,
            job_id,
            str(exc),
            error_type="matrix_validation",
        )
        return False
    except PreprocessingRuntimeError as exc:
        sync_project_preprocessing_state(
            project_dir,
            "failed",
            error=str(exc),
        )
        mark_project_setup_failure(
            project_dir,
            job_id,
            str(exc),
            error_type="preprocessing",
        )
        return False
    except Exception as exc:
        message = f"Preprocessing failed unexpectedly: {exc}"
        traceback.print_exc()
        sync_project_preprocessing_state(
            project_dir,
            "failed",
            error=message,
        )
        mark_project_setup_failure(
            project_dir,
            job_id,
            message,
            error_type="preprocessing",
        )
        return False


def sync_gene_ordering_validation(
    project_dir: Path,
    project_manifest: dict,
    validation: dict,
) -> None:
    project_manifest["gene_ordering_validation"] = validation
    write_project_manifest(project_dir, project_manifest)

    metadata_path = project_dir / "metadata.json"
    if not metadata_path.exists():
        return
    try:
        metadata_manifest = json.loads(metadata_path.read_text(encoding="utf-8"))
    except Exception:
        return
    metadata_manifest["gene_ordering_validation"] = validation
    metadata_manifest["has_gene_ordering"] = bool(
        project_manifest.get("gene_ordering_path")
    )
    atomic_write_json(metadata_path, metadata_manifest)


def sync_project_dataset_dimensions(
    project_dir: Path,
    project_manifest: dict,
    source_expression: Path,
) -> None:
    header, _dialect = read_delimited_header(source_expression)
    gene_count = count_expression_gene_rows(source_expression)
    cell_count = max(0, len(header) - 1)

    if gene_count <= 0 or cell_count <= 0:
        return

    project_manifest["gene_count"] = gene_count
    project_manifest["cell_count"] = cell_count
    write_project_manifest(project_dir, project_manifest)

    metadata_path = project_dir / "metadata.json"
    if not metadata_path.exists():
        return

    try:
        metadata_manifest = json.loads(metadata_path.read_text(encoding="utf-8"))
    except Exception:
        return

    metadata_manifest["gene_count"] = gene_count
    metadata_manifest["cell_count"] = cell_count
    dialect = detect_csv_dialect_from_file(source_expression)
    gene_names: list[str] = []
    with source_expression.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle, dialect=dialect)
        next(reader, None)
        for row in reader:
            if row and str(row[0]).strip():
                gene_names.append(str(row[0]).strip())
            if len(gene_names) >= 1000:
                break
    metadata_manifest["gene_names"] = gene_names
    metadata_manifest["species_inference"] = infer_species_from_gene_names(gene_names)
    metadata_manifest["upload_status"] = "validated"
    atomic_write_json(metadata_path, metadata_manifest)


def safe_scope_id(scope_type: str, label: str) -> str:
    if scope_type == "global":
        return "global"
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", label).strip("_.-")
    if not slug:
        slug = "cluster"
    slug = slug[:48]
    digest = hashlib.sha1(label.encode("utf-8")).hexdigest()[:8]
    return f"cluster_{slug}_{digest}"


def cluster_file_has_header(row: list[str]) -> bool:
    if len(row) < 2:
        return False
    first = str(row[0]).strip().lower()
    second = str(row[1]).strip().lower()
    return first in {"cell", "cell_id", "cellid", "cell id", "cells"} and second in {
        "cluster",
        "cluster_id",
        "clusterid",
        "cluster id",
        "cell_type",
        "celltype",
        "cell type",
        "label",
        "group",
    }


def load_cluster_scope_definitions(project_manifest: dict) -> list[AlgorithmScope]:
    expression_path = project_manifest.get("expression_path")
    cluster_labels_path = project_manifest.get("cluster_labels_path")
    if not expression_path or not cluster_labels_path:
        return []

    header, _dialect = read_delimited_header(Path(expression_path))
    cell_to_column_index = {
        str(cell_name).strip(): index
        for index, cell_name in enumerate(header[1:], start=1)
        if str(cell_name).strip()
    }

    labels_path = Path(cluster_labels_path)
    if not labels_path.exists():
        return []

    dialect = detect_csv_dialect_from_file(labels_path)
    cluster_columns: dict[str, list[int]] = {}
    with labels_path.open("r", encoding="utf-8", newline="") as labels_file:
        reader = csv.reader(labels_file, dialect=dialect)
        try:
            first_row = next(reader)
        except StopIteration:
            return []

        rows = reader if cluster_file_has_header(first_row) else chain([first_row], reader)
        for row in rows:
            if len(row) < 2:
                continue
            cell_id = str(row[0]).strip()
            cluster_label = str(row[1]).strip()
            if not cell_id or not cluster_label:
                continue
            column_index = cell_to_column_index.get(cell_id)
            if column_index is None:
                continue
            cluster_columns.setdefault(cluster_label, []).append(column_index)

    scopes: list[AlgorithmScope] = []
    for cluster_label, column_indices in sorted(
        cluster_columns.items(),
        key=lambda item: (-len(item[1]), item[0]),
    ):
        scope_id = safe_scope_id("cluster", cluster_label)
        cell_count = len(column_indices)
        skipped = cell_count < MIN_CLUSTER_SCOPE_CELLS
        scopes.append(
            AlgorithmScope(
                scope_id=scope_id,
                label=cluster_label,
                scope_type="cluster",
                cell_count=cell_count,
                selected_column_indices=sorted(column_indices),
                skipped=skipped,
                skip_reason=(
                    f"Skipped because this cluster has {cell_count} cells; "
                    f"minimum is {MIN_CLUSTER_SCOPE_CELLS}."
                    if skipped
                    else None
                ),
            )
        )

    return scopes


def build_algorithm_scopes(project_manifest: dict) -> list[AlgorithmScope]:
    expression_path = project_manifest.get("expression_path")
    cell_count = 0
    if expression_path:
        try:
            header, _dialect = read_delimited_header(Path(expression_path))
            cell_count = max(0, len(header) - 1)
        except Exception:
            cell_count = 0

    scopes = [
        AlgorithmScope(
            scope_id="global",
            label="Global",
            scope_type="global",
            cell_count=cell_count,
        )
    ]
    scopes.extend(load_cluster_scope_definitions(project_manifest))
    return scopes


def prepare_scope_manifest(
    project_dir: Path,
    project_manifest: dict,
    scope: AlgorithmScope,
    *,
    has_cluster_scopes: bool,
) -> dict:
    scope_manifest = {
        **project_manifest,
        "scope": {
            "id": scope.scope_id,
            "label": scope.label,
            "type": scope.scope_type,
            "cell_count": scope.cell_count,
        },
    }

    dataset_suffix = scope.scope_id if has_cluster_scopes else None
    if dataset_suffix:
        scope_manifest["beeline_dataset_id"] = f"{project_manifest.get('project_id')}_{dataset_suffix}"

    if scope.scope_type != "cluster" or not scope.selected_column_indices:
        return scope_manifest

    scope_dir = project_dir / "scopes" / scope.scope_id
    scope_expression = scope_dir / "ExpressionData.raw.csv"
    write_expression_subset_by_cells(
        Path(project_manifest["expression_path"]),
        scope_expression,
        scope.selected_column_indices,
    )

    scope_manifest["expression_path"] = str(scope_expression)
    scope_manifest["preprocessed_expression_path"] = str(
        scope_dir / "preprocessed" / "ExpressionData.csv"
    )
    return scope_manifest


def scope_result_payload(scope: AlgorithmScope, beeline_result: dict) -> dict:
    return {
        "scope_id": scope.scope_id,
        "scope_label": scope.label,
        "scope_type": scope.scope_type,
        "cell_count": scope.cell_count,
        "status": "Completed",
        "algorithm_preprocessing": beeline_result.get("algorithm_preprocessing"),
        "network_summary": beeline_result["network_summary"],
        "top_edges": beeline_result["top_edges"],
        "confidence_summary": beeline_result.get("confidence_summary"),
        "run_ranked_edges_paths": beeline_result.get("run_ranked_edges_paths"),
        "run_diagnostics_root": beeline_result.get("run_diagnostics_root"),
        "beeline_runtime_root": beeline_result["runtime_root"],
        "result_artifact_root": beeline_result.get("result_artifact_root"),
        "ranked_edges_path": beeline_result["ranked_edges_path"],
    }


def skipped_scope_payload(scope: AlgorithmScope) -> dict:
    return {
        "scope_id": scope.scope_id,
        "scope_label": scope.label,
        "scope_type": scope.scope_type,
        "cell_count": scope.cell_count,
        "status": "Skipped",
        "skip_reason": scope.skip_reason,
        "network_summary": None,
        "top_edges": [],
    }


def format_runtime_timestamp(timestamp: float | None = None) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(timestamp or time.time()))


def task_key(project_id: str, job_id: str, algorithm_id: str) -> tuple[str, str, str]:
    return (project_id, job_id, algorithm_id)


def get_or_create_task_control(
    project_id: str,
    job_id: str,
    algorithm_id: str,
) -> TaskControl:
    key = task_key(project_id, job_id, algorithm_id)
    with TASK_CONTROLS_LOCK:
        control = TASK_CONTROLS.get(key)
        if control is None:
            control = TaskControl(
                stop_event=TaskStopSignal(project_id, job_id, algorithm_id)
            )
            TASK_CONTROLS[key] = control
        return control


def clear_task_control(project_id: str, job_id: str, algorithm_id: str) -> None:
    key = task_key(project_id, job_id, algorithm_id)
    with TASK_CONTROLS_LOCK:
        TASK_CONTROLS.pop(key, None)


def set_task_process(
    project_id: str,
    job_id: str,
    algorithm_id: str,
    process: subprocess.Popen,
) -> None:
    control = get_or_create_task_control(project_id, job_id, algorithm_id)
    with TASK_CONTROLS_LOCK:
        control.process = process

    project_dir = PROJECTS_ROOT / project_id
    if project_dir.exists():
        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            process_pid=process.pid,
        )


def terminate_process_group(pid: int | None) -> None:
    if pid is None or pid <= 0:
        return

    cmdline_path = Path(f"/proc/{pid}/cmdline")
    if cmdline_path.exists():
        try:
            cmdline = cmdline_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return
        if "BLRunner.py" not in cmdline:
            return

    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        return

    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            os.killpg(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)

    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def terminate_process(process: subprocess.Popen | None, fallback_pid: int | None = None) -> None:
    if process is None:
        terminate_process_group(fallback_pid)
        return

    if process.poll() is not None:
        return

    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return

    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def cleanup_algorithm_runtime(project_id: str, algorithm_id: str) -> None:
    for runtime_root in find_algorithm_runtime_roots(project_id, algorithm_id):
        shutil.rmtree(runtime_root, ignore_errors=True)

    runtime_parent = PROJECTS_ROOT / project_id / "_beeline_runtime"
    try:
        if runtime_parent.exists() and not any(runtime_parent.iterdir()):
            runtime_parent.rmdir()
    except OSError:
        pass


def archive_task_failure_diagnostics(
    project_dir: Path,
    project_id: str,
    job_id: str,
    algorithm_id: str,
    *,
    error_message: str,
    error_type: str,
    started_at_timestamp: float,
    completed_at_timestamp: float,
    elapsed_seconds: int,
) -> str | None:
    try:
        return archive_beeline_failure_diagnostics(
            project_dir,
            job_id,
            algorithm_id,
            error_message=error_message,
            error_type=error_type,
            started_at_timestamp=started_at_timestamp,
            completed_at_timestamp=completed_at_timestamp,
            elapsed_seconds=elapsed_seconds,
            traceback_text=traceback.format_exc(),
            runtime_roots=find_algorithm_runtime_roots(project_id, algorithm_id),
        )
    except Exception:
        # Never replace the original algorithm failure with a diagnostics error.
        # If archiving fails, leave the runtime in place as a last-resort fallback.
        return None


def user_error_message_after_archiving(error_message: str, diagnostics_path: str | None) -> str:
    """Remove references to transient paths once a diagnostic bundle exists."""

    if not diagnostics_path or "_beeline_runtime" not in error_message:
        return error_message

    for marker in (" See ", "See "):
        marker_index = error_message.find(marker)
        if marker_index >= 0 and "_beeline_runtime" in error_message[marker_index:]:
            return error_message[:marker_index].rstrip()
    return error_message


def update_job_state(
    project_dir: Path,
    job_id: str,
    *,
    overall_status: str | None = None,
    algorithm_id: str | None = None,
    task_status: str | None = None,
    elapsed_seconds: int | None = None,
    error_message: str | None = None,
    error_type: str | None = None,
    diagnostics_path: str | None = None,
    result_path: str | None = None,
    progress_percent: int | None = None,
    progress_label: str | None = None,
    estimated_remaining_seconds: int | None = None,
    estimated_remaining_min_seconds: int | None = None,
    estimated_remaining_max_seconds: int | None = None,
    started_at: str | None = None,
    started_at_timestamp: float | None = None,
    completed_at: str | None = None,
    completed_at_timestamp: float | None = None,
    process_pid: int | None = None,
    run_metadata: dict[str, dict] | None = None,
) -> None:
    with JOB_FILE_LOCK, jobs_manifest_lock(project_dir):
        jobs_manifest = read_jobs_manifest(project_dir)

        for job in jobs_manifest:
            if job.get("job_id") != job_id:
                continue

            if overall_status is not None:
                job["overall_status"] = overall_status

            if algorithm_id is not None:
                for task in job.get("tasks", []):
                    if task.get("algorithm_id") != algorithm_id:
                        continue

                    if task_status is not None:
                        task["status"] = task_status
                    if elapsed_seconds is not None:
                        task["elapsed_seconds"] = elapsed_seconds
                    if error_message is not None or task_status == "Failed":
                        task["error_message"] = error_message
                    if error_type is not None:
                        task["error_type"] = error_type
                    elif task_status in {"Queued", "Running", "Completed", "Stopped"}:
                        task["error_type"] = None
                    if diagnostics_path is not None:
                        task["diagnostics_path"] = diagnostics_path
                    if result_path is not None:
                        task["result_path"] = result_path
                    if progress_percent is not None:
                        task["progress_percent"] = progress_percent
                    if progress_label is not None:
                        task["progress_label"] = progress_label
                    if estimated_remaining_seconds is not None:
                        task["estimated_remaining_seconds"] = estimated_remaining_seconds
                    if estimated_remaining_min_seconds is not None:
                        task["estimated_remaining_min_seconds"] = estimated_remaining_min_seconds
                    if estimated_remaining_max_seconds is not None:
                        task["estimated_remaining_max_seconds"] = estimated_remaining_max_seconds
                    if estimated_remaining_seconds == 0 and task_status in {
                        "Completed",
                        "Failed",
                        "Stopped",
                    }:
                        task["estimated_remaining_min_seconds"] = 0
                        task["estimated_remaining_max_seconds"] = 0
                    if started_at is not None:
                        task["started_at"] = started_at
                    if started_at_timestamp is not None:
                        task["started_at_timestamp"] = started_at_timestamp
                    if completed_at is not None:
                        task["completed_at"] = completed_at
                    if completed_at_timestamp is not None:
                        task["completed_at_timestamp"] = completed_at_timestamp
                    if run_metadata is not None:
                        task["run_metadata"] = run_metadata
                    if process_pid is not None:
                        if process_pid > 0:
                            task["process_pid"] = process_pid
                        else:
                            task.pop("process_pid", None)
                    break

            write_jobs_manifest(project_dir, jobs_manifest)
            return


def get_task_state(project_dir: Path, job_id: str, algorithm_id: str) -> dict | None:
    jobs_manifest = read_jobs_manifest(project_dir)
    for job in jobs_manifest:
        if job.get("job_id") != job_id:
            continue
        for task in job.get("tasks", []):
            if task.get("algorithm_id") == algorithm_id:
                return task
    return None


def get_job_state(project_dir: Path, job_id: str) -> dict | None:
    jobs_manifest = read_jobs_manifest(project_dir)
    for job in jobs_manifest:
        if isinstance(job, dict) and job.get("job_id") == job_id:
            return job
    return None


def reset_task_for_rerun(project_dir: Path, job_id: str, algorithm_id: str) -> None:
    with JOB_FILE_LOCK, jobs_manifest_lock(project_dir):
        jobs_manifest = read_jobs_manifest(project_dir)
        for job in jobs_manifest:
            if job.get("job_id") != job_id:
                continue

            for task in job.get("tasks", []):
                if task.get("algorithm_id") != algorithm_id:
                    continue

                task["status"] = "Queued"
                task["elapsed_seconds"] = 0
                task["error_message"] = None
                task["error_type"] = None
                task["result_path"] = None
                task["diagnostics_path"] = None
                task["started_at"] = None
                task["started_at_timestamp"] = None
                task["completed_at"] = None
                task["completed_at_timestamp"] = None
                task["progress_percent"] = 0
                task["progress_label"] = "Queued"
                task.pop("estimated_remaining_seconds", None)
                task.pop("estimated_remaining_min_seconds", None)
                task.pop("estimated_remaining_max_seconds", None)
                task.pop("process_pid", None)
                clear_algorithm_result_artifacts(project_dir, algorithm_id)
                break

            job["overall_status"] = "Running"
            job.pop("notification_sent_at", None)
            job.pop("notification_started_at", None)
            job.pop("notification_error", None)
            job.pop("notification_attempted_at", None)
            write_jobs_manifest(project_dir, jobs_manifest)
            return


def send_job_completion_notification_if_needed(project_dir: Path, job_id: str) -> None:
    try:
        project_manifest = read_project_manifest(project_dir)
    except FileNotFoundError:
        return

    notification_email = normalize_notification_email(
        project_manifest.get("notification_email")
    )
    if not notification_email:
        return

    now_display = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    job_snapshot: dict | None = None

    with JOB_FILE_LOCK, jobs_manifest_lock(project_dir):
        jobs_manifest = read_jobs_manifest(project_dir)

        for job in jobs_manifest:
            if job.get("job_id") != job_id:
                continue

            if job.get("overall_status") not in TERMINAL_JOB_STATUSES:
                return
            if (
                job.get("notification_sent_at")
                or job.get("notification_started_at")
                or job.get("notification_error")
            ):
                return

            if not smtp_is_configured():
                job["notification_error"] = "Email notification is not configured on the server."
                job["notification_attempted_at"] = now_display
                write_jobs_manifest(project_dir, jobs_manifest)
                return

            job["notification_started_at"] = now_display
            job_snapshot = dict(job)
            job_snapshot["tasks"] = [dict(task) for task in job.get("tasks", [])]
            write_jobs_manifest(project_dir, jobs_manifest)
            break

    if job_snapshot is None:
        return

    tasks = job_snapshot.get("tasks", [])
    completed_count = sum(1 for task in tasks if task.get("status") == "Completed")
    failed_count = sum(1 for task in tasks if task.get("status") == "Failed")
    stopped_count = sum(1 for task in tasks if task.get("status") == "Stopped")

    try:
        send_job_completion_email(
            to_email=notification_email,
            project_id=str(project_manifest.get("project_id") or project_dir.name),
            project_name=str(project_manifest.get("project_name") or project_dir.name),
            job_status=str(job_snapshot.get("overall_status") or "Completed"),
            completed_count=completed_count,
            failed_count=failed_count,
            stopped_count=stopped_count,
            total_count=len(tasks),
        )
    except Exception as exc:
        with JOB_FILE_LOCK, jobs_manifest_lock(project_dir):
            jobs_manifest = read_jobs_manifest(project_dir)
            for job in jobs_manifest:
                if job.get("job_id") != job_id:
                    continue
                job.pop("notification_started_at", None)
                job["notification_error"] = str(exc)
                job["notification_attempted_at"] = time.strftime(
                    "%Y-%m-%d %H:%M:%S",
                    time.localtime(),
                )
                write_jobs_manifest(project_dir, jobs_manifest)
                return
        return

    with JOB_FILE_LOCK, jobs_manifest_lock(project_dir):
        jobs_manifest = read_jobs_manifest(project_dir)
        for job in jobs_manifest:
            if job.get("job_id") != job_id:
                continue
            job.pop("notification_started_at", None)
            job.pop("notification_error", None)
            job["notification_sent_at"] = time.strftime(
                "%Y-%m-%d %H:%M:%S",
                time.localtime(),
            )
            write_jobs_manifest(project_dir, jobs_manifest)
            return


def recompute_overall_status(project_dir: Path, job_id: str) -> None:
    should_check_notification = False

    with JOB_FILE_LOCK, jobs_manifest_lock(project_dir):
        jobs_manifest = read_jobs_manifest(project_dir)

        for job in jobs_manifest:
            if job.get("job_id") != job_id:
                continue

            tasks = job.get("tasks", [])
            statuses = [task.get("status") for task in tasks]

            if job.get("setup_error_message"):
                job["overall_status"] = "SetupFailed"
            elif any(status == "Running" for status in statuses) or any(
                status == "Stopping" for status in statuses
            ):
                job["overall_status"] = "Running"
            elif any(status == "Queued" for status in statuses):
                job["overall_status"] = "Queued"
            elif any(status == "Failed" for status in statuses):
                job["overall_status"] = "Failed"
            elif statuses and all(status == "Completed" for status in statuses):
                job["overall_status"] = "Completed"
            elif statuses and all(status == "Stopped" for status in statuses):
                job["overall_status"] = "Stopped"
            elif statuses and all(status in {"Completed", "Stopped"} for status in statuses):
                job["overall_status"] = "Completed"
            else:
                job["overall_status"] = "Stopped"

            should_check_notification = job["overall_status"] in TERMINAL_JOB_STATUSES
            write_jobs_manifest(project_dir, jobs_manifest)
            break

    if should_check_notification:
        send_job_completion_notification_if_needed(project_dir, job_id)


def run_single_algorithm_task(project_id: str, job_id: str, algorithm_id: str) -> None:
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        return

    if not prepare_project_dataset_for_algorithms(project_id, job_id):
        clear_task_control(project_id, job_id, algorithm_id)
        return

    control = get_or_create_task_control(project_id, job_id, algorithm_id)
    if control.stop_event.is_set():
        completed_at_timestamp = time.time()
        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            task_status="Stopped",
            elapsed_seconds=0,
            progress_percent=0,
            progress_label="Stopped",
            estimated_remaining_seconds=0,
            completed_at=format_runtime_timestamp(completed_at_timestamp),
            completed_at_timestamp=completed_at_timestamp,
            process_pid=0,
        )
        recompute_overall_status(project_dir, job_id)
        clear_task_control(project_id, job_id, algorithm_id)
        return

    started_at_timestamp = time.time()
    started_at = format_runtime_timestamp(started_at_timestamp)
    update_job_state(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        task_status="Running",
        elapsed_seconds=0,
        error_message=None,
        progress_percent=1,
        progress_label="Starting",
        started_at=started_at,
        started_at_timestamp=started_at_timestamp,
    )
    recompute_overall_status(project_dir, job_id)

    try:
        project_manifest = read_project_manifest(project_dir)
        job_snapshot = get_job_state(project_dir, job_id) or {}
        resolved_parameters = job_snapshot.get("resolved_algorithm_parameters")
        if isinstance(resolved_parameters, dict):
            # Execute from the immutable job snapshot. This prevents a later
            # registry-default or project-setting change from altering reruns.
            project_manifest = {
                **project_manifest,
                "algorithm_parameters": resolved_parameters,
            }
        else:
            # Compatibility for jobs created before full snapshots existed.
            legacy_overrides = job_snapshot.get("algorithm_parameters")
            if isinstance(legacy_overrides, dict):
                project_manifest = {
                    **project_manifest,
                    "algorithm_parameters": legacy_overrides,
                }

        algorithm_run_parameters = (
            (project_manifest.get("algorithm_parameters") or {}).get(algorithm_id)
            or {}
        )
        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            elapsed_seconds=0,
            progress_percent=2,
            progress_label="Validating dataset",
            estimated_remaining_seconds=None,
        )

        scopes = build_algorithm_scopes(project_manifest)
        has_cluster_scopes = any(scope.scope_type == "cluster" for scope in scopes)
        runnable_scopes = [scope for scope in scopes if not scope.skipped]
        skipped_scopes = [scope for scope in scopes if scope.skipped]
        completed_scope_results: dict[str, dict] = {}

        total_runnable_scopes = max(1, len(runnable_scopes))
        for scope_index, scope in enumerate(runnable_scopes, start=1):
            if control.stop_event.is_set():
                raise AlgorithmStoppedError("Algorithm run was stopped.")

            scope_manifest = prepare_scope_manifest(
                project_dir,
                project_manifest,
                scope,
                has_cluster_scopes=has_cluster_scopes,
            )
            runtime_key = (
                f"{algorithm_id}__{scope.scope_id}" if has_cluster_scopes else None
            )

            def scoped_update_job_state(
                scoped_project_dir: Path,
                scoped_job_id: str,
                **kwargs,
            ) -> None:
                progress_percent = kwargs.get("progress_percent")
                if progress_percent is not None and total_runnable_scopes > 1:
                    scaled_percent = round(
                        2
                        + (
                            (scope_index - 1)
                            + (max(0, min(100, int(progress_percent))) / 100)
                        )
                        * (96 / total_runnable_scopes)
                    )
                    kwargs["progress_percent"] = max(1, min(98, scaled_percent))

                progress_label = kwargs.get("progress_label")
                if progress_label and total_runnable_scopes > 1:
                    kwargs["progress_label"] = (
                        f"{scope.label}: {progress_label} "
                        f"({scope_index}/{total_runnable_scopes})"
                    )

                update_job_state(scoped_project_dir, scoped_job_id, **kwargs)

            beeline_result = run_beeline_with_progress(
                project_id,
                job_id,
                algorithm_id,
                scoped_update_job_state,
                stop_event=control.stop_event,
                on_process_start=lambda process: set_task_process(
                    project_id,
                    job_id,
                    algorithm_id,
                    process,
                ),
                elapsed_started_at=started_at_timestamp,
                project_manifest_override=scope_manifest,
                runtime_key=runtime_key,
                scope_label=scope.label,
            )
            beeline_result = archive_beeline_result_artifacts(
                project_dir,
                algorithm_id,
                beeline_result,
                scope_id=scope.scope_id if has_cluster_scopes else None,
            )
            completed_scope_results[scope.scope_id] = scope_result_payload(
                scope,
                beeline_result,
            )

        completed_at_timestamp = time.time()
        elapsed = int(completed_at_timestamp - started_at_timestamp)
        completed_at = format_runtime_timestamp(completed_at_timestamp)
        for scope in skipped_scopes:
            completed_scope_results[scope.scope_id] = skipped_scope_payload(scope)

        primary_scope_id = "global" if "global" in completed_scope_results else next(
            iter(completed_scope_results)
        )
        primary_scope_result = completed_scope_results[primary_scope_id]

        actual_result = {
            "project_id": project_id,
            "job_id": job_id,
            "algorithm_id": algorithm_id,
            "algorithm_parameters": algorithm_run_parameters,
            "status": "Completed",
            "started_at": started_at,
            "started_at_timestamp": started_at_timestamp,
            "generated_at": completed_at,
            "completed_at": completed_at,
            "completed_at_timestamp": completed_at_timestamp,
            "elapsed_seconds": elapsed,
            "algorithm_preprocessing": primary_scope_result.get(
                "algorithm_preprocessing"
            ),
            "network_summary": primary_scope_result["network_summary"],
            "top_edges": primary_scope_result["top_edges"],
            "confidence_summary": primary_scope_result.get("confidence_summary"),
            "run_ranked_edges_paths": primary_scope_result.get("run_ranked_edges_paths"),
            "run_diagnostics_root": primary_scope_result.get("run_diagnostics_root"),
            "beeline_runtime_root": primary_scope_result["beeline_runtime_root"],
            "result_artifact_root": primary_scope_result.get("result_artifact_root"),
            "ranked_edges_path": primary_scope_result["ranked_edges_path"],
            "scope_order": [scope.scope_id for scope in scopes],
            "scopes": completed_scope_results,
        }

        saved_result_path = write_algorithm_result(
            project_dir,
            algorithm_id,
            actual_result,
        )

        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            task_status="Completed",
            elapsed_seconds=elapsed,
            error_message=None,
            result_path=saved_result_path,
            progress_percent=100,
            progress_label="Completed",
            estimated_remaining_seconds=0,
            completed_at=completed_at,
            completed_at_timestamp=completed_at_timestamp,
            process_pid=0,
        )
    except AlgorithmStoppedError:
        completed_at_timestamp = time.time()
        elapsed = int(completed_at_timestamp - started_at_timestamp)
        completed_at = format_runtime_timestamp(completed_at_timestamp)
        cleanup_algorithm_runtime(project_id, algorithm_id)
        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            task_status="Stopped",
            elapsed_seconds=elapsed,
            error_message=None,
            progress_percent=0,
            progress_label="Stopped",
            estimated_remaining_seconds=0,
            completed_at=completed_at,
            completed_at_timestamp=completed_at_timestamp,
            process_pid=0,
        )
    except MatrixValidationRuntimeError as exc:
        mark_project_setup_failure(
            project_dir,
            job_id,
            str(exc),
            error_type="matrix_validation",
        )
    except Exception as exc:
        completed_at_timestamp = time.time()
        elapsed = int(completed_at_timestamp - started_at_timestamp)
        error_message = str(exc)
        diagnostics_path = archive_task_failure_diagnostics(
            project_dir,
            project_id,
            job_id,
            algorithm_id,
            error_message=error_message,
            error_type="algorithm",
            started_at_timestamp=started_at_timestamp,
            completed_at_timestamp=completed_at_timestamp,
            elapsed_seconds=elapsed,
        )
        error_message = user_error_message_after_archiving(
            error_message,
            diagnostics_path,
        )
        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            task_status="Failed",
            elapsed_seconds=elapsed,
            progress_percent=0,
            progress_label="Failed",
            error_message=error_message,
            error_type="algorithm",
            diagnostics_path=diagnostics_path,
            estimated_remaining_seconds=0,
            completed_at=format_runtime_timestamp(completed_at_timestamp),
            completed_at_timestamp=completed_at_timestamp,
            process_pid=0,
        )
    finally:
        clear_task_control(project_id, job_id, algorithm_id)
        recompute_overall_status(project_dir, job_id)


def run_algorithm_task_with_slot(project_id: str, job_id: str, algorithm_id: str) -> None:
    control = get_or_create_task_control(project_id, job_id, algorithm_id)

    while not control.stop_event.is_set():
        if ALGORITHM_TASK_SEMAPHORE.acquire(timeout=0.5):
            break
    else:
        run_single_algorithm_task(project_id, job_id, algorithm_id)
        return

    try:
        run_single_algorithm_task(project_id, job_id, algorithm_id)
    finally:
        ALGORITHM_TASK_SEMAPHORE.release()


def launch_independent_algorithm_tasks(
    project_id: str,
    job_id: str,
    selected_algorithms_list: list[str],
) -> None:
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        return

    if not prepare_project_dataset_for_algorithms(project_id, job_id):
        return

    update_job_state(project_dir, job_id, overall_status="Running")

    for algorithm_id in sort_algorithm_ids_by_difficulty(selected_algorithms_list):
        get_or_create_task_control(project_id, job_id, algorithm_id)
        worker = threading.Thread(
            target=run_algorithm_task_with_slot,
            args=(project_id, job_id, algorithm_id),
            daemon=True,
        )
        worker.start()


def run_algorithm_job_worker(
    project_id: str,
    job_id: str,
    selected_algorithms_list: list[str],
) -> None:
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        return

    if not prepare_project_dataset_for_algorithms(project_id, job_id):
        return

    update_job_state(project_dir, job_id, overall_status="Running")

    for algorithm_id in sort_algorithm_ids_by_difficulty(selected_algorithms_list):
        task = get_task_state(project_dir, job_id, algorithm_id)
        if task is None:
            continue
        if task.get("status") in TERMINAL_JOB_STATUSES:
            continue
        if task.get("status") == "Stopping":
            continue

        get_or_create_task_control(project_id, job_id, algorithm_id)
        run_single_algorithm_task(project_id, job_id, algorithm_id)

    recompute_overall_status(project_dir, job_id)


def request_algorithm_task_stop(
    project_id: str,
    job_id: str,
    algorithm_id: str,
) -> tuple[dict, int | None]:
    """Fast path: set the stop event, flip state to Stopping (or Stopped for
    Queued tasks), and return (task, fallback_pid). Container/process teardown
    should be finished by ``finalize_algorithm_task_stop`` off the request
    loop."""
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        raise FileNotFoundError("Project not found.")

    task = get_task_state(project_dir, job_id, algorithm_id)
    if task is None:
        raise FileNotFoundError("Algorithm task not found.")

    status = task.get("status")
    if status in {"Completed", "Failed", "Stopped"}:
        return task, None

    control = get_or_create_task_control(project_id, job_id, algorithm_id)
    control.stop_event.set()

    update_job_state(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        task_status="Stopping",
        progress_label="Stopping",
    )

    task_pid = task.get("process_pid")
    fallback_pid = int(task_pid) if isinstance(task_pid, int) else None

    # A running worker owns its runtime until it has recorded the stopped run
    # metadata. Deleting it here races with ``write_run_timings`` when the API
    # and worker are separate service processes. Queued tasks have no worker,
    # so their unused runtime can still be removed immediately.
    if status == "Queued":
        completed_at_timestamp = time.time()
        cleanup_algorithm_runtime(project_id, algorithm_id)
        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            task_status="Stopped",
            progress_percent=0,
            progress_label="Stopped",
            estimated_remaining_seconds=0,
            completed_at=format_runtime_timestamp(completed_at_timestamp),
            completed_at_timestamp=completed_at_timestamp,
            process_pid=0,
        )
        recompute_overall_status(project_dir, job_id)
        return get_task_state(project_dir, job_id, algorithm_id) or task, None

    return get_task_state(project_dir, job_id, algorithm_id) or task, fallback_pid


def finalize_algorithm_task_stop(
    project_id: str,
    job_id: str,
    algorithm_id: str,
    fallback_pid: int | None,
) -> None:
    """Slow path: kill Docker containers and the worker process. Safe to run
    outside the request loop (background task or threadpool)."""
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        return

    control = get_or_create_task_control(project_id, job_id, algorithm_id)
    try:
        terminate_algorithm_docker_containers(project_id, algorithm_id)
    except Exception:
        pass
    try:
        terminate_process(control.process, fallback_pid=fallback_pid)
    except Exception:
        pass

    recompute_overall_status(project_dir, job_id)


def stop_algorithm_task(project_id: str, job_id: str, algorithm_id: str) -> dict:
    """Synchronous stop — runs both the fast state flip and the slow teardown
    inline. Kept for callers (project delete, tests) that need the full effect
    to complete before returning."""
    task, fallback_pid = request_algorithm_task_stop(project_id, job_id, algorithm_id)
    if fallback_pid is not None or task.get("status") == "Stopping":
        finalize_algorithm_task_stop(project_id, job_id, algorithm_id, fallback_pid)
    project_dir = PROJECTS_ROOT / project_id
    return get_task_state(project_dir, job_id, algorithm_id) or task


def request_project_stop(project_id: str) -> dict:
    """Fast path: for every running/queued algorithm task across all
    non-terminal jobs, flip state to Stopping (or Stopped for Queued) and cancel
    any Redis-queued jobs for this project. Returns a summary plus the list of
    (job_id, algorithm_id, fallback_pid) targets whose Docker containers still
    need to be terminated by ``finalize_project_stop``."""
    from .worker_queue import cancel_project_queue_jobs

    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        raise FileNotFoundError("Project not found.")

    jobs_manifest = read_jobs_manifest(project_dir)
    stopping_targets: list[tuple[str, str, int | None]] = []

    for job in jobs_manifest:
        if job.get("overall_status") in TERMINAL_JOB_STATUSES:
            continue
        job_id = job.get("job_id")
        if not job_id:
            continue
        for task in job.get("tasks", []):
            status = task.get("status")
            if status in {"Completed", "Failed", "Stopped", "NotStarted"}:
                continue
            algo_id = task.get("algorithm_id")
            if not algo_id:
                continue
            try:
                task_after, fallback_pid = request_algorithm_task_stop(
                    project_id, job_id, algo_id,
                )
            except Exception:
                continue
            if task_after.get("status") == "Stopping":
                stopping_targets.append((job_id, algo_id, fallback_pid))

    try:
        cancelled_queue_jobs = cancel_project_queue_jobs(project_id)
    except Exception:
        cancelled_queue_jobs = 0

    return {
        "project_id": project_id,
        "stopping_targets": stopping_targets,
        "cancelled_queue_jobs": cancelled_queue_jobs,
    }


def finalize_project_stop(
    project_id: str,
    stopping_targets: list[tuple[str, str, int | None]],
) -> None:
    """Slow path: kill Docker containers and worker processes for each target
    scheduled by ``request_project_stop``. Safe to run in a background task."""
    for job_id, algo_id, fallback_pid in stopping_targets:
        try:
            finalize_algorithm_task_stop(project_id, job_id, algo_id, fallback_pid)
        except Exception:
            continue


def stop_and_delete_project(project_id: str) -> None:
    """Synchronous stop + rmtree used by DELETE /api/projects/{id}. Runs the
    full teardown inline so containers and worker processes have released the
    project directory before it is removed."""
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        return

    try:
        summary = request_project_stop(project_id)
    except FileNotFoundError:
        summary = {"stopping_targets": []}
    finalize_project_stop(project_id, summary.get("stopping_targets", []))

    shutil.rmtree(project_dir, ignore_errors=True)


def prepare_algorithm_task_for_rerun(
    project_id: str,
    job_id: str,
    algorithm_id: str,
) -> dict:
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        raise FileNotFoundError("Project not found.")

    task = get_task_state(project_dir, job_id, algorithm_id)
    if task is None:
        raise FileNotFoundError("Algorithm task not found.")

    if task.get("status") in {"Queued", "Running", "Stopping"}:
        raise RuntimeError("Algorithm is already running.")

    clear_task_control(project_id, job_id, algorithm_id)
    get_or_create_task_control(project_id, job_id, algorithm_id)
    reset_task_for_rerun(project_dir, job_id, algorithm_id)
    recompute_overall_status(project_dir, job_id)

    return get_task_state(project_dir, job_id, algorithm_id) or task


def launch_algorithm_rerun_thread(
    project_id: str,
    job_id: str,
    algorithm_id: str,
) -> None:
    worker = threading.Thread(
        target=run_single_algorithm_task,
        args=(project_id, job_id, algorithm_id),
        daemon=True,
    )
    worker.start()


def rerun_algorithm_task(project_id: str, job_id: str, algorithm_id: str) -> dict:
    task = prepare_algorithm_task_for_rerun(project_id, job_id, algorithm_id)
    launch_algorithm_rerun_thread(project_id, job_id, algorithm_id)
    return task
