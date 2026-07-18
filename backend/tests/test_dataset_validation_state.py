import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.job_service import (
    prepare_project_dataset_for_algorithms,
    recompute_overall_status,
)


class DatasetValidationStateTests(unittest.TestCase):
    def test_invalid_matrix_stops_setup_before_algorithms_start(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            projects_root = Path(temp_dir)
            project_id = "invalid-matrix"
            job_id = "job-1"
            project_dir = projects_root / project_id
            project_dir.mkdir()

            expression_path = project_dir / "expression.csv"
            expression_path.write_text(
                ",cell-1,cell-2\nGENE1,1,not-a-number\n",
                encoding="utf-8",
            )
            project_manifest = {
                "project_id": project_id,
                "expression_path": str(expression_path),
                "preprocessed_expression_path": str(
                    project_dir / "preprocessed" / "ExpressionData.csv"
                ),
                "top_variable_genes": "all",
                "include_all_tfs": False,
                "normalize_enabled": True,
                "log_transform_enabled": True,
            }
            metadata_manifest = {"project_id": project_id}
            jobs_manifest = [
                {
                    "job_id": job_id,
                    "overall_status": "Queued",
                    "tasks": [
                        {
                            "algorithm_id": algorithm_id,
                            "status": "Queued",
                            "error_message": None,
                            "error_type": None,
                        }
                        for algorithm_id in ("GENIE3", "PEARSON")
                    ],
                }
            ]
            (project_dir / "project.json").write_text(
                json.dumps(project_manifest), encoding="utf-8"
            )
            (project_dir / "metadata.json").write_text(
                json.dumps(metadata_manifest), encoding="utf-8"
            )
            (project_dir / "jobs.json").write_text(
                json.dumps(jobs_manifest), encoding="utf-8"
            )

            with patch("app.services.job_service.PROJECTS_ROOT", projects_root):
                prepared = prepare_project_dataset_for_algorithms(project_id, job_id)
                recompute_overall_status(project_dir, job_id)

            saved_job = json.loads(
                (project_dir / "jobs.json").read_text(encoding="utf-8")
            )[0]
            saved_project = json.loads(
                (project_dir / "project.json").read_text(encoding="utf-8")
            )

        self.assertFalse(prepared)
        self.assertEqual(saved_job["overall_status"], "SetupFailed")
        self.assertEqual(saved_job["setup_error_type"], "matrix_validation")
        self.assertIn("row 2", saved_job["setup_error_message"])
        self.assertTrue(
            all(task["status"] == "NotStarted" for task in saved_job["tasks"])
        )
        self.assertTrue(
            all(task["error_message"] is None for task in saved_job["tasks"])
        )
        self.assertEqual(saved_project["dataset_validation_status"], "failed")
        self.assertEqual(
            saved_project["dataset_validation_issues"][0]["code"],
            "non_numeric_expression_value",
        )
        self.assertEqual(saved_project["dataset_validation_issues"][0]["count"], 1)

    def test_invalid_matrix_collects_multiple_grouped_issues(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            projects_root = Path(temp_dir)
            project_id = "multiple-matrix-issues"
            job_id = "job-2"
            project_dir = projects_root / project_id
            project_dir.mkdir()

            expression_path = project_dir / "expression.csv"
            expression_path.write_text(
                ",cell-1,,cell-1\n"
                ",1,missing,3\n"
                "GENE2,1,2\n"
                "GENE2,not-a-number,2,3\n",
                encoding="utf-8",
            )
            (project_dir / "project.json").write_text(
                json.dumps(
                    {
                        "project_id": project_id,
                        "expression_path": str(expression_path),
                        "preprocessed_expression_path": str(
                            project_dir / "preprocessed" / "ExpressionData.csv"
                        ),
                        "top_variable_genes": "all",
                        "include_all_tfs": False,
                        "normalize_enabled": True,
                        "log_transform_enabled": True,
                    }
                ),
                encoding="utf-8",
            )
            (project_dir / "metadata.json").write_text(
                json.dumps({"project_id": project_id}),
                encoding="utf-8",
            )
            (project_dir / "jobs.json").write_text(
                json.dumps(
                    [
                        {
                            "job_id": job_id,
                            "overall_status": "Queued",
                            "tasks": [
                                {
                                    "algorithm_id": "GENIE3",
                                    "status": "Queued",
                                    "error_message": None,
                                    "error_type": None,
                                }
                            ],
                        }
                    ]
                ),
                encoding="utf-8",
            )

            with patch("app.services.job_service.PROJECTS_ROOT", projects_root):
                prepared = prepare_project_dataset_for_algorithms(project_id, job_id)

            saved_project = json.loads(
                (project_dir / "project.json").read_text(encoding="utf-8")
            )
            issue_codes = {
                issue["code"] for issue in saved_project["dataset_validation_issues"]
            }
            report_rows = (
                project_dir / "matrix_validation_issues.csv"
            ).read_text(encoding="utf-8").splitlines()

        self.assertFalse(prepared)
        self.assertEqual(
            issue_codes,
            {
                "blank_cell_identifier",
                "duplicate_cell_identifier",
                "blank_gene_name",
                "non_numeric_expression_value",
                "inconsistent_row_length",
                "duplicate_gene_name",
            },
        )
        self.assertEqual(len(report_rows), 8)


if __name__ == "__main__":
    unittest.main()
