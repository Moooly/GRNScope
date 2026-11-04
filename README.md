# GRNScope

GRNScope is a web application for running gene regulatory network inference and exploring its results. The frontend is a Next.js application; the FastAPI backend manages projects, results, and analysis jobs; the worker runs queued jobs. Algorithm execution uses a separate BEELINE checkout and Docker images.

## Repository map

| Path | Responsibility |
| --- | --- |
| `frontend/app/` | Routes, page composition, and current feature UI |
| `frontend/scripts/` | Network and export checks |
| `backend/app/api/` | HTTP endpoints |
| `backend/app/services/` | Project and analysis workflows |
| `backend/app/repositories/` | Project and job manifest persistence |
| `backend/worker.py` | Optional Redis/RQ worker process |
| `backend/tests/` | Backend behavior tests |
| `docs/` | User and operations documentation |

## Local development

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements-dev.txt
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open <http://localhost:3000>. Set `BEELINE_ROOT` to a BEELINE checkout when running inference jobs. The [operations guide](docs/09-operations.md) covers Docker, the optional queue, environment variables, and project storage.

The bundled read-only example is at <http://localhost:3000/projects/demo>. It needs no BEELINE checkout or Docker. Its [tracked inputs and results](docs/demo-assets.md) load on a fresh checkout.

## Checks and contribution rules

Run `bash scripts/check.sh` from the repository root for the same frontend and backend checks used in CI. After the production build, `bash scripts/smoke-demo.sh` starts both services and checks the demo on ports 8000 and 3000. See [docs/refactor-baseline.md](docs/refactor-baseline.md) for the starting state and [docs/api-contracts.md](docs/api-contracts.md) for the API route and response inventory.
