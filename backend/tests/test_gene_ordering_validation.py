from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.validators import validate_gene_ordering_csv


class GeneOrderingValidationTests(unittest.TestCase):
    def write_csv(self, directory: str, contents: str) -> Path:
        path = Path(directory) / "GeneOrdering.csv"
        path.write_text(contents, encoding="utf-8")
        return path

    def test_accepts_beeline_columns_and_reports_unmatched_genes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = self.write_csv(
                temp_dir,
                ",p_val,variance\n"
                "GENE1,0.001,2.5\n"
                "GENE2,0.02,1.25\n"
                "NOT_IN_MATRIX,0.5,0.1\n",
            )
            result = validate_gene_ordering_csv(path, {"GENE1", "GENE2", "GENE3"})

        self.assertEqual(result["status"], "validated")
        self.assertEqual(result["gene_count"], 3)
        self.assertEqual(result["matching_gene_count"], 2)
        self.assertEqual(result["unmatched_gene_count"], 1)
        self.assertEqual(result["unmatched_gene_names"], ["NOT_IN_MATRIX"])
        self.assertTrue(result["has_variance"])

    def test_accepts_beeline_vgam_p_value_header(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = self.write_csv(
                temp_dir,
                ",VGAMpValue,Variance\n"
                "CTNNB1,1e-12,0.9203740616\n"
                "GATA4,0.05,0.1986382526\n",
            )
            result = validate_gene_ordering_csv(path, {"CTNNB1", "GATA4"})

        self.assertEqual(result["status"], "validated")
        self.assertEqual(result["gene_count"], 2)
        self.assertEqual(result["matching_gene_count"], 2)
        self.assertTrue(result["has_variance"])

    def test_accepts_headerless_gene_and_p_value_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = self.write_csv(
                temp_dir,
                "GENE1,0.001\nGENE2,0.02\n",
            )
            result = validate_gene_ordering_csv(path, {"GENE1", "GENE2"})

        self.assertEqual(result["matching_gene_count"], 2)
        self.assertFalse(result["has_variance"])

    def test_rejects_invalid_p_values_and_duplicate_genes(self) -> None:
        invalid_files = {
            "invalid p-value": ",p_val\nGENE1,not-a-number\n",
            "out of bounds": ",p_val\nGENE1,1.1\n",
            "duplicate": ",p_val\nGENE1,0.1\nGENE1,0.2\n",
        }
        for label, contents in invalid_files.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temp_dir:
                path = self.write_csv(temp_dir, contents)
                with self.assertRaises(ValueError):
                    validate_gene_ordering_csv(path, {"GENE1"})

    def test_rejects_file_without_expression_gene_overlap(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = self.write_csv(temp_dir, ",p_val\nOTHER_GENE,0.01\n")
            with self.assertRaisesRegex(ValueError, "no genes in common"):
                validate_gene_ordering_csv(path, {"GENE1"})


if __name__ == "__main__":
    unittest.main()
