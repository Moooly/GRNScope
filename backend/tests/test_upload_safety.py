from __future__ import annotations

import io
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.storage import (
    cleanup_expired_temp_uploads,
    cleanup_temp_upload,
    save_upload_file,
)
from app.validators import parse_expression_matrix, upload_validation_mode


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

    def test_strict_validation_is_the_default_and_checks_every_value(self):
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

            with patch.dict(os.environ):
                os.environ.pop("GRNSCOPE_UPLOAD_VALIDATION_MODE", None)
                self.assertEqual(upload_validation_mode(), "strict")
                with self.assertRaisesRegex(ValueError, "non-numeric"):
                    parse_expression_matrix(matrix)

    def test_expired_cleanup_removes_orphans_and_id_cleanup_needs_no_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            temp_root = Path(directory)
            old_id = "a" * 32
            recent_id = "b" * 32
            old_file = temp_root / f"{old_id}__expression__old.csv"
            recent_file = temp_root / f"{recent_id}__expression__recent.csv"
            old_file.write_bytes(b"old")
            recent_file.write_bytes(b"recent")
            os.utime(old_file, (100, 100))
            os.utime(recent_file, (190, 190))

            with patch("app.storage.TEMP_UPLOAD_DIR", temp_root):
                result = cleanup_expired_temp_uploads(
                    now=200,
                    max_age_seconds=50,
                )
                recent_result = cleanup_temp_upload(recent_id)

            self.assertEqual(result, {"removed_count": 1, "removed_bytes": 3})
            self.assertFalse(old_file.exists())
            self.assertEqual(
                recent_result,
                {"removed_count": 1, "removed_bytes": 6},
            )
            self.assertFalse(recent_file.exists())


if __name__ == "__main__":
    unittest.main()
