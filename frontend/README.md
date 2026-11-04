# GRNScope frontend

This Next.js 16 application provides the GRNScope project workspace, algorithm directory, and result visualizations. The FastAPI backend serves `/api/*` through the rewrite in `next.config.ts`.

## Run locally

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. Start the backend on port 8000 as described in the [repository README](../README.md). The default API base is same-origin `/api`; see `app/_lib/apiConfig.ts` and `next.config.ts` for overrides.

## Checks

Run `npm run check` for ESLint, TypeScript, network tests, and a production build. Individual commands are `npm run lint`, `npm run typecheck`, `npm run test:network`, and `npm run build`.

## Code map

- `app/` contains routes and the current feature UI.
- `app/_lib/` contains the API base and client identity helper.
- `app/projects/[projectId]/` contains the results workspace and network views.
- `scripts/` contains network layout and export checks.

`AGENTS.md` requires reading the installed Next.js documentation before editing Next-specific code.

## Supported local Node version

Use Node.js 24 LTS (`.nvmrc`) for local checks and development. This matches the
engine requirements of the lint tools.
