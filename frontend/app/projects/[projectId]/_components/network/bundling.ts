import type { Core, EdgeSingular, NodeSingular } from "cytoscape";

/**
 * Edge bundling.
 *
 * The Cytoscape figure that reads as filaments and voids at thousands of edges
 * is not laid out differently from ours -- it is *drawn* differently. Edges
 * running between the same two regions are pulled onto a shared path, so
 * hundreds of separate lines resolve into a handful of visible trunks. Without
 * it, a dense graph is a uniform smear no matter how good the layout is,
 * because every line takes its own route and the routes average out to grey.
 *
 * Proper force-directed bundling compares every edge against every other and
 * costs O(E squared) per cycle. This does something cheaper that gets most of
 * the look: it finds a handful of spatial clusters, then bends each edge
 * toward the centroid of the cluster at each of its ends. Two edges running
 * between the same pair of clusters bow toward the same two points, so they
 * converge without ever being compared to each other.
 *
 * The honest cost is that a bundled edge no longer shows its own path -- you
 * cannot trace one link by eye through a trunk. That is why this is an
 * overview treatment only: it releases the moment the reader zooms in or
 * selects something, which is exactly when tracing one link starts to matter.
 */

/** Below this zoom the reader is looking at shape, not at relationships. */
export const BUNDLE_MAX_ZOOM = 0.9;
/** Bundling a handful of edges gains nothing and costs clarity. */
export const BUNDLE_MIN_EDGES = 60;
/** How far toward the cluster centroid an edge is pulled. All the way would
 *  route every link through a single point and lose the graph's shape. */
const STRENGTH = 0.6;

type Point = { x: number; y: number };

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/**
 * Cluster node positions, seeded from the best-connected genes.
 *
 * Spatial rather than semantic on purpose: bundling is a drawing operation, so
 * what matters is which parts of the canvas an edge runs between, not which
 * regulon it belongs to. Seeding on degree puts the initial centroids on the
 * hubs, which is where the traffic already converges, so four passes are
 * plenty.
 */
function clusterPositions(cy: Core) {
  const nodes = cy.nodes().toArray();
  if (nodes.length < 12) return null;
  const k = clamp(Math.round(Math.sqrt(nodes.length) / 1.5), 2, 12);

  const seeds = [...nodes]
    .sort((a, b) => b.degree(false) - a.degree(false))
    .slice(0, k)
    .map((node) => ({ ...node.position() }));
  if (seeds.length < 2) return null;

  const assignment = new Map<string, number>();
  for (let pass = 0; pass < 4; pass += 1) {
    nodes.forEach((node) => {
      const p = node.position();
      let best = 0;
      let bestDistance = Infinity;
      seeds.forEach((seed, index) => {
        const distance = (p.x - seed.x) ** 2 + (p.y - seed.y) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      assignment.set(node.id(), best);
    });
    const sums = seeds.map(() => ({ x: 0, y: 0, n: 0 }));
    nodes.forEach((node) => {
      const bucket = sums[assignment.get(node.id()) ?? 0];
      const p = node.position();
      bucket.x += p.x;
      bucket.y += p.y;
      bucket.n += 1;
    });
    sums.forEach((bucket, index) => {
      if (bucket.n > 0) {
        seeds[index] = { x: bucket.x / bucket.n, y: bucket.y / bucket.n };
      }
    });
  }
  return { assignment, centroids: seeds as Point[] };
}

/**
 * Express a point as Cytoscape's control-point pair: how far along the
 * source-to-target line it sits, and how far off that line it lies.
 */
function asControlPoint(source: Point, target: Point, via: Point) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  const ux = dx / length;
  const uy = dy / length;
  const rx = via.x - source.x;
  const ry = via.y - source.y;
  return {
    weight: clamp((rx * ux + ry * uy) / length, 0.12, 0.88),
    // Perpendicular component, signed so the curve bows to the side the
    // centroid is actually on.
    // Capped well short of the edge's own length. Allowed to run further, a
    // trunk stops being a bundle of links and becomes a swirl -- the shape
    // reads as decoration and you lose which regions it actually connects.
    distance: clamp(rx * -uy + ry * ux, -length * 0.45, length * 0.45),
    length,
  };
}

/** A stable pseudo-random sign, so edges inside one cluster fan out instead of
 *  stacking on the same arc. */
function hashSign(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return hash % 2 === 0 ? 1 : -1;
}

export function applyEdgeBundling(cy: Core) {
  if (cy.destroyed()) return false;
  const clusters = clusterPositions(cy);
  if (!clusters) return false;
  const { assignment, centroids } = clusters;

  cy.batch(() => {
    cy.edges().forEach((edge: EdgeSingular) => {
      const source = edge.source() as NodeSingular;
      const target = edge.target() as NodeSingular;
      const sp = source.position();
      const tp = target.position();
      const sc = assignment.get(source.id());
      const tc = assignment.get(target.id());

      if (sc === undefined || tc === undefined) return;

      // A spoke to a leaf is drawn dead straight, always. Bowing it is what
      // turned a sparse graph into a field of wandering tendrils: in the
      // figures worth copying, a hub's leaves radiate on straight lines and it
      // is that regularity -- a clean fan at one radius -- that makes a corona
      // read as a single object rather than as loose hairs.
      if (source.degree(false) <= 1 || target.degree(false) <= 1) {
        edge.data("bundleDistances", [0]);
        edge.data("bundleWeights", [0.5]);
        return;
      }

      if (sc === tc) {
        // Inside one cluster there is no trunk to join, so a gentle bow keeps
        // parallel links apart without pretending they travel together.
        const length = Math.hypot(tp.x - sp.x, tp.y - sp.y);
        edge.data("bundleDistances", [0.07 * length * hashSign(edge.id())]);
        edge.data("bundleWeights", [0.5]);
        return;
      }

      const first = asControlPoint(sp, tp, centroids[sc]);
      const second = asControlPoint(sp, tp, centroids[tc]);
      if (!first || !second) return;

      const pair = [
        { w: first.weight, d: first.distance * STRENGTH },
        { w: second.weight, d: second.distance * STRENGTH },
      ].sort((a, b) => a.w - b.w);

      edge.data("bundleDistances", [pair[0].d, pair[1].d]);
      edge.data("bundleWeights", [pair[0].w, pair[1].w]);
    });
  });
  return true;
}

export function clearEdgeBundling(cy: Core) {
  if (cy.destroyed()) return;
  cy.batch(() => {
    cy.edges().forEach((edge: EdgeSingular) => {
      if (edge.data("bundleDistances") === undefined) return;
      edge.removeData("bundleDistances");
      edge.removeData("bundleWeights");
    });
  });
}

/** Bundling earns its cost only on a dense graph seen whole, with nothing
 *  selected -- the moment the reader picks something out, they need to follow
 *  its actual links. */
export function shouldBundle(cy: Core) {
  return (
    cy.edges().length >= BUNDLE_MIN_EDGES &&
    cy.zoom() <= BUNDLE_MAX_ZOOM &&
    cy.elements(".traced, .traced-neighbour").empty()
  );
}
