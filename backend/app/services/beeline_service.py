from __future__ import annotations

import csv
import io
import json
import os
import shutil
import subprocess
import sys
import time
from math import fsum, log2
from pathlib import Path

from ..algorithm_registry import get_algorithm_by_id
from ..config import BEELINE_ROOT_CANDIDATES, PROJECTS_ROOT
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

def resolve_algorithm_image(algorithm_id: str) -> str:
    try:
        return str(get_algorithm_by_id(algorithm_id)["docker_image"])
    except KeyError as exc:
        raise ValueError(f"Unsupported BEELINE algorithm: {algorithm_id}") from exc


def resolve_algorithm_default_params(algorithm_id: str) -> dict:
    try:
        algorithm_info = get_algorithm_by_id(algorithm_id)
    except KeyError as exc:
        raise ValueError(f"Unsupported BEELINE algorithm: {algorithm_id}") from exc

    default_params: dict = {}
    for parameter in algorithm_info.get("parameters", []):
        parameter_name = parameter.get("name")
        if not parameter_name:
            continue
        if "default" not in parameter or parameter.get("default") is None:
            continue
        default_params[str(parameter_name)] = [parameter.get("default")]

    return default_params


def parse_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on", "enabled"}


def parse_positive_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def detect_csv_dialect(raw_text: str) -> csv.Dialect | type[csv.Dialect]:
    sample = raw_text[:4096]
    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t;")
    except csv.Error:
        first_line = raw_text.splitlines()[0] if raw_text.splitlines() else ""
        if "\t" in first_line:
            return csv.excel_tab
        if ";" in first_line:
            class SemicolonDialect(csv.excel):
                delimiter = ";"
            return SemicolonDialect
        return csv.excel


def resolve_known_tf_list_path(project_manifest: dict) -> Path | None:
    explicit_path = project_manifest.get("known_tf_list_path") or os.environ.get("KNOWN_TF_LIST_PATH")
    candidate_paths: list[Path] = []
    if explicit_path:
        candidate_paths.append(Path(str(explicit_path)))

    project_root = PROJECTS_ROOT.parent
    candidate_paths.extend(
        [
            project_root / "reference" / "human_tf_gene_names.txt",
            project_root / "reference" / "known_tf_gene_names.txt",
            project_root / "data" / "human_tf_gene_names.txt",
            project_root / "data" / "known_tf_gene_names.txt",
        ]
    )

    for candidate in candidate_paths:
        resolved = candidate if candidate.is_absolute() else candidate.resolve()
        if resolved.exists() and resolved.is_file():
            return resolved
    return None


def load_known_tf_genes(project_manifest: dict) -> set[str]:
    tf_list_path = resolve_known_tf_list_path(project_manifest)
    if not tf_list_path:
        return set()

    return {
        line.strip()
        for line in tf_list_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    }



def compute_row_variance(values: list[float]) -> float:
    if len(values) <= 1:
        return 0.0
    mean_value = fsum(values) / len(values)
    return fsum((value - mean_value) ** 2 for value in values) / len(values)


def normalize_expression_rows(matrix_rows: list[list[float]]) -> list[list[float]]:
    if not matrix_rows:
        return []

    column_count = max(len(row) for row in matrix_rows)
    if column_count == 0:
        return [list(row) for row in matrix_rows]

    column_sums = [0.0] * column_count
    for row in matrix_rows:
        for column_index, value in enumerate(row):
            column_sums[column_index] += value

    normalized_rows: list[list[float]] = []
    for row in matrix_rows:
        normalized_row: list[float] = []
        for column_index, value in enumerate(row):
            column_sum = column_sums[column_index]
            if column_sum <= 0:
                normalized_row.append(value)
            else:
                normalized_row.append((value / column_sum) * 10000.0)
        normalized_rows.append(normalized_row)

    return normalized_rows


def log_transform_expression_rows(matrix_rows: list[list[float]]) -> list[list[float]]:
    return [[log2(value + 1.0) for value in row] for row in matrix_rows]


