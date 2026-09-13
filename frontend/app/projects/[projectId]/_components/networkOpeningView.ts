import type { NetworkEdge } from "./networkGraphTypes";

/**
 * What the network shows before anyone touches a control.
 *
 * The thresholds in Results Settings answer "is this relationship credible?",
 * which is a question about one edge and cannot know how many other edges
 * passed. At 19 genes they admitted 70; at 100 genes the identical settings
 * admitted 750, seven and a half per gene, and no amount of restyling makes a
 * mesh that dense legible. So the opening view takes a budget as well: the
 * strongest relationships up to a readable density, with everything else one
 * click away rather than silently gone.
 */

/** Relationships per gene. Past roughly this, individual links stop being
 *  followable and the picture reads as texture. */
export const EDGES_PER_GENE = 1.15;
/** An absolute ceiling, so a 5000-gene upload cannot ask for 11,000 edges. */
export const MAX_OPENING_EDGES = 400;

export function openingEdgeBudget(geneCount: number) {
  return Math.min(MAX_OPENING_EDGES, Math.max(12, Math.round(geneCount * EDGES_PER_GENE)));
}

type RankableEdge = Pick<
  NetworkEdge,
  "supportingAlgorithms" | "confidence" | "score"
>;

function support(edge: RankableEdge) {
  return edge.supportingAlgorithms?.length ?? 0;
}

function strength(edge: RankableEdge) {
  const value = Number(edge.confidence ?? edge.score);
  return Number.isFinite(value) ? value : 0;
}

export type OpeningView<T> = {
  edges: T[];
  shown: number;
  total: number;
  /** True when the budget actually removed something. */
  trimmed: boolean;
};

/**
 * Rank by how many methods agree, then by how strongly, and keep the top of
 * that list. Method agreement leads because it is the one signal that is
 * comparable across algorithms -- a single method's score is only meaningful
 * against its own distribution, while three methods agreeing means the same
 * thing whatever the three were.
 */
export function selectOpeningEdges<T extends RankableEdge>(
  edges: T[],
  geneCount: number,
  showAll: boolean,
): OpeningView<T> {
  const total = edges.length;
  if (showAll) return { edges, shown: total, total, trimmed: false };
  const budget = openingEdgeBudget(geneCount);
  if (total <= budget) return { edges, shown: total, total, trimmed: false };
  const ranked = [...edges].sort(
    (a, b) => support(b) - support(a) || strength(b) - strength(a),
  );
  const kept = ranked.slice(0, budget);
  return { edges: kept, shown: kept.length, total, trimmed: true };
}
