from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import algorithm, downloads, jobs, projects, results, uploads

app = FastAPI()

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
app.include_router(downloads.router)
app.include_router(jobs.router)
app.include_router(projects.router)
app.include_router(results.router)
app.include_router(uploads.router)
