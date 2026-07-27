"""Estimate a pseudotime trajectory for projects that were uploaded without one.

Runs the standalone Slingshot container (``grnbeeline/slingshot``) against a
project's ExpressionData (and optional ClusterLabels), and on success installs
the produced ``PseudoTime.csv`` as the project's pseudotime — flagged as
*estimated* — which unlocks the trajectory-based GRN algorithms.

Status for the (single, per-project) estimation is tracked in
``pseudotime_estimation.json`` in the project directory, mirroring how
perturbation runs keep their own status files.
"""

from __future__ import annotations

import fcntl
import os
import re
import shutil
import subprocess
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from ..atomic_io import atomic_write_json
from ..config import PROJECTS_ROOT
from ..repositories.project_repository import read_project_manifest, write_project_manifest
from .matrix_transformation_service import (
    MatrixTransformationError,
    matrix_transformation_signature,
    transform_expression_matrix,
)

STATUS_FILENAME = "pseudotime_estimation.json"
RUNTIME_DIRNAME = "_pseudotime_runtime"
ACTIVE_STATUSES = {"Queued", "Running"}
DEFAULT_IMAGE = "grnbeeline/slingshot:0.1.0"
PSEUDOTIME_INPUT_CONTRACT_VERSION = 2
SLINGSHOT_RUNTIME_MATRIX_STATE = "log_normalized"
_CONTAINER_NAME_UNSAFE = re.compile(r"[^A-Za-z0-9_.-]+")


def slingshot_image() -> str:
    return os.environ.get("GRNSCOPE_SLINGSHOT_IMAGE", DEFAULT_IMAGE).strip() or DEFAULT_IMAGE


def docker_cli_available() -> bool:
    return shutil.which("docker") is not None


def _container_name(project_id: str) -> str:
    safe = _CONTAINER_NAME_UNSAFE.sub("-", project_id).strip("-") or "project"
    return f"grnscope-pseudotime-{safe}"


def _status_path(project_dir: Path) -> Path:
    return project_dir / STATUS_FILENAME


def _now() -> tuple[str, float]:
    timestamp = time.time()
    iso = datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()
    return iso, timestamp


def read_estimation_status(project_dir: Path) -> dict | None:
    path = _status_path(project_dir)
    if not path.is_file():
        return None
    try:
        import json

        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_status(project_dir: Path, status: dict) -> None:
    atomic_write_json(_status_path(project_dir), status)


def project_matrix_state(manifest: dict) -> str:
    preprocessing = manifest.get("preprocessing") or {}
    matrix_state = str(preprocessing.get("matrix_state") or "").strip().lower()
    try:
        matrix_transformation_signature(matrix_state)
    except MatrixTransformationError as exc:
        raise PseudotimeEstimationError(str(exc)) from exc
    return matrix_state


def _input_path_signature(path: Path) -> dict:
    stat = path.stat()
    return {
        "path": str(path.resolve()),
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
    }


def build_pseudotime_input_signature(
    manifest: dict,
    *,
    start_cluster: str | None,
) -> dict:
    expression_value = manifest.get("expression_path")
    if not expression_value:
        raise PseudotimeEstimationError(
            "This project has no expression matrix to estimate pseudotime from."
        )
    expression_path = Path(str(expression_value))
    if not expression_path.exists():
        raise PseudotimeEstimationError(
            "This project has no expression matrix to estimate pseudotime from."
        )

    matrix_state = project_matrix_state(manifest)
    cluster_signature = None
    cluster_value = manifest.get("cluster_labels_path")
    if cluster_value:
        cluster_path = Path(str(cluster_value))
        if cluster_path.exists():
            cluster_signature = _input_path_signature(cluster_path)

    return {
        "version": PSEUDOTIME_INPUT_CONTRACT_VERSION,
        "source_expression": _input_path_signature(expression_path),
        "matrix_transformation": matrix_transformation_signature(matrix_state),
        "cluster_labels": cluster_signature,
        "start_cluster": (start_cluster or "").strip() or None,
        "slingshot_image": slingshot_image(),
        "slingshot_runtime_matrix_state": SLINGSHOT_RUNTIME_MATRIX_STATE,
    }


def prepare_pseudotime_expression(
    manifest: dict,
    destination_expression: Path,
) -> dict:
    expression_value = manifest.get("expression_path")
    if not expression_value:
        raise PseudotimeEstimationError(
            "This project has no expression matrix to estimate pseudotime from."
        )
    expression_path = Path(str(expression_value))
    if not expression_path.exists():
        raise PseudotimeEstimationError(
            "This project has no expression matrix to estimate pseudotime from."
        )
    return transform_expression_matrix(
        source_expression=expression_path,
        destination_expression=destination_expression,
        matrix_state=project_matrix_state(manifest),
    )


