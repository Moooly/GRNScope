import tempfile
import unittest
from pathlib import Path

from app.services.beeline_service import (
    create_confidence_accumulator,
    finalize_confidence_accumulator,
    merge_full_data_with_bootstrap_edges,
    parse_ranked_edges_csv,
    update_confidence_accumulator,
)
from app.api.results import compact_result_for_client


class SignedEdgeContractTests(unittest.TestCase):
    def test_self_edges_are_excluded_before_ranking_and_compaction(self):
        with tempfile.TemporaryDirectory(prefix="self-edge-contract-") as temp_dir:
            ranked_edges = Path(temp_dir) / "rankedEdges.csv"
            ranked_edges.write_text(
                "Gene1\tGene2\tEdgeWeight\n"
                "A\tA\t1.0\n"
                "B\tA\t0.9\n",
                encoding="utf-8",
            )

            parsed, summary = parse_ranked_edges_csv(
                ranked_edges,
                max_edges_per_target=1,
            )

        self.assertEqual(
            parsed,
            [{"source": "B", "target": "A", "score": 0.9, "normalized_score": 1.0}],
        )
        self.assertEqual(summary["edge_count"], 1)

        accumulator = create_confidence_accumulator()
        update_confidence_accumulator(
            accumulator,
            [
                {"source": "A", "target": "A", "score": 1.0},
                {"source": "B", "target": "A", "score": 0.9},
            ],
            evidence_threshold=1.0,
        )
        bootstrap_edges, _summary = finalize_confidence_accumulator(
            accumulator,
            run_count=1,
            evidence_threshold=1.0,
        )
        merged = merge_full_data_with_bootstrap_edges(
            [
                *bootstrap_edges,
                {
                    "source": "A",
                    "target": "A",
                    "score": 1.0,
                    "confidence": 1.0,
                },
            ],
            [
                {"source": "A", "target": "A", "score": 1.0},
                {"source": "B", "target": "A", "score": 0.9},
            ],
            bootstrap_runs=1,
            evidence_threshold=1.0,
        )
        self.assertEqual(
            {(edge["source"], edge["target"]) for edge in merged},
            {("B", "A")},
        )

        compact = compact_result_for_client(
            {
                "algorithm_id": "TEST",
                "top_edges": [
                    {"source": "A", "target": "A", "score": 1.0},
                    {"source": "B", "target": "A", "score": 0.9},
                ],
            }
        )
        self.assertEqual(
            [(edge["source"], edge["target"]) for edge in compact["top_edges"]],
            [("B", "A")],
        )
        self.assertEqual(compact["edge_count"], 1)

    def test_backend_ranks_by_magnitude_and_preserves_negative_raw_score(self):
        with tempfile.TemporaryDirectory(prefix="signed-edge-contract-") as temp_dir:
            ranked_edges = Path(temp_dir) / "rankedEdges.csv"
            ranked_edges.write_text(
                "Gene1\tGene2\tEdgeWeight\n"
                "activator\ttarget\t0.7\n"
                "repressor\ttarget\t-0.9\n",
                encoding="utf-8",
            )

            parsed, _summary = parse_ranked_edges_csv(
                ranked_edges,
                max_edges_per_target=1,
            )

        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["source"], "repressor")
        self.assertEqual(parsed[0]["score"], -0.9)

        accumulator = create_confidence_accumulator()
        update_confidence_accumulator(
            accumulator,
            parsed,
            evidence_threshold=1.0,
        )
        aggregated, _summary = finalize_confidence_accumulator(
            accumulator,
            run_count=1,
            evidence_threshold=1.0,
        )

        self.assertEqual(aggregated[0]["mean_raw_score"], -0.9)
        self.assertEqual(aggregated[0]["max_abs_raw_score"], 0.9)
        self.assertIsNone(aggregated[0]["bootstrap_sign_confidence"])
        self.assertEqual(aggregated[0]["bootstrap_negative_probability"], 1.0)

    def test_sign_confidence_agrees_with_displayed_full_data_sign(self):
        accumulator = create_confidence_accumulator()
        update_confidence_accumulator(
            accumulator,
            [{"source": "A", "target": "B", "score": 0.8}],
            evidence_threshold=1.0,
        )
        update_confidence_accumulator(
            accumulator,
            [{"source": "A", "target": "B", "score": -0.7}],
            evidence_threshold=1.0,
        )
        bootstrap_edges, _summary = finalize_confidence_accumulator(
            accumulator,
            run_count=2,
            evidence_threshold=1.0,
        )
        aggregated = merge_full_data_with_bootstrap_edges(
            bootstrap_edges,
            [{"source": "A", "target": "B", "score": 0.9}],
            bootstrap_runs=2,
            evidence_threshold=1.0,
        )

        self.assertEqual(aggregated[0]["confidence"], 1.0)
        self.assertEqual(aggregated[0]["bootstrap_sign_confidence"], 0.5)
        self.assertEqual(aggregated[0]["bootstrap_sign_coverage"], 1.0)
        self.assertEqual(aggregated[0]["sign_agreeing_runs"], 1)
        self.assertEqual(aggregated[0]["bootstrap_sign_reference"], "full_data")

    def test_sign_confidence_does_not_hide_disagreement_with_full_data_sign(self):
        accumulator = create_confidence_accumulator()
        for score in (-0.8, -0.7, 0.6):
            update_confidence_accumulator(
                accumulator,
                [{"source": "A", "target": "B", "score": score}],
                evidence_threshold=1.0,
            )
        bootstrap_edges, _summary = finalize_confidence_accumulator(
            accumulator,
            run_count=3,
            evidence_threshold=1.0,
        )
        aggregated = merge_full_data_with_bootstrap_edges(
            bootstrap_edges,
            [{"source": "A", "target": "B", "score": 0.9}],
            bootstrap_runs=3,
            evidence_threshold=1.0,
        )

        edge = aggregated[0]
        self.assertAlmostEqual(edge["bootstrap_sign_confidence"], 1 / 3)
        self.assertAlmostEqual(edge["bootstrap_positive_probability"], 1 / 3)
        self.assertAlmostEqual(edge["bootstrap_negative_probability"], 2 / 3)
        self.assertEqual(edge["sign_agreeing_runs"], 1)

    def test_zero_sign_recoveries_reduce_coverage_not_sign_denominator(self):
        accumulator = create_confidence_accumulator()
        for score in (0.8, 0.0, -0.6):
            update_confidence_accumulator(
                accumulator,
                [{"source": "A", "target": "B", "score": score}],
                evidence_threshold=1.0,
            )
        bootstrap_edges, _summary = finalize_confidence_accumulator(
            accumulator,
            run_count=3,
            evidence_threshold=1.0,
        )
        aggregated = merge_full_data_with_bootstrap_edges(
            bootstrap_edges,
            [{"source": "A", "target": "B", "score": 0.9}],
            bootstrap_runs=3,
            evidence_threshold=1.0,
        )

        edge = aggregated[0]
        self.assertEqual(edge["signed_selected_runs"], 2)
        self.assertAlmostEqual(edge["bootstrap_sign_coverage"], 2 / 3)
        self.assertEqual(edge["bootstrap_sign_confidence"], 0.5)

    def test_existing_bootstrap_result_is_corrected_from_saved_sign_counts(self):
        compact = compact_result_for_client(
            {
                "algorithm_id": "TEST",
                "top_edges": [
                    {
                        "source": "A",
                        "target": "B",
                        "score": 1.0,
                        "confidence": 1.0,
                        "selected_runs": 3,
                        "positive_selected_runs": 1,
                        "negative_selected_runs": 2,
                        "bootstrap_sign_confidence": 2 / 3,
                        "full_data_present": True,
                        "full_data_raw_score": 0.9,
                        "mean_raw_score": 0.9,
                    }
                ],
            }
        )

        edge = compact["top_edges"][0]
        self.assertAlmostEqual(edge["bootstrap_sign_confidence"], 1 / 3)
        self.assertEqual(edge["sign_agreeing_runs"], 1)
        self.assertEqual(edge["bootstrap_sign_reference"], "full_data")


if __name__ == "__main__":
    unittest.main()
