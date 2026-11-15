export type ElasticNetPair = { source: string; target: string };
export type ElasticNetCoefficient = ElasticNetPair & { beta: number | null; reason: string | null };
export const elasticPairKey = (source: string, target: string) => JSON.stringify([source, target]);

/** Trajectory arrows already specify regulator → target; never add a reverse fit. */
export function elasticNetPairs(candidates: ElasticNetPair[]) {
  const pairs = new Map<string, { source: string; target: string }>();
  for (const { source, target } of candidates) {
    if (source !== target) pairs.set(elasticPairKey(source, target), { source, target });
  }
  return [...pairs.values()].sort((a, b) => elasticPairKey(a.source, a.target).localeCompare(elasticPairKey(b.source, b.target)));
}

export const betaText = (value: number | null | undefined) => typeof value !== "number" || !Number.isFinite(value) ? "—"
  : value === 0 ? "0.000" : Math.abs(value) < 0.001 ? value.toExponential(2) : `${value > 0 ? "+" : ""}${value.toFixed(3)}`;
