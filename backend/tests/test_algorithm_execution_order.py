import unittest

from app.algorithm_registry import sort_algorithm_ids_by_difficulty


class AlgorithmExecutionOrderTests(unittest.TestCase):
    def test_selected_algorithms_are_scheduled_fastest_first(self):
        selected = [
            "GRNVBEM",
            "SCODE",
            "GENIE3",
            "PPCOR",
            "SINGE",
            "PEARSON",
            "PIDC",
            "SINCERITIES",
        ]

        self.assertEqual(
            sort_algorithm_ids_by_difficulty(selected),
            [
                "PEARSON",
                "PPCOR",
                "SINCERITIES",
                "PIDC",
                "GENIE3",
                "SINGE",
                "SCODE",
                "GRNVBEM",
            ],
        )

    def test_unknown_algorithms_keep_their_relative_order_at_the_end(self):
        self.assertEqual(
            sort_algorithm_ids_by_difficulty(
                ["UNKNOWN_B", "GRNVBEM", "UNKNOWN_A", "PEARSON"]
            ),
            ["PEARSON", "GRNVBEM", "UNKNOWN_B", "UNKNOWN_A"],
        )


if __name__ == "__main__":
    unittest.main()
