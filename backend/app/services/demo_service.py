

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..config import (
    DEMO_PROJECT_INPUTS_ROOT,
    DEMO_PROJECT_MANIFEST,
    DEMO_PROJECT_RESULTS_ROOT,
    DEMO_PROJECT_ROOT,
)

DEMO_PROJECT_ID = "demo"


def is_demo_project(project_id: str) -> bool:
    return project_id == DEMO_PROJECT_ID


def load_demo_manifest() -> dict[str, Any]:
    if not DEMO_PROJECT_MANIFEST.exists():
        raise FileNotFoundError(f"Demo manifest not found: {DEMO_PROJECT_MANIFEST}")

    with DEMO_PROJECT_MANIFEST.open("r", encoding="utf-8") as manifest_file:
        return json.load(manifest_file)


def get_demo_project() -> dict[str, Any]:
    manifest = load_demo_manifest()
    dataset = manifest.get("dataset", {})
    algorithms = manifest.get("algorithms", [])

    return {
        "id": DEMO_PROJECT_ID,
        "name": manifest.get("name", "Demo Project"),
        "description": manifest.get("description", ""),
        "created_at": "demo",
        "updated_at": "demo",
        "dataset_count": 1,
        "job_count": 1,
        "is_demo": True,
        "read_only": True,
        "dataset": dataset,
        "algorithms": algorithms,
        "input_files": manifest.get("inputs", []),
    }


def get_demo_algorithm_ids() -> list[str]:
    manifest = load_demo_manifest()
    return [str(algorithm_id) for algorithm_id in manifest.get("algorithms", [])]


def get_demo_algorithm_result_path(algorithm_id: str) -> Path:
    normalized_algorithm_id = algorithm_id.upper()
    result_path = DEMO_PROJECT_RESULTS_ROOT / f"{normalized_algorithm_id}.json"

    if not result_path.exists():
        raise FileNotFoundError(
            f"Demo result manifest not found for {normalized_algorithm_id}: {result_path}"
        )

    return result_path


def get_demo_ranked_edges_path(algorithm_id: str) -> Path:
    normalized_algorithm_id = algorithm_id.upper()
    manifest = load_demo_manifest()
    ranked_edges_filename = manifest.get("result_layout", {}).get(
        "ranked_edges_filename",
        "rankedEdges.csv",
    )
    candidate_paths = [
        DEMO_PROJECT_RESULTS_ROOT / normalized_algorithm_id / ranked_edges_filename,
        DEMO_PROJECT_ROOT
        / "_beeline_runtime"
        / normalized_algorithm_id
        / "rankedEdges_confidence.csv",
    ]

    result_manifest_path = DEMO_PROJECT_RESULTS_ROOT / f"{normalized_algorithm_id}.json"
    if result_manifest_path.exists():
        try:
            result_manifest = json.loads(result_manifest_path.read_text(encoding="utf-8"))
            ranked_edges_path_value = result_manifest.get("ranked_edges_path")
            if ranked_edges_path_value:
                ranked_edges_path = Path(str(ranked_edges_path_value))
                if "_beeline_runtime" in ranked_edges_path.parts:
                    runtime_index = ranked_edges_path.parts.index("_beeline_runtime")
                    runtime_relative_path = Path(*ranked_edges_path.parts[runtime_index + 1 :])
                    candidate_paths.append(
                        DEMO_PROJECT_ROOT / "_beeline_runtime" / runtime_relative_path
                    )
        except Exception:
            pass

    for result_path in candidate_paths:
        if result_path.exists():
            return result_path

    raise FileNotFoundError(
        f"Demo ranked edges file not found for {normalized_algorithm_id}."
    )


def list_demo_ranked_edges_paths() -> dict[str, Path]:
    paths: dict[str, Path] = {}

    for algorithm_id in get_demo_algorithm_ids():
        try:
            paths[algorithm_id.upper()] = get_demo_ranked_edges_path(algorithm_id)
        except FileNotFoundError:
            continue

    return paths


def get_demo_input_file_path(filename: str) -> Path:
    safe_filename = Path(filename).name
    input_path = DEMO_PROJECT_INPUTS_ROOT / safe_filename

    if not input_path.exists():
        raise FileNotFoundError(f"Demo input file not found: {input_path}")

    return input_path


def list_demo_input_files() -> list[dict[str, Any]]:
    manifest = load_demo_manifest()
    return list(manifest.get("inputs", []))


def get_demo_project_root() -> Path:
    return DEMO_PROJECT_ROOT
