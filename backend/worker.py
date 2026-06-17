from __future__ import annotations

import logging

from app.services.worker_queue import get_redis_connection, queue_name


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def main() -> None:
    try:
        from rq import Queue, Worker
    except ImportError as exc:
        raise RuntimeError(
            "The GRNScope worker requires the 'rq' package. "
            "Run: pip install -r backend/requirements.txt"
        ) from exc

    redis_connection = get_redis_connection()
    queue = Queue(queue_name(), connection=redis_connection)
    worker = Worker([queue], connection=redis_connection)
    worker.work()


if __name__ == "__main__":
    main()
