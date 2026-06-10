from __future__ import annotations

import csv
import json

from fastapi import APIRouter, HTTPException, Request, Response

from ..config import PROJECTS_ROOT
from .client_identity import get_or_create_client_id, require_project_owner
from ..repositories.job_repository import read_jobs_manifest
from ..services.result_service import read_algorithm_result
from ..services.gene_coordinate_service import get_gene_coordinate
from ..services.demo_service import (
    get_demo_algorithm_ids,
    get_demo_algorithm_result_path,
    get_demo_project_root,
    get_demo_ranked_edges_path,
    is_demo_project,
)



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

    compact_edges = [
        {
            key: value
            for key, value in edge.items()
            if key in CLIENT_RESULT_EDGE_FIELDS
        }
        for edge in edges
        if isinstance(edge, dict)
    ]

    compact = {
        "algorithm_id": result.get("algorithm_id"),
        "started_at": result.get("started_at"),
        "started_at_timestamp": result.get("started_at_timestamp"),
        "generated_at": result.get("generated_at"),
        "completed_at": result.get("completed_at"),
        "completed_at_timestamp": result.get("completed_at_timestamp"),
        "elapsed_seconds": result.get("elapsed_seconds"),
        "network_summary": result.get("network_summary"),
        "edge_count": result.get("edge_count", len(compact_edges)),
        "top_edges": compact_edges,
    }

    return {key: value for key, value in compact.items() if value is not None}


def attach_gene_coordinates_to_result(result: dict) -> dict:
    """Attach chromosome coordinate metadata for genes in a result payload.

    The frontend can use `gene_coordinates` to place genes by chromosome/start
    position in the Circos view. This keeps the edge payload unchanged while
    adding a lookup table keyed by gene name.
    """
    edges = (
        result.get("edges")
        or result.get("top_edges")
        or result.get("ranked_edges")
        or []
    )

    gene_names: set[str] = set()
    for edge in edges:
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
                    "started_at": task.get("started_at"),
                    "started_at_timestamp": task.get("started_at_timestamp"),
                    "completed_at": task.get("completed_at"),
                    "completed_at_timestamp": task.get("completed_at_timestamp"),
                    "elapsed_seconds": task.get("elapsed_seconds"),
                    "progress_percent": task.get("progress_percent"),
                    "progress_label": task.get("progress_label"),
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


@router.get("/api/projects/{project_id}/results/{algorithm_id}")
async def get_algorithm_result(
    project_id: str,
    algorithm_id: str,
    request: Request,
    response: Response,
):
    owner_id = get_or_create_client_id(request, response)
    if is_demo_project(project_id):
        try:
            try:
                result = read_demo_algorithm_result_from_json(algorithm_id)
            except FileNotFoundError:
                result = read_demo_algorithm_result_from_csv(algorithm_id)
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
        result = attach_gene_coordinates_to_result(
            compact_result_for_client(read_algorithm_result(project_dir, algorithm_id))
        )
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
