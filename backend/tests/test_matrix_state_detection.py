from __future__ import annotations

import math
import tempfile
import unittest
from pathlib import Path

from app.matrix_state_detection import detect_matrix_state


class MatrixStateDetectionTests(unittest.TestCase):
    def write_matrix(self, root: Path, values: list[list[float]]) -> Path:
        path = root / "ExpressionData.csv"
        cell_headers = [f"cell-{index + 1}" for index in range(len(values[0]))]
        rows = ["," + ",".join(cell_headers)]
        for gene_index, row in enumerate(values, start=1):
            rows.append(
                f"gene-{gene_index}," + ",".join(f"{value:.10g}" for value in row)
            )
        path.write_text("\n".join(rows) + "\n", encoding="utf-8")
        return path

    def test_detects_raw_counts(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = self.write_matrix(
                Path(temp_dir),
                [
                    [0, 2, 8],
                    [1, 0, 5],
                    [0, 4, 12],
                ],
            )

            result = detect_matrix_state(path)

        self.assertEqual(result["detected_state"], "raw")
        self.assertEqual(result["confidence"], "high")

    def test_detects_library_size_normalized_values(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = self.write_matrix(
                Path(temp_dir),
                [
                    [2500.5, 1000.2, 4000.4],
                    [3499.5, 4999.8, 2000.6],
                    [4000.0, 4000.0, 3999.0],
                ],
            )

            result = detect_matrix_state(path)

        self.assertEqual(result["detected_state"], "normalized")
        self.assertEqual(result["confidence"], "high")

    def test_detects_log1p_normalized_values(self):
        normalized = [
            [1000.0, 2500.0, 500.0],
            [3000.0, 1500.0, 6500.0],
            [6000.0, 6000.0, 3000.0],
        ]
        log_values = [
            [math.log1p(value) for value in row]
            for row in normalized
        ]
        with tempfile.TemporaryDirectory() as temp_dir:
            path = self.write_matrix(Path(temp_dir), log_values)

            result = detect_matrix_state(path)

        self.assertEqual(result["detected_state"], "log_normalized")
        self.assertEqual(result["confidence"], "high")
        self.assertEqual(result["metrics"]["inverse_log_base"], "natural")

    def test_detects_log2_normalized_values(self):
        normalized = [
            [1000.0, 2500.0, 500.0],
            [3000.0, 1500.0, 6500.0],
            [6000.0, 6000.0, 3000.0],
        ]
        log_values = [
            [math.log2(value + 1) for value in row]
            for row in normalized
        ]
        with tempfile.TemporaryDirectory() as temp_dir:
            path = self.write_matrix(Path(temp_dir), log_values)

            result = detect_matrix_state(path)

        self.assertEqual(result["detected_state"], "log_normalized")
        self.assertEqual(result["confidence"], "high")
        self.assertEqual(result["metrics"]["inverse_log_base"], "2")

    def test_detects_log10_normalized_values(self):
        normalized = [
            [1000.0, 2500.0, 500.0],
            [3000.0, 1500.0, 6500.0],
            [6000.0, 6000.0, 3000.0],
        ]
        log_values = [
            [math.log10(value + 1) for value in row]
            for row in normalized
        ]
        with tempfile.TemporaryDirectory() as temp_dir:
            path = self.write_matrix(Path(temp_dir), log_values)

            result = detect_matrix_state(path)

        self.assertEqual(result["detected_state"], "log_normalized")
        self.assertEqual(result["confidence"], "high")
        self.assertEqual(result["metrics"]["inverse_log_base"], "10")

    def test_negative_values_remain_ambiguous(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = self.write_matrix(
                Path(temp_dir),
                [
                    [-1.2, 0.5],
                    [0.2, 1.1],
                ],
            )

            result = detect_matrix_state(path)

        self.assertIsNone(result["detected_state"])
        self.assertEqual(result["confidence"], "low")
        self.assertGreater(result["metrics"]["negative_values"], 0)


if __name__ == "__main__":
    unittest.main()