def estimated_pseudotime_is_current(
    project_dir: Path,
    manifest: dict,
    status: dict | None = None,
) -> bool:
    pseudotime_value = manifest.get("pseudotime_path")
    if not pseudotime_value or not Path(str(pseudotime_value)).exists():
        return False
    if not bool(manifest.get("pseudotime_estimated")):
        return True

    active_status = status or read_estimation_status(project_dir) or {}
    start_cluster = (
        active_status.get("start_cluster")
        or manifest.get("pseudotime_start_cluster")
        or None
    )
    try:
        expected = build_pseudotime_input_signature(
            manifest,
            start_cluster=start_cluster,
        )
    except (OSError, PseudotimeEstimationError):
        return False
    return (
        active_status.get("status") == "Completed"
        and active_status.get("input_signature") == expected
    )


def _clear_outdated_estimated_pseudotime(
    project_dir: Path,
    manifest: dict,
) -> dict:
    updated = dict(manifest)
    updated["pseudotime_path"] = None
    updated["pseudotime_estimated"] = False
    updated.pop("pseudotime_input_contract", None)
    write_project_manifest(project_dir, updated)
    _update_metadata(
        project_dir,
        {
            "has_pseudotime": False,
            "pseudotime_estimated": False,
            "pseudotime_filename": None,
        },
    )
    return updated


def get_pseudotime_estimation_state(project_dir: Path) -> dict:
    """Compact status for the API/poll. Reports whether estimation is available
    (Docker present, an expression matrix exists, no user-provided pseudotime)
    plus the current run status."""
    status = read_estimation_status(project_dir) or {"status": "NotStarted"}
    manifest = {}
    try:
        manifest = read_project_manifest(project_dir)
    except Exception:
        manifest = {}

    has_pseudotime = bool(manifest.get("pseudotime_path"))
    is_estimated = bool(status.get("estimated")) and has_pseudotime

    return {
        "status": status.get("status", "NotStarted"),
        "error_message": status.get("error_message"),
        "start_cluster": status.get("start_cluster"),
        "lineage_count": status.get("lineage_count"),
        "matrix_state": (
            (status.get("input_signature") or {})
            .get("matrix_transformation", {})
            .get("matrix_state")
        ),
        "applied_operations": (
            (status.get("input_signature") or {})
            .get("matrix_transformation", {})
            .get("operations")
        ),
        "input_contract_version": (
            (status.get("input_signature") or {}).get("version")
        ),
        "started_at": status.get("started_at"),
        "completed_at": status.get("completed_at"),
        "has_pseudotime": has_pseudotime,
        "is_estimated": is_estimated,
        "docker_available": docker_cli_available(),
    }


class PseudotimeEstimationError(RuntimeError):
    """Raised for user-facing validation failures when starting estimation."""


def start_pseudotime_estimation(project_id: str, start_cluster: str | None = None) -> dict:
    """Validate and kick off an estimation. Returns the initial status.

    Raises PseudotimeEstimationError for conditions the caller should surface as
    a 4xx (already running, no expression, user pseudotime already present,
    Docker unavailable).
    """
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        raise FileNotFoundError("Project not found.")

    manifest = read_project_manifest(project_dir)

    existing = read_estimation_status(project_dir)
    if existing and existing.get("status") in ACTIVE_STATUSES:
        raise PseudotimeEstimationError("Pseudotime estimation is already running.")

    expression_path = manifest.get("expression_path")
    if not expression_path or not Path(str(expression_path)).exists():
        raise PseudotimeEstimationError(
            "This project has no expression matrix to estimate pseudotime from."
        )

    # Never overwrite a pseudotime the user uploaded themselves.
    if manifest.get("pseudotime_path") and not bool(
        manifest.get("pseudotime_estimated")
    ):
        raise PseudotimeEstimationError(
            "This project already has a pseudotime file. Remove it before estimating."
        )

    if not docker_cli_available():
        raise PseudotimeEstimationError(
            "Pseudotime estimation is unavailable because Docker is not accessible on the server."
        )

    normalized_start = (start_cluster or "").strip() or None
    if (
        manifest.get("pseudotime_path")
        and bool(manifest.get("pseudotime_estimated"))
        and not estimated_pseudotime_is_current(project_dir, manifest, existing)
    ):
        manifest = _clear_outdated_estimated_pseudotime(project_dir, manifest)
    input_signature = build_pseudotime_input_signature(
        manifest,
        start_cluster=normalized_start,
    )
    started_at, started_timestamp = _now()
    status = {
        "status": "Running",
        "start_cluster": normalized_start,
        "started_at": started_at,
        "started_at_timestamp": started_timestamp,
        "completed_at": None,
        "completed_at_timestamp": None,
        "error_message": None,
        "lineage_count": None,
        "estimated": True,
        "input_signature": input_signature,
    }
    _write_status(project_dir, status)

    from .worker_queue import queue_enabled

    if queue_enabled():
        from .worker_queue import enqueue_pseudotime_estimation

        enqueue_pseudotime_estimation(project_id)
    else:
        thread = threading.Thread(
            target=run_pseudotime_estimation_task,
            args=(project_id,),
            daemon=True,
        )
        thread.start()

    return get_pseudotime_estimation_state(project_dir)


