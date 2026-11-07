from typing import Optional

from pydantic import BaseModel


class CreateProjectResponse(BaseModel):
    ok: bool
    project_id: Optional[str] = None
    job_id: Optional[str] = None
    errors: list[str] = []


class UpdateProjectNameRequest(BaseModel):
    project_name: str


class UpdateConfidenceRecoveryRankRequest(BaseModel):
    recovery_top_fraction: float


class ContactSupportRequest(BaseModel):
    question: str
    reply_to_email: Optional[str] = None
    page_url: Optional[str] = None
    project_id: Optional[str] = None
    algorithm_id: Optional[str] = None


class ContactSupportResponse(BaseModel):
    ok: bool
    errors: list[str] = []
