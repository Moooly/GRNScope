from __future__ import annotations

import csv
import heapq
import hashlib
import io
import json
import os
import random
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from itertools import chain
from math import fsum, isfinite, log2
from pathlib import Path

from ..algorithm_registry import get_algorithm_by_id
from ..config import BEELINE_ROOT_CANDIDATES, PROJECTS_ROOT
from ..repositories.project_repository import read_project_manifest


DEFAULT_CONFIDENCE_BOOTSTRAP_RUNS = 30
DEFAULT_CONFIDENCE_SUBSAMPLE_FRACTION = 0.8
DEFAULT_CONFIDENCE_STABILITY_TOP_K = 10
DEFAULT_RANKED_EDGES_PER_TARGET_LIMIT = 10
DEFAULT_SPACE_FREE_LINK_ROOT = Path.home() / ".grnscope" / "beeline_links"
DEFAULT_SPACE_FREE_RUNTIME_ROOT = Path.home() / ".grnscope" / "beeline_runtime"
BEELINE_MIRROR_ENTRIES = ("BLRunner.py", "BLRun", "Algorithms", "utils")
_BEELINE_MIRROR_LOCK = threading.Lock()
PROJECT_PREPROCESSED_DIRNAME = "preprocessed"
PROJECT_PREPROCESSED_EXPRESSION_FILENAME = "ExpressionData.csv"
PROJECT_PREPROCESSED_MANIFEST_FILENAME = "manifest.json"
PROJECT_PREPROCESSED_LOCK_DIRNAME = ".preprocessing.lock"
RUN_TIMINGS_FILENAME = "run_timings.json"
CSV_SNIFF_SAMPLE_BYTES = 65536


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


def path_contains_shell_sensitive_whitespace(path: Path) -> bool:
    return any(character.isspace() for character in str(path))


def stable_path_digest(path: Path) -> str:
    return hashlib.sha1(str(path).encode("utf-8")).hexdigest()[:12]


def beeline_source_signature(beeline_root: Path) -> str:
    latest_mtime_ns = 0
    total_size = 0

    for entry_name in BEELINE_MIRROR_ENTRIES:
        entry_path = beeline_root / entry_name
        if not entry_path.exists():
            continue
        paths = entry_path.rglob("*") if entry_path.is_dir() else [entry_path]
        for path in paths:
            if not path.is_file():
                continue
            if path.name == ".DS_Store" or "__pycache__" in path.parts:
                continue
            stat_result = path.stat()
            latest_mtime_ns = max(latest_mtime_ns, stat_result.st_mtime_ns)
            total_size += stat_result.st_size

    return f"{beeline_root.resolve()}\n{latest_mtime_ns}\n{total_size}\n"


def copy_beeline_execution_mirror(source_root: Path, mirror_root: Path) -> Path:
    source_root = source_root.resolve()
    signature = beeline_source_signature(source_root)
    marker_path = mirror_root / ".grnscope_mirror_signature"

    with _BEELINE_MIRROR_LOCK:
        if mirror_root.is_dir() and marker_path.is_file():
            try:
                if marker_path.read_text(encoding="utf-8") == signature:
                    return mirror_root
            except OSError:
                pass

        temporary_root = mirror_root.with_name(
            f"{mirror_root.name}.tmp-{os.getpid()}-{int(time.time() * 1000)}"
        )
        if temporary_root.exists() or temporary_root.is_symlink():
            if temporary_root.is_dir() and not temporary_root.is_symlink():
                shutil.rmtree(temporary_root)
            else:
                temporary_root.unlink()
        temporary_root.mkdir(parents=True, exist_ok=True)

        ignore_patterns = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")
        for entry_name in BEELINE_MIRROR_ENTRIES:
            source_entry = source_root / entry_name
            destination_entry = temporary_root / entry_name
            if source_entry.is_dir():
                shutil.copytree(source_entry, destination_entry, ignore=ignore_patterns)
            elif source_entry.is_file():
                shutil.copy2(source_entry, destination_entry)

        (temporary_root / ".grnscope_mirror_signature").write_text(
            signature,
            encoding="utf-8",
        )

        if mirror_root.exists() or mirror_root.is_symlink():
            if mirror_root.is_dir() and not mirror_root.is_symlink():
                shutil.rmtree(mirror_root)
            else:
                mirror_root.unlink()
        temporary_root.rename(mirror_root)
        return mirror_root