def _friendly_error(stderr: str, stdout: str) -> str:
    # The container prints handled failures as `ERROR: ...` on stderr.
    for line in reversed((stderr or "").splitlines()):
        stripped = line.strip()
        if stripped.startswith("ERROR:"):
            return stripped[len("ERROR:"):].strip()
    for line in reversed((stderr or "").splitlines()):
        if line.strip():
            return line.strip()
    return (
        "Pseudotime estimation did not finish. Check that the dataset represents a "
        "continuous process, or provide your own pseudotime file."
    )


def run_pseudotime_estimation_task(project_id: str) -> None:
    """The actual work: prepare a run dir, run the Slingshot container, then
    install the result. Importable so the RQ worker can call it. Own error
    handling — it records terminal status rather than raising."""
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        return

    try:
        manifest = read_project_manifest(project_dir)
    except Exception:
        return

    runtime_dir = project_dir / RUNTIME_DIRNAME
    try:
        if runtime_dir.exists():
            shutil.rmtree(runtime_dir, ignore_errors=True)
        runtime_dir.mkdir(parents=True, exist_ok=True)

        runtime_expression = runtime_dir / "ExpressionData.csv"
        transformation = prepare_pseudotime_expression(
            manifest,
            runtime_expression,
        )

        cluster_labels_path = manifest.get("cluster_labels_path")
        has_clusters = bool(cluster_labels_path) and Path(str(cluster_labels_path)).exists()
        if has_clusters:
            shutil.copy2(Path(str(cluster_labels_path)), runtime_dir / "ClusterLabels.csv")

        status = read_estimation_status(project_dir) or {}
        start_cluster = status.get("start_cluster")
        input_signature = build_pseudotime_input_signature(
            manifest,
            start_cluster=start_cluster,
        )
        status["input_signature"] = input_signature
        status["input_transformation"] = transformation
        _write_status(project_dir, status)

        from .beeline_service import resolve_beeline_root

        slingshot_script = (
            resolve_beeline_root()
            / "Algorithms"
            / "SLINGSHOT"
            / "estimate_pseudotime.R"
        )
        if not slingshot_script.exists():
            raise FileNotFoundError("The Slingshot pseudotime runner is missing.")

        command = [
            "docker", "run", "--rm",
            "--name", _container_name(project_id),
            "-v", f"{runtime_dir.resolve()}:/data",
            "-v", f"{slingshot_script.resolve()}:/app/grnscope_estimate_pseudotime.R:ro",
            "--entrypoint", "Rscript",
            slingshot_image(),
            "/app/grnscope_estimate_pseudotime.R",
            "--expression", "/data/ExpressionData.csv",
            "--output", "/data/PseudoTime.csv",
            "--matrixState", SLINGSHOT_RUNTIME_MATRIX_STATE,
        ]
        if has_clusters:
            command += ["--clusters", "/data/ClusterLabels.csv"]
        if start_cluster:
            command += ["--startCluster", str(start_cluster)]

        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        (runtime_dir / "stdout.log").write_text(completed.stdout or "", encoding="utf-8")
        (runtime_dir / "stderr.log").write_text(completed.stderr or "", encoding="utf-8")

        output_file = runtime_dir / "PseudoTime.csv"
        if completed.returncode != 0 or not output_file.exists():
            _finalize_failure(project_dir, _friendly_error(completed.stderr, completed.stdout))
            return

        # Install the estimated pseudotime as the project's pseudotime.
        destination = project_dir / "PseudoTime.csv"
        shutil.copy2(output_file, destination)
        lineage_count = _parse_lineage_count(completed.stdout)
        _finalize_success(
            project_dir,
            destination,
            lineage_count,
            input_signature=input_signature,
            transformation=transformation,
        )
    except Exception as exc:  # pragma: no cover - defensive
        _finalize_failure(project_dir, f"Pseudotime estimation failed: {exc}")
    finally:
        shutil.rmtree(runtime_dir, ignore_errors=True)


def _parse_lineage_count(stdout: str) -> int | None:
    match = re.search(r"Recovered\s+(\d+)\s+lineage", stdout or "")
    return int(match.group(1)) if match else None


