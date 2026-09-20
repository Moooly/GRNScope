import type { Core } from "cytoscape";
import { applyLabelBudget } from "./labels";

/** Linear degree mapping with the reference's 10:1 diameter contrast.
 * The upper domain grows beyond 18 so large hubs do not all hit one size. */
export function nodeDiameter(degree: number, maxDegree = 18) {
  return 20 + 180 * Math.max(0, Math.min(1, (degree - 1) / (Math.max(18, maxDegree) - 1)));
}

/** Evidence has a fixed, restrained screen-space width; opacity is visual
 * density, not another statistical measure. Bridges retain the same ink. */
export function evidenceWidth(value: number, weighted = false) {
  return weighted ? 0.45 + Math.max(0, Math.min(1, value)) * 0.65 : 0.55;
}

export function applyPresentation(cy: Core, force = false) {
  if (cy.destroyed()) return;
  const count = cy.nodes().length, density = cy.edges().length / Math.max(1, count);
  const zoom = cy.zoom(), relative = zoom / (Number(cy.scratch("galaxyFitZoom")) || zoom);
  const detail = relative >= 1.8;
  const emphasized = Boolean(cy.scratch("galaxyEmphasize"));
  const weighted = cy.scratch("publicationWeighted") === true;
  const opacity = emphasized ? 0.85 : detail ? 0.72 : density > 5 ? 0.32 : count <= 40 ? 0.66 : count > 500 ? 0.35 : 0.46;
  const key = `${count}:${cy.edges().length}:${zoom}:${detail}:${emphasized}:${weighted}`;
  if (force || cy.scratch("galaxyPresentationKey") !== key) cy.batch(() => {
    cy.scratch("galaxyPresentationKey", key);
    cy.nodes().forEach(n => {
      const prominence = Math.max(0, Math.min(1, (Number(n.data("diameter")) - 20) / 180));
      const font = cy.scratch("publicationExport") ? 16 + 8 * prominence : (count <= 40 ? 11 : 9) + 5 * prominence;
      n.data("labelSize", font / zoom);
    });
    cy.edges().forEach(e => {
      e.data("width", evidenceWidth(Number(e.data("evidence")), weighted) / zoom);
      e.data("arrowScale", 0.65);
      e.data("inkOpacity", opacity);
    });
  });
  applyLabelBudget(cy);
}
