from __future__ import annotations

import csv
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
import uuid

from ..config import PROJECTS_ROOT
from ..repositories.job_repository import read_jobs_manifest
from ..repositories.project_repository import read_project_manifest
from .beeline_service import (
    CELLORACLE_INPUT_CONTRACT_VERSION,
    ensure_celloracle_expression_source,
    ensure_project_preprocessed_expression,
    parse_ranked_edges_csv,
    resolve_celloracle_expression_mode,
    resolve_algorithm_image,
    resolve_beeline_root,
)
from .result_service import read_algorithm_result


PERTURBATION_LOCK = threading.Lock()
ACTIVE_STATUSES = {"Queued", "Preparing", "Running"}
DOWNLOAD_FILENAMES = {
    "affected_genes.csv",
    "cell_shifts.csv",
    "cluster_effects.csv",
    "ood_diagnostics.csv",
}
CELL_SHIFT_COMPONENT_COLUMNS = (
    "shift_x",
    "shift_y",
    "random_shift_x",
    "random_shift_y",
)


def utc_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def perturbation_root(project_dir: Path) -> Path:
    root = project_dir / "perturbations"
    root.mkdir(parents=True, exist_ok=True)
    return root


def run_directory(project_dir: Path, run_id: str) -> Path:
    return perturbation_root(project_dir) / "runs" / run_id


def status_path(project_dir: Path, run_id: str) -> Path:
    return run_directory(project_dir, run_id) / "status.json"


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp-{os.getpid()}")
    temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temporary.replace(path)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def latest_celloracle_task(project_dir: Path) -> dict | None:
    jobs = read_jobs_manifest(project_dir)
    latest_job = jobs[-1] if jobs else None
    if not latest_job:
        return None
    return next(
        (
            task
            for task in latest_job.get("tasks", [])
            if str(task.get("algorithm_id", "")).upper() == "CELLORACLE"
        ),
        None,
    )


def celloracle_expression_contract_version(result: dict) -> int:
    expression_contract = result.get("expression_contract") or {}
    try:
        return int(expression_contract.get("version") or 0)
    except (TypeError, ValueError):
        return 0


def celloracle_availability(project_dir: Path) -> tuple[bool, str | None]:
    task = latest_celloracle_task(project_dir)
    if task is None:
        return False, "Perturbation requires CellOracle to be selected for this project."
    status = str(task.get("status") or "")
    if status != "Completed":
        if status in {"Queued", "Running", "Stopping"}:
            return False, "Perturbation will be available when CellOracle completes."
        return False, "Perturbation requires a successful CellOracle result."
    try:
        result = read_algorithm_result(project_dir, "CELLORACLE")
    except FileNotFoundError:
        return False, "The completed CellOracle network file could not be found."
    ranked_path = result.get("ranked_edges_path")
    if not ranked_path or not Path(str(ranked_path)).exists():
        return False, "The completed CellOracle edge list could not be found."
    if (
        celloracle_expression_contract_version(result)
        < CELLORACLE_INPUT_CONTRACT_VERSION
    ):
        return (
            False,
            "CellOracle must be rerun once before perturbation because its "
            "expression preprocessing has been corrected.",
        )
    return True, None


def celloracle_result_and_edges(project_dir: Path) -> tuple[dict, Path]:
    result = read_algorithm_result(project_dir, "CELLORACLE")
    if (
        celloracle_expression_contract_version(result)
        < CELLORACLE_INPUT_CONTRACT_VERSION
    ):
        raise RuntimeError(
            "CellOracle must be rerun with the corrected expression preprocessing."
        )
    path_value = result.get("ranked_edges_path")
    if not path_value:
        raise FileNotFoundError("CellOracle ranked edge list is missing.")
    path = Path(str(path_value))
    if not path.exists():
        raise FileNotFoundError("CellOracle ranked edge list is missing.")
    return result, path


def cluster_specific_edge_paths(result: dict) -> dict[str, Path]:
    """Return completed CellOracle cluster networks keyed by their display label."""
    paths: dict[str, Path] = {}
    scopes = result.get("scopes")
    if not isinstance(scopes, dict):
        return paths
    for scope in scopes.values():
        if not isinstance(scope, dict):
            continue
        if scope.get("scope_type") != "cluster" or scope.get("status") != "Completed":
            continue
        label = str(scope.get("scope_label") or "").strip()
        path_value = scope.get("ranked_edges_path")
        if not label or not path_value:
            continue
        path = Path(str(path_value))
        if path.is_file():
            paths[label] = path
    return paths