def preprocess_expression_matrix(
    source_expression: Path,
    destination_expression: Path,
    project_manifest: dict,
) -> None:
    raw_text = source_expression.read_text(encoding="utf-8")
    if not raw_text.strip():
        raise ValueError("Expression matrix file is empty.")

    dialect = detect_csv_dialect(raw_text)
    rows = list(csv.reader(io.StringIO(raw_text), dialect=dialect))
    if not rows:
        raise ValueError("Expression matrix file has no rows.")

    header = rows[0]
    data_rows = rows[1:]
    if not data_rows:
        destination_expression.write_text(raw_text, encoding="utf-8")
        return

    top_variable_genes = parse_positive_int(project_manifest.get("top_variable_genes"))
    include_all_tfs = parse_bool(project_manifest.get("include_all_tfs"))
    normalize_enabled = parse_bool(project_manifest.get("normalize_enabled"))
    log_transform_enabled = parse_bool(project_manifest.get("log_transform_enabled"))

    tf_genes = load_known_tf_genes(project_manifest) if include_all_tfs else set()

    parsed_rows: list[tuple[int, str, list[str], list[float]]] = []
    for index, row in enumerate(data_rows):
        if not row:
            continue

        gene_name = str(row[0]).strip()
        raw_numeric_values: list[float] = []
        for value in row[1:]:
            try:
                raw_numeric_values.append(float(str(value).strip()))
            except (TypeError, ValueError):
                raw_numeric_values.append(0.0)

        parsed_rows.append((index, gene_name, row, raw_numeric_values))

    if not parsed_rows:
        destination_expression.write_text(raw_text, encoding="utf-8")
        return

    transformed_numeric_rows = [list(values) for _, _, _, values in parsed_rows]
    if normalize_enabled:
        transformed_numeric_rows = normalize_expression_rows(transformed_numeric_rows)
    if log_transform_enabled:
        transformed_numeric_rows = log_transform_expression_rows(transformed_numeric_rows)

    scored_rows: list[tuple[float, int, str, list[str], list[float]]] = []
    for (index, gene_name, row, _), transformed_values in zip(parsed_rows, transformed_numeric_rows):
        variance = compute_row_variance(transformed_values)
        scored_rows.append((variance, index, gene_name, row, transformed_values))

    retained_indices: set[int]
    if top_variable_genes is None or top_variable_genes >= len(scored_rows):
        retained_indices = {index for _, index, _, _, _ in scored_rows}
    else:
        sorted_rows = sorted(scored_rows, key=lambda item: (-item[0], item[1]))
        retained_indices = {index for _, index, _, _, _ in sorted_rows[:top_variable_genes]}

    if include_all_tfs and tf_genes:
        for _, index, gene_name, _, _ in scored_rows:
            if gene_name in tf_genes:
                retained_indices.add(index)

    transformed_row_by_index = {
        index: (original_row, transformed_values)
        for _, index, _, original_row, transformed_values in scored_rows
    }

    filtered_rows = [header]
    for index, _row in enumerate(data_rows):
        if index not in retained_indices:
            continue

        original_row, transformed_values = transformed_row_by_index[index]
        filtered_rows.append(
            [original_row[0], *[f"{value:.10f}" for value in transformed_values]]
        )

    output_buffer = io.StringIO()
    writer = csv.writer(
        output_buffer,
        delimiter=getattr(dialect, "delimiter", ","),
        quotechar=getattr(dialect, "quotechar", '"'),
        lineterminator="\n",
    )
    writer.writerows(filtered_rows)
    destination_expression.write_text(output_buffer.getvalue(), encoding="utf-8")


