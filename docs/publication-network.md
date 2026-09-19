# Publication network

Implemented on `feature/publication-network`, following the user-approved direction from the pale network example on the [Cytoscape screenshots page](https://cytoscape.org/screenshots.html) and the [Oviz-Bio reference review](visualization-design-reference.md).

## Figure rules

- White canvas; mint circles for other genes and blue circles for transcription factors. Node size increases with incident relationships in the displayed graph, with a bounded scale adjusted for density. It does not represent biological importance.
- Thin straight connections; separate curved lanes only for parallel or reciprocal records. Bridges receive the same opacity as local links. Node placement retains disconnected components and emphasizes connectivity; spacing is not biological distance.
- Teal means predicted activation, rust means repression, grey means unresolved sign. Activation uses an arrowhead (→); repression uses a perpendicular bar (⊣), in both the figure and its key. Tips appear only at a resolved regulated endpoint. Negative links without direction are dashed; direction without sign uses a hollow arrow.
- Evidence controls line width on a fixed 0–1 scale. A uniform-width option is available. Opacity manages clutter and does not encode a second statistic.
- Overview explicitly reports its subset and ranks by method support, then verified bootstrap confidence or evidence. Complete network includes every relationship passing the selected filters. Focus includes all matching direct relationships of the chosen gene.
- Selection, hover, evidence and sign changes leave the node arrangement stable. Fit view restores framing; Reset layout recomputes the arrangement after dragging. Pinned labels receive first priority but still obey collision checks. Zoom or drag when a dense cluster leaves insufficient label space.

## Export

SVG and PNG are generated from a separate fitted copy of every displayed node and relationship. Selection and hover styling are excluded. The copy preserves node positions and parallel-link routes, places labels at export size, and adds a figure key with numeric size/width samples, counts, methods, filters and selection scope. SVG has a nominal width of 180 mm; PNG is 3,600 pixels wide. Neither format depends on the current on-screen crop.

## Validation (2026-09-19)

- 34 network tests pass, including direction semantics, reciprocal routes, stable geometry, label collision, verified ranking, disconnected components and dense inputs up to 1,193 nodes.
- TypeScript and the production build pass. ESLint has no errors; one existing unused `methodCount` warning remains in the legacy `NetworkLegend.tsx` component.
- Browser checked the public demo with 17 genes/23 relationships; overview with 19 genes/38 of 171 relationships; the complete 171-relationship view; and a focused gene with 18 relationships.
- Browser checked synthetic branching fixtures with 180 and 1,000 genes. These are layout tests, not biological results.
- Exercised label pinning and both download formats. Inspected the downloaded PNG and its complete graph, readable labels, numeric key and filter metadata.

Other result plots and tables are outside this first implementation.
