import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import zipfile
from io import BytesIO

from app.services.run_manifest_service import (
    backfill_terminal_run_manifests,
    build_run_manifest_zip,
    generate_run_manifest,
    latest_run_manifest_path,
    list_run_manifest_paths,
)


class RunManifestServiceTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.project_dir = Path(self.temporary_directory.name) / "project-123"
        self.project_dir.mkdir()

        self.expression = self.project_dir / "expression__input.csv"
        self.expression.write_text(
            "gene,cell-1,cell-2\nA,1,2\nB,3,4\nC,5,6\n",
            encoding="utf-8",
        )
        self.pseudotime = self.project_dir / "pseudotime__input.csv"
        self.pseudotime.write_text(
            "cell,pseudotime\ncell-1,0\ncell-2,1\n",
            encoding="utf-8",
        )
        preprocessed_dir = self.project_dir / "preprocessed"
        preprocessed_dir.mkdir()
        self.preprocessed = preprocessed_dir / "ExpressionData.csv"
        self.preprocessed.write_text(
            "gene,cell-1,cell-2\nA,1,2\nC,5,6\n",
            encoding="utf-8",
        )
        (preprocessed_dir / "manifest.json").write_text(
            json.dumps(
                {
                    "signature": {
                        "matrix_transformation": {
                            "engine": "grnscope",
                            "version": 1,
                            "matrix_state": "raw_counts",
                            "operations": ["normalize_total", "log1p"],
                            "normalization_target_sum": 10000,
                        }
                    },
                    "transformation": {
                        "input_state": "raw_counts",
                        "output_state": "log_normalized",
                        "operations": ["normalize_total", "log1p"],
                    },
                    "gene_selection": [
                        {
                            "stage": "variance",
                            "input_gene_count": 3,
                            "retained_gene_count": 2,
                        }
                    ],
                    "preprocessed_expression_path": str(self.preprocessed),
                }
            ),
            encoding="utf-8",
        )
        audit_dir = preprocessed_dir / "gene_selection_audits"
        audit_dir.mkdir()
        (audit_dir / "variance.json").write_text(
            json.dumps(
                {
                    "stage": "variance",
                    "input_gene_count": 3,
                    "retained_gene_count": 2,
                    "removed_gene_count": 1,
                    "retained_gene_names": ["A", "C"],
                    "removed_gene_names": ["B"],
                }
            ),
            encoding="utf-8",
        )
        (self.project_dir / "project.json").write_text(
            json.dumps(
                {
                    "project_id": "project-123",
                    "owner_id": "must-not-leak",
                    "expression_path": str(self.expression),
                    "pseudotime_path": str(self.pseudotime),
                    "preprocessed_expression_path": str(self.preprocessed),
                    "preprocessing": {
                        "matrix_state": "raw_counts",
                        "variance": {"enabled": True, "gene_count": 2},
                    },
                    "pseudotime_estimated": False,
                }
            ),
            encoding="utf-8",
        )
        (self.project_dir / "metadata.json").write_text(
            json.dumps(
                {
                    "expression_filename": "input.csv",
                    "pseudotime_filename": "pseudotime.csv",
                    "gene_names": ["A", "B", "C"],
                    "has_pseudotime": True,
                }
            ),
            encoding="utf-8",
        )
        (self.project_dir / "jobs.json").write_text(
            json.dumps(
                [
                    {
                        "job_id": "job-1",
                        "resolved_algorithm_parameters": {
                            "GENIE3": {"nEstimators": 400, "seed": 9}
                        },
                        "tasks": [
                            {
                                "algorithm_id": "GENIE3",
                                "status": "Completed",
                                "run_metadata": {
                                    "run-1": {
                                        "seed": 101,
                                        "status": "Completed",
                                        "cell_count": 2,
                                        "gene_count": 1,
                                        "elapsed_seconds": 4,
                                    }
                                },
                            }
                        ],
                    }
                ]
            ),
            encoding="utf-8",
        )

    def tearDown(self):
        self.temporary_directory.cleanup()

    @patch("app.services.run_manifest_service._docker_digest", return_value="sha256:abc")
    @patch(
        "app.services.run_manifest_service._software_versions",
        return_value={"python": "test", "grnscope_git_commit": "commit"},
    )
    def test_completed_manifest_contains_required_provenance(self, _versions, _digest):
        artifact_dir = (
            self.project_dir
            / "results"
            / "GENIE3"
            / "attempts"
            / "attempt-1"
        )
        (artifact_dir / "logs").mkdir(parents=True)
        (artifact_dir / "logs" / "stderr.log").write_text(
            f"working in {self.project_dir}\n", encoding="utf-8"
        )
        (artifact_dir / "rankedEdges.csv").write_text(
            "Gene1\tGene2\tEdgeWeight\nA\tC\t0.9\n",
            encoding="utf-8",
        )
        run_result = artifact_dir / "runs" / "run-1" / "rankedEdges.csv"
        run_result.parent.mkdir(parents=True)
        run_result.write_text(
            "Gene1\tGene2\tEdgeWeight\nA\tC\t0.8\n",
            encoding="utf-8",
        )
        (artifact_dir / "gene_selection_audit.json").write_text(
            json.dumps(
                {
                    "retained_gene_names": ["A"],
                    "removed_gene_names": ["C"],
                    "input_gene_count": 2,
                    "retained_gene_count": 1,
                }
            ),
            encoding="utf-8",
        )
        result_path = self.project_dir / "results" / "GENIE3" / "result.json"
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(
            json.dumps(
                {
                    "job_id": "internal-job-id",
                    "algorithm_parameters": {"nEstimators": 400, "seed": 9},
                    "result_artifact_root": str(artifact_dir),
                }
            ),
            encoding="utf-8",
        )

        manifest_path = generate_run_manifest(
            self.project_dir,
            "job-1",
            "GENIE3",
            status="Completed",
            started_at_timestamp=100,
            completed_at_timestamp=107,
            elapsed_seconds=7,
            result_path=result_path,
            artifact_dir=artifact_dir,
        )
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        self.assertEqual(manifest["schema"]["version"], "2.0.0")
        self.assertNotIn("attempt_id", manifest["identity"])
        expression_input = next(
            item
            for item in manifest["inputs"]["files"]
            if item["role"] == "expression_matrix"
        )
        self.assertEqual(
            expression_input["sha256"],
            hashlib.sha256(self.expression.read_bytes()).hexdigest(),
        )
        self.assertEqual(
            manifest["matrix_and_preprocessing"]["operations"],
            ["normalize_total", "log1p"],
        )
        self.assertEqual(manifest["genes"]["before_filtering"]["genes"], ["A", "B", "C"])
        self.assertEqual(manifest["genes"]["after_project_filtering"]["genes"], ["A", "C"])
        self.assertEqual(manifest["genes"]["after_algorithm_filtering"]["genes"], ["A"])
        self.assertEqual(manifest["execution"]["container"]["digest"], "sha256:abc")
        self.assertEqual(manifest["execution"]["random_seeds"][0]["seed"], 101)
        self.assertEqual(manifest["pseudotime"]["source"], "uploaded")
        self.assertEqual(manifest["runtime"]["elapsed_seconds"], 7)
        self.assertTrue(manifest["results"]["all_runs_included"])
        self.assertEqual(manifest["results"]["run_result_count"], 1)
        self.assertIsNone(manifest["failure"])

        serialized = manifest_path.read_text(encoding="utf-8")
        self.assertNotIn(str(self.project_dir), serialized)
        copied_log = manifest_path.parent / "artifacts" / "logs" / "stderr.log"
        self.assertIn("${PROJECT_DIR}", copied_log.read_text(encoding="utf-8"))
        portable_result_summary = json.loads(
            (manifest_path.parent / "results" / "result_summary.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertNotIn("job_id", portable_result_summary)
        self.assertNotIn("result_artifact_root", portable_result_summary)

        archive = zipfile.ZipFile(BytesIO(build_run_manifest_zip([manifest_path])))
        self.assertFalse(any("attempt-" in name for name in archive.namelist()))
        self.assertIn(
            "project-123_run-manifests/README.txt",
            archive.namelist(),
        )
        self.assertIn(
            "project-123_run-manifests/project_manifest.json",
            archive.namelist(),
        )
        self.assertIn(
            "project-123_run-manifests/inputs/original/expression/input.csv",
            archive.namelist(),
        )
        self.assertIn(
            "project-123_run-manifests/inputs/original/pseudotime/pseudotime.csv",
            archive.namelist(),
        )
        self.assertIn(
            "project-123_run-manifests/inputs/preprocessed/ExpressionData.csv",
            archive.namelist(),
        )
        self.assertIn(
            "project-123_run-manifests/inputs/preprocessed/manifest.json",
            archive.namelist(),
        )
        self.assertIn(
            "project-123_run-manifests/algorithms/GENIE3/run_manifest.json",
            archive.namelist(),
        )
        self.assertIn(
            "project-123_run-manifests/algorithms/GENIE3/results/rankedEdges.csv",
            archive.namelist(),
        )
        self.assertIn(
            "project-123_run-manifests/algorithms/GENIE3/results/runs/run-1/rankedEdges.csv",
            archive.namelist(),
        )
        self.assertIn(
            "project-123_run-manifests/algorithms/GENIE3/artifacts/logs/stderr.log",
            archive.namelist(),
        )
        self.assertEqual(
            archive.read(
                "project-123_run-manifests/inputs/original/expression/input.csv"
            ),
            self.expression.read_bytes(),
        )
        bundled_preprocessing_manifest = archive.read(
            "project-123_run-manifests/inputs/preprocessed/manifest.json"
        ).decode("utf-8")
        self.assertNotIn(str(self.project_dir), bundled_preprocessing_manifest)
        project_summary = json.loads(
            archive.read(
                "project-123_run-manifests/project_manifest.json"
            ).decode("utf-8")
        )
        self.assertEqual(
            set(project_summary),
            {"project", "exported_at", "dataset", "files", "algorithms"},
        )
        self.assertNotIn("id", project_summary["project"])
        self.assertEqual(
            project_summary["dataset"]["preprocessing_steps"],
            ["normalize_total", "log1p", "variance"],
        )
        self.assertEqual(
            project_summary["dataset"]["gene_count_before_filtering"], 3
        )
        self.assertEqual(
            project_summary["dataset"]["gene_count_after_filtering"], 2
        )
        self.assertEqual(project_summary["files"]["checksum_algorithm"], "sha256")
        self.assertEqual(len(project_summary["files"]["original_uploads"]), 2)
        self.assertGreaterEqual(len(project_summary["files"]["preprocessed"]), 3)
        first_bundled_file = project_summary["files"]["original_uploads"][0]
        self.assertEqual(
            set(first_bundled_file),
            {"role", "path", "size_bytes", "sha256"},
        )
        self.assertEqual(project_summary["algorithms"][0]["id"], "GENIE3")
        self.assertEqual(project_summary["algorithms"][0]["result_run_count"], 1)

    @patch("app.services.run_manifest_service._docker_digest", return_value=None)
    @patch("app.services.run_manifest_service._software_versions", return_value={})
    def test_new_result_replaces_attempt_layout(self, _versions, _digest):
        diagnostics_dir = self.project_dir / "diagnostics" / "GENIE3" / "job-1" / "attempt-a"
        diagnostics_dir.mkdir(parents=True)
        error_path = diagnostics_dir / "error.json"
        error_path.write_text(
            json.dumps({"error_message": "/Users/private/run failed"}),
            encoding="utf-8",
        )

        first = generate_run_manifest(
            self.project_dir,
            "job-1",
            "GENIE3",
            status="Failed",
            started_at_timestamp=100,
            completed_at_timestamp=101,
            elapsed_seconds=1,
            diagnostics_path=error_path,
            error_message="container failed",
            error_type="algorithm",
        )
        first_payload = json.loads(first.read_text(encoding="utf-8"))
        self.assertTrue(first_payload["failure"]["logs_included"])
        copied_error = first.parent / "diagnostics" / "error.json"
        self.assertTrue(copied_error.is_file())
        self.assertNotIn("/Users/private", copied_error.read_text(encoding="utf-8"))

        second = generate_run_manifest(
            self.project_dir,
            "job-1",
            "GENIE3",
            status="Stopped",
            started_at_timestamp=102,
            completed_at_timestamp=103,
            elapsed_seconds=1,
            error_message="Algorithm run was stopped.",
            error_type="stopped",
        )

        self.assertEqual(first, second)
        self.assertEqual(second.parent.name, "GENIE3")
        self.assertNotIn("attempt-b", second.as_posix())
        second_payload = json.loads(second.read_text(encoding="utf-8"))
        self.assertEqual(second_payload["identity"]["status"], "Stopped")
        self.assertNotIn("attempt_id", second_payload["identity"])
        self.assertFalse((second.parent / "diagnostics").exists())
        self.assertEqual(
            list_run_manifest_paths(self.project_dir, job_id="job-1"),
            [second],
        )
        self.assertEqual(
            latest_run_manifest_path(
                self.project_dir,
                "GENIE3",
                job_id="job-1",
            ),
            second,
        )

    @patch("app.services.run_manifest_service._docker_digest", return_value=None)
    @patch("app.services.run_manifest_service._software_versions", return_value={})
    def test_backfills_a_terminal_result_created_before_manifests(self, _versions, _digest):
        generated = backfill_terminal_run_manifests(
            self.project_dir,
            job_id="job-1",
            algorithm_id="GENIE3",
        )

        self.assertEqual(len(generated), 1)
        self.assertEqual(generated[0].parent.name, "GENIE3")
        payload = json.loads(generated[0].read_text(encoding="utf-8"))
        self.assertEqual(payload["identity"]["status"], "Completed")
        self.assertNotIn("attempt_id", payload["identity"])
        self.assertEqual(backfill_terminal_run_manifests(self.project_dir, job_id="job-1"), [])

    @patch("app.services.run_manifest_service._docker_digest", return_value=None)
    @patch("app.services.run_manifest_service._software_versions", return_value={})
    def test_migrates_legacy_attempt_folder_to_algorithm_folder(self, _versions, _digest):
        legacy_dir = (
            self.project_dir
            / "run_manifests"
            / "job-1"
            / "GENIE3"
            / "attempt-old"
        )
        legacy_dir.mkdir(parents=True)
        (legacy_dir / "manifest.json").write_text(
            json.dumps(
                {
                    "identity": {
                        "algorithm_id": "GENIE3",
                        "attempt_id": "attempt-old",
                    }
                }
            ),
            encoding="utf-8",
        )

        generated = backfill_terminal_run_manifests(
            self.project_dir,
            job_id="job-1",
            algorithm_id="GENIE3",
        )

        self.assertEqual(len(generated), 1)
        self.assertEqual(generated[0].parent.name, "GENIE3")
        self.assertFalse(legacy_dir.exists())
        self.assertNotIn(
            "attempt_id",
            json.loads(generated[0].read_text(encoding="utf-8"))["identity"],
        )


if __name__ == "__main__":
    unittest.main()
