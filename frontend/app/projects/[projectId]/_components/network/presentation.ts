import type { Core } from "cytoscape";
import { applyLabelBudget } from "./labels";

/** Compress the size range as density rises. A high degree must not turn the
 * whole dense core into overlapping white discs. Degree remains monotonic. */
export function nodeDiameter(degree: number, nodes: number, edges: number) {
  const base = nodes > 250 ? 7 : nodes > 40 ? 8 : 10;
  const density = Math.sqrt(Math.max(1, edges / Math.max(1, nodes)));
  return Math.min(nodes > 250 ? 30 : 34, base + 7 * Math.max(0, Math.log2(1 + degree) - 1) / density);
}

/** Text and strokes are sized in screen pixels, independently of world size.
 *
 * The opacity ladder below is tuned for a white ground. Dark ink loses contrast
 * against white far faster than pale ink lost it against charcoal -- the same
 * 0.045 that read as a faint grey thread on the old dark canvas renders as
 * nothing at all here -- so every step is raised. The ordering is unchanged:
 * small networks show their edges outright, dense ones quiet down, cross-region
 * links stay quieter than links inside a region, and zooming in adds ink. */
export function applyPresentation(cy: Core, force = false) {
  if (cy.destroyed()) return;
  const count = cy.nodes().length, density = cy.edges().length / Math.max(1, count);
  const zoom = cy.zoom(), relative = zoom / (Number(cy.scratch("galaxyFitZoom")) || zoom);
  const detail = relative >= 1.8;
  const emphasized = Boolean(cy.scratch("galaxyEmphasize"));
  const opacity = count <= 40 ? 0.62 : density > 5 ? 0.22 : 0.42;
  // Line weight and tip size are taken from the pre-galaxy renderer, which used
  // a flat 2.2px stroke with arrow-scale 1.02, stepping down to 1.1 / 0.76 once
  // a network passed sixty edges or three edges per gene. Those proportions are
  // kept; what is not kept is the flat width, because evidence is encoded in
  // stroke weight here and the legend advertises it. So the ramp is centred on
  // the old constant instead of replacing it: 1.6-2.8 around 2.2, 0.8-1.4
  // around 1.1.
  //
  // The reference rule was `edges > 60 || edges/genes > 3`. Only the second
  // clause is kept. The first was tuned for a layout that packed its edges into
  // a tighter frame, where sixty of them genuinely crowded; the galaxy spreads
  // the same sixty across the whole canvas. Applied literally it thinned the
  // 122-gene / 89-edge opening view -- 0.73 edges per gene, about as sparse as
  // a real network gets -- down to hairlines, which is the opposite of what the
  // step-down is for. Edges per gene is the measure that survives the change of
  // layout; a raw count is not.
  const dense = density > 3;
  const strokeBase = dense ? 0.8 : 1.6;
  const strokeSpan = dense ? 0.6 : 1.2;
  // The reference renderer's 1.02 / 0.76 sized tips against its own flat stroke
  // and its own node scale; carried over literally the heads came out heavy
  // against the galaxy's smaller discs. Trimmed by about a quarter, keeping the
  // ratio between the two so the density step-down still lands the same.
  const arrowScale = dense ? 0.58 : 0.78;
  const key = `${count}:${cy.edges().length}:${zoom}:${detail}:${emphasized}:${dense}`;
  // Panning only changes label visibility; do not restyle thousands of edges.
  if (force || cy.scratch("galaxyPresentationKey") !== key) cy.batch(() => {
    cy.scratch("galaxyPresentationKey", key);
    cy.nodes().forEach(n => {
      const font = (count <= 40 ? 13 : count <= 180 ? 12 : 11.5) + (n.data("layoutAnchor") ? 1 : 0);
      n.data("labelSize", font * Math.min(1.15, Math.max(1, Math.sqrt(relative))) / zoom);
    });
    cy.edges().toggleClass("detail", detail);
    cy.edges().forEach(e => {
      e.data("width", (strokeBase + Number(e.data("evidence")) * strokeSpan) / zoom);
      e.data("arrowScale", arrowScale);
      e.data("inkOpacity", emphasized ? 0.72 : e.data("crossNeighborhood") ? (detail ? 0.13 : 0.09) : detail ? Math.max(density > 5 ? 0.3 : 0.42, opacity) : opacity);
    });
  });
  applyLabelBudget(cy);
}
