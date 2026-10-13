# API contract inventory

The backend exposes **44 HTTP operations on 42 paths**. Three algorithm handlers are mounted at both `/algorithms` and `/api/algorithms`, leaving **41 distinct handlers**. This inventory was generated from the running FastAPI OpenAPI document on 2026-10-13.

## Stage 2 contract boundary

Core read responses for the algorithm catalog, project list/detail/metadata, jobs, and results now have Pydantic response schemas in `app/api_contracts.py`. The models preserve additional manifest fields from saved jobs and omit absent optional fields, so existing JSON keys remain stable. The frontend shares matching catalog/job/task wire types in `app/_lib/apiContracts.ts`. Demo response fixtures and schema checks live in `tests/test_api_contracts.py`.

The result body, pseudotime state, and some metadata extensions remain dynamic because their payloads vary by algorithm or run. Mutation, perturbation, upload, visualization, and download contracts are inventoried here for later focused stages.

## Route inventory

| Method | Path | Operation | 2xx response contract |
| --- | --- | --- | --- |
| GET | `/algorithms` | List Algorithms | 200 AlgorithmResponse |
| GET | `/algorithms/recommended` | List Recommended Algorithms | 200 AlgorithmResponse |
| GET | `/algorithms/{algorithm_id}` | Read Algorithm | 200 AlgorithmResponse |
| GET | `/api/algorithms` | List Algorithms | 200 AlgorithmResponse |
| GET | `/api/algorithms/recommended` | List Recommended Algorithms | 200 AlgorithmResponse |
| GET | `/api/algorithms/{algorithm_id}` | Read Algorithm | 200 AlgorithmResponse |
| POST | `/api/contact` | Create Contact Request | 200 ContactSupportResponse |
| GET | `/api/projects/{project_id}/download/expression` | Download Expression File | 200 file/stream (undocumented) |
| GET | `/api/projects/{project_id}/download/run-manifest/{algorithm_id}` | Download Run Manifest | 200 file/stream (undocumented) |
| GET | `/api/projects/{project_id}/download/run-manifests` | Download All Run Manifests | 200 file/stream (undocumented) |
| GET | `/api/projects/{project_id}/download/pseudotime` | Download Pseudotime File | 200 file/stream (undocumented) |
| GET | `/api/projects/{project_id}/download/result/{algorithm_id}` | Download Algorithm Result File | 200 file/stream (undocumented) |
| GET | `/api/projects/{project_id}/download/metadata` | Download Analysis Metadata File | 200 file/stream (undocumented) |
| GET | `/api/projects/{project_id}/jobs` | Get Project Jobs | 200 ProjectJobsResponse |
| POST | `/api/projects/{project_id}/jobs/{job_id}/tasks/{algorithm_id}/stop` | Stop Project Algorithm | 200 dynamic JSON (undocumented) |
| POST | `/api/projects/{project_id}/jobs/{job_id}/tasks/{algorithm_id}/rerun` | Rerun Project Algorithm | 200 dynamic JSON (undocumented) |
| GET | `/api/projects/{project_id}/perturbations` | Get Project Perturbations | 200 dynamic JSON (undocumented) |
| POST | `/api/projects/{project_id}/perturbations` | Start Project Perturbation | 202 dynamic JSON (undocumented) |
| GET | `/api/projects/{project_id}/perturbations/expression-profile/{gene}` | Get Project Perturbation Expression Profile | 200 dynamic JSON (undocumented) |
| GET | `/api/projects/{project_id}/perturbations/{run_id}` | Get Project Perturbation Result | 200 dynamic JSON (undocumented) |
| GET | `/api/projects/{project_id}/perturbations/{run_id}/downloads/{filename}` | Download Perturbation Result | 200 file/stream (undocumented) |
| POST | `/api/projects/create-pending` | Create Pending Project | 200 CreateProjectResponse |
| POST | `/api/projects/{project_id}/upload-and-start` | Upload Project Dataset And Start | 200 dynamic JSON (undocumented) |
| POST | `/api/projects/{project_id}/upload-failed` | Mark Project Upload Failed | 200 dynamic JSON (undocumented) |
| PATCH | `/api/projects/{project_id}/notification-email` | Update Project Notification Email | 200 dynamic JSON (undocumented) |
| PATCH | `/api/projects/{project_id}/name` | Update Project Name | 200 dynamic JSON (undocumented) |
| PATCH | `/api/projects/{project_id}/confidence-recovery-rank` | Update Confidence Recovery Rank | 200 dynamic JSON (undocumented) |
| GET | `/api/projects` | List Projects | 200 ProjectListResponse |
| GET | `/api/projects/{project_id}` | Get Project | 200 ProjectDetailResponse |
| DELETE | `/api/projects/{project_id}` | Delete Project | 200 dynamic JSON (undocumented) |
| GET | `/api/projects/{project_id}/validation-report` | Download Project Validation Report | 200 file/stream (undocumented) |
| GET | `/api/projects/{project_id}/metadata` | Get Project Metadata | 200 ProjectMetadataResponse |
| POST | `/api/projects/{project_id}/stop` | Stop Project | 200 dynamic JSON (undocumented) |
| GET | `/api/projects/{project_id}/pseudotime/status` | Pseudotime Status | 200 dynamic JSON (undocumented) |
| POST | `/api/projects/{project_id}/pseudotime/estimate` | Estimate Pseudotime | 200 dynamic JSON (undocumented) |
| POST | `/api/projects/{project_id}/pseudotime/stop` | Stop Pseudotime | 200 dynamic JSON (undocumented) |
| GET | `/api/projects/{project_id}/visualization-context` | Get Visualization Context | 200 dynamic JSON (undocumented) |
| GET | `/api/projects/{project_id}/results` | Get Project Results | 200 ProjectResultsResponse |
| GET | `/api/projects/{project_id}/gene-selection-audit` | Get Gene Selection Audit | 200 dynamic JSON (undocumented) |
| GET | `/api/projects/{project_id}/results/{algorithm_id}` | Get Algorithm Result | 200 AlgorithmResultResponse |
| POST | `/api/uploads/infer-species` | Infer Uploaded Species | 200 dynamic JSON (undocumented) |
| POST | `/api/uploads/inspect-expression` | Inspect Expression Upload | 200 dynamic JSON (undocumented) |
| POST | `/api/uploads/temp-dataset` | Temp Dataset Upload | 200 TempUploadResponse |
| DELETE | `/api/uploads/temp-dataset/{temp_upload_id}` | Delete Temp Dataset Upload | 200 dynamic JSON (undocumented) |

## Next contract work

1. Define response shapes for mutations and uploads, including their error envelopes.
2. Split algorithm-specific result bodies into named variants once their persisted formats are mapped.
3. Add frontend boundary parsing for fields that come from historical manifests or user uploads.
