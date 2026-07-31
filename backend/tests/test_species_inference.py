import tempfile
import unittest
from pathlib import Path

from app.species_inference import infer_species_from_gene_names


class SpeciesInferenceTests(unittest.TestCase):
    def test_infers_mouse_from_species_coded_ensembl_ids(self):
        result = infer_species_from_gene_names(
            ["ENSMUSG00000017167.6", "ENSMUSG00000064341", "Sox9"]
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["species"], "mouse")
        self.assertEqual(result["label"], "Mouse")

    def test_does_not_confuse_chicken_ids_with_human_ids(self):
        result = infer_species_from_gene_names(
            ["ENSGALG00000000001", "ENSGALG00000000002"]
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["species"], "chicken")

    def test_shared_gene_symbols_do_not_guess_species(self):
        self.assertIsNone(
            infer_species_from_gene_names(["SOX9", "FOXL2", "CTNNB1", "GATA4"])
        )

    def test_sparse_species_ids_do_not_label_a_symbol_matrix(self):
        self.assertIsNone(
            infer_species_from_gene_names(
                [
                    "SOX9",
                    "FOXL2",
                    "CTNNB1",
                    "GATA4",
                    "MYC",
                    "TP53",
                    "POU5F1",
                    "NANOG",
                    "SOX2",
                    "ENSMUSG00000000567",
                    "ENSMUSG00000025056",
                ]
            )
        )

    def test_mixed_species_identifiers_require_a_clear_majority(self):
        self.assertIsNone(
            infer_species_from_gene_names(
                [
                    "ENSG00000125398",
                    "ENSG00000107485",
                    "ENSMUSG00000000567",
                    "ENSMUSG00000025056",
                ]
            )
        )

    def test_species_specific_tf_matches_can_infer_species(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_dir = root / "data" / "tf_gene_names"
            reference_dir.mkdir(parents=True)
            (reference_dir / "human.txt").write_text(
                "\n".join([f"HUMAN_{index}" for index in range(1, 10)] + ["SHARED"]),
                encoding="utf-8",
            )
            (reference_dir / "mouse.txt").write_text(
                "MOUSE_1\nSHARED\n",
                encoding="utf-8",
            )

            result = infer_species_from_gene_names(
                [
                    *[f"HUMAN_{index}" for index in range(1, 10)],
                    "MOUSE_1",
                    "SHARED",
                    "NOT_A_TF",
                ],
                reference_root=root,
            )

        self.assertIsNotNone(result)
        self.assertEqual(result["species"], "human")
        self.assertEqual(result["basis"], "species_specific_tf_reference_matches")
        self.assertEqual(result["confidence"], 0.9)
        self.assertEqual(result["discriminating_count"], 10)

    def test_tf_matches_below_ninety_percent_remain_ambiguous(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_dir = root / "data" / "tf_gene_names"
            reference_dir.mkdir(parents=True)
            (reference_dir / "human.txt").write_text(
                "\n".join(f"HUMAN_{index}" for index in range(1, 9)),
                encoding="utf-8",
            )
            (reference_dir / "mouse.txt").write_text(
                "MOUSE_1\nMOUSE_2\n",
                encoding="utf-8",
            )

            result = infer_species_from_gene_names(
                [
                    *[f"HUMAN_{index}" for index in range(1, 9)],
                    "MOUSE_1",
                    "MOUSE_2",
                ],
                reference_root=root,
            )

        self.assertIsNone(result)

    def test_shared_tf_matches_do_not_count_as_species_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_dir = root / "data" / "tf_gene_names"
            reference_dir.mkdir(parents=True)
            (reference_dir / "human.txt").write_text(
                "SHARED_1\nSHARED_2\nSHARED_3\n",
                encoding="utf-8",
            )
            (reference_dir / "pig.txt").write_text(
                "SHARED_1\nSHARED_2\nSHARED_3\n",
                encoding="utf-8",
            )

            result = infer_species_from_gene_names(
                ["SHARED_1", "SHARED_2", "SHARED_3"],
                reference_root=root,
            )

        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
