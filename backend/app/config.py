from __future__ import annotations

import os
import threading
from pathlib import Path

JOB_FILE_LOCK = threading.Lock()

APP_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = APP_ROOT.parent
PROJECTS_ROOT = PROJECT_ROOT / "projects"
TEMP_UPLOAD_ROOT = APP_ROOT / "temp_uploads"

BEELINE_ROOT_CANDIDATES = [
    Path(os.environ.get("BEELINE_ROOT", "")).expanduser() if os.environ.get("BEELINE_ROOT") else None,
    Path("/Users/molyloo/Documents/TRU/Beeline"),
    PROJECT_ROOT.parent / "Beeline",
    PROJECT_ROOT.parent / "beeline",
    Path.home() / "Beeline",
    Path.home() / "beeline",
]

ALGORITHM_IMAGE_MAP = {
    "GENIE3": "grnbeeline/arboreto:base",
    "GRISLI": "grnbeeline/grisli:base",
    "GRNBOOST2": "grnbeeline/arboreto:base",
    "GRNVBEM": "grnbeeline/grnvbem:base",
    "JUMP3": "jump3:base",
    "LEAP": "grnbeeline/leap:base",
    "PEARSON": "local",
    "PIDC": "grnbeeline/pidc:base",
    "PPCOR": "grnbeeline/ppcor:base",
    "SCODE": "grnbeeline/scode:base",
    "SCRIBE": "grnbeeline/scribe:base",
    "SCSGL": "scsgl:base",
    "SINCERITIES": "grnbeeline/sincerities:base",
    "SINGE": "grnbeeline/singe:0.4.1",
}

ALGORITHM_DEFAULT_PARAMS = {
    "PPCOR": {
        "pVal": [0.05],
    },
}