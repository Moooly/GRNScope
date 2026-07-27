from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from app.services.beeline_service import PreprocessingRuntimeError
from app.services.job_service import prepare_project_dataset_for_algorithms


def _preprocessing_config() -> dict:
    return {
        "schema_version": 1,
        "matrix_state": "log_normalized",
        "dataset_species": "human",
        "enabled_stages": [],
        "detection": {"enabled": False, "minimum_cell_percent": 10},
        "trajectory": {
            "enabled": False,
            "gene_ordering_source": "calculate",
            "gene_ordering_filename": None,
            "p_value_threshold": 0.01,
            "bonferroni_correction": True,
            "retain_significant_tfs": True,
        },
        "variance": {
            "enabled": False,
            "gene_count": 500,
            "include_known_tfs": False,
        },
    }


def _write_project(root: Path, project_id: str, job_id: str) -> tuple[Path, Path]:
    project_dir = root / project_id
    project_dir.mkdir()
    expression = project_dir / "expression.csv"
    expression.write_text(",c1,c2\nG1,1,2\nG2,3,4\n", encoding="utf-8")
    manifest = {
        "project_id": project_id,
        "expression_path": str(expression),
        "preprocessing": _preprocessing_config(),
        "dataset_validation_status": "validated",
    }
    (project_dir / "project.json").write_text(json.dumps(manifest), encoding="utf-8")
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
                    "tasks": [{"algorithm_id": "PEARSON", "status": "Queued"}],
                }
            ]
        ),
        encoding="utf-8",
    )
    return project_dir, expression


class PreprocessingStatusTests(unittest.TestCase):
    def test_single_column_pseudotime_is_canonicalized_before_algorithms(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project_id = "canonical-pseudotime"
            job_id = "job-0"
            project_dir, _expression = _write_project(root, project_id, job_id)
            source_pseudotime = project_dir / "uploaded-pseudotime.csv"
            source_pseudotime.write_text(
                "pseudotime\n0\n1\n",
                encoding="utf-8",
            )
            project = json.loads(
                (project_dir / "project.json").read_text(encoding="utf-8")
            )
            project["pseudotime_path"] = str(source_pseudotime)
            project["pseudotime_estimated"] = False
            (project_dir / "project.json").write_text(
                json.dumps(project),
                encoding="utf-8",
            )

            preprocessed_dir = project_dir / "preprocessed"
            preprocessed_dir.mkdir()
            preprocessed_expression = preprocessed_dir / "ExpressionData.csv"
            preprocessed_expression.write_text(
                ",c1,c2\nG1,1,2\n",
                encoding="utf-8",
            )
            (preprocessed_dir / "manifest.json").write_text(
                json.dumps(
                    {
                        "created_at": 123.0,
                        "gene_count": 1,
                        "cell_count": 2,
                        "transformation": {"input_state": "log_normalized"},
                        "gene_selection": [],
                        "generated_gene_ordering": None,
                    }
                ),
                encoding="utf-8",
            )

            with (
                patch("app.services.job_service.PROJECTS_ROOT", root),
                patch(
                    "app.services.job_service.ensure_project_preprocessed_expression",
                    return_value=preprocessed_expression,
                ),
            ):
                prepared = prepare_project_dataset_for_algorithms(project_id, job_id)

            saved_project = json.loads(
                (project_dir / "project.json").read_text(encoding="utf-8")
            )
            canonical = Path(saved_project["pseudotime_path"])
            canonical_frame = pd.read_csv(
                canonical,
                index_col=0,
            )

        self.assertTrue(prepared)
        self.assertEqual(
            saved_project["pseudotime_source_path"],
            str(source_pseudotime),
        )
        self.assertEqual(list(canonical_frame.index), ["c1", "c2"])
        self.assertEqual(list(canonical_frame.columns), ["pseudotime"])
        self.assertEqual(
            saved_project["pseudotime_canonicalization"]["source_format"],
            "single_column",
        )

    def test_completed_preprocessing_is_persisted_in_both_manifests(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project_id = "status-complete"
            job_id = "job-1"
            project_dir, _expression = _write_project(root, project_id, job_id)
            preprocessed_dir = project_dir / "preprocessed"
            preprocessed_dir.mkdir()
            preprocessed_expression = preprocessed_dir / "ExpressionData.csv"
            preprocessed_expression.write_text(",c1,c2\nG1,1,2\n", encoding="utf-8")
            (preprocessed_dir / "manifest.json").write_text(
                json.dumps(
                    {
                        "created_at": 123.0,
                        "gene_count": 1,
                        "cell_count": 2,
                        "transformation": {"input_state": "log_normalized"},
                        "gene_selection": [],
                        "generated_gene_ordering": None,
                    }
                ),
                encoding="utf-8",
            )

            with (
                patch("app.services.job_service.PROJECTS_ROOT", root),
                patch(
                    "app.services.job_service.ensure_project_preprocessed_expression",
                    return_value=preprocessed_expression,
                ),
            ):
                prepared = prepare_project_dataset_for_algorithms(project_id, job_id)

            project = json.loads(
                (project_dir / "project.json").read_text(encoding="utf-8")
            )
            metadata = json.loads(
                (project_dir / "metadata.json").read_text(encoding="utf-8")
            )

        self.assertTrue(prepared)
        self.assertEqual(project["preprocessing_status"], "completed")
        self.assertEqual(metadata["preprocessing_status"], "completed")
        self.assertEqual(project["preprocessing_result"]["gene_count"], 1)
        self.assertEqual(metadata["preprocessing_result"]["cell_count"], 2)

    def test_preprocessing_failure_is_classified_and_persisted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project_id = "status-failed"
            job_id = "job-2"
            project_dir, _expression = _write_project(root, project_id, job_id)

            with (
                patch("app.services.job_service.PROJECTS_ROOT", root),
                patch(
                    "app.services.job_service.ensure_project_preprocessed_expression",
                    side_effect=PreprocessingRuntimeError("filter removed every gene"),
                ),
            ):
                prepared = prepare_project_dataset_for_algorithms(project_id, job_id)

            project = json.loads(
                (project_dir / "project.json").read_text(encoding="utf-8")
            )
            metadata = json.loads(
                (project_dir / "metadata.json").read_text(encoding="utf-8")
            )
            job = json.loads(
                (project_dir / "jobs.json").read_text(encoding="utf-8")
            )[0]

        self.assertFalse(prepared)
        self.assertEqual(project["preprocessing_status"], "failed")
        self.assertEqual(metadata["preprocessing_status"], "failed")
        self.assertEqual(project["preprocessing_error"], "filter removed every gene")
        self.assertEqual(job["setup_error_type"], "preprocessing")


if __name__ == "__main__":
    unittest.main()
