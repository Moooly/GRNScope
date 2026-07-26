from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from app.services.gene_ordering_service import (
    GeneOrderingGenerationError,
    generate_gene_ordering_csv,
)
from app.validators import validate_gene_ordering_csv


class GeneOrderingGenerationTests(unittest.TestCase):
    def test_generates_valid_ordering_from_named_multilineage_pseudotime(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            cells = [f"cell-{index}" for index in range(12)]
            trajectory = np.linspace(0, 1, len(cells))
            expression = pd.DataFrame(
                [
                    trajectory * 10,
                    np.square(trajectory) * 10,
                    np.ones(len(cells)),
                ],
                index=["LINEAR", "CURVED", "CONSTANT"],
                columns=cells,
            )
            expression_path = directory / "ExpressionData.csv"
            expression.to_csv(expression_path)

            reversed_cells = list(reversed(cells))
            pseudotime = pd.DataFrame(
                {
                    "PseudoTime1": [
                        trajectory[cells.index(cell)] for cell in reversed_cells
                    ],
                    "PseudoTime2": [np.nan] * len(cells),
                },
                index=reversed_cells,
            )
            pseudotime_path = directory / "PseudoTime.csv"
            pseudotime.to_csv(pseudotime_path)
            destination = directory / "GeneOrdering.csv"

            result = generate_gene_ordering_csv(
                source_expression=expression_path,
                pseudotime_path=pseudotime_path,
                destination_path=destination,
            )
            ordering = pd.read_csv(destination, index_col=0)
            validation = validate_gene_ordering_csv(
                destination,
                list(expression.index),
            )

        self.assertEqual(result["method"], "polynomial_f_test")
        self.assertEqual(result["lineage_count"], 1)
        self.assertLess(ordering.loc["LINEAR", "VGAMpValue"], 0.01)
        self.assertLess(ordering.loc["CURVED", "VGAMpValue"], 0.01)
        self.assertEqual(ordering.loc["CONSTANT", "VGAMpValue"], 1.0)
        self.assertEqual(validation["status"], "validated")

    def test_generates_ordering_from_one_value_per_row_pseudotime(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            expression_path = directory / "ExpressionData.csv"
            expression_path.write_text(
                ",c1,c2,c3,c4,c5\n"
                "A,0,1,2,3,4\n"
                "B,1,1,1,1,1\n",
                encoding="utf-8",
            )
            pseudotime_path = directory / "PseudoTime.csv"
            pseudotime_path.write_text(
                "pseudotime\n0\n1\n2\n3\n4\n",
                encoding="utf-8",
            )
            destination = directory / "GeneOrdering.csv"

            result = generate_gene_ordering_csv(
                source_expression=expression_path,
                pseudotime_path=pseudotime_path,
                destination_path=destination,
            )
            destination_exists = destination.exists()

        self.assertEqual(result["gene_count"], 2)
        self.assertTrue(destination_exists)

    def test_rejects_mismatched_named_cells(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            expression_path = directory / "ExpressionData.csv"
            expression_path.write_text(
                ",c1,c2,c3\nA,0,1,2\n",
                encoding="utf-8",
            )
            pseudotime_path = directory / "PseudoTime.csv"
            pseudotime_path.write_text(
                ",PseudoTime1\nc1,0\nc2,1\nother,2\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                GeneOrderingGenerationError,
                "must match",
            ):
                generate_gene_ordering_csv(
                    source_expression=expression_path,
                    pseudotime_path=pseudotime_path,
                    destination_path=directory / "GeneOrdering.csv",
                )


if __name__ == "__main__":
    unittest.main()