def eligible_perturbation_genes(project_dir: Path) -> list[str]:
    available, _reason = celloracle_availability(project_dir)
    if not available:
        return []
    result, edge_path = celloracle_result_and_edges(project_dir)
    outgoing_counts: dict[str, int] = {}
    edge_paths = [edge_path, *cluster_specific_edge_paths(result).values()]
    for current_path in dict.fromkeys(edge_paths):
        edges, _summary = parse_ranked_edges_csv(current_path)
        for edge in edges:
            source = str(edge.get("source") or "").strip()
            if source:
                outgoing_counts[source] = outgoing_counts.get(source, 0) + 1
    return sorted(outgoing_counts, key=lambda gene: (-outgoing_counts[gene], gene.lower()))


def _quantile(sorted_values: list[float], fraction: float) -> float:
    if not sorted_values:
        return 0.0
    position = (len(sorted_values) - 1) * fraction
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return sorted_values[lower]
    weight = position - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def _expression_profile_cache_path(project_dir: Path) -> Path:
    return perturbation_root(project_dir) / "model" / "expression_profiles.json"


def _celloracle_expression_limits_path(project_dir: Path) -> Path:
    return perturbation_root(project_dir) / "model" / "expression_limits.json"


def get_gene_expression_profile(project_dir: Path, gene: str) -> dict:
    """Return observed expression guidance for one regulator, cached by input signature."""
    normalized_gene = str(gene).strip()
    if normalized_gene not in set(eligible_perturbation_genes(project_dir)):
        raise ValueError("The selected gene is not a regulator in the CellOracle network.")

    manifest = read_project_manifest(project_dir)
    expression_value = manifest.get("expression_path")
    if not expression_value:
        raise FileNotFoundError("Project expression matrix is missing.")
    expression_path = Path(str(expression_value))
    if not expression_path.is_file():
        raise FileNotFoundError("Project expression matrix is missing.")

    limits_path = _celloracle_expression_limits_path(project_dir)
    signature_paths = [expression_path]
    if limits_path.is_file():
        signature_paths.append(limits_path)
    signature = file_signature(signature_paths, {"profile_version": 3})
    cache_path = _expression_profile_cache_path(project_dir)
    cached: dict = {}
    if cache_path.is_file():
        try:
            cached = read_json(cache_path)
        except (OSError, json.JSONDecodeError):
            cached = {}
    if cached.get("signature") == signature:
        profile = (cached.get("profiles") or {}).get(normalized_gene)
        if isinstance(profile, dict):
            return profile

    with expression_path.open("r", encoding="utf-8", newline="") as handle:
        sample = handle.read(65536)
        handle.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
        except csv.Error:
            dialect = csv.excel
        reader = csv.reader(handle, dialect=dialect)
        try:
            next(reader)
        except StopIteration as exc:
            raise ValueError("Expression matrix is empty.") from exc
        values: list[float] | None = None
        for row in reader:
            if not row or str(row[0]).strip() != normalized_gene:
                continue
            values = []
            for raw_value in row[1:]:
                try:
                    value = float(raw_value)
                except (TypeError, ValueError):
                    continue
                if math.isfinite(value):
                    values.append(value)
            break

    if not values:
        raise FileNotFoundError(
            f"Gene {normalized_gene} was not found in the project expression matrix."
        )
    values.sort()
    minimum = values[0]
    maximum = values[-1]
    safe_upper_limit = maximum + (maximum - minimum)
    limit_source = "observed_expression"
    if limits_path.is_file():
        try:
            model_limits = read_json(limits_path)
            gene_limits = (model_limits.get("genes") or {}).get(normalized_gene)
            if isinstance(gene_limits, dict):
                model_limit = float(gene_limits.get("safe_upper_limit"))
                if math.isfinite(model_limit) and model_limit >= 0:
                    safe_upper_limit = model_limit
                    limit_source = str(
                        model_limits.get("source") or "celloracle_imputed_count"
                    )
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
    bin_count = 12
    if maximum == minimum:
        histogram = [{"start": minimum, "end": maximum, "count": len(values)}]
    else:
        width = (maximum - minimum) / bin_count
        counts = [0] * bin_count
        for value in values:
            index = min(bin_count - 1, int((value - minimum) / width))
            counts[index] += 1
        histogram = [
            {
                "start": minimum + index * width,
                "end": minimum + (index + 1) * width,
                "count": count,
            }
            for index, count in enumerate(counts)
        ]
    profile = {
        "gene": normalized_gene,
        "minimum": minimum,
        "q1": _quantile(values, 0.25),
        "median": _quantile(values, 0.5),
        "q3": _quantile(values, 0.75),
        "maximum": maximum,
        "mean": sum(values) / len(values),
        "nonzero_fraction": sum(value > 0 for value in values) / len(values),
        "cell_count": len(values),
        "safe_upper_limit": safe_upper_limit,
        "limit_source": limit_source,
        "histogram": histogram,
    }
    profiles = cached.get("profiles") if cached.get("signature") == signature else {}
    if not isinstance(profiles, dict):
        profiles = {}
    profiles[normalized_gene] = profile
    write_json_atomic(
        cache_path,
        {"signature": signature, "profiles": profiles, "updated_at": utc_now()},
    )
    return profile


