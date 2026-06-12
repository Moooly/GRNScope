from __future__ import annotations

import csv
import io
import json
import os
import random
import re
import shutil
import signal
import subprocess
import sys
import time
from math import fsum, log2
from pathlib import Path

from ..algorithm_registry import get_algorithm_by_id
from ..config import BEELINE_ROOT_CANDIDATES, PROJECTS_ROOT
from ..repositories.project_repository import read_project_manifest


DEFAULT_CONFIDENCE_BOOTSTRAP_RUNS = 30
DEFAULT_CONFIDENCE_SUBSAMPLE_FRACTION = 0.8
DEFAULT_CONFIDENCE_STABILITY_TOP_K = 10


class AlgorithmStoppedError(RuntimeError):
    pass


ERROR_PRIORITY_MARKERS = (
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
    "out of memory",
    "killed",
)

ERROR_NOISE_MARKERS = (
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
    "ld_library_path",
    "matlab runtime cache",
    "creating matlab runtime cache",
    "acquiring matlab runtime cache",
    "command being timed",
    "user time",
    "system time",
    "percent of cpu",
    "elapsed wall clock",
    "maximum resident set size",
)


def looks_like_progress_only_message(message: str) -> bool:
    lowered = message.lower()
    has_progress_bar = bool(re.search(r"\d+%\|", message)) or "s/it" in lowered or "it/s" in lowered
    has_run_counter = bool(re.search(r"\b\d+\s*/\s*\d+\b", message))
    has_real_error_marker = any(marker in lowered for marker in ERROR_PRIORITY_MARKERS)
    return has_progress_bar and has_run_counter and not has_real_error_marker


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


def parse_positive_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def resolve_confidence_settings(project_manifest: dict) -> dict:
    run_count = (
        parse_positive_int(project_manifest.get("confidence_bootstrap_runs"))
        or parse_positive_int(os.environ.get("GRNSCOPE_CONFIDENCE_BOOTSTRAP_RUNS"))
        or DEFAULT_CONFIDENCE_BOOTSTRAP_RUNS
    )
    stability_top_k = (
        parse_positive_int(project_manifest.get("confidence_stability_top_k"))
        or parse_positive_int(os.environ.get("GRNSCOPE_CONFIDENCE_STABILITY_TOP_K"))
        or DEFAULT_CONFIDENCE_STABILITY_TOP_K
    )
    subsample_fraction = (
        parse_positive_float(project_manifest.get("confidence_subsample_fraction"))
        or parse_positive_float(os.environ.get("GRNSCOPE_CONFIDENCE_SUBSAMPLE_FRACTION"))
        or DEFAULT_CONFIDENCE_SUBSAMPLE_FRACTION
    )

    return {
        "bootstrap_runs": max(1, run_count),
        "subsample_fraction": min(max(subsample_fraction, 0.01), 1.0),
        "stability_top_k": max(1, stability_top_k),
    }


def stable_seed_for(project_id: str, algorithm_id: str) -> int:
    seed_source = f"{project_id}:{algorithm_id.upper()}"
    return sum((index + 1) * ord(char) for index, char in enumerate(seed_source))


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


def read_delimited_rows(source_path: Path) -> tuple[list[list[str]], csv.Dialect | type[csv.Dialect]]:
    raw_text = source_path.read_text(encoding="utf-8")
    if not raw_text.strip():
        raise ValueError(f"{source_path.name} is empty.")
    dialect = detect_csv_dialect(raw_text)
    return list(csv.reader(io.StringIO(raw_text), dialect=dialect)), dialect


def write_delimited_rows(
    destination_path: Path,
    rows: list[list[str]],
    dialect: csv.Dialect | type[csv.Dialect],
) -> None:
    output_buffer = io.StringIO()
    writer = csv.writer(
        output_buffer,
        delimiter=getattr(dialect, "delimiter", ","),
        quotechar=getattr(dialect, "quotechar", '"'),
        lineterminator="\n",
    )
    writer.writerows(rows)
    destination_path.write_text(output_buffer.getvalue(), encoding="utf-8")


