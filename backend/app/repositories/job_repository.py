from __future__ import annotations

import json
from pathlib import Path


def read_jobs_manifest(project_dir: Path) -> list[dict]:
    jobs_path = project_dir / "jobs.json"
    if not jobs_path.exists():
        return []
    return json.loads(jobs_path.read_text(encoding="utf-8"))


def write_jobs_manifest(project_dir: Path, jobs_manifest: list[dict]) -> None:
    jobs_path = project_dir / "jobs.json"
    jobs_path.write_text(json.dumps(jobs_manifest, indent=2), encoding="utf-8")