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

/* ------------------------------------------------------------------ */
/* Uncertainty and consensus                                           */
/* ------------------------------------------------------------------ */

/** Small deterministic PRNG so intervals do not change between renders. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Trapezoidal AUPRC over score groups, the same estimator as computeCurves,
 * with a weight per candidate pair (bootstrap multiplicity). Pairs not in
 * `ranked` (unscored) form the tail that closes the curve at recall 1.
 */
function weightedAuprc(
  groups: Array<{ truth: number[]; other: number[] }>,
  weight: Float64Array,
  positiveIndex: number[],
  totalWeight: number,
) {
  let positives = 0;
  positiveIndex.forEach((index) => {
    positives += weight[index];
  });
  if (!positives) return null;
  let selected = 0;
  let truePositive = 0;
  let previousRecall = 0;
  let previousPrecision = 1;
  let auprc = 0;
  for (const group of groups) {
    let groupTrue = 0;
    let groupTotal = 0;
    group.truth.forEach((index) => {
      groupTrue += weight[index];
    });
    group.other.forEach((index) => {
      groupTotal += weight[index];
    });
    groupTotal += groupTrue;
    if (!groupTotal) continue;
    selected += groupTotal;
    truePositive += groupTrue;
    const recall = truePositive / positives;
    const precision = truePositive / selected;
    auprc += (recall - previousRecall) * ((previousPrecision + precision) / 2);
    previousRecall = recall;
    previousPrecision = precision;
  }
  if (selected < totalWeight) {
    const precision = positives / totalWeight;
    auprc += (1 - previousRecall) * ((previousPrecision + precision) / 2);
  }
  return { auprc, baseline: positives / totalWeight };
}

export type AuprcUncertainty = {
  /** 95% percentile bootstrap interval of the AUPRC ratio. */
  ci: [number, number];
  /** One-sided permutation p-value against random rankings. */
  pValue: number;
  bootstrapReps: number;
  permutationReps: number;
};

/**
 * Bootstrap over candidate gene pairs (resampled with replacement, rankings
 * kept) for a 95% interval of the AUPRC ratio, and a permutation test that
 * places the same number of scored edges at random. Repetitions shrink for
 * very large candidate sets to keep the page responsive.
 */
export function auprcUncertainty({
  rankedEdges,
  truth,
  candidateGenes,
  seed = 1,
}: {
  rankedEdges: BeelineRankedEdge[];
  truth: Set<string>;
  candidateGenes: Set<string>;
  seed?: number;
}): AuprcUncertainty | null {
  const genes = [...candidateGenes].sort();
  const pairs: string[] = [];
  genes.forEach((source) =>
    genes.forEach((target) => {
      if (source !== target) pairs.push(benchmarkEdgeKey(source, target));
    }),
  );
  const total = pairs.length;
  if (!total || !truth.size) return null;
  const indexOf = new Map(pairs.map((key, index) => [key, index]));
  const positiveIndex = pairs.map((key, index) => (truth.has(key) ? index : -1)).filter((index) => index >= 0);

  const scored = rankedEdges.filter((edge) => edge.score > 0);
  const byScore = new Map<number, { truth: number[]; other: number[] }>();
  scored.forEach((edge) => {
    const index = indexOf.get(benchmarkEdgeKey(edge.source, edge.target));
    if (index === undefined) return;
    const group = byScore.get(edge.score) ?? { truth: [], other: [] };
    (truth.has(pairs[index]) ? group.truth : group.other).push(index);
    byScore.set(edge.score, group);
  });
  const groups = [...byScore.entries()].sort(([a], [b]) => b - a).map(([, group]) => group);

  const ones = new Float64Array(total).fill(1);
  const observed = weightedAuprc(groups, ones, positiveIndex, total);
  if (!observed) return null;
  const observedRatio = observed.auprc / observed.baseline;

  const budget = 4e7;
  const bootstrapReps = Math.max(50, Math.min(400, Math.floor(budget / (total * 2))));
  const permutationReps = Math.max(99, Math.min(999, Math.floor(budget / (total * 2))));
  const random = mulberry32(seed);

  const ratios: number[] = [];
  const weight = new Float64Array(total);
  for (let rep = 0; rep < bootstrapReps; rep += 1) {
    weight.fill(0);
    for (let draw = 0; draw < total; draw += 1) weight[Math.floor(random() * total)] += 1;
    const result = weightedAuprc(groups, weight, positiveIndex, total);
    if (result) ratios.push(result.auprc / result.baseline);
  }
  ratios.sort((a, b) => a - b);
  const quantile = (q: number) => ratios[Math.min(ratios.length - 1, Math.max(0, Math.round(q * (ratios.length - 1))))];

  // Null: the same number of scored edges, each in its own rank, placed on
  // random pairs; everything else stays unscored.
  const scoredCount = groups.reduce((sum, group) => sum + group.truth.length + group.other.length, 0);
  const order = pairs.map((_, index) => index);
  let atLeast = 0;
  for (let rep = 0; rep < permutationReps; rep += 1) {
    for (let i = 0; i < scoredCount; i += 1) {
      const j = i + Math.floor(random() * (total - i));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const permuted = order.slice(0, scoredCount).map((index) =>
      truth.has(pairs[index]) ? { truth: [index], other: [] } : { truth: [], other: [index] },
    );
    const result = weightedAuprc(permuted, ones, positiveIndex, total);
    if (result && result.auprc / result.baseline >= observedRatio - 1e-12) atLeast += 1;
  }

  return {
    ci: ratios.length ? [quantile(0.025), quantile(0.975)] : [observedRatio, observedRatio],
    pValue: (atLeast + 1) / (permutationReps + 1),
    bootstrapReps,
    permutationReps,
  };
}

/**
 * Rank-average consensus (DREAM5 "wisdom of crowds"): every candidate pair
 * gets the mean of its rank across methods, unscored pairs taking the mean
 * of the remaining ranks. Returned as edges scored so that higher = better.
 */
export function consensusEdges(
  rankings: BeelineRankedEdge[][],
  candidateGenes: Set<string>,
) {
  const genes = [...candidateGenes];
  const total = genes.length * (genes.length - 1);
  const sums = new Map<string, { source: string; target: string; sum: number }>();
  genes.forEach((source) =>
    genes.forEach((target) => {
      if (source !== target) sums.set(benchmarkEdgeKey(source, target), { source, target, sum: 0 });
    }),
  );
  rankings.forEach((ranking) => {
    const scored = ranking.filter((edge) => edge.score > 0);
    const seen = new Set<string>();
    scored.forEach((edge, index) => {
      const key = benchmarkEdgeKey(edge.source, edge.target);
      const entry = sums.get(key);
      if (!entry) return;
      seen.add(key);
      entry.sum += index + 1;
    });
    const tailRank = (scored.length + 1 + total) / 2;
    sums.forEach((entry, key) => {
      if (!seen.has(key)) entry.sum += tailRank;
    });
  });
  return [...sums.values()].map((entry) => ({
    source: entry.source,
    target: entry.target,
    weight: total + 1 - entry.sum / Math.max(1, rankings.length),
  }));
}
