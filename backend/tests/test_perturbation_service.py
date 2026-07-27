import csv
import json
import tempfile
import unittest
from pathlib import Path

from app.services.perturbation_service import (
    celloracle_availability,
    create_perturbation_run,
    eligible_perturbation_genes,
    get_gene_expression_profile,
    get_perturbation_result,
    get_perturbation_state,
    perturbation_download_path,
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
        expression_path = project_dir / "ExpressionData.csv"
        expression_path.write_text(
            "gene,cell-1,cell-2,cell-3,cell-4\n"
            "GATA1,0,1,2,5\n"
            "SPI1,0,0,3,3\n"
            "KLF1,1,2,3,4\n"
            "HBB,2,2,2,2\n"
            "CEBPA,1,1,1,1\n",
            encoding="utf-8",
        )
        (project_dir / "project.json").write_text(
            json.dumps(
                {
                    "project_id": "project-123",
                    "expression_path": str(expression_path),
                    "cluster_labels_path": None,
                }
            ),
            encoding="utf-8",
        )
        (result_dir / "result.json").write_text(
            json.dumps(
                {
                    "algorithm_id": "CELLORACLE",
                    "status": "Completed",
                    "ranked_edges_path": str(ranked_path),
                    "expression_contract": {
                        "version": 2,
                        "mode": "raw_count",
                    },
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

    def test_legacy_celloracle_result_requires_one_corrected_rerun(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = self.make_completed_project(Path(temporary_directory))
            result_path = project_dir / "results" / "CELLORACLE" / "result.json"
            result = json.loads(result_path.read_text(encoding="utf-8"))
            result.pop("expression_contract")
            result_path.write_text(json.dumps(result), encoding="utf-8")

            available, reason = celloracle_availability(project_dir)

            self.assertFalse(available)
            self.assertIn("must be rerun", str(reason))

    def test_expression_profile_reports_observed_distribution_for_regulator(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = self.make_completed_project(Path(temporary_directory))

            profile = get_gene_expression_profile(project_dir, "GATA1")

            self.assertEqual(profile["minimum"], 0)
            self.assertEqual(profile["maximum"], 5)
            self.assertEqual(profile["safe_upper_limit"], 10)
            self.assertEqual(profile["median"], 1.5)
            self.assertEqual(profile["nonzero_fraction"], 0.75)
            self.assertEqual(sum(row["count"] for row in profile["histogram"]), 4)

    def test_expression_profile_prefers_celloracle_imputed_safe_limit(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = self.make_completed_project(Path(temporary_directory))
            model_dir = project_dir / "perturbations" / "model"
            model_dir.mkdir(parents=True)
            (model_dir / "expression_limits.json").write_text(
                json.dumps(
                    {
                        "source": "celloracle_imputed_count",
                        "genes": {"GATA1": {"safe_upper_limit": 7.25}},
                    }
                ),
                encoding="utf-8",
            )

            profile = get_gene_expression_profile(project_dir, "GATA1")

            self.assertEqual(profile["safe_upper_limit"], 7.25)
            self.assertEqual(profile["limit_source"], "celloracle_imputed_count")

    def test_cluster_network_regulators_are_included_in_eligible_genes(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = self.make_completed_project(Path(temporary_directory))
            result_path = project_dir / "results" / "CELLORACLE" / "result.json"
            result = json.loads(result_path.read_text(encoding="utf-8"))
            cluster_edges = result_path.parent / "cluster-a.csv"
            cluster_edges.write_text(
                "Gene1\tGene2\tEdgeWeight\nRUNX1\tKLF1\t0.7\n",
                encoding="utf-8",
            )
            result["scopes"] = {
                "global": {
                    "scope_type": "global",
                    "scope_label": "Global",
                    "status": "Completed",
                    "ranked_edges_path": result["ranked_edges_path"],
                },
                "cluster-a": {
                    "scope_type": "cluster",
                    "scope_label": "Cluster A",
                    "status": "Completed",
                    "ranked_edges_path": str(cluster_edges),
                },
            }
            result_path.write_text(json.dumps(result), encoding="utf-8")

            self.assertIn("RUNX1", eligible_perturbation_genes(project_dir))

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

    def test_rejects_target_expression_above_gene_specific_safe_limit(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = self.make_completed_project(Path(temporary_directory))

            with self.assertRaisesRegex(ValueError, "safe upper limit"):
                create_perturbation_run(
                    project_dir,
                    gene="GATA1",
                    perturbation_value=10.01,
                    n_propagation=3,
                    clip_delta_x=False,
                )

    def test_loads_a_completed_saved_result_by_run_id(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = self.make_completed_project(Path(temporary_directory))
            run = create_perturbation_run(
                project_dir,
                gene="GATA1",
                perturbation_value=0,
                n_propagation=3,
                clip_delta_x=False,
            )
            run_dir = project_dir / "perturbations" / "runs" / run["run_id"]
            status = json.loads((run_dir / "status.json").read_text(encoding="utf-8"))
            status.update({"status": "Completed", "completed_at": "2026-07-14T21:00:00+00:00"})
            (run_dir / "status.json").write_text(json.dumps(status), encoding="utf-8")
            (run_dir / "result.json").write_text(
                json.dumps({"gene": "GATA1", "perturbation_value": 0}),
                encoding="utf-8",
            )

            result = get_perturbation_result(project_dir, run["run_id"])

            self.assertEqual(result["run_id"], run["run_id"])
            self.assertEqual(result["gene"], "GATA1")
            self.assertEqual(result["completed_at"], "2026-07-14T21:00:00+00:00")

    def test_cell_shift_download_adds_predicted_to_randomized_distance(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = self.make_completed_project(Path(temporary_directory))
            run_id = "run-with-shifts"
            run_dir = project_dir / "perturbations" / "runs" / run_id
            run_dir.mkdir(parents=True)
            shifts_path = run_dir / "cell_shifts.csv"
            shifts_path.write_text(
                "cell_id,cluster,embedding_x,embedding_y,shift_x,shift_y,random_shift_x,random_shift_y\n"
                "cell-1,A,10,20,3,4,0,0\n"
                "cell-2,B,-2,5,2,1,5,5\n",
                encoding="utf-8",
            )

            path = perturbation_download_path(project_dir, run_id, "cell_shifts.csv")
            with path.open("r", encoding="utf-8", newline="") as handle:
                reader = csv.DictReader(handle)
                rows = list(reader)

            self.assertEqual(reader.fieldnames[-1], "shift_distance")
            self.assertAlmostEqual(float(rows[0]["shift_distance"]), 5.0)
            self.assertAlmostEqual(float(rows[1]["shift_distance"]), 5.0)

            perturbation_download_path(project_dir, run_id, "cell_shifts.csv")
            with path.open("r", encoding="utf-8", newline="") as handle:
                self.assertEqual(
                    csv.DictReader(handle).fieldnames.count("shift_distance"),
                    1,
                )


if __name__ == "__main__":
    unittest.main()
