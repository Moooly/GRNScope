"""Portable project inputs and configuration, selected independently of results."""

from __future__ import annotations

import hashlib
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..algorithm_registry import resolve_algorithm_parameters
from ..repositories.project_repository import read_project_manifest
from .demo_service import get_demo_project_root, load_demo_manifest
from .run_manifest_service import _project_file, _safe_archive_name, _sanitize_value


class ProjectDataNotReady(ValueError):
    pass


def _read_optional(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def load_project_data(project_dir: Path, *, demo: bool = False) -> dict:
    if demo:
        source = load_demo_manifest()
        dataset = source.get("dataset", {})
        project_dir = get_demo_project_root()
        project = {
            "project_id": "demo",
            "project_name": source.get("name", "Demo Project"),
            "project_description": source.get("description"),
            "selected_algorithms": source.get("algorithms", []),
            "preprocessing": source.get("preprocessing", {}),
            "preprocessing_result": source.get("preprocessing_result", {}),
            "preprocessed_expression_path": source.get("preprocessed_expression_path"),
            "pseudotime_estimated": source.get("pseudotime_source") == "estimated",
            "pseudotime_embedding_path": source.get("pseudotime_embedding_path"),
            "pseudotime_curves_path": source.get("pseudotime_curves_path"),
            "algorithm_parameters": source.get("algorithm_parameters", {}),
            "preprocessing_status": "completed",
        }
        for role, key in (
            ("expression", "expression_file"),
            ("pseudotime", "pseudotime_file"),
            ("ground_truth", "ground_truth_file"),
        ):
            if dataset.get(key):
                project[f"{role}_path"] = str(
                    project_dir / "inputs" / Path(dataset[key]).name
                )
                project[f"{role}_filename"] = Path(dataset[key]).name
        metadata = dataset
        job = {"resolved_algorithm_parameters": source.get("algorithm_parameters", {})}
    else:
        project = read_project_manifest(project_dir)
        metadata = _read_optional(project_dir / "metadata.json", {})
        jobs = _read_optional(project_dir / "jobs.json", [])
        if isinstance(jobs, dict):
            jobs = jobs.get("jobs", [])
        job = next(
            (
                item
                for item in reversed(jobs)
                if item.get("job_id") == project.get("latest_job_id")
            ),
            jobs[-1] if jobs else {},
        )

    preparation = (
        metadata.get("preprocessing_result")
        or project.get("preprocessing_result")
        or _read_optional(project_dir / "preprocessed" / "manifest.json", {})
    )
    status = str(
        project.get("preprocessing_status")
        or metadata.get("preprocessing_status")
        or preparation.get("status")
        or ""
    ).lower()
    estimation = _read_optional(project_dir / "pseudotime_estimation.json", {})
    estimation_status = str(estimation.get("status", "")).lower()
    preparing = status in {
        "pending",
        "running",
        "queued",
        "waiting_for_upload",
        "preparing",
    } or estimation_status in {"running", "queued", "pending"}
    files: list[dict] = []
    source_paths: dict[Path, str] = {}
    destinations: set[str] = set()

    def add(
        category: str,
        role: str,
        path_value: Any,
        filename: str | None = None,
        *,
        json_copy: bool = False,
    ) -> None:
        path = _project_file(project_dir, path_value)
        if path is None:
            return
        if path in source_paths:
            if category == "prepared":
                next(item for item in files if item["source"] == path).setdefault(
                    "prepared_role", role
                )
            return
        name = _safe_archive_name(filename or path.name, path.name)
        destination = f"{category}_inputs/{role}/{name}"
        if destination in destinations:
            raise ValueError("Two input files have the same archive name.")
        destinations.add(destination)
        source_paths[path] = destination
        content = None
        if json_copy:
            content = json.dumps(
                _sanitize_value(
                    json.loads(path.read_text(encoding="utf-8")), project_dir
                ),
                indent=2,
            ).encode()
        files.append(
            {
                "category": category,
                "role": role,
                "source": path,
                "path": destination,
                "size_bytes": (
                    len(content) if content is not None else path.stat().st_size
                ),
                "content": content,
            }
        )

    add(
        "original",
        "expression",
        project.get("expression_source_path") or project.get("expression_path"),
        metadata.get("expression_filename") or project.get("expression_filename"),
    )
    if not project.get("pseudotime_estimated"):
        add(
            "original",
            "pseudotime",
            project.get("pseudotime_source_path") or project.get("pseudotime_path"),
            metadata.get("pseudotime_filename") or project.get("pseudotime_filename"),
        )
    for role, path_key, name_key in (
        ("ground_truth", "ground_truth_path", "ground_truth_filename"),
        ("cluster_labels", "cluster_labels_path", "cluster_labels_filename"),
        ("gene_ordering", "gene_ordering_path", "gene_ordering_filename"),
        ("tf_list", "custom_tf_list_path", "custom_tf_list_filename"),
    ):
        add(
            "original",
            role,
            project.get(path_key),
            metadata.get(name_key) or project.get(name_key),
        )

    prepared_expression = (
        project.get("preprocessed_expression_path")
        or preparation.get("preprocessed_expression_path")
        or project_dir / "preprocessed" / "ExpressionData.csv"
    )
    config = project.get("preprocessing") or metadata.get("preprocessing") or {}
    if (
        not _project_file(project_dir, prepared_expression)
        and config.get("matrix_state") == "log_normalized"
        and not config.get("enabled_stages")
    ):
        prepared_expression = project.get("expression_path")
    if not preparing and status not in {"failed", "stopped"}:
        add("prepared", "expression", prepared_expression)
        if project.get("expression_source_path"):
            add("prepared", "expression_conversion", project.get("expression_path"))
        if estimation_status not in {
            "running",
            "queued",
            "pending",
            "failed",
            "stopped",
        }:
            add("prepared", "pseudotime", project.get("pseudotime_path"))
            add(
                "prepared",
                "trajectory_embedding",
                project.get("pseudotime_embedding_path"),
            )
            add("prepared", "trajectory_curves", project.get("pseudotime_curves_path"))
        add(
            "prepared",
            "gene_ordering",
            (preparation.get("generated_gene_ordering") or {}).get("path"),
        )
        for audit in sorted(
            (project_dir / "preprocessed" / "gene_selection_audits").glob("*.json")
        ):
            add("prepared", "gene_filtering", audit, json_copy=True)

    prepared_status = (
        "preparing"
        if preparing
        else (
            "failed"
            if status == "failed"
            else (
                "available"
                if any(
                    item["category"] == "prepared" or item.get("prepared_role")
                    for item in files
                )
                else "unavailable"
            )
        )
    )
    return {
        "project_dir": project_dir,
        "project": project,
        "metadata": metadata,
        "job": job,
        "preparation": preparation,
        "preparation_status": status or "unknown",
        "prepared_status": prepared_status,
        "files": files,
        "source_paths": source_paths,
        "prepared_expression": _project_file(project_dir, prepared_expression),
    }


def project_data_inventory(snapshot: dict) -> dict:
    groups = {}
    for category in ("original", "prepared"):
        selected = [
            item
            for item in snapshot["files"]
            if item["category"] == category
            or (category == "prepared" and item.get("prepared_role"))
        ]
        groups[category] = {
            "file_count": len(selected),
            "size_bytes": sum(item["size_bytes"] for item in selected),
            "available": bool(selected),
        }
    groups["prepared"]["status"] = snapshot["prepared_status"]
    return {"filename": project_data_name(snapshot) + ".zip", "groups": groups}


def project_data_name(snapshot: dict) -> str:
    project = snapshot["project"]
    return (
        _safe_archive_name(
            project.get("project_name") or snapshot["project_dir"].name, "Project"
        )[:100]
        + "_data"
    )


def write_project_data_zip(
    snapshot: dict, destination: Path, *, original: bool, prepared: bool, manifest: bool
) -> None:
    if not (original or prepared or manifest):
        raise ValueError("Select at least one part of the project data package.")
    if prepared and snapshot["prepared_status"] == "preparing":
        raise ProjectDataNotReady(
            "Prepared inputs are still being prepared. Download original inputs and the manifest, or try again later."
        )
    files = []
    for item in snapshot["files"]:
        if (
            item["category"] == "original"
            and not original
            and prepared
            and item.get("prepared_role")
        ):
            files.append(
                {
                    **item,
                    "category": "prepared",
                    "role": item["prepared_role"],
                    "path": f"prepared_inputs/{item['prepared_role']}/{Path(item['path']).name}",
                }
            )
        elif (item["category"] == "original" and original) or (
            item["category"] == "prepared" and prepared
        ):
            files.append(item)
    if not files and not manifest:
        raise ValueError("No files are available for this selection.")
    root = project_data_name(snapshot)
    inventory = []
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for item in files:
            digest = hashlib.sha256()
            size = 0
            source = item["source"]
            before = source.stat()
            # Resolve again before opening to reject replaced symlinks.
            if _project_file(snapshot["project_dir"], source) != source:
                raise ProjectDataNotReady(
                    "Input files changed during export. Please try again."
                )
            with archive.open(
                f"{root}/{item['path']}", "w", force_zip64=True
            ) as output:
                if item["content"] is not None:
                    output.write(item["content"])
                    digest.update(item["content"])
                    size = len(item["content"])
                else:
                    with source.open("rb") as handle:
                        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                            output.write(chunk)
                            digest.update(chunk)
                            size += len(chunk)
            after = source.stat()
            if (before.st_size, before.st_mtime_ns, before.st_ino) != (
                after.st_size,
                after.st_mtime_ns,
                after.st_ino,
            ):
                raise ProjectDataNotReady(
                    "Input files changed during export. Please try again."
                )
            inventory.append(
                {
                    "category": item["category"],
                    "role": item["role"],
                    "path": item["path"],
                    "size_bytes": size,
                    "sha256": digest.hexdigest(),
                }
            )
        if manifest:
            project, metadata, job = (
                snapshot["project"],
                snapshot["metadata"],
                snapshot["job"],
            )
            config = metadata.get("preprocessing") or project.get("preprocessing") or {}
            resolved = job.get("resolved_algorithm_parameters") or {}
            overrides = (
                job.get("algorithm_parameter_overrides")
                or job.get("algorithm_parameters")
                or project.get("algorithm_parameters")
                or {}
            )
            algorithms = []
            for algorithm_id in project.get("selected_algorithms") or [
                task["algorithm_id"] for task in job.get("tasks", [])
            ]:
                parameters = resolved.get(algorithm_id)
                if parameters is None:
                    try:
                        parameters = resolve_algorithm_parameters(
                            algorithm_id, overrides.get(algorithm_id) or {}
                        )
                    except (KeyError, ValueError):
                        parameters = overrides.get(algorithm_id) or {}
                algorithms.append({"id": algorithm_id, "parameters": parameters})
            preparation = snapshot["preparation"]
            expression_path = snapshot["prepared_expression"]
            expression_reference = next(
                (item["path"] for item in files if item["source"] == expression_path),
                None,
            )
            payload = {
                "schema_version": "1.0",
                "project": {
                    "id": project.get("project_id") or snapshot["project_dir"].name,
                    "name": project.get("project_name"),
                    "description": project.get("project_description"),
                    "created_at": project.get("created_at"),
                },
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "selection": {"original_inputs": original, "prepared_inputs": prepared},
                "dataset": {
                    "species": config.get("dataset_species")
                    or project.get("dataset_species"),
                    "declared_matrix_state": config.get("matrix_state"),
                    "detected_matrix_state": (
                        config.get("matrix_state_selection") or {}
                    )
                    .get("server_detection", {})
                    .get("detected_state")
                    or project.get("detected_matrix_state")
                    or metadata.get("detected_matrix_state"),
                    "matrix_source": project.get("expression_matrix_layer")
                    or metadata.get("expression_matrix_layer"),
                    "cell_count": metadata.get("cell_count"),
                    "genes_before_preparation": metadata.get("gene_count"),
                    "genes_after_preparation": (
                        preparation.get("gene_count")
                        if preparation.get("gene_count") is not None
                        else (
                            metadata.get("gene_count")
                            if snapshot["prepared_status"] == "available"
                            and not config.get("enabled_stages")
                            else None
                        )
                    ),
                    "prepared_expression": (
                        expression_reference
                        if any(
                            item["path"] == expression_reference for item in inventory
                        )
                        else None
                    ),
                },
                "preparation": {
                    "status": snapshot["preparation_status"],
                    "configuration": config,
                    "transformation": preparation.get("transformation"),
                    "gene_selection": preparation.get("gene_selection", []),
                },
                "analysis_configuration": {
                    key: project.get(key)
                    for key in (
                        "confidence_run_mode",
                        "confidence_bootstrap_runs",
                        "confidence_evidence_threshold",
                        "ranked_edges_per_target_limit",
                        "celloracle",
                    )
                    if key in project
                },
                "pseudotime_preparation_status": str(
                    _read_optional(
                        snapshot["project_dir"] / "pseudotime_estimation.json", {}
                    ).get("status", "")
                )
                or None,
                "algorithms": algorithms,
                "checksum_algorithm": "sha256",
                "files": inventory,
            }
            archive.writestr(
                f"{root}/project_manifest.json",
                json.dumps(_sanitize_value(payload, snapshot["project_dir"]), indent=2),
            )
        archive.writestr(
            f"{root}/README.txt",
            "GRNScope project data\n\noriginal_inputs/ preserves uploaded filenames and file contents.\nprepared_inputs/ contains available prepared matrices, pseudotime, trajectory inputs and gene-filtering records.\nproject_manifest.json records the selected files, checksums, project configuration and preparation state when selected.\nCheck dataset.prepared_expression in the manifest for the shared expression matrix. When the original file is used directly, it is referenced in original_inputs/ instead of duplicated.\nOptional inputs appear only when available. File checksums describe the exact bytes in this ZIP.\n",
        )
