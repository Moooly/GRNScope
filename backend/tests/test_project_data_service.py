import asyncio
import hashlib
import json
from pathlib import Path
from unittest.mock import patch
import zipfile

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from app.api import downloads
from app.services.project_data_service import (
    ProjectDataNotReady,
    load_project_data,
    project_data_inventory,
    write_project_data_zip,
)


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "project-1"
    root.mkdir()
    expression = root / "upload.h5ad"
    expression.write_bytes(b"original-h5ad")
    prepared = root / "preprocessed" / "ExpressionData.csv"
    prepared.parent.mkdir()
    prepared.write_text("gene,c1\nA,2\n")
    audits = prepared.parent / "gene_selection_audits"
    audits.mkdir()
    (audits / "detection.json").write_text(
        json.dumps({"retained_gene_names": ["A"], "removed_gene_names": ["B"]})
    )
    (prepared.parent / "rankedEdges.csv").write_text("MUST NOT EXPORT")
    (prepared.parent / "stderr.log").write_text("MUST NOT EXPORT")
    (root / "results").mkdir()
    (root / "results" / "result.json").write_text("MUST NOT EXPORT")
    data = {
        "project_id": "project-1",
        "project_name": "My project",
        "owner_id": "owner-test",
        "notification_email": "private@example.com",
        "expression_source_path": str(expression),
        "expression_path": str(prepared),
        "preprocessed_expression_path": str(prepared),
        "preprocessing_status": "completed",
        "preprocessing": {
            "matrix_state": "raw",
            "dataset_species": "human",
            "enabled_stages": ["detection"],
        },
        "selected_algorithms": ["PEARSON"],
        "preprocessing_result": {
            "gene_count": 1,
            "transformation": {"operations": ["log1p"]},
        },
    }
    (root / "project.json").write_text(json.dumps(data))
    (root / "metadata.json").write_text(
        json.dumps(
            {"expression_filename": "my-upload.h5ad", "gene_count": 2, "cell_count": 1}
        )
    )
    (root / "jobs.json").write_text(
        json.dumps([{"resolved_algorithm_parameters": {"PEARSON": {"foo": 5}}}])
    )
    return root


def contents(project, tmp_path, **selection):
    target = tmp_path / "data.zip"
    write_project_data_zip(load_project_data(project), target, **selection)
    with zipfile.ZipFile(target) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def test_package_contains_only_inputs_and_configuration_with_exact_checksums(
    project, tmp_path
):
    files = contents(project, tmp_path, original=True, prepared=True, manifest=True)
    assert len(files) == 5
    manifest_name = next(
        name for name in files if name.endswith("project_manifest.json")
    )
    manifest = json.loads(files[manifest_name])
    assert manifest["dataset"]["genes_before_preparation"] == 2
    assert manifest["dataset"]["genes_after_preparation"] == 1
    assert manifest["algorithms"][0]["parameters"] == {"foo": 5}
    assert not any(
        "rankedEdges" in name or "stderr" in name or "results/" in name
        for name in files
    )
    assert b"private@example.com" not in files[manifest_name]
    assert str(project).encode() not in files[manifest_name]
    for entry in manifest["files"]:
        data = files["My project_data/" + entry["path"]]
        assert hashlib.sha256(data).hexdigest() == entry["sha256"]
        assert len(data) == entry["size_bytes"]
    original_name = next(name for name in files if name.endswith("my-upload.h5ad"))
    assert files[original_name] == b"original-h5ad"


@pytest.mark.parametrize(
    "selection",
    [
        {"original": True, "prepared": False, "manifest": False},
        {"original": False, "prepared": True, "manifest": False},
        {"original": False, "prepared": False, "manifest": True},
    ],
)
def test_selections(project, tmp_path, selection):
    files = contents(project, tmp_path, **selection)
    assert (
        any(name.endswith("project_manifest.json") for name in files)
        == selection["manifest"]
    )
    assert any("/original_inputs/" in name for name in files) == selection["original"]
    assert any("/prepared_inputs/" in name for name in files) == selection["prepared"]


def test_original_used_directly_is_not_duplicated_and_prepared_only_still_works(
    project, tmp_path
):
    path = project / "project.json"
    data = json.loads(path.read_text())
    data["expression_source_path"] = data["expression_path"]
    path.write_text(json.dumps(data))
    files = contents(project, tmp_path, original=True, prepared=True, manifest=True)
    manifest = json.loads(
        next(
            value
            for name, value in files.items()
            if name.endswith("project_manifest.json")
        )
    )
    expression_files = [
        item for item in manifest["files"] if item["role"] == "expression"
    ]
    assert len(expression_files) == 1
    assert manifest["dataset"]["prepared_expression"] == expression_files[0]["path"]
    files = contents(project, tmp_path, original=False, prepared=True, manifest=True)
    assert any("prepared_inputs/expression/" in name for name in files)
    assert not any("original_inputs/" in name for name in files)


def test_running_preparation_is_unavailable_and_rejected(project, tmp_path):
    path = project / "project.json"
    data = json.loads(path.read_text())
    data["preprocessing_status"] = "running"
    path.write_text(json.dumps(data))
    inventory = project_data_inventory(load_project_data(project))
    assert inventory["groups"]["prepared"] == {
        "status": "preparing",
        "file_count": 0,
        "size_bytes": 0,
        "available": False,
    }
    with pytest.raises(ProjectDataNotReady):
        contents(project, tmp_path, original=True, prepared=True, manifest=True)
    files = contents(project, tmp_path, original=True, prepared=False, manifest=True)
    assert not any("prepared_inputs/" in name for name in files)


def test_external_symlink_is_not_exported(project, tmp_path):
    (project / "preprocessed" / "gene_selection_audits" / "private.json").symlink_to(
        tmp_path / "private.json"
    )
    (tmp_path / "private.json").write_text('{"secret":true}')
    files = contents(project, tmp_path, original=True, prepared=True, manifest=True)
    assert not any("private.json" in name for name in files)


def test_empty_selection_rejected(project, tmp_path):
    with pytest.raises(ValueError, match="Select at least"):
        contents(project, tmp_path, original=False, prepared=False, manifest=False)


def test_both_routes_require_ownership(project):
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [(b"x-grnscope-client-id", b"someone-else")],
        }
    )
    with patch.object(downloads, "PROJECTS_ROOT", project.parent):
        for handler in (
            downloads.get_project_data_inventory,
            downloads.download_project_data,
        ):
            with pytest.raises(HTTPException) as error:
                asyncio.run(handler("project-1", request, Response()))
            assert error.value.status_code == 404
