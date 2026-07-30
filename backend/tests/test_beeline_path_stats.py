from pathlib import Path
import tempfile
import unittest

from app.services.beeline_service import compute_beeline_path_stats


class BeelinePathStatsTests(unittest.TestCase):
    def test_matches_beeline_cutoff_ties_and_directed_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            ranked_path = Path(temp_dir) / "rankedEdges.csv"
            ranked_path.write_text(
                "Gene1\tGene2\tEdgeWeight\n"
                "A\tA\t9\n"
                "A\tC\t0.9\n"
                "A\tB\t0.8\n"
                "A\tD\t0.7\n"
                "X\tY\t-0.7\n"
                "A\tD\t0.7\n"
                "B\tD\t0.6\n",
                encoding="utf-8",
            )
            reference_edges = [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "C", "target": "D"},
            ]

            stats = compute_beeline_path_stats(
                ranked_path,
                reference_edges,
            )

        self.assertIsNotNone(stats)
        assert stats is not None
        self.assertEqual(stats["reference_edge_count"], 3)
        self.assertEqual(stats["selection_threshold"], 0.7)
        self.assertEqual(stats["num_predicted"], 4)
        self.assertEqual(stats["num_true_positive"], 1)
        self.assertEqual(stats["num_false_positive_with_path"], 2)
        self.assertEqual(stats["num_false_positive_no_path"], 1)
        self.assertEqual(stats["path_2"], 1)
        self.assertEqual(stats["path_3"], 1)
        self.assertEqual(stats["path_more_than_5"], 0)

    def test_keeps_long_paths_distinct_from_no_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            ranked_path = Path(temp_dir) / "rankedEdges.csv"
            ranked_path.write_text(
                "Gene1\tGene2\tEdgeWeight\n"
                "A\tG\t1.0\n"
                "A\tB\t0.9\n"
                "B\tC\t0.8\n"
                "C\tD\t0.7\n"
                "D\tE\t0.6\n"
                "E\tF\t0.5\n",
                encoding="utf-8",
            )
            reference_edges = [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "C", "target": "D"},
                {"source": "D", "target": "E"},
                {"source": "E", "target": "F"},
                {"source": "F", "target": "G"},
            ]

            stats = compute_beeline_path_stats(
                ranked_path,
                reference_edges,
            )

        self.assertIsNotNone(stats)
        assert stats is not None
        self.assertEqual(stats["num_true_positive"], 5)
        self.assertEqual(stats["num_false_positive_with_path"], 1)
        self.assertEqual(stats["num_false_positive_no_path"], 0)
        self.assertEqual(stats["path_more_than_5"], 1)

    def test_globally_ranks_grouped_predictions_before_selecting_top_k(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            ranked_path = Path(temp_dir) / "rankedEdges.csv"
            ranked_path.write_text(
                "Gene1\tGene2\tEdgeWeight\n"
                "A\tD\t0.20\n"
                "B\tD\t0.10\n"
                "A\tB\t1.00\n"
                "B\tC\t0.90\n"
                "C\tD\t0.80\n"
                "A\tC\t0.70\n",
                encoding="utf-8",
            )
            reference_edges = [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "C", "target": "D"},
            ]

            stats = compute_beeline_path_stats(
                ranked_path,
                reference_edges,
            )

        self.assertIsNotNone(stats)
        assert stats is not None
        self.assertEqual(stats["selection_threshold"], 0.8)
        self.assertEqual(stats["num_predicted"], 3)
        self.assertEqual(stats["num_true_positive"], 3)
        self.assertEqual(stats["num_false_positive_with_path"], 0)
        self.assertEqual(stats["num_false_positive_no_path"], 0)


if __name__ == "__main__":
    unittest.main()
