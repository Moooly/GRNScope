import type { Core } from "cytoscape";
import { applyLabelBudget } from "./labels";

/** Bounded, monotonic connection scale; small satellites leave space for hubs. */
export function nodeDiameter(degree: number, nodes: number, edges: number) {
  const base = nodes > 250 ? 6 : 7;
  const density = Math.sqrt(Math.max(1, edges / Math.max(1, nodes)));
  return Math.min(34, base + 7 * Math.log2(1 + Math.max(0, degree)) / density);
}

/** Evidence has a fixed, restrained screen-space width; opacity is visual
 * density, not another statistical measure. Bridges retain the same ink. */
export function evidenceWidth(value: number, weighted = true) {
  return weighted ? 0.65 + Math.max(0, Math.min(1, value)) * 0.8 : 0.9;
}

export function applyPresentation(cy: Core, force = false) {
  if (cy.destroyed()) return;
  const count = cy.nodes().length, density = cy.edges().length / Math.max(1, count);
  const zoom = cy.zoom(), relative = zoom / (Number(cy.scratch("galaxyFitZoom")) || zoom);
  const detail = relative >= 1.8;
  const emphasized = Boolean(cy.scratch("galaxyEmphasize"));
  const weighted = cy.scratch("publicationWeighted") !== false;
  const opacity = emphasized ? 0.85 : detail ? 0.72 : density > 5 ? 0.4 : count <= 40 ? 0.66 : 0.54;
  const key = `${count}:${cy.edges().length}:${zoom}:${detail}:${emphasized}:${weighted}`;
  if (force || cy.scratch("galaxyPresentationKey") !== key) cy.batch(() => {
    cy.scratch("galaxyPresentationKey", key);
    cy.nodes().forEach(n => { n.data("labelSize", (cy.scratch("publicationExport") ? 18 : count <= 40 ? 12 : 11) / zoom); });
    cy.edges().forEach(e => {
      e.data("width", evidenceWidth(Number(e.data("evidence")), weighted) / zoom);
      e.data("arrowScale", 0.65);
      e.data("inkOpacity", opacity);
    });
  });
  applyLabelBudget(cy);
}
