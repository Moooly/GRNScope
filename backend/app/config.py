from __future__ import annotations

import os
import threading
from pathlib import Path

JOB_FILE_LOCK = threading.Lock()

APP_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = APP_ROOT.parent
PROJECTS_ROOT = PROJECT_ROOT / "projects"
TEMP_UPLOAD_ROOT = APP_ROOT / "temp_uploads"
DEMO_PROJECT_ROOT = PROJECT_ROOT / "data" / "demo_project"
DEMO_PROJECT_MANIFEST = DEMO_PROJECT_ROOT / "manifest.json"
DEMO_PROJECT_INPUTS_ROOT = DEMO_PROJECT_ROOT / "inputs"
DEMO_PROJECT_RESULTS_ROOT = DEMO_PROJECT_ROOT / "results"

BEELINE_ROOT_CANDIDATES = [
    Path(os.environ.get("BEELINE_ROOT", "")).expanduser() if os.environ.get("BEELINE_ROOT") else None,
    Path("/Users/molyloo/Documents/TRU/Beeline"),
    PROJECT_ROOT.parent / "Beeline",
    PROJECT_ROOT.parent / "beeline",
    Path.home() / "Beeline",
    Path.home() / "beeline",
]