def _finalize_success(
    project_dir: Path,
    pseudotime_path: Path,
    lineage_count: int | None,
    *,
    input_signature: dict,
    transformation: dict,
) -> None:
    completed_at, completed_timestamp = _now()
    status = read_estimation_status(project_dir) or {}
    status.update({
        "status": "Completed",
        "completed_at": completed_at,
        "completed_at_timestamp": completed_timestamp,
        "error_message": None,
        "lineage_count": lineage_count,
        "estimated": True,
        "input_signature": input_signature,
        "input_transformation": transformation,
    })
    _write_status(project_dir, status)

    # Point the project at the estimated pseudotime and mark it available.
    try:
        manifest = read_project_manifest(project_dir)
        manifest["pseudotime_path"] = str(pseudotime_path)
        manifest["pseudotime_estimated"] = True
        manifest["pseudotime_input_contract"] = input_signature
        manifest["pseudotime_source_path"] = str(pseudotime_path)
        manifest.pop("pseudotime_canonicalization", None)
        write_project_manifest(project_dir, manifest)
    except Exception:
        pass

    _update_metadata(
        project_dir,
        {
            "has_pseudotime": True,
            "pseudotime_estimated": True,
            "pseudotime_filename": "PseudoTime.csv",
            "pseudotime_input_contract": input_signature,
        },
    )


def _finalize_failure(project_dir: Path, message: str) -> None:
    completed_at, completed_timestamp = _now()
    status = read_estimation_status(project_dir) or {}
    status.update({
        "status": "Failed",
        "completed_at": completed_at,
        "completed_at_timestamp": completed_timestamp,
        "error_message": message,
    })
    _write_status(project_dir, status)


def _update_metadata(project_dir: Path, changes: dict) -> None:
    import json

    metadata_path = project_dir / "metadata.json"
    metadata = {}
    if metadata_path.is_file():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except Exception:
            metadata = {}
    metadata.update(changes)
    try:
        atomic_write_json(metadata_path, metadata)
    except Exception:
        pass


@contextmanager
def _estimation_lock(project_dir: Path):
    project_dir.mkdir(parents=True, exist_ok=True)
    lock_path = project_dir / ".pseudotime.lock"
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def ensure_estimated_pseudotime(project_id: str) -> bool:
    """Run pseudotime estimation once, synchronously, under a lock.

    Called from the job's dataset-preparation step (see
    ``prepare_project_dataset_for_algorithms``). Safe to invoke from every
    parallel algorithm task: the first task through the lock does the work; the
    rest observe the finished pseudotime and return immediately. Returns True if
    a pseudotime file exists afterwards.
    """
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        return False

    with _estimation_lock(project_dir):
        try:
            manifest = read_project_manifest(project_dir)
        except Exception:
            return False

        # Uploaded pseudotime is authoritative. A generated file is reusable
        # only when its expression-scale contract and all trajectory inputs
        # still match.
        if manifest.get("pseudotime_path") and not bool(
            manifest.get("pseudotime_estimated")
        ):
            return True
        if estimated_pseudotime_is_current(project_dir, manifest):
            return True
        if manifest.get("pseudotime_path"):
            manifest = _clear_outdated_estimated_pseudotime(
                project_dir,
                manifest,
            )

        start_cluster = manifest.get("pseudotime_start_cluster") or None
        input_signature = build_pseudotime_input_signature(
            manifest,
            start_cluster=start_cluster,
        )
        started_at, started_timestamp = _now()
        _write_status(project_dir, {
            "status": "Running",
            "start_cluster": start_cluster,
            "started_at": started_at,
            "started_at_timestamp": started_timestamp,
            "completed_at": None,
            "completed_at_timestamp": None,
            "error_message": None,
            "lineage_count": None,
            "estimated": True,
            "input_signature": input_signature,
        })

        run_pseudotime_estimation_task(project_id)

        try:
            manifest = read_project_manifest(project_dir)
            status = read_estimation_status(project_dir) or {}
        except Exception:
            return False
        return estimated_pseudotime_is_current(project_dir, manifest, status)


def stop_pseudotime_estimation(project_id: str) -> dict:
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        raise FileNotFoundError("Project not found.")

    if docker_cli_available():
        try:
            subprocess.run(
                ["docker", "rm", "-f", _container_name(project_id)],
                capture_output=True,
                text=True,
                check=False,
                timeout=15,
            )
        except Exception:
            pass

    status = read_estimation_status(project_dir) or {}
    if status.get("status") in ACTIVE_STATUSES:
        completed_at, completed_timestamp = _now()
        status.update({
            "status": "Stopped",
            "completed_at": completed_at,
            "completed_at_timestamp": completed_timestamp,
            "error_message": "Pseudotime estimation was stopped.",
        })
        _write_status(project_dir, status)

    return get_pseudotime_estimation_state(project_dir)
