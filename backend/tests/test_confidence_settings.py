import os
import unittest
from unittest.mock import patch

from app.services.beeline_service import resolve_confidence_settings


class ConfidenceSettingsTests(unittest.TestCase):
    def test_confidence_runs_are_enabled_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            settings = resolve_confidence_settings({}, gene_count=100)

        self.assertTrue(settings["confidence_enabled"])
        self.assertEqual(settings["bootstrap_runs"], 15)
        self.assertEqual(settings["min_runs"], 3)
        self.assertEqual(settings["subsample_fraction"], 0.8)
        self.assertTrue(settings["early_stopping_enabled"])
        self.assertEqual(settings["stop_rho"], 0.95)

    def test_project_can_override_default_spearman_threshold(self):
        with patch.dict(os.environ, {}, clear=True):
            settings = resolve_confidence_settings(
                {"confidence_stop_rho": 0.97},
                gene_count=100,
            )

        self.assertEqual(settings["stop_rho"], 0.97)

    def test_legacy_activation_flags_cannot_disable_confidence_runs(self):
        with patch.dict(
            os.environ,
            {"GRNSCOPE_ENABLE_CONFIDENCE_RUNS": "0"},
            clear=True,
        ):
            settings = resolve_confidence_settings(
                {"enable_confidence_runs": False},
                gene_count=100,
            )

        self.assertTrue(settings["confidence_enabled"])
        self.assertEqual(settings["bootstrap_runs"], 15)
        self.assertEqual(settings["min_runs"], 3)


if __name__ == "__main__":
    unittest.main()
