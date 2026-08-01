[← Troubleshooting](08-troubleshooting.md) · [Documentation index](README.md)

# 9. Operations and deployment

For running your own GRNScope instance. End users do not need this chapter.

## 9.1 Components

| Component | Technology | Default port |
| --- | --- | --- |
| Frontend | Next.js 16, React 19, Tailwind 4 | 3000 |
| Backend | FastAPI + Uvicorn | 8000 |
| Algorithm execution | BEELINE (`BLRunner.py`) driving Docker | — |
| Optional queue | Redis + RQ | 6379 |

The frontend proxies `/api/*` to the backend, so in normal operation only port
3000 is exposed. There is no database — all state is files under
`backend/projects/`.

## 9.2 Running locally

Backend:

```bash
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend && npm install && npm run dev
```

Then open `http://localhost:3000`. The backend on port 8000 serves the API only;
its root path returns 404, which is expected.

Python dependencies are `fastapi`, `uvicorn`, `python-multipart`, `pandas`,
`scanpy>=1.11,<2`, `scipy>=1.11,<2`, `scikit-learn>=1.4,<2`, `pyyaml`, `tqdm`,
`redis`, `rq`.

CORS is preconfigured for `localhost:3000`, `127.0.0.1:3000`, `localhost:3001`
and `127.0.0.1:3001` ([`app/main.py`](../backend/app/main.py)). Add your own
origins there before deploying anywhere else.

## 9.3 Docker images

Every algorithm except PEARSON runs inside a container. Pull them before running
anything:

| Algorithm | Image |
| --- | --- |
| PIDC | `grnbeeline/pidc:base` |
| GENIE3, GRNBOOST2 | `grnbeeline/arboreto:base` |
| CELLORACLE | `grnbeeline/celloracle:base` |
| PPCOR | `grnbeeline/ppcor:base` |
| SCODE | `grnbeeline/scode:base` |
| SINCERITIES | `grnbeeline/sincerities:base` |
| SCRIBE | `grnbeeline/scribe:base` |
| SINGE | `grnbeeline/singe:0.4.1` |
| LEAP | `grnbeeline/leap:base` |
| GRISLI | `grnbeeline/grisli:base` |
| GRNVBEM | `grnbeeline/grnvbem:base` |
| Slingshot (pseudotime) | `grnbeeline/slingshot:0.1.0` |
| PEARSON | none — runs locally |

The Docker CLI must be on the backend's `PATH`; GRNScope shells out to it to
inspect and terminate containers when you stop a task.

## 9.4 Locating BEELINE

The BEELINE checkout is found via `resolve_beeline_root()`, which tries, in
order: the `BEELINE_ROOT` environment variable, a hardcoded developer path, then
`Beeline`/`beeline` beside or two levels above the backend, then `~/Beeline` and
`~/beeline`.

> **Set `BEELINE_ROOT` explicitly on any real deployment.** The candidate list in
> [`app/config.py`](../backend/app/config.py) contains an absolute path from a
> developer's machine (`/Users/molyloo/Documents/TRU/Beeline`). It is harmless
> when absent, but relying on path guessing is fragile.

GRNScope copies `BLRunner.py`, `BLRun/`, `Algorithms/` and `utils/` into an
execution mirror rather than running from the checkout directly, so concurrent
jobs do not interfere with each other. If your project path contains
shell-sensitive whitespace, GRNScope relocates the runtime under
`~/.grnscope/` — override with `GRNSCOPE_SPACE_FREE_LINK_ROOT` and
`GRNSCOPE_SPACE_FREE_RUNTIME_ROOT`.

`BEELINE_PYTHON` overrides the interpreter used to launch `BLRunner.py`; it
defaults to the backend's own `sys.executable`.

## 9.5 Environment variables

### Execution and resources

| Variable | Default | Effect |
| --- | --- | --- |
| `GRNSCOPE_MAX_CONCURRENT_ALGORITHMS` | 2 | Concurrent algorithm tasks (in-process scheduler) |
| `GRNSCOPE_TOTAL_CPU_CORES` | detected | Overrides the detected core count |
| `GRNSCOPE_ALGORITHM_CPU_BUDGET` | cores ÷ concurrency | CPU budget per algorithm |
| `GRNSCOPE_ALGORITHM_MEMORY_MB` | (RAM − 10%) ÷ concurrency | Memory budget per algorithm |
| `BEELINE_ROOT` | path search | BEELINE checkout location |
| `BEELINE_PYTHON` | `sys.executable` | Interpreter for `BLRunner.py` |
| `GRNSCOPE_SPACE_FREE_LINK_ROOT` | `~/.grnscope/beeline_links` | Whitespace-free mirror root |
| `GRNSCOPE_SPACE_FREE_RUNTIME_ROOT` | `~/.grnscope/beeline_runtime` | Whitespace-free runtime root |

