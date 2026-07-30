type BeelinePredictionEdge = {
  source: string;
  target: string;
  score?: number | null;
  mean_raw_score?: number | null;
  weight?: number | null;
  edge_weight?: number | null;
  perAlgorithmRawScores?: Record<string, number>;
};

export type BenchmarkCurvePoint = { x: number; y: number };
export type ReferenceSign = -1 | 0 | 1;

export type BeelineRankedEdge = {
  source: string;
  target: string;
  score: number;
  edge: BeelinePredictionEdge;
};

export type EarlyPrecisionMetric = {
  precision: number;
  ratio: number;
  selectedCount: number;
  referenceCount: number;
};

export type BeelineBenchmarkMetrics = {
  rankedEdges: BeelineRankedEdge[];
  nonzeroPredictionCount: number;
  auprc: number;
  auprcRatio: number;
  auroc: number;
  earlyPrecision: EarlyPrecisionMetric;
  activation: EarlyPrecisionMetric | null;
  inhibition: EarlyPrecisionMetric | null;
  pr: BenchmarkCurvePoint[];
  roc: BenchmarkCurvePoint[];
};

const KEY_SEPARATOR = "\u0000";

export function benchmarkEdgeKey(source: string, target: string) {
  return `${source}${KEY_SEPARATOR}${target}`;
}

export function normalizeReferenceSign(value?: string): ReferenceSign {
  const normalized = String(value ?? "").trim().toLowerCase();
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    if (numeric > 0) return 1;
    if (numeric < 0) return -1;
  }
  if (
    normalized === "+" ||
    normalized === "activation" ||
    normalized === "activating" ||
    normalized === "positive"
  ) {
    return 1;
  }
  if (
    normalized === "-" ||
    normalized === "inhibition" ||
    normalized === "inhibitory" ||
    normalized === "repression" ||
    normalized === "negative"
  ) {
    return -1;
  }
  return 0;
}

function rawEdgeScore(edge: BeelinePredictionEdge, algorithmId: string) {
  const algorithmScore = edge.perAlgorithmRawScores?.[algorithmId];
  const score = Number(
    algorithmScore ??
      edge.mean_raw_score ??
      edge.weight ??
      edge.edge_weight ??
      edge.score ??
      0,
  );
  return Number.isFinite(score) ? Math.abs(score) : 0;
}

export function buildBeelineRanking({
  algorithmId,
  edges,
  candidateGenes,
}: {
  algorithmId: string;
  edges: BeelinePredictionEdge[];
  candidateGenes: Set<string>;
}) {
  const bestByDirectedEdge = new Map<string, BeelineRankedEdge>();

  const addEdge = (
    source: string,
    target: string,
    score: number,
    edge: BeelinePredictionEdge,
  ) => {
    if (
      source === target ||
      !candidateGenes.has(source) ||
      !candidateGenes.has(target)
    ) {
      return;
    }
    const key = benchmarkEdgeKey(source, target);
    const current = bestByDirectedEdge.get(key);
    if (!current || score > current.score) {
      bestByDirectedEdge.set(key, { source, target, score, edge });
    }
  };

  edges.forEach((edge) => {
    const score = rawEdgeScore(edge, algorithmId);
    addEdge(edge.source, edge.target, score, edge);
  });

  return [...bestByDirectedEdge.values()].sort(
    (first, second) =>
      second.score - first.score ||
      first.source.localeCompare(second.source) ||
      first.target.localeCompare(second.target),
  );
}

function sampleCurve(
  points: BenchmarkCurvePoint[],
  maximumPoints = 220,
) {
  if (points.length <= maximumPoints) return points;
  const sampled: BenchmarkCurvePoint[] = [points[0]];
  const interiorCount = maximumPoints - 2;
  for (let index = 1; index <= interiorCount; index += 1) {
    const sourceIndex = Math.round(
      (index * (points.length - 1)) / (interiorCount + 1),
    );
    sampled.push(points[sourceIndex]);
  }
  sampled.push(points[points.length - 1]);
  return sampled;
}

