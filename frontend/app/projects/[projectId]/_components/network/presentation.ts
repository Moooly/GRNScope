import type { Core } from "cytoscape";
import { applyLabelBudget } from "./labels";

/** Compress the size range as density rises. A high degree must not turn the
 * whole dense core into overlapping white discs. Degree remains monotonic. */
export function nodeDiameter(degree: number, nodes: number, edges: number) {
  const base = nodes > 250 ? 7 : nodes > 40 ? 8 : 10;
  const density = Math.sqrt(Math.max(1, edges / Math.max(1, nodes)));
  return Math.min(nodes > 250 ? 30 : 34, base + 7 * Math.max(0, Math.log2(1 + degree) - 1) / density);
}

/** Text and strokes are sized in screen pixels, independently of world size. */
export function applyPresentation(cy: Core, force = false) {
  if (cy.destroyed()) return;
  const count = cy.nodes().length, density = cy.edges().length / Math.max(1, count);
  const zoom = cy.zoom(), relative = zoom / (Number(cy.scratch("galaxyFitZoom")) || zoom);
  const detail = relative >= 1.8;
  const emphasized = Boolean(cy.scratch("galaxyEmphasize"));
  const opacity = count <= 40 ? 0.5 : density > 5 ? 0.15 : 0.3;
  const key = `${count}:${cy.edges().length}:${zoom}:${detail}:${emphasized}`;
  // Panning only changes label visibility; do not restyle thousands of edges.
  if (force || cy.scratch("galaxyPresentationKey") !== key) cy.batch(() => {
    cy.scratch("galaxyPresentationKey", key);
    cy.nodes().forEach(n => {
      const font = (count <= 40 ? 13 : count <= 180 ? 12 : 11.5) + (n.data("layoutAnchor") ? 1 : 0);
      n.data("labelSize", font * Math.min(1.15, Math.max(1, Math.sqrt(relative))) / zoom);
    });
    cy.edges().toggleClass("detail", detail);
    cy.edges().forEach(e => {
      e.data("width", (0.65 + Number(e.data("evidence")) * 0.8) / zoom);
      e.data("inkOpacity", emphasized ? 0.6 : e.data("crossNeighborhood") ? (detail ? 0.075 : 0.045) : detail ? Math.max(density > 5 ? 0.2 : 0.3, opacity) : opacity);
    });
  });
  applyLabelBudget(cy);
}
