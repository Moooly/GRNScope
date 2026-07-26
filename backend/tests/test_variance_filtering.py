from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import pandas as pd

from app.services.gene_selection_service import (
    GeneSelectionError,
    apply_variance_filter,
)


class VarianceFilteringTests(unittest.TestCase):
    def test_keeps_top_variance_genes_in_expression_order(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "expression.csv"
            destination = root / "filtered.csv"
            source.write_text(
                "gene,c1,c2,c3\n"
                "medium,0,2,0\n"
                "lowest,1,1,1\n"
                "highest,0,4,0\n",
                encoding="utf-8",
            )

            result = apply_variance_filter(
                source_expression=source,
                destination_expression=destination,
                gene_count=2,
                include_known_tfs=False,
            )

            filtered = pd.read_csv(destination, index_col=0)
            self.assertEqual(list(filtered.index), ["medium", "highest"])
            self.assertEqual(result["ranked_gene_count"], 2)
            self.assertEqual(result["retained_gene_count"], 2)
            self.assertEqual(result["removed_gene_count"], 1)

    def test_unions_known_tfs_without_reordering_expression(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "expression.csv"
            destination = root / "filtered.csv"
            source.write_text(
                "gene,c1,c2,c3\n"
                "known_tf,1,1,1\n"
                "highest,0,4,0\n"
                "other,0,2,0\n",
                encoding="utf-8",
            )

            result = apply_variance_filter(
                source_expression=source,
                destination_expression=destination,
                gene_count=1,
                include_known_tfs=True,
                known_tf_gene_names={"known_tf", "not_in_matrix"},
            )

            filtered = pd.read_csv(destination, index_col=0)
            self.assertEqual(list(filtered.index), ["known_tf", "highest"])
            self.assertEqual(result["available_known_tf_count"], 1)
            self.assertEqual(result["forced_known_tf_count"], 1)
            self.assertEqual(result["retained_gene_count"], 2)

    def test_known_tf_does_not_consume_non_tf_top_n_quota(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "expression.csv"
            destination = root / "filtered.csv"
            source.write_text(
                "gene,c1,c2,c3\n"
                "high_variance_tf,0,10,0\n"
                "best_non_tf,0,8,0\n"
                "second_non_tf,0,4,0\n",
                encoding="utf-8",
            )

            result = apply_variance_filter(
                source_expression=source,
                destination_expression=destination,
                gene_count=1,
                include_known_tfs=True,
                known_tf_gene_names={"high_variance_tf"},
            )

            filtered = pd.read_csv(destination, index_col=0)
            self.assertEqual(
                list(filtered.index),
                ["high_variance_tf", "best_non_tf"],
            )
            self.assertEqual(result["ranked_non_tf_gene_count"], 1)
            self.assertEqual(result["retained_gene_count"], 2)

    def test_matches_versioned_ensembl_tf_and_preserves_matrix_identifier(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "expression.csv"
            destination = root / "filtered.csv"
            source.write_text(
                "gene,c1,c2,c3\n"
                "ENSG00000123268.4,1,1,1\n"
                "highest,0,4,0\n"
                "other,0,2,0\n",
                encoding="utf-8",
            )

            result = apply_variance_filter(
                source_expression=source,
                destination_expression=destination,
                gene_count=1,
                include_known_tfs=True,
                known_tf_gene_names={"ATF1", "ENSG00000123268"},
            )

            filtered = pd.read_csv(destination, index_col=0)
            self.assertEqual(
                list(filtered.index),
                ["ENSG00000123268.4", "highest"],
            )
            self.assertEqual(result["available_known_tf_count"], 1)
            self.assertEqual(result["forced_known_tf_count"], 1)

    def test_rejects_non_positive_gene_count(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "expression.csv"
            source.write_text("gene,c1\ngene_a,1\n", encoding="utf-8")

            with self.assertRaisesRegex(
                GeneSelectionError,
                "positive integer",
            ):
                apply_variance_filter(
                    source_expression=source,
                    destination_expression=root / "filtered.csv",
                    gene_count=0,
                    include_known_tfs=False,
                )


if __name__ == "__main__":
    unittest.main()
