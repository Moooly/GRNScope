import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from app.services.pseudotime_format_service import (
    PSEUDOTIME_CANONICALIZATION_VERSION,
    PseudotimeFormatError,
    ensure_canonical_project_pseudotime,
    read_canonical_pseudotime_frame,
)
from app.validators import parse_pseudotime


class PseudotimeFormatServiceTests(unittest.TestCase):
    def test_headered_single_column_is_assigned_by_expression_cell_order(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "pseudotime.csv"
            path.write_text(
                "pseudotime\n0\n0.25\n0.75\n1\n",
                encoding="utf-8",
            )

            frame, source_format = read_canonical_pseudotime_frame(
                path,
                ["CellD", "CellB", "CellA", "CellC"],
            )

            self.assertEqual(source_format, "single_column")
            self.assertEqual(
                list(frame.index),
                ["CellD", "CellB", "CellA", "CellC"],
            )
            self.assertEqual(list(frame.columns), ["pseudotime"])
            np.testing.assert_allclose(
                frame["pseudotime"].to_numpy(),
                [0, 0.25, 0.75, 1],
            )

    def test_headerless_single_column_is_supported(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "pseudotime.csv"
            path.write_text("0\n0.5\n1\n", encoding="utf-8")

            frame, source_format = read_canonical_pseudotime_frame(
                path,
                ["Cell1", "Cell2", "Cell3"],
            )

            self.assertEqual(source_format, "single_column")
            self.assertEqual(list(frame.columns), ["PseudoTime1"])
            np.testing.assert_allclose(
                frame["PseudoTime1"].to_numpy(),
                [0, 0.5, 1],
            )

    def test_shifted_multilineage_headers_are_reordered_and_preserve_na(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "pseudotime.csv"
            path.write_text(
                "Early,Late\n"
                "Cell3,NA,0.9\n"
                "Cell1,0.1,NA\n"
                "Cell2,0.5,0.4\n",
                encoding="utf-8",
            )

            frame, source_format = read_canonical_pseudotime_frame(
                path,
                ["Cell1", "Cell2", "Cell3"],
            )

            self.assertEqual(source_format, "cell_id_trajectory_columns")
            self.assertEqual(list(frame.index), ["Cell1", "Cell2", "Cell3"])
            self.assertEqual(list(frame.columns), ["Early", "Late"])
            self.assertTrue(np.isnan(frame.loc["Cell1", "Late"]))
            self.assertTrue(np.isnan(frame.loc["Cell3", "Early"]))
            self.assertEqual(frame.loc["Cell2", "Late"], 0.4)

    def test_named_cell_mismatch_is_rejected_during_upload_validation(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "pseudotime.csv"
            path.write_text(
                ",PseudoTime1\n"
                "Cell1,0\n"
                "Cell2,0.5\n"
                "Other,1\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                PseudotimeFormatError,
                "missing 1 expression cells.*unknown cells",
            ):
                parse_pseudotime(
                    path,
                    3,
                    expected_cell_names=["Cell1", "Cell2", "Cell3"],
                )

    def test_project_canonicalization_preserves_source_and_records_provenance(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            project_dir = Path(temporary_directory) / "project"
            project_dir.mkdir()
            expression_path = project_dir / "ExpressionData.csv"
            expression_path.write_text(
                ",Cell1,Cell2,Cell3\n"
                "GeneA,1,2,3\n"
                "GeneB,3,2,1\n",
                encoding="utf-8",
            )
            source_path = project_dir / "uploaded-pseudotime.csv"
            source_text = "pseudotime\n0\n0.5\n1\n"
            source_path.write_text(source_text, encoding="utf-8")

            canonical_path, manifest = ensure_canonical_project_pseudotime(
                project_dir=project_dir,
                expression_path=expression_path,
                source_pseudotime=source_path,
            )

            self.assertEqual(
                source_path.read_text(encoding="utf-8"),
                source_text,
            )
            canonical = pd.read_csv(canonical_path, index_col=0)
            self.assertEqual(list(canonical.index), ["Cell1", "Cell2", "Cell3"])
            self.assertEqual(list(canonical.columns), ["pseudotime"])
            self.assertEqual(
                manifest["signature"]["version"],
                PSEUDOTIME_CANONICALIZATION_VERSION,
            )
            self.assertEqual(manifest["source_format"], "single_column")


if __name__ == "__main__":
    unittest.main()
