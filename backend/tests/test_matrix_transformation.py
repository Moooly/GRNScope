from __future__ import annotations

import json
import math
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from app.services.beeline_service import (
    build_preprocessing_signature,
    ensure_project_preprocessed_expression,
)
from app.services.matrix_transformation_service import (
    MatrixTransformationError,
    NORMALIZATION_TARGET_SUM,
    transform_expression_matrix,
)


class MatrixTransformationTests(unittest.TestCase):
    def write_expression(self, directory: Path, contents: str) -> Path:
        source = directory / "expression.csv"
        source.write_text(contents, encoding="utf-8")
        return source

    def read_expression(self, path: Path) -> pd.DataFrame:
        return pd.read_csv(path, index_col=0)

    def test_raw_matrix_is_normalized_per_cell_then_log1p_transformed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            source = self.write_expression(
                directory,
                ",cell-1,cell-2\nGENE1,1,3\nGENE2,1,1\n",
            )
            destination = directory / "transformed.csv"

            transformation = transform_expression_matrix(
                source_expression=source,
                destination_expression=destination,
                matrix_state="raw",
            )
            transformed = self.read_expression(destination)

        expected_normalized = np.asarray(
            [
                [NORMALIZATION_TARGET_SUM / 2, NORMALIZATION_TARGET_SUM * 3 / 4],
                [NORMALIZATION_TARGET_SUM / 2, NORMALIZATION_TARGET_SUM / 4],
            ]
        )
        np.testing.assert_allclose(
            transformed.to_numpy(),
            np.log1p(expected_normalized),
            rtol=1e-8,
        )
        self.assertEqual(list(transformed.index), ["GENE1", "GENE2"])
        self.assertEqual(list(transformed.columns), ["cell-1", "cell-2"])
        self.assertEqual(
            transformation["operations"],
            ["normalize_total", "log1p"],
        )

    def test_normalized_matrix_receives_log1p_only(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            source = self.write_expression(
                directory,
                ",cell-1,cell-2\nGENE1,1,3\nGENE2,1,1\n",
            )
            destination = directory / "transformed.csv"

            transformation = transform_expression_matrix(
                source_expression=source,
                destination_expression=destination,
                matrix_state="normalized",
            )
            transformed = self.read_expression(destination)

        np.testing.assert_allclose(
            transformed.to_numpy(),
            np.log1p(np.asarray([[1.0, 3.0], [1.0, 1.0]])),
            rtol=1e-8,
        )
        self.assertAlmostEqual(
            transformed.loc["GENE1", "cell-1"],
            math.log(2),
        )
        self.assertEqual(transformation["operations"], ["log1p"])

    def test_log_normalized_matrix_is_used_exactly_as_provided(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            source = self.write_expression(
                directory,
                ",cell-1,cell-2\nGENE1,0.123456789123,-0.2\n",
            )
            destination = directory / "transformed.csv"

            transformation = transform_expression_matrix(
                source_expression=source,
                destination_expression=destination,
                matrix_state="log_normalized",
            )

            self.assertEqual(
                destination.read_bytes(),
                source.read_bytes(),
            )
        self.assertEqual(transformation["operations"], [])

    def test_raw_and_normalized_states_reject_negative_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            source = self.write_expression(
                directory,
                ",cell-1\nGENE1,-1\n",
            )

            with self.assertRaisesRegex(
                MatrixTransformationError,
                "cannot contain negative values",
            ):
                transform_expression_matrix(
                    source_expression=source,
                    destination_expression=directory / "transformed.csv",
                    matrix_state="raw",
                )

    def test_variance_settings_change_preprocessed_cache_signature(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            source = self.write_expression(
                directory,
                ",cell-1\nGENE1,1\n",
            )
            first_manifest = {
                "preprocessing": {
                    "matrix_state": "raw",
                    "variance": {"enabled": False, "gene_count": 500},
                }
            }
            second_manifest = {
                "preprocessing": {
                    "matrix_state": "raw",
                    "variance": {"enabled": True, "gene_count": 1},
                }
            }

            first_signature = build_preprocessing_signature(
                source,
                first_manifest,
            )
            second_signature = build_preprocessing_signature(
                source,
                second_manifest,
            )

        self.assertNotEqual(first_signature, second_signature)
        self.assertFalse(first_signature["variance_filter"]["enabled"])
        self.assertEqual(
            second_signature["variance_filter"],
            {
                "engine": "grnscope",
                "version": 1,
                "enabled": True,
                "gene_count": 1,
                "include_known_tfs": False,
                "configured_include_known_tfs": False,
                "retain_significant_trajectory_tfs": False,
                "known_tf_gene_names_sha256": None,
            },
        )

    def test_variance_stage_limits_preprocessed_expression(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            source = self.write_expression(
                directory,
                ",cell-1,cell-2\nGENE1,1,2\nGENE2,2,4\nGENE3,3,6\n",
            )
            destination = directory / "preprocessed" / "ExpressionData.csv"
            manifest = {
                "preprocessed_expression_path": str(destination),
                "preprocessing": {
                    "matrix_state": "normalized",
                    "variance": {
                        "enabled": True,
                        "gene_count": 1,
                        "include_known_tfs": True,
                    },
                },
            }

            result = ensure_project_preprocessed_expression(
                "phase-three-project",
                source,
                manifest,
            )
            transformed = self.read_expression(result)

        self.assertEqual(list(transformed.index), ["GENE3"])

    def test_combined_trajectory_and_variance_retains_tfs_outside_non_tf_quota(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            source = self.write_expression(
                directory,
                (
                    ",cell-1,cell-2,cell-3\n"
                    "TF1,0,1,0\n"
                    "GENE_HIGH,0,10,0\n"
                    "GENE_LOW,0,2,0\n"
                ),
            )
            ordering = directory / "GeneOrdering.csv"
            ordering.write_text(
                ",p_val\n"
                "TF1,0.001\n"
                "GENE_HIGH,0.001\n"
                "GENE_LOW,0.001\n",
                encoding="utf-8",
            )
            destination = directory / "preprocessed" / "ExpressionData.csv"
            manifest = {
                "preprocessed_expression_path": str(destination),
                "gene_ordering_path": str(ordering),
                "known_tf_gene_names": ["TF1"],
                "preprocessing": {
                    "matrix_state": "log_normalized",
                    "detection": {"enabled": False},
                    "trajectory": {
                        "enabled": True,
                        "gene_ordering_source": "upload",
                        "p_value_threshold": 0.01,
                        "bonferroni_correction": False,
                        "retain_significant_tfs": True,
                    },
                    "variance": {
                        "enabled": True,
                        "gene_count": 1,
                        "include_known_tfs": False,
                    },
                },
            }

            result = ensure_project_preprocessed_expression(
                "combined-filter-project",
                source,
                manifest,
            )
            transformed = self.read_expression(result)
            preprocessing_manifest = json.loads(
                (destination.parent / "manifest.json").read_text(encoding="utf-8")
            )

        self.assertEqual(list(transformed.index), ["TF1", "GENE_HIGH"])
        variance_result = preprocessing_manifest["gene_selection"][-1]
        self.assertFalse(variance_result["configured_include_known_tfs"])
        self.assertTrue(variance_result["retain_significant_trajectory_tfs"])
        self.assertEqual(variance_result["ranked_non_tf_gene_count"], 1)


if __name__ == "__main__":
    unittest.main()
