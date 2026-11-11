import asyncio
import json
from unittest.mock import patch

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from app.api import downloads
from app.services.project_output_service import perturbation_download_inventory


def save_run(project, run_id, status="Completed"):
    run = project / "perturbations" / "runs" / run_id
    run.mkdir(parents=True)
    (run / "status.json").write_text(json.dumps({"run_id": run_id, "status": status, "gene": "SOX9"}))
    (run / "affected_genes.csv").write_text("gene,change\nSOX9,-1\n")
    return run


def test_inventory_includes_every_completed_run_without_model_loading(tmp_path):
    for index in range(23):
        save_run(tmp_path, f"run-{index}")
    save_run(tmp_path, "running", "Running")
    files = perturbation_download_inventory(tmp_path)
    assert len(files) == 23
    assert len({item["path"] for item in files}) == 23
    assert all(item["size_bytes"] > 0 for item in files)
    assert not any("running" in item["id"] for item in files)
    assert all(item["url"].startswith("perturbations/") for item in files)


def test_inventory_ignores_malformed_runs_and_external_symlinks(tmp_path):
    project = tmp_path / "project"
    run = save_run(project, "safe")
    outside = tmp_path / "private.csv"
    outside.write_text("secret")
    (run / "cell_shifts.csv").symlink_to(outside)
    (run / "internal.log").write_text("secret")
    bad = save_run(project, "bad")
    (bad / "status.json").write_text("broken")
    traversal = save_run(project, "traversal")
    (traversal / "status.json").write_text(json.dumps({"run_id": "../safe", "status": "Completed"}))
    files = perturbation_download_inventory(project)
    assert [item["id"] for item in files] == ["perturbation/safe/affected_genes.csv"]
    assert str(project) not in json.dumps(files)


def test_output_inventory_route_requires_project_ownership(tmp_path):
    project = tmp_path / "project-1"
    project.mkdir()
    (project / "project.json").write_text(json.dumps({"owner_id": "the-owner"}))
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": [(b"x-grnscope-client-id", b"someone-else")]})
    with patch.object(downloads, "PROJECTS_ROOT", tmp_path):
        with pytest.raises(HTTPException) as error:
            asyncio.run(downloads.get_project_output_files("project-1", request, Response()))
        assert error.value.status_code == 404