### Queue (Redis / RQ)

| Variable | Default | Effect |
| --- | --- | --- |
| `GRNSCOPE_QUEUE_BACKEND` | `local` | Set to `redis` or `rq` to enable the queue |
| `GRNSCOPE_REDIS_URL` / `REDIS_URL` | `redis://127.0.0.1:6379/0` | Redis connection |
| `GRNSCOPE_WORKER_QUEUE` | `grnscope` | Queue name |
| `GRNSCOPE_WORKER_COUNT` | 2 | Worker processes |
| `GRNSCOPE_WORKER_MAX_JOBS` | 1 | Jobs before a worker recycles |
| `GRNSCOPE_WORKER_JOB_TIMEOUT` | 604800 (7 days) | Per-job timeout |

Start workers with:

```bash
cd backend && python worker.py
```

`worker.py` supervises its children, restarts any that exit unexpectedly, and
handles `SIGINT`/`SIGTERM` cleanly. Recycling after each job
(`GRNSCOPE_WORKER_MAX_JOBS=1`) is the default because some algorithm containers
leak memory.

### Analysis defaults

| Variable | Default | Effect |
| --- | --- | --- |
| `GRNSCOPE_CONFIDENCE_STABILITY_TOP_K` | 10 | The *K* in top-*K* recovery ([§6.4](06-metrics.md#64-stability-and-confidence--how-reproducible-it-is)) |
| `GRNSCOPE_RANKED_EDGES_PER_TARGET_LIMIT` | 20 | Global edges-per-target cap |
| `GRNSCOPE_<ALGORITHM>_MAX_EDGES_PER_TARGET` | — | Per-algorithm override |
| `GRNSCOPE_PERTURBATION_MAX_CELLS` | 2000 | Cells used per perturbation run |
| `GRNSCOPE_SLINGSHOT_IMAGE` | `grnbeeline/slingshot:0.1.0` | Pseudotime estimation image |

Precedence for the edges-per-target cap: the project's own setting, then the
per-algorithm variable, then the global variable, then the default.

Bootstrap run counts (3–15) and the early-stopping parameters (ρ ≥ 0.95, streak
of 2) are **not** environment-configurable; they are constants in
[`beeline_service.py`](../backend/app/services/beeline_service.py).

### Uploads

| Variable | Default | Effect |
| --- | --- | --- |
| `GRNSCOPE_UPLOAD_VALIDATION_MODE` | `strict` | Anything else selects fast sampling ([§3.2](03-input-data.md#two-validation-modes)) |
| `GRNSCOPE_UPLOAD_FULL_NUMERIC_CHECK_ROWS` | 5 | Fully checked rows in fast mode |
| `GRNSCOPE_UPLOAD_EDGE_NUMERIC_CHECK_COLUMNS` | 4 | Leading/trailing columns spot-checked |
| `GRNSCOPE_UPLOAD_FAST_SAMPLE_ROWS` | 20 | Rows sampled in fast mode |
| `GRNSCOPE_UPLOAD_NAME_PREVIEW_LIMIT` | 1000 | Gene/cell names returned to the client |
| `GRNSCOPE_TEMP_UPLOAD_TTL_SECONDS` | 86400 | Staging lifetime |

Expired staged uploads are swept on startup and then periodically, at whichever
is smaller of one hour or a quarter of the TTL.

### Email

| Variable | Purpose |
| --- | --- |
| `GRNSCOPE_SMTP_HOST` | SMTP server — required to enable email at all |
| `GRNSCOPE_SMTP_PORT` | Default 587 |
| `GRNSCOPE_SMTP_USERNAME` / `GRNSCOPE_SMTP_PASSWORD` | Credentials |
| `GRNSCOPE_SMTP_FROM` | Sender; falls back to the username |
| `GRNSCOPE_SMTP_USE_TLS` / `GRNSCOPE_SMTP_USE_SSL` | Transport security |
| `GRNSCOPE_SMTP_TIMEOUT` | Socket timeout |
| `GRNSCOPE_CONTACT_EMAIL` / `GRNSCOPE_SUPPORT_EMAIL` | Where the contact form goes |
| `GRNSCOPE_PUBLIC_URL` | Base URL used in notification links |

Email is optional. Without `GRNSCOPE_SMTP_HOST` the notification field simply has
no effect.

### Frontend

| Variable | Effect |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | API base; defaults to same-origin `/api` |
| `NEXT_PUBLIC_ALLOW_CROSS_ORIGIN_API` | Must be `"true"` to permit a cross-origin API base |
| `NEXT_INTERNAL_API_PROXY_TARGET` | Proxy target for `/api/*`, default `http://127.0.0.1:8000` |

By default a cross-origin `NEXT_PUBLIC_API_URL` is **ignored** in the browser and
the same-origin `/api` is used instead. Set
`NEXT_PUBLIC_ALLOW_CROSS_ORIGIN_API=true` deliberately if you split the
deployment across origins.

## 9.6 Storage

```
backend/
├── projects/<project-id>/   # one directory per analysis
├── temp_uploads/            # staging, TTL-swept
└── data/
    ├── known_tf_gene_names.txt
    ├── tf_gene_names/       # per-species TF references
    ├── gencode_reference/   # gene coordinates for the Circos layout
    └── demo_project/
```

Sizing depends almost entirely on cell count and bootstrap runs, since every run
writes its own ranked-edge CSV. Budget for a multiple of your input size per
algorithm.

Nothing is cleaned up automatically except staged uploads and the transient
`_beeline_runtime/` directories. Projects persist until deleted through the API.

## 9.7 Security notes

Before exposing an instance publicly, understand the model:

- **No authentication.** Ownership is an unauthenticated cookie
  ([§1.5](01-overview.md#15-projects-accounts-and-privacy)). Anyone who obtains
  or guesses a client ID has that client's projects. `/login` and `/register`
  are redirects, not auth.
- **No per-project access control** beyond that cookie comparison.
- **No upload quota.** Any client can create unlimited projects, each with files
  up to 500 MB.
- **Docker access implies host access.** The backend can start containers and
  mount project directories.

Suitable for a lab-internal network or a single-user machine. A public
deployment needs an authenticating reverse proxy in front, and quota enforcement.

## 9.8 Tests

```bash
cd backend && python -m pytest tests/
```

Around 30 test modules cover preprocessing contracts, confidence settings,
gene ordering and selection, algorithm parameter validation, execution order,
stop/rerun behaviour, result serialisation, species inference, matrix state
detection, upload safety, and the CellOracle expression and species contracts.
Run them after changing anything in `backend/app/services/`.

## 9.9 Keeping this documentation accurate

Several documents restate constants that live in code. If you change any of
these, update the corresponding section:

| Constant | Location | Documented in |
| --- | --- | --- |
| `DEFAULT_CONFIDENCE_MIN_RUNS` / `MAX_RUNS` | `beeline_service.py` | [§6.2](06-metrics.md#62-the-bootstrap-idea) |
| `DEFAULT_CONFIDENCE_STABILITY_TOP_K` | `beeline_service.py` | [§6.4](06-metrics.md#64-stability-and-confidence--how-reproducible-it-is) |
| `DEFAULT_CONFIDENCE_STOP_RHO` / `STOP_STREAK` | `beeline_service.py` | [§6.5](06-metrics.md#65-early-stopping) |
| `DEFAULT_RANKED_EDGES_PER_TARGET_LIMIT` | `beeline_service.py` | [§2.4](02-quickstart.md#24-optional-open-advanced-settings) |
| `MIN_CLUSTER_SCOPE_CELLS` | `job_service.py` | [§3.5](03-input-data.md#35-cluster-labels-optional) |
| `MAX_FILE_SIZE_BYTES` | `validators.py` | [§3.1](03-input-data.md#31-rules-that-apply-to-every-file) |
| `PREPROCESSING_STAGE_ORDER` | `preprocessing_contract.py` | [§4.1](04-preprocessing.md#41-the-pipeline) |
| `ALGORITHMS`, `ALGORITHM_RUN_DIFFICULTY_ORDER` | `algorithm_registry.py` | [§5](05-algorithms.md) |

Note also that `docs/confidence_metric_calculation_reference.py` is a standalone
teaching file, not imported by the app. Its docstring still describes a
100-replicate default; production uses 3–15. Treat
[§6](06-metrics.md) as authoritative.

Screenshots in `docs/images/` were captured from a real analysis
(5 algorithms, 19 genes, 2,000 cells, with pseudotime and a reference network).
Retake them after visual changes.

---

[← Back to the documentation index](README.md)
