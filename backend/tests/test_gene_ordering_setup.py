from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.job_service import prepare_project_dataset_for_algorithms


class GeneOrderingSetupTests(unittest.TestCase):
    def test_uploaded_source_requires_saved_gene_ordering_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            projects_root = Path(temp_dir)
            project_id = "missing-gene-ordering"
            job_id = "job-1"
            project_dir = projects_root / project_id
            project_dir.mkdir()

            expression_path = project_dir / "expression.csv"
            expression_path.write_text(
                ",cell-1,cell-2\nGENE1,1,2\nGENE2,3,4\n",
                encoding="utf-8",
            )
            project_manifest = {
                "project_id": project_id,
                "expression_path": str(expression_path),
                "gene_ordering_path": None,
                "preprocessing": {
                    "schema_version": 1,
                    "matrix_state": "raw",
                    "dataset_species": "human",
                    "enabled_stages": ["trajectory"],
                    "detection": {
                        "enabled": False,
                        "minimum_cell_percent": 10,
                    },
                    "trajectory": {
                        "enabled": True,
                        "gene_ordering_source": "upload",
                        "gene_ordering_filename": "GeneOrdering.csv",
                        "p_value_threshold": 0.01,
                        "bonferroni_correction": True,
                        "retain_significant_tfs": True,
                    },
                    "variance": {
                        "enabled": False,
                        "gene_count": 500,
                        "include_known_tfs": True,
                    },
                },
            }
            jobs_manifest = [
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
            (project_dir / "project.json").write_text(
                json.dumps(project_manifest),
                encoding="utf-8",
            )
            (project_dir / "metadata.json").write_text(
                json.dumps({"project_id": project_id}),
                encoding="utf-8",
            )
            (project_dir / "jobs.json").write_text(
                json.dumps(jobs_manifest),
                encoding="utf-8",
            )

            with patch("app.services.job_service.PROJECTS_ROOT", projects_root):
                prepared = prepare_project_dataset_for_algorithms(project_id, job_id)

            saved_project = json.loads(
                (project_dir / "project.json").read_text(encoding="utf-8")
            )
            saved_job = json.loads(
                (project_dir / "jobs.json").read_text(encoding="utf-8")
            )[0]

        self.assertFalse(prepared)
        self.assertEqual(
            saved_project["gene_ordering_validation"]["status"],
            "failed",
        )
        self.assertEqual(saved_job["overall_status"], "SetupFailed")
        self.assertEqual(
            saved_job["setup_error_type"],
            "gene_ordering_validation",
        )


if __name__ == "__main__":
    unittest.main()
