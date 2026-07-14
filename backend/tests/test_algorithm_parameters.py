import unittest

from app.algorithm_registry import (
    resolve_algorithm_parameters,
    resolve_selected_algorithm_parameters,
    validate_algorithm_parameters,
)


class AlgorithmParameterValidationTests(unittest.TestCase):
    def test_singe_family_is_allowlisted(self):
        self.assertEqual(
            validate_algorithm_parameters("SINGE", {"family": "gaussian"}),
            {"family": "gaussian"},
        )
        self.assertEqual(
            validate_algorithm_parameters("SINGE", {"family": "poisson"}),
            {"family": "poisson"},
        )
        with self.assertRaises(ValueError):
            validate_algorithm_parameters("SINGE", {"family": "$(whoami)"})

    def test_integer_parameters_reject_decimals(self):
        with self.assertRaises(ValueError):
            validate_algorithm_parameters("SCODE", {"nRep": 3.9})

    def test_numeric_parameters_reject_out_of_range_values(self):
        with self.assertRaises(ValueError):
            validate_algorithm_parameters("SCODE", {"nRep": 999})

    def test_resolved_snapshot_contains_defaults_and_overrides(self):
        resolved = resolve_algorithm_parameters("SCODE", {"nRep": 5})
        self.assertEqual(resolved, {"z": 4, "nIter": 1000, "nRep": 5})

    def test_selected_snapshot_includes_parameterless_algorithms(self):
        resolved = resolve_selected_algorithm_parameters(
            ["SCODE", "PEARSON"],
            {"SCODE": {"nRep": 4}},
        )
        self.assertEqual(resolved["SCODE"]["nRep"], 4)
        self.assertEqual(resolved["PEARSON"], {})


if __name__ == "__main__":
    unittest.main()
