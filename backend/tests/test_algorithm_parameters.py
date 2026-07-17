import json
import unittest
from pathlib import Path

from app.algorithm_registry import (
    ALGORITHMS,
    resolve_algorithm_parameters,
    resolve_selected_algorithm_parameters,
    validate_algorithm_parameters,
)
from app.services.beeline_service import (
    build_algorithm_runtime_params,
    build_beeline_config,
)


NON_DEFAULT_PARAMETERS = {
    "GENIE3": {"nEstimators": 7, "maxFeatures": "log2"},
    "GRNBOOST2": {"learningRate": 0.1, "nEstimators": 20, "maxFeatures": 0.5},
    "CELLORACLE": {"maxCells": 50, "pValueCutoff": 0.1},
    "PPCOR": {"pVal": 0.2},
    "SCODE": {"z": 2, "nIter": 5, "nRep": 2},
    "SINCERITIES": {"nBins": 4},
    "SCRIBE": {
        "delay": 2,
        "method": "RDI",
        "lowerDetectionLimit": 0.1,
        "expressionFamily": "negbinomial",
        "log": True,
        "ignorePT": False,
    },
    "SINGE": {
        "lambda": 0.2,
        "dT": 4,
        "num_lags": 3,
        "kernel_width": 1.0,
        "prob_zero_removal": 0.2,
        "prob_remove_samples": 0.3,
        "family": "poisson",
        "num_replicates": 2,
    },
    "LEAP": {"maxLag": 0.2},
    "GRISLI": {"L": 2, "R": 3, "alphaMin": 0.2},
    "SCSGL": {"pos_density": 0.2, "neg_density": 0.3, "assoc": "dotprod"},
}


class AlgorithmParameterValidationTests(unittest.TestCase):
    def test_every_exposed_parameter_accepts_a_non_default_value(self):
        parameterized_algorithms = {
            algorithm["id"]: algorithm
            for algorithm in ALGORITHMS
            if algorithm.get("parameters")
        }
        self.assertEqual(set(NON_DEFAULT_PARAMETERS), set(parameterized_algorithms))

        for algorithm_id, algorithm in parameterized_algorithms.items():
            with self.subTest(algorithm_id=algorithm_id):
                expected_names = {
                    parameter["name"] for parameter in algorithm["parameters"]
                }
                submitted = NON_DEFAULT_PARAMETERS[algorithm_id]
                self.assertEqual(set(submitted), expected_names)
                self.assertEqual(
                    validate_algorithm_parameters(algorithm_id, submitted),
                    submitted,
                )
                self.assertEqual(
                    resolve_algorithm_parameters(algorithm_id, submitted),
                    submitted,
                )

    def test_runtime_config_preserves_every_resolved_parameter(self):
        for algorithm_id, submitted in NON_DEFAULT_PARAMETERS.items():
            with self.subTest(algorithm_id=algorithm_id):
                manifest = {"algorithm_parameters": {algorithm_id: submitted}}
                runtime_params = build_algorithm_runtime_params(
                    algorithm_id, manifest
                )
                config = build_beeline_config(
                    input_dir=Path("/tmp/grnscope-input"),
                    output_dir=Path("/tmp/grnscope-output"),
                    dataset_id="dataset",
                    run_ids=["run-1"],
                    algorithm_id=algorithm_id,
                    include_pseudotime=True,
                    extra_params=runtime_params,
                )
                for name, value in submitted.items():
                    self.assertIn(f"{name}: [{json.dumps(value)}]", config)

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

    def test_exclusive_numeric_bounds_are_enforced(self):
        with self.assertRaises(ValueError):
            validate_algorithm_parameters("SINGE", {"prob_remove_samples": 1})
        with self.assertRaises(ValueError):
            validate_algorithm_parameters("SCSGL", {"pos_density": 0})

    def test_singe_rejects_an_invalid_time_lag_product(self):
        with self.assertRaisesRegex(ValueError, "must be less than 100"):
            resolve_algorithm_parameters("SINGE", {"dT": 20, "num_lags": 5})

    def test_celloracle_rejects_too_few_subsampled_cells(self):
        with self.assertRaises(ValueError):
            validate_algorithm_parameters("CELLORACLE", {"maxCells": 2})

    def test_scsgl_association_is_allowlisted(self):
        with self.assertRaises(ValueError):
            validate_algorithm_parameters("SCSGL", {"assoc": "not-a-kernel"})

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
