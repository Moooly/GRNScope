from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .atomic_io import atomic_write_json
from .validators import MAX_FILE_SIZE_BYTES

BASE_DIR = Path(__file__).resolve().parent.parent
TEMP_UPLOAD_DIR = BASE_DIR / "temp_uploads"
TEMP_UPLOAD_ROOT = TEMP_UPLOAD_DIR
PROJECTS_DIR = BASE_DIR / "projects"
UPLOAD_COPY_BUFFER_SIZE = 16 * 1024 * 1024


def _temp_upload_ttl_seconds() -> int:
    try:
        return max(
            0,
            int(os.getenv("GRNSCOPE_TEMP_UPLOAD_TTL_SECONDS", str(24 * 60 * 60))),
        )
    except ValueError:
        return 24 * 60 * 60


TEMP_UPLOAD_TTL_SECONDS = _temp_upload_ttl_seconds()
TEMP_UPLOAD_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
_TEMP_CLEANUP_LOCK = threading.Lock()

TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


def create_temp_upload_id() -> str:
    return uuid.uuid4().hex


def temp_expression_path(temp_upload_id: str, original_name: str) -> Path:
    safe_name = Path(original_name).name
    return TEMP_UPLOAD_DIR / f"{temp_upload_id}__expression__{safe_name}"


def temp_pseudotime_path(temp_upload_id: str, original_name: str) -> Path:
    safe_name = Path(original_name).name
    return TEMP_UPLOAD_DIR / f"{temp_upload_id}__pseudotime__{safe_name}"


def temp_cluster_labels_path(temp_upload_id: str, original_name: str) -> Path:
    safe_name = Path(original_name).name
    return TEMP_UPLOAD_DIR / f"{temp_upload_id}__cluster_labels__{safe_name}"


def temp_metadata_path(temp_upload_id: str) -> Path:
    return TEMP_UPLOAD_DIR / f"{temp_upload_id}__metadata.json"


def validate_temp_upload_id(temp_upload_id: str) -> str:
    normalized = str(temp_upload_id).strip().lower()
    if not TEMP_UPLOAD_ID_PATTERN.fullmatch(normalized):
        raise ValueError("Invalid temporary upload identifier.")
    return normalized


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


def save_json(path: Path, data: dict[str, Any]) -> None:
    atomic_write_json(path, data)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def move_temp_upload_to_project(temp_upload_id: str, project_id: str) -> dict[str, Any]:
    temp_upload_id = validate_temp_upload_id(temp_upload_id)
    metadata = load_json(temp_metadata_path(temp_upload_id))

    project_dir = PROJECTS_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    result: dict[str, Any] = {"project_dir": str(project_dir)}

    expression_src = Path(metadata["expression_path"])
    expression_dst = project_dir / expression_src.name.replace(
        f"{temp_upload_id}__", "", 1
    )
    shutil.move(str(expression_src), str(expression_dst))
    result["expression_path"] = str(expression_dst)

    pseudotime_path = metadata.get("pseudotime_path")
    if pseudotime_path:
        pseudo_src = Path(pseudotime_path)
        pseudo_dst = project_dir / pseudo_src.name.replace(
            f"{temp_upload_id}__", "", 1
        )
        shutil.move(str(pseudo_src), str(pseudo_dst))
        result["pseudotime_path"] = str(pseudo_dst)

    cluster_labels_path = metadata.get("cluster_labels_path")
    if cluster_labels_path:
        labels_src = Path(cluster_labels_path)
        labels_dst = project_dir / labels_src.name.replace(
            f"{temp_upload_id}__", "", 1
        )
        shutil.move(str(labels_src), str(labels_dst))
        result["cluster_labels_path"] = str(labels_dst)

    shutil.move(str(temp_metadata_path(temp_upload_id)), str(project_dir / "upload_metadata.json"))
    return result


def cleanup_temp_upload(temp_upload_id: str) -> dict[str, int]:
    """Remove every file belonging to one temporary upload, including orphans."""

    normalized_id = validate_temp_upload_id(temp_upload_id)
    removed_count = 0
    removed_bytes = 0
    with _TEMP_CLEANUP_LOCK:
        for path in TEMP_UPLOAD_DIR.glob(f"{normalized_id}__*"):
            if not path.is_file():
                continue
            try:
                removed_bytes += path.stat().st_size
                path.unlink()
                removed_count += 1
            except FileNotFoundError:
                continue
    return {"removed_count": removed_count, "removed_bytes": removed_bytes}


def cleanup_expired_temp_uploads(
    *,
    now: float | None = None,
    max_age_seconds: int | None = None,
) -> dict[str, int]:
    """Delete stale temporary-upload files by modification time.

    This also catches interrupted uploads whose metadata file was never written.
    """

    current_time = time.time() if now is None else float(now)
    maximum_age = (
        TEMP_UPLOAD_TTL_SECONDS
        if max_age_seconds is None
        else max(0, int(max_age_seconds))
    )
    cutoff = current_time - maximum_age
    removed_count = 0
    removed_bytes = 0

    with _TEMP_CLEANUP_LOCK:
        for path in TEMP_UPLOAD_DIR.iterdir():
            if not path.is_file():
                continue
            try:
                stat = path.stat()
                if stat.st_mtime > cutoff:
                    continue
                path.unlink()
                removed_count += 1
                removed_bytes += stat.st_size
            except FileNotFoundError:
                continue

    return {"removed_count": removed_count, "removed_bytes": removed_bytes}