def list_run_statuses(project_dir: Path) -> list[dict]:
    runs_root = perturbation_root(project_dir) / "runs"
    if not runs_root.exists():
        return []
    rows: list[dict] = []
    for path in runs_root.glob("*/status.json"):
        try:
            rows.append(read_json(path))
        except (OSError, json.JSONDecodeError):
            continue
    return sorted(rows, key=lambda row: float(row.get("created_at_timestamp") or 0), reverse=True)


def perturbation_model_scope(project_dir: Path) -> dict:
    manifest = read_project_manifest(project_dir)
    cluster_value = manifest.get("cluster_labels_path")
    has_cluster_labels = bool(cluster_value and Path(str(cluster_value)).is_file())
    result, _edge_path = celloracle_result_and_edges(project_dir)
    cluster_paths = cluster_specific_edge_paths(result)
    scopes = result.get("scopes") if isinstance(result.get("scopes"), dict) else {}
    completed_labels = sorted(cluster_paths)
    fallback_labels = sorted(
        str(scope.get("scope_label"))
        for scope in scopes.values()
        if isinstance(scope, dict)
        and scope.get("scope_type") == "cluster"
        and scope.get("status") != "Completed"
        and scope.get("scope_label")
    )
    return {
        "mode": "cluster_specific" if has_cluster_labels else "global",
        "cluster_labels_available": has_cluster_labels,
        "cluster_specific_topology_count": len(completed_labels),
        "cluster_specific_topology_labels": completed_labels,
        "global_topology_fallback_labels": fallback_labels,
    }


def compact_run_status(status: dict) -> dict:
    allowed = {
        "run_id",
        "gene",
        "perturbation_value",
        "n_propagation",
        "clip_delta_x",
        "status",
        "progress_label",
        "error_message",
        "created_at",
        "created_at_timestamp",
        "started_at",
        "completed_at",
        "elapsed_seconds",
    }
    return {key: value for key, value in status.items() if key in allowed}


