from __future__ import annotations

import os
import signal
import shutil
import subprocess
import time
import threading
from dataclasses import dataclass
from pathlib import Path

from ..algorithm_registry import sort_algorithm_ids_by_difficulty
from ..config import JOB_FILE_LOCK, PROJECTS_ROOT
from ..repositories.job_repository import read_jobs_manifest, write_jobs_manifest
from ..repositories.project_repository import read_project_manifest
from ..services.beeline_service import AlgorithmStoppedError, run_beeline_with_progress
from ..services.email_service import (
    normalize_notification_email,
    send_job_completion_email,
    smtp_is_configured,
)
from ..services.result_service import algorithm_result_path, write_algorithm_result


@dataclass
class TaskControl:
    stop_event: threading.Event
    process: subprocess.Popen | None = None


TASK_CONTROLS_LOCK = threading.Lock()
TASK_CONTROLS: dict[tuple[str, str, str], TaskControl] = {}


def read_positive_int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


MAX_CONCURRENT_ALGORITHM_TASKS = read_positive_int_env(
    "GRNSCOPE_MAX_CONCURRENT_ALGORITHMS",
    2,
)
ALGORITHM_TASK_SEMAPHORE = threading.BoundedSemaphore(
    MAX_CONCURRENT_ALGORITHM_TASKS
)
TERMINAL_JOB_STATUSES = {"Completed", "Failed", "Stopped"}


def task_key(project_id: str, job_id: str, algorithm_id: str) -> tuple[str, str, str]:
    return (project_id, job_id, algorithm_id)


def get_or_create_task_control(
    project_id: str,
    job_id: str,
    algorithm_id: str,
) -> TaskControl:
    key = task_key(project_id, job_id, algorithm_id)
    with TASK_CONTROLS_LOCK:
        control = TASK_CONTROLS.get(key)
        if control is None:
            control = TaskControl(stop_event=threading.Event())
            TASK_CONTROLS[key] = control
        return control


def clear_task_control(project_id: str, job_id: str, algorithm_id: str) -> None:
    key = task_key(project_id, job_id, algorithm_id)
    with TASK_CONTROLS_LOCK:
        TASK_CONTROLS.pop(key, None)


def set_task_process(
    project_id: str,
    job_id: str,
    algorithm_id: str,
    process: subprocess.Popen,
) -> None:
    control = get_or_create_task_control(project_id, job_id, algorithm_id)
    with TASK_CONTROLS_LOCK:
        control.process = process

    project_dir = PROJECTS_ROOT / project_id
    if project_dir.exists():
        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            process_pid=process.pid,
        )


def terminate_process_group(pid: int | None) -> None:
    if pid is None or pid <= 0:
        return

    cmdline_path = Path(f"/proc/{pid}/cmdline")
    if cmdline_path.exists():
        try:
            cmdline = cmdline_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return
        if "BLRunner.py" not in cmdline:
            return

    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        return

    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            os.killpg(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)

    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def terminate_process(process: subprocess.Popen | None, fallback_pid: int | None = None) -> None:
    if process is None:
        terminate_process_group(fallback_pid)
        return

    if process.poll() is not None:
        return

    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return

    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def cleanup_algorithm_runtime(project_id: str, algorithm_id: str) -> None:
    runtime_root = PROJECTS_ROOT / project_id / "_beeline_runtime" / algorithm_id
    if runtime_root.exists():
        shutil.rmtree(runtime_root, ignore_errors=True)


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
    process_pid: int | None = None,
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
                    if process_pid is not None:
                        if process_pid > 0:
                            task["process_pid"] = process_pid
                        else:
                            task.pop("process_pid", None)
                    break

            write_jobs_manifest(project_dir, jobs_manifest)
            return


def get_task_state(project_dir: Path, job_id: str, algorithm_id: str) -> dict | None:
    jobs_manifest = read_jobs_manifest(project_dir)
    for job in jobs_manifest:
        if job.get("job_id") != job_id:
            continue
        for task in job.get("tasks", []):
            if task.get("algorithm_id") == algorithm_id:
                return task
    return None


def reset_task_for_rerun(project_dir: Path, job_id: str, algorithm_id: str) -> None:
    with JOB_FILE_LOCK:
        jobs_manifest = read_jobs_manifest(project_dir)
        for job in jobs_manifest:
            if job.get("job_id") != job_id:
                continue

            for task in job.get("tasks", []):
                if task.get("algorithm_id") != algorithm_id:
                    continue

                task["status"] = "Queued"
                task["elapsed_seconds"] = 0
                task["error_message"] = None
                task["result_path"] = None
                task["completed_at"] = None
                task["progress_percent"] = 0
                task["progress_label"] = "Queued"
                task.pop("process_pid", None)
                result_path = algorithm_result_path(project_dir, algorithm_id)
                if result_path.exists():
                    result_path.unlink()
                break

            job["overall_status"] = "Running"
            job.pop("notification_sent_at", None)
            job.pop("notification_started_at", None)
            job.pop("notification_error", None)
            job.pop("notification_attempted_at", None)
            write_jobs_manifest(project_dir, jobs_manifest)
            return


