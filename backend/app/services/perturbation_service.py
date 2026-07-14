from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
import uuid

from ..config import PROJECTS_ROOT
from ..repositories.job_repository import read_jobs_manifest
from ..repositories.project_repository import read_project_manifest
from .beeline_service import (
    ensure_project_preprocessed_expression,
    parse_ranked_edges_csv,
    resolve_algorithm_image,
    resolve_beeline_root,
)
from .result_service import read_algorithm_result


PERTURBATION_LOCK = threading.Lock()
ACTIVE_STATUSES = {"Queued", "Preparing", "Running"}
DOWNLOAD_FILENAMES = {
    "affected_genes.csv",
    "cell_shifts.csv",
    "cluster_effects.csv",
}


def utc_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def perturbation_root(project_dir: Path) -> Path:
    root = project_dir / "perturbations"
    root.mkdir(parents=True, exist_ok=True)
    return root


def run_directory(project_dir: Path, run_id: str) -> Path:
    return perturbation_root(project_dir) / "runs" / run_id


def status_path(project_dir: Path, run_id: str) -> Path:
    return run_directory(project_dir, run_id) / "status.json"


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp-{os.getpid()}")
    temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temporary.replace(path)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def latest_celloracle_task(project_dir: Path) -> dict | None:
    jobs = read_jobs_manifest(project_dir)
    latest_job = jobs[-1] if jobs else None
    if not latest_job:
        return None
    return next(
        (
            task
            for task in latest_job.get("tasks", [])
            if str(task.get("algorithm_id", "")).upper() == "CELLORACLE"
        ),
        None,
    )


def celloracle_availability(project_dir: Path) -> tuple[bool, str | None]:
    task = latest_celloracle_task(project_dir)
    if task is None:
        return False, "Perturbation requires CellOracle to be selected for this project."
    status = str(task.get("status") or "")
    if status != "Completed":
        if status in {"Queued", "Running", "Stopping"}:
            return False, "Perturbation will be available when CellOracle completes."
        return False, "Perturbation requires a successful CellOracle result."
    try:
        result = read_algorithm_result(project_dir, "CELLORACLE")
    except FileNotFoundError:
        return False, "The completed CellOracle network file could not be found."
    ranked_path = result.get("ranked_edges_path")
    if not ranked_path or not Path(str(ranked_path)).exists():
        return False, "The completed CellOracle edge list could not be found."
    return True, None


def celloracle_result_and_edges(project_dir: Path) -> tuple[dict, Path]:
    result = read_algorithm_result(project_dir, "CELLORACLE")
    path_value = result.get("ranked_edges_path")
    if not path_value:
        raise FileNotFoundError("CellOracle ranked edge list is missing.")
    path = Path(str(path_value))
    if not path.exists():
        raise FileNotFoundError("CellOracle ranked edge list is missing.")
    return result, path


def eligible_perturbation_genes(project_dir: Path) -> list[str]:
    available, _reason = celloracle_availability(project_dir)
    if not available:
        return []
    _result, edge_path = celloracle_result_and_edges(project_dir)
    edges, _summary = parse_ranked_edges_csv(edge_path)
    outgoing_counts: dict[str, int] = {}
    for edge in edges:
        source = str(edge.get("source") or "").strip()
        if source:
            outgoing_counts[source] = outgoing_counts.get(source, 0) + 1
    return sorted(outgoing_counts, key=lambda gene: (-outgoing_counts[gene], gene.lower()))


def list_run_statuses(project_dir: Path) -> list[dict]:
    runs_root = perturbation_root(project_dir) / "runs"
    if not runs_root.exists():
        return []
    rows: list[dict] = []
    for path in runs_root.glob("*/status.json"):
        try:
            rows.append(read_json(path))
        except (OSError, json.JSONDecodeError):
            continue
    return sorted(rows, key=lambda row: float(row.get("created_at_timestamp") or 0), reverse=True)


def compact_run_status(status: dict) -> dict:
    allowed = {
        "run_id",
        "gene",
        "perturbation_value",
        "n_propagation",
        "clip_delta_x",
        "status",
        "progress_label",
        "error_message",
        "created_at",
        "created_at_timestamp",
        "started_at",
        "completed_at",
        "elapsed_seconds",
    }
    return {key: value for key, value in status.items() if key in allowed}


def get_perturbation_state(project_dir: Path) -> dict:
    available, reason = celloracle_availability(project_dir)
    runs = list_run_statuses(project_dir)
    latest_result = None
    for status in runs:
        if status.get("status") != "Completed":
            continue
        result_path = run_directory(project_dir, str(status["run_id"])) / "result.json"
        if result_path.exists():
            try:
                latest_result = read_json(result_path)
                latest_result["run_id"] = status["run_id"]
                latest_result["completed_at"] = status.get("completed_at")
            except (OSError, json.JSONDecodeError):
                latest_result = None
            break

    return {
        "available": available,
        "reason": reason,
        "eligible_genes": eligible_perturbation_genes(project_dir) if available else [],
        "runs": [compact_run_status(status) for status in runs[:20]],
        "latest_result": latest_result,
    }


