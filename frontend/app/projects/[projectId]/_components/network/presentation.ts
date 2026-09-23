import type { Core } from "cytoscape";
import { applyLabelBudget } from "./labels";
import { CONFIDENCE_OPACITY, WIDTH_STEPS } from "./encoding";

export const NODE_MIN = 10, NODE_MAX = 100;
/** Linear between this network's own smallest and largest value, with a 10:1
 * diameter contrast, so only the genuinely best-connected genes read as big.
 * Name length never enters this; long names overflow. */
export function nodeDiameter(value: number, minValue = 0, maxValue = 18, smallest = NODE_MIN) {
  if (!(maxValue > minValue)) return 40;
  return smallest + (NODE_MAX - smallest) * Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue)));
}

/** Arrowheads grow with their line: a head about 5 px long on the thinnest
 * link and 11 px on the thickest (a bar is as wide as a head is long).
 * Cytoscape sizes an arrow as max((w*13.37)^0.9, 29) * arrow-scale model
 * units, and a triangle's length (and a bar's width) is 0.3 of that size, so
 * the scale is solved from that rule. */
export function arrowScaleFor(linePx: number, zoom: number) {
  const width = linePx / zoom;
  const base = Math.max(Math.pow(width * 13.37, 0.9), 29);
  return ((4 + 2 * linePx) / zoom) / (0.3 * base);
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
      const px = stepWidth(Number(e.data("widthStep")));
      e.data("width", px / zoom);
      // Dashes keep the same on-screen rhythm at every zoom.
      if (e.data("dashed")) e.data("dashPattern", [(4 + px) / zoom, (3 + px * 0.6) / zoom]);
      e.data("arrowScale", arrowScaleFor(px, zoom));
      // A link that passes under an unrelated gene is drawn a little lighter,
      // so it is not mistaken for ending there.
      e.data("inkOpacity", CONFIDENCE_OPACITY[Number(e.data("confidenceBand")) || 0] * (e.data("occluded") ? 0.55 : 1));
    });
  });
  applyLabelBudget(cy);
}
