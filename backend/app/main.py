from __future__ import annotations

import json
import shutil
import threading
import time
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .schemas import CreateProjectResponse, TempUploadResponse
from .storage import (
    create_temp_upload_id,
    move_temp_upload_to_project,
    save_json,
    temp_expression_path,
    temp_metadata_path,
    temp_pseudotime_path,
)
from .validators import (
    MAX_FILE_SIZE_BYTES,
    parse_expression_matrix,
    parse_pseudotime,
    validate_csv_extension,
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

JOB_FILE_LOCK = threading.Lock()


async def save_upload_file(upload: UploadFile, destination: Path) -> int:
    size = 0
    with destination.open("wb") as f:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE_SIZE_BYTES:
                raise ValueError("File size must be 500 MB or smaller.")
            f.write(chunk)
    await upload.close()
    return size


# --- Project and job helper functions ---

def read_project_manifest(project_dir: Path) -> dict:
    project_path = project_dir / "project.json"
    if not project_path.exists():
        raise FileNotFoundError("Project manifest not found.")
    return json.loads(project_path.read_text(encoding="utf-8"))


def list_project_directories() -> list[Path]:
    projects_root = Path(__file__).resolve().parent.parent / "projects"
    if not projects_root.exists():
        return []
    return [path for path in projects_root.iterdir() if path.is_dir()]


def read_jobs_manifest(project_dir: Path) -> list[dict]:
    jobs_path = project_dir / "jobs.json"
    if not jobs_path.exists():
        return []
    return json.loads(jobs_path.read_text(encoding="utf-8"))


def write_jobs_manifest(project_dir: Path, jobs_manifest: list[dict]) -> None:
    jobs_path = project_dir / "jobs.json"
    jobs_path.write_text(json.dumps(jobs_manifest, indent=2), encoding="utf-8")


# --- Algorithm result helpers ---

def ensure_results_dir(project_dir: Path) -> Path:
    results_dir = project_dir / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    return results_dir


def algorithm_result_path(project_dir: Path, algorithm_id: str) -> Path:
    return ensure_results_dir(project_dir) / f"{algorithm_id}.json"


def write_algorithm_result(
    project_dir: Path,
    algorithm_id: str,
    result_payload: dict,
) -> str:
    result_path = algorithm_result_path(project_dir, algorithm_id)
    result_path.write_text(json.dumps(result_payload, indent=2), encoding="utf-8")
    return str(result_path)


def read_algorithm_result(project_dir: Path, algorithm_id: str) -> dict:
    result_path = algorithm_result_path(project_dir, algorithm_id)
    if not result_path.exists():
        raise FileNotFoundError(f"Result for {algorithm_id} not found.")
    return json.loads(result_path.read_text(encoding="utf-8"))


def update_job_state(
    project_dir: Path,
    job_id: str,
    *,
    overall_status: str | None = None,
    algorithm_id: str | None = None,
    task_status: str | None = None,
    elapsed_seconds: int | None = None,
    error_message: str | None = None,
    result_path: str | None = None,
    completed_at: str | None = None,
) -> None:
    with JOB_FILE_LOCK:
        jobs_manifest = read_jobs_manifest(project_dir)

        for job in jobs_manifest:
            if job.get("job_id") != job_id:
                continue

            if overall_status is not None:
                job["overall_status"] = overall_status

            if algorithm_id is not None:
                for task in job.get("tasks", []):
                    if task.get("algorithm_id") != algorithm_id:
                        continue

                    if task_status is not None:
                        task["status"] = task_status
                    if elapsed_seconds is not None:
                        task["elapsed_seconds"] = elapsed_seconds
                    if error_message is not None or task_status == "Failed":
                        task["error_message"] = error_message
                    if result_path is not None:
                        task["result_path"] = result_path
                    if completed_at is not None:
                        task["completed_at"] = completed_at
                    break

            write_jobs_manifest(project_dir, jobs_manifest)
            return


def recompute_overall_status(project_dir: Path, job_id: str) -> None:
    with JOB_FILE_LOCK:
        jobs_manifest = read_jobs_manifest(project_dir)

        for job in jobs_manifest:
            if job.get("job_id") != job_id:
                continue

            tasks = job.get("tasks", [])
            statuses = [task.get("status") for task in tasks]

            if any(status == "Failed" for status in statuses):
                job["overall_status"] = "Failed"
            elif statuses and all(status == "Completed" for status in statuses):
                job["overall_status"] = "Completed"
            elif any(status == "Running" for status in statuses):
                job["overall_status"] = "Running"
            elif statuses and all(status == "Queued" for status in statuses):
                job["overall_status"] = "Queued"
            else:
                job["overall_status"] = "Running"

            write_jobs_manifest(project_dir, jobs_manifest)
            return


def run_single_algorithm_task(project_id: str, job_id: str, algorithm_id: str) -> None:
    project_dir = Path(__file__).resolve().parent.parent / "projects" / project_id

    if not project_dir.exists():
        return

    started_at = time.time()
    update_job_state(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        task_status="Running",
        elapsed_seconds=0,
        error_message=None,
    )
    recompute_overall_status(project_dir, job_id)

    try:
        # Temporary simulation of independent algorithm execution.
        # Replace this block later with the real algorithm runner.
        simulated_duration = 3 + (sum(ord(char) for char in algorithm_id) % 3)
        time.sleep(simulated_duration)

        elapsed = int(time.time() - started_at)
        completed_at = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())

        simulated_result = {
            "project_id": project_id,
            "job_id": job_id,
            "algorithm_id": algorithm_id,
            "status": "Completed",
            "generated_at": completed_at,
            "elapsed_seconds": elapsed,
            "network_summary": {
                "edge_count": 25 + (sum(ord(char) for char in algorithm_id) % 50),
                "node_count": 10 + (sum(ord(char) for char in algorithm_id) % 20),
            },
            "top_edges": [
                {
                    "source": "GeneA",
                    "target": "GeneB",
                    "score": 0.91,
                },
                {
                    "source": "GeneC",
                    "target": "GeneD",
                    "score": 0.87,
                },
                {
                    "source": "GeneE",
                    "target": "GeneF",
                    "score": 0.83,
                },
            ],
        }

        saved_result_path = write_algorithm_result(
            project_dir,
            algorithm_id,
            simulated_result,
        )

        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            task_status="Completed",
            elapsed_seconds=elapsed,
            error_message=None,
            result_path=saved_result_path,
            completed_at=completed_at,
        )
    except Exception as exc:
        elapsed = int(time.time() - started_at)
        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            task_status="Failed",
            elapsed_seconds=elapsed,
            error_message=str(exc),
        )
    finally:
        recompute_overall_status(project_dir, job_id)


