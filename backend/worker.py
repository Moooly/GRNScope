from __future__ import annotations

import inspect
import logging
import multiprocessing
import signal
import sys
import time

from app.services.worker_queue import (
    get_redis_connection,
    queue_name,
    worker_max_jobs,
    worker_process_count,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def worker_work_kwargs(worker) -> dict:  # noqa: ANN001
    max_jobs = worker_max_jobs()
    if max_jobs is None:
        return {}

    try:
        work_parameters = inspect.signature(worker.work).parameters
    except (TypeError, ValueError):
        return {}

    if "max_jobs" not in work_parameters:
        logging.warning(
            "Installed rq Worker.work() does not support max_jobs; worker recycling is disabled."
        )
        return {}

    return {"max_jobs": max_jobs}


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
    worker.work(**worker_work_kwargs(worker))


def start_worker_process(worker_index: int) -> multiprocessing.Process:
    process = multiprocessing.Process(
        target=run_worker_process,
        args=(worker_index,),
        name=f"grnscope-rq-worker-{worker_index}",
    )
    process.start()
    return process


def main() -> None:
    worker_count = worker_process_count()

    if worker_count == 1 and worker_max_jobs() is None:
        run_worker_process(1)
        return

    stop_requested = False
    processes: dict[int, multiprocessing.Process] = {}

    def request_stop(signum, frame) -> None:  # noqa: ANN001
        nonlocal stop_requested
        stop_requested = True
        for process in processes.values():
            if process.is_alive():
                process.terminate()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    for worker_index in range(1, worker_count + 1):
        processes[worker_index] = start_worker_process(worker_index)

    exit_code = 0
    try:
        while processes and not stop_requested:
            for worker_index, process in list(processes.items()):
                process.join(timeout=0)
                if process.is_alive():
                    continue

                if process.exitcode not in (0, None) and not stop_requested:
                    exit_code = process.exitcode or 1
                    logging.error(
                        "Worker child %s exited with code %s; starting a fresh child.",
                        worker_index,
                        process.exitcode,
                    )

                if not stop_requested:
                    processes[worker_index] = start_worker_process(worker_index)
            time.sleep(1)
    finally:
        for process in processes.values():
            if process.is_alive():
                process.terminate()
        for process in processes.values():
            process.join(timeout=10)

    if stop_requested:
        return
    if exit_code:
        sys.exit(exit_code)


if __name__ == "__main__":
    main()
