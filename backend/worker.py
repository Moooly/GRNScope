from __future__ import annotations

import logging
import multiprocessing
import signal
import sys

from app.services.worker_queue import (
    get_redis_connection,
    queue_name,
    worker_process_count,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def run_worker_process(worker_index: int) -> None:
    try:
        from rq import Queue, Worker
    except ImportError as exc:
        raise RuntimeError(
            "The GRNScope worker requires the 'rq' package. "
            "Run: pip install -r backend/requirements.txt"
        ) from exc

    redis_connection = get_redis_connection()
    queue = Queue(queue_name(), connection=redis_connection)
    worker = Worker(
        [queue],
        connection=redis_connection,
        name=f"{queue_name()}-{worker_index}",
    )
    worker.work()


def main() -> None:
    worker_count = worker_process_count()

    if worker_count == 1:
        run_worker_process(1)
        return

    stop_requested = False
    processes: list[multiprocessing.Process] = []

    def request_stop(signum, frame) -> None:  # noqa: ANN001
        nonlocal stop_requested
        stop_requested = True
        for process in processes:
            if process.is_alive():
                process.terminate()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    for worker_index in range(1, worker_count + 1):
        process = multiprocessing.Process(
            target=run_worker_process,
            args=(worker_index,),
            name=f"grnscope-rq-worker-{worker_index}",
        )
        process.start()
        processes.append(process)

    exit_code = 0
    try:
        for process in processes:
            process.join()
            if process.exitcode not in (0, None) and not stop_requested:
                exit_code = process.exitcode or 1
    finally:
        for process in processes:
            if process.is_alive():
                process.terminate()
        for process in processes:
            process.join(timeout=10)

    if stop_requested:
        return
    if exit_code:
        sys.exit(exit_code)


if __name__ == "__main__":
    main()