def subset_expression_rows_by_cells(
    rows: list[list[str]],
    selected_column_indices: list[int],
) -> list[list[str]]:
    if not rows:
        return []

    retained_indices = [0, *selected_column_indices]
    subset_rows: list[list[str]] = []
    for row in rows:
        subset_rows.append(
            [row[index] if index < len(row) else "" for index in retained_indices]
        )
    return subset_rows


def subset_pseudotime_rows_by_cells(
    source_pseudotime: Path,
    destination_pseudotime: Path,
    selected_cell_names: set[str],
) -> None:
    try:
        rows, dialect = read_delimited_rows(source_pseudotime)
    except Exception:
        shutil.copy2(source_pseudotime, destination_pseudotime)
        return

    if len(rows) <= 1 or not selected_cell_names:
        shutil.copy2(source_pseudotime, destination_pseudotime)
        return

    header = rows[0]
    retained_rows = [header]
    matched = 0
    for row in rows[1:]:
        if row and row[0] in selected_cell_names:
            retained_rows.append(row)
            matched += 1

    if matched == 0:
        shutil.copy2(source_pseudotime, destination_pseudotime)
        return

    write_delimited_rows(destination_pseudotime, retained_rows, dialect)


def create_confidence_run_inputs(
    *,
    runtime_root: Path,
    input_dir: Path,
    dataset_id: str,
    algorithm_id: str,
    project_manifest: dict,
    source_expression: Path,
    source_pseudotime: Path | None,
) -> tuple[list[str], dict[str, dict], dict]:
    settings = resolve_confidence_settings(project_manifest)
    bootstrap_runs = int(settings["bootstrap_runs"])
    subsample_fraction = float(settings["subsample_fraction"])

    preprocessed_dir = runtime_root / "_preprocessed"
    preprocessed_dir.mkdir(parents=True, exist_ok=True)
    preprocessed_expression = preprocessed_dir / "ExpressionData.csv"
    preprocess_expression_matrix(
        source_expression=source_expression,
        destination_expression=preprocessed_expression,
        project_manifest=project_manifest,
    )

    expression_rows, expression_dialect = read_delimited_rows(preprocessed_expression)
    if not expression_rows:
        raise ValueError("Expression matrix file has no rows after preprocessing.")

    header = expression_rows[0]
    cell_column_indices = list(range(1, len(header)))
    if not cell_column_indices:
        cell_column_indices = []

    sample_size = len(cell_column_indices)
    if bootstrap_runs > 1 and cell_column_indices:
        sample_size = max(1, int(round(len(cell_column_indices) * subsample_fraction)))

    seed_base = stable_seed_for(project_id=dataset_id, algorithm_id=algorithm_id)
    run_ids: list[str] = []
    run_metadata: dict[str, dict] = {}

    for run_index in range(bootstrap_runs):
        run_id = f"run-{run_index + 1}"
        run_ids.append(run_id)
        run_dir = input_dir / dataset_id / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        seed = seed_base + run_index
        if bootstrap_runs > 1 and cell_column_indices:
            rng = random.Random(seed)
            selected_column_indices = sorted(rng.sample(cell_column_indices, sample_size))
        else:
            selected_column_indices = cell_column_indices

        selected_cell_names = {
            header[index]
            for index in selected_column_indices
            if index < len(header) and str(header[index]).strip()
        }
        expression_subset = subset_expression_rows_by_cells(
            expression_rows,
            selected_column_indices,
        )
        write_delimited_rows(run_dir / "ExpressionData.csv", expression_subset, expression_dialect)

        if source_pseudotime and source_pseudotime.exists():
            subset_pseudotime_rows_by_cells(
                source_pseudotime,
                run_dir / "PseudoTime.csv",
                selected_cell_names,
            )

        run_metadata[run_id] = {
            "seed": seed,
            "cell_count": len(selected_column_indices),
            "total_cell_count": len(cell_column_indices),
            "subsample_fraction": (
                len(selected_column_indices) / len(cell_column_indices)
                if cell_column_indices
                else 1.0
            ),
        }

    return run_ids, run_metadata, settings


