import type { Core } from "cytoscape";
import { applyLabelBudget } from "./labels";
import { CONFIDENCE_OPACITY, WIDTH_STEPS } from "./encoding";

/** Linear mapping with the reference's 10:1 diameter contrast: large hubs are
 * meant to be noticed first. The upper domain grows beyond 18 so large hubs do
 * not all hit one size. Name length never enters this; long names overflow. */
export function nodeDiameter(value: number, maxValue = 18) {
  return 20 + 180 * Math.max(0, Math.min(1, (value - 1) / (Math.max(18, maxValue) - 1)));
}

/** Screen-space stroke for a width step, independent of zoom. */
export function stepWidth(step: number) {
  return WIDTH_STEPS[Math.max(0, Math.min(3, Math.round(step)))];
}

export function applyPresentation(cy: Core, force = false) {
  if (cy.destroyed()) return;
  const count = cy.nodes().length;
  const zoom = cy.zoom();
  const exporting = Boolean(cy.scratch("publicationExport"));
  const key = `${count}:${cy.edges().length}:${zoom}:${exporting}`;
  if (force || cy.scratch("galaxyPresentationKey") !== key) cy.batch(() => {
    cy.scratch("galaxyPresentationKey", key);
    cy.nodes().forEach(n => {
      const prominence = Math.max(0, Math.min(1, (Number(n.data("diameter")) - 20) / 180));
      const font = exporting ? 15 + 9 * prominence : (count <= 40 ? 11 : 9.5) + 6 * prominence;
      n.data("labelSize", font / zoom);
    });
    cy.edges().forEach(e => {
      e.data("width", stepWidth(Number(e.data("widthStep"))) / zoom);
      e.data("arrowScale", 0.8);
      e.data("inkOpacity", CONFIDENCE_OPACITY[Number(e.data("confidenceBand")) || 0]);
    });
  });
  applyLabelBudget(cy);
}
