import type { NetworkEdge } from "./networkGraphTypes";

export type NetworkMetric = "confidence" | "evidence" | "support";
export const METRICS: Record<
  NetworkMetric,
  { label: string; scale: string; description: string }
> = {
  confidence: {
    label: "Confidence",
    scale: "0–100%",
    description:
      "Recovery across cell-bootstrap samples; consensus uses the median of supporting methods.",
  },
  evidence: {
    label: "Evidence",
    scale: "0–1",
    description:
      "Target-specific ranking; consensus averages across all selected methods.",
  },
  support: {
    label: "Method support",
    scale: "0–100% of selected methods",
    description:
      "How many selected methods report the relationship; sign and direction may differ.",
  },
};
export const NETWORK_COLORS = {
  node: "#476477",
  positive: "#2475ad",
  negative: "#c46b32",
  unknown: "#8b95a0",
  selection: "#bb983e",
};

export function numericMetric(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;
}

export function edgeMetric(
  edge: NetworkEdge,
  metric: NetworkMetric,
  methodCount: number,
): number | null {
  if (metric === "confidence")
    return edge.bootstrapVerified !== true
      ? null
      : numericMetric(edge.confidence);
  if (metric === "evidence") return numericMetric(edge.score);
  return methodCount > 0 ? numericMetric(edge.count / methodCount) : null;
}

// Absolute scales: removing other edges must never change this edge's width.
export function metricWidth(value: number | null): number {
  return value === null ? 1 : 0.8 + value * 2;
}
// Opacity channel for edge strength (confidence / evidence / support). A higher
// floor keeps low-strength links visible while the full range remains legible.
/** Evidence drives the central line's thickness. Deliberately a narrow range:
 * support is carried by the thread count, so this only needs to be comparable,
 * not heavy. */
export function metricWidthPx(value: number | null): number {
  return value === null ? 1.4 : 1.2 + value * 1.6;
}
export function metricOpacity(value: number | null): number {
  return value === null ? 0.3 : 0.42 + value * 0.58;
}
export function percent(value: number | null | undefined): string {
  const number = numericMetric(value);
  return number === null
    ? "Unavailable"
    : number > 0 && number < 0.005
      ? "<1%"
      : number < 1 && number > 0.995
        ? ">99%"
        : `${Math.round(number * 100)}%`;
}
export function evidenceText(value: number | null | undefined): string {
  const number = numericMetric(value);
  return number === null ? "Unavailable" : number.toFixed(2);
}
export function signText(sign: number): string {
  return sign > 0
    ? "Predicted activation"
    : sign < 0
      ? "Predicted repression"
      : "Sign unresolved";
}
export function signColor(sign: number): string {
  return sign > 0
    ? NETWORK_COLORS.positive
    : sign < 0
      ? NETWORK_COLORS.negative
      : NETWORK_COLORS.unknown;
}
export function hasDirection(
  edge: Pick<
    NetworkEdge,
    "direction" | "directionCoverage" | "directionConfidence"
  >,
): boolean {
  return (
    edge.direction !== 0 &&
    edge.directionCoverage > 0 &&
    edge.directionConfidence !== null &&
    edge.directionConfidence > 0
  );
}
export function displayEndpoints(edge: NetworkEdge) {
  return edge.direction === -1
    ? { source: edge.target, target: edge.source }
    : { source: edge.source, target: edge.target };
}
export function relationshipLabel(edge: NetworkEdge): string {
  const { source, target } = displayEndpoints(edge);
  return `${source} ${hasDirection(edge) ? (edge.sign < 0 ? "⊣" : "→") : "—"} ${target}`;
}
export function edgeAnnotation(edge: NetworkEdge, methodCount: number): string {
  const confidence =
    edge.bootstrapVerified === false
      ? "legacy"
      : edge.bootstrapVerified !== true
        ? "unavailable"
        : percent(edge.confidence);
  return `C ${confidence} · E ${evidenceText(edge.score)} · ${edge.count}/${methodCount} methods`;
}

/**
 * Method support as a stepped line width.
 *
 * Support is a small integer, so a continuous ramp wastes it: the earlier
 * design spread twelve levels over ~1.2px and no two were separable. Here the
 * ramp is quantised into at most SUPPORT_STEPS discrete widths, so adjacent
 * levels differ by ~0.7px -- enough to rank two edges by eye. The exact count
 * stays in the tooltip and the inspector.
 */
export const SUPPORT_MIN_WIDTH = 1.2;
export const SUPPORT_MAX_WIDTH = 5.4;
export const SUPPORT_STEPS = 7;

export function supportLevel(count: number, methodCount: number): number {
  const total = Math.max(1, methodCount);
  if (total <= 1) return 0;
  const supported = Math.max(1, Math.min(total, Math.round(count)));
  const steps = Math.min(total, SUPPORT_STEPS);
  return Math.round(((supported - 1) / (total - 1)) * (steps - 1));
}

export function supportWidthPx(count: number, methodCount: number): number {
  const steps = Math.min(Math.max(1, methodCount), SUPPORT_STEPS);
  if (steps <= 1) return SUPPORT_MIN_WIDTH;
  const level = supportLevel(count, methodCount);
  return (
    SUPPORT_MIN_WIDTH +
    (level / (steps - 1)) * (SUPPORT_MAX_WIDTH - SUPPORT_MIN_WIDTH)
  );
}
