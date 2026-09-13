import type { EdgeSingular, LayoutOptions, NodeSingular } from "cytoscape";
import {
  edgeElasticityFor,
  edgeLengthFactor,
  meanNodeDiameterModel,
} from "./encoding";

/**
 * One force layout, tuned continuously by graph size -- and, more importantly,
 * given two length scales instead of one.
 *
 * A force layout with a single ideal edge length can only produce an even
 * fabric: every node ends up about the same distance from its neighbours, so a
 * hub with twenty leaves looks like twenty nodes in a row rather than a hub
 * with twenty leaves. That is why our hundred-gene view read as a mesh while
 * the reference figures read as objects with space between them.
 *
 * Those figures have a corona-and-filament structure. Leaves press in tight
 * against the hub they hang off, forming a disc you perceive as one thing; the
 * links between hubs stretch long and become the filaments those discs sit on.
 * Both come out of the same rule -- an edge's ideal length depends on how
 * connected its *less* connected endpoint is -- applied per edge rather than
 * once for the whole graph.
 *
 * The bounding box matters for the same reason. fCoSE lays out into a square
 * by default, so a graph drawn for a wide panel gets fitted down to the height
 * and leaves the sides empty. Handing it the canvas's own shape is what lets a
 * network spread across the width the way the BRCA1 figure does.
 */

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

const minEndpointDegree = (edge: EdgeSingular) =>
  Math.min(edge.source().degree(false), edge.target().degree(false));

export function forceLayoutOptions(
  nodeCount: number,
  canvas: { width: number; height: number },
  onStop: () => void,
): LayoutOptions {
  const n = Math.max(1, nodeCount);
  const root = Math.sqrt(n);
  const node = meanNodeDiameterModel();

  // Spacing as multiples of the node size, so the extent scales with the nodes
  // and fitting lands the same disc-to-canvas ratio at any gene count.
  const spacing = clamp(1.1 + 9 / root, 1.35, 5);
  const base = node * spacing;
  const repulsion = clamp(3000 + 40000 / root, 4200, 24000);
  const gravity = clamp(0.3 - n / 9000, 0.06, 0.3);

  // Lay out into the shape the reader will actually see.
  const aspect = clamp(
    canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : 1.6,
    1,
    2.6,
  );
  const side = base * Math.sqrt(n) * 1.6;

  return {
    name: "fcose",
    animate: false,
    quality: n <= 400 ? "proof" : "default",
    randomize: true,
    // Disconnected pieces get packed instead of flung to the corners. Without
    // this the extent is mostly empty space, the fit zoom collapses, and every
    // node renders as grit.
    packComponents: true,
    nodeDimensionsIncludeLabels: true,
    uniformNodeDimensions: false,
    boundingBox: {
      x1: 0,
      y1: 0,
      w: side * Math.sqrt(aspect),
      h: side / Math.sqrt(aspect),
    },
    idealEdgeLength: (edge: EdgeSingular) =>
      base * edgeLengthFactor(minEndpointDegree(edge)),
    edgeElasticity: (edge: EdgeSingular) =>
      edgeElasticityFor(minEndpointDegree(edge)),
    nodeSeparation: node * 0.9,
    // Hubs push hard so coronas keep clear of each other; leaves push gently so
    // a corona can close up around its hub instead of spraying outward.
    nodeRepulsion: (item: NodeSingular) => {
      const degree = item.degree(false);
      const weight = clamp(Math.sqrt(Math.max(0, degree)) / 4, 0, 1);
      return repulsion * (0.55 + 1.15 * weight);
    },
    gravity,
    gravityRange: 3.4,
    numIter: n <= 400 ? 2600 : n <= 1500 ? 1800 : 1200,
    tile: true,
    stop: onStop,
  } as unknown as LayoutOptions;
}
