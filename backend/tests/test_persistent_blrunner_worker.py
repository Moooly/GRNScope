import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

from app.services.beeline_service import (
    PersistentBLRunnerWorker,
    build_beeline_config,
)


class PersistentBLRunnerWorkerTests(unittest.TestCase):
    def test_worker_reuses_one_process_for_two_pearson_runs(self):
        beeline_root = Path(__file__).resolve().parents[3] / "Beeline"
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            runtime_root = root / "runtime"
            input_dir = root / "inputs"
            output_dir = root / "outputs"
            runtime_root.mkdir()
            config_path = runtime_root / "config.yaml"
            expression_source = root / "ExpressionData.source.csv"
            expression_source.write_text(
                ",cell-1,cell-2,cell-3\n"
                "gene-a,1,2,3\n"
                "gene-b,3,2,1\n"
                "gene-c,1,3,2\n",
                encoding="utf-8",
            )
            worker = PersistentBLRunnerWorker(
                python_executable=sys.executable,
                beeline_root=beeline_root,
                runtime_root=runtime_root,
                stdout_log_path=runtime_root / "stdout.log",
                stderr_log_path=runtime_root / "stderr.log",
            )

            try:
                process_id = None
                for run_id in ("run-1", "run-2"):
                    run_dir = input_dir / "dataset" / run_id
                    run_dir.mkdir(parents=True)
                    selected_cells_path = run_dir / "selected_cells.json"
                    selected_cells_path.write_text(
                        json.dumps(
                            ["cell-1", "cell-2", "cell-3"]
                            if run_id == "run-1"
                            else ["cell-1", "cell-3"]
                        ),
                        encoding="utf-8",
                    )
                    config_path.write_text(
                        build_beeline_config(
                            input_dir=input_dir,
                            output_dir=output_dir,
                            dataset_id="dataset",
                            run_ids=[run_id],
                            algorithm_id="PEARSON",
                            include_pseudotime=False,
                            max_regulators_per_target=2,
                            expression_source=expression_source,
                            selected_cells_files={
                                run_id: selected_cells_path,
                            },
                            resource_settings={
                                "cpu_budget": 2,
                                "memory_budget_mb": 4096,
                                "trajectory_workers": 2,
                                "effective_concurrency": 1,
                            },
                        ),
                        encoding="utf-8",
                    )
                    response_path = worker.submit(config_path, run_id)
                    if process_id is None:
                        process_id = worker.process.pid
                    else:
                        self.assertEqual(worker.process.pid, process_id)

                    deadline = time.time() + 10
                    response = worker.read_response(response_path)
                    while response is None and time.time() < deadline:
                        time.sleep(0.05)
                        response = worker.read_response(response_path)

                    self.assertIsNotNone(response)
                    self.assertEqual(response["status"], "Completed")
                    result_path = (
                        output_dir
                        / "dataset"
                        / run_id
                        / "PEARSON"
                        / "rankedEdges.csv"
                    )
                    self.assertTrue(result_path.is_file())
                    self.assertFalse((run_dir / "ExpressionData.csv").exists())
                    phase_path = result_path.parent / "working_dir" / "phase_timings.json"
                    phase_payload = json.loads(phase_path.read_text())
                    self.assertEqual(phase_payload["status"], "Completed")
                    self.assertEqual(
                        phase_payload["resource_allocation"]["cpu_budget"],
                        2,
                    )
                    self.assertIsNotNone(
                        phase_payload["fingerprints"]["selected_cells_sha256"]
                    )
                    if run_id == "run-1":
                        self.assertEqual(phase_payload["input_cache"]["misses"], 1)
                    else:
                        self.assertGreaterEqual(
                            phase_payload["input_cache"]["hits"],
                            1,
                        )
            finally:
                worker.stop(force=True)


if __name__ == "__main__":
    unittest.main()
