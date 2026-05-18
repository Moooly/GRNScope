from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

from fastapi import HTTPException, Request, Response

CLIENT_COOKIE_NAME = "grnscope_client_id"
CLIENT_HEADER_NAME = "x-grnscope-client-id"
CLIENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
CLIENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365


def normalize_client_id(value: str | None) -> str | None:
    if not value:
        return None

    candidate = value.strip()
    if CLIENT_ID_PATTERN.fullmatch(candidate):
        return candidate

    return None


def get_or_create_client_id(request: Request, response: Response) -> str:
    client_id = normalize_client_id(request.headers.get(CLIENT_HEADER_NAME))
    if client_id is None:
        client_id = normalize_client_id(request.cookies.get(CLIENT_COOKIE_NAME))
    if client_id is None:
        client_id = uuid.uuid4().hex

    response.set_cookie(
        key=CLIENT_COOKIE_NAME,
        value=client_id,
        max_age=CLIENT_COOKIE_MAX_AGE,
        path="/",
        httponly=False,
        samesite="lax",
        secure=False,
    )

    return client_id


def read_project_owner_id(project_dir: Path) -> str | None:
    project_path = project_dir / "project.json"
    if not project_path.exists():
        return None

    try:
        manifest = json.loads(project_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    return normalize_client_id(
        manifest.get("owner_id") or manifest.get("client_id")
    )


def project_belongs_to_client(project_dir: Path, client_id: str) -> bool:
    return read_project_owner_id(project_dir) == client_id


def require_project_owner(project_dir: Path, client_id: str) -> None:
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail="Project not found.")

    if not project_belongs_to_client(project_dir, client_id):
        raise HTTPException(status_code=404, detail="Project not found.")
