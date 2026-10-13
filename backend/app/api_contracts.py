"""Wire response schemas for the project's core read APIs.

Stored manifests can contain fields from older and newer runs. Keep those
fields in responses while validating the stable fields consumed by the UI.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class WireModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class AlgorithmParameterResponse(WireModel):
    name: str
    label: str | None = None
    description: str | None = None
    default: Any = None
    required: bool | None = None
    value_type: str | None = None
    options: list[Any] | None = None
    minimum: int | float | None = None
    maximum: int | float | None = None
    exclusive_minimum: int | float | None = None
    exclusive_maximum: int | float | None = None
    step: int | float | None = None
    advanced: bool | None = None


class AlgorithmResponse(WireModel):
    id: str
    name: str
    description: str
    long_description: str
    category: str
    year: str
    journal: str
    publication_title: str
    publication_url: str
    source_url: str | None
    docker_image: str
    runner: str
    directed: bool
    signed: bool
    requires_pseudotime: bool
    supports_expression_matrix: bool
    active: bool
    recommended: bool
    estimated_runtime: str
    strengths: list[str]
    limitations: list[str]
    recommended_use_cases: list[str]
    parameters: list[AlgorithmParameterResponse]


class ProjectTaskResponse(WireModel):
    algorithm_id: str
    status: str
    elapsed_seconds: int | float | None = None
    error_message: str | None = None
    progress_percent: int | float | None = None
    progress_label: str | None = None


class ProjectJobResponse(WireModel):
    job_id: str
    overall_status: str
    tasks: list[ProjectTaskResponse]
    ensemble_enabled: bool | str | None = None


class ProjectSummaryResponse(WireModel):
    id: str
    name: str
    description: str
    createdAt: str
    datasetCount: int
    jobCount: int
    latestJob: ProjectJobResponse | None = None
    createdAtTimestamp: int | float | str | None = None
    geneCount: int | None = None
    cellCount: int | None = None
    isDemo: bool | None = None
    readOnly: bool | None = None


class ProjectListResponse(WireModel):
    ok: Literal[True]
    projects: list[ProjectSummaryResponse]


class ProjectManifestResponse(WireModel):
    project_id: str
    project_name: str
    project_description: str
    selected_algorithms: list[str] | None = None
    latest_job_id: str | None = None
    is_demo: bool | None = None
    read_only: bool | None = None


class ProjectDetailResponse(WireModel):
    ok: Literal[True]
    project: ProjectManifestResponse
    latest_job: ProjectJobResponse | None
    pseudotime_estimation: dict[str, Any] | None = None


class MetadataManifestResponse(WireModel):
    project_id: str | None = None
    project_name: str | None = None
    project_description: str | None = None
    gene_count: int | None = None
    cell_count: int | None = None
    selected_algorithms: list[str] | None = None


class ProjectMetadataResponse(WireModel):
    ok: Literal[True]
    project_id: str
    metadata: MetadataManifestResponse


class ProjectJobsResponse(WireModel):
    ok: Literal[True]
    project_id: str
    jobs: list[ProjectJobResponse]


class ResultSummaryResponse(WireModel):
    algorithm_id: str
    status: str
    result_path: str | None = None
    progress_percent: int | float | None = None
    progress_label: str | None = None


class ProjectResultsResponse(WireModel):
    ok: Literal[True]
    project_id: str
    results: list[ResultSummaryResponse]
    job_id: str | None = None
    is_demo: bool | None = None
    read_only: bool | None = None


class AlgorithmResultResponse(WireModel):
    ok: Literal[True]
    project_id: str
    algorithm_id: str
    result: dict[str, Any]
    is_demo: bool | None = None
    read_only: bool | None = None
