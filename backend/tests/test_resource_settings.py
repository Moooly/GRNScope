import os
import unittest
from unittest.mock import patch

from app.services.beeline_service import resolve_algorithm_resource_settings


class ResourceSettingsTests(unittest.TestCase):
    def resolve(self, cpu_count, memory_mb, environment):
        with patch.dict(os.environ, environment, clear=True), patch(
            "app.services.beeline_service.os.cpu_count",
            return_value=cpu_count,
        ), patch(
            "app.services.beeline_service.resolve_system_memory_mb",
            return_value=memory_mb,
        ):
            return resolve_algorithm_resource_settings()

    def test_four_core_single_worker_receives_all_cores(self):
        settings = self.resolve(
            4,
            16_384,
            {
                "GRNSCOPE_MAX_CONCURRENT_ALGORITHMS": "1",
                "GRNSCOPE_WORKER_COUNT": "1",
            },
        )

        self.assertEqual(settings["effective_concurrency"], 1)
        self.assertEqual(settings["cpu_budget"], 4)
        self.assertEqual(settings["trajectory_workers"], 4)
        self.assertEqual(settings["memory_budget_mb"], 14_746)

    def test_eight_cores_are_divided_by_highest_concurrency_setting(self):
        settings = self.resolve(
            8,
            16_384,
            {
                "GRNSCOPE_MAX_CONCURRENT_ALGORITHMS": "2",
                "GRNSCOPE_WORKER_COUNT": "3",
            },
        )

        self.assertEqual(settings["effective_concurrency"], 3)
        self.assertEqual(settings["cpu_budget"], 2)
        self.assertEqual(settings["memory_budget_mb"], 4_915)

    def test_explicit_per_algorithm_overrides_are_supported(self):
        settings = self.resolve(
            8,
            32_768,
            {
                "GRNSCOPE_WORKER_COUNT": "2",
                "GRNSCOPE_ALGORITHM_CPU_BUDGET": "3",
                "GRNSCOPE_ALGORITHM_MEMORY_MB": "6000",
            },
        )

        self.assertEqual(settings["cpu_budget"], 3)
        self.assertEqual(settings["memory_budget_mb"], 6000)


if __name__ == "__main__":
    unittest.main()
