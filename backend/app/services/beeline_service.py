from __future__ import annotations

import csv
import io
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from ..config import (
    ALGORITHM_DEFAULT_PARAMS,
    ALGORITHM_IMAGE_MAP,
    BEELINE_ROOT_CANDIDATES,
    PROJECTS_ROOT,
)
from ..repositories.project_repository import read_project_manifest


def resolve_beeline_root() -> Path:
    for candidate in BEELINE_ROOT_CANDIDATES:
        if not candidate:
            continue
        blrunner_path = candidate / "BLRunner.py"
        if candidate.exists() and blrunner_path.exists():
            return candidate
    raise FileNotFoundError(
        "BEELINE repository not found. Set BEELINE_ROOT to the local Beeline repo path."
    )


def yaml_scalar(value: str) -> str:
    return json.dumps(str(value))


def prepare_beeline_runtime(
    project_id: str,
    algorithm_id: str,
    project_manifest: dict,
) -> tuple[Path, Path, Path, str, str]:
    runtime_root = PROJECTS_ROOT / project_id / "_beeline_runtime" / algorithm_id
    if runtime_root.exists():
        shutil.rmtree(runtime_root)
    runtime_root.mkdir(parents=True, exist_ok=True)

    input_dir = runtime_root / "inputs"
    output_dir = runtime_root / "outputs"
    dataset_id = project_id
    run_id = "run-1"
    run_dir = input_dir / dataset_id / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    expression_path = project_manifest.get("expression_path")
    pseudotime_path = project_manifest.get("pseudotime_path")

    if not expression_path:
        raise FileNotFoundError("Project expression_path is missing.")

    source_expression = Path(expression_path)
    if not source_expression.exists():
        raise FileNotFoundError("Expression matrix file not found on disk.")

    shutil.copy2(source_expression, run_dir / "ExpressionData.csv")

    if pseudotime_path:
        source_pseudotime = Path(pseudotime_path)
        if source_pseudotime.exists():
            shutil.copy2(source_pseudotime, run_dir / "PseudoTime.csv")

    return runtime_root, input_dir, output_dir, dataset_id, run_id


def build_beeline_config(
    input_dir: Path,
    output_dir: Path,
    dataset_id: str,
    run_id: str,
    algorithm_id: str,
    include_pseudotime: bool,
) -> str:
    normalized_algorithm_id = algorithm_id.upper()
    image_name = ALGORITHM_IMAGE_MAP.get(normalized_algorithm_id)
    if not image_name:
        raise ValueError(f"Unsupported BEELINE algorithm: {algorithm_id}")

    run_lines = [
        f"        - run_id: {yaml_scalar(run_id)}",
        '          exprData: "ExpressionData.csv"',
    ]
    if include_pseudotime:
        run_lines.append('          pseudoTimeData: "PseudoTime.csv"')

    params = ALGORITHM_DEFAULT_PARAMS.get(normalized_algorithm_id, {})

    config_lines = [
        "input_settings:",
        f"  input_dir: {yaml_scalar(input_dir)}",
        "  datasets:",
        f"    - dataset_id: {yaml_scalar(dataset_id)}",
        "      should_run: [True]",
        "      runs:",
        *run_lines,
        "  algorithms:",
        f"    - algorithm_id: {yaml_scalar(normalized_algorithm_id)}",
        f"      image: {yaml_scalar(image_name)}",
        "      should_run: [True]",
        "      params:",
    ]

    if params:
        for key, value in params.items():
            config_lines.append(f"        {key}: {json.dumps(value)}")
    else:
        config_lines.append("        {}")

    config_lines.extend(
        [
            "output_settings:",
            f"  output_dir: {yaml_scalar(output_dir)}",
        ]
    )
    return "\n".join(config_lines) + "\n"


def parse_ranked_edges_csv(ranked_edges_path: Path) -> tuple[list[dict], dict]:
    if not ranked_edges_path.exists():
        raise FileNotFoundError(f"rankedEdges.csv not found at {ranked_edges_path}")

    raw_text = ranked_edges_path.read_text(encoding="utf-8")
    if not raw_text.strip():
        raise ValueError("rankedEdges.csv is empty.")

    sample = raw_text[:4096]
    delimiter = ","
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
        delimiter = dialect.delimiter
    except csv.Error:
        first_line = raw_text.splitlines()[0] if raw_text.splitlines() else ""
        if "\t" in first_line:
            delimiter = "\t"
        elif ";" in first_line:
            delimiter = ";"

    reader = csv.DictReader(io.StringIO(raw_text), delimiter=delimiter)
    fieldnames = reader.fieldnames or []
    rows = list(reader)

    if not fieldnames:
        raise ValueError("rankedEdges.csv has no header row.")

    normalized_field_map = {
        key.strip().replace('\"', ""): key for key in fieldnames if key is not None
    }

    def find_field(candidates: list[str]) -> str | None:
        for candidate in candidates:
            if candidate in normalized_field_map:
                return normalized_field_map[candidate]
        return None

    source_key = find_field(["Gene1", "TF", "source", "Source"])
    target_key = find_field(["Gene2", "Target", "target", "TargetGene"])
    score_key = find_field(["EdgeWeight", "weight", "score", "Score"])

    if source_key is None or target_key is None:
        raise ValueError(
            f"Could not identify source/target columns in rankedEdges.csv. Found columns: {fieldnames}"
        )

    if score_key is None:
        numeric_candidates: list[str] = []
        for key in fieldnames:
            sample_value = None
            for row in rows:
                value = row.get(key)
                if value not in (None, ""):
                    sample_value = str(value).strip()
                    break
            if sample_value is None:
                continue
            try:
                float(sample_value)
                numeric_candidates.append(key)
            except (TypeError, ValueError):
                continue
        score_key = numeric_candidates[-1] if numeric_candidates else None

    if score_key is None:
        raise ValueError(
            f"Could not identify a score column in rankedEdges.csv. Found columns: {fieldnames}"
        )

    parsed_edges: list[dict] = []
    node_names: set[str] = set()

    for row in rows:
        source = str(row.get(source_key, "")).strip()
        target = str(row.get(target_key, "")).strip()
        score_raw = str(row.get(score_key, "")).strip()

        if not source or not target:
            continue

        try:
            score = float(score_raw)
        except (TypeError, ValueError):
            continue

        parsed_edges.append(
            {
                "source": source,
                "target": target,
                "score": score,
            }
        )
        node_names.add(source)
        node_names.add(target)

    if not parsed_edges:
        raise ValueError("rankedEdges.csv did not contain any valid edges.")

    return parsed_edges, {
        "edge_count": len(parsed_edges),
        "node_count": len(node_names),
    }


