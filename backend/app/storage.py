from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
TEMP_UPLOAD_DIR = BASE_DIR / "temp_uploads"
TEMP_UPLOAD_ROOT = TEMP_UPLOAD_DIR
PROJECTS_DIR = BASE_DIR / "projects"

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


def temp_metadata_path(temp_upload_id: str) -> Path:
    return TEMP_UPLOAD_DIR / f"{temp_upload_id}__metadata.json"


def save_upload_file(upload_file, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as output:
        shutil.copyfileobj(upload_file.file, output)


def save_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def move_temp_upload_to_project(temp_upload_id: str, project_id: str) -> dict[str, Any]:
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

    shutil.move(str(temp_metadata_path(temp_upload_id)), str(project_dir / "upload_metadata.json"))
    return result


def cleanup_temp_upload(temp_upload_id: str) -> None:
    meta_path = temp_metadata_path(temp_upload_id)
    if not meta_path.exists():
        return

    metadata = load_json(meta_path)

    for key in ("expression_path", "pseudotime_path"):
        file_path = metadata.get(key)
        if file_path:
            p = Path(file_path)
            if p.exists():
                p.unlink()

    if meta_path.exists():
        meta_path.unlink()