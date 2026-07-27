from __future__ import annotations

import csv
import json
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Request, Response

from ..config import PROJECTS_ROOT
from .client_identity import get_or_create_client_id, require_project_owner
from ..repositories.job_repository import read_jobs_manifest
from ..services.result_service import read_algorithm_result
from ..services.beeline_service import compute_repeat_run_spearman_from_paths
from ..services.gene_coordinate_service import get_gene_coordinate
from ..services.demo_service import (
    get_demo_algorithm_ids,
    get_demo_algorithm_result_path,
    get_demo_project_root,
    get_demo_ranked_edges_path,
    is_demo_project,
)
from ..services.visualization_context_service import build_visualization_context



router = APIRouter()

CLIENT_RESULT_EDGE_FIELDS = {
    "rank",
    "source",
    "target",
    "score",
    "confidence",
    "stability",
    "mean_percentile",
    "meanPercentile",
    "mean_raw_score",
    "selected_runs",
    "observed_runs",
    "run_count",
    "normalized_score",
    "weight",
    "edge_weight",
    "algorithm_id",
}


@lru_cache(maxsize=128)
def cached_repeat_run_stability(
    ranked_edge_paths: tuple[tuple[str, str], ...],
) -> dict:
    return compute_repeat_run_spearman_from_paths(dict(ranked_edge_paths))


