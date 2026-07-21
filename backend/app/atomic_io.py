"""Atomic JSON/text file writes.

Manifests (``project.json``, ``jobs.json``, ``metadata.json``) are read by the
API on nearly every request while other requests rewrite them. A plain
``Path.write_text`` truncates the file to zero before writing, so a concurrent
reader can observe an empty or half-written file and fail to parse it. Writing
to a temp file in the same directory and then ``os.replace``-ing it is atomic on
POSIX filesystems, so readers always see either the old or the new file — never
a torn one.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def atomic_write_text(path: Path, text: str) -> None:
    directory = path.parent
    directory.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        dir=str(directory),
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except OSError:
            pass
        raise


def atomic_write_json(path: Path, data: Any) -> None:
    atomic_write_text(path, json.dumps(data, indent=2))
