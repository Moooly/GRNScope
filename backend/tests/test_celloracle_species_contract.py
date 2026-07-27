from __future__ import annotations

import unittest

from app.api.projects import normalize_celloracle_settings


class CellOracleSpeciesContractTests(unittest.TestCase):
    def test_dataset_species_is_the_single_source_of_truth(self):
        species, base_grn = normalize_celloracle_settings(
            "human",
            "auto",
            dataset_species="mouse",
        )

        self.assertEqual(species, "mouse")
        self.assertEqual(base_grn, "auto")

    def test_unsupported_dataset_species_is_rejected_for_celloracle(self):
        with self.assertRaisesRegex(ValueError, "CellOracle requires"):
            normalize_celloracle_settings(
                "human",
                "auto",
                dataset_species="other",
            )


if __name__ == "__main__":
    unittest.main()
