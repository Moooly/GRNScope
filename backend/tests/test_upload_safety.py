from __future__ import annotations

import asyncio
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.api import uploads
from app.storage import save_upload_file
from app.services.matrix_transformation_service import read_expression_frame


class UploadSafetyTests(unittest.TestCase):
    def test_streaming_upload_enforces_size_limit_and_removes_partial_file(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "too-large.csv"
            upload = SimpleNamespace(file=io.BytesIO(b"123456"))

            with (
                patch("app.storage.MAX_FILE_SIZE_BYTES", 5),
                self.assertRaisesRegex(ValueError, "500 MB"),
            ):
                save_upload_file(upload, destination)

            self.assertFalse(destination.exists())

    def test_project_expression_loading_checks_every_value(self):
        with tempfile.TemporaryDirectory() as directory:
            matrix = Path(directory) / "matrix.csv"
            headers = ["gene", *[f"c{index}" for index in range(1, 11)]]
            rows = [
                [f"G{row}", *(["1"] * 10)]
                for row in range(1, 7)
            ]
            rows[-1][6] = "not-a-number"
            matrix.write_text(
                "\n".join(
                    [",".join(headers), *[",".join(row) for row in rows]]
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "non-numeric"):
                read_expression_frame(matrix)


    def test_anndata_inspection_removes_its_temporary_file_after_failure(self):
        inspected_paths = []

        def reject_inspection(path):
            inspected_paths.append(path)
            self.assertEqual(path.read_bytes(), b"invalid h5ad")
            raise ValueError("invalid AnnData")

        upload = SimpleNamespace(filename="input.h5ad", file=io.BytesIO(b"invalid h5ad"))
        with patch("app.api.uploads.inspect_h5ad_expression", side_effect=reject_inspection):
            result = asyncio.run(uploads.inspect_expression_upload(upload))

        self.assertFalse(result["ok"])
        self.assertIn("invalid AnnData", result["errors"])
        self.assertEqual(len(inspected_paths), 1)
        self.assertFalse(inspected_paths[0].parent.exists())


if __name__ == "__main__":
    unittest.main()
