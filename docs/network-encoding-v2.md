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
- Name inside the circle, plain dark text (no halo or outline). Name length never changes size; long names overflow. Networks up to 60 genes name every gene; larger networks drop names that would overlap.

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

## Update: backbone layout and density (2026-09-23)
- **Backbone layout.** When a network has more than 1.5 links per gene (and at most 600 genes), each gene's three strongest links by evidence decide where it sits. All links are still drawn. Larger networks keep the bounded-region path, which is what keeps them fast.
- **Opening evidence cut.** Projects now open at evidence ≥ 0.5, or at the strongest ~10 links when fewer than 10 pass 0.5. Seeding now waits until every method's results have loaded. Before, a partial load averaged consensus evidence over missing methods and set the cut far too low (the 19-gene project opened at 0.19 and showed 108 links; it now shows 71).
- **Node size relative to the network.** Diameter runs linearly from 10 to 100 (reduced from 15–150 so the links stay visible) between the smallest and largest value in the network shown. If every gene has the same value, all are drawn at 40. Names wider than a small disc need only a 6-unit clearance from the next name, so small genes do not push their links long.
- **Links under genes.** A straight link that passes under a gene it does not connect is drawn at 55% of its opacity (`occludedEdges`, computed in the layout worker and after dragging).
- Timings (layout worker, local): 19 genes 0.1 s, 100 genes / 636 links 0.4 s, 1,170 genes / 3,870 links 1.1 s. `npm run test:network`: 39 pass.

## Update: figure polish (2026-09-23)
- **Gene names in italics**, as in journals.
- **Arrowheads scale with their line**: a head about 5 px long on the thinnest link and 11 px on the thickest (`arrowScaleFor`). The first version forgot that a triangle is only 0.3 of Cytoscape's arrow size, which made heads 2–3 px and practically invisible; fixed.
- **Caption strip**: one line of small type, "19 genes | 71 relationships | 5 methods · evidence ≥ 0.50", replacing the big stat blocks.
- **Key reports this figure**: columns for Genes, Size (with the actual min–max of the chosen measure), Effect, Width and Opacity, each width and confidence step with its count. The exported figure's key carries the same counts.
- **Colours**: TF amber `#D9913A` (further from repression red), other genes `#D9D9D9`.
- **Group shading**: tried and removed on 2026-09-23 because it looked too busy.
- **Smooth transitions**: after a new arrangement, genes glide from where the reader last saw them (520 ms); new genes grow out from the centre (620 ms). Skipped for reduced-motion users, networks over 1,500 genes and background tabs.
- **Hover flow**: hovering a gene or link makes dashes drift from regulator to target along its directed links. Screen-only.
- **Curved links**: tried and removed on 2026-09-23. Links are straight again; only parallel or reciprocal records get separate lanes. The curved mode is still in `routeGalaxy` (`curved: true`) but nothing turns it on.
- `npm run test:network`: 41 pass.

## Update: more spread, fill the frame (2026-09-23)
- Target rim-to-rim link length raised from 80 to 100 units (`EDGE_GAP`).
- `fillFrame`: after layout, the arrangement is stretched towards the canvas's proportions, up to 1.8×. A round network in a wide canvas now uses the horizontal space. Stretching only lengthens distances, so it can't create overlaps. The frame shape is read when the layout is computed; after resizing the window, press Reset layout to refit.

## Update: legend v3 (2026-09-23)
- Two quiet lines above the network: the caption ("19 genes | 71 relationships | 5 methods · evidence ≥ 0.50", moved out of the canvas corner), then every encoding on one line with hairline dividers. It wraps between groups on narrow screens.
- Every scale reads the same way: grey label, low end, samples, high end. `Connections 4 ●●● 14` (or Targets / Regulators), `Evidence <0.5 ━━━━ ≥0.9` (or `Methods 1 … N`), `Confidence <0.5 ━━━ ≥0.8`.
- "Activates" and "Represses" replace the Effect heading. Tips are dropped from the key when no direction is resolved.
- Per-step counts moved into tooltips on the width and confidence groups.
- The exported figure uses the same one-line key, drawn with measured text widths and wrapping between groups; the separate size-sample row is gone.

## Update: links filter and direction split (2026-09-23)
- **Links filter** (reworked; now lives in the caption): the caption's relationship count is the filter, e.g. "19 genes | [71 relationships] : [→ 41 activation] [⊣ 30 repression] | 5 methods · evidence ≥ 0.50", with "sign unknown" shown only when present. Clicking a part shows only those links; it gets a pale shaded background and the others dim. Clicking it again, or "relationships", shows everything. Genes never move, genes left without links fade to 25%, the width/confidence counts follow the filter, and exports drop hidden links and state the filter. The earlier toolbar pills looked like a second layout picker and were removed.
- **Direction split**: each gene is a pie in its own hue (TF `#B8732A`/`#E8B779`/`#F5E1C6`, other gene `#9A9A9A`/`#D1D1D1`/`#ECECEC`), with dark = regulates, light = regulated by, pale = direction unknown, starting at 12 o'clock. It's based on all displayed links, not only the filtered ones, and is off when the view has no directed link. The legend and export show a small pie with the three shades.
- `npm run test:network`: 44 pass.

## Temporary: palette switch (2026-09-23)
- A "Palette" select in the figure controls toggles between **Contrast** (the default: amber TFs, grey genes, blue/red links) and **Soft** (the original look the boss liked: TF `#8FAED0`, gene `#95C4B3`, activation `#588F89`, repression `#B77D66`, unknown `#A3ABA8`, labels `#33433E`; pie shades TF `#5F86B3`/`#B9CDE3`/`#E3EBF4`, gene `#5F9C86`/`#B8DACD`/`#E2F0EA`).
- Switching restyles in place, so genes don't move. The legend and exports follow the choice.
- Once the boss picks one, remove `PALETTES`' other entry, the select and the `palette` props/state.
- Soft tuned to feel like the original: its pie slices are TF `#8FAED0`/`#C9D8EA`/`#E6EDF6` and gene `#95C4B3`/`#C8E2D8`/`#E6F2ED`, so the original fill is the darkest slice. Its smallest node is 24 units instead of 10 (`Palette.nodeMin`), so low-degree genes stay visible circles; switching palettes resizes nodes without moving them. The key's spacing was tightened so it fits on one line at common widths.
