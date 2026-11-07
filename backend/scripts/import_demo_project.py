"""Build the portable, read-only demo from a completed run-manifest ZIP.

Run with backend/.venv/bin/python backend/scripts/import_demo_project.py ARCHIVE.
Only archived CSV/JSON data is read; no algorithm or uploaded code is executed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.beeline_service import (  # noqa: E402
    compute_repeat_run_spearman_from_paths,
    create_confidence_accumulator,
    finalize_confidence_accumulator,
    update_confidence_accumulator,
)
from app.services.ranked_edges import EmptyRankedEdgesError, parse_ranked_edges_csv  # noqa: E402
from app.services.ranked_edges import compute_beeline_path_stats  # noqa: E402
from app.services.visualization_context_service import read_ground_truth_edges  # noqa: E402


def portable(value):
    if isinstance(value, dict):
        return {key: portable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [portable(item) for item in value]
    if isinstance(value, str):
        return re.sub(r"/[^\s\"']*/projects/[a-z0-9]+", "${SOURCE_PROJECT_DIR}", value)
    return value


def json_bytes(value) -> bytes:
    return (json.dumps(portable(value), indent=2, allow_nan=False) + "\n").encode()


def verify_combined_result(content: bytes, edges: list[dict]) -> None:
    """The imported summaries must reproduce the actual combined network."""
    rows = list(csv.DictReader(io.StringIO(content.decode())))
    by_key = {(edge["source"], edge["target"]): edge for edge in edges}
    if len(rows) != len(by_key):
        raise ValueError("Reconstructed network has a different edge count from the archive.")
    fields = {
        "EdgeWeight": "mean_raw_score", "Confidence": "confidence",
        "MeanPercentile": "mean_percentile", "BootstrapMeanEvidence": "bootstrap_mean_evidence",
        "EvidenceCILower": "evidence_ci_lower", "EvidenceCIUpper": "evidence_ci_upper",
        "SelectedRuns": "selected_runs", "PositiveSelectedRuns": "positive_selected_runs",
        "NegativeSelectedRuns": "negative_selected_runs", "ObservedRuns": "observed_runs",
        "RunCount": "run_count",
    }
    for row in rows:
        edge = by_key.get((row["Gene1"], row["Gene2"]))
        if edge is None:
            raise ValueError("Reconstructed network has different gene pairs from the archive.")
        for column, key in fields.items():
            if row.get(column) and not math.isclose(float(row[column]), float(edge[key]), rel_tol=1e-10, abs_tol=1e-12):
                raise ValueError(f"Archived {column} does not match reconstructed {key}: {row['Gene1']} -> {row['Gene2']}")


def import_demo(archive: Path, destination: Path, samples: Path) -> dict:
    assets: dict[str, bytes] = {}
    with zipfile.ZipFile(archive) as source, tempfile.TemporaryDirectory() as temporary:
        indexes = [name for name in source.namelist() if PurePosixPath(name).name == "project_manifest.json"]
        if len(indexes) != 1:
            raise ValueError("Expected one project_manifest.json in the archive.")
        prefix = indexes[0].removesuffix("project_manifest.json")
        project = json.loads(source.read(indexes[0]))

        def read(name: str) -> bytes:
            if PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts:
                raise ValueError("Archive paths must be relative.")
            return source.read(prefix + name)

        def add(target: str, original: str) -> bytes:
            content = read(original)
            assets[target] = content
            return content

        expression = add("inputs/ExpressionData.csv", "inputs/original/expression/ExpressionData.csv")
        pseudotime = add("inputs/PseudoTime.csv", "inputs/preprocessed/PseudoTime.csv")
        reference = add("inputs/GroundTruthNetwork.csv", "inputs/original/ground_truth/GroundTruthNetwork.csv")
        for name in ("ExpressionData.csv", "manifest.json", "pseudotime_manifest.json", "gene_selection_audits/detection.json"):
            content = read("inputs/preprocessed/" + name)
            assets["preprocessed/" + name] = json_bytes(json.loads(content)) if name.endswith(".json") else content
        add("inputs/SlingshotEmbedding.csv", "inputs/preprocessed/trajectory_embedding/SlingshotEmbedding.csv")
        add("inputs/SlingshotCurves.csv", "inputs/preprocessed/trajectory_curves/SlingshotCurves.csv")
        temporary_root = Path(temporary)
        truth_path = temporary_root / "GroundTruthNetwork.csv"
        truth_path.write_bytes(reference)
        reference_edges = read_ground_truth_edges(truth_path)
        algorithms: list[str] = []
        runs = {}
        configurations = {}

        for entry in project["algorithms"]:
            algorithm = str(entry["id"])
            if not re.fullmatch(r"[A-Z0-9_]+", algorithm) or algorithm in algorithms:
                raise ValueError("Invalid or duplicate algorithm identifier.")
            if entry["status"] != "Completed":
                raise ValueError(f"{algorithm} is not a completed result.")
            algorithms.append(algorithm)
            base = f"algorithms/{algorithm}/"
            record = json.loads(read(base + "run_manifest.json"))
            assets[f"results/{algorithm}/run_manifest.json"] = json_bytes(record)
            settings = record["execution"]["run_settings"]
            configurations[algorithm] = record["execution"]["parameters"]
            if not record["results"]["all_runs_included"]:
                raise ValueError(f"{algorithm} is missing run results.")
            accumulator = create_confidence_accumulator()
            run_paths = {}
            threshold = float(settings["confidence_evidence_threshold"])
            limit = int(settings["ranked_edges_per_target_limit"])
            files = record["results"]["files"]
            for item in files:
                if item["role"] not in {"combined_result", "run_result"}:
                    continue
                content = read(base + item["path"])
                if hashlib.sha256(content).hexdigest() != item["sha256"]:
                    raise ValueError(f"Checksum mismatch for {algorithm}/{item['path']}.")
                if item["role"] == "combined_result":
                    assets[f"results/{algorithm}/rankedEdges.csv"] = content
                    continue
                run_id = item["run_id"]
                if not re.fullmatch(r"bootstrap-\d+", run_id) or run_id in run_paths:
                    raise ValueError("Invalid or duplicate bootstrap run identifier.")
                target = f"results/{algorithm}/runs/{run_id}/rankedEdges.csv"
                assets[target] = content
                path = temporary_root / target
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
                run_paths[run_id] = str(path)
            if set(run_paths) != set(record["results"]["included_run_ids"]):
                raise ValueError(f"{algorithm} has an incomplete bootstrap archive.")
            for run_id in sorted(run_paths, key=lambda name: int(name.split("-")[-1])):
                try:
                    edges, _ = parse_ranked_edges_csv(Path(run_paths[run_id]), max_edges_per_target=limit)
                except EmptyRankedEdgesError:
                    edges = []  # Empty runs still count in the confidence denominator.
                update_confidence_accumulator(accumulator, edges, evidence_threshold=threshold)
            edges, summary = finalize_confidence_accumulator(accumulator, run_count=len(run_paths), evidence_threshold=threshold)
            combined = assets[f"results/{algorithm}/rankedEdges.csv"]
            verify_combined_result(combined, edges)
            combined_path = temporary_root / algorithm / "rankedEdges.csv"
            combined_path.parent.mkdir(parents=True, exist_ok=True)
            combined_path.write_bytes(combined)
            timing = json.loads(read(base + "artifacts/run_timings.json"))
            runtime = record["runtime"]
            runs[algorithm] = {**runtime, "replicates": len(run_paths)}
            runs[algorithm].pop("replicates", None)
            runs[algorithm]["run_count"] = len(run_paths)
            result = {
                "project_id": "demo", "job_id": "demo", "algorithm_id": algorithm,
                "status": "Completed", "generated_at": runtime["completed_at"],
                "started_at": runtime["started_at"], "completed_at": runtime["completed_at"],
                "elapsed_seconds": runtime["elapsed_seconds"],
                "docker_image_version": record["execution"]["container"]["image"],
                "algorithm_preprocessing": record["genes"]["algorithm_filter"],
                "network_summary": summary, "top_edges": edges,
                "ranked_edges_path": f"results/{algorithm}/rankedEdges.csv",
                "source_manifest": f"results/{algorithm}/run_manifest.json",
                "confidence_summary": {
                    **summary, "confidence_enabled": True,
                    "confidence_run_mode": settings["confidence_run_mode"],
                    "planned_bootstrap_runs": settings["confidence_bootstrap_runs"],
                    "total_algorithm_runs": len(run_paths),
                    "sampling_with_replacement": True, "subsample_fraction": 1.0,
                    "run_metadata": timing,
                    "early_stopping": {
                        "enabled": settings["confidence_run_mode"] == "automatic",
                        "stopped_early": any(
                            item.get("reason") == "confidence_early_stopping"
                            for item in timing.values()
                        ),
                    },
                    "repeat_run_stability": compute_repeat_run_spearman_from_paths(run_paths, max_edges_per_target=limit),
                },
                "beeline_path_stats": compute_beeline_path_stats(combined_path, reference_edges),
            }
            assets[f"results/{algorithm}.json"] = json_bytes(result)

        first = json.loads(read(f"algorithms/{algorithms[0]}/run_manifest.json"))
        preprocessing = first["matrix_and_preprocessing"]["project_configuration"]
        prepared = json.loads(assets["preprocessed/manifest.json"])
        with io.StringIO(expression.decode()) as stream:
            rows = csv.reader(stream)
            cells = next(rows)[1:]
            genes = [row[0] for row in rows if row]
        manifest = {
            "project_id": "demo", "name": "Demo Project",
            "description": "Completed 19-gene, 2,000-cell analysis with 13 inference methods, genuine bootstrap runs, Slingshot trajectories, and the uploaded reference network.",
            "is_demo": True, "read_only": True,
            "preprocessing": preprocessing,
            "preprocessing_result": prepared,
            "preprocessing_status": "completed",
            "preprocessed_expression_path": "preprocessed/ExpressionData.csv",
            "pseudotime_source": "estimated", "pseudotime_method": "Slingshot",
            "pseudotime_estimated": True, "pseudotime_trajectory_method": "Slingshot",
            "pseudotime_embedding_path": "inputs/SlingshotEmbedding.csv",
            "pseudotime_curves_path": "inputs/SlingshotCurves.csv",
            "pseudotime_embedding_method": "PCA",
            "dataset": {
                "name": project["project"]["name"],
                "species": project["dataset"]["species"],
                "expression_file": "ExpressionData.csv", "pseudotime_file": "PseudoTime.csv",
                "ground_truth_file": "GroundTruthNetwork.csv",
                "gene_count": len(genes), "cell_count": len(cells), "gene_names": genes,
                "dimensions": {"rows": len(genes), "columns": len(cells), "rows_label": "genes", "columns_label": "cells"},
                "has_pseudotime": True, "has_ground_truth": True,
            },
            "inputs": [
                {"name": name, "path": "inputs/" + name, "description": description}
                for name, description in [
                    ("ExpressionData.csv", "Original uploaded expression matrix; genes × cells, declared log-normalized."),
                    ("PseudoTime.csv", "Canonical Slingshot pseudotime actually used in the completed analysis."),
                    ("GroundTruthNetwork.csv", "Reference network uploaded with the completed project."),
                    ("SlingshotEmbedding.csv", "Saved Slingshot cell embedding."),
                    ("SlingshotCurves.csv", "Saved Slingshot lineage curves."),
                ]
            ],
            "algorithms": algorithms, "algorithm_runs": runs,
            "algorithm_parameters": configurations,
            "result_layout": {"base_dir": "results", "ranked_edges_filename": "rankedEdges.csv"},
            "provenance": {"archive": archive.name, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "exported_at": project["created_at"], "source_project": first["identity"]["project_id"]},
        }
        assets["manifest.json"] = json_bytes(manifest)
        assets["source_project_manifest.json"] = json_bytes(project)
        for name, content in assets.items():
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        # These directories contain only managed demo assets. Clear obsolete
        # methods, runs and inputs so an import cannot mix two projects.
        for directory in ("inputs", "preprocessed", "results"):
            root = destination / directory
            for path in sorted(root.rglob("*"), key=lambda item: len(item.parts), reverse=True):
                if path.is_file() and path.relative_to(destination).as_posix() not in assets:
                    path.unlink()
                elif path.is_dir() and not any(path.iterdir()):
                    path.rmdir()
        legacy_runtime = destination / "_beeline_runtime"
        if legacy_runtime.exists():
            shutil.rmtree(legacy_runtime)

        readme = (
            "GRNScope sample dataset\n=======================\n\n"
            "Inputs from the completed 19-gene, 2,000-cell demo project (13 methods).\n"
            "Species: human. Matrix values: log-normalized. Detection filter: 10%.\n\n"
            "ExpressionData.csv: exact original uploaded expression matrix (genes as rows).\n"
            "PseudoTime.csv: canonical Slingshot pseudotime used by the analysis; cell IDs\n"
            "match the expression columns. It contains two trajectory columns; NA means\n"
            "that a cell is not assigned to that trajectory.\n"
            "GroundTruthNetwork.csv: the project's uploaded reference network, with\n"
            "Gene1, Gene2 and Type (+/-) columns.\n\n"
            "These files are analysis inputs; rerunning methods may produce different\n"
            "results. The demo preserves the actual archived outputs and bootstrap counts.\n"
        ).encode()
        samples.mkdir(parents=True, exist_ok=True)
        for name, content in [("sample_expression_matrix.csv", expression), ("sample_pseudotime.csv", pseudotime), ("sample_ground_truth_network.csv", reference), ("README.txt", readme)]:
            (samples / name).write_bytes(content)
        with zipfile.ZipFile(samples / "grnscope-sample-dataset.zip", "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            for name, content in [("ExpressionData.csv", expression), ("PseudoTime.csv", pseudotime), ("GroundTruthNetwork.csv", reference), ("README.txt", readme)]:
                info = zipfile.ZipInfo(name, date_time=(2026, 11, 7, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                bundle.writestr(info, content)
        return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--destination", type=Path, default=BACKEND / "data/demo_project")
    parser.add_argument("--samples", type=Path, default=BACKEND.parent / "frontend/public/samples")
    arguments = parser.parse_args()
    imported = import_demo(arguments.archive, arguments.destination, arguments.samples)
    print(f"Imported {len(imported['algorithms'])} methods, {imported['dataset']['gene_count']} genes, {imported['dataset']['cell_count']} cells.")
