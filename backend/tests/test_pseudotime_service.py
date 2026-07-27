import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

from app.services import beeline_service, pseudotime_service


class PseudotimeServiceTests(unittest.TestCase):
    @staticmethod
    def write_expression(path: Path, values: list[list[float]]) -> None:
        pd.DataFrame(
            values,
            index=["GeneA", "GeneB"],
            columns=["Cell1", "Cell2", "Cell3"],
        ).to_csv(path, index_label="gene")

    def test_matrix_states_apply_the_shared_grnscope_contract(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)

            raw_source = root / "raw.csv"
            self.write_expression(raw_source, [[1, 2, 3], [3, 2, 1]])
            raw_output = root / "raw-output.csv"
            raw_transformation = pseudotime_service.prepare_pseudotime_expression(
                {
                    "expression_path": str(raw_source),
                    "preprocessing": {"matrix_state": "raw"},
                },
                raw_output,
            )
            raw_values = pd.read_csv(raw_output, index_col=0)
            np.testing.assert_allclose(
                np.expm1(raw_values).sum(axis=0).to_numpy(),
                [10_000.0, 10_000.0, 10_000.0],
                rtol=1e-6,
            )
            self.assertEqual(
                raw_transformation["operations"],
                ["normalize_total", "log1p"],
            )

            normalized_source = root / "normalized.csv"
            self.write_expression(normalized_source, [[1, 2, 3], [4, 5, 6]])
            normalized_output = root / "normalized-output.csv"
            normalized_transformation = (
                pseudotime_service.prepare_pseudotime_expression(
                    {
                        "expression_path": str(normalized_source),
                        "preprocessing": {"matrix_state": "normalized"},
                    },
                    normalized_output,
                )
            )
            np.testing.assert_allclose(
                pd.read_csv(normalized_output, index_col=0).to_numpy(),
                np.log1p(
                    pd.read_csv(normalized_source, index_col=0).to_numpy()
                ),
            )
            self.assertEqual(normalized_transformation["operations"], ["log1p"])

            logged_source = root / "logged.csv"
            logged_values = [[0.2, 0.4, 0.6], [1.1, 1.3, 1.5]]
            self.write_expression(logged_source, logged_values)
            logged_output = root / "logged-output.csv"
            logged_transformation = (
                pseudotime_service.prepare_pseudotime_expression(
                    {
                        "expression_path": str(logged_source),
                        "preprocessing": {"matrix_state": "log_normalized"},
                    },
                    logged_output,
                )
            )
            pd.testing.assert_frame_equal(
                pd.read_csv(logged_output, index_col=0),
                pd.read_csv(logged_source, index_col=0),
            )
            self.assertEqual(logged_transformation["operations"], [])

    def test_estimation_mounts_the_current_runner_and_disables_further_logging(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            projects_root = Path(temporary_directory) / "projects"
            project_dir = projects_root / "project-1"
            project_dir.mkdir(parents=True)
            expression_path = project_dir / "uploaded.csv"
            self.write_expression(expression_path, [[1, 2, 3], [3, 2, 1]])
            manifest = {
                "project_id": "project-1",
                "expression_path": str(expression_path),
                "cluster_labels_path": None,
                "pseudotime_path": None,
                "pseudotime_estimated": False,
                "preprocessing": {"matrix_state": "raw"},
            }
            (project_dir / "project.json").write_text(
                json.dumps(manifest),
                encoding="utf-8",
            )
            signature = pseudotime_service.build_pseudotime_input_signature(
                manifest,
                start_cluster=None,
            )
            (project_dir / pseudotime_service.STATUS_FILENAME).write_text(
                json.dumps(
                    {
                        "status": "Running",
                        "start_cluster": None,
                        "estimated": True,
                        "input_signature": signature,
                    }
                ),
                encoding="utf-8",
            )

            beeline_root = Path(temporary_directory) / "beeline"
            slingshot_dir = beeline_root / "Algorithms" / "SLINGSHOT"
            slingshot_dir.mkdir(parents=True)
            (slingshot_dir / "estimate_pseudotime.R").write_text(
                "# test runner\n",
                encoding="utf-8",
            )
            observed = {}

            def fake_run(command, **_kwargs):
                observed["command"] = command
                runtime_expression = (
                    project_dir
                    / pseudotime_service.RUNTIME_DIRNAME
                    / "ExpressionData.csv"
                )
                observed["expression"] = pd.read_csv(
                    runtime_expression,
                    index_col=0,
                )
                (
                    project_dir
                    / pseudotime_service.RUNTIME_DIRNAME
                    / "PseudoTime.csv"
                ).write_text(
                    ",PseudoTime1\nCell1,0\nCell2,0.5\nCell3,1\n",
                    encoding="utf-8",
                )
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout="Recovered 1 lineage across 3 cells\n",
                    stderr="",
                )

            with (
                patch.object(pseudotime_service, "PROJECTS_ROOT", projects_root),
                patch.object(
                    beeline_service,
                    "resolve_beeline_root",
                    return_value=beeline_root,
                ),
                patch.object(
                    pseudotime_service.subprocess,
                    "run",
                    side_effect=fake_run,
                ),
            ):
                pseudotime_service.run_pseudotime_estimation_task("project-1")

            command = observed["command"]
            self.assertIn("--entrypoint", command)
            self.assertIn("Rscript", command)
            self.assertIn("--matrixState", command)
            self.assertEqual(
                command[command.index("--matrixState") + 1],
                "log_normalized",
            )
            np.testing.assert_allclose(
                np.expm1(observed["expression"]).sum(axis=0).to_numpy(),
                [10_000.0, 10_000.0, 10_000.0],
                rtol=1e-6,
            )
            completed_status = json.loads(
                (project_dir / pseudotime_service.STATUS_FILENAME).read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(completed_status["status"], "Completed")
            self.assertEqual(
                completed_status["input_signature"]["version"],
                pseudotime_service.PSEUDOTIME_INPUT_CONTRACT_VERSION,
            )
            saved_manifest = json.loads(
                (project_dir / "project.json").read_text(encoding="utf-8")
            )
            self.assertTrue(saved_manifest["pseudotime_estimated"])
            self.assertEqual(
                saved_manifest["pseudotime_input_contract"]["version"],
                pseudotime_service.PSEUDOTIME_INPUT_CONTRACT_VERSION,
            )

    def test_uploaded_pseudotime_is_current_without_an_estimation_contract(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = Path(temporary_directory)
            expression_path = project_dir / "expression.csv"
            pseudotime_path = project_dir / "uploaded-pseudotime.csv"
            self.write_expression(expression_path, [[1, 2, 3], [3, 2, 1]])
            pseudotime_path.write_text(
                "pseudotime\n0\n0.5\n1\n",
                encoding="utf-8",
            )
            manifest = {
                "expression_path": str(expression_path),
                "pseudotime_path": str(pseudotime_path),
                "pseudotime_estimated": False,
                "preprocessing": {"matrix_state": "raw"},
            }

            self.assertTrue(
                pseudotime_service.estimated_pseudotime_is_current(
                    project_dir,
                    manifest,
                )
            )

    def test_legacy_estimated_pseudotime_is_not_current(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = Path(temporary_directory)
            expression_path = project_dir / "expression.csv"
            pseudotime_path = project_dir / "PseudoTime.csv"
            self.write_expression(expression_path, [[1, 2, 3], [3, 2, 1]])
            pseudotime_path.write_text(
                "pseudotime\n0\n0.5\n1\n",
                encoding="utf-8",
            )
            manifest = {
                "expression_path": str(expression_path),
                "pseudotime_path": str(pseudotime_path),
                "pseudotime_estimated": True,
                "preprocessing": {"matrix_state": "raw"},
            }

            self.assertFalse(
                pseudotime_service.estimated_pseudotime_is_current(
                    project_dir,
                    manifest,
                    {"status": "Completed", "estimated": True},
                )
            )

    def test_ensure_reruns_legacy_estimate_but_preserves_uploaded_pseudotime(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            projects_root = Path(temporary_directory) / "projects"
            project_dir = projects_root / "project-1"
            project_dir.mkdir(parents=True)
            expression_path = project_dir / "expression.csv"
            old_pseudotime = project_dir / "PseudoTime.csv"
            self.write_expression(expression_path, [[1, 2, 3], [3, 2, 1]])
            old_pseudotime.write_text(
                "pseudotime\n0\n0.5\n1\n",
                encoding="utf-8",
            )
            manifest = {
                "project_id": "project-1",
                "expression_path": str(expression_path),
                "pseudotime_path": str(old_pseudotime),
                "pseudotime_estimated": True,
                "preprocessing": {"matrix_state": "raw"},
            }
            (project_dir / "project.json").write_text(
                json.dumps(manifest),
                encoding="utf-8",
            )
            (project_dir / pseudotime_service.STATUS_FILENAME).write_text(
                json.dumps({"status": "Completed", "estimated": True}),
                encoding="utf-8",
            )
            rerun_calls = []

            def fake_estimation(project_id):
                rerun_calls.append(project_id)
                active_manifest = json.loads(
                    (project_dir / "project.json").read_text(encoding="utf-8")
                )
                self.assertIsNone(active_manifest["pseudotime_path"])
                destination = project_dir / "PseudoTime.csv"
                destination.write_text(
                    "pseudotime\n0\n0.4\n1\n",
                    encoding="utf-8",
                )
                signature = pseudotime_service.build_pseudotime_input_signature(
                    active_manifest,
                    start_cluster=None,
                )
                pseudotime_service._finalize_success(
                    project_dir,
                    destination,
                    1,
                    input_signature=signature,
                    transformation=signature["matrix_transformation"],
                )

            with (
                patch.object(pseudotime_service, "PROJECTS_ROOT", projects_root),
                patch.object(
                    pseudotime_service,
                    "run_pseudotime_estimation_task",
                    side_effect=fake_estimation,
                ),
            ):
                self.assertTrue(
                    pseudotime_service.ensure_estimated_pseudotime("project-1")
                )
            self.assertEqual(rerun_calls, ["project-1"])

            uploaded_path = project_dir / "uploaded.csv"
            uploaded_path.write_text(
                "pseudotime\n0\n0.2\n1\n",
                encoding="utf-8",
            )
            uploaded_manifest = json.loads(
                (project_dir / "project.json").read_text(encoding="utf-8")
            )
            uploaded_manifest["pseudotime_path"] = str(uploaded_path)
            uploaded_manifest["pseudotime_estimated"] = False
            (project_dir / "project.json").write_text(
                json.dumps(uploaded_manifest),
                encoding="utf-8",
            )

            with (
                patch.object(pseudotime_service, "PROJECTS_ROOT", projects_root),
                patch.object(
                    pseudotime_service,
                    "run_pseudotime_estimation_task",
                ) as estimate_mock,
            ):
                self.assertTrue(
                    pseudotime_service.ensure_estimated_pseudotime("project-1")
                )
            estimate_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
