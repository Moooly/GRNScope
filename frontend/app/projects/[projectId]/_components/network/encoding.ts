/** One meaning per channel. These rules are shared by the canvas, its legend
 * and the exported figure so the three can never disagree. */
export type NodeSizeBy = "out" | "all" | "in";
export type EdgeWidthBy = "evidence" | "support";

export const NODE_SIZE_OPTIONS: Record<NodeSizeBy, { label: string; scale: string; legend: string; help: string }> = {
  out: { label: "Targets", scale: "Targets", legend: "Size: genes it regulates", help: "Node size: number of displayed genes this gene regulates (outgoing edges)." },
  all: { label: "All connections", scale: "Connections", legend: "Size: all connections", help: "Node size: number of displayed relationships touching this gene, directed or not." },
  in: { label: "Regulators", scale: "Regulators", legend: "Size: its regulators", help: "Node size: number of displayed genes that regulate this gene (incoming edges)." },
};

/** End labels for the compact width scale. */
export function widthEnds(widthBy: EdgeWidthBy, methodCount: number): [string, string] {
  if (widthBy === "support" && methodCount > 1) return ["1", `${methodCount}`];
  return ["<0.5", "≥0.9"];
}

/** Four fixed steps (1 → 3.6 px). The thinnest stays clearly visible; the
 * strongest relationships still stand out. */
export const WIDTH_STEPS = [1, 1.6, 2.4, 3.6] as const;
export const EVIDENCE_BREAKS = [0.5, 0.75, 0.9] as const;
export const EVIDENCE_LABELS = ["< 0.5", "0.5–0.75", "0.75–0.9", "≥ 0.9"] as const;

export function evidenceStep(value: number | null | undefined) {
  const v = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return v >= EVIDENCE_BREAKS[2] ? 3 : v >= EVIDENCE_BREAKS[1] ? 2 : v >= EVIDENCE_BREAKS[0] ? 1 : 0;
}

/** 1 method, 2 methods, 3 up to all-but-one, all methods. With a single method
 * there is no consensus to show, so every relationship takes the second step. */
export function supportStep(count: number, methodCount: number) {
  if (methodCount <= 1) return 1;
  if (count >= methodCount) return 3;
  if (count <= 1) return 0;
  if (count === 2) return 1;
  return 2;
}

export function supportLabels(methodCount: number): string[] {
  if (methodCount <= 1) return ["", "1 method", "", ""];
  if (methodCount === 2) return ["1 method", "", "", "2 methods (all)"];
  if (methodCount === 3) return ["1 method", "2 methods", "", "3 methods (all)"];
  return ["1 method", "2 methods", methodCount === 4 ? "3 methods" : `3–${methodCount - 1} methods`, `${methodCount} methods (all)`];
}

/** Bootstrap confidence: three coarse bands. A relationship without a verified
 * value is drawn solid rather than being penalised for a missing measurement. */
export const CONFIDENCE_OPACITY = [1, 0.45, 0.15] as const;
export const CONFIDENCE_LABELS = ["≥ 0.8", "0.5–0.8", "< 0.5"] as const;
export function confidenceBand(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value >= 0.8 ? 0 : value >= 0.5 ? 1 : 2;
}

/** What this figure contains, for a key that reports the figure rather than
 * only defining its symbols. Uses exactly the rules the canvas draws with. */
export type FigureCounts = { width: number[]; confidence: number[]; hasConfidence: boolean; size: { min: number; max: number } };
export function figureCounts(
  edges: Array<{ score: number; count: number; confidence: number; bootstrapVerified?: boolean }>,
  widthBy: EdgeWidthBy, methodCount: number, sizeValues: number[],
): FigureCounts {
  const width = [0, 0, 0, 0], confidence = [0, 0, 0];
  let hasConfidence = false;
  for (const e of edges) {
    width[widthBy === "support" ? supportStep(e.count, methodCount) : evidenceStep(e.score)]++;
    if (e.bootstrapVerified === true) { hasConfidence = true; confidence[confidenceBand(e.confidence)]++; }
  }
  return { width, confidence, hasConfidence, size: { min: sizeValues.length ? Math.min(...sizeValues) : 0, max: sizeValues.length ? Math.max(...sizeValues) : 0 } };
}

/** Which links the figure shows by effect. Genes keep their places. */
export type EffectFilter = "all" | "activation" | "repression" | "unknown";
export const EFFECT_OPTIONS: Array<{ value: EffectFilter; label: string }> = [
  { value: "all", label: "All" }, { value: "activation", label: "Activation" },
  { value: "repression", label: "Repression" }, { value: "unknown", label: "Sign unknown" },
];
export function passesEffect(sign: number, effect: EffectFilter) {
  return effect === "all" || (effect === "activation" ? sign === 1 : effect === "repression" ? sign === -1 : sign === 0);
}
export const EFFECT_NOTE: Record<EffectFilter, string> = { all: "", activation: "activation only", repression: "repression only", unknown: "sign unknown only" };

/** Evidence and bootstrap confidence as two distributions on one 0–1 axis:
 * the links in each 0.05-wide bin, once by evidence and once by confidence.
 * A link with no verified confidence is left out of the confidence side
 * rather than counted as low. */
export const SCORE_BIN_STEP = 0.05, SCORE_BIN_COUNT = 20;
export const scoreBin = (value: number) => Math.min(SCORE_BIN_COUNT - 1, Math.max(0, Math.floor(value / SCORE_BIN_STEP + 1e-9)));
export type ScoreBins<E> = { evidence: E[][]; confidence: E[][]; verified: number };
export function scoreDistributions<E extends { score: number; confidence: number; bootstrapVerified?: boolean }>(edges: E[]): ScoreBins<E> {
  const evidence: E[][] = Array.from({ length: SCORE_BIN_COUNT }, () => []);
  const confidence: E[][] = Array.from({ length: SCORE_BIN_COUNT }, () => []);
  let verified = 0;
  for (const e of edges) {
    if (Number.isFinite(e.score)) evidence[scoreBin(e.score)].push(e);
    if (e.bootstrapVerified === true && Number.isFinite(e.confidence)) { confidence[scoreBin(e.confidence)].push(e); verified++; }
  }
  return { evidence, confidence, verified };
}
