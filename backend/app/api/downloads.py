from __future__ import annotations

import json
import csv
from pathlib import Path
from io import StringIO

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from ..config import PROJECTS_ROOT

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

        csv_text = file_path.read_text(encoding="utf-8", newline="")
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