def sanitize_error_message(message: str) -> str:
    cleaned = re.sub(r"\x1b\[[0-9;]*m", "", message)
    cleaned = cleaned.replace("Traceback (most recent call last):", "")
    cleaned = cleaned.replace("BEELINE failed for", "")
    cleaned = re.sub(r"/home/[^ ]+/GRNScope/backend/projects/[^\s'\"]+", "project runtime file", cleaned)
    cleaned = re.sub(r"/Users/[^ ]+/GRNScope/backend/projects/[^\s'\"]+", "project runtime file", cleaned)
    cleaned = re.sub(r"/private/var/[^\s'\"]+", "temporary runtime file", cleaned)
    cleaned = " ".join(cleaned.split())
    return cleaned.strip(" :")


def extract_useful_error_message(log_text: str, algorithm_id: str) -> str | None:
    if not log_text or not log_text.strip():
        return None

    useful_lines: list[str] = []
    for raw_line in log_text.splitlines():
        line = sanitize_error_message(raw_line.strip())
        if not line:
            continue

        lowered = line.lower()
        if looks_like_progress_only_message(line):
            continue
        if lowered.startswith(ERROR_NOISE_MARKERS):
            continue
        if lowered.startswith("line ") and " in " in lowered:
            continue
        if "/site-packages/" in line or "/python3." in line:
            continue
        useful_lines.append(line)

    prioritized = [
        line
        for line in useful_lines
        if any(marker in line.lower() for marker in ERROR_PRIORITY_MARKERS)
    ]
    chosen_lines = prioritized[-4:] if prioritized else useful_lines[-4:]
    message = " ".join(chosen_lines).strip()
    if not message:
        return None

    message = sanitize_error_message(message)
    if looks_like_progress_only_message(message):
        return None
    if len(message) > 500:
        message = message[:497].rstrip() + "..."
    return message or None


def extract_user_friendly_beeline_error(log_text: str, algorithm_id: str) -> str:
    message = extract_useful_error_message(log_text, algorithm_id)
    if message:
        return message
    return (
        f"{algorithm_id} stopped before producing a usable result. "
        "The available logs only contain progress updates, so no specific error message was returned. "
        "Try rerunning this algorithm once. If it fails again, contact support so the server logs can be checked."
    )


def read_recent_log_text(path: Path, max_bytes: int = 20000) -> str:
    try:
        if not path.is_file() or path.stat().st_size <= 0:
            return ""
        with path.open("rb") as file:
            file.seek(0, os.SEEK_END)
            size = file.tell()
            file.seek(max(0, size - max_bytes))
            return file.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def collect_algorithm_error_log_text(
    *,
    runtime_root: Path,
    output_dir: Path,
    dataset_id: str,
    run_id: str,
    algorithm_id: str,
) -> str:
    normalized_algorithm_id = algorithm_id.upper()
    run_output_dir = output_dir / dataset_id / run_id / normalized_algorithm_id
    log_paths = [
        run_output_dir / "output.txt",
        *sorted((run_output_dir / "working_dir").glob("time*.txt")),
        runtime_root / "stderr.log",
        runtime_root / "stdout.log",
    ]
    return "\n".join(read_recent_log_text(path) for path in log_paths)


def build_missing_ranked_edges_error(
    *,
    runtime_root: Path,
    output_dir: Path,
    dataset_id: str,
    run_id: str,
    algorithm_id: str,
) -> str:
    log_text = collect_algorithm_error_log_text(
        runtime_root=runtime_root,
        output_dir=output_dir,
        dataset_id=dataset_id,
        run_id=run_id,
        algorithm_id=algorithm_id,
    )
    log_message = extract_useful_error_message(log_text, algorithm_id)
    base_message = (
        f"{algorithm_id} finished without producing an edge result. "
        "This usually means the algorithm container stopped before exporting its output."
    )
    if log_message:
        return f"{base_message} The most relevant log message was: {log_message}"
    return (
        f"{base_message} No clear error message was found in the BEELINE logs. "
        "If this happened after changing a Docker image, restore or rebuild that image and rerun the algorithm. "
        "If the problem continues, contact support with this project."
    )


