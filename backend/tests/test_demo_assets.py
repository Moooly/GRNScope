"""The bundled demo must load without BEELINE execution directories."""

import json
from pathlib import Path

from app.api.results import read_demo_algorithm_result_from_json
from app.services.demo_service import (
    get_demo_algorithm_ids,
    get_demo_input_file_path,
    get_demo_ranked_edges_path,
    load_demo_manifest,
)
from app.services.visualization_context_service import read_manifest_for_visualization


DEMO_ROOT = Path(__file__).resolve().parents[1] / "data" / "demo_project"


def test_demo_assets_are_portable_and_complete() -> None:
    manifest = load_demo_manifest()
    assert len(get_demo_algorithm_ids()) == 12
    assert not (DEMO_ROOT / "project.json").exists()

    for item in manifest["inputs"]:
        assert get_demo_input_file_path(item["name"]).is_file()

    visualization_manifest = read_manifest_for_visualization(DEMO_ROOT)
    assert visualization_manifest["expression_filename"] == "ExpressionData.csv"
    assert visualization_manifest["preprocessing"]["matrix_state"] == "raw"

    for algorithm_id in get_demo_algorithm_ids():
        ranked_path = get_demo_ranked_edges_path(algorithm_id)
        assert ranked_path == DEMO_ROOT / "results" / algorithm_id / "rankedEdges.csv"
        assert ranked_path.is_file()

        result_path = DEMO_ROOT / "results" / f"{algorithm_id}.json"
        result = json.loads(result_path.read_text(encoding="utf-8"))
        assert result["ranked_edges_path"] == f"results/{algorithm_id}/rankedEdges.csv"
        assert "run_ranked_edges_paths" not in result
        assert "beeline_runtime_root" not in result
        stability = result["confidence_summary"]["repeat_run_stability"]
        assert stability["status"] == "available"
        assert stability["run_count"] == 30
        assert stability["pair_count"] == 435

    assert read_demo_algorithm_result_from_json("PIDC")["top_edges"]
