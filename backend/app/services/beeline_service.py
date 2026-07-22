from __future__ import annotations

import csv
import gzip
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
from statistics import median

from ..algorithm_registry import get_algorithm_by_id
from ..config import BEELINE_ROOT_CANDIDATES, PROJECTS_ROOT
from ..repositories.project_repository import read_project_manifest


# Confidence bootstrap run bounds. Applied uniformly to every dataset size:
# never stop before MIN runs (protects the resolution of the stability
# fraction that the website's confidence filter uses), never exceed MAX runs.
DEFAULT_CONFIDENCE_MIN_RUNS = 3
DEFAULT_CONFIDENCE_MAX_RUNS = 15
DEFAULT_CONFIDENCE_BOOTSTRAP_RUNS = DEFAULT_CONFIDENCE_MAX_RUNS
DEFAULT_CONFIDENCE_SUBSAMPLE_FRACTION = 0.8
DEFAULT_CONFIDENCE_STABILITY_TOP_K = 10
# Spearman-based early stopping: stop once the aggregate edge ordering has
# stabilised. rho >= STOP_RHO for STREAK consecutive runs (after MIN runs)
# ends the loop early. Replaces the former R `coin` hypothesis test.
DEFAULT_CONFIDENCE_STOP_RHO = 0.95
DEFAULT_CONFIDENCE_STOP_STREAK = 2
DEFAULT_RANKED_EDGES_PER_TARGET_LIMIT = 20
SINGE_MAX_CONSECUTIVE_EMPTY_RUNS = 3
DEFAULT_MAX_PREPROCESSED_GENES = 8000
DEFAULT_SPACE_FREE_LINK_ROOT = Path.home() / ".grnscope" / "beeline_links"
DEFAULT_SPACE_FREE_RUNTIME_ROOT = Path.home() / ".grnscope" / "beeline_runtime"
BEELINE_MIRROR_ENTRIES = ("BLRunner.py", "BLRun", "Algorithms", "utils")
_BEELINE_MIRROR_LOCK = threading.Lock()
PROJECT_PREPROCESSED_DIRNAME = "preprocessed"
PROJECT_PREPROCESSED_EXPRESSION_FILENAME = "ExpressionData.csv"
PROJECT_PREPROCESSED_MANIFEST_FILENAME = "manifest.json"
PROJECT_PREPROCESSED_LOCK_DIRNAME = ".preprocessing.lock"
RUN_TIMINGS_FILENAME = "run_timings.json"
RUNNER_PHASE_TIMINGS_FILENAME = "phase_timings.json"
SELECTED_CELLS_FILENAME = "selected_cells.json"
CSV_SNIFF_SAMPLE_BYTES = 65536
MISSING_MATRIX_VALUE_TOKENS = {"", "NA", "N/A", "NaN", "nan", "null", "NULL"}


class AlgorithmStoppedError(RuntimeError):
    pass


class MatrixValidationRuntimeError(ValueError):
    pass


class EmptyRankedEdgesError(ValueError):
    pass


class EmptyConfidenceRunError(RuntimeError):
    def __init__(self, algorithm_id: str, run_id: str, ranked_edges_path: Path):
        self.algorithm_id = algorithm_id.upper()
        self.run_id = run_id
        self.ranked_edges_path = ranked_edges_path
        super().__init__(
            f"{self.algorithm_id} produced no valid edges for {self.run_id}."
        )


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


def docker_cli_available() -> bool:
    return shutil.which("docker") is not None