@router.get("/api/projects/{project_id}/visualization-context")
async def get_visualization_context(
    project_id: str,
    request: Request,
    response: Response,
    genes: str | None = None,
):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        project_dir = get_demo_project_root()
    else:
        project_dir = PROJECTS_ROOT / project_id
        require_project_owner(project_dir, owner_id)

    requested_genes = [
        value.strip()
        for value in str(genes or "").split(",")
        if value.strip()
    ]
    try:
        context = build_visualization_context(
            project_dir=project_dir,
            requested_genes=requested_genes,
        )
        return {
            "ok": True,
            "project_id": project_id,
            **context,
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def compact_result_for_client(result: dict) -> dict:
    """Return only fields needed by the project-detail UI.

    Older saved result manifests may keep detailed per-run debugging fields
    such as run_ranks and file paths. Those are useful on disk, but expensive
    to send to the browser and are not used by the visualization/table views.
    """
    edges = (
        result.get("top_edges")
        or result.get("edges")
        or result.get("ranked_edges")
        or []
    )

    def compact_edges_for_client(edges: list) -> list[dict]:
        return [
            {
                key: value
                for key, value in edge.items()
                if key in CLIENT_RESULT_EDGE_FIELDS
            }
            for edge in edges
            if isinstance(edge, dict)
        ]

    compact_edges = compact_edges_for_client(edges)

    def compact_confidence_summary(
        summary: object,
        run_paths: object = None,
    ) -> dict | None:
        if not isinstance(summary, dict):
            return None

        repeat_run_stability = summary.get("repeat_run_stability")
        if not isinstance(repeat_run_stability, dict) and isinstance(run_paths, dict):
            normalized_paths = tuple(
                sorted(
                    (str(run_id), str(path))
                    for run_id, path in run_paths.items()
                    if path
                )
            )
            if normalized_paths:
                repeat_run_stability = cached_repeat_run_stability(normalized_paths)

        early_stopping = summary.get("early_stopping")
        compact_early_stopping = None
        if isinstance(early_stopping, dict):
            compact_checks = []
            for check in early_stopping.get("checks", []):
                if not isinstance(check, dict):
                    continue
                compact_checks.append(
                    {
                        key: check.get(key)
                        for key in (
                            "method",
                            "run_count",
                            "stop_rho",
                            "compared_edges",
                            "rho",
                            "stop_early",
                            "status",
                            "message",
                        )
                        if check.get(key) is not None
                    }
                )
            compact_early_stopping = {
                key: early_stopping.get(key)
                for key in (
                    "enabled",
                    "method",
                    "stop_rho",
                    "stop_streak",
                    "min_runs",
                    "stopped_early",
                    "stopped_after_runs",
                    "streak",
                )
                if early_stopping.get(key) is not None
            }
            compact_early_stopping["checks"] = compact_checks

        compact_repeat_run_stability = None
        if isinstance(repeat_run_stability, dict):
            compact_repeat_run_stability = {
                key: repeat_run_stability.get(key)
                for key in (
                    "method",
                    "edge_universe",
                    "run_count",
                    "usable_run_count",
                    "pair_count",
                    "median_rho",
                    "mad_rho",
                    "minimum_rho",
                    "maximum_rho",
                    "status",
                )
                if repeat_run_stability.get(key) is not None
            }

        compact_summary = {
            key: summary.get(key)
            for key in (
                "bootstrap_runs",
                "planned_bootstrap_runs",
                "min_runs",
                "stop_rho",
                "stop_streak",
                "early_stopping_enabled",
                "subsample_fraction",
                "stability_top_k",
            )
            if summary.get(key) is not None
        }
        if compact_early_stopping is not None:
            compact_summary["early_stopping"] = compact_early_stopping
        if compact_repeat_run_stability is not None:
            compact_summary["repeat_run_stability"] = compact_repeat_run_stability
        return compact_summary

    compact_scopes = {}
    scopes = result.get("scopes")
    if isinstance(scopes, dict):
        for scope_id, scope_payload in scopes.items():
            if not isinstance(scope_payload, dict):
                continue
            scope_edges = scope_payload.get("top_edges") or []
            compact_scopes[str(scope_id)] = {
                "scope_id": scope_payload.get("scope_id") or scope_id,
                "scope_label": scope_payload.get("scope_label") or scope_id,
                "scope_type": scope_payload.get("scope_type"),
                "cell_count": scope_payload.get("cell_count"),
                "status": scope_payload.get("status"),
                "skip_reason": scope_payload.get("skip_reason"),
                "algorithm_preprocessing": scope_payload.get(
                    "algorithm_preprocessing"
                ),
                "network_summary": scope_payload.get("network_summary"),
                "confidence_summary": compact_confidence_summary(
                    scope_payload.get("confidence_summary"),
                    scope_payload.get("run_ranked_edges_paths"),
                ),
                "top_edges": compact_edges_for_client(scope_edges),
            }

    compact = {
        "algorithm_id": result.get("algorithm_id"),
        "started_at": result.get("started_at"),
        "started_at_timestamp": result.get("started_at_timestamp"),
        "generated_at": result.get("generated_at"),
        "completed_at": result.get("completed_at"),
        "completed_at_timestamp": result.get("completed_at_timestamp"),
        "elapsed_seconds": result.get("elapsed_seconds"),
        "algorithm_preprocessing": result.get("algorithm_preprocessing"),
        "network_summary": result.get("network_summary"),
        "edge_count": result.get("edge_count", len(compact_edges)),
        "confidence_summary": compact_confidence_summary(
            result.get("confidence_summary"),
            result.get("run_ranked_edges_paths"),
        ),
        "top_edges": compact_edges,
        "scope_order": result.get("scope_order"),
        "scopes": compact_scopes or None,
    }

    return {key: value for key, value in compact.items() if value is not None}


def limit_result_edges(result: dict, limit: int) -> dict:
    """Trim ``top_edges`` (and each scope's ``top_edges``) to the strongest
    ``limit`` edges by rank, leaving ``edge_count`` as the true total so the
    client still knows the full network is larger. Used for the fast first-paint
    load; the client fetches the untrimmed payload in the background afterwards.
    """
    if limit <= 0:
        return result

    def strongest(edges: list) -> list:
        def rank_key(edge: dict):
            rank = edge.get("rank")
            return rank if isinstance(rank, (int, float)) else float("inf")

        return sorted(
            [edge for edge in edges if isinstance(edge, dict)],
            key=rank_key,
        )[:limit]

    trimmed = dict(result)
    if isinstance(result.get("top_edges"), list):
        trimmed["top_edges"] = strongest(result["top_edges"])

    scopes = result.get("scopes")
    if isinstance(scopes, dict):
        trimmed_scopes = {}
        for scope_id, scope_payload in scopes.items():
            if isinstance(scope_payload, dict) and isinstance(
                scope_payload.get("top_edges"), list
            ):
                trimmed_scopes[scope_id] = {
                    **scope_payload,
                    "top_edges": strongest(scope_payload["top_edges"]),
                }
            else:
                trimmed_scopes[scope_id] = scope_payload
        trimmed["scopes"] = trimmed_scopes

    return trimmed


def iter_result_edges(result: dict):
    edges = (
        result.get("edges")
        or result.get("top_edges")
        or result.get("ranked_edges")
        or []
    )

    for edge in edges:
        if isinstance(edge, dict):
            yield edge

    scopes = result.get("scopes")
    if not isinstance(scopes, dict):
        return
    for scope_payload in scopes.values():
        if not isinstance(scope_payload, dict):
            continue
        for edge in scope_payload.get("top_edges") or []:
            if isinstance(edge, dict):
                yield edge


def attach_gene_coordinates_to_result(result: dict) -> dict:
    """Attach chromosome coordinate metadata for genes in a result payload.

    The frontend can use `gene_coordinates` to place genes by chromosome/start
    position in the Circos view. This keeps the edge payload unchanged while
    adding a lookup table keyed by gene name.
    """
    gene_names: set[str] = set()
    for edge in iter_result_edges(result):
        source = str(edge.get("source", "")).strip()
        target = str(edge.get("target", "")).strip()

        if source:
            gene_names.add(source)
        if target:
            gene_names.add(target)

    gene_coordinates = {}
    for gene_name in sorted(gene_names):
        coordinate = get_gene_coordinate(gene_name)
        if coordinate:
            gene_coordinates[gene_name] = coordinate

    return {
        **result,
        "gene_coordinates": gene_coordinates,
        "gene_coordinate_count": len(gene_coordinates),
    }


def read_demo_algorithm_result_from_json(algorithm_id: str) -> dict:
    result_path = get_demo_algorithm_result_path(algorithm_id)
    result = json.loads(result_path.read_text(encoding="utf-8"))
    result["project_id"] = "demo"
    result["job_id"] = "demo"
    result["algorithm_id"] = algorithm_id.upper()
    result["source_file"] = str(result_path)

    try:
        result["ranked_edges_path"] = str(get_demo_ranked_edges_path(algorithm_id))
    except FileNotFoundError:
        result.pop("ranked_edges_path", None)

    return attach_gene_coordinates_to_result(compact_result_for_client(result))


def read_demo_algorithm_result_from_csv(algorithm_id: str) -> dict:
    ranked_edges_path = get_demo_ranked_edges_path(algorithm_id)

    with ranked_edges_path.open("r", encoding="utf-8", newline="") as csv_file:
        sample = csv_file.read(4096)
        csv_file.seek(0)

        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
        except csv.Error:
            dialect = csv.excel_tab if "\t" in sample and sample.count("\t") >= sample.count(",") else csv.excel

        reader = csv.DictReader(csv_file, dialect=dialect)
        fieldnames = reader.fieldnames or []

        source_field = next(
            (
                field
                for field in fieldnames
                if field.lower().strip() in {"gene1", "source", "source gene", "source_gene"}
            ),
            fieldnames[0] if len(fieldnames) >= 1 else None,
        )
        target_field = next(
            (
                field
                for field in fieldnames
                if field.lower().strip() in {"gene2", "target", "target gene", "target_gene"}
            ),
            fieldnames[1] if len(fieldnames) >= 2 else None,
        )
        weight_field = next(
            (
                field
                for field in fieldnames
                if field.lower().strip() in {"edgeweight", "edge weight", "weight", "score", "confidence"}
            ),
            fieldnames[2] if len(fieldnames) >= 3 else None,
        )

        if not source_field or not target_field:
            raise ValueError(f"Demo ranked edges CSV has invalid columns: {fieldnames}")

        edges = []
        for rank, row in enumerate(reader, start=1):
            source = str(row.get(source_field, "")).strip()
            target = str(row.get(target_field, "")).strip()

            if not source or not target:
                continue

            raw_weight = row.get(weight_field, "") if weight_field else ""
            try:
                weight = float(raw_weight)
            except (TypeError, ValueError):
                weight = 0.0

            edges.append(
                {
                    "rank": rank,
                    "source": source,
                    "target": target,
                    "weight": weight,
                    "score": weight,
                    "edge_weight": weight,
                    "algorithm_id": algorithm_id.upper(),
                }
            )

    return attach_gene_coordinates_to_result(
        compact_result_for_client(
            {
                "algorithm_id": algorithm_id.upper(),
                "edge_count": len(edges),
                "edges": edges,
                "top_edges": edges,
                "ranked_edges": edges,
                "source_file": str(ranked_edges_path),
            }
        )
    )


@router.get("/api/projects/{project_id}/results")
async def get_project_results(project_id: str, request: Request, response: Response):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        results = []
        for algorithm_id in get_demo_algorithm_ids():
            try:
                result_path = get_demo_algorithm_result_path(algorithm_id)
                status = "Completed"
            except FileNotFoundError:
                try:
                    result_path = get_demo_ranked_edges_path(algorithm_id)
                    status = "Completed"
                except FileNotFoundError:
                    status = "Failed"
                    result_path = None

            results.append(
                {
                    "algorithm_id": algorithm_id,
                    "status": status,
                    "result_path": str(result_path) if result_path else None,
                    "started_at": None,
                    "started_at_timestamp": None,
                    "completed_at": "demo",
                    "completed_at_timestamp": None,
                    "elapsed_seconds": 0,
                    "progress_percent": 100 if status == "Completed" else 0,
                    "progress_label": status,
                }
            )

        return {
            "ok": True,
            "project_id": project_id,
            "job_id": "demo",
            "results": results,
            "is_demo": True,
            "read_only": True,
        }

    project_dir = PROJECTS_ROOT / project_id

    require_project_owner(project_dir, owner_id)

    try:
        jobs_manifest = read_jobs_manifest(project_dir)
        latest_job = jobs_manifest[-1] if jobs_manifest else None

        if not latest_job:
            return {
                "ok": True,
                "project_id": project_id,
                "results": [],
            }

        results = []
        for task in latest_job.get("tasks", []):
            results.append(
                {
                    "algorithm_id": task.get("algorithm_id"),
                    "status": task.get("status"),
                    "result_path": task.get("result_path"),
                    "error_message": task.get("error_message"),
                    "error_type": task.get("error_type"),
                    "started_at": task.get("started_at"),
                    "started_at_timestamp": task.get("started_at_timestamp"),
                    "completed_at": task.get("completed_at"),
                    "completed_at_timestamp": task.get("completed_at_timestamp"),
                    "elapsed_seconds": task.get("elapsed_seconds"),
                    "progress_percent": task.get("progress_percent"),
                    "progress_label": task.get("progress_label"),
                    "estimated_remaining_seconds": task.get("estimated_remaining_seconds"),
                    "estimated_remaining_min_seconds": task.get(
                        "estimated_remaining_min_seconds"
                    ),
                    "estimated_remaining_max_seconds": task.get(
                        "estimated_remaining_max_seconds"
                    ),
                    "run_metadata": task.get("run_metadata"),
                }
            )

        return {
            "ok": True,
            "project_id": project_id,
            "job_id": latest_job.get("job_id"),
            "results": results,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/projects/{project_id}/gene-selection-audit")
async def get_gene_selection_audit(
    project_id: str,
    request: Request,
    response: Response,
    stage: str | None = None,
    algorithm_id: str | None = None,
):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        raise HTTPException(
            status_code=404,
            detail="Gene-selection details are unavailable for the demo project.",
        )

    project_dir = PROJECTS_ROOT / project_id
    require_project_owner(project_dir, owner_id)

    normalized_algorithm_id = str(algorithm_id or "").strip().upper()
    normalized_stage = str(stage or "").strip().lower()
    if bool(normalized_algorithm_id) == bool(normalized_stage):
        raise HTTPException(
            status_code=400,
            detail="Choose either a preprocessing stage or an algorithm.",
        )

    if normalized_algorithm_id:
        audit_path = (
            project_dir
            / "results"
            / normalized_algorithm_id
            / "gene_selection_audit.json"
        )
    else:
        if normalized_stage not in {"detection", "trajectory", "variance"}:
            raise HTTPException(
                status_code=400,
                detail="Unknown preprocessing stage.",
            )
        audit_path = (
            project_dir
            / "preprocessed"
            / "gene_selection_audits"
            / f"{normalized_stage}.json"
        )

    try:
        audit = json.loads(audit_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=404,
            detail="Gene-selection details are not available for this result.",
        ) from exc

    if not isinstance(audit, dict):
        raise HTTPException(
            status_code=404,
            detail="Gene-selection details are not available for this result.",
        )
    if normalized_stage:
        try:
            preprocessing_manifest = json.loads(
                (
                    project_dir / "preprocessed" / "manifest.json"
                ).read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError) as exc:
            raise HTTPException(
                status_code=404,
                detail="Gene-selection details are not available for this result.",
            ) from exc
        if (
            audit.get("preprocessing_signature")
            != preprocessing_manifest.get("signature")
        ):
            raise HTTPException(
                status_code=404,
                detail="Gene-selection details are out of date for this result.",
            )

    return {
        "ok": True,
        "project_id": project_id,
        "stage": audit.get("stage"),
        "algorithm_id": audit.get("algorithm_id"),
        "input_gene_count": audit.get("input_gene_count"),
        "retained_gene_count": audit.get("retained_gene_count"),
        "removed_gene_count": audit.get("removed_gene_count"),
        "retained_gene_names": audit.get("retained_gene_names") or [],
        "removed_gene_names": audit.get("removed_gene_names") or [],
    }


@router.get("/api/projects/{project_id}/results/{algorithm_id}")
async def get_algorithm_result(
    project_id: str,
    algorithm_id: str,
    request: Request,
    response: Response,
    limit: int | None = None,
):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        try:
            try:
                result = read_demo_algorithm_result_from_json(algorithm_id)
            except FileNotFoundError:
                result = read_demo_algorithm_result_from_csv(algorithm_id)
            if limit and limit > 0:
                result = limit_result_edges(result, limit)
            return {
                "ok": True,
                "project_id": project_id,
                "algorithm_id": algorithm_id,
                "result": result,
                "is_demo": True,
                "read_only": True,
            }
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    project_dir = PROJECTS_ROOT / project_id

    require_project_owner(project_dir, owner_id)

    try:
        compact = compact_result_for_client(read_algorithm_result(project_dir, algorithm_id))
        if limit and limit > 0:
            compact = limit_result_edges(compact, limit)
        result = attach_gene_coordinates_to_result(compact)
        return {
            "ok": True,
            "project_id": project_id,
            "algorithm_id": algorithm_id,
            "result": result,
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
