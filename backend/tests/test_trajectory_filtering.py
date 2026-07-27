from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import pandas as pd

from app.services.gene_selection_service import (
    GeneSelectionError,
    apply_trajectory_filter,
)


class TrajectoryFilteringTests(unittest.TestCase):
    def test_includes_genes_equal_to_the_displayed_p_value_cutoff(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expression = root / "expression.csv"
            ordering = root / "GeneOrdering.csv"
            destination = root / "filtered.csv"
            expression.write_text(
                "gene,c1,c2\n"
                "gene_a,1,2\n"
                "gene_b,3,4\n"
                "gene_c,5,6\n",
                encoding="utf-8",
            )
            ordering.write_text(
                ",p_val,variance\n"
                "gene_a,0.009,1\n"
                "gene_b,0.01,2\n"
                "outside,0.001,3\n",
                encoding="utf-8",
            )

            result = apply_trajectory_filter(
                source_expression=expression,
                destination_expression=destination,
                gene_ordering_path=ordering,
                p_value_threshold=0.01,
                bonferroni_correction=False,
                known_tf_gene_names={"gene_a"},
            )

            filtered = pd.read_csv(destination, index_col=0)
            self.assertEqual(list(filtered.index), ["gene_a", "gene_b"])
            self.assertEqual(result["tested_gene_count"], 3)
            self.assertEqual(result["retained_gene_count"], 2)
            self.assertEqual(result["retained_significant_tf_count"], 1)

    def test_applies_bonferroni_over_all_tested_ordering_genes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expression = root / "expression.csv"
            ordering = root / "GeneOrdering.csv"
            destination = root / "filtered.csv"
            expression.write_text(
                "gene,c1\n"
                "gene_a,1\n"
                "gene_b,2\n",
                encoding="utf-8",
            )
            ordering.write_text(
                ",p_val\n"
                "gene_a,0.004\n"
                "gene_b,0.006\n",
                encoding="utf-8",
            )

            result = apply_trajectory_filter(
                source_expression=expression,
                destination_expression=destination,
                gene_ordering_path=ordering,
                p_value_threshold=0.01,
                bonferroni_correction=True,
            )

            filtered = pd.read_csv(destination, index_col=0)
            self.assertEqual(list(filtered.index), ["gene_a"])
            self.assertEqual(result["effective_p_value_threshold"], 0.005)

    def test_accepts_headerless_gene_ordering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expression = root / "expression.csv"
            ordering = root / "GeneOrdering.csv"
            destination = root / "filtered.csv"
            expression.write_text("gene,c1\ngene_a,1\ngene_b,2\n", encoding="utf-8")
            ordering.write_text("gene_a,0.001\ngene_b,0.2\n", encoding="utf-8")

            apply_trajectory_filter(
                source_expression=expression,
                destination_expression=destination,
                gene_ordering_path=ordering,
                p_value_threshold=0.01,
                bonferroni_correction=False,
            )

            filtered = pd.read_csv(destination, index_col=0)
            self.assertEqual(list(filtered.index), ["gene_a"])

    def test_counts_versioned_ensembl_identifier_as_retained_tf(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expression = root / "expression.csv"
            ordering = root / "GeneOrdering.csv"
            destination = root / "filtered.csv"
            expression.write_text(
                "gene,c1\nENSG00000123268.4,1\n",
                encoding="utf-8",
            )
            ordering.write_text(
                ",p_val\nENSG00000123268.4,0.001\n",
                encoding="utf-8",
            )

            result = apply_trajectory_filter(
                source_expression=expression,
                destination_expression=destination,
                gene_ordering_path=ordering,
                p_value_threshold=0.01,
                bonferroni_correction=False,
                known_tf_gene_names={"ENSG00000123268"},
            )

            self.assertEqual(result["retained_significant_tf_count"], 1)

    def test_rejects_filter_that_removes_every_gene(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expression = root / "expression.csv"
            ordering = root / "GeneOrdering.csv"
            expression.write_text("gene,c1\ngene_a,1\n", encoding="utf-8")
            ordering.write_text(",p_val\ngene_a,0.5\n", encoding="utf-8")

            with self.assertRaisesRegex(
                GeneSelectionError,
                "removed every gene",
            ):
                apply_trajectory_filter(
                    source_expression=expression,
                    destination_expression=root / "filtered.csv",
                    gene_ordering_path=ordering,
                    p_value_threshold=0.01,
                    bonferroni_correction=False,
                )


if __name__ == "__main__":
    unittest.main()
