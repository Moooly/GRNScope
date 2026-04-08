from typing import Optional

from pydantic import BaseModel


class TempUploadResponse(BaseModel):
    ok: bool
    temp_upload_id: Optional[str] = None
    expression_filename: Optional[str] = None
    pseudotime_filename: Optional[str] = None
    gene_count: Optional[int] = None
    cell_count: Optional[int] = None
    has_pseudotime: Optional[bool] = None
    errors: list[str] = []


class CreateProjectFromTempRequest(BaseModel):
    temp_upload_id: str
    project_name: str
    project_description: Optional[str] = None
    selected_algorithms: list[str]
    top_variable_genes: int
    include_all_tfs: bool
    normalize_enabled: bool
    log_transform_enabled: bool
    ensemble_enabled: bool = False


class CreateProjectFromTempResponse(BaseModel):
    ok: bool
    project_id: Optional[str] = None
    job_id: Optional[str] = None
    errors: list[str] = []


class CreateProjectResponse(BaseModel):
    ok: bool
    project_id: Optional[str] = None
    job_id: Optional[str] = None
    errors: list[str] = []