def enrich_embedding_points(project_dir: Path, run_id: str, result: dict) -> dict:
    """Attach per-cell vectors to older result payloads from their CSV export."""
    points = result.get("embedding_points")
    if not isinstance(points, list) or not points:
        return result
    if all(
        all(key in point for key in ("shift_x", "shift_y", "random_shift_x", "random_shift_y"))
        for point in points
        if isinstance(point, dict)
    ):
        return result

    shifts_path = run_directory(project_dir, run_id) / "cell_shifts.csv"
    if not shifts_path.is_file():
        return result
    try:
        with shifts_path.open("r", encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
    except OSError:
        return result
    if len(rows) != len(points):
        return result

    for point, row in zip(points, rows):
        if not isinstance(point, dict):
            continue
        try:
            point["shift_x"] = float(row.get("shift_x") or 0)
            point["shift_y"] = float(row.get("shift_y") or 0)
            point["random_shift_x"] = float(row.get("random_shift_x") or 0)
            point["random_shift_y"] = float(row.get("random_shift_y") or 0)
        except (TypeError, ValueError):
            continue
    return result


def enrich_cluster_summary(project_dir: Path, run_id: str, result: dict) -> dict:
    """Backfill cluster-level shift summaries for results created before the field existed."""
    if result.get("model_scope") != "cluster_specific" or result.get("cluster_summary"):
        return result

    shifts_path = run_directory(project_dir, run_id) / "cell_shifts.csv"
    if not shifts_path.is_file():
        return result

    grouped: dict[str, dict[str, float]] = {}
    try:
        with shifts_path.open("r", encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                cluster = str(row.get("cluster") or "").strip()
                if not cluster:
                    continue
                try:
                    shift_x = float(row.get("shift_x") or 0)
                    shift_y = float(row.get("shift_y") or 0)
                    random_x = float(row.get("random_shift_x") or 0)
                    random_y = float(row.get("random_shift_y") or 0)
                except (TypeError, ValueError):
                    continue
                summary = grouped.setdefault(
                    cluster,
                    {"cell_count": 0, "shift_total": 0.0, "random_total": 0.0},
                )
                summary["cell_count"] += 1
                summary["shift_total"] += math.hypot(shift_x, shift_y)
                summary["random_total"] += math.hypot(random_x, random_y)
    except OSError:
        return result

    effects_by_cluster: dict[str, list[dict]] = {}
    for effect in result.get("cluster_effects") or []:
        cluster = str(effect.get("cluster") or "").strip()
        if cluster:
            effects_by_cluster.setdefault(cluster, []).append(
                {"gene": effect.get("gene"), "mean_change": effect.get("mean_change", 0)}
            )

    summaries = []
    for cluster, values in sorted(grouped.items(), key=lambda item: item[0]):
        cell_count = int(values["cell_count"])
        mean_shift = values["shift_total"] / cell_count if cell_count else 0.0
        mean_random = values["random_total"] / cell_count if cell_count else 0.0
        summaries.append(
            {
                "cluster": cluster,
                "cell_count": cell_count,
                "mean_shift_magnitude": mean_shift,
                "mean_random_shift_magnitude": mean_random,
                "shift_ratio": mean_shift / mean_random if mean_random > 0 else None,
                "top_genes": sorted(
                    effects_by_cluster.get(cluster, []),
                    key=lambda item: abs(float(item.get("mean_change") or 0)),
                    reverse=True,
                )[:5],
            }
        )
    if summaries:
        result["cluster_summary"] = summaries
    return result


def get_perturbation_state(project_dir: Path) -> dict:
    available, reason = celloracle_availability(project_dir)
    runs = list_run_statuses(project_dir)
    latest_result = None
    for status in runs:
        if status.get("status") != "Completed":
            continue
        result_path = run_directory(project_dir, str(status["run_id"])) / "result.json"
        if result_path.exists():
            try:
                latest_result = read_json(result_path)
                latest_result["run_id"] = status["run_id"]
                latest_result["completed_at"] = status.get("completed_at")
                latest_result = enrich_embedding_points(project_dir, str(status["run_id"]), latest_result)
                latest_result = enrich_cluster_summary(project_dir, str(status["run_id"]), latest_result)
            except (OSError, json.JSONDecodeError):
                latest_result = None
            break

    return {
        "available": available,
        "reason": reason,
        "eligible_genes": eligible_perturbation_genes(project_dir) if available else [],
        "model_scope": perturbation_model_scope(project_dir) if available else None,
        "runs": [compact_run_status(status) for status in runs[:20]],
        "latest_result": latest_result,
    }


def get_perturbation_result(project_dir: Path, run_id: str) -> dict:
    normalized_run_id = str(run_id).strip()
    if not normalized_run_id or Path(normalized_run_id).name != normalized_run_id:
        raise FileNotFoundError("Perturbation result not found.")

    run_status_path = status_path(project_dir, normalized_run_id)
    result_path = run_directory(project_dir, normalized_run_id) / "result.json"
    if not run_status_path.is_file() or not result_path.is_file():
        raise FileNotFoundError("Perturbation result not found.")

    try:
        status = read_json(run_status_path)
        result = read_json(result_path)
    except (OSError, json.JSONDecodeError) as exc:
        raise FileNotFoundError("Perturbation result not found.") from exc
    if status.get("status") != "Completed":
        raise FileNotFoundError("Perturbation result not found.")

    result["run_id"] = normalized_run_id
    result["completed_at"] = status.get("completed_at")
    result = enrich_embedding_points(project_dir, normalized_run_id, result)
    return enrich_cluster_summary(project_dir, normalized_run_id, result)


def validate_perturbation_request(
    project_dir: Path,
    gene: str,
    perturbation_value: float,
    n_propagation: int,
) -> str:
    available, reason = celloracle_availability(project_dir)
    if not available:
        raise RuntimeError(reason or "CellOracle perturbation is unavailable.")
    normalized_gene = gene.strip()
    if not normalized_gene:
        raise ValueError("Select a gene to perturb.")
    if normalized_gene not in set(eligible_perturbation_genes(project_dir)):
        raise ValueError("The selected gene is not a regulator in the CellOracle network.")
    if perturbation_value < 0:
        raise ValueError("Perturbation value cannot be negative.")
    if not math.isfinite(perturbation_value):
        raise ValueError("Perturbation value must be a finite number.")
    expression_profile = get_gene_expression_profile(project_dir, normalized_gene)
    safe_upper_limit = float(expression_profile["safe_upper_limit"])
    if perturbation_value > safe_upper_limit:
        raise ValueError(
            "Target expression exceeds this gene's safe upper limit "
            f"({safe_upper_limit:.6g})."
        )
    if not 1 <= n_propagation <= 5:
        raise ValueError("Propagation steps must be between 1 and 5.")
    if any(status.get("status") in ACTIVE_STATUSES for status in list_run_statuses(project_dir)):
        raise RuntimeError("A CellOracle perturbation is already running for this project.")
    return normalized_gene


def create_perturbation_run(
    project_dir: Path,
    *,
    gene: str,
    perturbation_value: float,
    n_propagation: int,
    clip_delta_x: bool,
) -> dict:
    with PERTURBATION_LOCK:
        normalized_gene = validate_perturbation_request(
            project_dir,
            gene,
            perturbation_value,
            n_propagation,
        )
        run_id = uuid.uuid4().hex[:12]
        created_timestamp = time.time()
        status = {
            "run_id": run_id,
            "gene": normalized_gene,
            "perturbation_value": float(perturbation_value),
            "n_propagation": int(n_propagation),
            "clip_delta_x": bool(clip_delta_x),
            "status": "Queued",
            "progress_label": "Waiting to start",
            "error_message": None,
            "created_at": utc_now(),
            "created_at_timestamp": created_timestamp,
            "started_at": None,
            "completed_at": None,
            "elapsed_seconds": 0,
        }
        write_json_atomic(status_path(project_dir, run_id), status)
        return status


def update_run_status(project_dir: Path, run_id: str, **changes) -> dict:
    with PERTURBATION_LOCK:
        path = status_path(project_dir, run_id)
        status = read_json(path)
        status.update(changes)
        write_json_atomic(path, status)
        return status


def file_signature(paths: list[Path], parameters: dict) -> str:
    digest = hashlib.sha256()
    for path in paths:
        stat = path.stat()
        digest.update(str(path.resolve()).encode("utf-8"))
        digest.update(str(stat.st_size).encode("utf-8"))
        digest.update(str(stat.st_mtime_ns).encode("utf-8"))
    digest.update(json.dumps(parameters, sort_keys=True).encode("utf-8"))
    return digest.hexdigest()


def prepare_model_cache(
    perturb_root: Path,
    input_paths: list[Path],
    parameters: dict,
) -> tuple[Path, bool]:
    model_dir = perturb_root / "model"
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / "simulation.celloracle.oracle"
    signature_path = model_dir / "signature.json"
    signature = file_signature(input_paths, parameters)
    reusable = False
    if model_path.exists() and signature_path.exists():
        try:
            reusable = read_json(signature_path).get("signature") == signature
        except (OSError, json.JSONDecodeError):
            reusable = False
    if not reusable:
        model_path.unlink(missing_ok=True)
        signature_path.unlink(missing_ok=True)
        (model_dir / "expression_limits.json").unlink(missing_ok=True)
    return model_path, reusable


def readable_process_error(completed: subprocess.CompletedProcess[str]) -> str:
    output = "\n".join(
        part.strip() for part in (completed.stderr, completed.stdout) if part and part.strip()
    )
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    return " ".join(lines[-6:])[:1200] or "CellOracle perturbation failed."


def run_perturbation_task(project_id: str, run_id: str) -> None:
    project_dir = PROJECTS_ROOT / project_id
    started_timestamp = time.time()
    try:
        status = read_json(status_path(project_dir, run_id))
        project_manifest = read_project_manifest(project_dir)
        celloracle_result, edges_path = celloracle_result_and_edges(project_dir)
        cluster_edge_paths = cluster_specific_edge_paths(celloracle_result)

        expression_value = project_manifest.get("expression_path")
        if not expression_value:
            raise FileNotFoundError("Project expression matrix is missing.")
        source_expression = Path(str(expression_value))
        expression_path = ensure_project_preprocessed_expression(
            project_id,
            source_expression,
            project_manifest,
        )
        expression_mode = resolve_celloracle_expression_mode(project_manifest)
        expression_path = ensure_celloracle_expression_source(
            source_expression=source_expression,
            preprocessed_expression=expression_path,
            project_manifest=project_manifest,
        )
        cluster_path_value = project_manifest.get("cluster_labels_path")
        cluster_path = Path(str(cluster_path_value)) if cluster_path_value else None
        if cluster_path is not None and not cluster_path.exists():
            cluster_path = None
        pseudotime_path_value = project_manifest.get("pseudotime_path")
        pseudotime_path = Path(str(pseudotime_path_value)) if pseudotime_path_value else None
        if pseudotime_path is not None and not pseudotime_path.exists():
            pseudotime_path = None

        perturb_root = perturbation_root(project_dir)
        runtime_dir = perturb_root / "runtime" / run_id
        output_dir = run_directory(project_dir, run_id)
        runtime_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)

        expression_copy = runtime_dir / "ExpressionData.csv"
        edges_copy = runtime_dir / "CellOracleEdges.csv"
        clusters_copy = runtime_dir / "ClusterLabels.csv"
        pseudotime_copy = runtime_dir / "PseudoTime.csv"
        cluster_edges_manifest = runtime_dir / "ClusterEdges.json"
        shutil.copy2(expression_path, expression_copy)
        shutil.copy2(edges_path, edges_copy)
        if cluster_path is not None:
            shutil.copy2(cluster_path, clusters_copy)
        if pseudotime_path is not None:
            shutil.copy2(pseudotime_path, pseudotime_copy)
        copied_cluster_edges: dict[str, str] = {}
        cluster_edges_dir = runtime_dir / "cluster_edges"
        for index, (label, path) in enumerate(sorted(cluster_edge_paths.items())):
            cluster_edges_dir.mkdir(parents=True, exist_ok=True)
            destination = cluster_edges_dir / f"cluster_{index}.csv"
            shutil.copy2(path, destination)
            copied_cluster_edges[label] = str(destination.relative_to(runtime_dir))
        if copied_cluster_edges:
            write_json_atomic(cluster_edges_manifest, copied_cluster_edges)

        beeline_root = resolve_beeline_root()
        source_script = (
            beeline_root / "Algorithms" / "CELLORACLE" / "runCellOraclePerturbation.py"
        )
        if not source_script.exists():
            raise FileNotFoundError("CellOracle perturbation runner is missing.")
        distribution_helper_source = source_script.with_name(
            "perturbation_distributions.py"
        )
        if not distribution_helper_source.exists():
            raise FileNotFoundError("CellOracle distribution helper is missing.")
        script_copy = runtime_dir / source_script.name
        shutil.copy2(source_script, script_copy)
        shutil.copy2(
            distribution_helper_source,
            runtime_dir / distribution_helper_source.name,
        )

        max_cells = max(100, int(os.environ.get("GRNSCOPE_PERTURBATION_MAX_CELLS", "2000")))
        has_cluster_labels = cluster_path is not None
        parameters = {
            "alpha": 10.0,
            "max_cells": max_cells,
            "grn_unit": "cluster" if has_cluster_labels else "whole",
            "cluster_topology_count": len(cluster_edge_paths),
            "expression_mode": expression_mode,
            "input_contract_version": CELLORACLE_INPUT_CONTRACT_VERSION,
        }
        model_inputs = [expression_path, edges_path]
        if cluster_path is not None:
            model_inputs.append(cluster_path)
        model_inputs.extend(path for _label, path in sorted(cluster_edge_paths.items()))
        model_path, model_reused = prepare_model_cache(
            perturb_root,
            model_inputs,
            parameters,
        )

        update_run_status(
            project_dir,
            run_id,
            status="Running" if model_reused else "Preparing",
            progress_label=(
                "Simulating perturbation"
                if model_reused
                else "Preparing perturbation model (first run only)"
            ),
            started_at=utc_now(),
        )

        container_root = "/usr/perturbations"
        command = [
            "docker",
            "run",
            "--rm",
            "-v",
            f"{perturb_root.resolve()}:{container_root}",
            resolve_algorithm_image("CELLORACLE"),
            "python",
            f"{container_root}/runtime/{run_id}/{source_script.name}",
            "--expression",
            f"{container_root}/runtime/{run_id}/{expression_copy.name}",
            "--edges",
            f"{container_root}/runtime/{run_id}/{edges_copy.name}",
            "--model",
            f"{container_root}/model/{model_path.name}",
            "--output-dir",
            f"{container_root}/runs/{run_id}",
            "--gene",
            str(status["gene"]),
            "--value",
            str(status["perturbation_value"]),
            "--n-propagation",
            str(status["n_propagation"]),
            "--alpha",
            str(parameters["alpha"]),
            "--max-cells",
            str(max_cells),
            "--expression-mode",
            expression_mode,
        ]
        if clusters_copy.exists():
            command.extend(
                ["--clusters", f"{container_root}/runtime/{run_id}/{clusters_copy.name}"]
            )
        if pseudotime_copy.exists():
            command.extend(
                ["--pseudotime", f"{container_root}/runtime/{run_id}/{pseudotime_copy.name}"]
            )
        if cluster_edges_manifest.exists():
            command.extend(
                [
                    "--cluster-edges-manifest",
                    f"{container_root}/runtime/{run_id}/{cluster_edges_manifest.name}",
                ]
            )
        if status.get("clip_delta_x"):
            command.append("--clip-delta-x")

        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
        (output_dir / "stdout.log").write_text(completed.stdout or "", encoding="utf-8")
        (output_dir / "stderr.log").write_text(completed.stderr or "", encoding="utf-8")
        if completed.returncode != 0:
            raise RuntimeError(readable_process_error(completed))
        result_path = output_dir / "result.json"
        if not result_path.exists():
            raise FileNotFoundError("CellOracle did not create a perturbation result.")

        signature = file_signature(model_inputs, parameters)
        write_json_atomic(
            perturb_root / "model" / "signature.json",
            {"signature": signature, "created_at": utc_now(), **parameters},
        )
        completed_timestamp = time.time()
        update_run_status(
            project_dir,
            run_id,
            status="Completed",
            progress_label="Completed",
            completed_at=utc_now(),
            elapsed_seconds=max(0, int(completed_timestamp - started_timestamp)),
            error_message=None,
        )
        shutil.rmtree(runtime_dir, ignore_errors=True)
    except Exception as exc:
        completed_timestamp = time.time()
        try:
            update_run_status(
                project_dir,
                run_id,
                status="Failed",
                progress_label="Failed",
                completed_at=utc_now(),
                elapsed_seconds=max(0, int(completed_timestamp - started_timestamp)),
                error_message=str(exc),
            )
        except Exception:
            pass


def launch_perturbation_thread(project_id: str, run_id: str) -> None:
    worker = threading.Thread(
        target=run_perturbation_task,
        args=(project_id, run_id),
        daemon=True,
        name=f"celloracle-perturbation-{project_id}-{run_id}",
    )
    worker.start()


def ensure_cell_shift_distance_column(path: Path) -> Path:
    """Append the predicted-to-randomized destination distance to older exports."""
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            fieldnames = list(reader.fieldnames or [])
            if "shift_distance" in fieldnames:
                return path
            if not all(column in fieldnames for column in CELL_SHIFT_COMPONENT_COLUMNS):
                return path
            rows = list(reader)
    except OSError:
        return path

    for row in rows:
        try:
            row["shift_distance"] = str(
                math.hypot(
                    float(row["shift_x"]) - float(row["random_shift_x"]),
                    float(row["shift_y"]) - float(row["random_shift_y"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            row["shift_distance"] = ""

    temporary = path.with_suffix(f"{path.suffix}.tmp-{os.getpid()}-{threading.get_ident()}")
    try:
        with temporary.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=[*fieldnames, "shift_distance"])
            writer.writeheader()
            writer.writerows(rows)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def perturbation_download_path(project_dir: Path, run_id: str, filename: str) -> Path:
    if filename not in DOWNLOAD_FILENAMES:
        raise FileNotFoundError("Perturbation download not found.")
    path = run_directory(project_dir, run_id) / filename
    if not path.exists() or not path.is_file():
        raise FileNotFoundError("Perturbation download not found.")
    if filename == "cell_shifts.csv":
        ensure_cell_shift_distance_column(path)
    return path
