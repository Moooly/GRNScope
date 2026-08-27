from __future__ import annotations

import csv
from datetime import datetime, timezone
import hashlib
from importlib import metadata as importlib_metadata
from io import BytesIO
import json
import platform
from pathlib import Path
import re
import shutil
import subprocess
import time
from typing import Any
import zipfile

from ..algorithm_registry import get_algorithm_by_id
from ..atomic_io import atomic_write_json


RUN_MANIFEST_SCHEMA_NAME = "grnscope.run-manifest"
RUN_MANIFEST_SCHEMA_VERSION = "2.0.0"
RUN_MANIFEST_DIRNAME = "run_manifests"
_TEXT_BUNDLE_SUFFIXES = {".json", ".log", ".txt", ".yaml", ".yml", ".csv", ".tsv"}
_BUNDLE_FILENAMES = {
    "config.yaml",
    "run_timings.json",
    "stdout.log",
    "stderr.log",
    "celloracle-worker.log",
    "error.json",
    "output.txt",
    "phase_timings.json",
    "gene_selection_audit.json",
}


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_relative_path(path: Path, project_dir: Path) -> str:
    try:
        return path.resolve().relative_to(project_dir.resolve()).as_posix()
    except (OSError, ValueError):
        return path.name


def _sanitize_text(value: str, project_dir: Path) -> str:
    sanitized = value.replace(str(project_dir), "${PROJECT_DIR}")
    sanitized = re.sub(
        r"/attempts/attempt-[^/\s'\"]+",
        "",
        sanitized,
    )
    sanitized = re.sub(
        r"/(?:Users|home)/[^/\s]+/(?:[^\s'\";,]+)",
        "${SERVER_PATH}",
        sanitized,
    )
    return sanitized


def _portable_result_summary(value: Any, project_dir: Path) -> Any:
    internal_keys = {
        "job_id",
        "attempt_id",
        "beeline_runtime_root",
        "result_artifact_root",
        "runtime_root",
        "run_diagnostics_root",
        "ranked_edges_path",
        "run_ranked_edges_paths",
        "diagnostics_path",
    }
    if isinstance(value, dict):
        return {
            str(key): _portable_result_summary(item, project_dir)
            for key, item in value.items()
            if str(key) not in internal_keys
        }
    if isinstance(value, list):
        return [_portable_result_summary(item, project_dir) for item in value]
    if isinstance(value, str):
        return _sanitize_text(value, project_dir)
    return value


def _sanitize_value(value: Any, project_dir: Path) -> Any:
    if isinstance(value, dict):
        return {
            str(key): _sanitize_value(item, project_dir)
            for key, item in value.items()
            if str(key) not in {"owner_id", "notification_email", "process_pid"}
        }
    if isinstance(value, list):
        return [_sanitize_value(item, project_dir) for item in value]
    if isinstance(value, str):
        return _sanitize_text(value, project_dir)
    return value


def _read_gene_names(path: Path) -> list[str]:
    if not path.is_file() or path.suffix.lower() == ".h5ad":
        return []
    try:
        sample = path.read_text(encoding="utf-8-sig", errors="replace")[:8192]
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
    except (OSError, csv.Error):
        dialect = csv.excel_tab if "\t" in locals().get("sample", "") else csv.excel

    genes: list[str] = []
    try:
        with path.open("r", encoding="utf-8-sig", errors="replace", newline="") as handle:
            rows = csv.reader(handle, dialect)
            next(rows, None)
            for row in rows:
                if not row:
                    continue
                gene = str(row[0]).strip()
                if gene:
                    genes.append(gene)
    except (OSError, csv.Error):
        return []
    return genes


def _input_file_entry(
    *,
    role: str,
    path_value: Any,
    project_dir: Path,
    original_filename: str | None = None,
) -> dict[str, Any] | None:
    if not path_value:
        return None
    path = Path(str(path_value))
    if not path.is_file():
        return None
    return {
        "role": role,
        "original_filename": original_filename or path.name,
        "project_path": _safe_relative_path(path, project_dir),
        "size_bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def _collect_inputs(
    project_dir: Path,
    project: dict[str, Any],
    metadata: dict[str, Any],
) -> list[dict[str, Any]]:
    specifications = (
        (
            "expression_matrix",
            project.get("expression_source_path") or project.get("expression_path"),
            metadata.get("expression_filename"),
        ),
        (
            "pseudotime",
            project.get("pseudotime_source_path") or project.get("pseudotime_path"),
            metadata.get("pseudotime_filename"),
        ),
        (
            "ground_truth_network",
            project.get("ground_truth_path"),
            metadata.get("ground_truth_filename") or project.get("ground_truth_filename"),
        ),
        (
            "cluster_labels",
            project.get("cluster_labels_path"),
            metadata.get("cluster_labels_filename"),
        ),
        (
            "gene_ordering",
            project.get("gene_ordering_path"),
            metadata.get("gene_ordering_filename"),
        ),
        (
            "transcription_factor_list",
            project.get("custom_tf_list_path"),
            metadata.get("custom_tf_list_filename")
            or project.get("custom_tf_list_filename"),
        ),
    )
    files = [
        entry
        for role, path_value, filename in specifications
        if (
            entry := _input_file_entry(
                role=role,
                path_value=path_value,
                project_dir=project_dir,
                original_filename=str(filename) if filename else None,
            )
        )
    ]

    effective_expression = _input_file_entry(
        role="effective_preprocessed_expression_matrix",
        path_value=project.get("preprocessed_expression_path"),
        project_dir=project_dir,
        original_filename="ExpressionData.csv",
    )
    if effective_expression:
        files.append(effective_expression)

    tf_reference = project.get("known_tf_reference") or {}
    if (
        isinstance(tf_reference, dict)
        and tf_reference.get("status") == "available"
        and tf_reference.get("source") != "user_upload"
        and tf_reference.get("source_filename")
    ):
        bundled_tf_path = (
            Path(__file__).resolve().parents[2]
            / "data"
            / "tf_gene_names"
            / Path(str(tf_reference["source_filename"])).name
        )
        bundled_reference = _input_file_entry(
            role="transcription_factor_reference",
            path_value=bundled_tf_path,
            project_dir=project_dir,
            original_filename=bundled_tf_path.name,
        )
        if bundled_reference:
            bundled_reference["source"] = "GRNScope bundled species reference"
            files.append(bundled_reference)
    return files


