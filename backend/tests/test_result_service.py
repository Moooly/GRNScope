import json
import tempfile
import unittest
from pathlib import Path

from app.services.result_service import archive_beeline_failure_diagnostics


class FailureDiagnosticsArchiveTests(unittest.TestCase):
    def test_archives_lightweight_failure_bundle_and_removes_runtime(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = Path(temporary_directory) / "project-123"
            runtime_root = project_dir / "_beeline_runtime" / "GENIE3"
            output_dir = (
                runtime_root
                / "outputs"
                / "project-123"
                / "run-1"
                / "GENIE3"
            )
            working_dir = output_dir / "working_dir"
            input_dir = runtime_root / "inputs" / "project-123" / "run-1"
            working_dir.mkdir(parents=True)
            input_dir.mkdir(parents=True)

            (runtime_root / "config.yaml").write_text("config", encoding="utf-8")
            (runtime_root / "stdout.log").write_text("stdout", encoding="utf-8")
            (runtime_root / "stderr.log").write_text("stderr", encoding="utf-8")
            (runtime_root / "run_timings.json").write_text("{}", encoding="utf-8")
            (output_dir / "output.txt").write_text("docker error", encoding="utf-8")
            (working_dir / "time1.txt").write_text("trace", encoding="utf-8")
            (input_dir / "ExpressionData.csv").write_text(
                "large runtime input", encoding="utf-8"
            )

            error_path = Path(
                archive_beeline_failure_diagnostics(
                    project_dir,
                    "job-456",
                    "GENIE3",
                    error_message="Docker command failed.",
                    error_type="algorithm",
                    started_at_timestamp=1_788_800_000.123,
                    completed_at_timestamp=1_788_800_005.123,
                    elapsed_seconds=5,
                    traceback_text="Traceback: test",
                    runtime_roots=[runtime_root],
                )
            )

            self.assertTrue(error_path.exists())
            self.assertFalse(runtime_root.exists())
            self.assertFalse((project_dir / "_beeline_runtime").exists())

            attempt_dir = error_path.parent
            archived_runtime = attempt_dir / "runtime" / "GENIE3"
            self.assertEqual(
                (archived_runtime / "stderr.log").read_text(encoding="utf-8"),
                "stderr",
            )
            self.assertTrue(
                (
                    archived_runtime
                    / "outputs"
                    / "project-123"
                    / "run-1"
                    / "GENIE3"
                    / "output.txt"
                ).exists()
            )
            self.assertFalse((archived_runtime / "inputs").exists())

            error_payload = json.loads(error_path.read_text(encoding="utf-8"))
            self.assertEqual(error_payload["algorithm_id"], "GENIE3")
            self.assertEqual(error_payload["error_message"], "Docker command failed.")
            self.assertIn("runtime/GENIE3/stderr.log", error_payload["copied_files"])

            latest_path = project_dir / "diagnostics" / "GENIE3" / "latest.json"
            latest_payload = json.loads(latest_path.read_text(encoding="utf-8"))
            self.assertEqual(
                latest_payload["error_path"],
                str(error_path.relative_to(project_dir)),
            )


if __name__ == "__main__":
    unittest.main()
