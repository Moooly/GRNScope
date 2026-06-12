from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response

from ..schemas import ContactSupportRequest, ContactSupportResponse
from ..services.email_service import (
    normalize_notification_email,
    send_contact_email,
)
from .client_identity import get_or_create_client_id

router = APIRouter()


@router.post("/api/contact", response_model=ContactSupportResponse)
async def create_contact_request(
    payload: ContactSupportRequest,
    request: Request,
    response: Response,
):
    client_id = get_or_create_client_id(request, response)
    question = payload.question.strip()

    if not question:
        raise HTTPException(status_code=400, detail="Please describe the question.")
    if len(question) > 4000:
        raise HTTPException(
            status_code=400,
            detail="Please keep the question under 4000 characters.",
        )

    raw_reply_to_email = (payload.reply_to_email or "").strip()
    reply_to_email = normalize_notification_email(raw_reply_to_email)
    if raw_reply_to_email and not reply_to_email:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")

    try:
        send_contact_email(
            question=question,
            reply_to_email=reply_to_email,
            page_url=(payload.page_url or "").strip() or None,
            project_id=(payload.project_id or "").strip() or None,
            algorithm_id=(payload.algorithm_id or "").strip() or None,
            client_id=client_id,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="GRNScope could not send the message. Please try again later.",
        ) from exc

    return ContactSupportResponse(ok=True, errors=[])