def launch_independent_algorithm_tasks(
    project_id: str,
    job_id: str,
    selected_algorithms_list: list[str],
) -> None:
    project_dir = Path(__file__).resolve().parent.parent / "projects" / project_id

    if not project_dir.exists():
        return

    update_job_state(project_dir, job_id, overall_status="Running")

    for algorithm_id in selected_algorithms_list:
        worker = threading.Thread(
            target=run_single_algorithm_task,
            args=(project_id, job_id, algorithm_id),
            daemon=True,
        )
        worker.start()


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    project_dir = Path(__file__).resolve().parent.parent / "projects" / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        shutil.rmtree(project_dir)
        return {
            "ok": True,
            "project_id": project_id,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/uploads/temp-dataset", response_model=TempUploadResponse)
async def temp_dataset_upload(
    expression_matrix: UploadFile = File(...),
    pseudotime: UploadFile | None = File(default=None),
):
    errors: list[str] = []

    expression_ext_error = validate_csv_extension(expression_matrix.filename or "")
    if expression_ext_error:
        errors.append(f"Expression matrix: {expression_ext_error}")

    if pseudotime:
        pseudo_ext_error = validate_csv_extension(pseudotime.filename or "")
        if pseudo_ext_error:
            errors.append(f"Pseudotime: {pseudo_ext_error}")

    if errors:
        return TempUploadResponse(ok=False, errors=errors)

    temp_upload_id = create_temp_upload_id()
    expression_path = temp_expression_path(
        temp_upload_id, expression_matrix.filename or "expression.csv"
    )

    pseudotime_path: Path | None = None
    if pseudotime:
        pseudotime_path = temp_pseudotime_path(
            temp_upload_id, pseudotime.filename or "pseudotime.csv"
        )

    try:
        await save_upload_file(expression_matrix, expression_path)
        expression_info = parse_expression_matrix(expression_path)

        pseudotime_info = None
        if pseudotime and pseudotime_path is not None:
            await save_upload_file(pseudotime, pseudotime_path)
            pseudotime_info = parse_pseudotime(
                pseudotime_path, expression_info["cell_count"]
            )

        metadata = {
            "temp_upload_id": temp_upload_id,
            "expression_path": str(expression_path),
            "pseudotime_path": str(pseudotime_path) if pseudotime_path else None,
            "expression_filename": expression_matrix.filename,
            "pseudotime_filename": pseudotime.filename if pseudotime else None,
            "gene_count": expression_info["gene_count"],
            "cell_count": expression_info["cell_count"],
            "gene_names": expression_info["gene_names"],
            "cell_names": expression_info["cell_names"],
            "has_pseudotime": pseudotime is not None,
            "pseudotime_count": (
                pseudotime_info["pseudotime_count"] if pseudotime_info else None
            ),
        }
        save_json(temp_metadata_path(temp_upload_id), metadata)

        return TempUploadResponse(
            ok=True,
            temp_upload_id=temp_upload_id,
            expression_filename=expression_matrix.filename,
            pseudotime_filename=pseudotime.filename if pseudotime else None,
            gene_count=expression_info["gene_count"],
            cell_count=expression_info["cell_count"],
            has_pseudotime=pseudotime is not None,
            errors=[],
        )
    except Exception as e:
        if expression_path.exists():
            expression_path.unlink()
        if pseudotime_path and pseudotime_path.exists():
            pseudotime_path.unlink()

        meta_path = temp_metadata_path(temp_upload_id)
        if meta_path.exists():
            meta_path.unlink()

        return TempUploadResponse(ok=False, errors=[str(e)])


@app.post("/api/projects/create-from-temp", response_model=CreateProjectResponse)
async def create_project_from_temp(
    background_tasks: BackgroundTasks,
    temp_upload_id: str = Form(...),
    project_name: str = Form(...),
    project_description: str = Form(""),
    top_variable_genes: str = Form(...),
    include_all_tfs: str = Form(...),
    normalize_enabled: str = Form(...),
    log_transform_enabled: str = Form(...),
    selected_algorithms: str = Form(...),
    ensemble_enabled: str = Form(...),
):
    meta_path = temp_metadata_path(temp_upload_id)
    if not meta_path.exists():
        return CreateProjectResponse(
            ok=False,
            errors=["Temporary upload not found or expired."],
        )

    project_id = uuid.uuid4().hex[:12]
    job_id = uuid.uuid4().hex[:12]

    try:
        move_result = move_temp_upload_to_project(temp_upload_id, project_id)

        project_dir = Path(move_result["project_dir"])
        selected_algorithms_list = json.loads(selected_algorithms)

        upload_metadata_path = project_dir / "upload_metadata.json"
        upload_metadata = {}
        if upload_metadata_path.exists():
            upload_metadata = json.loads(
                upload_metadata_path.read_text(encoding="utf-8")
            )

        job_manifest = {
            "job_id": job_id,
            "project_id": project_id,
            "overall_status": "Queued",
            "ensemble_enabled": ensemble_enabled,
            "tasks": [
                {
                    "algorithm_id": algorithm_id,
                    "status": "Queued",
                    "elapsed_seconds": 0,
                    "error_message": None,
                    "result_path": None,
                    "completed_at": None,
                }
                for algorithm_id in selected_algorithms_list
            ],
        }

        project_manifest = {
            "project_id": project_id,
            "project_name": project_name,
            "project_description": project_description,
            "created_at": time.time(),
            "created_at_display": time.strftime("%Y-%m-%d %H:%M", time.localtime()),
            "top_variable_genes": top_variable_genes,
            "include_all_tfs": include_all_tfs,
            "normalize_enabled": normalize_enabled,
            "log_transform_enabled": log_transform_enabled,
            "selected_algorithms": selected_algorithms_list,
            "ensemble_enabled": ensemble_enabled,
            "expression_path": move_result["expression_path"],
            "pseudotime_path": move_result.get("pseudotime_path"),
            "latest_job_id": job_id,
        }

        metadata_manifest = {
            "project_id": project_id,
            "project_name": project_name,
            "project_description": project_description,
            "expression_filename": upload_metadata.get("expression_filename"),
            "pseudotime_filename": upload_metadata.get("pseudotime_filename"),
            "gene_count": upload_metadata.get("gene_count"),
            "cell_count": upload_metadata.get("cell_count"),
            "gene_names": upload_metadata.get("gene_names", []),
            "cell_names": upload_metadata.get("cell_names", []),
            "has_pseudotime": upload_metadata.get("has_pseudotime"),
            "pseudotime_count": upload_metadata.get("pseudotime_count"),
            "preprocessing": {
                "top_variable_genes": top_variable_genes,
                "include_all_tfs": include_all_tfs,
                "normalize_enabled": normalize_enabled,
                "log_transform_enabled": log_transform_enabled,
            },
            "selected_algorithms": selected_algorithms_list,
            "results_directory": str(project_dir / "results"),
            "ensemble_enabled": ensemble_enabled,
            "job": {
                "job_id": job_id,
                "overall_status": "Queued",
            },
        }

        (project_dir / "project.json").write_text(
            json.dumps(project_manifest, indent=2),
            encoding="utf-8",
        )
        (project_dir / "metadata.json").write_text(
            json.dumps(metadata_manifest, indent=2),
            encoding="utf-8",
        )
        (project_dir / "jobs.json").write_text(
            json.dumps([job_manifest], indent=2),
            encoding="utf-8",
        )

        if upload_metadata_path.exists():
            upload_metadata_path.unlink()

        background_tasks.add_task(
            launch_independent_algorithm_tasks,
            project_id,
            job_id,
            selected_algorithms_list,
        )

        return CreateProjectResponse(
            ok=True,
            project_id=project_id,
            job_id=job_id,
            errors=[],
        )
    except Exception as e:
        return CreateProjectResponse(ok=False, errors=[str(e)])


# --- Job monitoring endpoints ---

@app.get("/api/projects")
async def list_projects():
    try:
        project_items = []

        for project_dir in list_project_directories():
            try:
                project_manifest = read_project_manifest(project_dir)
                jobs_manifest = read_jobs_manifest(project_dir)
                latest_job = jobs_manifest[-1] if jobs_manifest else None

                created_at = project_manifest.get("created_at")
                if not created_at:
                    try:
                        created_at = project_dir.stat().st_mtime
                    except Exception:
                        created_at = 0

                project_items.append(
                    {
                        "id": project_manifest.get("project_id", project_dir.name),
                        "name": project_manifest.get("project_name", project_dir.name),
                        "description": project_manifest.get(
                            "project_description",
                            "Single-cell RNA-seq dataset for GRN inference.",
                        ),
                        "createdAt": project_manifest.get(
                            "created_at_display", "Unknown"
                        ),
                        "datasetCount": 1,
                        "jobCount": len(jobs_manifest) if jobs_manifest else 0,
                        "latestJob": latest_job,
                        "created_at_sort": created_at,
                    }
                )
            except Exception:
                continue

        project_items.sort(
            key=lambda item: item.get("created_at_sort", 0), reverse=True
        )

        for item in project_items:
            item.pop("created_at_sort", None)

        return {
            "ok": True,
            "projects": project_items,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/projects/{project_id}")
async def get_project(project_id: str):
    project_dir = Path(__file__).resolve().parent.parent / "projects" / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        project_manifest = read_project_manifest(project_dir)
        jobs_manifest = read_jobs_manifest(project_dir)

        latest_job = jobs_manifest[-1] if jobs_manifest else None

        return {
            "ok": True,
            "project": project_manifest,
            "latest_job": latest_job,
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/projects/{project_id}/jobs")
async def get_project_jobs(project_id: str):
    project_dir = Path(__file__).resolve().parent.parent / "projects" / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        jobs_manifest = read_jobs_manifest(project_dir)
        return {
            "ok": True,
            "project_id": project_id,
            "jobs": jobs_manifest,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# --- Result endpoints ---


@app.get("/api/projects/{project_id}/results")
async def get_project_results(project_id: str):
    project_dir = Path(__file__).resolve().parent.parent / "projects" / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

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
                    "completed_at": task.get("completed_at"),
                    "elapsed_seconds": task.get("elapsed_seconds"),
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


@app.get("/api/projects/{project_id}/results/{algorithm_id}")
async def get_algorithm_result(project_id: str, algorithm_id: str):
    project_dir = Path(__file__).resolve().parent.parent / "projects" / project_id

    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        result = read_algorithm_result(project_dir, algorithm_id)
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