def _gene_summary(gene_names: list[str]) -> dict[str, Any]:
    return {"count": len(gene_names), "genes": gene_names}


def _collect_genes(
    project_dir: Path,
    project: dict[str, Any],
    metadata: dict[str, Any],
    artifact_dir: Path | None,
) -> dict[str, Any]:
    before = metadata.get("gene_names")
    if not isinstance(before, list) or not before:
        source_path = project.get("expression_source_path") or project.get("expression_path")
        before = _read_gene_names(Path(str(source_path))) if source_path else []
    before = [str(gene) for gene in before]

    preprocessed_path_value = project.get("preprocessed_expression_path")
    after_project = (
        _read_gene_names(Path(str(preprocessed_path_value)))
        if preprocessed_path_value
        else []
    )
    if not after_project:
        after_project = list(before)

    algorithm_audit: dict[str, Any] = {}
    if artifact_dir and artifact_dir.is_dir():
        audit_path = artifact_dir / "gene_selection_audit.json"
        if not audit_path.is_file():
            audit_path = next(
                iter(sorted(artifact_dir.rglob("gene_selection_audit.json"))),
                audit_path,
            )
        algorithm_audit = _read_json(audit_path)
    after_algorithm = algorithm_audit.get("retained_gene_names")
    if not isinstance(after_algorithm, list) or not after_algorithm:
        after_algorithm = list(after_project)

    audit_stages: list[dict[str, Any]] = []
    audit_dir = project_dir / "preprocessed" / "gene_selection_audits"
    if audit_dir.is_dir():
        for path in sorted(audit_dir.glob("*.json")):
            audit = _read_json(path)
            audit_stages.append(
                {
                    "stage": audit.get("stage") or path.stem,
                    "input_gene_count": audit.get("input_gene_count"),
                    "retained_gene_count": audit.get("retained_gene_count"),
                    "removed_gene_count": audit.get("removed_gene_count"),
                    "retained_genes": audit.get("retained_gene_names") or [],
                    "removed_genes": audit.get("removed_gene_names") or [],
                }
            )

    return {
        "before_filtering": _gene_summary(before),
        "after_project_filtering": _gene_summary(after_project),
        "after_algorithm_filtering": _gene_summary(
            [str(gene) for gene in after_algorithm]
        ),
        "project_filter_stages": audit_stages,
        "algorithm_filter": _sanitize_value(algorithm_audit, project_dir),
    }


def _collect_matrix_and_preprocessing(
    project_dir: Path,
    project: dict[str, Any],
) -> dict[str, Any]:
    preprocessing_manifest = _read_json(project_dir / "preprocessed" / "manifest.json")
    signature = preprocessing_manifest.get("signature") or {}
    matrix_signature = signature.get("matrix_transformation") or {}
    transformation = preprocessing_manifest.get("transformation") or {}
    gene_selection = preprocessing_manifest.get("gene_selection") or []
    return _sanitize_value(
        {
            "declared_input_state": (project.get("preprocessing") or {}).get(
                "matrix_state"
            ),
            "detected_input_state": transformation.get("input_state")
            or matrix_signature.get("matrix_state"),
            "output_state": transformation.get("output_state"),
            "transformation_engine": matrix_signature.get("engine"),
            "transformation_version": matrix_signature.get("version"),
            "operations": transformation.get("operations")
            or matrix_signature.get("operations")
            or [],
            "normalization_target_sum": transformation.get("normalization_target_sum")
            or matrix_signature.get("normalization_target_sum"),
            "project_configuration": project.get("preprocessing") or {},
            "filter_steps": gene_selection,
        },
        project_dir,
    )


def _docker_digest(image_ref: str | None) -> str | None:
    if not image_ref:
        return None
    try:
        completed = subprocess.run(
            ["docker", "image", "inspect", "--format", "{{json .RepoDigests}}", image_ref],
            check=False,
            capture_output=True,
            text=True,
            timeout=3,
        )
        if completed.returncode != 0:
            return None
        digests = json.loads(completed.stdout.strip() or "[]")
        if isinstance(digests, list) and digests:
            return str(digests[0]).split("@", 1)[-1]
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None
    return None


def _software_versions() -> dict[str, Any]:
    versions: dict[str, Any] = {
        "python": platform.python_version(),
        "platform": platform.platform(),
    }
    for package in ("fastapi", "numpy", "pandas", "scanpy", "anndata", "scipy", "scikit-learn"):
        try:
            versions[package] = importlib_metadata.version(package)
        except importlib_metadata.PackageNotFoundError:
            versions[package] = None

    repository_root = Path(__file__).resolve().parents[3]
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repository_root,
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
        )
        versions["grnscope_git_commit"] = (
            completed.stdout.strip() if completed.returncode == 0 else None
        )
    except (OSError, subprocess.SubprocessError):
        versions["grnscope_git_commit"] = None
    return versions


