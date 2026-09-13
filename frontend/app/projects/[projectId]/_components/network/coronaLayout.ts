import type { Collection, Core, LayoutOptions, NodeSingular } from "cytoscape";
import { meanNodeDiameterModel } from "./encoding";

/**
 * Corona layout.
 *
 * The reference figure does something a force layout cannot do on its own, and
 * this is the whole difference between it and every version we have tried: the
 * leaves hanging off a hub are not scattered around it, they sit on a clean arc
 * facing away from the centre of the graph, all at the same radius. That
 * regularity is what makes a hub and its twenty leaves read as one object --
 * a rosette you perceive whole -- instead of twenty separate dots that happen
 * to be nearby. Handed to a force solver, the same twenty leaves come out at
 * twenty different distances and angles, and the result looks like a tangle of
 * hairs no matter how the constants are tuned.
 *
 * So the graph is laid out in two passes with different tools:
 *
 *   1. The core -- everything with more than one connection -- goes to fCoSE.
 *      This is the part where the structure is genuinely relational and a
 *      force solver is the right instrument. It is also far smaller than the
 *      whole graph, often by four fifths, so it settles faster and cleaner.
 *
 *   2. The leaves are placed by construction, on arcs around their hub. No
 *      solver, no iteration, no chance of a leaf ending up on the wrong side.
 *
 * While the core is being solved each hub is temporarily inflated to the size
 * of the corona it is about to grow, so fCoSE keeps its neighbours far enough
 * away to leave room. Without that the coronas overlap and the whole point is
 * lost.
 */

/** Angular spacing between neighbouring leaves. Tight enough to read as one
 *  arc, loose enough that the labels below them do not collide. */
const LEAF_STEP = 0.26;
/** No corona wraps further than this, so it always reads as facing outward. */
const MAX_SPREAD = Math.PI * 1.35;

type Point = { x: number; y: number };

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/** Radius of the arc a hub's leaves sit on: whatever it takes to fit them at
 *  LEAF_STEP spacing, never closer than the hub's own edge. */
function coronaRadius(leafCount: number, hubDiameter: number, leafDiameter: number) {
  if (leafCount <= 0) return 0;
  const spread = Math.min(MAX_SPREAD, Math.max(0.5, (leafCount - 1) * LEAF_STEP));
  const needed = leafCount * (leafDiameter * 1.6);
  const fromArc = leafCount > 1 ? needed / spread : 0;
  // Far enough out that the spokes are visible as spokes. Packed against the
  // hub the leaves read as a fringe on it; at this distance the hub, the
  // spokes and the ring of leaves are three things you can see separately.
  return Math.max(hubDiameter * 0.85 + leafDiameter * 2.8, fromArc);
}

export type CoronaPlan = {
  core: Collection;
  leavesOf: Map<string, NodeSingular[]>;
  orphans: NodeSingular[];
};

/** Split the graph into the part a force solver should see and the part that
 *  should be drawn by construction. */
export function planCorona(cy: Core): CoronaPlan {
  const leavesOf = new Map<string, NodeSingular[]>();
  const orphans: NodeSingular[] = [];
  let core = cy.collection();

  cy.nodes().forEach((node) => {
    const degree = node.degree(false);
    if (degree === 0) {
      orphans.push(node);
      return;
    }
    if (degree === 1) {
      const hub = node.connectedEdges().connectedNodes().difference(node)[0];
      // A leaf whose only neighbour is itself a leaf is a lone pair; there is
      // no hub to orbit, so both stay in the core and the solver places them.
      if (hub && hub.degree(false) > 1) {
        const list = leavesOf.get(hub.id()) ?? [];
        list.push(node);
        leavesOf.set(hub.id(), list);
        return;
      }
    }
    core = core.union(node);
  });

  return { core: core.union(core.edgesWith(core)), leavesOf, orphans };
}

