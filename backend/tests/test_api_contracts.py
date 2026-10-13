"""Protect the wire shape used by the project and algorithm pages."""

import asyncio
import json
from pathlib import Path
from unittest.mock import patch

from fastapi import Response
from starlette.requests import Request

from app.api import algorithm, project_reads, results
from app.algorithm_registry import get_algorithms
from app.api_contracts import (
    AlgorithmResponse,
    AlgorithmResultResponse,
    ProjectDetailResponse,
    ProjectJobsResponse,
    ProjectListResponse,
    ProjectMetadataResponse,
    ProjectResultsResponse,
)
from app.main import app


FIXTURE_PATH = Path(__file__).parent / "fixtures/api_contracts/demo_read_responses.json"


def request() -> Request:
    return Request({"type": "http", "method": "GET", "path": "/", "headers": []})


async def capture_demo_responses() -> dict:
    with patch("app.api.project_reads.list_project_directories", return_value=[]):
        project_list = await project_reads.list_projects(request(), Response())
    project_detail = await project_reads.get_project("demo", request(), Response())
    project_metadata = await project_reads.get_project_metadata("demo", request(), Response())
    result_list = await results.get_project_results("demo", request(), Response())

    responses = {
        "algorithm": algorithm.read_algorithm("PIDC"),
        "project_list": project_list,
        "project_detail": project_detail,
        "project_metadata": project_metadata,
        "result_list": result_list,
    }
    models = {
        "algorithm": AlgorithmResponse,
        "project_list": ProjectListResponse,
        "project_detail": ProjectDetailResponse,
        "project_metadata": ProjectMetadataResponse,
        "result_list": ProjectResultsResponse,
    }
    for name, raw in responses.items():
        encoded = models[name].model_validate(raw).model_dump(exclude_unset=True, mode="json")
        assert json.dumps(encoded, sort_keys=True) == json.dumps(raw, sort_keys=True)

    # Remove machine-specific paths and the large TF reference list from the
    # committed fixture. Their surrounding fields remain under schema checks.
    metadata = project_metadata["metadata"]
    metadata["known_tf_gene_count"] = len(metadata.pop("known_tf_gene_names"))
    for row in result_list["results"]:
        if row["result_path"]:
            row["result_path"] = Path(row["result_path"]).name
    return responses


def test_demo_read_response_contracts() -> None:
    expected = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    assert asyncio.run(capture_demo_responses()) == expected


def test_read_routes_expose_response_schemas() -> None:
    paths = app.openapi()["paths"]
    assert len(paths) == 42
    assert sum(len(methods) for methods in paths.values()) == 44
    expected = [
        "/api/algorithms",
        "/api/algorithms/recommended",
        "/api/algorithms/{algorithm_id}",
        "/api/projects",
        "/api/projects/{project_id}",
        "/api/projects/{project_id}/metadata",
        "/api/projects/{project_id}/validation-report",
        "/api/projects/{project_id}/jobs",
        "/api/projects/{project_id}/results",
        "/api/projects/{project_id}/results/{algorithm_id}",
    ]
    for path in expected:
        if path.endswith("/validation-report"):
            assert "get" in paths[path]
            continue
        schema = paths[path]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
        assert schema
        assert "$ref" in schema or "items" in schema


def test_every_registered_algorithm_matches_catalog_contract() -> None:
    for entry in get_algorithms(include_inactive=True):
        encoded = AlgorithmResponse.model_validate(entry).model_dump(
            exclude_unset=True, mode="json"
        )
        assert json.dumps(encoded, sort_keys=True) == json.dumps(entry, sort_keys=True)


def test_job_and_result_envelopes_keep_manifest_fields() -> None:
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    payload = {
        "ok": True,
        "project_id": "demo",
        "jobs": [fixture["project_detail"]["latest_job"]],
    }
    encoded = ProjectJobsResponse.model_validate(payload).model_dump(
        exclude_unset=True, mode="json"
    )
    assert json.dumps(encoded, sort_keys=True) == json.dumps(payload, sort_keys=True)

    result = asyncio.run(
        results.get_algorithm_result("demo", "PIDC", request(), Response(), limit=2)
    )
    encoded_result = AlgorithmResultResponse.model_validate(result).model_dump(
        exclude_unset=True, mode="json"
    )
    assert json.dumps(encoded_result, sort_keys=True) == json.dumps(result, sort_keys=True)


async def get_json(path: str) -> dict:
    messages = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [],
        "client": ("test", 0),
        "server": ("test", 80),
    }
    await app(scope, receive, send)
    assert messages[0]["status"] == 200
    return json.loads(b"".join(message.get("body", b"") for message in messages[1:]))


def test_http_responses_keep_demo_project_and_catalog_shape() -> None:
    expected = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    assert asyncio.run(get_json("/api/projects/demo")) == expected["project_detail"]
    assert asyncio.run(get_json("/api/algorithms/PIDC")) == expected["algorithm"]