def execute_beeline_algorithm(project_id: str, algorithm_id: str) -> dict:
    project_dir = PROJECTS_ROOT / project_id
    project_manifest = read_project_manifest(project_dir)
    beeline_root = resolve_beeline_root()

    runtime_root, input_dir, output_dir, dataset_id, run_id = prepare_beeline_runtime(
        project_id,
        algorithm_id,
        project_manifest,
    )

    config_path = runtime_root / "config.yaml"
    config_text = build_beeline_config(
        input_dir=input_dir,
        output_dir=output_dir,
        dataset_id=dataset_id,
        run_id=run_id,
        algorithm_id=algorithm_id,
        include_pseudotime=bool(project_manifest.get("pseudotime_path")),
    )
    config_path.write_text(config_text, encoding="utf-8")

    python_executable = os.environ.get("BEELINE_PYTHON", sys.executable)
    command = [python_executable, "BLRunner.py", "-c", str(config_path)]

    completed_process = subprocess.run(
        command,
        cwd=beeline_root,
        capture_output=True,
        text=True,
        check=False,
    )

    (runtime_root / "stdout.log").write_text(
        completed_process.stdout or "",
        encoding="utf-8",
    )
    (runtime_root / "stderr.log").write_text(
        completed_process.stderr or "",
        encoding="utf-8",
    )

    if completed_process.returncode != 0:
        raise RuntimeError(
            f"BEELINE failed for {algorithm_id}. See {runtime_root / 'stderr.log'} for details."
        )

    ranked_edges_path = output_dir / dataset_id / run_id / algorithm_id / "rankedEdges.csv"
    top_edges, network_summary = parse_ranked_edges_csv(ranked_edges_path)

    return {
        "project_id": project_id,
        "algorithm_id": algorithm_id,
        "network_summary": network_summary,
        "top_edges": top_edges,
        "runtime_root": str(runtime_root),
        "ranked_"
        "edges_path": str(ranked_edges_path),
    }

def run_beeline_with_progress(
    project_id: str,
    job_id: str,
    algorithm_id: str,
    update_job_state_fn,
) -> dict:
    project_dir = PROJECTS_ROOT / project_id
    project_manifest = read_project_manifest(project_dir)
    beeline_root = resolve_beeline_root()

    update_job_state_fn(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=5,
        progress_label="Preparing runtime",
    )

    runtime_root, input_dir, output_dir, dataset_id, run_id = prepare_beeline_runtime(
        project_id,
        algorithm_id,
        project_manifest,
    )

    config_path = runtime_root / "config.yaml"
    config_text = build_beeline_config(
        input_dir=input_dir,
        output_dir=output_dir,
        dataset_id=dataset_id,
        run_id=run_id,
        algorithm_id=algorithm_id,
        include_pseudotime=bool(project_manifest.get("pseudotime_path")),
    )
    config_path.write_text(config_text, encoding="utf-8")

    update_job_state_fn(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=15,
        progress_label="Launching BEELINE",
    )

    python_executable = os.environ.get("BEELINE_PYTHON", sys.executable)
    command = [python_executable, "BLRunner.py", "-c", str(config_path)]

    started_at = time.time()
    process = subprocess.Popen(
        command,
        cwd=beeline_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    while process.poll() is None:
        elapsed = int(time.time() - started_at)
        synthetic_progress = min(85, 20 + elapsed // 2)
        update_job_state_fn(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            elapsed_seconds=elapsed,
            progress_percent=synthetic_progress,
            progress_label="Running BEELINE",
        )
        time.sleep(1)

    stdout_text, stderr_text = process.communicate()

    (runtime_root / "stdout.log").write_text(stdout_text or "", encoding="utf-8")
    (runtime_root / "stderr.log").write_text(stderr_text or "", encoding="utf-8")

    if process.returncode != 0:
        raise RuntimeError(
            f"BEELINE failed for {algorithm_id}. See {runtime_root / 'stderr.log'} for details."
        )

    update_job_state_fn(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=92,
        progress_label="Parsing ranked edges",
    )

    ranked_edges_path = output_dir / dataset_id / run_id / algorithm_id / "rankedEdges.csv"
    top_edges, network_summary = parse_ranked_edges_csv(ranked_edges_path)

    update_job_state_fn(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=98,
        progress_label="Finalizing result",
    )

    return {
        "project_id": project_id,
        "algorithm_id": algorithm_id,
        "network_summary": network_summary,
        "top_edges": top_edges,
        "runtime_root": str(runtime_root),
        "ranked_edges_path": str(ranked_edges_path),
    }