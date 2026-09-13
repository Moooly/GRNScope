import type { Core } from "cytoscape";
import { NETWORK_SCALE } from "./theme";
import { clampFitZoom } from "./encoding";
import { buildNetworkStylesheet } from "./stylesheet";
import { applyLabelBudget } from "./labels";
import { applyEdgeBundling, clearEdgeBundling, shouldBundle } from "./bundling";

/**
 * Spread a squarish layout across a wide panel.
 *
 * fCoSE lays out into a square and then packs components into its own
 * arrangement, so asking it for a 16:9 bounding box does not survive -- the
 * result comes back at an aspect of about 1.0 whatever you pass. Fitting that
 * into a wide canvas means fitting to the height, which is why the network sat
 * as a block in the middle with a third of the panel empty on either side.
 *
 * Stretching the positions afterwards is a blunt instrument, so it is kept
 * deliberately weak: a fraction of the way toward the panel's aspect, capped,
 * and only when the mismatch is real. Edge lengths are distorted slightly;
 * what the reader gains is the whole canvas.
 */
function spreadToCanvas(cy: Core) {
  const nodes = cy.nodes();
  if (nodes.length < 8) return;
  const box = nodes.boundingBox();
  if (!(box.w > 0) || !(box.h > 0)) return;
  const panel = cy.width() / Math.max(1, cy.height());
  const current = box.w / box.h;
  if (!(panel > 1.15) || current >= panel * 0.85) return;
  const stretch = Math.min(1.45, Math.sqrt(panel / current));
  const centre = box.x1 + box.w / 2;
  cy.batch(() => {
    nodes.forEach((node) => {
      const position = node.position();
      node.position({
        x: centre + (position.x - centre) * stretch,
        y: position.y,
      });
    });
  });
}

/**
 * Settling the view.
 *
 * There is a circularity here that took a while to see: sizes are budgeted in
 * rendered pixels, rendered size is model size times zoom, and zoom comes from
 * fitting the graph -- whose extent depends on the sizes. Chase it naively and
 * it diverges: bigger nodes make a bigger extent, which lowers the fit zoom,
 * which makes the nodes small again.
 *
 * It converges because the sizes are clamped. The pixel budget is bounded at
 * both ends, so each pass moves the zoom by less than the last, and two passes
 * land within a few percent. We stop there deliberately rather than iterating
 * to a fixed point -- a stable, slightly imperfect fit beats a camera that
 * keeps twitching after the reader has started looking at it.
 */

function graphStats(cy: Core) {
  let maxDegree = 0;
  let minDegree = Infinity;
  cy.nodes().forEach((node) => {
    const degree = Number(node.data("degree")) || 0;
    maxDegree = Math.max(maxDegree, degree);
    minDegree = Math.min(minDegree, degree);
  });
  return {
    minDegree: Number.isFinite(minDegree) ? minDegree : 1,
    maxDegree,
    edgeCount: cy.edges().length,
  };
}

function restyle(cy: Core) {
  const { minDegree, maxDegree, edgeCount } = graphStats(cy);
  cy.style(
    buildNetworkStylesheet({ zoom: cy.zoom(), minDegree, maxDegree, edgeCount }),
  );
}

/**
 * Fit the graph, size it to the pixel budget, and decide which names fit.
 * Every camera move in the canvas goes through here, so there is exactly one
 * place where the view can end up in a state the budget does not describe.
 */
export function settleView(cy: Core, framed?: () => boolean) {
  if (cy.destroyed() || cy.nodes().empty()) return;

  spreadToCanvas(cy);

  if (!framed?.()) {
    cy.fit(undefined, NETWORK_SCALE.fitPadding);
    const clamped = clampFitZoom(cy.zoom());
    if (clamped !== cy.zoom()) {
      cy.zoom({
        level: clamped,
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
      });
      cy.center();
    }
  }

  // One restyle, against the zoom the camera ended on. Only type and link
  // weight are computed from it; node sizes are fixed in model units, so this
  // cannot move the extent enough to invalidate the zoom it just read -- which
  // is what made the earlier two-pass version pile every disc on its
  // neighbours.
  restyle(cy);
  syncBundling(cy);
  applyLabelBudget(cy);
}

/**
 * Bundle or release, whichever the current view calls for. Cheap enough to run
 * on a zoom threshold crossing, and idempotent, so callers do not have to
 * track which state the edges are in.
 */
export function syncBundling(cy: Core) {
  if (cy.destroyed()) return;
  const wanted = shouldBundle(cy);
  const bundled = cy.edges().some((e) => e.data("bundleDistances") !== undefined);
  if (wanted === bundled) return;
  if (wanted) applyEdgeBundling(cy);
  else clearEdgeBundling(cy);
}
