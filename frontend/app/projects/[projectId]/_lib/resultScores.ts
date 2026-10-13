/** Pure edge scores, scope selection, and rank helpers for project results. */

import type { AlgorithmResultEdge, AlgorithmStoredResult } from "./types";
import { clamp } from "./utils";

export function median(values: number[]) {
  if (values.length === 0) return null;
  const sortedValues = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sortedValues.length / 2);

  return sortedValues.length % 2 === 0
    ? (sortedValues[midpoint - 1] + sortedValues[midpoint]) / 2
    : sortedValues[midpoint];
}

export function edgesForScope(
  result: AlgorithmStoredResult | undefined,
  scopeId: string
): AlgorithmResultEdge[] {
  if (!result) return [];
  if (result.scopes?.[scopeId]?.status === "Completed") {
    return result.scopes[scopeId]?.top_edges ?? [];
  }
  if (scopeId === "global") {
    return result.top_edges ?? [];
  }
  return [];
}

export function numericEdgeScore(edge: AlgorithmResultEdge) {
  const rawScore = Number(edge.score ?? edge.weight ?? edge.edge_weight ?? 0);
  return Number.isFinite(rawScore) ? rawScore : 0;
}

export function numericEvidenceScore(edge: AlgorithmResultEdge, fallback: number) {
  const normalizedScore = Number(edge.normalized_score);
  if (Number.isFinite(normalizedScore)) return clamp(normalizedScore, 0, 1);

  const meanPercentile = numericMeanPercentile(edge);
  if (meanPercentile !== null) return meanPercentile;

  const score = Number(edge.score);
  if (Number.isFinite(score) && score >= 0 && score <= 1) return score;

  const confidence = numericEdgeConfidence(edge);
  if (confidence !== null) return confidence;

  return fallback;
}

export function numericConfidenceScore(edge: AlgorithmResultEdge, fallbackPercentile: number) {
  const confidence = numericEdgeConfidence(edge);
  if (confidence !== null) return confidence;

  const stability = numericStability(edge);
  const meanPercentile = numericMeanPercentile(edge) ?? fallbackPercentile;

  if (stability !== null) {
    return clamp(stability * meanPercentile, 0, 1);
  }

  return meanPercentile;
}

export function numericSignedEdgeScore(edge: AlgorithmResultEdge) {
  const signedScore = Number(
    edge.mean_raw_score ?? edge.weight ?? edge.edge_weight ?? edge.score ?? 0
  );
  return Number.isFinite(signedScore) ? signedScore : 0;
}

export function numericEdgeConfidence(edge: AlgorithmResultEdge) {
  const confidence = Number(edge.confidence);
  return Number.isFinite(confidence) ? clamp(confidence, 0, 1) : null;
}

export function numericMeanPercentile(edge: AlgorithmResultEdge) {
  const meanPercentile = Number(edge.mean_percentile ?? edge.meanPercentile);
  return Number.isFinite(meanPercentile) ? clamp(meanPercentile, 0, 1) : null;
}

export function numericStability(edge: AlgorithmResultEdge) {
  const stability = Number(edge.stability);
  return Number.isFinite(stability) ? clamp(stability, 0, 1) : null;
}

export function numericOptionalProbability(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const probability = Number(value);
  return Number.isFinite(probability) ? clamp(probability, 0, 1) : null;
}

export function signOf(value: number): -1 | 0 | 1 {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

export function assignAverageRanks<T extends { rank: number }>(
  sortedRows: T[],
  hasSameRank: (first: T, second: T) => boolean
) {
  const rows = [...sortedRows];
  let index = 0;

  while (index < rows.length) {
    let tieEnd = index + 1;
    while (tieEnd < rows.length && hasSameRank(rows[index], rows[tieEnd])) {
      tieEnd += 1;
    }

    const rank = ((index + 1) + tieEnd) / 2;
    for (let rankIndex = index; rankIndex < tieEnd; rankIndex += 1) {
      rows[rankIndex] = { ...rows[rankIndex], rank };
    }
    index = tieEnd;
  }

  return rows;
}