/** fCoSE options for the core only. */
export function coreLayoutOptions(
  coreCount: number,
  canvas: { width: number; height: number },
  onStop: () => void,
): LayoutOptions {
  const n = Math.max(1, coreCount);
  const root = Math.sqrt(n);
  const node = meanNodeDiameterModel();
  const spacing = clamp(1.2 + 7 / root, 1.5, 4.2);
  const base = node * spacing;
  const aspect = clamp(
    canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : 1.7,
    1,
    2.6,
  );
  const side = base * Math.sqrt(n) * 1.5;

  return {
    name: "fcose",
    animate: false,
    quality: n <= 300 ? "proof" : "default",
    randomize: true,
    packComponents: true,
    nodeDimensionsIncludeLabels: false,
    uniformNodeDimensions: false,
    boundingBox: {
      x1: 0,
      y1: 0,
      w: side * Math.sqrt(aspect),
      h: side / Math.sqrt(aspect),
    },
    idealEdgeLength: () => base,
    edgeElasticity: () => 0.35,
    nodeSeparation: node * 1.1,
    nodeRepulsion: () => clamp(4500 + 42000 / root, 5000, 26000),
    gravity: clamp(0.28 - n / 6000, 0.05, 0.28),
    gravityRange: 3.6,
    numIter: n <= 300 ? 2800 : 1800,
    tile: true,
    stop: onStop,
  } as unknown as LayoutOptions;
}

/**
 * Inflate each hub to the footprint of the corona it will grow, so the solver
 * reserves the space. Returns a restore function.
 */
export function reserveCoronaSpace(plan: CoronaPlan, leafDiameter: number) {
  const saved: Array<{ node: NodeSingular; w: number; h: number }> = [];
  plan.leavesOf.forEach((leaves, hubId) => {
    const hub = plan.core.getElementById(hubId) as NodeSingular | undefined;
    if (!hub || hub.empty?.()) return;
    const diameter = hub.width();
    const radius = coronaRadius(leaves.length, diameter, leafDiameter);
    saved.push({ node: hub, w: hub.width(), h: hub.height() });
    hub.style({ width: radius * 2, height: radius * 2 });
  });
  return () => saved.forEach(({ node, w, h }) => node.style({ width: w, height: h }));
}

/**
 * Place every leaf on its hub's arc, and park anything with no connections at
 * all in a tidy block below the graph rather than letting it drift through it.
 */
export function placeCoronas(cy: Core, plan: CoronaPlan, leafDiameter: number) {
  const core = plan.core.nodes();
  if (core.empty()) return;

  const box = core.boundingBox();
  const centre: Point = { x: box.x1 + box.w / 2, y: box.y1 + box.h / 2 };

  cy.batch(() => {
    plan.leavesOf.forEach((leaves, hubId) => {
      const hub = cy.getElementById(hubId);
      if (hub.empty()) return;
      const origin = hub.position();

      // Outward: directly away from the middle of the graph, so a corona never
      // points back through the structure it belongs to. Hubs sitting exactly
      // at the centre get an angle derived from their id, which is arbitrary
      // but stable across re-layouts.
      let ax = origin.x - centre.x;
      let ay = origin.y - centre.y;
      if (Math.hypot(ax, ay) < 1) {
        const seed = hubId.charCodeAt(0) + hubId.length;
        ax = Math.cos(seed);
        ay = Math.sin(seed);
      }
      const facing = Math.atan2(ay, ax);

      const count = leaves.length;
      const spread = Math.min(MAX_SPREAD, Math.max(0.5, (count - 1) * LEAF_STEP));
      const radius = coronaRadius(count, hub.width(), leafDiameter);
      const step = count > 1 ? spread / (count - 1) : 0;
      const start = facing - spread / 2;

      // Stable order, so the same gene keeps its place on the arc between runs.
      [...leaves]
        .sort((a, b) => a.id().localeCompare(b.id()))
        .forEach((leaf, index) => {
          const angle = count > 1 ? start + index * step : facing;
          leaf.position({
            x: origin.x + Math.cos(angle) * radius,
            y: origin.y + Math.sin(angle) * radius,
          });
        });
    });

    if (plan.orphans.length) {
      const perRow = Math.max(4, Math.ceil(Math.sqrt(plan.orphans.length) * 1.6));
      const gap = leafDiameter * 3.2;
      const top = box.y2 + gap * 2;
      const left = centre.x - ((Math.min(perRow, plan.orphans.length) - 1) * gap) / 2;
      plan.orphans.forEach((node, index) => {
        node.position({
          x: left + (index % perRow) * gap,
          y: top + Math.floor(index / perRow) * gap,
        });
      });
    }
  });
}
