import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from app.services.beeline_service import (
    CELLORACLE_INPUT_CONTRACT_VERSION,
    build_algorithm_runtime_params,
    ensure_celloracle_expression_source,
    resolve_celloracle_expression_mode,
)


class CellOracleExpressionContractTests(unittest.TestCase):
    def test_normalized_and_log_normalized_projects_share_the_normalized_import(self):
        for matrix_state in ("normalized", "log_normalized"):
            with self.subTest(matrix_state=matrix_state):
                manifest = {"preprocessing": {"matrix_state": matrix_state}}
                self.assertEqual(
                    resolve_celloracle_expression_mode(manifest),
                    "normalized_log",
                )
                params = build_algorithm_runtime_params("CELLORACLE", manifest)
                self.assertEqual(params["expressionMode"], "normalized_log")
                self.assertEqual(
                    params["inputContractVersion"],
                    CELLORACLE_INPUT_CONTRACT_VERSION,
                )

    def test_raw_project_uses_original_counts_subset_to_retained_genes(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "uploaded.csv"
            preprocessed = root / "preprocessed" / "ExpressionData.csv"
            preprocessed.parent.mkdir()
            pd.DataFrame(
                {
                    "cell-1": [2, 10, 7],
                    "cell-2": [4, 20, 8],
                },
                index=["GeneA", "GeneB", "GeneC"],
            ).to_csv(source, index_label="gene")
            pd.DataFrame(
                {
                    "cell-1": [0.4, 0.8],
                    "cell-2": [0.5, 0.9],
                },
                index=["GeneC", "GeneA"],
            ).to_csv(preprocessed, index_label="gene")
            manifest = {"preprocessing": {"matrix_state": "raw"}}

            prepared = ensure_celloracle_expression_source(
                source_expression=source,
                preprocessed_expression=preprocessed,
                project_manifest=manifest,
            )

            observed = pd.read_csv(prepared, index_col=0)
            expected = pd.DataFrame(
                {
                    "cell-1": [7, 2],
                    "cell-2": [8, 4],
                },
                index=pd.Index(["GeneC", "GeneA"], name="gene"),
            )
            pd.testing.assert_frame_equal(observed, expected)
            self.assertEqual(
                resolve_celloracle_expression_mode(manifest),
                "raw_count",
            )
            cache_manifest = json.loads(
                (preprocessed.parent / "celloracle_manifest.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(
                cache_manifest["signature"]["input_contract_version"],
                CELLORACLE_INPUT_CONTRACT_VERSION,
            )

    def test_centered_log_input_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            expression = root / "ExpressionData.csv"
            pd.DataFrame(
                {"cell-1": [-0.25, 0.5], "cell-2": [0.25, 1.0]},
                index=["GeneA", "GeneB"],
            ).to_csv(expression, index_label="gene")

            with self.assertRaisesRegex(ValueError, "non-negative"):
                ensure_celloracle_expression_source(
                    source_expression=expression,
                    preprocessed_expression=expression,
                    project_manifest={
                        "preprocessing": {"matrix_state": "log_normalized"}
                    },
                )


if __name__ == "__main__":
    unittest.main()
