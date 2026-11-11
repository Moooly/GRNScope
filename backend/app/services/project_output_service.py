"""Inventory of completed, downloadable perturbation files (no model loading)."""

from pathlib import Path
from urllib.parse import quote
import json

from .demo_perturbation_service import load_examples
from .demo_service import get_demo_project_root
from .perturbation_service import DOWNLOAD_FILENAMES
from .run_manifest_service import _project_file


def perturbation_download_inventory(project_dir: Path, *, demo: bool = False) -> list[dict]:
    if demo:
        package = load_examples()
        project_dir = get_demo_project_root()
        runs = package.get("runs", [])
    else:
        runs = []
        for status_path in sorted((project_dir / "perturbations" / "runs").glob("*/status.json")):
            safe_path = _project_file(project_dir, status_path)
            if safe_path is None:
                continue
            try:
                runs.append(json.loads(safe_path.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                continue
    files = []
    for run in runs:
        if not isinstance(run, dict):
            continue
        run_id = str(run.get("run_id", ""))
        if run.get("status") != "Completed" or not run_id or Path(run_id).name != run_id or run_id in {".", ".."}:
            continue
        for filename in sorted(DOWNLOAD_FILENAMES):
            if demo and f"runs/{run_id}/{filename}" not in package.get("files", {}):
                continue
            path = _project_file(project_dir, project_dir / "perturbations" / "runs" / run_id / filename)
            if path is None:
                continue
            files.append({
                "id": f"perturbation/{run_id}/{filename}",
                "label": f"{run.get('gene', 'Simulation')} ({run.get('perturbation_value', 0)}) · {filename.removesuffix('.csv').replace('_', ' ')} · {run_id}",
                "path": f"analysis_outputs/perturbations/{run_id}/{filename}",
                "url": f"perturbations/{quote(run_id, safe='')}/downloads/{filename}",
                "size_bytes": path.stat().st_size,
            })
    return files
