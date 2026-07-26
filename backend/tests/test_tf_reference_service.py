from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.services.tf_reference_service import (
    load_custom_tf_reference,
    load_species_tf_reference,
    match_known_tf_identifiers,
    normalize_tf_identifier,
)


class TfReferenceServiceTests(unittest.TestCase):
    def test_custom_csv_reference_uses_the_bundled_schema(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "my_tfs.csv"
            path.write_text(
                "gene_symbol,reference_gene_id\n"
                "CustomTF1,CUSTOM0001\n"
                "CustomTF2,\n",
                encoding="utf-8",
            )

            identifiers, reference = load_custom_tf_reference(path)

        self.assertEqual(
            identifiers,
            ["CustomTF1", "CUSTOM0001", "CustomTF2"],
        )
        self.assertEqual(reference["species"], "other")
        self.assertEqual(reference["status"], "available")
        self.assertEqual(reference["source"], "user_upload")
        self.assertEqual(reference["gene_count"], 2)
        self.assertEqual(reference["reference_gene_id_count"], 1)

    def test_custom_csv_reference_requires_gene_symbol_column(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "my_tfs.csv"
            path.write_text("name\nCustomTF1\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "gene_symbol"):
                load_custom_tf_reference(path)

    def test_all_bundled_species_references_are_readable(self) -> None:
        backend_root = Path(__file__).resolve().parents[1]
        expected_counts = {
            "human": 1639,
            "mouse": 1611,
            "rat": 1377,
            "pig": 1232,
            "chicken": 909,
            "zebrafish": 2210,
            "xenopus_tropicalis": 1183,
            "drosophila": 651,
            "c_elegans": 590,
            "s_cerevisiae": 128,
        }

        for species, expected_count in expected_counts.items():
            with self.subTest(species=species):
                genes, reference = load_species_tf_reference(
                    species,
                    reference_root=backend_root,
                )

                self.assertEqual(reference["status"], "available")
                self.assertEqual(reference["species"], species)
                self.assertEqual(reference["gene_count"], expected_count)
                self.assertEqual(reference["symbol_count"], expected_count)
                self.assertEqual(len(genes), reference["identifier_count"])
                self.assertGreaterEqual(len(genes), expected_count)
                self.assertEqual(len(genes), len(set(genes)))
                self.assertEqual(
                    reference["supported_identifier_types"],
                    ["gene_symbol", "reference_gene_id"],
                )
                self.assertEqual(
                    reference["source_filename"],
                    f"{species}.csv",
                )
                self.assertEqual(len(reference["sha256"]), 64)

        other_genes, other_reference = load_species_tf_reference(
            "other",
            reference_root=backend_root,
        )
        self.assertEqual(other_genes, [])
        self.assertEqual(other_reference["status"], "unavailable")

    def test_legacy_tf_file_is_used_only_for_human(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_dir = root / "data"
            data_dir.mkdir()
            (data_dir / "known_tf_gene_names.txt").write_text(
                "TF1\nTF2\nTF1\n",
                encoding="utf-8",
            )

            human_genes, human_reference = load_species_tf_reference(
                "human",
                reference_root=root,
            )
            mouse_genes, mouse_reference = load_species_tf_reference(
                "mouse",
                reference_root=root,
            )

        self.assertEqual(human_genes, ["TF1", "TF2"])
        self.assertEqual(human_reference["status"], "available")
        self.assertEqual(human_reference["gene_count"], 2)
        self.assertEqual(mouse_genes, [])
        self.assertEqual(mouse_reference["status"], "unavailable")

    def test_species_specific_reference_is_loaded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_dir = root / "data" / "tf_gene_names"
            reference_dir.mkdir(parents=True)
            (reference_dir / "mouse.txt").write_text(
                "Sox2\nPou5f1\n",
                encoding="utf-8",
            )

            genes, reference = load_species_tf_reference(
                "mouse",
                reference_root=root,
            )

        self.assertEqual(genes, ["Sox2", "Pou5f1"])
        self.assertEqual(reference["species"], "mouse")
        self.assertEqual(reference["source_filename"], "mouse.txt")

    def test_csv_reference_exposes_symbols_and_database_ids(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_dir = root / "data" / "tf_gene_names"
            reference_dir.mkdir(parents=True)
            (reference_dir / "mouse.csv").write_text(
                "gene_symbol,reference_gene_id\n"
                "Sox2,ENSMUSG00000074637\n"
                "Sox2,ENSMUSG00000112345\n"
                "Pou5f1,ENSMUSG00000024406\n",
                encoding="utf-8",
            )
            (reference_dir / "mouse.txt").write_text(
                "fallback\n",
                encoding="utf-8",
            )

            identifiers, reference = load_species_tf_reference(
                "mouse",
                reference_root=root,
            )

        self.assertEqual(
            identifiers,
            [
                "Sox2",
                "ENSMUSG00000074637",
                "ENSMUSG00000112345",
                "Pou5f1",
                "ENSMUSG00000024406",
            ],
        )
        self.assertEqual(reference["gene_count"], 2)
        self.assertEqual(reference["reference_gene_id_count"], 3)
        self.assertEqual(reference["identifier_count"], 5)
        self.assertEqual(reference["source_filename"], "mouse.csv")

    def test_matches_symbols_and_versioned_reference_ids_without_renaming(self) -> None:
        matched = match_known_tf_identifiers(
            [
                "Sox2",
                "ENSMUSG00000074637.12",
                "not_a_tf",
            ],
            ["Sox2", "ENSMUSG00000074637"],
        )

        self.assertEqual(
            matched,
            {"Sox2", "ENSMUSG00000074637.12"},
        )

    def test_symbol_matching_remains_case_sensitive(self) -> None:
        self.assertEqual(
            match_known_tf_identifiers(["foxk2", "FOXK2"], ["foxk2"]),
            {"foxk2"},
        )
        self.assertEqual(
            normalize_tf_identifier("AC008770.3"),
            "AC008770.3",
        )


if __name__ == "__main__":
    unittest.main()
