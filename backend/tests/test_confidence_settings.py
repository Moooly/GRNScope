import os
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.api.projects import normalize_bootstrap_replicates
from app.services.beeline_service import (
    CONFIDENCE_RESAMPLING_SCHEME,
    FULL_DATA_RUN_ID,
    bootstrap_column_draws,
    estimate_remaining_seconds_range_from_run_timings,
    finalize_confidence_accumulator,
    materialize_confidence_run_input,
    merge_full_data_with_bootstrap_edges,
    plan_confidence_run_inputs,
    resolve_confidence_settings,
    summarize_repeat_run_spearman,
    update_confidence_accumulator,
)


class ConfidenceSettingsTests(unittest.TestCase):
    def test_project_bootstrap_profiles_are_bounded_to_supported_values(self):
        self.assertEqual(normalize_bootstrap_replicates("30"), 30)
        self.assertEqual(normalize_bootstrap_replicates("100"), 100)
        self.assertEqual(normalize_bootstrap_replicates("300"), 300)
        self.assertEqual(normalize_bootstrap_replicates("12"), 100)
        self.assertEqual(normalize_bootstrap_replicates("invalid"), 100)

    def test_confidence_runs_are_enabled_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            settings = resolve_confidence_settings({}, gene_count=100)

        self.assertTrue(settings["confidence_enabled"])
        self.assertEqual(settings["bootstrap_runs"], 100)
        self.assertEqual(settings["min_runs"], 100)
        self.assertEqual(settings["subsample_fraction"], 1.0)
        self.assertFalse(settings["early_stopping_enabled"])
        self.assertTrue(settings["sampling_with_replacement"])
        self.assertEqual(
            settings["resampling_scheme"],
            "cell_bootstrap_with_replacement_v1",
        )
        self.assertEqual(settings["stop_rho"], 0.95)

    def test_project_can_override_default_spearman_threshold(self):
        with patch.dict(os.environ, {}, clear=True):
            settings = resolve_confidence_settings(
                {"confidence_stop_rho": 0.97},
                gene_count=100,
            )

        self.assertEqual(settings["stop_rho"], 0.97)

    def test_legacy_activation_flags_cannot_disable_confidence_runs(self):
        with patch.dict(
            os.environ,
            {"GRNSCOPE_ENABLE_CONFIDENCE_RUNS": "0"},
            clear=True,
        ):
            settings = resolve_confidence_settings(
                {"enable_confidence_runs": False},
                gene_count=100,
            )

        self.assertTrue(settings["confidence_enabled"])
        self.assertEqual(settings["bootstrap_runs"], 100)
        self.assertEqual(settings["min_runs"], 100)

    def test_remaining_time_range_uses_stability_streak_and_maximum_runs(self):
        metadata = {
            "run-1": {"status": "Completed", "elapsed_seconds": 120},
            "run-2": {"status": "Completed", "elapsed_seconds": 110},
            "run-3": {"status": "Completed", "elapsed_seconds": 100},
            "run-4": {"status": "Completed", "elapsed_seconds": 105},
            "run-5": {"status": "Running", "elapsed_seconds": 30},
        }

        remaining = estimate_remaining_seconds_range_from_run_timings(
            metadata,
            minimum_run_count=3,
            # A legacy 30-run value must still be capped by the current
            # confidence ceiling of 15 when calculating the upper ETA.
            maximum_run_count=30,
            current_streak=1,
            required_streak=2,
            current_run_elapsed_seconds=30,
        )

        # Median of the last three completed runs is 105 seconds. A legacy
        # adaptive estimate can finish after one run, while the fixed maximum
        # supplied by the caller remains 30.
        self.assertEqual(remaining, (75, 2700))

    def test_remaining_time_range_requires_two_future_checks_after_failed_stability(self):
        metadata = {
            "run-1": {"status": "Completed", "elapsed_seconds": 60},
            "run-2": {"status": "Completed", "elapsed_seconds": 60},
            "run-3": {"status": "Running", "elapsed_seconds": 10},
        }

        remaining = estimate_remaining_seconds_range_from_run_timings(
            metadata,
            minimum_run_count=3,
            maximum_run_count=15,
            current_streak=0,
            required_streak=2,
            current_run_elapsed_seconds=10,
        )

        self.assertEqual(remaining, (110, 770))

    def test_repeat_run_spearman_summarizes_all_run_pairs(self):
        run_scores = {
            "run-1": {
                ("A", "B"): 0.9,
                ("A", "C"): 0.6,
                ("B", "C"): 0.2,
            },
            "run-2": {
                ("A", "B"): 9.0,
                ("A", "C"): 6.0,
                ("B", "C"): 2.0,
            },
            "run-3": {
                ("A", "B"): 0.8,
                ("A", "C"): 0.5,
                ("B", "C"): 0.1,
            },
        }

        summary = summarize_repeat_run_spearman(run_scores)

        self.assertEqual(summary["status"], "available")
        self.assertEqual(summary["run_count"], 3)
        self.assertEqual(summary["pair_count"], 3)
        self.assertAlmostEqual(summary["median_rho"], 1.0)
        self.assertAlmostEqual(summary["mad_rho"], 0.0)

    def test_planner_adds_full_data_fit_and_n_out_of_n_bootstrap_draws(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            expression = Path(temp_dir) / "ExpressionData.csv"
            expression.write_text(
                ",cell-a,cell-b,cell-c,cell-d\n"
                "gene-a,1,2,3,4\n"
                "gene-b,4,3,2,1\n",
                encoding="utf-8",
            )
            (
                run_ids,
                metadata,
                settings,
                run_columns,
                _header,
            ) = plan_confidence_run_inputs(
                dataset_id="bootstrap-test",
                algorithm_id="GENIE3",
                project_manifest={"confidence_bootstrap_runs": 3},
                preprocessed_expression=expression,
            )

        self.assertEqual(
            run_ids,
            [FULL_DATA_RUN_ID, "bootstrap-1", "bootstrap-2", "bootstrap-3"],
        )
        self.assertEqual(run_columns[FULL_DATA_RUN_ID], [1, 2, 3, 4])
        self.assertEqual(settings["bootstrap_runs"], 3)
        self.assertEqual(settings["total_algorithm_runs"], 4)
        for run_id in run_ids[1:]:
            self.assertEqual(len(run_columns[run_id]), 4)
            self.assertTrue(metadata[run_id]["sampling_with_replacement"])
            self.assertEqual(
                metadata[run_id]["resampling_scheme"],
                CONFIDENCE_RESAMPLING_SCHEME,
            )
        self.assertTrue(
            any(
                len(set(run_columns[run_id])) < len(run_columns[run_id])
                for run_id in run_ids[1:]
            )
        )

    def test_bootstrap_draws_are_shared_across_algorithms(self):
        first, first_seeds = bootstrap_column_draws(
            dataset_id="shared-dataset",
            cell_column_indices=[1, 2, 3, 4, 5],
            bootstrap_runs=4,
        )
        second, second_seeds = bootstrap_column_draws(
            dataset_id="shared-dataset",
            cell_column_indices=[1, 2, 3, 4, 5],
            bootstrap_runs=4,
        )
        self.assertEqual(first, second)
        self.assertEqual(first_seeds, second_seeds)

    def test_deferred_bootstrap_selection_records_unique_cell_copies(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            expression = root / "ExpressionData.csv"
            expression.write_text(
                ",cell-a,cell-b\n"
                "gene-a,1,2\n",
                encoding="utf-8",
            )
            run_dir = materialize_confidence_run_input(
                input_dir=root / "inputs",
                dataset_id="dataset",
                run_id="bootstrap-1",
                preprocessed_expression=expression,
                header=["", "cell-a", "cell-b"],
                selected_column_indices=[1, 1],
                source_pseudotime=None,
                defer_matrix_materialization=True,
            )
            records = json.loads(
                (run_dir / "selected_cells.json").read_text(encoding="utf-8")
            )

        self.assertEqual([record["source"] for record in records], ["cell-a", "cell-a"])
        self.assertEqual(len({record["output"] for record in records}), 2)

    def test_materialized_bootstrap_duplicates_expression_and_pseudotime_together(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            expression = root / "ExpressionData.csv"
            pseudotime = root / "PseudoTime.csv"
            expression.write_text(
                ",cell-a,cell-b\n"
                "gene-a,1,2\n",
                encoding="utf-8",
            )
            pseudotime.write_text(
                ",trajectory\n"
                "cell-a,0.1\n"
                "cell-b,0.9\n",
                encoding="utf-8",
            )
            run_dir = materialize_confidence_run_input(
                input_dir=root / "inputs",
                dataset_id="dataset",
                run_id="bootstrap-1",
                preprocessed_expression=expression,
                header=["", "cell-a", "cell-b"],
                selected_column_indices=[1, 1],
                source_pseudotime=pseudotime,
            )
            expression_lines = (
                run_dir / "ExpressionData.csv"
            ).read_text(encoding="utf-8").splitlines()
            pseudotime_lines = (
                run_dir / "PseudoTime.csv"
            ).read_text(encoding="utf-8").splitlines()

        expression_cells = expression_lines[0].split(",")[1:]
        pseudotime_cells = [line.split(",")[0] for line in pseudotime_lines[1:]]
        self.assertEqual(expression_cells, pseudotime_cells)
        self.assertEqual(len(set(expression_cells)), 2)
        self.assertEqual(expression_lines[1].split(",")[1:], ["1", "1"])
        self.assertEqual(
            [line.split(",")[1] for line in pseudotime_lines[1:]],
            ["0.1", "0.1"],
        )

    def test_bootstrap_confidence_is_recovery_frequency_with_interval(self):
        accumulator = {"edges": {}, "node_names": set(), "processed_runs": 0}
        update_confidence_accumulator(
            accumulator,
            [{"source": "A", "target": "B", "score": 5.0}],
            stability_top_k=1,
        )
        update_confidence_accumulator(
            accumulator,
            [],
            stability_top_k=1,
        )
        bootstrap_edges, _summary = finalize_confidence_accumulator(
            accumulator,
            run_count=2,
            stability_top_k=1,
        )
        merged = merge_full_data_with_bootstrap_edges(
            bootstrap_edges,
            [{"source": "A", "target": "B", "score": 7.0}],
            bootstrap_runs=2,
            selection_top_k=1,
        )

        self.assertEqual(len(merged), 1)
        edge = merged[0]
        self.assertEqual(edge["confidence"], 0.5)
        self.assertEqual(edge["selected_runs"], 1)
        self.assertEqual(edge["run_count"], 2)
        self.assertEqual(edge["score"], 1.0)
        self.assertAlmostEqual(edge["evidence_ci_lower"], 0.025)
        self.assertAlmostEqual(edge["evidence_ci_upper"], 0.975)

    def test_repeat_run_spearman_aligns_missing_edges_to_zero(self):
        summary = summarize_repeat_run_spearman(
            {
                "run-1": {
                    ("A", "B"): 0.9,
                    ("A", "C"): 0.4,
                },
                "run-2": {
                    ("A", "B"): 0.7,
                    ("B", "C"): 0.2,
                },
            }
        )

        self.assertEqual(summary["status"], "available")
        self.assertEqual(summary["pair_count"], 1)
        self.assertIsNotNone(summary["median_rho"])


if __name__ == "__main__":
    unittest.main()
