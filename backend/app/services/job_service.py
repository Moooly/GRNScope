from __future__ import annotations

import time
import threading
from pathlib import Path

from ..config import JOB_FILE_LOCK, PROJECTS_ROOT
from ..repositories.job_repository import read_jobs_manifest, write_jobs_manifest
from ..services.beeline_service import run_beeline_with_progress
from ..services.result_service import write_algorithm_result


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
    progress_percent: int | None = None,
    progress_label: str | None = None,
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
                    if progress_percent is not None:
                        task["progress_percent"] = progress_percent
                    if progress_label is not None:
                        task["progress_label"] = progress_label
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
    project_dir = PROJECTS_ROOT / project_id

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
        progress_percent=1,
        progress_label="Starting",
    )
    recompute_overall_status(project_dir, job_id)

    try:
        beeline_result = run_beeline_with_progress(
            project_id,
            job_id,
            algorithm_id,
            update_job_state,
        )

        elapsed = int(time.time() - started_at)
        completed_at = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())

        actual_result = {
            "project_id": project_id,
            "job_id": job_id,
            "algorithm_id": algorithm_id,
            "status": "Completed",
            "generated_at": completed_at,
            "elapsed_seconds": elapsed,
            "network_summary": beeline_result["network_summary"],
            "top_edges": beeline_result["top_edges"],
            "beeline_runtime_root": beeline_result["runtime_root"],
            "ranked_edges_path": beeline_result["ranked_edges_path"],
        }

        saved_result_path = write_algorithm_result(
            project_dir,
            algorithm_id,
            actual_result,
        )

        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            task_status="Completed",
            elapsed_seconds=elapsed,
            error_message=None,
            result_path=saved_result_path,
            progress_percent=100,
            progress_label="Completed",
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
            progress_percent=0,
            progress_label="Failed",
            error_message=str(exc),
        )
    finally:
        recompute_overall_status(project_dir, job_id)


def launch_independent_algorithm_tasks(
    project_id: str,
    job_id: str,
    selected_algorithms_list: list[str],
) -> None:
    project_dir = PROJECTS_ROOT / project_id

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