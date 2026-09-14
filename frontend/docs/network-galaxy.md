# Regulatory galaxy experiment

The default network canvas was rebuilt on `galaxy-cytoscape-like`. The previous implementation remains in Git. Analysis, filtering, and the actual relationship records are unchanged.

## Reference and interpretation

The visual reference is the BRCA1/TP53 network in the [Cytoscape screenshot gallery](https://cytoscape.org/screenshots.html), specifically [this exported SVG](https://cytoscape.org/images/screenshots/cy3_3_intro1.svg). It contains saved node coordinates and curved paths, not an interactive layout program that can simply be imported. This implementation recreates the visual approach with independent geometry rather than copying a fixed picture.

## Implementation

- `network/galaxyGeometry.ts`: preserve branching hubs in a skeleton, arrange it with the already-installed fCoSE solver, expand terminal branches into variable-radius local fans, resolve collisions, and pack disconnected components without inventing connections.
- `network/neighborhoods.ts`: dense components use deterministic, connected, bounded skeleton regions, local solves and a coarse inter-region solve. All original records remain in the rendered graph. These are layout neighborhoods, not inferred biological communities. Large satellite fans occupy an area rather than an ever-expanding single ring.
- The same module routes compatible relationships into soft shared curves with fixed endpoints. The relaxed route is fitted to one continuous quadratic Bézier per relationship, avoiding the short S-wiggles and abrupt curvature changes of directly rendering multiple relaxed handles. Opposing effects and opposing resolved directions do not share bundles. Reciprocal records retain distinct lanes. A curve junction is never a gene or a relationship.
- `network/galaxy.worker.ts`: calculate geometry away from the UI thread. Termination and revision checks discard obsolete results after filters or layouts change.
- `network/NetworkCanvas.tsx`: selection, keyboard browsing, pan/zoom, drag-and-reroute, fit/reset, resize handling, and a visible fallback if layout fails. Selection and evidence-only updates do not recompute positions.
- `network/model.ts`, `stylesheet.ts`, and `labels.ts`: white degree-scaled circles, subtle TF rings, charcoal background, teal links, clay repression, bounded label density, and direction tips on inspection or close zoom. Unsigned directed tips are hollow; unresolved direction has no tip.
- `network/presentation.ts`: density-compressed node sizing, screen-space text and stroke sizing, quieter cross-neighborhood links in overview, and a reversible Emphasize links control. Label placement checks actual text metrics against labels and node discs in four possible positions; selection affects priority but cannot bypass collision checks. Focus neighborhood reuses the existing graph filter and return chip.
- `networkFigureExport.ts`: matching SVG/PNG styling and legends, including filters and the distinction between geometric and biological distances.

Node size counts displayed relationships, not biological importance. Width encodes evidence on a fixed 0–1 scale. The default overview deliberately suppresses arrowheads; inspect a relationship for its exact direction and evidence. Layout proximity is not a measured biological distance or a claim of functional community membership.

Disconnected data stays disconnected. In the checked Paul2015 project, the original 100% evidence threshold displays 122 genes / 89 relationships; temporarily using 90% displays 192 / 183, including more hub-to-hub structure. The original threshold was restored after testing.

## Verification

Run from `frontend`:

```sh
node --test scripts/galaxy.test.cjs
npm run test:network
npm run build
```

The thirteen-test galaxy suite covers retained topology, finite/non-overlapping placement, distinct hub and satellite distances, curve compatibility, reciprocal edges, cycles, self-loops, disconnected graphs, direction semantics, and control-point clearance around large nodes. A fixed-position Irf8-like regression verifies single-arc routes with no interior joins, inflections, or longitudinal backtracking. Additional regressions cover dense 100/1,193-node graphs, bounded deterministic regions, size compression, a 723-neighbor selection, large satellite fans, restrained zoom ink, and reserved caption/control space. Exports are blocked while an updated arrangement is pending so new filter metadata cannot accompany old geometry.

The combined network suite has one existing failure in the legacy gallery-preset width assertion (`1.7 !== 2.1`), independently reproduced from unmodified HEAD. Its assertion is unchanged; its cleanup now also runs on failure so the test command terminates.

The development-only `/network-lab` page exercises the real canvas with explicitly synthetic 20, 100, 180, and 1,000-gene fixtures. It is unavailable in production. Browser checks covered the real project, keyboard and pointer selection, dragging, switching layouts, and SVG/PNG downloads. Fresh render sessions produced no warnings or errors during these checks. Exported SVG contains vector paths with finite coordinates; PNG was visually inspected.

This is an exploratory layout, not an exact reproduction of the reference's saved coordinates. Very large or highly interconnected networks still need zooming/filtering to inspect individual genes. The tested 1,000-gene fixture is branching; it is not a performance guarantee for an arbitrarily dense 1,000-gene graph.

## Real-project density audit — September 14, 2026

Counts below are **displayed genes / relationships**, not uploaded gene counts.

| Input project | Opening view | Dense view | Focus / stricter settings |
| --- | --- | --- | --- |
| 19 genes (`bdb4f7335018`) | 19 / 38 | 19 / 67 consensus; 19 / 116 Pearson-only, evidence 0 | SOX9: 12 / 11 |
| 100 genes (`09ac21ad6e1b`) | 98 / 200 | 100 / 1,738, evidence 0, Show all; four layout neighborhoods | JUND: 57 / 56; evidence 80: 73 / 80; direction confidence 100: empty state |
| 1,999 genes (`cdba705c0cf7`) | 122 / 89 | 1,193 / 7,104, evidence 0, Show all; seventeen layout neighborhoods | Klf1: 724 / 723; Irf8: 151 / 150 |

Checked small-network label readability, dense views, JUND/Klf1 selection, focus and return, zoom, and the reversible link-emphasis control in the actual UI. Dense views keep every matching edge; quiet opacity is presentation, not filtering. No browser warnings or errors were reported. Original result settings were restored after the audit.

The dense large-project SVG contains 8,300 finite vector paths and the correct 1,193/7,104 counts and neighborhood caveat. Its matching PNG was visually checked. Production build, targeted lint, and all thirteen galaxy regressions pass. The combined suite retains the unrelated legacy width failure described above.
