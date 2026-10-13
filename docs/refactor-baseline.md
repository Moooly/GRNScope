# Full-stack refactor baseline

Recorded on 2026-10-13, before changing application behavior. The starting branch was `feature/network-encoding-v2` at `f991f816`. Tracked files were clean before Stage 1.

## Scope and current structure

- The frontend has 113 TypeScript, TSX, and CSS files under `frontend/app/` (about 45,600 lines). The largest route is `app/projects/[projectId]/page.tsx` at about 3,000 lines. `PerturbationAnalysisSection.tsx`, `CreateProjectModal.tsx`, and `ResultsInsightsSection.tsx` also combine several responsibilities.
- The backend application has 41 Python files under `backend/app/` (about 22,000 lines). `beeline_service.py` is about 5,400 lines; job workflows, project routes, and run manifests are other large areas. The backend has 35 test files.
- The API has 41 route declarations. Only three currently declare `response_model`; frontend response types and mappings are maintained separately. This is the contract baseline for Stage 2.
- `backend/data/` contains about 5,500 tracked files and occupies about 506 MB. Most files are under the demo project, including BEELINE runtime material. Review demo dependencies before changing this data.
- The BEELINE checkout is a separate sibling Git repository. GRNScope locates and invokes it through the backend integration code.

## Verification at Stage 1

| Check | Command | Result |
| --- | --- | --- |
| Frontend full check | `cd frontend && npm run check` | Passes: ESLint, TypeScript, 58 network tests, production build |
| Backend tests | `cd backend && .venv/bin/python -m pytest -q` | 188 passed, 62 subtests passed |
| Backend pytest entry point | `cd backend && .venv/bin/pytest -q` | Passes with `pyproject.toml` test path configuration |

ESLint reports one source warning: an unused `methodCount` value in `NetworkLegend.tsx`. The current checks retain that warning as a visible baseline; it is not a build failure. The original `npm run lint` also scanned the generated `.next-dev/` directory. Stage 1 excludes that directory from Git, ESLint, and TypeScript without deleting it.

## Existing local artifacts

- `Claude outputs/` was untracked before Stage 1. It contains design previews and other local artifacts. Stage 1 leaves it unchanged and visible in Git status so its ownership can be decided explicitly.
- `frontend/.next-dev/` was untracked generated output before Stage 1. It is now ignored. Existing files remain in place.
- `backend/projects/` and `backend/temp_uploads/` are local runtime storage and were already ignored.

## Behavioral review for later stages

The Algorithms controls extend beyond a 320px viewport. The network table uses an inline grid width that can override its mobile layout. Stage 5 will inspect all routes and interactive states at several viewport sizes, then address confirmed overlap and clipping. Stage 1 changes only documentation and check configuration.
