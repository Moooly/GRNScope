from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import pandas as pd

from app.services.gene_selection_service import (
    GeneSelectionError,
    apply_detection_filter,
    minimum_detected_cell_count,
)


class DetectionFilteringTests(unittest.TestCase):
    def test_percentage_uses_ceiling_for_required_cell_count(self) -> None:
        self.assertEqual(minimum_detected_cell_count(19, 10), 2)
        self.assertEqual(minimum_detected_cell_count(20, 10), 2)
        self.assertEqual(minimum_detected_cell_count(21, 10), 3)

    def test_keeps_genes_detected_in_at_least_threshold_cells(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.csv"
            destination = Path(directory) / "filtered.csv"
            source.write_text(
                "gene,c1,c2,c3,c4\n"
                "keep_exact,1,0,0,0\n"
                "keep_many,1,2,0,0\n"
                "remove,0,0,0,0\n",
                encoding="utf-8",
            )

            result = apply_detection_filter(
                source_expression=source,
                destination_expression=destination,
                minimum_cell_percent=25,
            )

            filtered = pd.read_csv(destination, index_col=0)
            self.assertEqual(list(filtered.index), ["keep_exact", "keep_many"])
            self.assertEqual(result["minimum_detected_cell_count"], 1)
            self.assertEqual(result["input_gene_count"], 3)
            self.assertEqual(result["retained_gene_count"], 2)
            self.assertEqual(result["removed_gene_count"], 1)

    def test_rejects_filter_that_removes_every_gene(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.csv"
            destination = Path(directory) / "filtered.csv"
            source.write_text(
                "gene,c1,c2\n"
                "gene_a,0,0\n"
                "gene_b,0,0\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                GeneSelectionError,
                "removed every gene",
            ):
                apply_detection_filter(
                    source_expression=source,
                    destination_expression=destination,
                    minimum_cell_percent=10,
                )


if __name__ == "__main__":
    unittest.main()
