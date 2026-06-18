from __future__ import annotations

from contextlib import contextmanager
import fcntl
import json
from pathlib import Path


@contextmanager
def jobs_manifest_lock(project_dir: Path):
    project_dir.mkdir(parents=True, exist_ok=True)
    lock_path = project_dir / ".jobs.json.lock"
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def read_jobs_manifest(project_dir: Path) -> list[dict]:
    jobs_path = project_dir / "jobs.json"
    if not jobs_path.exists():
        return []
    return json.loads(jobs_path.read_text(encoding="utf-8"))


def write_jobs_manifest(project_dir: Path, jobs_manifest: list[dict]) -> None:
    jobs_path = project_dir / "jobs.json"
    jobs_path.write_text(json.dumps(jobs_manifest, indent=2), encoding="utf-8")
