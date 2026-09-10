# Atlas layout comparison — September 10, 2026

Atlas now compares label-aware CoSE and WebCola arrangements for networks up to 250 genes. It rejects overlapping label footprints when scoring candidates, then chooses the arrangement with the larger fitted label size. Larger graphs retain CoSE to avoid adding WebCola's distance-solver cost. This is a readability heuristic, not a claim that either engine always produces the most attractive graph.

## Corrections shared by both candidates

- Reserve the full gene name at its actual font weight and measured browser width, independent of zoom-dependent label hiding. Solver rectangles include the marker, bottom-aligned label and outline; their centers are offset from the rendered marker accordingly.
- Remove coordinate compression after layout. Component placement uses translations and, only when upright label clearance survives, rigid quarter-turns. These preserve distances within a component.
- Try component rows against the available canvas proportions, then fit the camera. No fixed maximum initial zoom of 1.6.
- Keep settled positions when changing confidence, evidence, method support, selection or highlights. Cancel obsolete layouts on topology changes and unmount; fit only after the chosen arrangement is ready.
- Keep the existing visible legend, inspector, scientific metric definitions and exports.

## Reproducible comparison

Run `npm run compare:network` from `frontend`. Fixtures are in `scripts/network-layout-fixtures.cjs`. Each engine gets the same ordered topology, initial positions, reserved footprints and component placement. CoSE is the corrected baseline, without the old compression. The headless comparison uses conservative text-width estimates; the application measures Arial text in the browser.

Viewport: 1200 × 450 pixels, 40-pixel fitting margin, 13-pixel model-space labels. Values below are projected label sizes after fitting. The fixtures are synthetic, including a sparse 17-gene/20-edge example; they do **not** reconstruct the user's screenshot's exact relationships.

| Fixture | Corrected CoSE | WebCola | Automatic choice |
| --- | ---: | ---: | --- |
| Sparse: 17 genes, 20 edges | 9.8 px | 6.9 px | CoSE |
| Dense: 19 genes, 171 edges | 9.9 px | 12.9 px | WebCola |
| Disconnected: 24 genes, 6 groups | 6.5 px | 9.7 px | WebCola |

All candidates had zero overlapping reserved node/label rectangles in these fixtures. The dense and disconnected examples yield approximately 30% and 49% larger fitted labels with WebCola. Execution times varied by warm-up; automatic comparison took about 36–155 ms in the local synchronous runs. Browser scheduling and other workloads affect elapsed time.

`npm run test:network` covers full-label spacing on all three fixtures, automatic selection, distance preservation during component placement, cancellation, empty graphs, and the existing scientific encodings. Browser inspection also covered the local demo project's actual 12-gene/10-edge, 16-gene/20-edge and 19-gene/171-edge views. SVG exports of the dense graph in evidence and method-support modes contained identical paths for all 19 gene markers. Gene search and relationship inspection retained confidence availability, evidence, sign/direction and individual supporting-method details.

## Limits

These checks do not prove that every dataset is collision-free, or measure edge crossings, edge/label intersections or full edge-annotation overlap. Dense networks still need filtering, neighborhoods and relationship inspection. Displaying every metric on every edge remains a deliberate opt-in. The 250-gene WebCola cutoff is a conservative cost guard, not a benchmarked performance guarantee.

## Sources informing the implementation

- [Cytoscape WebCola extension](https://github.com/cytoscape/cytoscape.js-cola): actual installed layout dependency; overlap constraints, explicit spacing and disconnected handling.
- [Reagraph force layout](https://github.com/reaviz/reagraph/blob/master/src/layout/forceDirected.ts): treating node collision separately from attraction/repulsion.
- [Kedro-Viz layout design](https://github.com/kedro-org/kedro-viz/blob/main/LAYOUT_ENGINE.md): explicit spacing constraints after initial placement.
- [Cosmos collision-force design](https://github.com/cosmosgl/graph/blob/main/history/2026/2026-06-13-collision-force.md): collision-aware layout rather than relying solely on repulsion.

These sources informed the design; their implementations were not copied into the application.