def prepare_beeline_runtime(
    project_id: str,
    algorithm_id: str,
    project_manifest: dict,
) -> tuple[Path, Path, Path, str, list[str], dict[str, dict], dict]:
    runtime_root = PROJECTS_ROOT / project_id / "_beeline_runtime" / algorithm_id
    if runtime_root.exists():
        shutil.rmtree(runtime_root)
    runtime_root.mkdir(parents=True, exist_ok=True)

    input_dir = runtime_root / "inputs"
    output_dir = runtime_root / "outputs"
    dataset_id = project_id

    expression_path = project_manifest.get("expression_path")
    pseudotime_path = project_manifest.get("pseudotime_path")

    if not expression_path:
        raise FileNotFoundError("Project expression_path is missing.")

    source_expression = Path(expression_path)
    if not source_expression.exists():
        raise FileNotFoundError("Expression matrix file not found on disk.")

    source_pseudotime = None
    if pseudotime_path:
        candidate_pseudotime = Path(pseudotime_path)
        if candidate_pseudotime.exists():
            source_pseudotime = candidate_pseudotime

    run_ids, run_metadata, confidence_settings = create_confidence_run_inputs(
        runtime_root=runtime_root,
        input_dir=input_dir,
        dataset_id=dataset_id,
        algorithm_id=algorithm_id,
        project_manifest=project_manifest,
        source_expression=source_expression,
        source_pseudotime=source_pseudotime,
    )

    return (
        runtime_root,
        input_dir,
        output_dir,
        dataset_id,
        run_ids,
        run_metadata,
        confidence_settings,
    )


def build_beeline_config(
    input_dir: Path,
    output_dir: Path,
    dataset_id: str,
    run_ids: list[str],
    algorithm_id: str,
    include_pseudotime: bool,
) -> str:
    normalized_algorithm_id = algorithm_id.upper()
    image_name = resolve_algorithm_image(algorithm_id)

    run_lines: list[str] = []
    for run_id in run_ids:
        run_lines.extend(
            [
                f"        - run_id: {yaml_scalar(run_id)}",
                '          exprData: "ExpressionData.csv"',
            ]
        )
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


def quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * q
    lower_index = int(position)
    upper_index = min(lower_index + 1, len(ordered) - 1)
    fraction = position - lower_index
    return ordered[lower_index] * (1 - fraction) + ordered[upper_index] * fraction


def compute_population_sd(values: list[float]) -> float:
    if len(values) <= 1:
        return 0.0
    mean_value = fsum(values) / len(values)
    variance = fsum((value - mean_value) ** 2 for value in values) / len(values)
    return variance ** 0.5


