from __future__ import annotations

from pathlib import Path

from .validators import MAX_FILE_SIZE_BYTES

UPLOAD_COPY_BUFFER_SIZE = 16 * 1024 * 1024


def save_upload_file(upload_file, destination: Path) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    total_bytes = 0
    try:
        with destination.open("wb") as output:
            while True:
                chunk = upload_file.file.read(UPLOAD_COPY_BUFFER_SIZE)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_FILE_SIZE_BYTES:
                    raise ValueError("File size must be 500 MB or smaller.")
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return total_bytes