def send_job_completion_notification_if_needed(project_dir: Path, job_id: str) -> None:
    try:
        project_manifest = read_project_manifest(project_dir)
    except FileNotFoundError:
        return

    notification_email = normalize_notification_email(
        project_manifest.get("notification_email")
    )
    if not notification_email:
        return

    now_display = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    job_snapshot: dict | None = None

    with JOB_FILE_LOCK:
        jobs_manifest = read_jobs_manifest(project_dir)

        for job in jobs_manifest:
            if job.get("job_id") != job_id:
                continue

            if job.get("overall_status") not in TERMINAL_JOB_STATUSES:
                return
            if (
                job.get("notification_sent_at")
                or job.get("notification_started_at")
                or job.get("notification_error")
            ):
                return

            if not smtp_is_configured():
                job["notification_error"] = "Email notification is not configured on the server."
                job["notification_attempted_at"] = now_display
                write_jobs_manifest(project_dir, jobs_manifest)
                return

            job["notification_started_at"] = now_display
            job_snapshot = dict(job)
            job_snapshot["tasks"] = [dict(task) for task in job.get("tasks", [])]
            write_jobs_manifest(project_dir, jobs_manifest)
            break

    if job_snapshot is None:
        return

    tasks = job_snapshot.get("tasks", [])
    completed_count = sum(1 for task in tasks if task.get("status") == "Completed")
    failed_count = sum(1 for task in tasks if task.get("status") == "Failed")
    stopped_count = sum(1 for task in tasks if task.get("status") == "Stopped")

    try:
        send_job_completion_email(
            to_email=notification_email,
            project_id=str(project_manifest.get("project_id") or project_dir.name),
            project_name=str(project_manifest.get("project_name") or project_dir.name),
            job_status=str(job_snapshot.get("overall_status") or "Completed"),
            completed_count=completed_count,
            failed_count=failed_count,
            stopped_count=stopped_count,
            total_count=len(tasks),
        )
    except Exception as exc:
        with JOB_FILE_LOCK:
            jobs_manifest = read_jobs_manifest(project_dir)
            for job in jobs_manifest:
                if job.get("job_id") != job_id:
                    continue
                job.pop("notification_started_at", None)
                job["notification_error"] = str(exc)
                job["notification_attempted_at"] = time.strftime(
                    "%Y-%m-%d %H:%M:%S",
                    time.localtime(),
                )
                write_jobs_manifest(project_dir, jobs_manifest)
                return
        return

    with JOB_FILE_LOCK:
        jobs_manifest = read_jobs_manifest(project_dir)
        for job in jobs_manifest:
            if job.get("job_id") != job_id:
                continue
            job.pop("notification_started_at", None)
            job.pop("notification_error", None)
            job["notification_sent_at"] = time.strftime(
                "%Y-%m-%d %H:%M:%S",
                time.localtime(),
            )
            write_jobs_manifest(project_dir, jobs_manifest)
            return


def recompute_overall_status(project_dir: Path, job_id: str) -> None:
    should_check_notification = False

    with JOB_FILE_LOCK:
        jobs_manifest = read_jobs_manifest(project_dir)

        for job in jobs_manifest:
            if job.get("job_id") != job_id:
                continue

            tasks = job.get("tasks", [])
            statuses = [task.get("status") for task in tasks]

            if any(status == "Running" for status in statuses) or any(
                status == "Stopping" for status in statuses
            ):
                job["overall_status"] = "Running"
            elif any(status == "Queued" for status in statuses):
                job["overall_status"] = "Queued"
            elif any(status == "Failed" for status in statuses):
                job["overall_status"] = "Failed"
            elif statuses and all(status == "Completed" for status in statuses):
                job["overall_status"] = "Completed"
            elif statuses and all(status == "Stopped" for status in statuses):
                job["overall_status"] = "Stopped"
            elif statuses and all(status in {"Completed", "Stopped"} for status in statuses):
                job["overall_status"] = "Completed"
            else:
                job["overall_status"] = "Stopped"

            should_check_notification = job["overall_status"] in TERMINAL_JOB_STATUSES
            write_jobs_manifest(project_dir, jobs_manifest)
            break

    if should_check_notification:
        send_job_completion_notification_if_needed(project_dir, job_id)