def aggregate_confidence_edges(
    run_edges_by_id: dict[str, list[dict]],
    *,
    stability_top_k: int,
) -> tuple[list[dict], dict]:
    run_ids = list(run_edges_by_id.keys())
    run_count = max(1, len(run_ids))
    accumulator: dict[tuple[str, str], dict] = {}
    all_node_names: set[str] = set()

    for run_id, run_edges in run_edges_by_id.items():
        entries_by_target: dict[str, list[dict]] = {}
        for edge in run_edges:
            source = str(edge.get("source", "")).strip()
            target = str(edge.get("target", "")).strip()
            if not source or not target:
                continue
            entries_by_target.setdefault(target, []).append(edge)
            all_node_names.add(source)
            all_node_names.add(target)

        for target, target_edges in entries_by_target.items():
            ranked_edges_with_duplicates = sorted(
                target_edges,
                key=lambda item: (
                    -abs(float(item.get("score", 0) or 0)),
                    str(item.get("source", "")),
                ),
            )
            ranked_edges: list[dict] = []
            seen_sources: set[str] = set()
            for edge in ranked_edges_with_duplicates:
                source = str(edge.get("source", "")).strip()
                if not source or source in seen_sources:
                    continue
                seen_sources.add(source)
                ranked_edges.append(edge)

            weights = [abs(float(item.get("score", 0) or 0)) for item in ranked_edges]
            mean_weight = fsum(weights) / len(weights) if weights else 0.0
            sd_weight = compute_population_sd(weights)
            denominator = max(len(ranked_edges) - 1, 1)

            for index, edge in enumerate(ranked_edges):
                source = str(edge.get("source", "")).strip()
                raw_score = float(edge.get("score", 0) or 0)
                weight = abs(raw_score)
                rank = index + 1
                percentile = 1.0 if len(ranked_edges) <= 1 else 1 - ((rank - 1) / denominator)
                z_score = 0.0 if sd_weight <= 0 else (weight - mean_weight) / sd_weight
                key = (source, target)
                current = accumulator.setdefault(
                    key,
                    {
                        "source": source,
                        "target": target,
                        "raw_scores": [],
                        "z_scores": [],
                        "percentiles": [],
                        "selected_runs": 0,
                        "observed_runs": 0,
                        "best_rank": None,
                        "run_ranks": {},
                    },
                )

                current["raw_scores"].append(raw_score)
                current["z_scores"].append(z_score)
                current["percentiles"].append(percentile)
                current["observed_runs"] += 1
                current["run_ranks"][run_id] = rank
                current["best_rank"] = (
                    rank
                    if current["best_rank"] is None
                    else min(current["best_rank"], rank)
                )
                if rank <= stability_top_k:
                    current["selected_runs"] += 1

    aggregated_edges: list[dict] = []
    for current in accumulator.values():
        missing_runs = run_count - int(current["observed_runs"])
        z_values = [*current["z_scores"], *([0.0] * max(0, missing_runs))]
        percentile_sum = fsum(current["percentiles"])
        mean_percentile = percentile_sum / run_count
        mean_z = fsum(z_values) / run_count
        stability = int(current["selected_runs"]) / run_count
        confidence = max(0.0, min(1.0, stability * mean_percentile))
        raw_scores = current["raw_scores"]
        mean_raw_score = fsum(raw_scores) / len(raw_scores) if raw_scores else 0.0

        aggregated_edges.append(
            {
                "source": current["source"],
                "target": current["target"],
                "score": confidence,
                "confidence": confidence,
                "stability": stability,
                "mean_percentile": mean_percentile,
                "mean_z": mean_z,
                "z_ci_lower": quantile(z_values, 0.025),
                "z_ci_upper": quantile(z_values, 0.975),
                "mean_raw_score": mean_raw_score,
                "selected_runs": int(current["selected_runs"]),
                "observed_runs": int(current["observed_runs"]),
                "run_count": run_count,
                "best_rank": current["best_rank"],
            }
        )

    aggregated_edges.sort(
        key=lambda edge: (
            -float(edge["confidence"]),
            -float(edge["mean_percentile"]),
            str(edge["source"]),
            str(edge["target"]),
        )
    )
    for index, edge in enumerate(aggregated_edges, start=1):
        edge["rank"] = index

    return aggregated_edges, {
        "edge_count": len(aggregated_edges),
        "node_count": len(all_node_names),
        "confidence_scored": True,
        "bootstrap_runs": run_count,
        "stability_top_k": stability_top_k,
    }


def parse_confidence_run_outputs(
    output_dir: Path,
    dataset_id: str,
    run_ids: list[str],
    algorithm_id: str,
    *,
    runtime_root: Path,
) -> tuple[dict[str, list[dict]], dict[str, str]]:
    normalized_algorithm_id = algorithm_id.upper()
    run_edges_by_id: dict[str, list[dict]] = {}
    ranked_edge_paths: dict[str, str] = {}

    for run_id in run_ids:
        ranked_edges_path = (
            output_dir
            / dataset_id
            / run_id
            / normalized_algorithm_id
            / "rankedEdges.csv"
        )
        try:
            run_edges, _ = parse_ranked_edges_csv(ranked_edges_path)
        except FileNotFoundError as exc:
            raise RuntimeError(
                build_missing_ranked_edges_error(
                    runtime_root=runtime_root,
                    output_dir=output_dir,
                    dataset_id=dataset_id,
                    run_id=run_id,
                    algorithm_id=algorithm_id,
                )
            ) from exc
        except ValueError as exc:
            raise RuntimeError(
                f"{algorithm_id} produced an edge result, but GRNScope could not read it: {sanitize_error_message(str(exc))}"
            ) from exc
        run_edges_by_id[run_id] = run_edges
        ranked_edge_paths[run_id] = str(ranked_edges_path)

    return run_edges_by_id, ranked_edge_paths


