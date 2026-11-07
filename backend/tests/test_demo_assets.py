"""The bundled demo faithfully preserves a portable completed project."""

import csv
import hashlib
import json
import math
import zipfile
from pathlib import Path

from app.api.results import read_demo_algorithm_result_from_json
from app.services.demo_service import (
    get_demo_algorithm_ids,
    get_demo_input_file_path,
    get_demo_ranked_edges_path,
    get_demo_tasks,
    load_demo_manifest,
)
from app.services.project_data_service import load_project_data
from app.services.visualization_context_service import build_visualization_context, read_manifest_for_visualization


DEMO_ROOT = Path(__file__).resolve().parents[1] / "data" / "demo_project"
RUN_COUNTS = {
    "CELLORACLE": 3, "GENIE3": 3, "GRISLI": 5, "GRNBOOST2": 3,
    "GRNVBEM": 5, "LEAP": 3, "PEARSON": 3, "PIDC": 3, "PPCOR": 5,
    "SCODE": 6, "SCRIBE": 6, "SINCERITIES": 6, "SINGE": 4,
}


def test_demo_assets_are_portable_and_complete() -> None:
    manifest = load_demo_manifest()
    assert set(get_demo_algorithm_ids()) == set(RUN_COUNTS)
    assert not (DEMO_ROOT / "project.json").exists()
    assert not (DEMO_ROOT / "_beeline_runtime").exists()
    assert not (DEMO_ROOT / "inputs/refNetwork.csv").exists()
    assert {path.name for path in (DEMO_ROOT / "results").iterdir()} == (
        set(RUN_COUNTS) | {f"{name}.json" for name in RUN_COUNTS}
    )
    assert manifest["dataset"]["gene_count"] == 19
    assert manifest["dataset"]["cell_count"] == 2000
    for item in manifest["inputs"]:
        assert get_demo_input_file_path(item["name"]).is_file()

    visualization_manifest = read_manifest_for_visualization(DEMO_ROOT)
    assert visualization_manifest["expression_filename"] == "ExpressionData.csv"
    assert visualization_manifest["preprocessing"]["matrix_state"] == "log_normalized"
    assert visualization_manifest["preprocessing"]["enabled_stages"] == ["detection"]

    for algorithm_id, run_count in RUN_COUNTS.items():
        ranked_path = get_demo_ranked_edges_path(algorithm_id)
        assert ranked_path == DEMO_ROOT / "results" / algorithm_id / "rankedEdges.csv"
        record = json.loads((ranked_path.parent / "run_manifest.json").read_text())
        for item in record["results"]["files"]:
            if item["role"] not in {"combined_result", "run_result"}:
                continue
            # Run-manifest paths are relative to the algorithm's source directory.
            local = ranked_path.parent / Path(item["path"]).relative_to("results")
            assert hashlib.sha256(local.read_bytes()).hexdigest() == item["sha256"]
        result = json.loads((DEMO_ROOT / "results" / f"{algorithm_id}.json").read_text())
        assert result["ranked_edges_path"] == f"results/{algorithm_id}/rankedEdges.csv"
        assert "run_ranked_edges_paths" not in result
        assert "beeline_runtime_root" not in result
        assert "/data3/" not in json.dumps(result)
        confidence = result["confidence_summary"]
        assert confidence["total_algorithm_runs"] == run_count
        stability = confidence["repeat_run_stability"]
        assert stability["status"] == "available"
        usable = 2 if algorithm_id == "SINGE" else run_count
        assert stability["run_count"] == usable
        assert stability["pair_count"] == math.comb(usable, 2)
        assert result["elapsed_seconds"] == record["runtime"]["elapsed_seconds"]
        by_key = {(edge["source"], edge["target"]): edge for edge in result["top_edges"]}
        with ranked_path.open(newline="") as stream:
            archived = list(csv.DictReader(stream))
        assert len(archived) == len(by_key)
        for row in archived:
            edge = by_key[row["Gene1"], row["Gene2"]]
            assert edge["run_count"] == run_count
            assert edge["confidence"] == edge["selected_runs"] / run_count
            assert math.isclose(edge["mean_raw_score"], float(row["EdgeWeight"]), rel_tol=1e-10)
            assert math.isclose(edge["mean_percentile"], float(row["MeanPercentile"]), rel_tol=1e-10)
        assert read_demo_algorithm_result_from_json(algorithm_id)["top_edges"]
    assert all(task["elapsed_seconds"] > 0 for task in get_demo_tasks())


def test_demo_uses_saved_trajectory_and_prepared_inputs() -> None:
    context = build_visualization_context(project_dir=DEMO_ROOT, requested_genes=["SRY", "SOX9"])
    assert context["trajectory"]["available"]
    assert context["trajectory"]["pseudotime_source"] == "estimated"
    assert context["trajectory"]["trajectory_method"] == "Slingshot"
    assert context["trajectory"]["embedding"]["path_source"] == "slingshot_curve"
    assert context["ground_truth"]["available"]
    snapshot = load_project_data(DEMO_ROOT, demo=True)
    files = {(item["category"], item["role"]): item["source"] for item in snapshot["files"]}
    assert files["prepared", "expression"] == DEMO_ROOT / "preprocessed/ExpressionData.csv"
    assert files["prepared", "trajectory_embedding"] == DEMO_ROOT / "inputs/SlingshotEmbedding.csv"
    assert files["prepared", "trajectory_curves"] == DEMO_ROOT / "inputs/SlingshotCurves.csv"
    assert files["prepared", "pseudotime"] == DEMO_ROOT / "inputs/PseudoTime.csv"
    assert ("original", "pseudotime") not in files  # It was estimated, not uploaded.
    assert snapshot["project"]["preprocessing"]["detection"]["enabled"]


def test_sample_download_matches_demo_inputs() -> None:
    samples = DEMO_ROOT.parents[2] / "frontend/public/samples"
    with zipfile.ZipFile(samples / "grnscope-sample-dataset.zip") as archive:
        for name, public_name in (
            ("ExpressionData.csv", "sample_expression_matrix.csv"),
            ("PseudoTime.csv", "sample_pseudotime.csv"),
            ("GroundTruthNetwork.csv", "sample_ground_truth_network.csv"),
        ):
            assert archive.read(name) == (DEMO_ROOT / "inputs" / name).read_bytes()
            assert archive.read(name) == (samples / public_name).read_bytes()
    with (DEMO_ROOT / "inputs/ExpressionData.csv").open() as stream:
        rows = list(csv.reader(stream))
    assert len(rows) == 20
    assert len(rows[0]) == 2001
