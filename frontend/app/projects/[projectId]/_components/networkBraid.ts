import type { NetworkEdge } from "./networkGraphTypes";

/** Pale strand hues, in the spirit of the Cytoscape.js fCoSE gene demo where
 * each thread is one evidence source. Here one thread is one method. */
export const STRAND_COLORS = [
  "#8e6fa0",
  "#5a7bc4",
  "#3fa3ad",
  "#d06f6f",
  "#d99a3c",
  "#a79b45",
  "#6aa860",
  "#c07d9a",
  "#5f9a91",
  "#a8874f",
  "#7b88c9",
  "#c4825f",
];

/** Assign one hue per method by index over the sorted set of methods present,
 * so colours stay distinct (a hash collides well before the palette is full)
 * and stable for a given selection of methods. Build this from the *whole*
 * edge set, never from one edge, or a method changes colour between clicks. */
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

/** Perpendicular gap between neighbouring threads, in model units. Only one
 * relationship is ever braided at a time, so the fan can be generous. */
export const STRAND_SPACING = 5.4;
/** Keeps the fan straddling the consensus line so a single thread is still
 * visible beside it rather than hidden exactly underneath. */
export const STRAND_INNER_GAP = 3.4;

export type StrandElement = {
  classes: string;
  data: Record<string, string | number>;
};

/**
 * Fan one relationship into a thread per supporting method.
 *
 * This is a selection-only detail, not the resting state of the graph: drawing
 * every relationship's cable at once made agreement compete with every other
 * channel and buried the consensus edge. At rest support is carried by the
 * consensus edge's stepped width; the braid is what you get when you ask a
 * single relationship "who says so?".
 */
export function buildStrandElements(
  edge: NetworkEdge,
  palette: Map<string, string>,
): StrandElement[] {
  const total = edge.supportingAlgorithms.length;
  if (total === 0) return [];
  return edge.supportingAlgorithms.map((algorithm, index) => {
    // Symmetric fan that straddles the consensus line.
    const raw = index - (total - 1) / 2;
    const direction = raw >= 0 ? 1 : -1;
    const offset =
      direction * (Math.abs(raw) * STRAND_SPACING + STRAND_INNER_GAP);
    return {
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
    };
  });
}
