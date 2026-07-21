from __future__ import annotations

import json
from pathlib import Path

from ..atomic_io import atomic_write_json
from ..config import PROJECTS_ROOT


def read_project_manifest(project_dir: Path) -> dict:
    project_path = project_dir / "project.json"
    if not project_path.exists():
        raise FileNotFoundError("Project manifest not found.")
    return json.loads(project_path.read_text(encoding="utf-8"))


def write_project_manifest(project_dir: Path, project_manifest: dict) -> None:
    atomic_write_json(project_dir / "project.json", project_manifest)


def list_project_directories() -> list[Path]:
    if not PROJECTS_ROOT.exists():
        return []
    return [path for path in PROJECTS_ROOT.iterdir() if path.is_dir()]
