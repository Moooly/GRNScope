import type { NetworkEdge } from "../networkGraphTypes";

export type DistributionEntry = { edge: NetworkEdge; value: number };
export type Distribution = { key: string; name: string; color: string; domain: [number, number]; bins: DistributionEntry[][]; total: number };

export function edgeDistributions(edges: NetworkEdge[]): Distribution[] {
  const scores = edges.filter(e => Number.isFinite(e.score)).map(edge => ({ edge, value: edge.score }));
  const confidence = edges.filter(e => e.bootstrapVerified && Number.isFinite(e.confidence)).map(edge => ({ edge, value: edge.confidence }));
  const bin = (key: string, name: string, color: string, domain: [number, number], entries: DistributionEntry[]): Distribution => {
    const bins: DistributionEntry[][] = Array.from({ length: 12 }, () => []);
    for (const entry of entries) bins[Math.min(11, Math.max(0, Math.floor((entry.value - domain[0]) / (domain[1] - domain[0]) * 12 + 1e-9)))].push(entry);
    return { key, name, color, domain, bins, total: entries.length };
  };
  return [bin("e", "Evidence", "#287bb7", [0, 1], scores), bin("c", "Confidence", "#df8641", [0, 1], confidence)];
}

export function countAxis(distributions: Distribution[]) {
  const peak = Math.max(1, ...distributions.flatMap(d => d.bins.map(bin => bin.length)));
  const rough = peak / 3, power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].find(n => n * power >= rough)! * power);
  return { step, max: Math.ceil(peak / step) * step };
}