def inspect_running_docker_containers() -> list[dict]:
    if not docker_cli_available():
        return []

    try:
        container_ids = subprocess.run(
            ["docker", "ps", "-q"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.split()
    except Exception:
        return []

    if not container_ids:
        return []

    try:
        inspected = subprocess.run(
            ["docker", "inspect", *container_ids],
            check=False,
            capture_output=True,
            text=True,
            timeout=8,
        )
    except Exception:
        return []

    if inspected.returncode != 0 or not inspected.stdout.strip():
        return []

    try:
        payload = json.loads(inspected.stdout)
    except json.JSONDecodeError:
        return []

    return payload if isinstance(payload, list) else []


def container_mount_matches(container: dict, marker_paths: set[str]) -> bool:
    mounts = container.get("Mounts")
    if not isinstance(mounts, list):
        return False

    for mount in mounts:
        if not isinstance(mount, dict):
            continue
        source = str(mount.get("Source") or "")
        destination = str(mount.get("Destination") or "")
        for marker_path in marker_paths:
            if (
                source == marker_path
                or source.startswith(f"{marker_path}/")
                or destination == marker_path
                or destination.startswith(f"{marker_path}/")
            ):
                return True

    return False


def stop_docker_containers(container_ids: list[str]) -> None:
    if not container_ids:
        return

    try:
        subprocess.run(
            ["docker", "stop", "-t", "2", *container_ids],
            check=False,
            capture_output=True,
            text=True,
            timeout=8,
        )
    except Exception:
        pass

    still_running_ids: list[str] = []
    for container_id in container_ids:
        try:
            still_running = subprocess.run(
                ["docker", "ps", "-q", "--filter", f"id={container_id}"],
                check=False,
                capture_output=True,
                text=True,
                timeout=5,
            )
        except Exception:
            still_running_ids.append(container_id)
            continue
        if still_running.stdout.strip():
            still_running_ids.append(container_id)

    if not still_running_ids:
        return

    try:
        subprocess.run(
            ["docker", "kill", *still_running_ids],
            check=False,
            capture_output=True,
            text=True,
            timeout=8,
        )
    except Exception:
        pass


def runtime_marker_paths(runtime_root: Path) -> set[str]:
    markers = {str(runtime_root)}
    try:
        markers.add(str(runtime_root.resolve()))
    except OSError:
        pass

    return {marker.rstrip("/") for marker in markers if marker}


def terminate_runtime_docker_containers(runtime_root: Path) -> None:
    marker_paths = runtime_marker_paths(runtime_root)
    matching_container_ids: list[str] = []

    for container in inspect_running_docker_containers():
        container_id = str(container.get("Id") or "")
        if not container_id:
            continue
        if container_mount_matches(container, marker_paths):
            matching_container_ids.append(container_id)

    stop_docker_containers(matching_container_ids)


def terminate_algorithm_docker_containers(project_id: str, algorithm_id: str) -> None:
    runtime_parent = PROJECTS_ROOT / project_id / "_beeline_runtime"
    runtime_segments: list[str] = []
    if runtime_parent.exists():
        runtime_segments = [
            child.name
            for child in runtime_parent.iterdir()
            if child.name == algorithm_id or child.name.startswith(f"{algorithm_id}__")
        ]

    if not runtime_segments:
        runtime_segments = [algorithm_id]

    for runtime_segment in runtime_segments:
        project_runtime_root = runtime_parent / runtime_segment
        terminate_runtime_docker_containers(project_runtime_root)
        space_free_root = space_free_runtime_root(
            project_runtime_root,
            project_id,
            runtime_segment,
        )
        if space_free_root != project_runtime_root:
            terminate_runtime_docker_containers(space_free_root)


def find_algorithm_runtime_roots(project_id: str, algorithm_id: str) -> list[Path]:
    """Return every transient runtime directory owned by one algorithm.

    Cluster-aware runs append ``__<scope>`` to the algorithm name. Local
    workspaces whose paths contain spaces may also use the space-free runtime
    mirror, so both locations must be considered when archiving or cleaning up.
    """

    normalized_algorithm_id = algorithm_id.upper()
    project_runtime_parent = PROJECTS_ROOT / project_id / "_beeline_runtime"
    candidate_parents = [project_runtime_parent]

    mirrored_algorithm_root = space_free_runtime_root(
        project_runtime_parent / normalized_algorithm_id,
        project_id,
        normalized_algorithm_id,
    )
    if mirrored_algorithm_root.parent != project_runtime_parent:
        candidate_parents.append(mirrored_algorithm_root.parent)

    runtime_roots: list[Path] = []
    seen: set[str] = set()
    for parent in candidate_parents:
        if not parent.exists():
            continue
        for child in parent.iterdir():
            child_name = child.name.upper()
            if child_name != normalized_algorithm_id and not child_name.startswith(
                f"{normalized_algorithm_id}__"
            ):
                continue
            if not child.is_dir():
                continue
            marker = str(child.resolve())
            if marker in seen:
                continue
            seen.add(marker)
            runtime_roots.append(child)

    return sorted(runtime_roots, key=lambda path: path.name)


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


def parse_probability(value: object) -> float | None:
    parsed = parse_positive_float(value)
    if parsed is None or parsed >= 1:
        return None
    return parsed


def parse_stop_rho(value: object) -> float | None:
    parsed = parse_positive_float(value)
    if parsed is None or parsed > 1:
        return None
    return parsed


def read_configured_positive_int(name: str) -> int | None:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return None
    return parse_positive_int(raw_value)


def resolve_system_memory_mb() -> int | None:
    try:
        page_count = int(os.sysconf("SC_PHYS_PAGES"))
        page_size = int(os.sysconf("SC_PAGE_SIZE"))
    except (AttributeError, OSError, TypeError, ValueError):
        return None
    total_bytes = page_count * page_size
    return max(1, total_bytes // (1024 * 1024)) if total_bytes > 0 else None


def resolve_algorithm_resource_settings() -> dict:
    cpu_count = (
        read_configured_positive_int("GRNSCOPE_TOTAL_CPU_CORES")
        or max(1, os.cpu_count() or 1)
    )
    configured_concurrency = [
        value
        for value in (
            read_configured_positive_int("GRNSCOPE_MAX_CONCURRENT_ALGORITHMS"),
            read_configured_positive_int("GRNSCOPE_WORKER_COUNT"),
        )
        if value is not None
    ]
    # Keep the fallback aligned with both the local task semaphore and the RQ
    # worker-count defaults. Explicit service values take precedence.
    effective_concurrency = max(configured_concurrency, default=2)
    cpu_budget = (
        read_configured_positive_int("GRNSCOPE_ALGORITHM_CPU_BUDGET")
        or max(1, cpu_count // effective_concurrency)
    )

    total_memory_mb = resolve_system_memory_mb()
    configured_memory_mb = read_configured_positive_int(
        "GRNSCOPE_ALGORITHM_MEMORY_MB"
    )
    memory_budget_mb = configured_memory_mb
    if memory_budget_mb is None and total_memory_mb is not None:
        reserved_memory_mb = max(1024, round(total_memory_mb * 0.1))
        usable_memory_mb = max(512, total_memory_mb - reserved_memory_mb)
        memory_budget_mb = max(512, usable_memory_mb // effective_concurrency)

    return {
        "host_cpu_count": cpu_count,
        "host_memory_mb": total_memory_mb,
        "effective_concurrency": effective_concurrency,
        "cpu_budget": cpu_budget,
        "memory_budget_mb": memory_budget_mb,
        "trajectory_workers": max(1, cpu_budget),
    }


def format_run_timestamp(timestamp: float | None = None) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(timestamp or time.time()))


def resolve_adaptive_max_regulators_per_target(gene_count: int | None) -> int:
    return DEFAULT_RANKED_EDGES_PER_TARGET_LIMIT


def resolve_adaptive_confidence_bootstrap_runs(gene_count: int | None) -> int:
    # Uniform maximum for every dataset size. Early stopping (Spearman) decides
    # when to finish sooner; this is only the ceiling.
    return DEFAULT_CONFIDENCE_MAX_RUNS


def resolve_confidence_min_runs() -> int:
    # Confidence-run bounds are fixed in code (min 3, max 15); no env override.
    return DEFAULT_CONFIDENCE_MIN_RUNS


def resolve_max_preprocessed_genes() -> int:
    return (
        parse_positive_int(os.environ.get("GRNSCOPE_MAX_PREPROCESSED_GENES"))
        or DEFAULT_MAX_PREPROCESSED_GENES
    )


def count_expression_gene_rows(expression_path: Path) -> int:
    dialect = detect_csv_dialect_from_file(expression_path)
    row_count = 0
    for _index, _row in iter_expression_data_rows(expression_path, dialect):
        row_count += 1
    return row_count


def resolve_confidence_settings(
    project_manifest: dict,
    *,
    gene_count: int | None = None,
) -> dict:
    # Confidence bootstrapping is part of every inference run. Activation is not
    # configurable, so a missing/legacy manifest flag or environment variable
    # cannot accidentally reduce an analysis to a single run.
    # Max/ceiling run count is fixed in code (DEFAULT_CONFIDENCE_MAX_RUNS = 15
    # via resolve_adaptive_confidence_bootstrap_runs); no env override.
    configured_run_count = parse_positive_int(
        project_manifest.get("confidence_bootstrap_runs")
    )
    run_count = (
        configured_run_count
        if configured_run_count is not None
        else resolve_adaptive_confidence_bootstrap_runs(gene_count)
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
    # Spearman early stopping is on by default whenever confidence runs are
    # enabled. It can be explicitly disabled to force the full run_count.
    early_stopping_enabled = not (
        parse_bool(project_manifest.get("disable_confidence_early_stopping"))
        or parse_bool(os.environ.get("GRNSCOPE_DISABLE_CONFIDENCE_EARLY_STOPPING"))
    )
    min_runs = (
        parse_positive_int(project_manifest.get("confidence_min_runs"))
        or resolve_confidence_min_runs()
    )
    stop_rho = (
        parse_stop_rho(project_manifest.get("confidence_stop_rho"))
        or parse_stop_rho(os.environ.get("GRNSCOPE_CONFIDENCE_STOP_RHO"))
        or DEFAULT_CONFIDENCE_STOP_RHO
    )
    stop_streak = (
        parse_positive_int(project_manifest.get("confidence_stop_streak"))
        or parse_positive_int(os.environ.get("GRNSCOPE_CONFIDENCE_STOP_STREAK"))
        or DEFAULT_CONFIDENCE_STOP_STREAK
    )

    # Clamp the run ceiling to [min_runs, MAX] so an early-stop floor can never
    # exceed the ceiling.
    bounded_min_runs = max(1, min(min_runs, DEFAULT_CONFIDENCE_MAX_RUNS))
    bounded_run_count = max(
        bounded_min_runs,
        min(max(1, run_count), DEFAULT_CONFIDENCE_MAX_RUNS),
    )

    return {
        "confidence_enabled": True,
        "bootstrap_runs": bounded_run_count,
        "subsample_fraction": min(max(subsample_fraction, 0.01), 1.0),
        "stability_top_k": max(1, stability_top_k),
        "early_stopping_enabled": early_stopping_enabled,
        "min_runs": bounded_min_runs,
        "stop_rho": stop_rho,
        "stop_streak": max(1, stop_streak),
        "gene_count": gene_count,
        # Project-level cap on edges kept per target (the "Max edges per target"
        # setting). None -> fall back to env / the default of 20.
        "ranked_edges_per_target_limit": parse_positive_int(
            project_manifest.get("ranked_edges_per_target_limit")
        ),
    }


def resolve_ranked_edges_per_target_limit(
    algorithm_id: str,
    confidence_settings: dict | None = None,
    *,
    gene_count: int | None = None,
) -> int | None:
    normalized_algorithm_id = algorithm_id.upper()
    # Priority: project setting (manifest) > per-algorithm env > global env > default.
    manifest_limit = (
        parse_positive_int(confidence_settings.get("ranked_edges_per_target_limit"))
        if confidence_settings
        else None
    )
    configured_limit = (
        manifest_limit
        or parse_positive_int(
            os.environ.get(f"GRNSCOPE_{normalized_algorithm_id}_MAX_EDGES_PER_TARGET")
        )
        or parse_positive_int(os.environ.get("GRNSCOPE_RANKED_EDGES_PER_TARGET_LIMIT"))
    )
    resolved_gene_count = gene_count
    if resolved_gene_count is None and confidence_settings:
        resolved_gene_count = parse_positive_int(confidence_settings.get("gene_count"))
    limit = (
        configured_limit
        if configured_limit is not None
        else resolve_adaptive_max_regulators_per_target(resolved_gene_count)
    )
    if resolved_gene_count is not None and resolved_gene_count > 0:
        return min(limit, resolved_gene_count)
    return limit


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
        "max_preprocessed_genes": resolve_max_preprocessed_genes(),
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


def all_genes_requested(value: object) -> bool:
    return str(value or "").strip().lower() in {"all", "all genes", "all_genes"}


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


def preview_matrix_identifier(value: object, fallback: str) -> str:
    text = str(value).strip()
    if not text:
        return fallback
    if len(text) <= 80:
        return text
    return f"{text[:77]}..."


def validate_preprocessing_header(header: list[str]) -> list[str]:
    if len(header) < 2:
        raise MatrixValidationRuntimeError(
            "Expression matrix must contain a first column of gene names and at least one cell column."
        )

    cell_names = [str(column).strip() for column in header[1:]]
    blank_columns = [
        str(column_index)
        for column_index, cell_name in enumerate(cell_names, start=2)
        if cell_name == ""
    ]
    if blank_columns:
        preview = ", ".join(blank_columns[:5])
        suffix = "..." if len(blank_columns) > 5 else ""
        raise MatrixValidationRuntimeError(
            f"Header row contains blank cell identifiers at column {preview}{suffix}."
        )

    seen_cell_names: set[str] = set()
    for column_index, cell_name in enumerate(cell_names, start=2):
        if cell_name in seen_cell_names:
            raise MatrixValidationRuntimeError(
                f"Cell identifier '{preview_matrix_identifier(cell_name, 'unnamed cell')}' "
                f"is duplicated in the header at column {column_index}."
            )
        seen_cell_names.add(cell_name)

    return cell_names


def validate_preprocessing_gene_name(row: list[str], row_number: int) -> str:
    gene_name = str(row[0]).strip() if row else ""
    if gene_name == "":
        raise MatrixValidationRuntimeError(
            f"First column contains a blank gene name at row {row_number}."
        )
    return gene_name


def parse_expression_numeric_values(
    row: list[str],
    cell_count: int,
    *,
    row_number: int,
    gene_name: str,
    cell_names: list[str],
) -> Iterator[float]:
    expected_column_count = cell_count + 1
    if len(row) != expected_column_count:
        raise MatrixValidationRuntimeError(
            f"Expression matrix row {row_number} has {len(row)} columns; "
            f"expected {expected_column_count} from the header."
        )

    for column_index in range(cell_count):
        raw_value = row[column_index + 1]
        raw_text = str(raw_value).strip()
        cell_name = preview_matrix_identifier(
            cell_names[column_index] if column_index < len(cell_names) else "",
            f"column {column_index + 2}",
        )
        gene_label = preview_matrix_identifier(gene_name, "unnamed gene")
        error_location = (
            f"row {row_number}, gene '{gene_label}', cell '{cell_name}' "
            f"(column {column_index + 2})"
        )

        if raw_text in MISSING_MATRIX_VALUE_TOKENS:
            raise MatrixValidationRuntimeError(
                f"Expression matrix has a missing value at {error_location}."
            )

        try:
            value = float(raw_text)
        except (TypeError, ValueError) as exc:
            raise MatrixValidationRuntimeError(
                f"Expression matrix has a non-numeric value at {error_location}: "
                f"'{preview_matrix_identifier(raw_value, 'blank')}'."
            ) from exc

        if not isfinite(value):
            raise MatrixValidationRuntimeError(
                f"Expression matrix has a non-finite value at {error_location}: "
                f"'{preview_matrix_identifier(raw_value, 'blank')}'."
            )
        yield value


def collect_expression_matrix_issues(
    source_expression: Path,
    *,
    max_examples_per_issue: int = 5,
    report_path: Path | None = None,
) -> list[dict]:
    """Collect grouped matrix problems without stopping at the first error."""

    issues_by_code: dict[str, dict] = {}
    report_file = None
    report_writer = None

    if report_path is not None:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_file = report_path.open("w", encoding="utf-8", newline="")
        report_writer = csv.writer(report_file)
        report_writer.writerow(
            [
                "Severity",
                "Issue type",
                "Row",
                "Column",
                "Current value",
                "Required correction",
                "Location",
            ]
        )

    def close_report() -> None:
        nonlocal report_file
        if report_file is not None:
            report_file.close()
            report_file = None

    def add_issue(
        code: str,
        title: str,
        message: str,
        location: dict | None = None,
    ) -> None:
        issue = issues_by_code.setdefault(
            code,
            {
                "code": code,
                "severity": "error",
                "title": title,
                "message": message,
                "count": 0,
                "locations": [],
            },
        )
        issue["count"] += 1
        if location is not None and len(issue["locations"]) < max_examples_per_issue:
            issue["locations"].append(location)
        if report_writer is not None:
            report_writer.writerow(
                [
                    "error",
                    title,
                    location.get("row", "") if location else "",
                    location.get("column", "") if location else "",
                    location.get("value", "") if location else "",
                    message,
                    location.get("label", "") if location else "",
                ]
            )

    try:
        dialect = detect_csv_dialect_from_file(source_expression)
        with source_expression.open("r", encoding="utf-8", newline="") as source_file:
            reader = csv.reader(source_file, dialect=dialect)
            try:
                header = next(reader)
            except StopIteration:
                add_issue(
                    "empty_matrix",
                    "Empty matrix",
                    "Expression matrix file is empty.",
                )
                close_report()
                return list(issues_by_code.values())

            if len(header) < 2:
                add_issue(
                    "missing_cell_columns",
                    "Cell columns are missing",
                    "The header must contain a gene-name column and at least one cell column.",
                    {"row": 1, "label": "Header row"},
                )
                close_report()
                return list(issues_by_code.values())

            cell_names = [str(column).strip() for column in header[1:]]
            expected_column_count = len(header)
            first_cell_columns: dict[str, int] = {}

            for column_index, cell_name in enumerate(cell_names, start=2):
                if cell_name == "":
                    add_issue(
                        "blank_cell_identifier",
                        "Blank cell identifiers",
                        "Add a unique cell identifier to every blank header column.",
                        {
                            "row": 1,
                            "column": column_index,
                            "label": f"Header row · Column {column_index}",
                        },
                    )
                    continue

                first_column = first_cell_columns.get(cell_name)
                if first_column is not None:
                    add_issue(
                        "duplicate_cell_identifier",
                        "Duplicate cell identifiers",
                        "Rename duplicated cell identifiers so every header is unique.",
                        {
                            "row": 1,
                            "column": column_index,
                            "value": preview_matrix_identifier(cell_name, "unnamed cell"),
                            "label": (
                                f"Header row · Columns {first_column} and {column_index}"
                            ),
                        },
                    )
                else:
                    first_cell_columns[cell_name] = column_index

            seen_gene_rows: dict[str, int] = {}
            for row_number, row in enumerate(reader, start=2):
                if not row or all(str(value).strip() == "" for value in row):
                    continue

                gene_name = str(row[0]).strip() if row else ""
                if gene_name == "":
                    add_issue(
                        "blank_gene_name",
                        "Blank gene names",
                        "Add a gene name to the first column of every affected row.",
                        {
                            "row": row_number,
                            "column": 1,
                            "label": f"Row {row_number} · Column 1",
                        },
                    )
                else:
                    first_row = seen_gene_rows.get(gene_name)
                    if first_row is not None:
                        add_issue(
                            "duplicate_gene_name",
                            "Duplicate gene names",
                            "Rename or remove duplicated genes so every gene name is unique.",
                            {
                                "row": row_number,
                                "column": 1,
                                "value": preview_matrix_identifier(gene_name, "unnamed gene"),
                                "label": f"Rows {first_row} and {row_number} · Column 1",
                            },
                        )
                    else:
                        seen_gene_rows[gene_name] = row_number

                if len(row) != expected_column_count:
                    add_issue(
                        "inconsistent_row_length",
                        "Inconsistent row lengths",
                        f"Add or remove values so every affected row contains {expected_column_count} columns.",
                        {
                            "row": row_number,
                            "value": str(len(row)),
                            "label": (
                                f"Row {row_number} · Expected {expected_column_count}, "
                                f"found {len(row)} columns"
                            ),
                        },
                    )

                numeric_value_count = min(len(cell_names), max(0, len(row) - 1))
                for value_index in range(numeric_value_count):
                    column_index = value_index + 2
                    raw_value = row[value_index + 1]
                    raw_text = str(raw_value).strip()
                    cell_name = cell_names[value_index]
                    location = {
                        "row": row_number,
                        "column": column_index,
                        "gene": preview_matrix_identifier(gene_name, "unnamed gene"),
                        "cell": preview_matrix_identifier(
                            cell_name,
                            f"column {column_index}",
                        ),
                        "value": preview_matrix_identifier(raw_value, "blank"),
                        "label": f"Row {row_number} · Column {column_index}",
                    }

                    if raw_text in MISSING_MATRIX_VALUE_TOKENS:
                        add_issue(
                            "missing_expression_value",
                            "Missing expression values",
                            "Replace every blank or missing expression value with a valid number.",
                            location,
                        )
                        continue

                    try:
                        numeric_value = float(raw_text)
                    except (TypeError, ValueError):
                        add_issue(
                            "non_numeric_expression_value",
                            "Non-numeric expression values",
                            "Replace every non-numeric expression value with a valid number.",
                            location,
                        )
                        continue

                    if not isfinite(numeric_value):
                        add_issue(
                            "non_finite_expression_value",
                            "Non-finite expression values",
                            "Replace every infinite value with a finite number.",
                            location,
                        )
    except csv.Error as exc:
        add_issue(
            "invalid_csv",
            "CSV parsing failed",
            f"Expression matrix could not be parsed as CSV: {exc}.",
        )
    except MatrixValidationRuntimeError as exc:
        add_issue("matrix_validation", "Matrix validation failed", str(exc))
    except (OSError, UnicodeError, ValueError) as exc:
        add_issue(
            "unreadable_matrix",
            "Matrix could not be read",
            str(exc),
        )

    close_report()

    return list(issues_by_code.values())


def summarize_expression_matrix_issues(issues: list[dict]) -> str:
    if not issues:
        return "The uploaded expression matrix could not be validated."

    first_issue = issues[0]
    message = str(first_issue.get("message") or first_issue.get("title") or "Matrix validation failed.")
    locations = first_issue.get("locations")
    if isinstance(locations, list) and locations:
        label = str(locations[0].get("label") or "").strip()
        if label:
            message = f"{message.rstrip('.')} at {label.lower()}."
    if len(issues) > 1:
        return f"{len(issues)} validation issue types found. First: {message}"
    return message


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

        try:
            for index, row in enumerate(reader):
                if not row or all(str(value).strip() == "" for value in row):
                    continue
                yield index, row
        except csv.Error as exc:
            line_number = getattr(reader, "line_num", 0) or 0
            location = f" near row {line_number}" if line_number else ""
            raise MatrixValidationRuntimeError(
                f"Expression matrix could not be parsed as CSV{location}: {exc}."
            ) from exc


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
            raise MatrixValidationRuntimeError("Expression matrix file is empty.") from exc

    cell_names = validate_preprocessing_header(header)
    cell_count = len(cell_names)
    requested_all_genes = all_genes_requested(project_manifest.get("top_variable_genes"))
    requested_top_variable_genes = parse_positive_int(project_manifest.get("top_variable_genes"))
    max_preprocessed_genes = resolve_max_preprocessed_genes()
    if requested_all_genes:
        top_variable_genes = None
    elif requested_top_variable_genes is not None:
        top_variable_genes = min(requested_top_variable_genes, max_preprocessed_genes)
    else:
        top_variable_genes = max_preprocessed_genes
    include_all_tfs = parse_bool(project_manifest.get("include_all_tfs"))
    normalize_enabled = parse_bool(project_manifest.get("normalize_enabled"))
    log_transform_enabled = parse_bool(project_manifest.get("log_transform_enabled"))

    tf_genes = load_known_tf_genes(project_manifest) if include_all_tfs else set()

    column_sums: list[float] | None = None
    parsed_row_count = 0
    if normalize_enabled:
        column_sums = [0.0] * cell_count
        for index, row in iter_expression_data_rows(source_expression, dialect):
            row_number = index + 2
            gene_name = validate_preprocessing_gene_name(row, row_number)
            for column_index, value in enumerate(
                parse_expression_numeric_values(
                    row,
                    cell_count,
                    row_number=row_number,
                    gene_name=gene_name,
                    cell_names=cell_names,
                )
            ):
                column_sums[column_index] += value
            parsed_row_count += 1
    else:
        for _index, _row in iter_expression_data_rows(source_expression, dialect):
            parsed_row_count += 1

    if parsed_row_count == 0:
        raise MatrixValidationRuntimeError(
            "Expression matrix must include gene rows below the header."
        )

    scored_rows: list[tuple[float, int, str]] = []
    seen_gene_names: set[str] = set()
    for index, row in iter_expression_data_rows(source_expression, dialect):
        row_number = index + 2
        gene_name = validate_preprocessing_gene_name(row, row_number)
        if gene_name in seen_gene_names:
            raise MatrixValidationRuntimeError(
                f"Gene name '{preview_matrix_identifier(gene_name, 'unnamed gene')}' "
                f"is duplicated at row {row_number}."
            )
        seen_gene_names.add(gene_name)
        variance = compute_row_variance(
            transform_expression_values(
                parse_expression_numeric_values(
                    row,
                    cell_count,
                    row_number=row_number,
                    gene_name=gene_name,
                    cell_names=cell_names,
                ),
                column_sums=column_sums,
                normalize_enabled=normalize_enabled,
                log_transform_enabled=log_transform_enabled,
            )
        )
        scored_rows.append((variance, index, gene_name))

    if not scored_rows:
        shutil.copy2(source_expression, destination_expression)
        return

    sorted_rows = sorted(scored_rows, key=lambda item: (-item[0], item[1]))
    retained_indices: set[int]
    if top_variable_genes is None or top_variable_genes >= len(scored_rows):
        retained_indices = {index for _, index, _ in scored_rows}
    else:
        retained_indices = {index for _, index, _ in sorted_rows[:top_variable_genes]}

    if include_all_tfs and tf_genes:
        for _, index, gene_name in scored_rows:
            if gene_name in tf_genes:
                retained_indices.add(index)

    if not requested_all_genes and len(retained_indices) > max_preprocessed_genes:
        prioritized_rows = sorted(
            (
                (variance, index, gene_name)
                for variance, index, gene_name in scored_rows
                if index in retained_indices
            ),
            key=lambda item: (
                0 if item[2] in tf_genes else 1,
                -item[0],
                item[1],
            ),
        )
        retained_indices = {
            index for _variance, index, _gene_name in prioritized_rows[:max_preprocessed_genes]
        }

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

            row_number = index + 2
            gene_name = validate_preprocessing_gene_name(row, row_number)
            transformed_values = transform_expression_values(
                parse_expression_numeric_values(
                    row,
                    cell_count,
                    row_number=row_number,
                    gene_name=gene_name,
                    cell_names=cell_names,
                ),
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


def resolve_algorithm_gene_limit(
    algorithm_id: str,
    project_manifest: dict,
    parameter_name: str,
) -> int | None:
    normalized_algorithm_id = algorithm_id.upper()

    overrides = (project_manifest.get("algorithm_parameters") or {}).get(
        normalized_algorithm_id
    )
    if isinstance(overrides, dict) and parameter_name in overrides:
        return parse_positive_int(overrides.get(parameter_name))

    resolved = (project_manifest.get("resolved_algorithm_parameters") or {}).get(
        normalized_algorithm_id
    )
    if isinstance(resolved, dict) and parameter_name in resolved:
        return parse_positive_int(resolved.get(parameter_name))

    try:
        algorithm_info = get_algorithm_by_id(normalized_algorithm_id)
    except KeyError:
        return None
    for parameter in algorithm_info.get("parameters", []):
        if parameter.get("name") == parameter_name:
            return parse_positive_int(parameter.get("default"))
    return None


def limit_expression_genes_by_variance(
    source_expression: Path,
    destination_expression: Path,
    max_genes: int,
) -> Path:
    """Create one deterministic top-variance gene subset for an algorithm.

    This runs before confidence cells are sampled, ensuring every bootstrap run
    uses the same genes. The input is already globally preprocessed, so values
    are copied exactly and only rows are removed.
    """
    dialect = detect_csv_dialect_from_file(source_expression)
    with source_expression.open("r", encoding="utf-8", newline="") as source_file:
        reader = csv.reader(source_file, dialect=dialect)
        try:
            header = next(reader)
        except StopIteration:
            return source_expression

    cell_names = validate_preprocessing_header(header)
    cell_count = len(cell_names)
    scored_rows: list[tuple[float, int]] = []
    for index, row in iter_expression_data_rows(source_expression, dialect):
        row_number = index + 2
        gene_name = validate_preprocessing_gene_name(row, row_number)
        values = parse_expression_numeric_values(
            row,
            cell_count,
            row_number=row_number,
            gene_name=gene_name,
            cell_names=cell_names,
        )
        scored_rows.append((compute_row_variance(values), index))

    if len(scored_rows) <= max_genes:
        return source_expression

    retained_indices = {
        index
        for _variance, index in sorted(
            scored_rows,
            key=lambda item: (-item[0], item[1]),
        )[:max_genes]
    }
    destination_expression.parent.mkdir(parents=True, exist_ok=True)
    with destination_expression.open(
        "w",
        encoding="utf-8",
        newline="",
    ) as destination_file:
        writer = csv.writer(
            destination_file,
            delimiter=getattr(dialect, "delimiter", ","),
            quotechar=getattr(dialect, "quotechar", '"'),
            lineterminator="\n",
        )
        writer.writerow(header)
        for index, row in iter_expression_data_rows(source_expression, dialect):
            if index in retained_indices:
                writer.writerow(row)

    return destination_expression


def prepare_algorithm_expression_source(
    *,
    runtime_root: Path,
    algorithm_id: str,
    project_manifest: dict,
    preprocessed_expression: Path,
) -> Path:
    normalized_algorithm_id = algorithm_id.upper()
    if normalized_algorithm_id not in {
        "PIDC",
        "SINCERITIES",
        "SCRIBE",
        "SINGE",
        "GRISLI",
        "GRNVBEM",
    }:
        return preprocessed_expression

    max_genes = resolve_algorithm_gene_limit(
        normalized_algorithm_id,
        project_manifest,
        "maxGenes",
    )
    if max_genes is None:
        return preprocessed_expression

    if normalized_algorithm_id == "SINCERITIES":
        header, _dialect = read_delimited_header(preprocessed_expression)
        total_cell_count = max(0, len(header) - 1)
        gene_count = count_expression_gene_rows(preprocessed_expression)
        confidence_settings = resolve_confidence_settings(
            project_manifest,
            gene_count=gene_count,
        )
        confidence_run_count = int(confidence_settings["bootstrap_runs"])
        confidence_cell_count = total_cell_count
        if confidence_run_count > 1:
            confidence_cell_count = max(
                1,
                int(
                    round(
                        total_cell_count
                        * float(confidence_settings["subsample_fraction"])
                    )
                ),
            )
        # ppcor's all-gene partial-correlation matrix needs fewer variables
        # than observations. Keep a final runtime guard even when the user
        # chooses a larger value in the settings UI.
        max_genes = min(max_genes, max(2, confidence_cell_count - 1))

    return limit_expression_genes_by_variance(
        preprocessed_expression,
        runtime_root / "algorithm_preprocessed" / "ExpressionData.csv",
        max_genes,
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
    header, _expression_dialect = read_delimited_header(preprocessed_expression)
    gene_count = count_expression_gene_rows(preprocessed_expression)
    settings = resolve_confidence_settings(project_manifest, gene_count=gene_count)
    bootstrap_runs = int(settings["bootstrap_runs"])
    subsample_fraction = float(settings["subsample_fraction"])
    max_regulators_per_target = resolve_ranked_edges_per_target_limit(
        algorithm_id,
        settings,
        gene_count=gene_count,
    )
    settings["max_regulators_per_target"] = max_regulators_per_target
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
            "gene_count": gene_count,
            "max_regulators_per_target": max_regulators_per_target,
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
                "gene_count",
                "max_regulators_per_target",
                "cell_count",
                "total_cell_count",
                "subsample_fraction",
                "stages_seconds",
                "runner_observability",
                "resource_allocation",
                "reason",
                "error_message",
                "diagnostics_path",
            }
        }
        for run_id, metadata in run_metadata.items()
    }
    (runtime_root / RUN_TIMINGS_FILENAME).write_text(
        json.dumps(timing_payload, indent=2),
        encoding="utf-8",
    )


def load_runner_observability(
    output_dir: Path,
    dataset_id: str,
    run_id: str,
    algorithm_id: str,
) -> dict | None:
    observability_path = (
        output_dir
        / dataset_id
        / run_id
        / algorithm_id.upper()
        / "working_dir"
        / RUNNER_PHASE_TIMINGS_FILENAME
    )
    if not observability_path.is_file():
        return None

    try:
        payload = json.loads(observability_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


class PersistentBLRunnerWorker:
    """Long-lived BLRunner process used by all confidence runs in one job."""

    def __init__(
        self,
        *,
        python_executable: str,
        beeline_root: Path,
        runtime_root: Path,
        stdout_log_path: Path,
        stderr_log_path: Path,
        on_process_start=None,
    ) -> None:
        self.python_executable = python_executable
        self.beeline_root = beeline_root
        self.runtime_root = runtime_root
        self.stdout_log_path = stdout_log_path
        self.stderr_log_path = stderr_log_path
        self.on_process_start = on_process_start
        self.process: subprocess.Popen | None = None
        self.stdout_file = None
        self.stderr_file = None
        self.started_at: float | None = None
        self.started_wall_time: float | None = None
        self.ready_file = runtime_root / "blrunner-worker" / "ready.json"
        self.response_dir = runtime_root / "blrunner-worker" / "responses"

    def start(self) -> None:
        if self.process is not None:
            return

        self.ready_file.parent.mkdir(parents=True, exist_ok=True)
        self.ready_file.unlink(missing_ok=True)
        self.response_dir.mkdir(parents=True, exist_ok=True)
        self.stdout_file = self.stdout_log_path.open("a", encoding="utf-8")
        self.stderr_file = self.stderr_log_path.open("a", encoding="utf-8")
        self.started_at = time.perf_counter()
        self.started_wall_time = time.time()
        self.process = subprocess.Popen(
            [
                self.python_executable,
                "BLRunner.py",
                "--worker",
                "--ready-file",
                str(self.ready_file),
            ],
            cwd=self.beeline_root,
            stdin=subprocess.PIPE,
            stdout=self.stdout_file,
            stderr=self.stderr_file,
            text=True,
            start_new_session=True,
        )
        if self.on_process_start is not None:
            self.on_process_start(self.process)

    def submit(self, config_path: Path, run_id: str) -> Path:
        self.start()
        if self.process is None or self.process.stdin is None:
            raise RuntimeError("Persistent BLRunner worker did not start.")
        if self.process.poll() is not None:
            raise RuntimeError(
                f"Persistent BLRunner worker exited with code {self.process.returncode}."
            )

        response_path = self.response_dir / f"{run_id}.json"
        response_path.unlink(missing_ok=True)
        self.stdout_file.write(f"\n===== {run_id} =====\n")
        self.stderr_file.write(f"\n===== {run_id} =====\n")
        self.stdout_file.flush()
        self.stderr_file.flush()
        request = {
            "request_id": run_id,
            "config_path": str(config_path),
            "response_path": str(response_path),
        }
        try:
            self.process.stdin.write(json.dumps(request) + "\n")
            self.process.stdin.flush()
        except BrokenPipeError as exc:
            raise RuntimeError("Persistent BLRunner worker closed unexpectedly.") from exc
        return response_path

    def read_response(self, response_path: Path) -> dict | None:
        if not response_path.is_file():
            return None
        try:
            payload = json.loads(response_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def startup_seconds(self) -> float | None:
        if self.started_wall_time is None or not self.ready_file.is_file():
            return None
        try:
            ready_timestamp = self.ready_file.stat().st_mtime
        except OSError:
            return None
        return max(0.0, ready_timestamp - self.started_wall_time)

    def stop(self, *, force: bool = False) -> None:
        process = self.process
        if process is None:
            return

        if force and process.poll() is None:
            terminate_runtime_docker_containers(self.runtime_root)
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        elif process.stdin is not None and not process.stdin.closed:
            try:
                process.stdin.close()
            except OSError:
                pass

        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)

        if process.stdin is not None and not process.stdin.closed:
            try:
                process.stdin.close()
            except OSError:
                pass

        for handle in (self.stdout_file, self.stderr_file):
            if handle is not None and not handle.closed:
                handle.close()
        self.process = None


def completed_run_durations(run_metadata: dict[str, dict]) -> list[int]:
    durations: list[int] = []
    for metadata in run_metadata.values():
        if metadata.get("status") != "Completed":
            continue
        elapsed_seconds = parse_positive_int(metadata.get("elapsed_seconds"))
        if elapsed_seconds is not None:
            durations.append(elapsed_seconds)
    return durations


def attempted_run_durations(run_metadata: dict[str, dict]) -> list[int]:
    durations: list[int] = []
    for metadata in run_metadata.values():
        if metadata.get("status") not in {"Completed", "Empty"}:
            continue
        elapsed_seconds = parse_positive_int(metadata.get("elapsed_seconds"))
        if elapsed_seconds is not None:
            durations.append(elapsed_seconds)
    return durations


def estimate_remaining_seconds_range_from_run_timings(
    run_metadata: dict[str, dict],
    *,
    minimum_run_count: int,
    maximum_run_count: int,
    current_streak: int,
    required_streak: int,
    current_run_elapsed_seconds: int = 0,
    adaptive_stopping_enabled: bool = True,
) -> tuple[int, int] | None:
    """Estimate the earliest and latest adaptive-confidence completion times."""

    completed_durations = completed_run_durations(run_metadata)
    completed_count = len(completed_durations)
    if completed_count == 0:
        return None

    attempt_durations = attempted_run_durations(run_metadata)
    attempted_count = len(attempt_durations)
    typical_run_seconds = float(median(attempt_durations[-3:]))
    bounded_maximum_run_count = min(
        DEFAULT_CONFIDENCE_MAX_RUNS,
        max(1, int(maximum_run_count)),
    )
    latest_remaining_runs = max(
        0,
        bounded_maximum_run_count - attempted_count,
    )
    if latest_remaining_runs == 0:
        return 0, 0

    if adaptive_stopping_enabled:
        earliest_remaining_runs = max(
            1,
            int(minimum_run_count) - completed_count,
            int(required_streak) - int(current_streak),
        )
        earliest_remaining_runs = min(
            earliest_remaining_runs,
            latest_remaining_runs,
        )
    else:
        earliest_remaining_runs = latest_remaining_runs

    current_elapsed = max(0, int(current_run_elapsed_seconds))
    earliest_seconds = max(
        0,
        round(typical_run_seconds * earliest_remaining_runs - current_elapsed),
    )
    latest_seconds = max(
        earliest_seconds,
        round(typical_run_seconds * latest_remaining_runs - current_elapsed),
    )
    return int(earliest_seconds), int(latest_seconds)


def materialize_confidence_run_input(
    *,
    input_dir: Path,
    dataset_id: str,
    run_id: str,
    preprocessed_expression: Path,
    header: list[str],
    selected_column_indices: list[int],
    source_pseudotime: Path | None,
    defer_matrix_materialization: bool = False,
) -> Path:
    run_dir = input_dir / dataset_id / run_id
    shutil.rmtree(run_dir, ignore_errors=True)
    run_dir.mkdir(parents=True, exist_ok=True)

    if defer_matrix_materialization:
        selected_cell_names = [
            str(header[index])
            for index in selected_column_indices
            if index < len(header) and str(header[index]).strip()
        ]
        (run_dir / SELECTED_CELLS_FILENAME).write_text(
            json.dumps(selected_cell_names),
            encoding="utf-8",
        )
        return run_dir

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


def build_algorithm_runtime_params(
    algorithm_id: str,
    project_manifest: dict,
    *,
    scope_label: str | None = None,
) -> dict:
    normalized_algorithm_id = algorithm_id.upper()
    runtime_params = {"matrixFormat": "sparse"}

    if normalized_algorithm_id == "CELLORACLE":
        celloracle_settings = project_manifest.get("celloracle") or {}
        scope = project_manifest.get("scope") or {}
        runtime_params.update(
            {
                "species": str(celloracle_settings.get("species") or "human"),
                "baseGrn": str(celloracle_settings.get("base_grn") or "auto"),
                "clusterName": str(scope_label or scope.get("label") or "Global"),
            }
        )

    # User-selected parameter overrides, validated against the algorithm
    # registry and persisted at project creation. They take precedence over the
    # registry defaults resolved by build_beeline_config. Absent for algorithms
    # the user left at defaults, keeping existing behaviour unchanged.
    user_parameters = (project_manifest.get("algorithm_parameters") or {}).get(
        normalized_algorithm_id
    )
    if isinstance(user_parameters, dict):
        for name, value in user_parameters.items():
            runtime_params[str(name)] = value

    return runtime_params


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
    *,
    runtime_key: str | None = None,
) -> tuple[Path, Path, Path, str, Path, Path | None]:
    runtime_segment = runtime_key or algorithm_id
    project_runtime_root = PROJECTS_ROOT / project_id / "_beeline_runtime" / runtime_segment
    runtime_root = space_free_runtime_root(project_runtime_root, project_id, runtime_segment)

    remove_path_if_present(project_runtime_root)
    if runtime_root != project_runtime_root:
        remove_path_if_present(runtime_root)
    runtime_root.mkdir(parents=True, exist_ok=True)

    input_dir = runtime_root / "inputs"
    output_dir = runtime_root / "outputs"
    dataset_id = str(project_manifest.get("beeline_dataset_id") or project_id)

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
    preprocessed_expression = prepare_algorithm_expression_source(
        runtime_root=runtime_root,
        algorithm_id=algorithm_id,
        project_manifest=project_manifest,
        preprocessed_expression=preprocessed_expression,
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
    max_regulators_per_target: int | None = None,
    extra_params: dict | None = None,
    expression_source: Path | None = None,
    pseudotime_source: Path | None = None,
    selected_cells_files: dict[str, Path] | None = None,
    resource_settings: dict | None = None,
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
        if expression_source is not None:
            run_lines.append(
                f"          expressionSource: {yaml_scalar(expression_source)}"
            )
        selected_cells_file = (
            selected_cells_files.get(run_id) if selected_cells_files else None
        )
        if selected_cells_file is not None:
            run_lines.append(
                f"          selectedCellsFile: {yaml_scalar(selected_cells_file)}"
            )
        if include_pseudotime:
            run_lines.append('          pseudoTimeData: "PseudoTime.csv"')
            if pseudotime_source is not None:
                run_lines.append(
                    f"          pseudoTimeSource: {yaml_scalar(pseudotime_source)}"
                )

    params = resolve_algorithm_default_params(normalized_algorithm_id)
    if extra_params:
        for key, value in extra_params.items():
            params[str(key)] = value if isinstance(value, list) else [value]
    if max_regulators_per_target is not None:
        params["maxRegulatorsPerTarget"] = [int(max_regulators_per_target)]

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
    ]

    if resource_settings:
        config_lines.append("      resources:")
        for key, value in resource_settings.items():
            if value is not None:
                config_lines.append(f"        {key}: {json.dumps(value)}")

    config_lines.append("      params:")

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
        raise EmptyRankedEdgesError(
            "rankedEdges.csv did not contain any valid edges."
        )

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


def compute_population_sd(values: list[float]) -> float:
    if len(values) <= 1:
        return 0.0
    mean_value = fsum(values) / len(values)
    variance = fsum((value - mean_value) ** 2 for value in values) / len(values)
    return variance ** 0.5


def assign_average_weight_ranks(edges: list[dict]) -> list[dict]:
    ranked_edges = sorted(
        edges,
        key=lambda edge: (
            -abs(float(edge.get("score", 0) or 0)),
            str(edge.get("source", "")),
            str(edge.get("target", "")),
        ),
    )
    index = 0
    while index < len(ranked_edges):
        weight = abs(float(ranked_edges[index].get("score", 0) or 0))
        tie_end = index + 1
        while (
            tie_end < len(ranked_edges)
            and abs(float(ranked_edges[tie_end].get("score", 0) or 0)) == weight
        ):
            tie_end += 1

        rank = ((index + 1) + tie_end) / 2.0
        for edge in ranked_edges[index:tie_end]:
            edge["rank"] = rank
        index = tie_end

    return ranked_edges


def create_confidence_accumulator() -> dict:
    return {
        "edges": {},
        "node_names": set(),
        "processed_runs": 0,
    }


def update_confidence_accumulator(
    accumulator: dict,
    run_edges: list[dict],
    *,
    stability_top_k: int,
) -> None:
    edge_accumulator: dict[tuple[str, str], dict] = accumulator["edges"]
    all_node_names: set[str] = accumulator["node_names"]
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

        index = 0
        while index < len(ranked_edges):
            weight = abs(float(ranked_edges[index].get("score", 0) or 0))
            tie_end = index + 1
            while (
                tie_end < len(ranked_edges)
                and abs(float(ranked_edges[tie_end].get("score", 0) or 0)) == weight
            ):
                tie_end += 1

            rank = ((index + 1) + tie_end) / 2.0
            percentile = 1.0 if len(ranked_edges) <= 1 else 1 - ((rank - 1) / denominator)

            for edge in ranked_edges[index:tie_end]:
                source = str(edge.get("source", "")).strip()
                raw_score = float(edge.get("score", 0) or 0)
                z_score = 0.0 if sd_weight <= 0 else (weight - mean_weight) / sd_weight
                key = (source, target)
                current = edge_accumulator.setdefault(
                    key,
                    {
                        "source": source,
                        "target": target,
                        "raw_score_sum": 0.0,
                        "raw_score_max_abs": 0.0,
                        "z_score_sum": 0.0,
                        "percentile_sum": 0.0,
                        "rank_sum": 0.0,
                        "selected_runs": 0,
                        "observed_runs": 0,
                        "best_rank": None,
                    },
                )

                current["raw_score_sum"] += raw_score
                current["raw_score_max_abs"] = max(current["raw_score_max_abs"], weight)
                current["z_score_sum"] += z_score
                current["percentile_sum"] += percentile
                current["rank_sum"] += rank
                current["observed_runs"] += 1
                current["best_rank"] = (
                    rank
                    if current["best_rank"] is None
                    else min(current["best_rank"], rank)
                )
                if rank <= stability_top_k:
                    current["selected_runs"] += 1

            index = tie_end

    accumulator["processed_runs"] = int(accumulator.get("processed_runs", 0)) + 1


def finalize_confidence_accumulator(
    accumulator: dict,
    *,
    run_count: int,
    stability_top_k: int,
) -> tuple[list[dict], dict]:
    edge_accumulator: dict[tuple[str, str], dict] = accumulator["edges"]
    all_node_names: set[str] = accumulator["node_names"]
    run_count = max(1, run_count)

    aggregated_edges: list[dict] = []
    for current in edge_accumulator.values():
        observed_runs = int(current["observed_runs"])
        mean_percentile = float(current["percentile_sum"]) / run_count
        mean_z = float(current["z_score_sum"]) / run_count
        stability = int(current["selected_runs"]) / run_count
        confidence = max(0.0, min(1.0, stability * mean_percentile))
        mean_raw_score = (
            float(current["raw_score_sum"]) / observed_runs if observed_runs else 0.0
        )

        aggregated_edges.append(
            {
                "source": current["source"],
                "target": current["target"],
                "score": confidence,
                "confidence": confidence,
                "stability": stability,
                "mean_percentile": mean_percentile,
                "mean_z": mean_z,
                "z_ci_lower": None,
                "z_ci_upper": None,
                "mean_raw_score": mean_raw_score,
                "selected_runs": int(current["selected_runs"]),
                "observed_runs": observed_runs,
                "run_count": run_count,
                "best_rank": current["best_rank"],
                "mean_rank": (
                    float(current["rank_sum"]) / observed_runs if observed_runs else None
                ),
                "max_abs_raw_score": current["raw_score_max_abs"],
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
    index = 0
    while index < len(aggregated_edges):
        current = aggregated_edges[index]
        tie_end = index + 1
        while (
            tie_end < len(aggregated_edges)
            and float(aggregated_edges[tie_end]["confidence"]) == float(current["confidence"])
            and float(aggregated_edges[tie_end]["mean_percentile"]) == float(current["mean_percentile"])
        ):
            tie_end += 1

        rank = ((index + 1) + tie_end) / 2.0
        for edge in aggregated_edges[index:tie_end]:
            edge["rank"] = rank
        index = tie_end

    return aggregated_edges, {
        "edge_count": len(aggregated_edges),
        "node_count": len(all_node_names),
        "confidence_scored": True,
        "bootstrap_runs": run_count,
        "processed_runs": int(accumulator.get("processed_runs", 0)),
        "stability_top_k": stability_top_k,
        "aggregation_mode": "streaming",
    }


def edge_confidence_key(edge: dict) -> tuple[str, str]:
    return str(edge.get("source", "")).strip(), str(edge.get("target", "")).strip()


def edge_confidence_value(edge: dict | None) -> float:
    if not edge:
        return 0.0
    try:
        value = float(edge.get("confidence", 0.0) or 0.0)
    except (TypeError, ValueError):
        return 0.0
    return value if isfinite(value) else 0.0


def _average_ranks(values: list[float]) -> list[float]:
    """Rank values ascending, assigning tied values their average rank."""
    order = sorted(range(len(values)), key=lambda index: values[index])
    ranks = [0.0] * len(values)
    total = len(values)
    position = 0
    while position < total:
        tie_end = position
        while (
            tie_end + 1 < total
            and values[order[tie_end + 1]] == values[order[position]]
        ):
            tie_end += 1
        average_rank = (position + tie_end) / 2.0 + 1.0  # 1-based average
        for offset in range(position, tie_end + 1):
            ranks[order[offset]] = average_rank
        position = tie_end + 1
    return ranks


def spearman_rho(first: list[float], second: list[float]) -> float | None:
    """
    Spearman rank correlation, computed in pure Python (no numpy/scipy/pandas).
    Uses average ranks for ties (there are many tied 0 confidences), so it is
    the general Pearson-on-ranks form rather than the tie-free shortcut.
    Returns None when either vector has no rank variation.
    """
    if len(first) != len(second) or len(first) < 2:
        return None
    ranks_first = _average_ranks(first)
    ranks_second = _average_ranks(second)
    total = len(ranks_first)
    mean_first = fsum(ranks_first) / total
    mean_second = fsum(ranks_second) / total
    covariance = fsum(
        (ranks_first[i] - mean_first) * (ranks_second[i] - mean_second)
        for i in range(total)
    )
    variance_first = fsum((rank - mean_first) ** 2 for rank in ranks_first)
    variance_second = fsum((rank - mean_second) ** 2 for rank in ranks_second)
    if variance_first <= 0 or variance_second <= 0:
        return None
    rho = covariance / ((variance_first ** 0.5) * (variance_second ** 0.5))
    if not isfinite(rho):
        return None
    return max(-1.0, min(1.0, rho))


def write_stability_comparison_csv(
    comparison_path: Path,
    previous_edges: list[dict],
    current_edges: list[dict],
) -> tuple[list[float], list[float]]:
    """
    Align two aggregate edge->confidence snapshots on the union of their edges
    (edges absent from one side score 0) and write an audit CSV. Returns the two
    aligned confidence vectors in matching edge order.
    """
    previous_by_key: dict[tuple[str, str], dict] = {}
    for edge in previous_edges:
        key = edge_confidence_key(edge)
        if all(key):
            previous_by_key[key] = edge

    current_by_key: dict[tuple[str, str], dict] = {}
    for edge in current_edges:
        key = edge_confidence_key(edge)
        if all(key):
            current_by_key[key] = edge

    all_keys = sorted(set(previous_by_key) | set(current_by_key))

    previous_vector: list[float] = []
    current_vector: list[float] = []

    comparison_path.parent.mkdir(parents=True, exist_ok=True)
    with comparison_path.open("w", encoding="utf-8", newline="") as csv_file:
        writer = csv.DictWriter(
            csv_file,
            fieldnames=[
                "edge_id",
                "source",
                "target",
                "confidence_old",
                "confidence_new",
            ],
        )
        writer.writeheader()
        for source, target in all_keys:
            confidence_old = edge_confidence_value(previous_by_key.get((source, target)))
            confidence_new = edge_confidence_value(current_by_key.get((source, target)))
            previous_vector.append(confidence_old)
            current_vector.append(confidence_new)
            writer.writerow(
                {
                    "edge_id": f"{source}->{target}",
                    "source": source,
                    "target": target,
                    "confidence_old": confidence_old,
                    "confidence_new": confidence_new,
                }
            )

    return previous_vector, current_vector


def spearman_stability_check(
    *,
    runtime_root: Path,
    previous_edges: list[dict],
    current_edges: list[dict],
    current_run_count: int,
    stop_rho: float,
) -> dict:
    """
    Decide whether the aggregate edge ordering has stabilised between two
    consecutive confidence aggregates using the Spearman rank correlation of
    their per-edge confidence values. rho >= stop_rho => the ranking is stable.

    This replaces the former R `coin::wilcoxsign_test` early-stop check. It is
    pure Python (pandas) and only measures ordering, which is what the website's
    confidence filter consumes.
    """
    checks_dir = runtime_root / "stability_checks"
    comparison_path = checks_dir / f"run-{current_run_count}.csv"
    previous_vector, current_vector = write_stability_comparison_csv(
        comparison_path,
        previous_edges,
        current_edges,
    )
    compared_edges = len(previous_vector)
    result = {
        "method": "spearman_rank_correlation",
        "run_count": current_run_count,
        "stop_rho": stop_rho,
        "compared_edges": compared_edges,
        "comparison_path": str(comparison_path),
        "rho": None,
        "stop_early": False,
        "status": "not_run",
    }

    if compared_edges < 2:
        result["status"] = "insufficient_edges"
        result["message"] = "Need at least two paired edges for a Spearman check."
        return result

    # Identical vectors (or all-zero) are perfectly stable by definition.
    if previous_vector == current_vector:
        result["rho"] = 1.0
        result["stop_early"] = True
        result["status"] = "stable"
        return result

    rho = spearman_rho(previous_vector, current_vector)

    # Undefined when a vector has zero rank variation (e.g. every edge tied).
    if rho is None:
        result["status"] = "no_variance"
        result["message"] = "Spearman correlation undefined (no rank variation)."
        return result

    result["rho"] = rho
    result["stop_early"] = rho >= stop_rho
    result["status"] = "stable" if result["stop_early"] else "changing"
    return result


def confidence_ranked_edges_path(
    output_dir: Path,
    dataset_id: str,
    run_id: str,
    algorithm_id: str,
) -> Path:
    return output_dir / dataset_id / run_id / algorithm_id.upper() / "rankedEdges.csv"


def gzip_diagnostic_file(source: Path, destination: Path) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with source.open("rb") as source_handle, gzip.open(
        destination,
        "wb",
        compresslevel=6,
    ) as destination_handle:
        while chunk := source_handle.read(1024 * 1024):
            digest.update(chunk)
            destination_handle.write(chunk)
    return digest.hexdigest()


def archive_singe_empty_run_diagnostics(
    *,
    runtime_root: Path,
    output_dir: Path,
    dataset_id: str,
    run_id: str,
    parse_error: str,
) -> Path:
    """Preserve raw SINGE evidence for an empty, otherwise successful run."""

    algorithm_output_dir = output_dir / dataset_id / run_id / "SINGE"
    diagnostic_dir = runtime_root / "run_diagnostics" / run_id
    shutil.rmtree(diagnostic_dir, ignore_errors=True)
    diagnostic_dir.mkdir(parents=True, exist_ok=True)

    inventory: list[dict] = []
    if algorithm_output_dir.exists():
        for source in sorted(algorithm_output_dir.rglob("*")):
            if source.is_file() and not source.is_symlink():
                try:
                    size_bytes = source.stat().st_size
                except OSError:
                    continue
                inventory.append(
                    {
                        "path": str(source.relative_to(algorithm_output_dir)),
                        "size_bytes": size_bytes,
                    }
                )

    sources: set[Path] = set()
    for relative_path in (
        Path("rankedEdges.csv"),
        Path("output.txt"),
        Path("working_dir") / "phase_timings.json",
    ):
        source = algorithm_output_dir / relative_path
        if source.is_file() and not source.is_symlink():
            sources.add(source)

    working_dir = algorithm_output_dir / "working_dir"
    if working_dir.is_dir():
        for source in working_dir.glob("time*.txt"):
            if source.is_file() and not source.is_symlink():
                sources.add(source)
        # SINGE writes its raw aggregate and per-replicate intermediate files
        # below one numeric directory per pseudotime trajectory.
        for trajectory_dir in working_dir.iterdir():
            if not trajectory_dir.is_dir() or not trajectory_dir.name.isdigit():
                continue
            for source in trajectory_dir.rglob("*"):
                if source.is_file() and not source.is_symlink():
                    sources.add(source)

    archived_files: list[dict] = []
    for source in sorted(sources):
        relative_path = source.relative_to(algorithm_output_dir)
        destination = diagnostic_dir / "raw" / Path(f"{relative_path}.gz")
        try:
            sha256 = gzip_diagnostic_file(source, destination)
            archived_files.append(
                {
                    "source_path": str(relative_path),
                    "archive_path": str(destination.relative_to(diagnostic_dir)),
                    "size_bytes": source.stat().st_size,
                    "sha256": sha256,
                }
            )
        except OSError as exc:
            archived_files.append(
                {
                    "source_path": str(relative_path),
                    "archive_error": sanitize_error_message(str(exc)),
                }
            )

    manifest = {
        "algorithm_id": "SINGE",
        "run_id": run_id,
        "reason": "empty_ranked_edges",
        "parse_error": parse_error,
        "source_inventory": inventory,
        "archived_files": archived_files,
    }
    (diagnostic_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )
    return diagnostic_dir


def parse_confidence_run_output(
    output_dir: Path,
    dataset_id: str,
    run_id: str,
    algorithm_id: str,
    *,
    runtime_root: Path,
    max_edges_per_target: int | None = None,
) -> tuple[list[dict], Path]:
    ranked_edges_path = confidence_ranked_edges_path(
        output_dir,
        dataset_id,
        run_id,
        algorithm_id,
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
    except EmptyRankedEdgesError as exc:
        raise EmptyConfidenceRunError(
            algorithm_id,
            run_id,
            ranked_edges_path,
        ) from exc
    except ValueError as exc:
        raise RuntimeError(
            f"{algorithm_id} produced an edge result, but GRNScope could not read it: {sanitize_error_message(str(exc))}"
        ) from exc
    return run_edges, ranked_edges_path


def parse_single_run_raw_output(
    output_dir: Path,
    dataset_id: str,
    run_id: str,
    algorithm_id: str,
    *,
    runtime_root: Path,
    max_edges_per_target: int | None = None,
) -> tuple[list[dict], dict, Path]:
    ranked_edges_path = confidence_ranked_edges_path(
        output_dir,
        dataset_id,
        run_id,
        algorithm_id,
    )
    try:
        top_edges, network_summary = parse_ranked_edges_csv(
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

    top_edges = assign_average_weight_ranks(top_edges)
    for edge in top_edges:
        edge["mean_raw_score"] = edge["score"]

    network_summary.update(
        {
            "confidence_scored": False,
            "bootstrap_runs": 1,
            "processed_runs": 1,
            "aggregation_mode": "raw_single_run",
        }
    )
    return top_edges, network_summary, ranked_edges_path


def aggregate_confidence_run_outputs(
    output_dir: Path,
    dataset_id: str,
    run_ids: list[str],
    algorithm_id: str,
    *,
    runtime_root: Path,
    max_edges_per_target: int | None = None,
    stability_top_k: int,
) -> tuple[list[dict], dict, dict[str, str]]:
    accumulator = create_confidence_accumulator()
    ranked_edge_paths: dict[str, str] = {}

    for run_id in run_ids:
        run_edges, ranked_edges_path = parse_confidence_run_output(
            output_dir,
            dataset_id,
            run_id,
            algorithm_id,
            runtime_root=runtime_root,
            max_edges_per_target=max_edges_per_target,
        )
        update_confidence_accumulator(
            accumulator,
            run_edges,
            stability_top_k=stability_top_k,
        )
        ranked_edge_paths[run_id] = str(ranked_edges_path)
        del run_edges

    top_edges, network_summary = finalize_confidence_accumulator(
        accumulator,
        run_count=len(run_ids),
        stability_top_k=stability_top_k,
    )
    return top_edges, network_summary, ranked_edge_paths


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
    ranked_edges_per_target_limit = resolve_ranked_edges_per_target_limit(
        algorithm_id,
        confidence_settings,
    )
    algorithm_runtime_params = build_algorithm_runtime_params(
        algorithm_id,
        project_manifest,
    )
    config_text = build_beeline_config(
        input_dir=input_dir,
        output_dir=output_dir,
        dataset_id=dataset_id,
        run_ids=run_ids,
        algorithm_id=algorithm_id,
        include_pseudotime=bool(project_manifest.get("pseudotime_path")),
        max_regulators_per_target=ranked_edges_per_target_limit,
        extra_params=algorithm_runtime_params,
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

    if confidence_settings.get("confidence_enabled"):
        top_edges, network_summary, ranked_edge_paths = aggregate_confidence_run_outputs(
            output_dir,
            dataset_id,
            run_ids,
            algorithm_id,
            runtime_root=runtime_root,
            max_edges_per_target=ranked_edges_per_target_limit,
            stability_top_k=int(confidence_settings["stability_top_k"]),
        )
        ranked_edges_path = runtime_root / "rankedEdges_confidence.csv"
        write_confidence_ranked_edges_csv(ranked_edges_path, top_edges)
    else:
        top_edges, network_summary, ranked_edges_path = parse_single_run_raw_output(
            output_dir,
            dataset_id,
            run_ids[0],
            algorithm_id,
            runtime_root=runtime_root,
            max_edges_per_target=ranked_edges_per_target_limit,
        )
        ranked_edge_paths = {run_ids[0]: str(ranked_edges_path)}

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
    project_manifest_override: dict | None = None,
    runtime_key: str | None = None,
    scope_label: str | None = None,
) -> dict:
    project_dir = PROJECTS_ROOT / project_id
    project_manifest = project_manifest_override or read_project_manifest(project_dir)
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

    runtime_initialization_started = time.perf_counter()
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
        runtime_key=runtime_key,
    )
    runtime_initialization_seconds = (
        time.perf_counter() - runtime_initialization_started
    )

    confidence_planning_started = time.perf_counter()
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
    confidence_planning_seconds = time.perf_counter() - confidence_planning_started
    resource_settings = resolve_algorithm_resource_settings()
    for metadata in run_metadata.values():
        metadata["resource_allocation"] = resource_settings
    if run_ids:
        run_metadata[run_ids[0]].setdefault("stages_seconds", {}).update(
            {
                "job_runtime_initialization": round(
                    runtime_initialization_seconds,
                    6,
                ),
                "job_confidence_planning": round(
                    confidence_planning_seconds,
                    6,
                ),
            }
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
    ranked_edges_per_target_limit = resolve_ranked_edges_per_target_limit(
        algorithm_id,
        confidence_settings,
    )
    algorithm_runtime_params = build_algorithm_runtime_params(
        algorithm_id,
        project_manifest,
        scope_label=scope_label,
    )
    confidence_accumulator = create_confidence_accumulator()
    ranked_edge_paths: dict[str, str] = {}
    early_stopping = {
        "enabled": bool(confidence_settings.get("early_stopping_enabled")),
        "method": "spearman_rank_correlation",
        "stop_rho": float(confidence_settings.get("stop_rho", DEFAULT_CONFIDENCE_STOP_RHO)),
        "stop_streak": int(confidence_settings.get("stop_streak", DEFAULT_CONFIDENCE_STOP_STREAK)),
        "min_runs": int(confidence_settings.get("min_runs", DEFAULT_CONFIDENCE_MIN_RUNS)),
        "stopped_early": False,
        "streak": 0,
        "checks": [],
    }
    empty_run_summary = {
        "max_consecutive": SINGE_MAX_CONSECUTIVE_EMPTY_RUNS,
        "consecutive": 0,
        "total": 0,
        "run_ids": [],
    }
    persistent_worker = PersistentBLRunnerWorker(
        python_executable=python_executable,
        beeline_root=beeline_root,
        runtime_root=runtime_root,
        stdout_log_path=stdout_log_path,
        stderr_log_path=stderr_log_path,
        on_process_start=on_process_start,
    )

    for run_index, run_id in enumerate(run_ids, start=1):
        if stop_event is not None and stop_event.is_set():
            persistent_worker.stop(force=True)
            raise AlgorithmStoppedError("Algorithm run was stopped.")

        stage_timings = run_metadata[run_id].setdefault("stages_seconds", {})
        input_materialization_started = time.perf_counter()
        try:
            run_dir = materialize_confidence_run_input(
                input_dir=input_dir,
                dataset_id=dataset_id,
                run_id=run_id,
                preprocessed_expression=preprocessed_expression,
                header=header,
                selected_column_indices=run_column_indices[run_id],
                source_pseudotime=source_pseudotime,
                defer_matrix_materialization=True,
            )
        except Exception:
            persistent_worker.stop(force=True)
            raise
        stage_timings["input_materialization"] = round(
            time.perf_counter() - input_materialization_started,
            6,
        )

        config_generation_started = time.perf_counter()
        try:
            config_text = build_beeline_config(
                input_dir=input_dir,
                output_dir=output_dir,
                dataset_id=dataset_id,
                run_ids=[run_id],
                algorithm_id=algorithm_id,
                include_pseudotime=source_pseudotime is not None,
                max_regulators_per_target=ranked_edges_per_target_limit,
                extra_params=algorithm_runtime_params,
                expression_source=preprocessed_expression,
                pseudotime_source=source_pseudotime,
                selected_cells_files={
                    run_id: run_dir / SELECTED_CELLS_FILENAME,
                },
                resource_settings=resource_settings,
            )
            config_path.write_text(config_text, encoding="utf-8")
        except Exception:
            persistent_worker.stop(force=True)
            shutil.rmtree(run_dir, ignore_errors=True)
            raise
        stage_timings["config_generation"] = round(
            time.perf_counter() - config_generation_started,
            6,
        )

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
            blrunner_request_started = time.perf_counter()
            response_path = persistent_worker.submit(config_path, run_id)
            worker_response = persistent_worker.read_response(response_path)
            while worker_response is None:
                # Check the durable task signal before inspecting the worker.
                # The stop request may come from a different service process;
                # in that case the API has already terminated BLRunner, and an
                # exit-code check first would misclassify the stop as a failure.
                if stop_event is not None and stop_event.is_set():
                    persistent_worker.stop(force=True)
                    break

                process = persistent_worker.process
                if process is None or process.poll() is not None:
                    return_code = process.returncode if process is not None else None
                    raise RuntimeError(
                        "Persistent BLRunner worker exited before completing "
                        f"{run_id} (code {return_code})."
                    )
                elapsed = int(time.time() - started_at)
                current_run_elapsed = int(time.time() - run_started_at_timestamp)
                run_metadata[run_id]["elapsed_seconds"] = current_run_elapsed
                completed_run_count = count_completed_confidence_run_outputs(
                    output_dir,
                    dataset_id,
                    run_ids,
                    algorithm_id,
                )
                remaining_range = estimate_remaining_seconds_range_from_run_timings(
                    run_metadata,
                    minimum_run_count=int(early_stopping["min_runs"]),
                    maximum_run_count=total_run_count,
                    current_streak=int(early_stopping["streak"]),
                    required_streak=int(early_stopping["stop_streak"]),
                    current_run_elapsed_seconds=current_run_elapsed,
                    adaptive_stopping_enabled=bool(early_stopping["enabled"]),
                )
                if remaining_range is not None:
                    (
                        estimated_remaining_min_seconds,
                        estimated_remaining_max_seconds,
                    ) = remaining_range
                    # Preserve the legacy scalar as the conservative upper bound.
                    estimated_remaining_seconds = estimated_remaining_max_seconds
                else:
                    estimated_remaining_min_seconds = None
                    estimated_remaining_max_seconds = None
                    estimated_remaining_seconds = None
                progress_percent = min(
                    85,
                    20 + round((completed_run_count / total_run_count) * 65),
                )
                if completed_run_count == 0:
                    progress_percent = min(25, 20 + elapsed // 10)
                if estimated_remaining_seconds is None:
                    estimated_remaining_seconds = estimate_remaining_seconds_from_progress(
                        elapsed,
                        progress_percent,
                    )
                progress_label = "Analysis running"

                update_job_state_fn(
                    project_dir,
                    job_id,
                    algorithm_id=algorithm_id,
                    elapsed_seconds=elapsed,
                    progress_percent=progress_percent,
                    progress_label=progress_label,
                    estimated_remaining_seconds=estimated_remaining_seconds,
                    estimated_remaining_min_seconds=estimated_remaining_min_seconds,
                    estimated_remaining_max_seconds=estimated_remaining_max_seconds,
                    run_metadata=run_metadata,
                )
                time.sleep(1)
                worker_response = persistent_worker.read_response(response_path)

            stage_timings["blrunner_request"] = round(
                time.perf_counter() - blrunner_request_started,
                6,
            )
            if run_index == 1:
                startup_seconds = persistent_worker.startup_seconds()
                if startup_seconds is not None:
                    stage_timings["persistent_worker_startup"] = round(
                        startup_seconds,
                        6,
                    )

            run_completed_at_timestamp = time.time()
            run_elapsed = int(run_completed_at_timestamp - run_started_at_timestamp)
            run_status = (
                "Completed"
                if worker_response and worker_response.get("status") == "Completed"
                else "Failed"
            )
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
                run_metadata=run_metadata,
            )

            if stop_event is not None and stop_event.is_set():
                raise AlgorithmStoppedError("Algorithm run was stopped.")

            runner_observability = load_runner_observability(
                output_dir,
                dataset_id,
                run_id,
                algorithm_id,
            )
            if runner_observability is not None:
                run_metadata[run_id]["runner_observability"] = runner_observability
                runner_total = (
                    runner_observability.get("stages_seconds", {}).get(
                        "runner_observed_total"
                    )
                )
                blrunner_total = stage_timings.get("blrunner_request")
                if isinstance(runner_total, (int, float)) and isinstance(
                    blrunner_total,
                    (int, float),
                ):
                    stage_timings["blrunner_request_overhead_estimate"] = round(
                        max(0.0, blrunner_total - runner_total),
                        6,
                    )
                write_run_timings(runtime_root, run_metadata)

            if not worker_response or worker_response.get("status") != "Completed":
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
                if worker_response and worker_response.get("error_message"):
                    friendly_error = str(worker_response["error_message"])
                raise RuntimeError(friendly_error)

            output_ingestion_started = time.perf_counter()
            try:
                run_edges, ranked_edges_path = parse_confidence_run_output(
                    output_dir,
                    dataset_id,
                    run_id,
                    algorithm_id,
                    runtime_root=runtime_root,
                    max_edges_per_target=ranked_edges_per_target_limit,
                )
            except EmptyConfidenceRunError as exc:
                if algorithm_id.upper() != "SINGE":
                    raise

                ranked_edges_path = exc.ranked_edges_path
                ranked_edge_paths[run_id] = str(ranked_edges_path)
                empty_run_summary["total"] = int(empty_run_summary["total"]) + 1
                empty_run_summary["consecutive"] = (
                    int(empty_run_summary["consecutive"]) + 1
                )
                empty_run_summary["run_ids"].append(run_id)
                diagnostic_dir = archive_singe_empty_run_diagnostics(
                    runtime_root=runtime_root,
                    output_dir=output_dir,
                    dataset_id=dataset_id,
                    run_id=run_id,
                    parse_error=str(exc.__cause__ or exc),
                )
                stage_timings["output_ingestion"] = round(
                    time.perf_counter() - output_ingestion_started,
                    6,
                )
                run_metadata[run_id].update(
                    {
                        "status": "Empty",
                        "reason": "empty_ranked_edges",
                        "error_message": str(exc),
                        "diagnostics_path": str(diagnostic_dir),
                    }
                )
                write_run_timings(runtime_root, run_metadata)
                update_job_state_fn(
                    project_dir,
                    job_id,
                    algorithm_id=algorithm_id,
                    progress_label="SINGE returned an empty confidence sample; continuing",
                    run_metadata=run_metadata,
                )
                if int(empty_run_summary["consecutive"]) >= int(
                    empty_run_summary["max_consecutive"]
                ):
                    raise RuntimeError(
                        "SINGE produced no valid edges in "
                        f"{empty_run_summary['consecutive']} consecutive confidence runs. "
                        "The selected genes or SINGE parameters did not produce a usable network."
                    ) from exc
                continue

            empty_run_summary["consecutive"] = 0
            stage_timings["output_ingestion"] = round(
                time.perf_counter() - output_ingestion_started,
                6,
            )
            confidence_update_started = time.perf_counter()
            if confidence_settings.get("confidence_enabled"):
                previous_run_count = int(confidence_accumulator.get("processed_runs", 0))
                previous_edges: list[dict] = []
                # Begin comparing aggregates early enough that a full streak can
                # complete exactly at the min-runs floor, but skip the noisiest
                # first couple of aggregates.
                check_start_prev = max(
                    1, int(early_stopping["min_runs"]) - int(early_stopping["stop_streak"])
                )
                if (
                    early_stopping["enabled"]
                    and previous_run_count >= check_start_prev
                ):
                    previous_edges, _previous_summary = finalize_confidence_accumulator(
                        confidence_accumulator,
                        run_count=previous_run_count,
                        stability_top_k=int(confidence_settings["stability_top_k"]),
                    )

                update_confidence_accumulator(
                    confidence_accumulator,
                    run_edges,
                    stability_top_k=int(confidence_settings["stability_top_k"]),
                )
                current_run_count = int(confidence_accumulator.get("processed_runs", 0))
                if previous_edges:
                    current_edges, _current_summary = finalize_confidence_accumulator(
                        confidence_accumulator,
                        run_count=current_run_count,
                        stability_top_k=int(confidence_settings["stability_top_k"]),
                    )
                    stability_check = spearman_stability_check(
                        runtime_root=runtime_root,
                        previous_edges=previous_edges,
                        current_edges=current_edges,
                        current_run_count=current_run_count,
                        stop_rho=float(confidence_settings["stop_rho"]),
                    )
                    early_stopping["checks"].append(stability_check)
                    if stability_check.get("stop_early"):
                        early_stopping["streak"] = int(early_stopping["streak"]) + 1
                    else:
                        early_stopping["streak"] = 0

                    # Stop only after the ordering has been stable for the
                    # required number of consecutive checks AND the min-runs
                    # floor (protects confidence-filter resolution) is met.
                    if (
                        int(early_stopping["streak"]) >= int(early_stopping["stop_streak"])
                        and current_run_count >= int(early_stopping["min_runs"])
                    ):
                        early_stopping["stopped_early"] = True
                        early_stopping["stopped_after_runs"] = current_run_count
                        early_stopping["decision"] = stability_check
                        rho_value = stability_check.get("rho")
                        skipped_at = time.time()
                        for skipped_run_id in run_ids[run_index:]:
                            run_metadata[skipped_run_id].update(
                                {
                                    "status": "Skipped",
                                    "reason": "confidence_early_stopping",
                                    "completed_at": format_run_timestamp(skipped_at),
                                    "completed_at_timestamp": skipped_at,
                                    "elapsed_seconds": 0,
                                }
                            )
                        stage_timings["confidence_update"] = round(
                            time.perf_counter() - confidence_update_started,
                            6,
                        )
                        write_run_timings(runtime_root, run_metadata)
                        update_job_state_fn(
                            project_dir,
                            job_id,
                            algorithm_id=algorithm_id,
                            progress_label=(
                                f"Stopping early: edge ranking stable (Spearman rho {rho_value:.3f})"
                                if rho_value is not None
                                else "Stopping early: edge ranking stable"
                            ),
                            run_metadata=run_metadata,
                        )
                        ranked_edge_paths[run_id] = str(ranked_edges_path)
                        del run_edges
                        break
            stage_timings["confidence_update"] = round(
                time.perf_counter() - confidence_update_started,
                6,
            )
            ranked_edge_paths[run_id] = str(ranked_edges_path)
            del run_edges
            write_run_timings(runtime_root, run_metadata)
        finally:
            shutil.rmtree(run_dir, ignore_errors=True)
            if sys.exc_info()[0] is not None:
                persistent_worker.stop(force=True)

    persistent_worker.stop()
    update_job_state_fn(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        process_pid=0,
        run_metadata=run_metadata,
    )

    progress_label = (
        "Aggregating confidence scores"
        if confidence_settings.get("confidence_enabled")
        else "Finalizing result"
    )
    update_job_state_fn(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        progress_percent=92,
        progress_label=progress_label,
    )

    final_aggregation_started = time.perf_counter()
    if confidence_settings.get("confidence_enabled"):
        processed_run_count = int(confidence_accumulator.get("processed_runs", 0))
        if (
            algorithm_id.upper() == "SINGE"
            and processed_run_count < int(early_stopping["min_runs"])
        ):
            raise RuntimeError(
                "SINGE completed "
                f"{processed_run_count} valid confidence runs and "
                f"{empty_run_summary['total']} empty runs, but at least "
                f"{early_stopping['min_runs']} valid runs are required."
            )
        top_edges, network_summary = finalize_confidence_accumulator(
            confidence_accumulator,
            run_count=processed_run_count,
            stability_top_k=int(confidence_settings["stability_top_k"]),
        )
        ranked_edges_path = runtime_root / "rankedEdges_confidence.csv"
        write_confidence_ranked_edges_csv(ranked_edges_path, top_edges)
    else:
        top_edges, network_summary, ranked_edges_path = parse_single_run_raw_output(
            output_dir,
            dataset_id,
            run_ids[0],
            algorithm_id,
            runtime_root=runtime_root,
            max_edges_per_target=ranked_edges_per_target_limit,
        )

    final_aggregation_seconds = time.perf_counter() - final_aggregation_started
    completed_run_ids = [
        completed_run_id
        for completed_run_id in run_ids
        if run_metadata.get(completed_run_id, {}).get("status") == "Completed"
    ]
    if completed_run_ids:
        run_metadata[completed_run_ids[-1]].setdefault("stages_seconds", {})[
            "final_confidence_aggregation"
        ] = round(final_aggregation_seconds, 6)
        write_run_timings(runtime_root, run_metadata)

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
            "resource_allocation": resource_settings,
            "planned_bootstrap_runs": total_run_count,
            "bootstrap_runs": int(network_summary.get("bootstrap_runs", total_run_count)),
            "early_stopping": early_stopping,
            "empty_runs": empty_run_summary,
            "run_metadata": run_metadata,
        },
        "run_ranked_edges_paths": ranked_edge_paths,
        "run_diagnostics_root": (
            str(runtime_root / "run_diagnostics")
            if (runtime_root / "run_diagnostics").is_dir()
            else None
        ),
        "runtime_root": str(runtime_root),
        "ranked_edges_path": str(ranked_edges_path),
    }
