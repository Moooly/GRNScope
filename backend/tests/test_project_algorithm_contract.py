from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.api.projects import parse_selected_algorithms
from app.services.job_service import build_algorithm_scopes


class ProjectAlgorithmSelectionTests(unittest.TestCase):
    def test_selection_is_normalized_and_sorted_for_execution(self):
        self.assertEqual(
            parse_selected_algorithms(json.dumps([" grnvbem ", "pearson"])),
            ["PEARSON", "GRNVBEM"],
        )

    def test_empty_duplicate_unknown_and_inactive_selections_are_rejected(self):
        invalid_selections = [
            ([], "at least one"),
            (["GENIE3", "genie3"], "more than once"),
            (["NOT_A_METHOD"], "Unsupported algorithm"),
            (["JUMP3"], "not currently available"),
        ]

        for selected, expected_message in invalid_selections:
            with self.subTest(selected=selected):
                with self.assertRaisesRegex(ValueError, expected_message):
                    parse_selected_algorithms(json.dumps(selected))


class AlgorithmScopeContractTests(unittest.TestCase):
    def test_only_celloracle_receives_cluster_scopes(self):
        with tempfile.TemporaryDirectory(prefix="algorithm-scope-contract-") as temp_dir:
            root = Path(temp_dir)
            expression_path = root / "expression.csv"
            cluster_path = root / "clusters.csv"
            cell_names = [f"cell-{index}" for index in range(65)]

            expression_path.write_text(
                ",".join(["gene", *cell_names])
                + "\n"
                + ",".join(["G1", *(["1"] * len(cell_names))])
                + "\n",
                encoding="utf-8",
            )
            cluster_path.write_text(
                "cell,cluster\n"
                + "\n".join(
                    f"{cell_name},{'large' if index < 55 else 'small'}"
                    for index, cell_name in enumerate(cell_names)
                )
                + "\n",
                encoding="utf-8",
            )
            manifest = {
                "expression_path": str(expression_path),
                "cluster_labels_path": str(cluster_path),
            }

            celloracle_scopes = build_algorithm_scopes(manifest, "celloracle")
            other_method_scopes = build_algorithm_scopes(manifest, "GENIE3")

        self.assertEqual(
            [(scope.scope_type, scope.label) for scope in celloracle_scopes],
            [
                ("global", "Global"),
                ("cluster", "large"),
                ("cluster", "small"),
            ],
        )
        self.assertEqual(celloracle_scopes[0].cell_count, 65)
        self.assertFalse(celloracle_scopes[1].skipped)
        self.assertEqual(celloracle_scopes[1].cell_count, 55)
        self.assertTrue(celloracle_scopes[2].skipped)
        self.assertEqual(celloracle_scopes[2].cell_count, 10)
        self.assertEqual(
            [(scope.scope_type, scope.label) for scope in other_method_scopes],
            [("global", "Global")],
        )


if __name__ == "__main__":
    unittest.main()