def validate_perturbation_request(
    project_dir: Path,
    gene: str,
    perturbation_value: float,
    n_propagation: int,
) -> str:
    available, reason = celloracle_availability(project_dir)
    if not available:
        raise RuntimeError(reason or "CellOracle perturbation is unavailable.")
    normalized_gene = gene.strip()
    if not normalized_gene:
        raise ValueError("Select a gene to perturb.")
    if normalized_gene not in set(eligible_perturbation_genes(project_dir)):
        raise ValueError("The selected gene is not a regulator in the CellOracle network.")
    if perturbation_value < 0:
        raise ValueError("Perturbation value cannot be negative.")
    if not 1 <= n_propagation <= 5:
        raise ValueError("Propagation steps must be between 1 and 5.")
    if any(status.get("status") in ACTIVE_STATUSES for status in list_run_statuses(project_dir)):
        raise RuntimeError("A CellOracle perturbation is already running for this project.")
    return normalized_gene


def create_perturbation_run(
    project_dir: Path,
    *,
    gene: str,
    perturbation_value: float,
    n_propagation: int,
    clip_delta_x: bool,
) -> dict:
    with PERTURBATION_LOCK:
        normalized_gene = validate_perturbation_request(
            project_dir,
            gene,
            perturbation_value,
            n_propagation,
        )
        run_id = uuid.uuid4().hex[:12]
        created_timestamp = time.time()
        status = {
            "run_id": run_id,
            "gene": normalized_gene,
            "perturbation_value": float(perturbation_value),
            "n_propagation": int(n_propagation),
            "clip_delta_x": bool(clip_delta_x),
            "status": "Queued",
            "progress_label": "Waiting to start",
            "error_message": None,
            "created_at": utc_now(),
            "created_at_timestamp": created_timestamp,
            "started_at": None,
            "completed_at": None,
            "elapsed_seconds": 0,
        }
        write_json_atomic(status_path(project_dir, run_id), status)
        return status


def update_run_status(project_dir: Path, run_id: str, **changes) -> dict:
    with PERTURBATION_LOCK:
        path = status_path(project_dir, run_id)
        status = read_json(path)
        status.update(changes)
        write_json_atomic(path, status)
        return status


def file_signature(paths: list[Path], parameters: dict) -> str:
    digest = hashlib.sha256()
    for path in paths:
        stat = path.stat()
        digest.update(str(path.resolve()).encode("utf-8"))
        digest.update(str(stat.st_size).encode("utf-8"))
        digest.update(str(stat.st_mtime_ns).encode("utf-8"))
    digest.update(json.dumps(parameters, sort_keys=True).encode("utf-8"))
    return digest.hexdigest()


def prepare_model_cache(
    perturb_root: Path,
    expression_path: Path,
    edges_path: Path,
    parameters: dict,
) -> tuple[Path, bool]:
    model_dir = perturb_root / "model"
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / "simulation.celloracle.oracle"
    signature_path = model_dir / "signature.json"
    signature = file_signature([expression_path, edges_path], parameters)
    reusable = False
    if model_path.exists() and signature_path.exists():
        try:
            reusable = read_json(signature_path).get("signature") == signature
        except (OSError, json.JSONDecodeError):
            reusable = False
    if not reusable:
        model_path.unlink(missing_ok=True)
        signature_path.unlink(missing_ok=True)
    return model_path, reusable


def readable_process_error(completed: subprocess.CompletedProcess[str]) -> str:
    output = "\n".join(
        part.strip() for part in (completed.stderr, completed.stdout) if part and part.strip()
    )
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    return " ".join(lines[-6:])[:1200] or "CellOracle perturbation failed."


