from __future__ import annotations

import copy
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

    if runtime_root:
        copy_if_present(runtime_root / "config.yaml", artifact_dir / "config.yaml")
        copy_if_present(runtime_root / "run_timings.json", artifact_dir / "run_timings.json")
        copy_if_present(runtime_root / "stdout.log", artifact_dir / "logs" / "stdout.log")
        copy_if_present(runtime_root / "stderr.log", artifact_dir / "logs" / "stderr.log")

        if runtime_root.exists():
            shutil.rmtree(runtime_root, ignore_errors=True)

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
