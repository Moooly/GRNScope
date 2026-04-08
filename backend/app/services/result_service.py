from __future__ import annotations

import json
from pathlib import Path


def ensure_results_dir(project_dir: Path) -> Path:
    results_dir = project_dir / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    return results_dir


def algorithm_result_path(project_dir: Path, algorithm_id: str) -> Path:
    return ensure_results_dir(project_dir) / f"{algorithm_id}.json"


def write_algorithm_result(
    project_dir: Path,
    algorithm_id: str,
    result_payload: dict,
) -> str:
    result_path = algorithm_result_path(project_dir, algorithm_id)
    result_path.write_text(json.dumps(result_payload, indent=2), encoding="utf-8")
    return str(result_path)


def read_algorithm_result(project_dir: Path, algorithm_id: str) -> dict:
    result_path = algorithm_result_path(project_dir, algorithm_id)
    if not result_path.exists():
        raise FileNotFoundError(f"Result for {algorithm_id} not found.")
    return json.loads(result_path.read_text(encoding="utf-8"))