def remove_path_if_present(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def space_free_beeline_root(beeline_root: Path) -> Path:
    beeline_root = beeline_root.resolve()
    if not path_contains_shell_sensitive_whitespace(beeline_root):
        return beeline_root

    link_root = Path(
        os.environ.get("GRNSCOPE_SPACE_FREE_LINK_ROOT", DEFAULT_SPACE_FREE_LINK_ROOT)
    ).expanduser()
    return copy_beeline_execution_mirror(
        beeline_root,
        link_root / f"beeline-{stable_path_digest(beeline_root.resolve())}",
    )


def space_free_runtime_root(runtime_root: Path, project_id: str, algorithm_id: str) -> Path:
    if not path_contains_shell_sensitive_whitespace(runtime_root):
        return runtime_root

    link_root = Path(
        os.environ.get("GRNSCOPE_SPACE_FREE_RUNTIME_ROOT", DEFAULT_SPACE_FREE_RUNTIME_ROOT)
    ).expanduser()
    return link_root / project_id / algorithm_id.upper()


def resolve_beeline_root() -> Path:
    for candidate in BEELINE_ROOT_CANDIDATES:
        if not candidate:
            continue
        blrunner_path = candidate / "BLRunner.py"
        if candidate.exists() and blrunner_path.exists():
            return space_free_beeline_root(candidate)
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


def format_run_timestamp(timestamp: float | None = None) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(timestamp or time.time()))


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


def resolve_ranked_edges_per_target_limit(
    algorithm_id: str,
    confidence_settings: dict | None = None,
) -> int | None:
    normalized_algorithm_id = algorithm_id.upper()
    configured_limit = (
        parse_positive_int(
            os.environ.get(f"GRNSCOPE_{normalized_algorithm_id}_MAX_EDGES_PER_TARGET")
        )
        or parse_positive_int(os.environ.get("GRNSCOPE_RANKED_EDGES_PER_TARGET_LIMIT"))
    )
    if configured_limit is not None:
        return configured_limit

    if normalized_algorithm_id != "PEARSON":
        return None

    stability_top_k = None
    if confidence_settings:
        stability_top_k = parse_positive_int(confidence_settings.get("stability_top_k"))
    return max(DEFAULT_RANKED_EDGES_PER_TARGET_LIMIT, stability_top_k or 0)


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


def detect_csv_dialect_from_file(source_path: Path) -> csv.Dialect | type[csv.Dialect]:
    with source_path.open("r", encoding="utf-8", newline="") as source_file:
        sample = source_file.read(CSV_SNIFF_SAMPLE_BYTES)

    if not sample.strip():
        raise ValueError(f"{source_path.name} is empty.")

    return detect_csv_dialect(sample)


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



def compute_row_variance(values: Iterable[float]) -> float:
    count = 0
    mean_value = 0.0
    sum_squared_delta = 0.0

    for value in values:
        count += 1
        delta = value - mean_value
        mean_value += delta / count
        sum_squared_delta += delta * (value - mean_value)

    if count <= 1:
        return 0.0
    return sum_squared_delta / count


def default_project_preprocessed_expression_path(project_id: str) -> Path:
    return (
        PROJECTS_ROOT
        / project_id
        / PROJECT_PREPROCESSED_DIRNAME
        / PROJECT_PREPROCESSED_EXPRESSION_FILENAME
    )


def resolve_project_preprocessed_expression_path(
    project_id: str,
    project_manifest: dict,
) -> Path:
    configured_path = project_manifest.get("preprocessed_expression_path")
    if configured_path:
        return Path(str(configured_path))
    return default_project_preprocessed_expression_path(project_id)


def build_preprocessing_signature(
    source_expression: Path,
    project_manifest: dict,
) -> dict:
    source_stat = source_expression.stat()
    include_all_tfs = parse_bool(project_manifest.get("include_all_tfs"))
    known_tf_path = (
        resolve_known_tf_list_path(project_manifest) if include_all_tfs else None
    )

    signature = {
        "source_expression_path": str(source_expression.resolve()),
        "source_expression_size": source_stat.st_size,
        "source_expression_mtime_ns": source_stat.st_mtime_ns,
        "top_variable_genes": project_manifest.get("top_variable_genes"),
        "include_all_tfs": project_manifest.get("include_all_tfs"),
        "normalize_enabled": project_manifest.get("normalize_enabled"),
        "log_transform_enabled": project_manifest.get("log_transform_enabled"),
    }

    if known_tf_path:
        known_tf_stat = known_tf_path.stat()
        signature.update(
            {
                "known_tf_path": str(known_tf_path.resolve()),
                "known_tf_size": known_tf_stat.st_size,
                "known_tf_mtime_ns": known_tf_stat.st_mtime_ns,
            }
        )
    else:
        signature["known_tf_path"] = None

    return signature


def read_preprocessed_manifest(manifest_path: Path) -> dict | None:
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def preprocessed_cache_is_valid(
    preprocessed_expression: Path,
    manifest_path: Path,
    expected_signature: dict,
) -> bool:
    if (
        not preprocessed_expression.exists()
        or preprocessed_expression.stat().st_size <= 0
    ):
        return False

    manifest = read_preprocessed_manifest(manifest_path)
    if not isinstance(manifest, dict):
        return False

    return manifest.get("signature") == expected_signature


def read_positive_float_env(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.environ.get(name, str(default))))
    except ValueError:
        return default


