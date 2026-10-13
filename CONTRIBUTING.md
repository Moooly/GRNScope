# Development conventions

These rules describe the intended ownership of new code and code changed during the refactor. Apply them gradually to existing modules; move behavior in small, testable steps.

## Module boundaries

- Keep Next.js `app/` files focused on route entry points, layouts, and page composition. Put feature state, data access, calculations, and exports in named modules beside their feature. Put a component in shared UI only when multiple features genuinely use it.
- Use Server Components by default. Mark the smallest interactive boundary with `"use client"`, following the versioned guidance in `frontend/node_modules/next/dist/docs/` and `frontend/AGENTS.md`.
- Keep backend routes responsible for HTTP parsing, ownership checks, and response mapping. Services own workflows and domain decisions. Repositories own manifest reads, writes, and locks. Integrations own BEELINE, Docker, Redis, and email details.
- Depend inward: a route may call a service; a service may call a repository or integration. A lower layer must not import a route or UI module. Avoid circular imports.
- Keep the BEELINE checkout as a separate dependency. Changes to its algorithms require explicit output comparisons with representative fixtures.

## Names and types

- Use `PascalCase` for React components and TypeScript types, `camelCase` for TypeScript functions and values, and `snake_case` for Python functions and modules.
- Give modules names for their responsibility, such as `result_filters` or `useProjectResults`, rather than generic names such as `helpers2`.
- Type API inputs and outputs at the boundary. Validate external JSON before using it; do not treat a TypeScript assertion as runtime validation. Keep one documented mapping between backend field names and frontend models.
- Separate pure calculations from React rendering and from file or network I/O. Give scientific calculations and job state transitions focused tests.

## State, persistence, and errors

- Give each piece of UI state one owner. Prefer derived values over synchronized copies of the same state. Put polling, cancellation, caching, and retry behavior in data hooks or clients rather than page markup.
- Read and write project and job manifests through the repository layer. Preserve atomic writes and the existing locking rules when changing job state.
- Catch errors at a boundary that can recover or add context. Keep diagnostic information in logs while returning a stable, useful API error to the browser. Avoid silent broad exception handling.
- Centralize configuration and document required environment variables. Avoid machine-specific paths in application defaults.

## UI and styling

- Use shared tokens for repeated colors, spacing, and typography. Keep feature-specific styles scoped to the feature. Avoid inline layout rules that override responsive CSS.
- Check layouts at narrow phone, tablet, and desktop widths. Menus, dialogs, tables, and network panels must remain reachable without unintended clipping or overlap.
- Use semantic controls with labels, visible focus states, keyboard operation, and reduced-motion support where applicable.

## Verification

- Frontend: run `npm run check` in `frontend/`. This covers ESLint, TypeScript, network tests, and the production build.
- Backend: install `backend/requirements-dev.txt`, then run `.venv/bin/python -m pytest -q` in `backend/`.
- Add tests for changed contracts, scientific calculations, and job transitions. Use browser checks for changed layouts and interactive states. Keep each structural change small enough to review against its previous behavior.
- Treat `backend/data/` as versioned project data until its contents and demo dependencies have been reviewed. Treat `backend/projects/`, `backend/temp_uploads/`, and `frontend/.next-dev/` as generated runtime data.
