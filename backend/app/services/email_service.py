from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import parseaddr


def normalize_email(value: str | None) -> str | None:
    if not value:
        return None

    email = parseaddr(value.strip())[1].strip()
    if not email or "@" not in email:
        return None

    local_part, _, domain = email.partition("@")
    if not local_part or "." not in domain:
        return None

    return email


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _smtp_port() -> int:
    try:
        return int(os.environ.get("GRNSCOPE_SMTP_PORT", "587"))
    except ValueError:
        return 587


def resolve_contact_email() -> str | None:
    return normalize_email(
        os.environ.get("GRNSCOPE_CONTACT_EMAIL")
        or os.environ.get("GRNSCOPE_SUPPORT_EMAIL")
        or os.environ.get("GRNSCOPE_SMTP_FROM")
        or os.environ.get("GRNSCOPE_SMTP_USERNAME")
    )


def _send_smtp_message(message: EmailMessage) -> None:
    smtp_host = os.environ.get("GRNSCOPE_SMTP_HOST", "").strip()
    smtp_port = _smtp_port()
    smtp_username = os.environ.get("GRNSCOPE_SMTP_USERNAME", "").strip()
    smtp_password = os.environ.get("GRNSCOPE_SMTP_PASSWORD", "")
    from_email = os.environ.get("GRNSCOPE_SMTP_FROM", smtp_username).strip()
    use_ssl = _env_bool("GRNSCOPE_SMTP_USE_SSL", False)
    use_tls = _env_bool("GRNSCOPE_SMTP_USE_TLS", not use_ssl)
    timeout_seconds = float(os.environ.get("GRNSCOPE_SMTP_TIMEOUT", "20"))

    if not smtp_host or not from_email:
        raise RuntimeError("Email is not configured on the server.")

    if "From" not in message:
        message["From"] = from_email

    if use_ssl:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(
            smtp_host,
            smtp_port,
            timeout=timeout_seconds,
            context=context,
        ) as smtp:
            if smtp_username:
                smtp.login(smtp_username, smtp_password)
            smtp.send_message(message)
        return

    with smtplib.SMTP(smtp_host, smtp_port, timeout=timeout_seconds) as smtp:
        if use_tls:
            smtp.starttls(context=ssl.create_default_context())
        if smtp_username:
            smtp.login(smtp_username, smtp_password)
        smtp.send_message(message)


def send_contact_email(
    *,
    question: str,
    reply_to_email: str | None = None,
    page_url: str | None = None,
    project_id: str | None = None,
    algorithm_id: str | None = None,
    client_id: str | None = None,
) -> None:
    recipient = resolve_contact_email()
    if not recipient:
        raise RuntimeError("Contact email recipient is not configured on the server.")

    smtp_username = os.environ.get("GRNSCOPE_SMTP_USERNAME", "").strip()
    from_email = os.environ.get("GRNSCOPE_SMTP_FROM", smtp_username).strip()
    if not from_email:
        raise RuntimeError("Email is not configured on the server.")

    subject_context = f" about {algorithm_id}" if algorithm_id else ""
    message = EmailMessage()
    message["Subject"] = f"GRNScope support request{subject_context}"
    message["From"] = from_email
    message["To"] = recipient
    if reply_to_email:
        message["Reply-To"] = reply_to_email

    lines = [
        "A GRNScope user submitted a support request.",
        "",
        "Question:",
        question.strip(),
        "",
        "Context:",
        f"Reply-to email: {reply_to_email or 'Not provided'}",
        f"Project ID: {project_id or 'Not provided'}",
        f"Algorithm: {algorithm_id or 'Not provided'}",
        f"Page URL: {page_url or 'Not provided'}",
        f"Client ID: {client_id or 'Not provided'}",
    ]
    message.set_content("\n".join(lines))

    _send_smtp_message(message)
