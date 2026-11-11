import type { NetworkEdge } from "../_components/networkGraphTypes";
import { displayEndpoints, hasDirection } from "../_components/networkVisualEncoding";

export type ElasticNetCoefficient = { source: string; target: string; beta: number | null; reason: string | null };
export const elasticPairKey = (source: string, target: string) => JSON.stringify([source, target]);

export function elasticNetPairs(candidates: NetworkEdge[]) {
  const pairs = new Map<string, { source: string; target: string }>();
  for (const edge of candidates) {
    const { source, target } = displayEndpoints(edge);
    pairs.set(elasticPairKey(source, target), { source, target });
    if (!hasDirection(edge)) pairs.set(elasticPairKey(target, source), { source: target, target: source });
  }
  return [...pairs.values()].sort((a, b) => elasticPairKey(a.source, a.target).localeCompare(elasticPairKey(b.source, b.target)));
}

export function attachElasticCoefficients<E extends NetworkEdge>(edges: E[], coefficients: Map<string, ElasticNetCoefficient>): E[] {
  return edges.map(edge => {
    const { source, target } = displayEndpoints(edge);
    const forward = coefficients.get(elasticPairKey(source, target));
    const reverse = !hasDirection(edge) ? coefficients.get(elasticPairKey(target, source)) : undefined;
    return { ...edge, elasticNetBeta: forward?.beta, elasticNetReverseBeta: reverse?.beta,
      elasticNetReason: forward?.reason ?? reverse?.reason ?? undefined };
  });
}
