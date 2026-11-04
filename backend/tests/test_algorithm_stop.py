import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.job_service import (
    clear_task_control,
    finalize_algorithm_task_stop,
    request_algorithm_task_stop,
)


class AlgorithmStopTests(unittest.TestCase):
    def _write_job(self, project_dir: Path, status: str) -> None:
        (project_dir / "jobs.json").write_text(
            json.dumps(
                [
                    {
                        "job_id": "job-1",
                        "overall_status": "Running",
                        "tasks": [
                            {
                                "algorithm_id": "SCRIBE",
                                "status": status,
                                "process_pid": 987654321,
                            }
                        ],
                    }
                ]
            ),
            encoding="utf-8",
        )

    def test_running_worker_keeps_runtime_until_it_records_stopped_state(self):
        with tempfile.TemporaryDirectory(prefix="algorithm-stop-test-") as temp_dir:
            projects_root = Path(temp_dir)
            project_dir = projects_root / "project-1"
            runtime_root = project_dir / "_beeline_runtime" / "SCRIBE"
            runtime_root.mkdir(parents=True)
            marker = runtime_root / "run_timings.json"
            marker.write_text("{}", encoding="utf-8")
            self._write_job(project_dir, "Running")

            try:
                with (
                    patch("app.services.job_service.PROJECTS_ROOT", projects_root),
                    patch(
                        "app.services.job_service.terminate_algorithm_docker_containers"
                    ),
                    patch("app.services.job_service.terminate_process"),
                    patch(
                        "app.services.job_service.cleanup_algorithm_runtime"
                    ) as cleanup_runtime,
                ):
                    task, fallback_pid = request_algorithm_task_stop("project-1", "job-1", "SCRIBE")
                    if fallback_pid is not None or task.get("status") == "Stopping":
                        finalize_algorithm_task_stop("project-1", "job-1", "SCRIBE", fallback_pid)
            finally:
                clear_task_control("project-1", "job-1", "SCRIBE")

            self.assertEqual(task["status"], "Stopping")
            self.assertTrue(marker.is_file())
            cleanup_runtime.assert_not_called()

    def test_queued_task_runtime_is_removed_immediately(self):
        with tempfile.TemporaryDirectory(prefix="algorithm-stop-test-") as temp_dir:
            projects_root = Path(temp_dir)
            project_dir = projects_root / "project-1"
            runtime_root = project_dir / "_beeline_runtime" / "SCRIBE"
            runtime_root.mkdir(parents=True)
            (runtime_root / "unused.txt").write_text("unused", encoding="utf-8")
            self._write_job(project_dir, "Queued")

            try:
                with (
                    patch("app.services.job_service.PROJECTS_ROOT", projects_root),
                    patch(
                        "app.services.job_service.terminate_algorithm_docker_containers"
                    ),
                    patch("app.services.job_service.terminate_process"),
                    patch(
                        "app.services.job_service.cleanup_algorithm_runtime"
                    ) as cleanup_runtime,
                ):
                    task, fallback_pid = request_algorithm_task_stop("project-1", "job-1", "SCRIBE")
                    if fallback_pid is not None or task.get("status") == "Stopping":
                        finalize_algorithm_task_stop("project-1", "job-1", "SCRIBE", fallback_pid)
            finally:
                clear_task_control("project-1", "job-1", "SCRIBE")

            self.assertEqual(task["status"], "Stopped")
            cleanup_runtime.assert_called_once_with("project-1", "SCRIBE")


if __name__ == "__main__":
    unittest.main()