def count_completed_confidence_run_outputs(
    output_dir: Path,
    dataset_id: str,
    run_ids: list[str],
    algorithm_id: str,
) -> int:
    normalized_algorithm_id = algorithm_id.upper()
    completed = 0

    for run_id in run_ids:
        ranked_edges_path = (
            output_dir
            / dataset_id
            / run_id
            / normalized_algorithm_id
            / "rankedEdges.csv"
        )
        try:
            if ranked_edges_path.is_file() and ranked_edges_path.stat().st_size > 0:
                completed += 1
        except OSError:
            continue

    return completed


def write_confidence_ranked_edges_csv(destination_path: Path, edges: list[dict]) -> None:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "Gene1",
        "Gene2",
        "EdgeWeight",
        "Confidence",
        "Stability",
        "MeanPercentile",
        "MeanZ",
        "ZCILower",
        "ZCIUpper",
        "SelectedRuns",
        "ObservedRuns",
        "RunCount",
        "BestRank",
    ]
    with destination_path.open("w", encoding="utf-8", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        for edge in edges:
            writer.writerow(
                {
                    "Gene1": edge["source"],
                    "Gene2": edge["target"],
                    "EdgeWeight": edge.get("mean_raw_score", 0.0),
                    "Confidence": edge.get("confidence", 0.0),
                    "Stability": edge.get("stability", 0.0),
                    "MeanPercentile": edge.get("mean_percentile", 0.0),
                    "MeanZ": edge.get("mean_z", 0.0),
                    "ZCILower": edge.get("z_ci_lower"),
                    "ZCIUpper": edge.get("z_ci_upper"),
                    "SelectedRuns": edge.get("selected_runs", 0),
                    "ObservedRuns": edge.get("observed_runs", 0),
                    "RunCount": edge.get("run_count", 0),
                    "BestRank": edge.get("best_rank"),
                }
            )


def execute_beeline_algorithm(project_id: str, algorithm_id: str) -> dict:
    project_dir = PROJECTS_ROOT / project_id
    project_manifest = read_project_manifest(project_dir)
    beeline_root = resolve_beeline_root()

    (
        runtime_root,
        input_dir,
        output_dir,
        dataset_id,
        run_ids,
        run_metadata,
        confidence_settings,
    ) = prepare_beeline_runtime(
        project_id,
        algorithm_id,
        project_manifest,
    )

    config_path = runtime_root / "config.yaml"
    config_text = build_beeline_config(
        input_dir=input_dir,
        output_dir=output_dir,
        dataset_id=dataset_id,
        run_ids=run_ids,
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
            "\n".join(
                [
                    completed_process.stderr or "",
                    completed_process.stdout or "",
                ]
            ),
            algorithm_id,
        )
        raise RuntimeError(friendly_error)

    run_edges_by_id, ranked_edge_paths = parse_confidence_run_outputs(
        output_dir,
        dataset_id,
        run_ids,
        algorithm_id,
        runtime_root=runtime_root,
    )
    top_edges, network_summary = aggregate_confidence_edges(
        run_edges_by_id,
        stability_top_k=int(confidence_settings["stability_top_k"]),
    )
    ranked_edges_path = runtime_root / "rankedEdges_confidence.csv"
    write_confidence_ranked_edges_csv(ranked_edges_path, top_edges)

    docker_image_version = resolve_algorithm_image(algorithm_id)
    return {
        "project_id": project_id,
        "algorithm_id": algorithm_id,
        "docker_image_version": docker_image_version,
        "network_summary": network_summary,
        "top_edges": top_edges,
        "confidence_summary": {
            **confidence_settings,
            "run_metadata": run_metadata,
        },
        "run_ranked_edges_paths": ranked_edge_paths,
        "runtime_root": str(runtime_root),
        "ranked_edges_path": str(ranked_edges_path),
    }


def run_beeline_with_progress(
    project_id: str,
    job_id: str,
    algorithm_id: str,
    update_job_state_fn,
    stop_event=None,
    on_process_start=None,
    elapsed_started_at: float | None = None,
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

    if stop_event is not None and stop_event.is_set():
        raise AlgorithmStoppedError("Algorithm run was stopped.")

    (
        runtime_root,
        input_dir,
        output_dir,
        dataset_id,
        run_ids,
        run_metadata,
        confidence_settings,
    ) = prepare_beeline_runtime(
        project_id,
        algorithm_id,
        project_manifest,
    )

    config_path = runtime_root / "config.yaml"
    config_text = build_beeline_config(
        input_dir=input_dir,
        output_dir=output_dir,
        dataset_id=dataset_id,
        run_ids=run_ids,
        algorithm_id=algorithm_id,
        include_pseudotime=bool(project_manifest.get("pseudotime_path")),
    )
    config_path.write_text(config_text, encoding="utf-8")

    update_job_state_fn(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=15,
        progress_label="Launching analysis",
    )

    if stop_event is not None and stop_event.is_set():
        raise AlgorithmStoppedError("Algorithm run was stopped.")

    python_executable = os.environ.get("BEELINE_PYTHON", sys.executable)
    command = [python_executable, "BLRunner.py", "-c", str(config_path)]

    started_at = elapsed_started_at or time.time()
    process = subprocess.Popen(
        command,
        cwd=beeline_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    if on_process_start is not None:
        on_process_start(process)

    while process.poll() is None:
        if stop_event is not None and stop_event.is_set():
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            break

        elapsed = int(time.time() - started_at)
        completed_run_count = count_completed_confidence_run_outputs(
            output_dir,
            dataset_id,
            run_ids,
            algorithm_id,
        )
        estimated_remaining_seconds = None
        if completed_run_count > 0:
            average_seconds_per_completed_run = elapsed / completed_run_count
            estimated_remaining_seconds = int(
                round(
                    average_seconds_per_completed_run
                    * max(0, len(run_ids) - completed_run_count)
                )
            )
            progress_percent = min(
                85,
                20 + round((completed_run_count / max(1, len(run_ids))) * 65),
            )
            progress_label = "Running analysis"
        else:
            progress_percent = min(25, 20 + elapsed // 10)
            progress_label = "Starting analysis"

        update_job_state_fn(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            elapsed_seconds=elapsed,
            progress_percent=progress_percent,
            progress_label=progress_label,
            estimated_remaining_seconds=estimated_remaining_seconds,
        )
        time.sleep(1)

    stdout_text, stderr_text = process.communicate()

    (runtime_root / "stdout.log").write_text(stdout_text or "", encoding="utf-8")
    (runtime_root / "stderr.log").write_text(stderr_text or "", encoding="utf-8")

    if stop_event is not None and stop_event.is_set():
        raise AlgorithmStoppedError("Algorithm run was stopped.")

    if process.returncode != 0:
        friendly_error = extract_user_friendly_beeline_error(
            "\n".join([stderr_text or "", stdout_text or ""]),
            algorithm_id,
        )
        raise RuntimeError(friendly_error)

    update_job_state_fn(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=92,
        progress_label="Aggregating confidence scores",
    )

    run_edges_by_id, ranked_edge_paths = parse_confidence_run_outputs(
        output_dir,
        dataset_id,
        run_ids,
        algorithm_id,
        runtime_root=runtime_root,
    )
    top_edges, network_summary = aggregate_confidence_edges(
        run_edges_by_id,
        stability_top_k=int(confidence_settings["stability_top_k"]),
    )
    ranked_edges_path = runtime_root / "rankedEdges_confidence.csv"
    write_confidence_ranked_edges_csv(ranked_edges_path, top_edges)

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
        "confidence_summary": {
            **confidence_settings,
            "run_metadata": run_metadata,
        },
        "run_ranked_edges_paths": ranked_edge_paths,
        "runtime_root": str(runtime_root),
        "ranked_edges_path": str(ranked_edges_path),
    }
