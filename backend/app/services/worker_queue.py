from __future__ import annotations

import os
import re
import time
from typing import Any


DEFAULT_QUEUE_NAME = "grnscope"
DEFAULT_REDIS_URL = "redis://127.0.0.1:6379/0"
DEFAULT_JOB_TIMEOUT_SECONDS = 7 * 24 * 60 * 60
DEFAULT_WORKER_PROCESS_COUNT = 2
RQ_JOB_ID_UNSAFE_PATTERN = re.compile(r"[^A-Za-z0-9_-]+")


def queue_backend() -> str:
    return os.environ.get("GRNSCOPE_QUEUE_BACKEND", "local").strip().lower()


def queue_enabled() -> bool:
    return queue_backend() in {"redis", "rq"}


def queue_name() -> str:
    return (
        os.environ.get("GRNSCOPE_WORKER_QUEUE", DEFAULT_QUEUE_NAME).strip()
        or DEFAULT_QUEUE_NAME
    )


def redis_url() -> str:
    return (
        os.environ.get("GRNSCOPE_REDIS_URL", DEFAULT_REDIS_URL).strip()
        or DEFAULT_REDIS_URL
    )


def worker_job_timeout_seconds() -> int:
    raw_value = os.environ.get(
        "GRNSCOPE_WORKER_JOB_TIMEOUT",
        str(DEFAULT_JOB_TIMEOUT_SECONDS),
    )
    try:
        return max(60, int(raw_value))
    except ValueError:
        return DEFAULT_JOB_TIMEOUT_SECONDS


def worker_process_count() -> int:
    raw_value = os.environ.get(
        "GRNSCOPE_WORKER_COUNT",
        str(DEFAULT_WORKER_PROCESS_COUNT),
    )
    try:
        return max(1, int(raw_value))
    except ValueError:
        return DEFAULT_WORKER_PROCESS_COUNT


def safe_rq_job_id(*parts: object) -> str:
    safe_parts: list[str] = []
    for part in parts:
        text = str(part).strip()
        text = RQ_JOB_ID_UNSAFE_PATTERN.sub("-", text).strip("-")
        if text:
            safe_parts.append(text)
    return "-".join(safe_parts)


def get_redis_connection() -> Any:
    try:
        from redis import Redis
    except ImportError as exc:
        raise RuntimeError(
            "Redis queue mode requires the 'redis' Python package. "
            "Run: pip install -r backend/requirements.txt"
        ) from exc

    return Redis.from_url(redis_url())


def get_rq_queue() -> Any:
    try:
        from rq import Queue
    except ImportError as exc:
        raise RuntimeError(
            "Redis queue mode requires the 'rq' Python package. "
            "Run: pip install -r backend/requirements.txt"
        ) from exc

    return Queue(
        name=queue_name(),
        connection=get_redis_connection(),
        default_timeout=worker_job_timeout_seconds(),
    )


def enqueue_algorithm_job(
    project_id: str,
    job_id: str,
    selected_algorithms_list: list[str],
) -> list[str]:
    from ..algorithm_registry import sort_algorithm_ids_by_difficulty
    from .job_service import run_single_algorithm_task

    queue = get_rq_queue()
    queued_job_ids: list[str] = []
    for algorithm_id in sort_algorithm_ids_by_difficulty(selected_algorithms_list):
        queued_job = queue.enqueue(
            run_single_algorithm_task,
            project_id,
            job_id,
            algorithm_id,
            job_id=safe_rq_job_id(
                "project",
                project_id,
                "job",
                job_id,
                "algorithm",
                algorithm_id,
            ),
            job_timeout=worker_job_timeout_seconds(),
            result_ttl=24 * 60 * 60,
            failure_ttl=7 * 24 * 60 * 60,
        )
        queued_job_ids.append(str(queued_job.id))

    return queued_job_ids


def enqueue_algorithm_rerun(
    project_id: str,
    job_id: str,
    algorithm_id: str,
) -> str:
    from .job_service import run_single_algorithm_task

    queued_job = get_rq_queue().enqueue(
        run_single_algorithm_task,
        project_id,
        job_id,
        algorithm_id,
        job_id=safe_rq_job_id(
            "project",
            project_id,
            "job",
            job_id,
            "rerun",
            algorithm_id,
            int(time.time() * 1000),
        ),
        job_timeout=worker_job_timeout_seconds(),
        result_ttl=24 * 60 * 60,
        failure_ttl=7 * 24 * 60 * 60,
    )
    return str(queued_job.id)