def run_perturbation_task(project_id: str, run_id: str) -> None:
    project_dir = PROJECTS_ROOT / project_id
    started_timestamp = time.time()
    try:
        status = read_json(status_path(project_dir, run_id))
        project_manifest = read_project_manifest(project_dir)
        _celloracle_result, edges_path = celloracle_result_and_edges(project_dir)

        expression_value = project_manifest.get("expression_path")
        if not expression_value:
            raise FileNotFoundError("Project expression matrix is missing.")
        source_expression = Path(str(expression_value))
        expression_path = ensure_project_preprocessed_expression(
            project_id,
            source_expression,
            project_manifest,
        )
        cluster_path_value = project_manifest.get("cluster_labels_path")
        cluster_path = Path(str(cluster_path_value)) if cluster_path_value else None
        if cluster_path is not None and not cluster_path.exists():
            cluster_path = None

        perturb_root = perturbation_root(project_dir)
        runtime_dir = perturb_root / "runtime" / run_id
        output_dir = run_directory(project_dir, run_id)
        runtime_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)

        expression_copy = runtime_dir / "ExpressionData.csv"
        edges_copy = runtime_dir / "CellOracleEdges.csv"
        clusters_copy = runtime_dir / "ClusterLabels.csv"
        shutil.copy2(expression_path, expression_copy)
        shutil.copy2(edges_path, edges_copy)
        if cluster_path is not None:
            shutil.copy2(cluster_path, clusters_copy)

        beeline_root = resolve_beeline_root()
        source_script = (
            beeline_root / "Algorithms" / "CELLORACLE" / "runCellOraclePerturbation.py"
        )
        if not source_script.exists():
            raise FileNotFoundError("CellOracle perturbation runner is missing.")
        script_copy = runtime_dir / source_script.name
        shutil.copy2(source_script, script_copy)

        max_cells = max(100, int(os.environ.get("GRNSCOPE_PERTURBATION_MAX_CELLS", "2000")))
        parameters = {"alpha": 10.0, "max_cells": max_cells, "grn_unit": "whole"}
        model_path, model_reused = prepare_model_cache(
            perturb_root,
            expression_path,
            edges_path,
            parameters,
        )

        update_run_status(
            project_dir,
            run_id,
            status="Running" if model_reused else "Preparing",
            progress_label=(
                "Simulating perturbation"
                if model_reused
                else "Preparing perturbation model (first run only)"
            ),
            started_at=utc_now(),
        )

        container_root = "/usr/perturbations"
        command = [
            "docker",
            "run",
            "--rm",
            "-v",
            f"{perturb_root.resolve()}:{container_root}",
            resolve_algorithm_image("CELLORACLE"),
            "python",
            f"{container_root}/runtime/{run_id}/{source_script.name}",
            "--expression",
            f"{container_root}/runtime/{run_id}/{expression_copy.name}",
            "--edges",
            f"{container_root}/runtime/{run_id}/{edges_copy.name}",
            "--model",
            f"{container_root}/model/{model_path.name}",
            "--output-dir",
            f"{container_root}/runs/{run_id}",
            "--gene",
            str(status["gene"]),
            "--value",
            str(status["perturbation_value"]),
            "--n-propagation",
            str(status["n_propagation"]),
            "--alpha",
            str(parameters["alpha"]),
            "--max-cells",
            str(max_cells),
        ]
        if clusters_copy.exists():
            command.extend(
                ["--clusters", f"{container_root}/runtime/{run_id}/{clusters_copy.name}"]
            )
        if status.get("clip_delta_x"):
            command.append("--clip-delta-x")

        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
        (output_dir / "stdout.log").write_text(completed.stdout or "", encoding="utf-8")
        (output_dir / "stderr.log").write_text(completed.stderr or "", encoding="utf-8")
        if completed.returncode != 0:
            raise RuntimeError(readable_process_error(completed))
        result_path = output_dir / "result.json"
        if not result_path.exists():
            raise FileNotFoundError("CellOracle did not create a perturbation result.")

        signature = file_signature([expression_path, edges_path], parameters)
        write_json_atomic(
            perturb_root / "model" / "signature.json",
            {"signature": signature, "created_at": utc_now(), **parameters},
        )
        completed_timestamp = time.time()
        update_run_status(
            project_dir,
            run_id,
            status="Completed",
            progress_label="Completed",
            completed_at=utc_now(),
            elapsed_seconds=max(0, int(completed_timestamp - started_timestamp)),
            error_message=None,
        )
        shutil.rmtree(runtime_dir, ignore_errors=True)
    except Exception as exc:
        completed_timestamp = time.time()
        try:
            update_run_status(
                project_dir,
                run_id,
                status="Failed",
                progress_label="Failed",
                completed_at=utc_now(),
                elapsed_seconds=max(0, int(completed_timestamp - started_timestamp)),
                error_message=str(exc),
            )
        except Exception:
            pass


def launch_perturbation_thread(project_id: str, run_id: str) -> None:
    worker = threading.Thread(
        target=run_perturbation_task,
        args=(project_id, run_id),
        daemon=True,
        name=f"celloracle-perturbation-{project_id}-{run_id}",
    )
    worker.start()


def perturbation_download_path(project_dir: Path, run_id: str, filename: str) -> Path:
    if filename not in DOWNLOAD_FILENAMES:
        raise FileNotFoundError("Perturbation download not found.")
    path = run_directory(project_dir, run_id) / filename
    if not path.exists() or not path.is_file():
        raise FileNotFoundError("Perturbation download not found.")
    return path
