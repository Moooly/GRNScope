from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from contextlib import suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .api import (
    algorithm,
    contact,
    downloads,
    jobs,
    perturbations,
    projects,
    pseudotime,
    results,
    uploads,
)
from .storage import TEMP_UPLOAD_TTL_SECONDS, cleanup_expired_temp_uploads


async def periodically_cleanup_temp_uploads() -> None:
    interval_seconds = min(
        60 * 60,
        max(60, TEMP_UPLOAD_TTL_SECONDS // 4),
    )
    while True:
        await asyncio.sleep(interval_seconds)
        await asyncio.to_thread(cleanup_expired_temp_uploads)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await asyncio.to_thread(cleanup_expired_temp_uploads)
    cleanup_task = asyncio.create_task(periodically_cleanup_temp_uploads())
    try:
        yield
    finally:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task


app = FastAPI(lifespan=lifespan)

app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(algorithm.router)
app.include_router(algorithm.router, prefix="/api")
app.include_router(contact.router)
app.include_router(downloads.router)
app.include_router(jobs.router)
app.include_router(perturbations.router)
app.include_router(projects.router)
app.include_router(pseudotime.router)
app.include_router(results.router)
app.include_router(uploads.router)