function computeCurves({
  rankedEdges,
  truth,
  possibleEdges,
}: {
  rankedEdges: BeelineRankedEdge[];
  truth: Set<string>;
  possibleEdges: number;
}) {
  const positiveCount = truth.size;
  const negativeCount = possibleEdges - positiveCount;
  const groups = new Map<number, { truePositive: number; total: number }>();

  rankedEdges.forEach((edge) => {
    if (edge.score <= 0) return;
    const group = groups.get(edge.score) ?? { truePositive: 0, total: 0 };
    group.total += 1;
    if (truth.has(benchmarkEdgeKey(edge.source, edge.target))) {
      group.truePositive += 1;
    }
    groups.set(edge.score, group);
  });

  const pr: BenchmarkCurvePoint[] = [{ x: 0, y: 1 }];
  const roc: BenchmarkCurvePoint[] = [{ x: 0, y: 0 }];
  let selected = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let previousRecall = 0;
  let previousPrecision = 1;
  let previousFpr = 0;
  let previousTpr = 0;
  let auprc = 0;
  let auroc = 0;

  [...groups.entries()]
    .sort(([first], [second]) => second - first)
    .forEach(([, group]) => {
      selected += group.total;
      truePositive += group.truePositive;
      falsePositive += group.total - group.truePositive;
      const recall = positiveCount > 0 ? truePositive / positiveCount : 0;
      const precision = selected > 0 ? truePositive / selected : 1;
      const falsePositiveRate =
        negativeCount > 0 ? falsePositive / negativeCount : 0;
      const truePositiveRate = recall;

      auprc +=
        (recall - previousRecall) * ((previousPrecision + precision) / 2);
      auroc +=
        (falsePositiveRate - previousFpr) *
        ((previousTpr + truePositiveRate) / 2);
      pr.push({ x: recall, y: precision });
      roc.push({ x: falsePositiveRate, y: truePositiveRate });
      previousRecall = recall;
      previousPrecision = precision;
      previousFpr = falsePositiveRate;
      previousTpr = truePositiveRate;
    });

  if (selected < possibleEdges) {
    const recall = 1;
    const precision = positiveCount / possibleEdges;
    const falsePositiveRate = 1;
    const truePositiveRate = 1;
    auprc +=
      (recall - previousRecall) * ((previousPrecision + precision) / 2);
    auroc +=
      (falsePositiveRate - previousFpr) *
      ((previousTpr + truePositiveRate) / 2);
    pr.push({ x: recall, y: precision });
    roc.push({ x: falsePositiveRate, y: truePositiveRate });
  }

  return {
    auprc,
    auroc,
    pr: sampleCurve(pr),
    roc: sampleCurve(roc),
  };
}

function computeEarlyPrecision({
  rankedEdges,
  truth,
  possibleEdges,
}: {
  rankedEdges: BeelineRankedEdge[];
  truth: Set<string>;
  possibleEdges: number;
}): EarlyPrecisionMetric {
  const referenceCount = truth.size;
  if (!referenceCount || !possibleEdges) {
    return {
      precision: 0,
      ratio: 0,
      selectedCount: 0,
      referenceCount,
    };
  }

  const nonzero = rankedEdges.filter((edge) => edge.score > 0);
  if (!nonzero.length) {
    return {
      precision: 0,
      ratio: 0,
      selectedCount: 0,
      referenceCount,
    };
  }

  const cutoffIndex = Math.min(referenceCount, nonzero.length) - 1;
  const cutoff = nonzero[cutoffIndex].score;
  const selected = nonzero.filter((edge) => edge.score >= cutoff);
  const truePositive = selected.filter((edge) =>
    truth.has(benchmarkEdgeKey(edge.source, edge.target)),
  ).length;
  const precision = truePositive / selected.length;
  const randomBaseline = referenceCount / possibleEdges;

  return {
    precision,
    ratio: randomBaseline > 0 ? precision / randomBaseline : 0,
    selectedCount: selected.length,
    referenceCount,
  };
}

function computeSignedEarlyPrecision({
  rankedEdges,
  truthSigns,
  sign,
  possibleEdges,
}: {
  rankedEdges: BeelineRankedEdge[];
  truthSigns: Map<string, ReferenceSign>;
  sign: -1 | 1;
  possibleEdges: number;
}): EarlyPrecisionMetric | null {
  const trueEdges = new Set(
    [...truthSigns.entries()]
      .filter(([, value]) => value === sign)
      .map(([key]) => key),
  );
  if (!trueEdges.size || !possibleEdges) return null;

  const oppositeSign = sign === 1 ? -1 : 1;
  const candidates = rankedEdges.filter(
    (edge) =>
      truthSigns.get(benchmarkEdgeKey(edge.source, edge.target)) !==
      oppositeSign,
  );
  return computeEarlyPrecision({
    rankedEdges: candidates,
    truth: trueEdges,
    possibleEdges,
  });
}

export function computeBeelineBenchmarkMetrics({
  algorithmId,
  edges,
  candidateGenes,
  truth,
  truthSigns,
  possibleEdges,
}: {
  algorithmId: string;
  edges: BeelinePredictionEdge[];
  candidateGenes: Set<string>;
  truth: Set<string>;
  truthSigns: Map<string, ReferenceSign>;
  possibleEdges: number;
}): BeelineBenchmarkMetrics {
  const rankedEdges = buildBeelineRanking({
    algorithmId,
    edges,
    candidateGenes,
  });
  const curves = computeCurves({ rankedEdges, truth, possibleEdges });
  const randomBaseline = truth.size / possibleEdges;

  return {
    rankedEdges,
    nonzeroPredictionCount: rankedEdges.filter((edge) => edge.score > 0).length,
    auprc: curves.auprc,
    auprcRatio:
      randomBaseline > 0 ? curves.auprc / randomBaseline : 0,
    auroc: curves.auroc,
    earlyPrecision: computeEarlyPrecision({
      rankedEdges,
      truth,
      possibleEdges,
    }),
    activation: computeSignedEarlyPrecision({
      rankedEdges,
      truthSigns,
      sign: 1,
      possibleEdges,
    }),
    inhibition: computeSignedEarlyPrecision({
      rankedEdges,
      truthSigns,
      sign: -1,
      possibleEdges,
    }),
    pr: curves.pr,
    roc: curves.roc,
  };
}
