import json
import tempfile
import unittest
from pathlib import Path

from app.services.perturbation_service import (
    celloracle_availability,
    create_perturbation_run,
    eligible_perturbation_genes,
    get_perturbation_state,
)


class PerturbationServiceTests(unittest.TestCase):
    def make_completed_project(self, root: Path) -> Path:
        project_dir = root / "project-123"
        result_dir = project_dir / "results" / "CELLORACLE"
        result_dir.mkdir(parents=True)
        ranked_path = result_dir / "rankedEdges.csv"
        ranked_path.write_text(
            "Gene1\tGene2\tEdgeWeight\n"
            "GATA1\tKLF1\t0.82\n"
            "GATA1\tHBB\t0.44\n"
            "SPI1\tCEBPA\t-0.61\n",
            encoding="utf-8",
        )
        (result_dir / "result.json").write_text(
            json.dumps(
                {
                    "algorithm_id": "CELLORACLE",
                    "status": "Completed",
                    "ranked_edges_path": str(ranked_path),
                }
            ),
            encoding="utf-8",
        )
        (project_dir / "jobs.json").write_text(
            json.dumps(
                [
                    {
                        "job_id": "job-1",
                        "tasks": [
                            {"algorithm_id": "CELLORACLE", "status": "Completed"}
                        ],
                    }
                ]
            ),
            encoding="utf-8",
        )
        return project_dir

    def test_completed_celloracle_exposes_regulators_ranked_by_outgoing_edges(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = self.make_completed_project(Path(temporary_directory))

            available, reason = celloracle_availability(project_dir)

            self.assertTrue(available)
            self.assertIsNone(reason)
            self.assertEqual(
                eligible_perturbation_genes(project_dir),
                ["GATA1", "SPI1"],
            )

    def test_creates_queued_run_and_reports_it_in_state(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = self.make_completed_project(Path(temporary_directory))

            run = create_perturbation_run(
                project_dir,
                gene="GATA1",
                perturbation_value=0,
                n_propagation=3,
                clip_delta_x=False,
            )
            state = get_perturbation_state(project_dir)

            self.assertEqual(run["status"], "Queued")
            self.assertTrue(state["available"])
            self.assertEqual(state["runs"][0]["run_id"], run["run_id"])
            self.assertIsNone(state["latest_result"])

    def test_rejects_gene_that_is_not_a_celloracle_regulator(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = self.make_completed_project(Path(temporary_directory))

            with self.assertRaisesRegex(ValueError, "not a regulator"):
                create_perturbation_run(
                    project_dir,
                    gene="HBB",
                    perturbation_value=0,
                    n_propagation=3,
                    clip_delta_x=False,
                )


if __name__ == "__main__":
    unittest.main()
