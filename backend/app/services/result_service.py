from __future__ import annotations

import copy
from datetime import datetime, timezone
import json
import shutil
from pathlib import Path


def ensure_results_dir(project_dir: Path) -> Path:
    results_dir = project_dir / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    return results_dir


def algorithm_result_dir(project_dir: Path, algorithm_id: str) -> Path:
    return ensure_results_dir(project_dir) / algorithm_id.upper()


def algorithm_result_path(project_dir: Path, algorithm_id: str) -> Path:
    return algorithm_result_dir(project_dir, algorithm_id) / "result.json"


def legacy_algorithm_result_path(project_dir: Path, algorithm_id: str) -> Path:
    return ensure_results_dir(project_dir) / f"{algorithm_id}.json"


def algorithm_artifact_dir(
    project_dir: Path,
    algorithm_id: str,
    *,
    scope_id: str | None = None,
) -> Path:
    base_dir = algorithm_result_dir(project_dir, algorithm_id)
    if scope_id and scope_id != "global":
        return base_dir / "scopes" / scope_id
    return base_dir


def copy_if_present(source: Path, destination: Path) -> bool:
    if not source.exists() or not source.is_file():
        return False

    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return True


def remove_runtime_and_empty_parent(runtime_root: Path) -> None:
    shutil.rmtree(runtime_root, ignore_errors=True)
    runtime_parent = runtime_root.parent
    try:
        if runtime_parent.name == "_beeline_runtime" and not any(runtime_parent.iterdir()):
            runtime_parent.rmdir()
    except OSError:
        pass


def ensure_diagnostics_dir(project_dir: Path) -> Path:
    diagnostics_dir = project_dir / "diagnostics"
    diagnostics_dir.mkdir(parents=True, exist_ok=True)
    return diagnostics_dir


def diagnostic_attempt_name(started_at_timestamp: float) -> str:
    started_at = datetime.fromtimestamp(started_at_timestamp, tz=timezone.utc)
    return f"attempt-{started_at.strftime('%Y%m%dT%H%M%S')}-{started_at.microsecond // 1000:03d}Z"


def copy_runtime_diagnostic_files(runtime_root: Path, destination: Path) -> list[str]:
    """Copy useful, lightweight diagnostics without retaining runtime datasets."""

    copied_files: list[str] = []
    for filename in (
        "config.yaml",
        "run_timings.json",
        "stdout.log",
        "stderr.log",
        "celloracle-worker.log",
    ):
        destination_path = destination / filename
        if copy_if_present(runtime_root / filename, destination_path):
            copied_files.append(str(destination_path))

    outputs_dir = runtime_root / "outputs"
    if outputs_dir.exists():
        diagnostic_patterns = (
            "output.txt",
            "time*.txt",
            "phase_timings.json",
            "*.log",
        )
        copied_sources: set[Path] = set()
        for pattern in diagnostic_patterns:
            for source in outputs_dir.rglob(pattern):
                if source in copied_sources or not source.is_file():
                    continue
                copied_sources.add(source)
                destination_path = destination / "outputs" / source.relative_to(outputs_dir)
                if copy_if_present(source, destination_path):
                    copied_files.append(str(destination_path))

    run_diagnostics_dir = runtime_root / "run_diagnostics"
    if run_diagnostics_dir.is_dir():
        archived_run_diagnostics = destination / "run_diagnostics"
        shutil.copytree(
            run_diagnostics_dir,
            archived_run_diagnostics,
            dirs_exist_ok=True,
        )
        copied_files.extend(
            str(path)
            for path in archived_run_diagnostics.rglob("*")
            if path.is_file()
        )

    return copied_files


def archive_beeline_failure_diagnostics(
    project_dir: Path,
    job_id: str,
    algorithm_id: str,
    *,
    error_message: str,
    error_type: str,
    started_at_timestamp: float,
    completed_at_timestamp: float,
    elapsed_seconds: int,
    traceback_text: str | None,
    runtime_roots: list[Path],
) -> str:
    """Persist a compact failure bundle and remove transient BEELINE runtimes."""

    normalized_algorithm_id = algorithm_id.upper()
    algorithm_diagnostics_dir = ensure_diagnostics_dir(project_dir) / normalized_algorithm_id
    attempt_dir = (
        algorithm_diagnostics_dir
        / str(job_id)
        / diagnostic_attempt_name(started_at_timestamp)
    )
    if attempt_dir.exists():
        shutil.rmtree(attempt_dir, ignore_errors=True)
    attempt_dir.mkdir(parents=True, exist_ok=True)

    copied_files: list[str] = []
    runtime_segments: list[str] = []
    for runtime_root in runtime_roots:
        runtime_segments.append(runtime_root.name)
        runtime_destination = attempt_dir / "runtime" / runtime_root.name
        copied_files.extend(
            copy_runtime_diagnostic_files(runtime_root, runtime_destination)
        )

    error_payload = {
        "project_id": project_dir.name,
        "job_id": job_id,
        "algorithm_id": normalized_algorithm_id,
        "status": "Failed",
        "error_type": error_type,
        "error_message": error_message,
        "started_at": datetime.fromtimestamp(
            started_at_timestamp, tz=timezone.utc
        ).isoformat(),
        "completed_at": datetime.fromtimestamp(
            completed_at_timestamp, tz=timezone.utc
        ).isoformat(),
        "elapsed_seconds": elapsed_seconds,
        "runtime_segments": runtime_segments,
        "copied_files": [
            str(Path(path).relative_to(attempt_dir)) for path in copied_files
        ],
    }
    if traceback_text:
        error_payload["traceback"] = traceback_text

    error_path = attempt_dir / "error.json"
    error_path.write_text(json.dumps(error_payload, indent=2), encoding="utf-8")

    latest_payload = {
        "job_id": job_id,
        "algorithm_id": normalized_algorithm_id,
        "error_path": str(error_path.relative_to(project_dir)),
        "completed_at": error_payload["completed_at"],
    }
    algorithm_diagnostics_dir.mkdir(parents=True, exist_ok=True)
    (algorithm_diagnostics_dir / "latest.json").write_text(
        json.dumps(latest_payload, indent=2),
        encoding="utf-8",
    )

    for runtime_root in runtime_roots:
        remove_runtime_and_empty_parent(runtime_root)

    return str(error_path)


