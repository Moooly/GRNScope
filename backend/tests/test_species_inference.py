import unittest

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

    def test_plain_gene_symbols_are_not_used_to_guess_species(self):
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


if __name__ == "__main__":
    unittest.main()
