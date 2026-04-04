from pydantic import BaseModel
from typing import List, Optional


class DatasetSummary(BaseModel):
    gene_count: int
    cell_count: int
    has_pseudotime: bool
    expression_filename: str
    pseudotime_filename: Optional[str] = None


class UploadSuccessResponse(BaseModel):
    ok: bool
    project_id: str
    project_name: str
    description: Optional[str] = None
    dataset: DatasetSummary


class UploadErrorResponse(BaseModel):
    ok: bool
    errors: List[str]