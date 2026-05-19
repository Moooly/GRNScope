from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import parseaddr


def normalize_notification_email(value: str | None) -> str | None:
    if not value:
        return None

    email = parseaddr(value.strip())[1].strip()
    if not email or "@" not in email:
        return None

    local_part, _, domain = email.partition("@")
    if not local_part or "." not in domain:
        return None

    return email


def smtp_is_configured() -> bool:
    return bool(
        os.environ.get("GRNSCOPE_SMTP_HOST")
        and os.environ.get("GRNSCOPE_SMTP_FROM", os.environ.get("GRNSCOPE_SMTP_USERNAME"))
    )


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


def send_job_completion_email(
    *,
    to_email: str,
    project_id: str,
    project_name: str,
    job_status: str,
    completed_count: int,
    failed_count: int,
    stopped_count: int,
    total_count: int,
) -> None:
    smtp_host = os.environ.get("GRNSCOPE_SMTP_HOST", "").strip()
    smtp_port = _smtp_port()
    smtp_username = os.environ.get("GRNSCOPE_SMTP_USERNAME", "").strip()
    smtp_password = os.environ.get("GRNSCOPE_SMTP_PASSWORD", "")
    from_email = os.environ.get("GRNSCOPE_SMTP_FROM", smtp_username).strip()
    use_ssl = _env_bool("GRNSCOPE_SMTP_USE_SSL", False)
    use_tls = _env_bool("GRNSCOPE_SMTP_USE_TLS", not use_ssl)
    timeout_seconds = float(os.environ.get("GRNSCOPE_SMTP_TIMEOUT", "20"))
    public_url = os.environ.get("GRNSCOPE_PUBLIC_URL", "").rstrip("/")
    project_url = f"{public_url}/projects/{project_id}" if public_url else ""

    if not smtp_host or not from_email:
        raise RuntimeError("Email notification is not configured on the server.")

    subject_status = "completed" if job_status == "Completed" else job_status.lower()
    subject = f"GRNScope analysis {subject_status}: {project_name}"

    result_lines = [
        f"Project: {project_name}",
        f"Status: {job_status}",
        f"Algorithms: {completed_count} completed, {failed_count} failed, {stopped_count} stopped, {total_count} total",
    ]
    if project_url:
        result_lines.append(f"Open results: {project_url}")
    else:
        result_lines.append("Open GRNScope and go to Workspace to view the results.")

    result_lines.extend(
        [
            "",
            "This notification was sent because an email address was saved for this analysis.",
        ]
    )

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = from_email
    message["To"] = to_email
    message.set_content("\n".join(result_lines))

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