@contextmanager
def project_preprocessing_lock(preprocessed_dir: Path):
    lock_dir = preprocessed_dir / PROJECT_PREPROCESSED_LOCK_DIRNAME
    timeout_seconds = read_positive_float_env(
        "GRNSCOPE_PREPROCESS_LOCK_TIMEOUT",
        900.0,
    )
    stale_seconds = read_positive_float_env(
        "GRNSCOPE_PREPROCESS_LOCK_STALE_SECONDS",
        21600.0,
    )
    deadline = time.time() + timeout_seconds

    while True:
        try:
            lock_dir.mkdir(parents=True, exist_ok=False)
            (lock_dir / "owner.json").write_text(
                json.dumps(
                    {
                        "pid": os.getpid(),
                        "created_at": time.time(),
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            break
        except FileExistsError:
            try:
                lock_age = time.time() - lock_dir.stat().st_mtime
            except OSError:
                lock_age = 0

            if stale_seconds and lock_age > stale_seconds:
                shutil.rmtree(lock_dir, ignore_errors=True)
                continue

            if time.time() >= deadline:
                raise TimeoutError("Timed out waiting for project preprocessing lock.")
            time.sleep(0.5)

    try:
        yield
    finally:
        shutil.rmtree(lock_dir, ignore_errors=True)


def ensure_project_preprocessed_expression(
    project_id: str,
    source_expression: Path,
    project_manifest: dict,
) -> Path:
    preprocessed_expression = resolve_project_preprocessed_expression_path(
        project_id,
        project_manifest,
    )
    preprocessed_dir = preprocessed_expression.parent
    preprocessed_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = preprocessed_dir / PROJECT_PREPROCESSED_MANIFEST_FILENAME
    expected_signature = build_preprocessing_signature(
        source_expression,
        project_manifest,
    )

    if preprocessed_cache_is_valid(
        preprocessed_expression,
        manifest_path,
        expected_signature,
    ):
        return preprocessed_expression

    with project_preprocessing_lock(preprocessed_dir):
        if preprocessed_cache_is_valid(
            preprocessed_expression,
            manifest_path,
            expected_signature,
        ):
            return preprocessed_expression

        temporary_expression = preprocessed_expression.with_name(
            (
                f".{preprocessed_expression.name}."
                f"{os.getpid()}.{threading.get_ident()}.tmp"
            )
        )
        temporary_manifest = manifest_path.with_name(
            f".{manifest_path.name}.{os.getpid()}.{threading.get_ident()}.tmp"
        )

        try:
            preprocess_expression_matrix(
                source_expression=source_expression,
                destination_expression=temporary_expression,
                project_manifest=project_manifest,
            )
            temporary_manifest.write_text(
                json.dumps(
                    {
                        "signature": expected_signature,
                        "created_at": time.time(),
                        "preprocessed_expression_path": str(preprocessed_expression),
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            temporary_expression.replace(preprocessed_expression)
            temporary_manifest.replace(manifest_path)
        finally:
            temporary_expression.unlink(missing_ok=True)
            temporary_manifest.unlink(missing_ok=True)

    return preprocessed_expression


def parse_expression_numeric_values(row: list[str], cell_count: int) -> Iterator[float]:
    for column_index in range(cell_count):
        raw_value = row[column_index + 1] if column_index + 1 < len(row) else ""
        try:
            value = float(str(raw_value).strip())
        except (TypeError, ValueError):
            value = 0.0
        if not isfinite(value):
            value = 0.0
        yield value


def transform_expression_values(
    values: Iterable[float],
    *,
    column_sums: list[float] | None,
    normalize_enabled: bool,
    log_transform_enabled: bool,
) -> Iterator[float]:
    for column_index, value in enumerate(values):
        transformed_value = value
        if normalize_enabled and column_sums is not None:
            column_sum = column_sums[column_index] if column_index < len(column_sums) else 0.0
            if column_sum > 0:
                transformed_value = (value / column_sum) * 10000.0
        if log_transform_enabled:
            transformed_value = log2(max(transformed_value, 0.0) + 1.0)
        yield transformed_value


def iter_expression_data_rows(
    source_expression: Path,
    dialect: csv.Dialect | type[csv.Dialect],
):
    with source_expression.open("r", encoding="utf-8", newline="") as source_file:
        reader = csv.reader(source_file, dialect=dialect)
        try:
            header = next(reader)
        except StopIteration:
            return

        for index, row in enumerate(reader):
            if not row or all(str(value).strip() == "" for value in row):
                continue
            yield index, row


def preprocess_expression_matrix(
    source_expression: Path,
    destination_expression: Path,
    project_manifest: dict,
) -> None:
    dialect = detect_csv_dialect_from_file(source_expression)

    with source_expression.open("r", encoding="utf-8", newline="") as source_file:
        reader = csv.reader(source_file, dialect=dialect)
        try:
            header = next(reader)
        except StopIteration as exc:
            raise ValueError("Expression matrix file is empty.") from exc

    if len(header) < 2:
        shutil.copy2(source_expression, destination_expression)
        return

    cell_count = len(header) - 1
    top_variable_genes = parse_positive_int(project_manifest.get("top_variable_genes"))
    include_all_tfs = parse_bool(project_manifest.get("include_all_tfs"))
    normalize_enabled = parse_bool(project_manifest.get("normalize_enabled"))
    log_transform_enabled = parse_bool(project_manifest.get("log_transform_enabled"))

    tf_genes = load_known_tf_genes(project_manifest) if include_all_tfs else set()

    column_sums: list[float] | None = None
    parsed_row_count = 0
    if normalize_enabled:
        column_sums = [0.0] * cell_count
        for _index, row in iter_expression_data_rows(source_expression, dialect):
            for column_index, value in enumerate(
                parse_expression_numeric_values(row, cell_count)
            ):
                column_sums[column_index] += value
            parsed_row_count += 1
    else:
        for _index, _row in iter_expression_data_rows(source_expression, dialect):
            parsed_row_count += 1

    if parsed_row_count == 0:
        shutil.copy2(source_expression, destination_expression)
        return

    scored_rows: list[tuple[float, int, str]] = []
    for index, row in iter_expression_data_rows(source_expression, dialect):
        gene_name = str(row[0]).strip() if row else ""
        variance = compute_row_variance(
            transform_expression_values(
                parse_expression_numeric_values(row, cell_count),
                column_sums=column_sums,
                normalize_enabled=normalize_enabled,
                log_transform_enabled=log_transform_enabled,
            )
        )
        scored_rows.append((variance, index, gene_name))

    if not scored_rows:
        shutil.copy2(source_expression, destination_expression)
        return

    retained_indices: set[int]
    if top_variable_genes is None or top_variable_genes >= len(scored_rows):
        retained_indices = {index for _, index, _ in scored_rows}
    else:
        sorted_rows = sorted(scored_rows, key=lambda item: (-item[0], item[1]))
        retained_indices = {index for _, index, _ in sorted_rows[:top_variable_genes]}

    if include_all_tfs and tf_genes:
        for _, index, gene_name in scored_rows:
            if gene_name in tf_genes:
                retained_indices.add(index)

    destination_expression.parent.mkdir(parents=True, exist_ok=True)
    with destination_expression.open("w", encoding="utf-8", newline="") as output_file:
        writer = csv.writer(
            output_file,
            delimiter=getattr(dialect, "delimiter", ","),
            quotechar=getattr(dialect, "quotechar", '"'),
            lineterminator="\n",
        )
        writer.writerow(header)

        for index, row in iter_expression_data_rows(source_expression, dialect):
            if index not in retained_indices:
                continue

            gene_name = str(row[0]).strip() if row else ""
            transformed_values = transform_expression_values(
                parse_expression_numeric_values(row, cell_count),
                column_sums=column_sums,
                normalize_enabled=normalize_enabled,
                log_transform_enabled=log_transform_enabled,
            )
            writer.writerow(
                chain(
                    [gene_name],
                    (f"{value:.10f}" for value in transformed_values),
                )
            )


def read_delimited_header(
    source_path: Path,
) -> tuple[list[str], csv.Dialect | type[csv.Dialect]]:
    with source_path.open("r", encoding="utf-8", newline="") as file:
        first_line = file.readline()

    if not first_line.strip():
        raise ValueError(f"{source_path.name} is empty.")

    dialect = detect_csv_dialect(first_line)
    try:
        header = next(csv.reader(io.StringIO(first_line), dialect=dialect))
    except StopIteration as exc:
        raise ValueError(f"{source_path.name} has no header row.")

    return header, dialect


def link_or_copy_file(source_path: Path, destination_path: Path) -> None:
    destination_path.unlink(missing_ok=True)
    try:
        os.link(source_path, destination_path)
    except OSError:
        shutil.copy2(source_path, destination_path)


def write_expression_subset_by_cells(
    source_expression: Path,
    destination_expression: Path,
    selected_column_indices: list[int],
) -> None:
    with source_expression.open("r", encoding="utf-8", newline="") as source_file:
        first_line = source_file.readline()
        if not first_line.strip():
            raise ValueError(f"{source_expression.name} is empty.")
        dialect = detect_csv_dialect(first_line)
        source_file.seek(0)

        destination_expression.parent.mkdir(parents=True, exist_ok=True)
        with destination_expression.open(
            "w",
            encoding="utf-8",
            newline="",
        ) as destination_file:
            reader = csv.reader(source_file, dialect=dialect)
            writer = csv.writer(
                destination_file,
                delimiter=getattr(dialect, "delimiter", ","),
                quotechar=getattr(dialect, "quotechar", '"'),
                lineterminator="\n",
            )
            retained_indices = [0, *selected_column_indices]
            for row in reader:
                writer.writerow(
                    (
                        row[index] if index < len(row) else ""
                        for index in retained_indices
                    )
                )


def subset_pseudotime_rows_by_cells(
    source_pseudotime: Path,
    destination_pseudotime: Path,
    selected_cell_names: set[str],
) -> None:
    if not selected_cell_names:
        shutil.copy2(source_pseudotime, destination_pseudotime)
        return

    try:
        dialect = detect_csv_dialect_from_file(source_pseudotime)
    except Exception:
        shutil.copy2(source_pseudotime, destination_pseudotime)
        return

    temporary_path = destination_pseudotime.with_name(
        f".{destination_pseudotime.name}.{os.getpid()}.{threading.get_ident()}.tmp"
    )
    matched = 0
    data_rows = 0

    try:
        with source_pseudotime.open("r", encoding="utf-8", newline="") as source_file, (
            temporary_path.open("w", encoding="utf-8", newline="")
        ) as destination_file:
            reader = csv.reader(source_file, dialect=dialect)
            writer = csv.writer(
                destination_file,
                delimiter=getattr(dialect, "delimiter", ","),
                quotechar=getattr(dialect, "quotechar", '"'),
                lineterminator="\n",
            )

            try:
                header = next(reader)
            except StopIteration:
                shutil.copy2(source_pseudotime, destination_pseudotime)
                return

            writer.writerow(header)
            for row in reader:
                if not row or all(str(value).strip() == "" for value in row):
                    continue
                data_rows += 1
                if row[0] in selected_cell_names:
                    writer.writerow(row)
                    matched += 1
    except Exception:
        temporary_path.unlink(missing_ok=True)
        shutil.copy2(source_pseudotime, destination_pseudotime)
        return

    if data_rows == 0 or matched == 0:
        temporary_path.unlink(missing_ok=True)
        shutil.copy2(source_pseudotime, destination_pseudotime)
        return

    temporary_path.replace(destination_pseudotime)


def plan_confidence_run_inputs(
    *,
    dataset_id: str,
    algorithm_id: str,
    project_manifest: dict,
    preprocessed_expression: Path,
) -> tuple[list[str], dict[str, dict], dict, dict[str, list[int]], list[str]]:
    settings = resolve_confidence_settings(project_manifest)
    bootstrap_runs = int(settings["bootstrap_runs"])
    subsample_fraction = float(settings["subsample_fraction"])

    header, _expression_dialect = read_delimited_header(preprocessed_expression)
    cell_column_indices = list(range(1, len(header)))
    if not cell_column_indices:
        cell_column_indices = []

    sample_size = len(cell_column_indices)
    if bootstrap_runs > 1 and cell_column_indices:
        sample_size = max(1, int(round(len(cell_column_indices) * subsample_fraction)))

    seed_base = stable_seed_for(project_id=dataset_id, algorithm_id=algorithm_id)
    run_ids: list[str] = []
    run_metadata: dict[str, dict] = {}
    run_column_indices: dict[str, list[int]] = {}

    for run_index in range(bootstrap_runs):
        run_id = f"run-{run_index + 1}"
        run_ids.append(run_id)

        seed = seed_base + run_index
        if bootstrap_runs > 1 and cell_column_indices:
            rng = random.Random(seed)
            selected_column_indices = sorted(
                rng.sample(cell_column_indices, sample_size)
            )
        else:
            selected_column_indices = cell_column_indices

        run_column_indices[run_id] = selected_column_indices
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

    return run_ids, run_metadata, settings, run_column_indices, header


def write_run_timings(runtime_root: Path, run_metadata: dict[str, dict]) -> None:
    timing_payload = {
        run_id: {
            key: value
            for key, value in metadata.items()
            if key
            in {
                "status",
                "started_at",
                "started_at_timestamp",
                "completed_at",
                "completed_at_timestamp",
                "elapsed_seconds",
                "seed",
                "cell_count",
                "total_cell_count",
                "subsample_fraction",
            }
        }
        for run_id, metadata in run_metadata.items()
    }
    (runtime_root / RUN_TIMINGS_FILENAME).write_text(
        json.dumps(timing_payload, indent=2),
        encoding="utf-8",
    )


def completed_run_durations(run_metadata: dict[str, dict]) -> list[int]:
    durations: list[int] = []
    for metadata in run_metadata.values():
        if metadata.get("status") != "Completed":
            continue
        elapsed_seconds = parse_positive_int(metadata.get("elapsed_seconds"))
        if elapsed_seconds is not None:
            durations.append(elapsed_seconds)
    return durations


def estimate_remaining_seconds_from_run_timings(
    run_metadata: dict[str, dict],
    *,
    total_run_count: int,
    current_run_elapsed_seconds: int = 0,
) -> int | None:
    completed_durations = completed_run_durations(run_metadata)
    completed_count = len(completed_durations)
    if completed_count == 0:
        return None

    average_completed_run_seconds = fsum(completed_durations) / completed_count
    unfinished_run_count = max(0, total_run_count - completed_count)
    remaining_seconds = round(
        average_completed_run_seconds * unfinished_run_count
        - max(0, current_run_elapsed_seconds)
    )
    return max(0, int(remaining_seconds))


def materialize_confidence_run_input(
    *,
    input_dir: Path,
    dataset_id: str,
    run_id: str,
    preprocessed_expression: Path,
    header: list[str],
    selected_column_indices: list[int],
    source_pseudotime: Path | None,
) -> Path:
    run_dir = input_dir / dataset_id / run_id
    shutil.rmtree(run_dir, ignore_errors=True)
    run_dir.mkdir(parents=True, exist_ok=True)

    all_cell_column_indices = list(range(1, len(header)))
    if selected_column_indices == all_cell_column_indices:
        link_or_copy_file(preprocessed_expression, run_dir / "ExpressionData.csv")
    else:
        write_expression_subset_by_cells(
            preprocessed_expression,
            run_dir / "ExpressionData.csv",
            selected_column_indices,
        )

    if source_pseudotime and source_pseudotime.exists():
        if selected_column_indices == all_cell_column_indices:
            shutil.copy2(source_pseudotime, run_dir / "PseudoTime.csv")
        else:
            selected_cell_names = {
                header[index]
                for index in selected_column_indices
                if index < len(header) and str(header[index]).strip()
            }
            subset_pseudotime_rows_by_cells(
                source_pseudotime,
                run_dir / "PseudoTime.csv",
                selected_cell_names,
            )

    return run_dir


def create_confidence_run_inputs(
    *,
    input_dir: Path,
    dataset_id: str,
    algorithm_id: str,
    project_manifest: dict,
    preprocessed_expression: Path,
    source_pseudotime: Path | None,
) -> tuple[list[str], dict[str, dict], dict]:
    (
        run_ids,
        run_metadata,
        settings,
        run_column_indices,
        header,
    ) = plan_confidence_run_inputs(
        dataset_id=dataset_id,
        algorithm_id=algorithm_id,
        project_manifest=project_manifest,
        preprocessed_expression=preprocessed_expression,
    )

    for run_id in run_ids:
        materialize_confidence_run_input(
            input_dir=input_dir,
            dataset_id=dataset_id,
            run_id=run_id,
            preprocessed_expression=preprocessed_expression,
            header=header,
            selected_column_indices=run_column_indices[run_id],
            source_pseudotime=source_pseudotime,
        )

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
        f"{algorithm_id} stopped before creating a network result. "
        "GRNScope could not identify a specific reason from the captured output. "
        "Try running the algorithm again. If it fails again, contact support with this project."
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
        f"{algorithm_id} did not return a network result. "
        "This can happen when the algorithm stops early or cannot save its output."
    )
    if log_message:
        return f"{base_message} The most relevant log message was: {log_message}"
    return (
        f"{base_message} Try running the algorithm again. "
        "If it fails again, contact support with this project."
    )


def initialize_beeline_runtime(
    project_id: str,
    algorithm_id: str,
    project_manifest: dict,
) -> tuple[Path, Path, Path, str, Path, Path | None]:
    project_runtime_root = PROJECTS_ROOT / project_id / "_beeline_runtime" / algorithm_id
    runtime_root = space_free_runtime_root(project_runtime_root, project_id, algorithm_id)

    remove_path_if_present(project_runtime_root)
    if runtime_root != project_runtime_root:
        remove_path_if_present(runtime_root)
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

    preprocessed_expression = ensure_project_preprocessed_expression(
        project_id=project_id,
        source_expression=source_expression,
        project_manifest=project_manifest,
    )

    return (
        runtime_root,
        input_dir,
        output_dir,
        dataset_id,
        preprocessed_expression,
        source_pseudotime,
    )


def prepare_beeline_runtime(
    project_id: str,
    algorithm_id: str,
    project_manifest: dict,
) -> tuple[Path, Path, Path, str, list[str], dict[str, dict], dict]:
    (
        runtime_root,
        input_dir,
        output_dir,
        dataset_id,
        preprocessed_expression,
        source_pseudotime,
    ) = initialize_beeline_runtime(project_id, algorithm_id, project_manifest)

    run_ids, run_metadata, confidence_settings = create_confidence_run_inputs(
        input_dir=input_dir,
        dataset_id=dataset_id,
        algorithm_id=algorithm_id,
        project_manifest=project_manifest,
        preprocessed_expression=preprocessed_expression,
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


def parse_ranked_edges_csv(
    ranked_edges_path: Path,
    *,
    max_edges_per_target: int | None = None,
) -> tuple[list[dict], dict]:
    if not ranked_edges_path.exists():
        raise FileNotFoundError(f"rankedEdges.csv not found at {ranked_edges_path}")

    dialect = detect_csv_dialect_from_file(ranked_edges_path)

    with ranked_edges_path.open("r", encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file, dialect=dialect)
        fieldnames = reader.fieldnames or []

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

    if score_key is None:
        numeric_candidates = list(fieldnames)
        seen_numeric_values: set[str] = set()
        with ranked_edges_path.open("r", encoding="utf-8", newline="") as csv_file:
            reader = csv.DictReader(csv_file, dialect=dialect)
            for row in reader:
                for key in list(numeric_candidates):
                    value = row.get(key)
                    if value in (None, ""):
                        continue
                    try:
                        float(str(value).strip())
                    except (TypeError, ValueError):
                        numeric_candidates.remove(key)
                    else:
                        seen_numeric_values.add(key)

        ordered_numeric_candidates = [
            key for key in fieldnames if key in numeric_candidates and key in seen_numeric_values
        ]
        score_key = ordered_numeric_candidates[-1] if ordered_numeric_candidates else None

    if source_key is None or target_key is None:
        raise ValueError(
            f"Could not identify source/target columns in rankedEdges.csv. Found columns: {fieldnames}"
        )

    if score_key is None:
        raise ValueError(
            f"Could not identify a score column in rankedEdges.csv. Found columns: {fieldnames}"
        )

    parsed_edges: list[dict] = []
    node_names: set[str] = set()
    max_edges_per_target = (
        max(1, max_edges_per_target) if max_edges_per_target is not None else None
    )
    target_heaps: dict[str, list[tuple[float, int, str, float]]] = {}
    sequence = 0

    with ranked_edges_path.open("r", encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file, dialect=dialect)
        for row in reader:
            source = str(row.get(source_key, "")).strip()
            target = str(row.get(target_key, "")).strip()
            score_raw = str(row.get(score_key, "")).strip()

            if not source or not target:
                continue

            try:
                score = float(score_raw)
            except (TypeError, ValueError):
                continue
            if not isfinite(score):
                continue

            if max_edges_per_target is None:
                parsed_edges.append(
                    {
                        "source": source,
                        "target": target,
                        "score": score,
                    }
                )
                node_names.add(source)
                node_names.add(target)
                continue

            heap = target_heaps.setdefault(target, [])
            heap_item = (abs(score), sequence, source, score)
            sequence += 1
            if len(heap) < max_edges_per_target:
                heapq.heappush(heap, heap_item)
            elif heap_item[0] > heap[0][0]:
                heapq.heapreplace(heap, heap_item)

    if max_edges_per_target is not None:
        for target, heap in target_heaps.items():
            for _abs_score, _sequence, source, score in sorted(
                heap,
                key=lambda item: (-item[0], str(item[2])),
            ):
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
    max_edges_per_target: int | None = None,
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
            run_edges, _ = parse_ranked_edges_csv(
                ranked_edges_path,
                max_edges_per_target=max_edges_per_target,
            )
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


def estimate_remaining_seconds_from_progress(
    elapsed_seconds: int,
    progress_percent: int | float | None,
) -> int | None:
    if elapsed_seconds < 10:
        return None

    try:
        progress = float(progress_percent or 0)
    except (TypeError, ValueError):
        return None

    if progress <= 0 or progress >= 100:
        return None

    estimated_total_seconds = elapsed_seconds / (progress / 100)
    remaining_seconds = round(estimated_total_seconds - elapsed_seconds)
    return max(1, int(remaining_seconds))


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

    ranked_edges_per_target_limit = resolve_ranked_edges_per_target_limit(
        algorithm_id,
        confidence_settings,
    )
    run_edges_by_id, ranked_edge_paths = parse_confidence_run_outputs(
        output_dir,
        dataset_id,
        run_ids,
        algorithm_id,
        runtime_root=runtime_root,
        max_edges_per_target=ranked_edges_per_target_limit,
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
        preprocessed_expression,
        source_pseudotime,
    ) = initialize_beeline_runtime(
        project_id,
        algorithm_id,
        project_manifest,
    )

    (
        run_ids,
        run_metadata,
        confidence_settings,
        run_column_indices,
        header,
    ) = plan_confidence_run_inputs(
        dataset_id=dataset_id,
        algorithm_id=algorithm_id,
        project_manifest=project_manifest,
        preprocessed_expression=preprocessed_expression,
    )

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
    started_at = elapsed_started_at or time.time()
    config_path = runtime_root / "config.yaml"
    stdout_log_path = runtime_root / "stdout.log"
    stderr_log_path = runtime_root / "stderr.log"
    total_run_count = max(1, len(run_ids))

    for run_index, run_id in enumerate(run_ids, start=1):
        if stop_event is not None and stop_event.is_set():
            raise AlgorithmStoppedError("Algorithm run was stopped.")

        run_dir = materialize_confidence_run_input(
            input_dir=input_dir,
            dataset_id=dataset_id,
            run_id=run_id,
            preprocessed_expression=preprocessed_expression,
            header=header,
            selected_column_indices=run_column_indices[run_id],
            source_pseudotime=source_pseudotime,
        )

        config_text = build_beeline_config(
            input_dir=input_dir,
            output_dir=output_dir,
            dataset_id=dataset_id,
            run_ids=[run_id],
            algorithm_id=algorithm_id,
            include_pseudotime=source_pseudotime is not None,
        )
        config_path.write_text(config_text, encoding="utf-8")

        command = [python_executable, "BLRunner.py", "-c", str(config_path)]
        process: subprocess.Popen | None = None
        run_started_at_timestamp = time.time()
        run_metadata[run_id].update(
            {
                "status": "Running",
                "started_at": format_run_timestamp(run_started_at_timestamp),
                "started_at_timestamp": run_started_at_timestamp,
                "completed_at": None,
                "completed_at_timestamp": None,
                "elapsed_seconds": 0,
            }
        )
        write_run_timings(runtime_root, run_metadata)

        try:
            with stdout_log_path.open("a", encoding="utf-8") as stdout_file, (
                stderr_log_path.open("a", encoding="utf-8")
            ) as stderr_file:
                stdout_file.write(f"\n===== {run_id} =====\n")
                stderr_file.write(f"\n===== {run_id} =====\n")
                stdout_file.flush()
                stderr_file.flush()
                process = subprocess.Popen(
                    command,
                    cwd=beeline_root,
                    stdout=stdout_file,
                    stderr=stderr_file,
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
                    current_run_elapsed = int(time.time() - run_started_at_timestamp)
                    run_metadata[run_id]["elapsed_seconds"] = current_run_elapsed
                    completed_run_count = count_completed_confidence_run_outputs(
                        output_dir,
                        dataset_id,
                        run_ids,
                        algorithm_id,
                    )
                    estimated_remaining_seconds = estimate_remaining_seconds_from_run_timings(
                        run_metadata,
                        total_run_count=total_run_count,
                        current_run_elapsed_seconds=current_run_elapsed,
                    )
                    progress_percent = min(
                        85,
                        20 + round((completed_run_count / total_run_count) * 65),
                    )
                    if completed_run_count == 0:
                        progress_percent = min(25, 20 + elapsed // 10)
                    if estimated_remaining_seconds is None:
                        estimated_remaining_seconds = (
                            estimate_remaining_seconds_from_progress(
                                elapsed,
                                progress_percent,
                            )
                        )
                    progress_label = (
                        f"Running confidence run {run_index} of {total_run_count}"
                        if total_run_count > 1
                        else "Starting analysis"
                    )

                    update_job_state_fn(
                        project_dir,
                        job_id,
                        algorithm_id=algorithm_id,
                        elapsed_seconds=elapsed,
                        progress_percent=progress_percent,
                        progress_label=progress_label,
                        estimated_remaining_seconds=estimated_remaining_seconds,
                        run_metadata=run_metadata,
                    )
                    time.sleep(1)

                if process.returncode is None:
                    process.wait()

            run_completed_at_timestamp = time.time()
            run_elapsed = int(run_completed_at_timestamp - run_started_at_timestamp)
            run_status = "Completed" if process.returncode == 0 else "Failed"
            if stop_event is not None and stop_event.is_set():
                run_status = "Stopped"
            run_metadata[run_id].update(
                {
                    "status": run_status,
                    "completed_at": format_run_timestamp(run_completed_at_timestamp),
                    "completed_at_timestamp": run_completed_at_timestamp,
                    "elapsed_seconds": run_elapsed,
                }
            )
            write_run_timings(runtime_root, run_metadata)

            update_job_state_fn(
                project_dir,
                job_id,
                algorithm_id=algorithm_id,
                process_pid=0,
                run_metadata=run_metadata,
            )

            if stop_event is not None and stop_event.is_set():
                raise AlgorithmStoppedError("Algorithm run was stopped.")

            if process.returncode != 0:
                log_text = "\n".join(
                    [
                        read_recent_log_text(stderr_log_path),
                        read_recent_log_text(stdout_log_path),
                    ]
                )
                friendly_error = extract_user_friendly_beeline_error(
                    log_text,
                    algorithm_id,
                )
                raise RuntimeError(friendly_error)
        finally:
            shutil.rmtree(run_dir, ignore_errors=True)

    update_job_state_fn(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=92,
        progress_label="Aggregating confidence scores",
    )

    ranked_edges_per_target_limit = resolve_ranked_edges_per_target_limit(
        algorithm_id,
        confidence_settings,
    )
    run_edges_by_id, ranked_edge_paths = parse_confidence_run_outputs(
        output_dir,
        dataset_id,
        run_ids,
        algorithm_id,
        runtime_root=runtime_root,
        max_edges_per_target=ranked_edges_per_target_limit,
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
