# Gallery appearance experiment

Branch: `feature/network-gallery-styles`

Four separate appearances inspired by the user's four Cytoscape gallery references:

- Teal constellation: charcoal surface, white nodes sized by displayed degree, teal activation and amber repression, branching neighborhoods with selective leaf-fan curves.
- Silver spheres: black surface, radial pearl shading, pale blue activation and peach repression, gentler curves.
- Pastel network: warm white surface, mint other genes and teal TFs, degree-sized nodes, simple edges.
- Graphite spheres: gray surface, directional graphite shading, pale blue activation and peach repression, stronger curves.

The previous appearance remains available as Current style. Display > Network style contains the choices. Circos keeps its chromosome encodings. The experimental branch starts in Teal constellation.

All styles retain TF diamonds, other-gene circles, activation arrows, repression bars, unresolved-sign open arrows, and no tip for unresolved direction. Metric widths retain the same absolute scale. Node size in Teal and Pastel encodes displayed degree, bounded to 44 model pixels; node color in Pastel identifies gene type, **not expression**. Switching appearance preserves filters and selection. Teal / Force now uses the branching layout; entering or leaving that combination recomputes positions. Other appearance changes preserve positions. Force layout reserves space for the largest preset markers.

Teal routing curves compatible leaf fans that share a hub, angular sector, sign and tip type; bridges and other relationships stay straight. Silver and Graphite retain the earlier centroid curves. Routing updates after layout and dragging. It does not merge relationships and is not the gallery's full force-directed edge-bundling algorithm. Gradients are 2D shading rather than 3D geometry. Placement depends on actual topology, not the reference images' saved coordinates.

PNG/SVG downloads carry the active background and palette and include the appearance name and size explanation. Verified SVGs contain radial gradients for Silver and linear gradients for Graphite; the Silver PNG was also visually checked.

## Validation

- All 17 network tests pass, including branch geometry, selective routing, and 20-to-100 gene expansion. TypeScript, lint and the production build pass.
- All four presets checked in the live project; a second project checked with 108 relationships.
- At 390 × 844, the style menu fits the viewport without horizontal overflow.
- Applying paint styles alone preserves node coordinates and selection in the regression test; switching into Teal / Force deliberately recomputes layout.
- The live project was checked at 10 and 19 displayed genes; requesting 100 correctly clamps to its 19 available genes. The synthetic preview was visually checked at 20, 100 and 146 genes.

## References

- Gallery: https://cytoscape.org/screenshots.html
- Gallery's published pastel stylesheet: https://cytoscape.org/data/new_style.json
- Gallery loader (saved/preset positions): https://cytoscape.org/js/load_cyjs2.js
- Browser gradient API: https://js.cytoscape.org/#style/node-body
- Browser curve API: https://js.cytoscape.org/#style/unbundled-bezier-edges

These presets use newly written application code. No gallery images, sample biological data, or desktop SVG path coordinates are embedded. Cytoscape.js remains the existing MIT-licensed rendering dependency.


## Focused reference investigation and layout update

The target is `https://cytoscape.org/images/screenshots/cy3_3_intro1.svg`, a desktop-generated SVG with saved geometry. It contains 191 text elements and 667 teal cubic path elements; these are drawing primitives, not a claim of 667 distinct biological relationships. Visually straight connections can also be encoded as cubic paths. The SVG does not publish the exact layout algorithm, its parameter values, the input network or the bundling settings. We therefore do not claim a direct port of an exact recipe.

Cytoscape's manual describes node placement and edge bundling as separate operations, including Prefuse force-directed placement, adjustable spacing and Holten-style force-directed edge bundling:
https://manual.cytoscape.org/en/stable/Navigation_and_Layout.html#edge-bend-and-automatic-edge-bundling

The implemented browser approximation uses terminal-chain peeling while retaining branching junctions and cyclic structure, the existing solver for the remaining connected center, space reserved around hubs, outward branch placement, full-label collision correction and component packing. Relationships used only for arrangement do not become regulatory parent/child claims; all selected data edges remain rendered. The displayed topology determines a fresh layout when the limit changes. Networks above 600 displayed genes use the existing bounded layout path.

Results Settings now offers a gene or relationship limit. Gene mode selects a stable prefix of genes encountered in ranked relationships and retains every matching edge between the selected genes. The scope strip reports displayed and available genes separately. The inspected project has 19 genes available after its current filters; 100 relationships cannot produce 100 distinct genes.

`network-branch-fixture.cjs` supplies a synthetic 146-gene network for testing expansion (20, 100, 146), six hubs, a terminal chain, and nonoverlapping labels. `node scripts/preview-branch-layout.cjs` creates a local review page in `/tmp/grnscope-branch-review`; it is clearly labeled synthetic and uses the actual layout positions and curve data. This fixture is never inserted into project results.
