import type { AggregatedEdge, BenchmarkMetrics } from "./types";

export function parseGroundTruthCsv(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const edges = new Set<string>();

  lines.forEach((line, index) => {
    const parts = line.split(/[\t,]/).map((part) => part.trim());
    if (parts.length < 2) return;

    const source = parts[0];
    const target = parts[1];

    const lowerSource = source.toLowerCase();
    const lowerTarget = target.toLowerCase();
    const isHeaderLike =
      index === 0 &&
      ((lowerSource.includes("source") ||
        lowerSource.includes("tf") ||
        lowerSource.includes("regulator")) &&
        (lowerTarget.includes("target") || lowerTarget.includes("gene")));

    if (isHeaderLike || !source || !target) return;
    edges.add(`${source}|||${target}`);
  });

  return edges;
}

export function computeBenchmarkMetrics(
  methodId: string,
  rows: AggregatedEdge[],
  groundTruthEdges: Set<string>,
  baselineUniverseSize: number
): BenchmarkMetrics {
  const rankedRows = [...rows].sort((a, b) => b.score - a.score);
  const totalGroundTruth = groundTruthEdges.size;

  if (rankedRows.length === 0 || totalGroundTruth === 0) {
    return {
      methodId,
      evaluatedEdges: rankedRows.length,
      positivesFound: 0,
      precision: 0,
      recall: 0,
      auprc: 0,
      auprcRatio: 0,
    };
  }

  let tp = 0;
  let fp = 0;
  let prevRecall = 0;
  let area = 0;

  rankedRows.forEach((edge) => {
    const key = `${edge.source}|||${edge.target}`;
    if (groundTruthEdges.has(key)) {
      tp += 1;
    } else {
      fp += 1;
    }

    const precision = tp / (tp + fp);
    const recall = tp / totalGroundTruth;
    area += (recall - prevRecall) * precision;
    prevRecall = recall;
  });

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = totalGroundTruth > 0 ? tp / totalGroundTruth : 0;
  const randomBaseline =
    baselineUniverseSize > 0 ? totalGroundTruth / baselineUniverseSize : 0;

  return {
    methodId,
    evaluatedEdges: rankedRows.length,
    positivesFound: tp,
    precision,
    recall,
    auprc: area,
    auprcRatio: randomBaseline > 0 ? area / randomBaseline : 0,
  };
}