def _collect_parameters_and_seeds(
    job: dict[str, Any],
    task: dict[str, Any],
    result: dict[str, Any],
    algorithm_id: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    parameters = result.get("algorithm_parameters")
    if not isinstance(parameters, dict):
        resolved = job.get("resolved_algorithm_parameters") or {}
        parameters = resolved.get(algorithm_id) or resolved.get(algorithm_id.upper()) or {}
    if not isinstance(parameters, dict):
        parameters = {}

    run_metadata = task.get("run_metadata")
    if not isinstance(run_metadata, dict):
        run_metadata = (result.get("confidence_summary") or {}).get("run_metadata") or {}
    seeds: list[dict[str, Any]] = []
    if isinstance(run_metadata, dict):
        for run_id, run in sorted(run_metadata.items()):
            if not isinstance(run, dict):
                continue
            seeds.append(
                {
                    "run_id": str(run_id),
                    "seed": run.get("seed") or run.get("random_seed"),
                    "status": run.get("status"),
                    "cell_count": run.get("cell_count") or run.get("cells"),
                    "gene_count": run.get("gene_count"),
                    "elapsed_seconds": run.get("elapsed_seconds"),
                }
            )
    for key, value in sorted(parameters.items()):
        if "seed" in str(key).lower() and not seeds:
            seeds.append({"run_id": "primary", "seed": value})
    return parameters, seeds


def _collect_pseudotime(
    project_dir: Path,
    project: dict[str, Any],
    metadata: dict[str, Any],
    inputs: list[dict[str, Any]],
) -> dict[str, Any]:
    pseudotime_input = next(
        (entry for entry in inputs if entry["role"] == "pseudotime"),
        None,
    )
    if project.get("pseudotime_estimated"):
        source = "estimated"
    elif pseudotime_input:
        source = "uploaded"
    else:
        source = "not_provided"
    estimation = project.get("pseudotime_estimation") or {}
    return _sanitize_value(
        {
            "source": source,
            "filename": (
                pseudotime_input.get("original_filename") if pseudotime_input else None
            ),
            "sha256": pseudotime_input.get("sha256") if pseudotime_input else None,
            "method": estimation.get("method")
            or ("Slingshot" if source == "estimated" else None),
            "start_cluster": estimation.get("start_cluster")
            or project.get("pseudotime_start_cluster"),
            "input_contract": project.get("pseudotime_input_contract"),
            "canonicalization": project.get("pseudotime_canonicalization"),
            "metadata_has_pseudotime": metadata.get("has_pseudotime"),
        },
        project_dir,
    )


def _copy_bundle_files(
    source_dir: Path | None,
    destination_dir: Path,
    project_dir: Path,
) -> list[dict[str, Any]]:
    if not source_dir or not source_dir.is_dir():
        return []
    copied: list[dict[str, Any]] = []
    for source in sorted(source_dir.rglob("*")):
        if not source.is_file():
            continue
        if source.name not in _BUNDLE_FILENAMES and source.suffix.lower() not in {".log", ".txt"}:
            continue
        relative = source.relative_to(source_dir)
        destination = destination_dir / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.suffix.lower() in _TEXT_BUNDLE_SUFFIXES:
            try:
                text = source.read_text(encoding="utf-8", errors="replace")
                destination.write_text(_sanitize_text(text, project_dir), encoding="utf-8")
            except OSError:
                continue
        else:
            shutil.copy2(source, destination)
        copied.append(
            {
                "path": destination.relative_to(destination_dir.parent).as_posix(),
                "size_bytes": destination.stat().st_size,
                "sha256": sha256_file(destination),
            }
        )
    return copied


def _copy_result_files(
    artifact_dir: Path | None,
    result_path: Path | None,
    destination_dir: Path,
    project_dir: Path,
) -> list[dict[str, Any]]:
    """Copy the combined network and every individual run result."""

    copied: list[dict[str, Any]] = []
    if artifact_dir and artifact_dir.is_dir():
        for source in sorted(artifact_dir.rglob("rankedEdges.csv")):
            if not source.is_file():
                continue
            relative = source.relative_to(artifact_dir)
            destination = destination_dir / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)

            parts = relative.parts
            run_id = None
            scope_id = "global"
            if "runs" in parts:
                run_index = parts.index("runs")
                if run_index + 1 < len(parts):
                    run_id = parts[run_index + 1]
            if "scopes" in parts:
                scope_index = parts.index("scopes")
                if scope_index + 1 < len(parts):
                    scope_id = parts[scope_index + 1]
            copied.append(
                {
                    "role": "run_result" if run_id else "combined_result",
                    "run_id": run_id,
                    "scope_id": scope_id,
                    "path": destination.relative_to(
                        destination_dir.parent
                    ).as_posix(),
                    "size_bytes": destination.stat().st_size,
                    "sha256": sha256_file(destination),
                }
            )

    if result_path and result_path.is_file():
        destination = destination_dir / "result_summary.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            raw_result = json.loads(
                result_path.read_text(encoding="utf-8", errors="replace")
            )
            atomic_write_json(
                destination,
                _portable_result_summary(raw_result, project_dir),
            )
            copied.append(
                {
                    "role": "result_summary",
                    "run_id": None,
                    "scope_id": "global",
                    "path": destination.relative_to(
                        destination_dir.parent
                    ).as_posix(),
                    "size_bytes": destination.stat().st_size,
                    "sha256": sha256_file(destination),
                }
            )
        except (OSError, json.JSONDecodeError):
            pass
    return copied


