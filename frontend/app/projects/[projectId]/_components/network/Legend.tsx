"use client";

import { PALETTES, DEFAULT_PALETTE, type PaletteName } from "./theme";
import {
  CONFIDENCE_LABELS, EVIDENCE_LABELS, WIDTH_STEPS, supportLabels,
  type EdgeWidthBy, type EffectFilter, type FigureCounts,
} from "./encoding";

const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;

type FilterProps = {
  relationships: number;
  signCounts: { activation: number; repression: number; unknown: number };
  effect: EffectFilter;
  onEffectChange: (effect: EffectFilter) => void;
  palette?: PaletteName;
  /** "line": the line above the network; "chips": pills at the top of the side panel. */
  variant?: "line" | "chips";
};

/** "Links  63 all · → 39 activation · ⊣ 24 repression": each count is the
 * filter for those links. The selected part is shaded, "all" by default. */
export function NetworkLinkFilter({ relationships, signCounts, effect, onEffectChange, palette = DEFAULT_PALETTE, variant = "line" }: FilterProps) {
  const T = PALETTES[palette];
  const part = (value: EffectFilter, content: React.ReactNode, title: string, empty = false) => {
    const active = effect === value;
    return <button type="button" className={`key-part${active ? " is-on" : ""}${effect !== "all" && !active ? " is-dim" : ""}`}
      aria-pressed={active} disabled={empty} title={active ? (value === "all" ? "Showing every link; click a count to show only those links" : "Show every link") : title}
      onClick={() => onEffectChange(active ? "all" : value)}>{content}</button>;
  };
  const chips = variant === "chips";
  const label = (count: number, word: string) => chips ? <>{word[0].toUpperCase() + word.slice(1)} <b>{count.toLocaleString()}</b></> : <><b>{count.toLocaleString()}</b> {word}</>;
  const ink = chips ? "currentColor" : undefined;
  return <div className={`figure-filter${chips ? " is-chips" : ""}`} aria-label="Links shown">
    {!chips && <span className="key-label">Links</span>}
    {part("all", label(relationships, "all"), "Show every link")}
    {part("activation", <><svg width="20" height="10" aria-hidden="true"><path d="M1 5H13" stroke={ink ?? T.activates} strokeWidth="1.6"/><path d="M12 1.5L19 5L12 8.5Z" fill={ink ?? T.activates}/></svg>{label(signCounts.activation, "activation")}</>, "Show only activation links", signCounts.activation === 0)}
    {part("repression", <><svg width="18" height="10" aria-hidden="true"><path d="M1 5H16M16 .5V9.5" stroke={ink ?? T.represses} strokeWidth="1.8" fill="none"/></svg>{label(signCounts.repression, "repression")}</>, "Show only repression links", signCounts.repression === 0)}
    {signCounts.unknown > 0 && part("unknown", <><svg width="18" height="10" aria-hidden="true"><path d="M1 5H17" stroke={ink ?? T.unknown} strokeWidth="1.6"/></svg>{label(signCounts.unknown, "sign unknown")}</>, "Show only links whose sign is unknown")}
  </div>;
}

type KeyProps = {
  directionSplit: boolean;
  hasUndirected: boolean;
  widthBy: EdgeWidthBy;
  methodCount: number;
  counts?: FigureCounts;
  palette?: PaletteName;
};

/** One short line under the network: only what the picture can't say itself.
 * Exact steps and counts are in the tooltips. */
export function NetworkKey({ directionSplit, hasUndirected, widthBy, methodCount, counts, palette = DEFAULT_PALETTE }: KeyProps) {
  const T = PALETTES[palette];
  const support = widthBy === "support" && methodCount > 1;
  const steps = support ? supportLabels(methodCount) : [...EVIDENCE_LABELS];
  const widthTip = [support ? "Line width: number of selected methods reporting the link" : "Line width: evidence (per-target rank, 0–1)",
    ...WIDTH_STEPS.map((_, i) => steps[i] ? `${steps[i]}${counts ? `: ${plural(counts.width[i], "link")}` : ""}` : "").filter(Boolean)].join("\n");
  const fadeTip = ["Opacity: bootstrap confidence", ...CONFIDENCE_LABELS.map((label, i) => `${label}${counts ? `: ${plural(counts.confidence[i], "link")}` : ""}`), "Links without a verified value are drawn solid."].join("\n");
  return <div className="figure-key-line" aria-label="Network key">
    <span className="key-group">
      <span className="key-item"><svg width="11" height="11" aria-hidden="true"><circle cx="5.5" cy="5.5" r="5" fill={T.tf} /></svg>TF</span>
      <span className="key-item"><svg width="11" height="11" aria-hidden="true"><circle cx="5.5" cy="5.5" r="5" fill={T.node} /></svg>Other gene</span>
    </span>
    {directionSplit && <span className="key-group" title="Each gene is split by the direction of its links, in its own colour.">
      <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6.5" fill={T.pieTF[1]}/><path d="M7 7V.5A6.5 6.5 0 1 1 1.4 10.3Z" fill={T.pieTF[0]}/></svg>
      <span>dark regulates · light regulated by{hasUndirected ? " · pale unknown" : ""}</span>
    </span>}
    {hasUndirected && <span className="key-group" title="A solid line has a resolved direction and its tip marks the regulated gene. A dashed line has no resolved direction.">
      <svg width="24" height="8" aria-hidden="true"><path d="M1 4H23" stroke={T.activates} strokeWidth="1.6" strokeDasharray="4 3"/></svg>
      <span>direction unknown</span>
    </span>}
    <span className="key-group" title={widthTip}>{support ? "Width = method support" : "Width = evidence"}</span>
    {counts?.hasConfidence && <span className="key-group" title={fadeTip}>Fade = low confidence</span>}
  </div>;
}
