/** One meaning per channel. These rules are shared by the canvas, its legend
 * and the exported figure so the three can never disagree. */
export type NodeSizeBy = "out" | "all" | "in";
export type EdgeWidthBy = "evidence" | "support";

export const NODE_SIZE_OPTIONS: Record<NodeSizeBy, { label: string; legend: string; help: string }> = {
  out: { label: "Targets", legend: "Size: genes it regulates", help: "Number of displayed genes this gene regulates (directed out-links)." },
  all: { label: "All connections", legend: "Size: all connections", help: "Number of displayed relationships touching this gene, directed or not." },
  in: { label: "Regulators", legend: "Size: its regulators", help: "Number of displayed genes that regulate this gene (directed in-links)." },
};

/** Four fixed steps with a 6x range, so the strongest relationships stand out. */
export const WIDTH_STEPS = [0.6, 1.2, 2.2, 3.6] as const;
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
