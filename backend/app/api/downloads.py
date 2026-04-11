
from __future__ import annotations
from datetime import datetime, timezone

import json
import csv
from pathlib import Path
from io import StringIO

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response

from ..config import ALGORITHM_IMAGE_MAP, PROJECTS_ROOT

router = APIRouter()


@router.get("/api/projects/{project_id}/download/expression")
async def download_expression_file(project_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    metadata_path = project_dir / "metadata.json"
    project_manifest_path = project_dir / "project.json"

    if not metadata_path.exists() or not project_manifest_path.exists():
        raise HTTPException(status_code=404, detail="Project metadata not found.")

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        project_manifest = json.loads(project_manifest_path.read_text(encoding="utf-8"))

        expression_path = project_manifest.get("expression_path")
        expression_filename = metadata.get("expression_filename") or "dataset.csv"

        if not expression_path:
            raise HTTPException(status_code=404, detail="Expression file path not found.")

        file_path = Path(expression_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Expression file not found.")

        return FileResponse(
            path=file_path,
            filename=expression_filename,
            media_type="text/csv",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/projects/{project_id}/download/pseudotime")
async def download_pseudotime_file(project_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    metadata_path = project_dir / "metadata.json"
    project_manifest_path = project_dir / "project.json"

    if not metadata_path.exists() or not project_manifest_path.exists():
        raise HTTPException(status_code=404, detail="Project metadata not found.")

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        project_manifest = json.loads(project_manifest_path.read_text(encoding="utf-8"))

        pseudotime_path = project_manifest.get("pseudotime_path")
        pseudotime_filename = metadata.get("pseudotime_filename") or "pseudotime.csv"

        if not pseudotime_path:
            raise HTTPException(status_code=404, detail="Pseudotime file path not found.")

        file_path = Path(pseudotime_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Pseudotime file not found.")

        return FileResponse(
            path=file_path,
            filename=pseudotime_filename,
            media_type="text/csv",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/projects/{project_id}/download/result/{algorithm_id}")
async def download_algorithm_result_file(project_id: str, algorithm_id: str):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    jobs_path = project_dir / "jobs.json"

    if not jobs_path.exists():
        raise HTTPException(status_code=404, detail="Jobs manifest not found.")

    try:
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))

        if not isinstance(jobs, list) or not jobs:
            raise HTTPException(status_code=404, detail="No jobs found for project.")

        latest_job = jobs[-1]
        tasks = latest_job.get("tasks", []) if isinstance(latest_job, dict) else []

        task = next(
            (
                item
                for item in tasks
                if isinstance(item, dict) and item.get("algorithm_id") == algorithm_id
            ),
            None,
        )

        if not task:
            raise HTTPException(status_code=404, detail="Algorithm result not found.")

        if task.get("status") != "Completed":
            raise HTTPException(
                status_code=400,
                detail="Algorithm result is not ready for download.",
            )

        result_manifest_path_value = task.get("result_path")
        if not result_manifest_path_value:
            raise HTTPException(status_code=404, detail="Result manifest path not found.")

        result_manifest_path = Path(result_manifest_path_value)
        if not result_manifest_path.is_absolute():
            result_manifest_path = project_dir / result_manifest_path

        result_manifest_path = result_manifest_path.resolve()
        project_root = project_dir.resolve()

        try:
            result_manifest_path.relative_to(project_root)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid result manifest path.") from exc

        if not result_manifest_path.exists() or not result_manifest_path.is_file():
            raise HTTPException(status_code=404, detail="Result manifest not found.")

        result_payload = json.loads(result_manifest_path.read_text(encoding="utf-8"))
        ranked_edges_path_value = result_payload.get("ranked_edges_path")

        if not ranked_edges_path_value:
            raise HTTPException(status_code=404, detail="Ranked edges file path not found.")

        file_path = Path(ranked_edges_path_value)
        if not file_path.is_absolute():
            file_path = project_dir / file_path

        file_path = file_path.resolve()

        try:
            file_path.relative_to(project_root)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid ranked edges file path.") from exc

        if not file_path.exists() or not file_path.is_file():
            raise HTTPException(status_code=404, detail="Ranked edges file not found.")

        download_filename = f"{algorithm_id}-raw-ranked-edges.csv"

        csv_text = file_path.read_text(encoding="utf-8")
        input_buffer = StringIO(csv_text)

        sample = csv_text[:4096]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
        except csv.Error:
            if "\t" in sample and sample.count("\t") >= sample.count(","):
                dialect = csv.excel_tab
            else:
                dialect = csv.excel

        reader = csv.reader(input_buffer, dialect=dialect)
        rows = list(reader)

        if not rows:
            raise HTTPException(status_code=404, detail="Ranked edges CSV is empty.")

        original_header = rows[0]
        normalized_header = list(original_header)
        if len(normalized_header) >= 1:
            normalized_header[0] = "Source Gene"
        if len(normalized_header) >= 2:
            normalized_header[1] = "Target Gene"
        data_rows = rows[1:]

        output_buffer = StringIO()
        writer = csv.writer(
            output_buffer,
            delimiter=",",
            quotechar='"',
            lineterminator="\n",
        )
        writer.writerow(["Rank", *normalized_header])

        for rank, row in enumerate(data_rows, start=1):
            writer.writerow([rank, *row])

        return Response(
            content=output_buffer.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{download_filename}"'
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/projects/{project_id}/download/metadata")
async def download_analysis_metadata_file(
    project_id: str,
    selected_view: str = Query("consensus"),
    top_n: int = Query(0),
    consensus_threshold: int = Query(0),
    selected_algorithms: str = Query(""),
):
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    metadata_path = project_dir / "metadata.json"
    project_manifest_path = project_dir / "project.json"
    jobs_path = project_dir / "jobs.json"

    if not metadata_path.exists() or not project_manifest_path.exists() or not jobs_path.exists():
        raise HTTPException(status_code=404, detail="Project metadata not found.")

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        project_manifest = json.loads(project_manifest_path.read_text(encoding="utf-8"))
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))

        if not isinstance(jobs, list) or not jobs:
            raise HTTPException(status_code=404, detail="No jobs found for project.")

        latest_job = jobs[-1] if isinstance(jobs[-1], dict) else {}
        tasks = latest_job.get("tasks", []) if isinstance(latest_job, dict) else []

        selected_algorithm_ids = [
            item.strip() for item in selected_algorithms.split(",") if item.strip()
        ]

        expression_path_value = project_manifest.get("expression_path")
        expression_path = Path(expression_path_value) if expression_path_value else None
        if expression_path and not expression_path.is_absolute():
            expression_path = project_dir / expression_path
        if expression_path:
            expression_path = expression_path.resolve()

        dataset_dimensions = metadata.get("dimensions") or project_manifest.get("dimensions")
        if not dataset_dimensions and expression_path and expression_path.exists() and expression_path.is_file():
            with expression_path.open("r", encoding="utf-8", newline="") as csv_file:
                reader = csv.reader(csv_file)
                rows = list(reader)

            if rows:
                column_count = len(rows[0])
                row_count = max(len(rows) - 1, 0)
                dataset_dimensions = {
                    "rows": row_count,
                    "columns": column_count,
                }

        preprocessing_config = metadata.get("preprocessing") or {}
        if not isinstance(preprocessing_config, dict):
            preprocessing_config = {}

        completed_at_values = [
            task.get("completed_at")
            for task in tasks
            if isinstance(task, dict) and task.get("completed_at")
        ]
        latest_completed_at = completed_at_values[-1] if completed_at_values else None

        if isinstance(tasks, list) and tasks:
            task_statuses = [
                str(task.get("status") or "Unknown")
                for task in tasks
                if isinstance(task, dict)
            ]
            if task_statuses and all(status == "Completed" for status in task_statuses):
                computed_job_status = "Completed"
            elif any(status == "Failed" for status in task_statuses):
                computed_job_status = "Failed"
            elif any(status in {"Running", "Queued"} for status in task_statuses):
                computed_job_status = "Running"
            else:
                computed_job_status = latest_job.get("status") or "Unknown"
        else:
            computed_job_status = latest_job.get("status") or "Unknown"

        algorithms_summary = []
        for task in tasks:
            if not isinstance(task, dict):
                continue

            result_manifest = {}
            result_manifest_path_value = task.get("result_path")
            if result_manifest_path_value:
                result_manifest_path = Path(result_manifest_path_value)
                if not result_manifest_path.is_absolute():
                    result_manifest_path = project_dir / result_manifest_path
                result_manifest_path = result_manifest_path.resolve()
                if result_manifest_path.exists() and result_manifest_path.is_file():
                    try:
                        result_manifest = json.loads(
                            result_manifest_path.read_text(encoding="utf-8")
                        )
                    except Exception:
                        result_manifest = {}

            algorithm_name = task.get("algorithm_id")
            docker_image = (
                result_manifest.get("docker_image")
                or result_manifest.get("docker_image_version")
                or result_manifest.get("image")
                or result_manifest.get("container_image")
                or task.get("docker_image")
                or task.get("docker_image_version")
            )

            if not docker_image and algorithm_name:
                docker_image = ALGORITHM_IMAGE_MAP.get(str(algorithm_name).upper())

            docker_version = None
            if isinstance(docker_image, str) and docker_image:
                docker_version = docker_image.rsplit(":", 1)[1] if ":" in docker_image else docker_image

            algorithms_summary.append(
                {
                    "algorithm_name": algorithm_name,
                    "docker_version": docker_version,
                }
            )

        payload = {
            "project_id": project_id,
            "job_identifier": metadata.get("project_name") or project_manifest.get("project_name") or project_id,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "job": {
                "job_id": latest_job.get("job_id"),
                "status": computed_job_status,
                "created_at": latest_job.get("created_at"),
                "completed_at": latest_job.get("completed_at") or latest_completed_at,
            },
            "dataset": {
                "expression_filename": metadata.get("expression_filename")
                or project_manifest.get("expression_filename"),
                "pseudotime_filename": metadata.get("pseudotime_filename")
                or project_manifest.get("pseudotime_filename"),
                "dimensions": dataset_dimensions,
            },
            "preprocessing": {
                "top_variable_genes": preprocessing_config.get("top_variable_genes"),
                "include_all_tfs": preprocessing_config.get("include_all_tfs"),
                "normalize_enabled": preprocessing_config.get("normalize_enabled"),
                "log_transform_enabled": preprocessing_config.get("log_transform_enabled"),
            },
            "algorithms": algorithms_summary,
            "current_export_settings": {
                "top_n": top_n,
                "consensus_threshold": consensus_threshold,
            },
        }

        download_filename = f"{project_id}-analysis-metadata.json"

        return Response(
            content=json.dumps(payload, indent=2),
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="{download_filename}"'
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc