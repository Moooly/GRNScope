import type { Core } from "cytoscape";
import { applyLabelBudget } from "./labels";
import { CONFIDENCE_OPACITY, WIDTH_STEPS } from "./encoding";

export const NODE_MIN = 15, NODE_MAX = 150;
/** Linear between this network's own smallest and largest value, with a 10:1
 * diameter contrast, so only the genuinely best-connected genes read as big.
 * Name length never enters this; long names overflow. */
export function nodeDiameter(value: number, minValue = 0, maxValue = 18) {
  if (!(maxValue > minValue)) return 60;
  return NODE_MIN + (NODE_MAX - NODE_MIN) * Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue)));
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
      const prominence = Math.max(0, Math.min(1, (Number(n.data("diameter")) - NODE_MIN) / (NODE_MAX - NODE_MIN)));
      const font = exporting ? 15 + 9 * prominence : (count <= 40 ? 11 : 9.5) + 6 * prominence;
      n.data("labelSize", font / zoom);
    });
    cy.edges().forEach(e => {
      e.data("width", stepWidth(Number(e.data("widthStep"))) / zoom);
      e.data("arrowScale", 0.8);
      // A link that passes under an unrelated gene is drawn a little lighter,
      // so it is not mistaken for ending there.
      e.data("inkOpacity", CONFIDENCE_OPACITY[Number(e.data("confidenceBand")) || 0] * (e.data("occluded") ? 0.55 : 1));
    });
  });
  applyLabelBudget(cy);
}