def run_single_algorithm_task(project_id: str, job_id: str, algorithm_id: str) -> None:
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        return

    control = get_or_create_task_control(project_id, job_id, algorithm_id)
    started_at = time.time()
    if control.stop_event.is_set():
        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            task_status="Stopped",
            elapsed_seconds=0,
            progress_percent=0,
            progress_label="Stopped",
            completed_at=time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
            process_pid=0,
        )
        recompute_overall_status(project_dir, job_id)
        clear_task_control(project_id, job_id, algorithm_id)
        return

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
            stop_event=control.stop_event,
            on_process_start=lambda process: set_task_process(
                project_id,
                job_id,
                algorithm_id,
                process,
            ),
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
            "confidence_summary": beeline_result.get("confidence_summary"),
            "run_ranked_edges_paths": beeline_result.get("run_ranked_edges_paths"),
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
            process_pid=0,
        )
    except AlgorithmStoppedError:
        elapsed = int(time.time() - started_at)
        completed_at = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
        cleanup_algorithm_runtime(project_id, algorithm_id)
        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            task_status="Stopped",
            elapsed_seconds=elapsed,
            error_message=None,
            progress_percent=0,
            progress_label="Stopped",
            completed_at=completed_at,
            process_pid=0,
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
            process_pid=0,
        )
    finally:
        clear_task_control(project_id, job_id, algorithm_id)
        recompute_overall_status(project_dir, job_id)


def run_algorithm_task_with_slot(project_id: str, job_id: str, algorithm_id: str) -> None:
    control = get_or_create_task_control(project_id, job_id, algorithm_id)

    while not control.stop_event.is_set():
        if ALGORITHM_TASK_SEMAPHORE.acquire(timeout=0.5):
            break
    else:
        run_single_algorithm_task(project_id, job_id, algorithm_id)
        return

    try:
        run_single_algorithm_task(project_id, job_id, algorithm_id)
    finally:
        ALGORITHM_TASK_SEMAPHORE.release()


def launch_independent_algorithm_tasks(
    project_id: str,
    job_id: str,
    selected_algorithms_list: list[str],
) -> None:
    project_dir = PROJECTS_ROOT / project_id

    if not project_dir.exists():
        return

    update_job_state(project_dir, job_id, overall_status="Running")

    for algorithm_id in sort_algorithm_ids_by_difficulty(selected_algorithms_list):
        get_or_create_task_control(project_id, job_id, algorithm_id)
        worker = threading.Thread(
            target=run_algorithm_task_with_slot,
            args=(project_id, job_id, algorithm_id),
            daemon=True,
        )
        worker.start()


def stop_algorithm_task(project_id: str, job_id: str, algorithm_id: str) -> dict:
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        raise FileNotFoundError("Project not found.")

    task = get_task_state(project_dir, job_id, algorithm_id)
    if task is None:
        raise FileNotFoundError("Algorithm task not found.")

    status = task.get("status")
    if status in {"Completed", "Failed", "Stopped"}:
        return task

    control = get_or_create_task_control(project_id, job_id, algorithm_id)
    control.stop_event.set()

    update_job_state(
        project_dir,
        job_id,
        algorithm_id=algorithm_id,
        task_status="Stopping",
        progress_label="Stopping",
    )

    task_pid = task.get("process_pid")
    fallback_pid = int(task_pid) if isinstance(task_pid, int) else None
    terminate_process(control.process, fallback_pid=fallback_pid)

    if status == "Queued" or (control.process is None and fallback_pid is not None):
        cleanup_algorithm_runtime(project_id, algorithm_id)
        update_job_state(
            project_dir,
            job_id,
            algorithm_id=algorithm_id,
            task_status="Stopped",
            progress_percent=0,
            progress_label="Stopped",
            completed_at=time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
            process_pid=0,
        )

    recompute_overall_status(project_dir, job_id)
    return get_task_state(project_dir, job_id, algorithm_id) or task


def rerun_algorithm_task(project_id: str, job_id: str, algorithm_id: str) -> dict:
    project_dir = PROJECTS_ROOT / project_id
    if not project_dir.exists():
        raise FileNotFoundError("Project not found.")

    task = get_task_state(project_dir, job_id, algorithm_id)
    if task is None:
        raise FileNotFoundError("Algorithm task not found.")

    if task.get("status") in {"Queued", "Running", "Stopping"}:
        raise RuntimeError("Algorithm is already running.")

    clear_task_control(project_id, job_id, algorithm_id)
    get_or_create_task_control(project_id, job_id, algorithm_id)
    reset_task_for_rerun(project_dir, job_id, algorithm_id)

    worker = threading.Thread(
        target=run_single_algorithm_task,
        args=(project_id, job_id, algorithm_id),
        daemon=True,
    )
    worker.start()

    recompute_overall_status(project_dir, job_id)
    return get_task_state(project_dir, job_id, algorithm_id) or task