def archive_beeline_result_artifacts(
    project_dir: Path,
    algorithm_id: str,
    beeline_result: dict,
    *,
    scope_id: str | None = None,
) -> dict:
    archived_result = copy.deepcopy(beeline_result)
    artifact_dir = algorithm_artifact_dir(
        project_dir,
        algorithm_id,
        scope_id=scope_id,
    )
    if artifact_dir.exists():
        shutil.rmtree(artifact_dir, ignore_errors=True)
    artifact_dir.mkdir(parents=True, exist_ok=True)

    runtime_root_value = beeline_result.get("runtime_root")
    runtime_root = Path(str(runtime_root_value)) if runtime_root_value else None

    ranked_edges_path_value = beeline_result.get("ranked_edges_path")
    if ranked_edges_path_value:
        ranked_edges_path = Path(str(ranked_edges_path_value))
        archived_ranked_edges_path = artifact_dir / "rankedEdges.csv"
        if copy_if_present(ranked_edges_path, archived_ranked_edges_path):
            archived_result["ranked_edges_path"] = str(archived_ranked_edges_path)

    archived_run_paths: dict[str, str] = {}
    run_paths = beeline_result.get("run_ranked_edges_paths") or {}
    if isinstance(run_paths, dict):
        for run_id, run_path_value in sorted(run_paths.items()):
            run_path = Path(str(run_path_value))
            archived_run_path = artifact_dir / "runs" / str(run_id) / "rankedEdges.csv"
            if copy_if_present(run_path, archived_run_path):
                archived_run_paths[str(run_id)] = str(archived_run_path)

    if archived_run_paths:
        archived_result["run_ranked_edges_paths"] = archived_run_paths

    run_diagnostics_root_value = beeline_result.get("run_diagnostics_root")
    if run_diagnostics_root_value:
        run_diagnostics_root = Path(str(run_diagnostics_root_value))
        archived_run_diagnostics_root = artifact_dir / "run_diagnostics"
        if run_diagnostics_root.is_dir():
            shutil.copytree(
                run_diagnostics_root,
                archived_run_diagnostics_root,
                dirs_exist_ok=True,
            )
            archived_result["run_diagnostics_root"] = str(
                archived_run_diagnostics_root
            )
            run_metadata = (
                archived_result.get("confidence_summary", {}).get("run_metadata", {})
            )
            if isinstance(run_metadata, dict):
                for run_id, metadata in run_metadata.items():
                    if not isinstance(metadata, dict) or metadata.get("status") != "Empty":
                        continue
                    archived_diagnostic_path = (
                        archived_run_diagnostics_root / str(run_id)
                    )
                    if archived_diagnostic_path.is_dir():
                        metadata["diagnostics_path"] = str(archived_diagnostic_path)

    if runtime_root:
        copy_if_present(runtime_root / "config.yaml", artifact_dir / "config.yaml")
        copy_if_present(runtime_root / "run_timings.json", artifact_dir / "run_timings.json")
        copy_if_present(runtime_root / "stdout.log", artifact_dir / "logs" / "stdout.log")
        copy_if_present(runtime_root / "stderr.log", artifact_dir / "logs" / "stderr.log")
        copy_if_present(
            runtime_root / "celloracle-worker.log",
            artifact_dir / "logs" / "celloracle-worker.log",
        )
        copy_if_present(
            runtime_root
            / "algorithm_preprocessed"
            / "gene_selection_audit.json",
            artifact_dir / "gene_selection_audit.json",
        )

        if runtime_root.exists():
            remove_runtime_and_empty_parent(runtime_root)

    archived_result["result_artifact_root"] = str(artifact_dir)
    archived_result["runtime_root"] = str(artifact_dir)
    return archived_result


def clear_algorithm_result_artifacts(project_dir: Path, algorithm_id: str) -> None:
    result_dir = algorithm_result_dir(project_dir, algorithm_id)
    if result_dir.exists():
        shutil.rmtree(result_dir, ignore_errors=True)

    legacy_result_path = legacy_algorithm_result_path(project_dir, algorithm_id)
    if legacy_result_path.exists():
        legacy_result_path.unlink()


def write_algorithm_result(
    project_dir: Path,
    algorithm_id: str,
    result_payload: dict,
) -> str:
    result_path = algorithm_result_path(project_dir, algorithm_id)
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(json.dumps(result_payload, indent=2), encoding="utf-8")
    return str(result_path)


def read_algorithm_result(project_dir: Path, algorithm_id: str) -> dict:
    result_path = algorithm_result_path(project_dir, algorithm_id)
    if not result_path.exists():
        result_path = legacy_algorithm_result_path(project_dir, algorithm_id)
    if not result_path.exists():
        raise FileNotFoundError(f"Result for {algorithm_id} not found.")
    return json.loads(result_path.read_text(encoding="utf-8"))
