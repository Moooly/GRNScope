# Network encoding v2

Branch `feature/network-encoding-v2`, built on `experiment/nature-journal-figures`. Agreed with the user on 2026-09-23.

## Layout
- Force layout with a fixed edge length: every link aims for the same rim-to-rim gap (`EDGE_GAP` = 80 model units). The fCoSE solution is refined by stress majorization, whose one-hop rest length is `rim + gap + rim`; dense networks cannot satisfy every length and stretch some links.
- Hubs are seeded at the centre of the initial spiral. No anisotropic stretch.
- Single-link genes sit on an arc exactly one gap from their hub's rim; further rings follow when one arc is full.
- The complete network (every relationship passing Results Settings) is the only view; the Overview toggle is gone.

## Nodes
- Circles, no rim. Transcription factor `#E08214`, other gene `#E3E3E3`.
- Size: linear, 20–200 units (up to tenfold). The user chooses Targets (directed out-links), All connections, or Regulators (directed in-links). Undirected links count only towards all connections. Without any directed link, only All connections is offered.
- Name inside the circle, dark text on a thin white halo. Name length never changes size; long names overflow. Networks up to 60 genes name every gene; larger networks drop names that would overlap.

## Edges
- Sign: activation `#2166AC` + arrowhead, repression `#B2182B` + bar, unknown `#B5B5B5` (+ hollow arrowhead when directed).
- Direction: tip at the regulated gene; no tip = direction unresolved.
- Width (user choice): evidence (< 0.5, 0.5–0.75, 0.75–0.9, ≥ 0.9) or method support (1, 2, 3…all−1, all). Steps 0.6 / 1.2 / 2.2 / 3.6 px.
- Opacity: bootstrap confidence ≥ 0.8 = 100%, 0.5–0.8 = 45%, < 0.5 = 15%; no verified value = solid.
- Weak links are drawn first, strong links on top.

Shared rules live in `network/encoding.ts`, used by the canvas, the legend and the exported figure.

## Checks
- `npm run test:network`: 38 pass, including new tests for fixed edge length, the size measures, the width steps and the confidence opacities.
- `tsc --noEmit` and ESLint on the changed files pass. A production `next build` was not run, so it would not disturb the running dev server.
- On real projects: 19 genes, median rim-to-rim length 89 (target 80), no overlaps; 100 genes / 636 links, no overlaps, 0.8 s layout; 1,170 genes, 1.2 s.