def _warnings_from_support_files(
    attempt_dir: Path,
    support_files: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for support_file in support_files:
        relative_path = str(support_file.get("path") or "")
        if not relative_path.lower().endswith((".log", ".txt")):
            continue
        path = attempt_dir / relative_path
        if not path.is_file():
            continue
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line_number, line in enumerate(lines, start=1):
            message = line.strip()
            if not message or not re.search(r"\bwarn(?:ing)?\b", message, re.IGNORECASE):
                continue
            key = (relative_path, message)
            if key in seen:
                continue
            seen.add(key)
            warnings.append(
                {
                    "source": "log",
                    "path": relative_path,
                    "line": line_number,
                    "message": message,
                }
            )
            if len(warnings) >= 100:
                return warnings
    return warnings


def run_manifest_algorithm_dir(
    project_dir: Path,
    job_id: str,
    algorithm_id: str,
) -> Path:
    return (
        project_dir
        / RUN_MANIFEST_DIRNAME
        / str(job_id)
        / algorithm_id.upper()
    )


def generate_run_manifest(
    project_dir: Path,
    job_id: str,
    algorithm_id: str,
    *,
    status: str,
    started_at_timestamp: float,
    completed_at_timestamp: float,
    elapsed_seconds: int,
    result_path: str | Path | None = None,
    artifact_dir: str | Path | None = None,
    diagnostics_path: str | Path | None = None,
    error_message: str | None = None,
    error_type: str | None = None,
) -> Path:
    """Write the current portable provenance record for an algorithm result."""

    normalized_algorithm_id = algorithm_id.upper()
    project = _read_json(project_dir / "project.json")
    metadata = _read_json(project_dir / "metadata.json")
    jobs_payload = _read_json(project_dir / "jobs.json")
    if not jobs_payload:
        try:
            raw_jobs = json.loads((project_dir / "jobs.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw_jobs = []
    else:
        raw_jobs = jobs_payload
    jobs = raw_jobs if isinstance(raw_jobs, list) else raw_jobs.get("jobs", [])
    job = next(
        (item for item in jobs if isinstance(item, dict) and item.get("job_id") == job_id),
        {},
    )
    task = next(
        (
            item
            for item in job.get("tasks", [])
            if isinstance(item, dict)
            and str(item.get("algorithm_id", "")).upper() == normalized_algorithm_id
        ),
        {},
    )
    result = _read_json(Path(str(result_path))) if result_path else {}
    resolved_artifact_dir = Path(str(artifact_dir)) if artifact_dir else None
    resolved_diagnostics_path = Path(str(diagnostics_path)) if diagnostics_path else None
    diagnostics_dir = (
        resolved_diagnostics_path.parent
        if resolved_diagnostics_path and resolved_diagnostics_path.is_file()
        else resolved_diagnostics_path
    )

    final_algorithm_dir = run_manifest_algorithm_dir(
        project_dir, job_id, normalized_algorithm_id
    )
    working_dir = final_algorithm_dir.with_name(
        f".{normalized_algorithm_id}.manifest-{time.time_ns()}.tmp"
    )
    if working_dir.exists():
        shutil.rmtree(working_dir, ignore_errors=True)
    working_dir.mkdir(parents=True, exist_ok=False)

    inputs = _collect_inputs(project_dir, project, metadata)
    parameters, random_seeds = _collect_parameters_and_seeds(
        job, task, result, normalized_algorithm_id
    )
    try:
        algorithm = get_algorithm_by_id(normalized_algorithm_id)
    except KeyError:
        algorithm = {
            "id": normalized_algorithm_id,
            "name": normalized_algorithm_id,
            "docker_image": None,
            "runner": None,
        }
    image_ref = result.get("docker_image_version") or algorithm.get("docker_image")

    support_files: list[dict[str, Any]] = []
    support_files.extend(
        _copy_bundle_files(
            resolved_artifact_dir,
            working_dir / "artifacts",
            project_dir,
        )
    )
    support_files.extend(
        _copy_bundle_files(
            diagnostics_dir,
            working_dir / "diagnostics",
            project_dir,
        )
    )
    resolved_result_path = Path(str(result_path)) if result_path else None
    result_files = _copy_result_files(
        resolved_artifact_dir,
        resolved_result_path,
        working_dir / "results",
        project_dir,
    )
    support_files.extend(result_files)

    warnings: list[dict[str, Any]] = []
    for source_name, source in (
        ("result", result.get("warnings")),
        ("task", task.get("warnings")),
        (
            "preprocessing",
            _read_json(project_dir / "preprocessed" / "manifest.json").get(
                "warnings"
            ),
        ),
    ):
        if isinstance(source, list):
            warnings.extend(
                {"source": source_name, "message": _sanitize_text(str(item), project_dir)}
                for item in source
            )
    run_metadata = task.get("run_metadata") or {}
    if not isinstance(run_metadata, dict) or not run_metadata:
        run_metadata = (result.get("confidence_summary") or {}).get(
            "run_metadata"
        ) or {}
    if isinstance(run_metadata, dict):
        for run_id, run in sorted(run_metadata.items()):
            if isinstance(run, dict) and run.get("status") in {"Empty", "Failed"}:
                warnings.append(
                    {
                        "source": "replicate",
                        "run_id": run_id,
                        "message": _sanitize_text(
                            str(
                                run.get("error_message")
                                or f"Replicate status: {run.get('status')}"
                            ),
                            project_dir,
                        ),
                    }
                )
    warnings.extend(_warnings_from_support_files(working_dir, support_files))

    included_run_ids = sorted(
        {
            str(item["run_id"])
            for item in result_files
            if item.get("role") == "run_result" and item.get("run_id")
        }
    )
    expected_run_ids = sorted(
        str(run_id)
        for run_id, metadata_item in run_metadata.items()
        if isinstance(metadata_item, dict)
        and metadata_item.get("status") == "Completed"
    )

    manifest = {
        "schema": {
            "name": RUN_MANIFEST_SCHEMA_NAME,
            "version": RUN_MANIFEST_SCHEMA_VERSION,
        },
        "identity": {
            "project_id": project_dir.name,
            "project_name": project.get("project_name")
            or metadata.get("project_name")
            or project_dir.name,
            "algorithm_id": normalized_algorithm_id,
            "status": status,
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        "inputs": {"checksum_algorithm": "sha256", "files": inputs},
        "matrix_and_preprocessing": _collect_matrix_and_preprocessing(
            project_dir, project
        ),
        "genes": _collect_genes(
            project_dir, project, metadata, resolved_artifact_dir
        ),
        "execution": {
            "algorithm": {
                "id": normalized_algorithm_id,
                "name": algorithm.get("name"),
                "runner": algorithm.get("runner"),
                "version": (
                    str(image_ref).rsplit(":", 1)[-1] if image_ref else None
                ),
            },
            "container": {
                "image": image_ref,
                "digest": _docker_digest(str(image_ref) if image_ref else None),
            },
            "software_versions": _software_versions(),
            "parameters": _sanitize_value(parameters, project_dir),
            "run_settings": _sanitize_value(
                {
                    "ensemble_enabled": job.get("ensemble_enabled"),
                    "confidence_run_mode": project.get("confidence_run_mode"),
                    "confidence_bootstrap_runs": project.get(
                        "confidence_bootstrap_runs"
                    ),
                    "confidence_evidence_threshold": project.get(
                        "confidence_evidence_threshold"
                    ),
                    "ranked_edges_per_target_limit": project.get(
                        "ranked_edges_per_target_limit"
                    ),
                    "scope_order": result.get("scope_order") or ["global"],
                    "celloracle": (
                        project.get("celloracle")
                        if normalized_algorithm_id == "CELLORACLE"
                        else None
                    ),
                },
                project_dir,
            ),
            "random_seeds": random_seeds,
            "random_seed_notes": (
                "A null seed identifies a full-data run without bootstrap sampling."
            ),
        },
        "pseudotime": _collect_pseudotime(project_dir, project, metadata, inputs),
        "results": {
            "all_runs_included": (
                not expected_run_ids
                or set(expected_run_ids).issubset(included_run_ids)
            ),
            "expected_run_ids": expected_run_ids,
            "included_run_ids": included_run_ids,
            "run_result_count": len(included_run_ids),
            "files": result_files,
        },
        "runtime": {
            "started_at": datetime.fromtimestamp(
                started_at_timestamp, tz=timezone.utc
            ).isoformat(),
            "completed_at": datetime.fromtimestamp(
                completed_at_timestamp, tz=timezone.utc
            ).isoformat(),
            "elapsed_seconds": elapsed_seconds,
            "replicates": _sanitize_value(run_metadata, project_dir),
        },
        "warnings": warnings,
        "failure": (
            {
                "error_type": error_type or task.get("error_type"),
                "message": _sanitize_text(
                    error_message or str(task.get("error_message") or ""),
                    project_dir,
                ),
                "logs_included": bool(support_files),
            }
            if status in {"Failed", "Stopped"}
            else None
        ),
        "support_files": support_files,
    }
    atomic_write_json(working_dir / "manifest.json", manifest)

    previous_dir = final_algorithm_dir.with_name(
        f".{normalized_algorithm_id}.previous-manifest"
    )
    if previous_dir.exists():
        shutil.rmtree(previous_dir, ignore_errors=True)
    if final_algorithm_dir.exists():
        final_algorithm_dir.replace(previous_dir)
    try:
        working_dir.replace(final_algorithm_dir)
    except Exception:
        if previous_dir.exists() and not final_algorithm_dir.exists():
            previous_dir.replace(final_algorithm_dir)
        raise
    shutil.rmtree(previous_dir, ignore_errors=True)
    return final_algorithm_dir / "manifest.json"


def list_run_manifest_paths(
    project_dir: Path,
    *,
    job_id: str | None = None,
    algorithm_id: str | None = None,
) -> list[Path]:
    manifest_root = project_dir / RUN_MANIFEST_DIRNAME
    if not manifest_root.is_dir():
        return []

    selected: dict[tuple[str, str], tuple[int, Path]] = {}
    for path in manifest_root.rglob("manifest.json"):
        try:
            relative = path.relative_to(manifest_root)
        except ValueError:
            continue
        if len(relative.parts) not in {3, 4}:
            continue
        candidate_job_id, candidate_algorithm_id = relative.parts[:2]
        if candidate_algorithm_id.startswith("."):
            continue
        if job_id and candidate_job_id != str(job_id):
            continue
        if algorithm_id and candidate_algorithm_id != algorithm_id.upper():
            continue

        # Schema v2 stores manifest.json directly under the algorithm. A
        # legacy attempt-level manifest remains readable until first download
        # migrates it, but only the newest one is selected.
        is_current_layout = len(relative.parts) == 3
        priority = 2 if is_current_layout else 1
        key = (candidate_job_id, candidate_algorithm_id)
        existing = selected.get(key)
        candidate = (priority, path)
        if existing is None or (candidate[0], candidate[1].as_posix()) > (
            existing[0],
            existing[1].as_posix(),
        ):
            selected[key] = candidate
    return sorted(
        (candidate[1] for candidate in selected.values()),
        key=lambda path: path.as_posix(),
    )


def latest_run_manifest_path(
    project_dir: Path,
    algorithm_id: str,
    *,
    job_id: str | None = None,
) -> Path:
    paths = list_run_manifest_paths(
        project_dir, job_id=job_id, algorithm_id=algorithm_id
    )
    if not paths:
        raise FileNotFoundError(
            f"No run manifest found for {algorithm_id.upper()}."
        )
    return paths[-1]


def backfill_terminal_run_manifests(
    project_dir: Path,
    *,
    job_id: str | None = None,
    algorithm_id: str | None = None,
) -> list[Path]:
    """Create a best-effort manifest for results saved before schema v1 existed."""

    try:
        jobs = json.loads((project_dir / "jobs.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(jobs, dict):
        jobs = jobs.get("jobs", [])
    if not isinstance(jobs, list) or not jobs:
        return []

    selected_jobs = [
        job
        for job in jobs
        if isinstance(job, dict) and (not job_id or job.get("job_id") == job_id)
    ]
    if not job_id and selected_jobs:
        selected_jobs = [selected_jobs[-1]]

    generated: list[Path] = []
    for job in selected_jobs:
        resolved_job_id = str(job.get("job_id") or "legacy-job")
        for task in job.get("tasks", []):
            if not isinstance(task, dict):
                continue
            resolved_algorithm_id = str(task.get("algorithm_id") or "").upper()
            if not resolved_algorithm_id or (
                algorithm_id and resolved_algorithm_id != algorithm_id.upper()
            ):
                continue
            status = str(task.get("status") or "")
            if status not in {"Completed", "Failed", "Stopped"}:
                continue
            expected_manifest_path = (
                run_manifest_algorithm_dir(
                    project_dir,
                    resolved_job_id,
                    resolved_algorithm_id,
                )
                / "manifest.json"
            )
            if expected_manifest_path.is_file():
                continue

            completed_timestamp_value = task.get("completed_at_timestamp")
            try:
                completed_timestamp = float(completed_timestamp_value)
            except (TypeError, ValueError):
                completed_timestamp = time.time()
            elapsed_seconds = max(0, int(task.get("elapsed_seconds") or 0))
            try:
                started_timestamp = float(task.get("started_at_timestamp"))
            except (TypeError, ValueError):
                started_timestamp = completed_timestamp - elapsed_seconds

            result_path_value = task.get("result_path") if status == "Completed" else None
            result_path = Path(str(result_path_value)) if result_path_value else None
            if result_path and not result_path.is_absolute():
                result_path = project_dir / result_path
            result = _read_json(result_path) if result_path else {}
            artifact_path_value = result.get("result_artifact_root")
            artifact_dir = (
                Path(str(artifact_path_value)) if artifact_path_value else None
            )
            if artifact_dir and not artifact_dir.is_absolute():
                artifact_dir = project_dir / artifact_dir
            diagnostics_path_value = task.get("diagnostics_path")
            diagnostics_path = (
                Path(str(diagnostics_path_value)) if diagnostics_path_value else None
            )
            if diagnostics_path and not diagnostics_path.is_absolute():
                diagnostics_path = project_dir / diagnostics_path

            try:
                generated.append(
                    generate_run_manifest(
                        project_dir,
                        resolved_job_id,
                        resolved_algorithm_id,
                        status=status,
                        started_at_timestamp=started_timestamp,
                        completed_at_timestamp=completed_timestamp,
                        elapsed_seconds=elapsed_seconds,
                        result_path=result_path,
                        artifact_dir=artifact_dir,
                        diagnostics_path=diagnostics_path,
                        error_message=task.get("error_message"),
                        error_type=task.get("error_type") or "legacy_import",
                    )
                )
            except Exception:
                # Legacy projects may be incomplete. One unrecoverable task
                # should not prevent manifests for the other terminal tasks.
                continue
    return generated


def _project_dir_for_manifest(manifest_path: Path) -> Path:
    for parent in manifest_path.parents:
        if parent.name == RUN_MANIFEST_DIRNAME:
            return parent.parent
    raise ValueError("Run manifest is outside a GRNScope project directory.")


def _safe_archive_name(value: Any, fallback: str) -> str:
    normalized = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "-", str(value or "")).strip()
    normalized = re.sub(r"\s+", " ", normalized).strip(" .-")
    return normalized[:100] or fallback


def project_run_manifest_archive_name(project_dir: Path) -> str:
    project = _read_json(project_dir / "project.json")
    metadata = _read_json(project_dir / "metadata.json")
    project_name = (
        project.get("project_name")
        or metadata.get("project_name")
        or project_dir.name
    )
    return f"{_safe_archive_name(project_name, project_dir.name)}_run-manifests"


def _project_file(project_dir: Path, path_value: Any) -> Path | None:
    if not path_value:
        return None
    path = Path(str(path_value))
    if not path.is_absolute():
        path = project_dir / path
    try:
        resolved = path.resolve()
        resolved.relative_to(project_dir.resolve())
    except (OSError, ValueError):
        return None
    return resolved if resolved.is_file() else None


def _project_bundle_files(
    project_dir: Path,
) -> list[dict[str, Any]]:
    """Inventory original uploads and shared preprocessing outputs once per project."""

    project = _read_json(project_dir / "project.json")
    metadata = _read_json(project_dir / "metadata.json")
    files: list[dict[str, Any]] = []
    destinations: set[str] = set()

    def add_file(
        *,
        category: str,
        role: str,
        path_value: Any,
        filename: Any = None,
        relative_destination: Path | None = None,
        sanitize_metadata: bool = False,
    ) -> None:
        source = _project_file(project_dir, path_value)
        if not source:
            return
        safe_filename = _safe_archive_name(filename or source.name, source.name)
        destination = relative_destination or (
            Path("inputs") / category / role / safe_filename
        )
        destination_key = destination.as_posix()
        if destination_key in destinations:
            return
        destinations.add(destination_key)
        files.append(
            {
                "category": category,
                "role": role,
                "source": source,
                "path": destination_key,
                "original_filename": str(filename or source.name),
                "size_bytes": source.stat().st_size,
                "sha256": sha256_file(source),
                "sanitize_metadata": sanitize_metadata,
            }
        )

    add_file(
        category="original",
        role="expression",
        path_value=project.get("expression_source_path")
        or project.get("expression_path"),
        filename=metadata.get("expression_filename"),
    )
    if not project.get("pseudotime_estimated"):
        add_file(
            category="original",
            role="pseudotime",
            path_value=project.get("pseudotime_source_path")
            or project.get("pseudotime_path"),
            filename=metadata.get("pseudotime_filename"),
        )
    for role, path_key, filename_key in (
        ("ground_truth", "ground_truth_path", "ground_truth_filename"),
        ("cluster_labels", "cluster_labels_path", "cluster_labels_filename"),
        ("gene_ordering", "gene_ordering_path", "gene_ordering_filename"),
        ("tf_list", "custom_tf_list_path", "custom_tf_list_filename"),
    ):
        add_file(
            category="original",
            role=role,
            path_value=project.get(path_key),
            filename=metadata.get(filename_key) or project.get(filename_key),
        )

    preprocessed_dir = project_dir / "preprocessed"
    if preprocessed_dir.is_dir():
        for source in sorted(preprocessed_dir.rglob("*")):
            if (
                not source.is_file()
                or source.name.startswith(".")
                or ".tmp" in source.name
            ):
                continue
            relative = source.relative_to(preprocessed_dir)
            add_file(
                category="preprocessed",
                role="project_preprocessing",
                path_value=source,
                filename=source.name,
                relative_destination=Path("inputs") / "preprocessed" / relative,
                sanitize_metadata=source.suffix.lower()
                in {".json", ".yaml", ".yml", ".log", ".txt"},
            )

    preprocessed_sources = {
        item["source"].resolve()
        for item in files
        if item["category"] == "preprocessed"
    }
    original_sources = {
        item["source"].resolve()
        for item in files
        if item["category"] == "original"
    }
    effective_pseudotime = _project_file(
        project_dir,
        project.get("pseudotime_path"),
    )
    if (
        effective_pseudotime
        and effective_pseudotime.resolve() not in preprocessed_sources
        and (
            project.get("pseudotime_estimated")
            or effective_pseudotime.resolve() not in original_sources
        )
    ):
        add_file(
            category="preprocessed",
            role="pseudotime",
            path_value=effective_pseudotime,
            filename="PseudoTime.csv",
        )

    expression_source = _project_file(
        project_dir,
        project.get("expression_source_path"),
    )
    effective_expression_source = _project_file(
        project_dir,
        project.get("expression_path"),
    )
    if (
        expression_source
        and effective_expression_source
        and expression_source != effective_expression_source
        and effective_expression_source.resolve() not in preprocessed_sources
    ):
        add_file(
            category="preprocessed",
            role="expression_conversion",
            path_value=effective_expression_source,
            filename=effective_expression_source.name,
        )

    for role, path_key in (
        ("trajectory_embedding", "pseudotime_embedding_path"),
        ("trajectory_curves", "pseudotime_curves_path"),
    ):
        add_file(
            category="preprocessed",
            role=role,
            path_value=project.get(path_key),
        )
    return files


def _write_project_bundle_files(
    archive: zipfile.ZipFile,
    archive_root: Path,
    project_dir: Path,
    files: list[dict[str, Any]],
) -> dict[str, Any]:
    inventory: dict[str, Any] = {
        "checksum_algorithm": "sha256",
        "original_uploads": [],
        "preprocessed": [],
    }
    for item in files:
        source = Path(item["source"])
        destination = archive_root / str(item["path"])
        if item.get("sanitize_metadata"):
            content = _sanitize_text(
                source.read_text(encoding="utf-8", errors="replace"),
                project_dir,
            ).encode("utf-8")
            archive.writestr(destination.as_posix(), content)
            bundled_size_bytes = len(content)
            bundled_sha256 = hashlib.sha256(content).hexdigest()
        else:
            archive.write(source, destination.as_posix())
            bundled_size_bytes = item["size_bytes"]
            bundled_sha256 = item["sha256"]
        inventory_item: dict[str, Any] = {
            "role": item["role"],
            "path": str(item["path"]),
            "size_bytes": bundled_size_bytes,
            "sha256": bundled_sha256,
        }
        if item.get("sanitize_metadata"):
            inventory_item["portable_copy"] = True
        inventory[
            "original_uploads"
            if item["category"] == "original"
            else "preprocessed"
        ].append(inventory_item)
    return inventory


def _project_dataset_summary(
    project: dict[str, Any],
    metadata: dict[str, Any],
    first_manifest: dict[str, Any],
) -> dict[str, Any]:
    matrix = first_manifest.get("matrix_and_preprocessing") or {}
    genes = first_manifest.get("genes") or {}
    pseudotime = first_manifest.get("pseudotime") or {}
    project_configuration = matrix.get("project_configuration") or {}
    filter_steps = matrix.get("filter_steps") or []

    preprocessing_steps: list[str] = []
    for step in matrix.get("operations") or []:
        if step and str(step) not in preprocessing_steps:
            preprocessing_steps.append(str(step))
    for step in filter_steps:
        stage = step.get("stage") if isinstance(step, dict) else None
        if stage and str(stage) not in preprocessing_steps:
            preprocessing_steps.append(str(stage))

    cell_count = metadata.get("cell_count") or project.get("cell_count")
    if cell_count is None:
        for step in filter_steps:
            if isinstance(step, dict) and step.get("cell_count") is not None:
                cell_count = step["cell_count"]
                break

    before_filtering = genes.get("before_filtering") or {}
    after_filtering = genes.get("after_project_filtering") or {}
    summary = {
        "species": project_configuration.get("dataset_species")
        or project.get("dataset_species"),
        "matrix_state": matrix.get("output_state")
        or matrix.get("declared_input_state")
        or matrix.get("detected_input_state"),
        "cell_count": cell_count,
        "gene_count_before_filtering": before_filtering.get("count"),
        "gene_count_after_filtering": after_filtering.get("count"),
        "preprocessing_steps": preprocessing_steps,
        "pseudotime_source": pseudotime.get("source"),
    }
    return {
        key: value
        for key, value in summary.items()
        if value is not None and value != []
    }


def _project_bundle_summary(
    project_dir: Path,
    manifests: list[dict[str, Any]],
    bundled_files: dict[str, Any] | None = None,
) -> dict[str, Any]:
    project = _read_json(project_dir / "project.json")
    metadata = _read_json(project_dir / "metadata.json")
    first = manifests[0] if manifests else {}
    project_summary = {
        "name": project.get("project_name")
        or metadata.get("project_name")
        or project_dir.name,
    }
    description = project.get("project_description") or metadata.get(
        "project_description"
    )
    if description:
        project_summary["description"] = description

    algorithm_summaries = []
    for manifest in manifests:
        identity = manifest.get("identity") or {}
        runtime = manifest.get("runtime") or {}
        results = manifest.get("results") or {}
        algorithm_id = identity.get("algorithm_id")
        algorithm_summary = {
            "id": algorithm_id,
            "status": identity.get("status"),
            "runtime_seconds": runtime.get("elapsed_seconds"),
            "result_run_count": results.get("run_result_count", 0),
            "manifest": f"algorithms/{algorithm_id}/run_manifest.json",
        }
        algorithm_summaries.append(
            {
                key: value
                for key, value in algorithm_summary.items()
                if value is not None
            }
        )

    return {
        "project": project_summary,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "dataset": _project_dataset_summary(project, metadata, first),
        "files": bundled_files or {
            "checksum_algorithm": "sha256",
            "original_uploads": [],
            "preprocessed": [],
        },
        "algorithms": algorithm_summaries,
    }


def _write_run_manifest_archive(
    archive: zipfile.ZipFile,
    manifest_paths: list[Path],
    project_dir: Path,
) -> None:
    if not manifest_paths:
        raise FileNotFoundError("No run manifests found.")
    archive_root = Path(project_run_manifest_archive_name(project_dir))

    manifest_payloads: list[dict[str, Any]] = []
    selected_manifests: list[tuple[Path, dict[str, Any], str]] = []
    for manifest_path in manifest_paths:
        manifest = _read_json(manifest_path)
        algorithm_id = str(
            (manifest.get("identity") or {}).get("algorithm_id")
            or manifest_path.parent.name
        ).upper()
        manifest_payloads.append(manifest)
        selected_manifests.append((manifest_path, manifest, algorithm_id))

    project_files = _project_bundle_files(project_dir)
    readme = (
        "GRNScope project run manifests\n"
        "\n"
        "project_manifest.json is a compact index of the project, bundled files, and algorithm runs.\n"
        "inputs/original/ contains exact copies of every available user-uploaded file.\n"
        "inputs/preprocessed/ contains the shared files actually prepared for analysis.\n"
        "Each algorithms/<name>/ folder contains:\n"
        "- run_manifest.json: reproducibility metadata, checksums, parameters, and seeds\n"
        "- results/: the combined network and every individual run result\n"
        "- artifacts/ and diagnostics/: configuration, logs, warnings, and failure details\n"
    )

    bundled_files = _write_project_bundle_files(
        archive,
        archive_root,
        project_dir,
        project_files,
    )
    project_summary = _project_bundle_summary(
        project_dir,
        manifest_payloads,
        bundled_files,
    )
    archive.writestr(
        (archive_root / "README.txt").as_posix(),
        readme,
    )
    archive.writestr(
        (archive_root / "project_manifest.json").as_posix(),
        json.dumps(project_summary, indent=2),
    )
    for manifest_path, _manifest, algorithm_id in selected_manifests:
        algorithm_source_dir = manifest_path.parent
        algorithm_archive_dir = archive_root / "algorithms" / algorithm_id
        archive.write(
            manifest_path,
            (algorithm_archive_dir / "run_manifest.json").as_posix(),
        )
        for source in sorted(algorithm_source_dir.rglob("*")):
            if source.is_file():
                if source == manifest_path:
                    continue
                archive.write(
                    source,
                    (
                        algorithm_archive_dir
                        / source.relative_to(algorithm_source_dir)
                    ).as_posix(),
                )


def build_run_manifest_zip(
    manifest_paths: list[Path],
    *,
    project_dir: Path | None = None,
) -> bytes:
    if not manifest_paths:
        raise FileNotFoundError("No run manifests found.")
    resolved_project_dir = project_dir or _project_dir_for_manifest(manifest_paths[0])
    output = BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        _write_run_manifest_archive(
            archive,
            manifest_paths,
            resolved_project_dir,
        )
    return output.getvalue()


def write_run_manifest_zip(
    manifest_paths: list[Path],
    destination: Path,
    *,
    project_dir: Path | None = None,
) -> Path:
    if not manifest_paths:
        raise FileNotFoundError("No run manifests found.")
    resolved_project_dir = project_dir or _project_dir_for_manifest(manifest_paths[0])
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        _write_run_manifest_archive(
            archive,
            manifest_paths,
            resolved_project_dir,
        )
    return destination
