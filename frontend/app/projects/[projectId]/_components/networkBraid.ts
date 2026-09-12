import type { NetworkEdge } from "./networkGraphTypes";

/** Pale strand hues, in the spirit of the Cytoscape.js fCoSE gene demo where
 * each thread is one evidence source. Here one thread is one method. */
export const STRAND_COLORS = [
  "#d0b7d5",
  "#a0b3dc",
  "#9bd8de",
  "#eaa2a2",
  "#f6c384",
  "#dad4a2",
  "#b3d3a8",
  "#e2b6c9",
  "#9fc9c2",
  "#d8c39c",
  "#bcc6e6",
  "#e8b9a0",
];

/** Assign one hue per method by index over the sorted set of methods present,
 * so colours stay distinct (a hash collides well before the palette is full)
 * and stable for a given selection of methods. */
export function strandPalette(edges: NetworkEdge[]): Map<string, string> {
  const methods = [
    ...new Set(edges.flatMap((edge) => edge.supportingAlgorithms)),
  ].sort();
  return new Map(
    methods.map((method, index) => [
      method,
      STRAND_COLORS[index % STRAND_COLORS.length],
    ]),
  );
}

export function strandTotal(edges: NetworkEdge[]): number {
  return edges.reduce(
    (sum, edge) => sum + Math.max(0, edge.supportingAlgorithms.length),
    0,
  );
}

/** Above this the braid is dropped and the consensus edge carries support on
 * its own (opacity), so large runs stay interactive. */
export const STRAND_BUDGET = 2600;

export type StrandElement = {
  classes: string;
  data: Record<string, string | number>;
};

/** One translucent thread per supporting method, drawn parallel to the
 * consensus edge. Agreement therefore reads as the thickness of the braid. */
/** Perpendicular gap between neighbouring threads, in model units. */
export const STRAND_SPACING = 3.8;

export function buildStrandElements(edges: NetworkEdge[]): StrandElement[] {
  if (strandTotal(edges) > STRAND_BUDGET) return [];
  const palette = strandPalette(edges);
  const incident = new Map<string, number>();
  edges.forEach((edge) => {
    incident.set(edge.source, (incident.get(edge.source) ?? 0) + 1);
    incident.set(edge.target, (incident.get(edge.target) ?? 0) + 1);
  });
  const strands: StrandElement[] = [];
  edges.forEach((edge) => {
    const total = edge.supportingAlgorithms.length;
    // Narrow the cable where many of them converge on one gene, so hub
    // neighbourhoods stay readable instead of overlapping into a smear.
    const busiest = Math.max(
      incident.get(edge.source) ?? 1,
      incident.get(edge.target) ?? 1,
    );
    const spacing =
      STRAND_SPACING * Math.max(0.45, Math.min(1, 1 - (busiest - 4) * 0.06));
    edge.supportingAlgorithms.forEach((algorithm, index) => {
      // Symmetric fan around the consensus line: the braid widens with support.
      const offset = (index - (total - 1) / 2) * spacing;
      strands.push({
        classes: "strand",
        data: {
          id: `${edge.key}__strand__${index}`,
          source: edge.source,
          target: edge.target,
          strandColor: palette.get(algorithm) ?? STRAND_COLORS[0],
          strandOffset: offset,
          algorithm,
          parentEdge: edge.key,
        },
      });
    });
  });
  return strands;
}