def extract_user_friendly_beeline_error(stderr_text: str, algorithm_id: str) -> str:
    if not stderr_text or not stderr_text.strip():
        return f"{algorithm_id} failed during execution, but no detailed error message was returned by BEELINE."

    lines = [line.strip() for line in stderr_text.splitlines() if line.strip()]

    ignore_prefixes = (
        "traceback",
        'file "',
        "during handling of the above exception",
        "return future.result()",
        "await ",
        "raise ",
        "self.",
        "module = ",
        "config.load()",
        "response = ",
        "raw_response = ",
        "return await",
    )

    useful_lines: list[str] = []
    for line in lines:
        lowered = line.lower()
        if lowered.startswith(ignore_prefixes):
            continue
        if lowered.startswith("line ") and " in " in lowered:
            continue
        if "/site-packages/" in line or "/python3." in line:
            continue
        useful_lines.append(line)

    priority_markers = (
        "error",
        "exception",
        "failed",
        "no such file",
        "not found",
        "cannot",
        "missing",
        "invalid",
        "valueerror",
        "keyerror",
        "typeerror",
        "runtimeerror",
        "importerror",
        "filenotfounderror",
    )

    prioritized = [
        line for line in useful_lines if any(marker in line.lower() for marker in priority_markers)
    ]

    chosen_lines = prioritized[:3] if prioritized else useful_lines[-3:]
    message = " ".join(chosen_lines).strip()

    if not message:
        return f"{algorithm_id} failed during execution. Check the server logs for more details."

    message = message.replace("BEELINE failed for", "")
    message = message.replace("Traceback (most recent call last):", "")
    message = " ".join(message.split())

    if len(message) > 400:
        message = message[:397].rstrip() + "..."

    return message


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

    preprocess_expression_matrix(
        source_expression=source_expression,
        destination_expression=run_dir / "ExpressionData.csv",
        project_manifest=project_manifest,
    )

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
    image_name = resolve_algorithm_image(algorithm_id)

    run_lines = [
        f"        - run_id: {yaml_scalar(run_id)}",
        '          exprData: "ExpressionData.csv"',
    ]
    if include_pseudotime:
        run_lines.append('          pseudoTimeData: "PseudoTime.csv"')

    params = resolve_algorithm_default_params(normalized_algorithm_id)

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

    scores = [edge["score"] for edge in parsed_edges]
    min_score = min(scores)
    max_score = max(scores)
    score_range = max_score - min_score

    for edge in parsed_edges:
        edge["normalized_score"] = (
            1.0 if score_range == 0 else (edge["score"] - min_score) / score_range
        )

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
        friendly_error = extract_user_friendly_beeline_error(
            completed_process.stderr or "",
            algorithm_id,
        )
        raise RuntimeError(friendly_error)

    normalized_algorithm_id = algorithm_id.upper()
    ranked_edges_path = output_dir / dataset_id / run_id / normalized_algorithm_id / "rankedEdges.csv"
    top_edges, network_summary = parse_ranked_edges_csv(ranked_edges_path)

    docker_image_version = resolve_algorithm_image(algorithm_id)
    return {
        "project_id": project_id,
        "algorithm_id": algorithm_id,
        "docker_image_version": docker_image_version,
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
        friendly_error = extract_user_friendly_beeline_error(stderr_text or "", algorithm_id)
        raise RuntimeError(friendly_error)

    update_job_state_fn(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=92,
        progress_label="Parsing ranked edges",
    )

    normalized_algorithm_id = algorithm_id.upper()
    ranked_edges_path = output_dir / dataset_id / run_id / normalized_algorithm_id / "rankedEdges.csv"
    top_edges, network_summary = parse_ranked_edges_csv(ranked_edges_path)

    update_job_state_fn(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=98,
        progress_label="Finalizing result",
    )

    docker_image_version = resolve_algorithm_image(algorithm_id)
    return {
        "project_id": project_id,
        "algorithm_id": algorithm_id,
        "docker_image_version": docker_image_version,
        "network_summary": network_summary,
        "top_edges": top_edges,
        "runtime_root": str(runtime_root),
        "ranked_edges_path": str(ranked_edges_path),
    }