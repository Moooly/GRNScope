import os
import unittest
from unittest.mock import patch

from app.services.beeline_service import (
    estimate_remaining_seconds_range_from_run_timings,
    resolve_confidence_settings,
)


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

    def test_remaining_time_range_uses_stability_streak_and_maximum_runs(self):
        metadata = {
            "run-1": {"status": "Completed", "elapsed_seconds": 120},
            "run-2": {"status": "Completed", "elapsed_seconds": 110},
            "run-3": {"status": "Completed", "elapsed_seconds": 100},
            "run-4": {"status": "Completed", "elapsed_seconds": 105},
            "run-5": {"status": "Running", "elapsed_seconds": 30},
        }

        remaining = estimate_remaining_seconds_range_from_run_timings(
            metadata,
            minimum_run_count=3,
            # A legacy 30-run value must still be capped by the current
            # confidence ceiling of 15 when calculating the upper ETA.
            maximum_run_count=30,
            current_streak=1,
            required_streak=2,
            current_run_elapsed_seconds=30,
        )

        # Median of the last three completed runs is 105 seconds. One more run
        # can complete the streak, while eleven runs remain to the hard ceiling.
        self.assertEqual(remaining, (75, 1125))

    def test_remaining_time_range_requires_two_future_checks_after_failed_stability(self):
        metadata = {
            "run-1": {"status": "Completed", "elapsed_seconds": 60},
            "run-2": {"status": "Completed", "elapsed_seconds": 60},
            "run-3": {"status": "Running", "elapsed_seconds": 10},
        }

        remaining = estimate_remaining_seconds_range_from_run_timings(
            metadata,
            minimum_run_count=3,
            maximum_run_count=15,
            current_streak=0,
            required_streak=2,
            current_run_elapsed_seconds=10,
        )

        self.assertEqual(remaining, (110, 770))


if __name__ == "__main__":
    unittest.main()
