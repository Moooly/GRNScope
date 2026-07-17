import json
import tempfile
import unittest
from pathlib import Path

from app.services.beeline_service import (
    load_runner_observability,
    write_run_timings,
)


class RunObservabilityTests(unittest.TestCase):
    def test_run_timings_preserve_stage_and_runner_observability(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime_root = Path(temp_dir)
            metadata = {
                "run-1": {
                    "status": "Completed",
                    "elapsed_seconds": 4,
                    "stages_seconds": {"input_materialization": 0.25},
                    "runner_observability": {
                        "status": "Completed",
                        "resource_usage": {"cpu_total_seconds": 3.5},
                    },
                }
            }

            write_run_timings(runtime_root, metadata)
            payload = json.loads(
                (runtime_root / "run_timings.json").read_text(encoding="utf-8")
            )

        self.assertEqual(
            payload["run-1"]["stages_seconds"]["input_materialization"],
            0.25,
        )
        self.assertEqual(
            payload["run-1"]["runner_observability"]["resource_usage"][
                "cpu_total_seconds"
            ],
            3.5,
        )

    def test_load_runner_observability_is_backward_compatible(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            self.assertIsNone(
                load_runner_observability(
                    output_dir,
                    "dataset",
                    "run-1",
                    "GENIE3",
                )
            )

            working_dir = (
                output_dir / "dataset" / "run-1" / "GENIE3" / "working_dir"
            )
            working_dir.mkdir(parents=True)
            expected = {"schema_version": 1, "status": "Completed"}
            (working_dir / "phase_timings.json").write_text(
                json.dumps(expected),
                encoding="utf-8",
            )

            observed = load_runner_observability(
                output_dir,
                "dataset",
                "run-1",
                "GENIE3",
            )

        self.assertEqual(observed, expected)


if __name__ == "__main__":
    unittest.main()
