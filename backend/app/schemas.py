from pydantic import BaseModel
from typing import Optional


class TempUploadResponse(BaseModel):
    ok: bool
    temp_upload_id: Optional[str] = None
    expression_filename: Optional[str] = None
    pseudotime_filename: Optional[str] = None
    gene_count: Optional[int] = None
    cell_count: Optional[int] = None
    has_pseudotime: Optional[bool] = None
    errors: list[str] = []


class CreateProjectResponse(BaseModel):
    ok: bool
    project_id: Optional[str] = None
    job_id: Optional[str] = None
    errors: list[str] = []