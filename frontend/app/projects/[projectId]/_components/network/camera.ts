import type { Core } from "cytoscape";
import { NETWORK_SCALE } from "./theme";
import { clampFitZoom } from "./encoding";
import { buildNetworkStylesheet } from "./stylesheet";
import { applyLabelBudget } from "./labels";
import { applyEdgeBundling, clearEdgeBundling, shouldBundle } from "./bundling";

/**
 * The horizontal spread that used to live here has been removed.
 *
 * It stretched every node's x to fill a wide panel, which was the right trade
 * when the layout was one undifferentiated mass. It is the wrong trade now:
 * a corona is a circle, and stretching one axis turns every rosette into an
 * ellipse -- the leaves stop sitting at one radius, which is the single
 * property that makes them read as a ring around their hub. The core layout
 * takes the panel's aspect as its bounding box instead, which shapes the graph
 * without deforming anything inside it.
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

export function settleView(cy: Core, framed?: () => boolean) {
  if (cy.destroyed() || cy.nodes().empty()) return;

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
