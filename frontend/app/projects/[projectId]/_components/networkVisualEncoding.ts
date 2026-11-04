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
      "Recovery across cell-bootstrap samples; consensus averages all selected methods, including zero recovery.",
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
 * Method support as a stepped arrowhead size.
 *
 * Support used to drive line width, which made the picture messy: a thick
 * stroke carries its weight along the entire edge, so well-supported
 * relationships read as overlapping ribbons and crowd everything near a hub.
 * The arrowhead carries the same ramp in a single glyph at the tip, so the
 * lines stay uniform and thin while agreement is still visible at a glance.
 *
 * Support is a small integer, so the ramp is quantised into at most
 * SUPPORT_STEPS discrete sizes rather than spread continuously.
 */
export const SUPPORT_MIN_ARROW = 0.8;
export const SUPPORT_MAX_ARROW = 2.1;
export const SUPPORT_STEPS = 7;

export function supportLevel(count: number, methodCount: number): number {
  const total = Math.max(1, methodCount);
  if (total <= 1) return 0;
  const supported = Math.max(1, Math.min(total, Math.round(count)));
  const steps = Math.min(total, SUPPORT_STEPS);
  return Math.round(((supported - 1) / (total - 1)) * (steps - 1));
}

export function supportArrowScale(count: number, methodCount: number): number {
  const steps = Math.min(Math.max(1, methodCount), SUPPORT_STEPS);
  if (steps <= 1) return SUPPORT_MIN_ARROW;
  const level = supportLevel(count, methodCount);
  return (
    SUPPORT_MIN_ARROW +
    (level / (steps - 1)) * (SUPPORT_MAX_ARROW - SUPPORT_MIN_ARROW)
  );
}

/**
 * Evidence as arrowhead fill.
 *
 * Cytoscape only offers filled or hollow, so this is deliberately two tiers --
 * "this regulator is among the stronger explanations for its target" or not.
 * It rides on a glyph that is already on screen, costs no extra space, and
 * unlike a dash pattern it scales with the arrow so it stays legible at the
 * zoom the network first opens at.
 */
export const EVIDENCE_SOLID_THRESHOLD = 0.5;

export function evidenceArrowFill(value: number | null): "filled" | "hollow" {
  if (value === null) return "hollow";
  return value >= EVIDENCE_SOLID_THRESHOLD ? "filled" : "hollow";
}
