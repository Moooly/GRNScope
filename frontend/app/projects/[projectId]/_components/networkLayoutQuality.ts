import type { Core, LayoutOptions } from "cytoscape";

/**
 * Straight-segment crossings between edges that share no endpoint.
 *
 * This is O(E^2), which is why it is only ever run on the small focused views
 * where individual crossings are actually visible. On a 19-gene network the
 * whole scoring pass costs well under a millisecond.
 */
export function countEdgeCrossings(cy: Core): number {
  const segments = cy.edges().map((edge) => {
    const a = edge.source().position();
    const b = edge.target().position();
    return {
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      source: edge.source().id(),
      target: edge.target().id(),
    };
  });
  const turns = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cyy: number,
  ) => (cyy - ay) * (bx - ax) > (by - ay) * (cx - ax);
  let total = 0;
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const p = segments[i];
      const q = segments[j];
      // Edges meeting at a shared gene are not a crossing, they are a fan.
      if (
        p.source === q.source ||
        p.source === q.target ||
        p.target === q.source ||
        p.target === q.target
      )
        continue;
      if (
        turns(p.ax, p.ay, q.ax, q.ay, q.bx, q.by) !==
          turns(p.bx, p.by, q.ax, q.ay, q.bx, q.by) &&
        turns(p.ax, p.ay, p.bx, p.by, q.ax, q.ay) !==
          turns(p.ax, p.ay, p.bx, p.by, q.bx, q.by)
      )
        total += 1;
    }
  }
  return total;
}

/** Node count up to which restart-and-score is worth its cost. */
export const LAYOUT_RESTART_MAX_NODES = 60;
/** Restarts per arrangement. fcose lands in a clean basin roughly half the
 * time on hub-shaped graphs, so six restarts make a bad draw ~1.5% likely. */
export const LAYOUT_RESTARTS = 6;

/**
 * Run a force layout several times from different random seeds and keep the
 * arrangement with the fewest edge crossings.
 *
 * fcose is bimodal on hub-and-spoke networks: the same options produce either a
 * clean fan or a tangle depending on the seed. Measured on the 19-gene demo, a
 * single run averaged ~30 crossings and varied between 4 and 34; best-of-six
 * returned 4 every time and cost 17ms in total. Taking the best draw is far
 * cheaper than trying to tune a force layout into never making a bad one.
 *
 * Returns a cancel function for unmount / superseded topology.
 */
export function runLayoutBestOfRestarts(
  cy: Core,
  options: LayoutOptions,
  restarts: number,
  done: (crossings: number) => void,
): () => void {
  let cancelled = false;
  let attempt = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestPositions: Record<string, { x: number; y: number }> | null = null;

  const finish = () => {
    const positions = bestPositions;
    if (positions)
      cy.nodes().positions((node) => positions[node.id()] ?? node.position());
    done(bestScore);
  };

  const step = () => {
    if (cancelled || cy.destroyed()) return;
    // A crossing-free draw cannot be improved on, so stop paying for restarts.
    if (attempt >= restarts || bestScore === 0) {
      finish();
      return;
    }
    attempt += 1;
    const run = cy.layout(options);
    run.one("layoutstop", () => {
      if (cancelled || cy.destroyed()) return;
      const score = countEdgeCrossings(cy);
      if (score < bestScore) {
        bestScore = score;
        const snapshot: Record<string, { x: number; y: number }> = {};
        cy.nodes().forEach((node) => {
          snapshot[node.id()] = { ...node.position() };
        });
        bestPositions = snapshot;
      }
      step();
    });
    run.run();
  };

  step();
  return () => {
    cancelled = true;
  };
}
