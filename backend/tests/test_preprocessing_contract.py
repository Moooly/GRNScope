from __future__ import annotations

import unittest

from app.preprocessing_contract import (
    DATASET_SPECIES_OPTIONS,
    build_preprocessing_config,
)


def valid_form_values() -> dict[str, str]:
    return {
        "matrix_state": "raw",
        "dataset_species": "human",
        "enabled_gene_selection_stages": '["variance", "detection", "trajectory"]',
        "detection_threshold_percent": "10",
        "variance_gene_count": "500",
        "include_known_tfs": "true",
        "gene_ordering_source": "calculate",
        "gene_ordering_filename": "",
        "trajectory_p_value": "0.01",
        "trajectory_bonferroni": "true",
        "include_significant_tfs": "true",
    }


class PreprocessingContractTests(unittest.TestCase):
    def test_accepts_every_dataset_species_option(self) -> None:
        expected_species = {
            "human",
            "mouse",
            "rat",
            "pig",
            "chicken",
            "zebrafish",
            "xenopus_tropicalis",
            "drosophila",
            "c_elegans",
            "s_cerevisiae",
            "other",
        }
        self.assertEqual(DATASET_SPECIES_OPTIONS, expected_species)

        for species in expected_species:
            with self.subTest(species=species):
                values = valid_form_values()
                values["dataset_species"] = species
                config = build_preprocessing_config(**values)
                self.assertEqual(config["dataset_species"], species)

    def test_builds_versioned_config_in_execution_order(self) -> None:
        config = build_preprocessing_config(**valid_form_values())

        self.assertEqual(config["schema_version"], 1)
        self.assertEqual(
            config["enabled_stages"],
            ["detection", "trajectory", "variance"],
        )
        self.assertEqual(config["matrix_state"], "raw")
        self.assertEqual(config["dataset_species"], "human")
        self.assertEqual(config["detection"]["minimum_cell_percent"], 10)
        self.assertEqual(config["trajectory"]["p_value_threshold"], 0.01)
        self.assertEqual(config["variance"]["gene_count"], 500)

    def test_preserves_settings_for_disabled_stages(self) -> None:
        values = valid_form_values()
        values["enabled_gene_selection_stages"] = '["detection"]'

        config = build_preprocessing_config(**values)

        self.assertFalse(config["trajectory"]["enabled"])
        self.assertFalse(config["variance"]["enabled"])
        self.assertEqual(config["trajectory"]["p_value_threshold"], 0.01)
        self.assertEqual(config["variance"]["gene_count"], 500)

    def test_rejects_unknown_or_duplicate_stages(self) -> None:
        for raw_stages in ('["detection", "unknown"]', '["detection", "detection"]'):
            with self.subTest(raw_stages=raw_stages):
                values = valid_form_values()
                values["enabled_gene_selection_stages"] = raw_stages
                with self.assertRaises(ValueError):
                    build_preprocessing_config(**values)

    def test_requires_filename_for_enabled_uploaded_gene_ordering(self) -> None:
        values = valid_form_values()
        values["gene_ordering_source"] = "upload"

        with self.assertRaisesRegex(ValueError, "GeneOrdering CSV filename"):
            build_preprocessing_config(**values)

    def test_rejects_invalid_bounds_and_non_strict_booleans(self) -> None:
        invalid_fields = {
            "detection_threshold_percent": "101",
            "variance_gene_count": "0",
            "trajectory_p_value": "nan",
            "include_known_tfs": "yes",
        }
        for field_name, invalid_value in invalid_fields.items():
            with self.subTest(field_name=field_name):
                values = valid_form_values()
                values[field_name] = invalid_value
                with self.assertRaises(ValueError):
                    build_preprocessing_config(**values)


if __name__ == "__main__":
    unittest.main()
