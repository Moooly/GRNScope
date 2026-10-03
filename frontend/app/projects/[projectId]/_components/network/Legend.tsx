"use client";

import { PALETTES, DEFAULT_PALETTE, type PaletteName } from "./theme";
import {
  CONFIDENCE_LABELS, EVIDENCE_LABELS, WIDTH_STEPS, supportLabels,
  NODE_SIZE_OPTIONS, type EdgeWidthBy, type EffectFilter, type FigureCounts, type NodeSizeBy,
} from "./encoding";

const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;

type FilterProps = {
  relationships: number;
  signCounts: { activation: number; repression: number; unknown: number };
  effect: EffectFilter;
  onEffectChange: (effect: EffectFilter) => void;
  palette?: PaletteName;
  /** "line": its own line above the network; "chips": pills; "inline": one of
   * the controls at the right of the key line. */
  variant?: "line" | "chips" | "inline";
};

/** "Links  63 all · → 39 activation · ⊣ 24 repression": each count is the
 * filter for those links. The selected part is shaded, "all" by default. */
export function NetworkLinkFilter({ relationships, signCounts, effect, onEffectChange, palette = DEFAULT_PALETTE, variant = "line" }: FilterProps) {
  const T = PALETTES[palette];
  const part = (value: EffectFilter, content: React.ReactNode, title: string, empty = false) => {
    const active = effect === value;
    return <button type="button" className={`key-part${active ? " is-on" : ""}${effect !== "all" && !active ? " is-dim" : ""}`}
      aria-pressed={active} disabled={empty} title={active ? (value === "all" ? "Showing every edge; click a count to show only those edges" : "Show every edge") : title}
      onClick={() => onEffectChange(active ? "all" : value)}>{content}</button>;
  };
  const chips = variant === "chips";
  const label = (count: number, word: string) => chips ? <>{word[0].toUpperCase() + word.slice(1)} <b>{count.toLocaleString()}</b></> : <><b>{count.toLocaleString()}</b> {word}</>;
  const ink = chips ? "currentColor" : undefined;
  return <div className={`figure-filter${chips ? " is-chips" : ""}${variant === "inline" ? " is-inline" : ""}`} role="group" aria-label="Edges shown">
    {variant === "inline" ? <span className="key-control-name">Edges</span> : !chips && <span className="key-label">Edges</span>}
    {part("all", label(relationships, "all"), "Show every edge")}
    {part("activation", <><svg width="20" height="10" aria-hidden="true"><path d="M1 5H13" stroke={ink ?? T.activates} strokeWidth="1.6"/><path d="M12 1.5L19 5L12 8.5Z" fill={ink ?? T.activates}/></svg>{label(signCounts.activation, "activation")}</>, "Show only activation edges", signCounts.activation === 0)}
    {part("repression", <><svg width="18" height="10" aria-hidden="true"><path d="M1 5H16M16 .5V9.5" stroke={ink ?? T.represses} strokeWidth="1.8" fill="none"/></svg>{label(signCounts.repression, "repression")}</>, "Show only repression edges", signCounts.repression === 0)}
    {signCounts.unknown > 0 && part("unknown", <><svg width="18" height="10" aria-hidden="true"><path d="M1 5H17" stroke={ink ?? T.unknown} strokeWidth="1.6"/></svg>{label(signCounts.unknown, "sign unknown")}</>, "Show only edges whose sign is unknown")}
  </div>;
}

type KeyProps = {
  directionSplit: boolean;
  hasUndirected: boolean;
  widthBy: EdgeWidthBy;
  methodCount: number;
  counts?: FigureCounts;
  palette?: PaletteName;
  /** Which link signs are drawn; each present one gets its tip in the key.
   * Omit when the filter line above already shows the tips with their counts. */
  signs?: { activation: boolean; repression: boolean; unknown: boolean };
  /** On-screen only: the key doubles as the node-size and line-width picker.
   * Downloaded figures draw their own plain key, so no control reaches them. */
  sizeBy?: NodeSizeBy;
  onSizeByChange?: (sizeBy: NodeSizeBy) => void;
  /** Targets/Regulators need directed links. */
  sizeChoice?: boolean;
  onWidthByChange?: (widthBy: EdgeWidthBy) => void;
  /** The edge filter (all / activation / repression), first of the controls:
   * its entries name the tips and filter by them. */
  filter?: React.ReactNode;
};

/** Plain words for the size picker: what a bigger circle means. */
const SIZE_WORDS: Record<NodeSizeBy, string> = { all: "All edges", out: "Targets (genes it regulates)", in: "Regulators (genes regulating it)" };
/** Default first, then the two directed counts. */
const SIZE_ORDER: NodeSizeBy[] = ["all", "out", "in"];

/** One short line above the network: only what the picture can't say itself.
 * Exact steps and counts are in the tooltips. */
export function NetworkKey({ directionSplit, hasUndirected, widthBy, methodCount, counts, palette = DEFAULT_PALETTE, signs, sizeBy, onSizeByChange, sizeChoice = true, onWidthByChange, filter }: KeyProps) {
  const T = PALETTES[palette];
  const support = widthBy === "support" && methodCount > 1;
  const steps = support ? supportLabels(methodCount) : [...EVIDENCE_LABELS];
  const widthTip = [support ? "Line width: number of selected methods reporting the edge" : "Line width: evidence (per-target rank, 0–1)",
    ...WIDTH_STEPS.map((_, i) => steps[i] ? `${steps[i]}${counts ? `: ${plural(counts.width[i], "edge")}` : ""}` : "").filter(Boolean)].join("\n");
  const fadeTip = ["Opacity: bootstrap confidence", ...CONFIDENCE_LABELS.map((label, i) => `${label}${counts ? `: ${plural(counts.confidence[i], "edge")}` : ""}`), "Edges without a verified value are drawn solid."].join("\n");
  const controls = Boolean((sizeBy && onSizeByChange) || onWidthByChange || filter);
  return <div className="figure-key-line">
    {/* What the marks mean: plain text, nothing clickable. */}
    <div className="key-static" aria-label="Network key">
      <span className="key-group">
        <span className="key-item"><svg width="11" height="11" aria-hidden="true"><circle cx="5.5" cy="5.5" r="5" fill={T.tf} /></svg>TF</span>
        <span className="key-item"><svg width="11" height="11" aria-hidden="true"><circle cx="5.5" cy="5.5" r="5" fill={T.node} /></svg>Other gene</span>
      </span>
      {signs && (signs.activation || signs.repression || signs.unknown) && <span className="key-group" title="The tip at the regulated gene shows the sign of the edge.">
        {signs.activation && <span className="key-item"><svg width="22" height="10" aria-hidden="true"><path d="M1 5H14" stroke={T.activates} strokeWidth="1.6"/><path d="M13 1.5L21 5L13 8.5Z" fill={T.activates}/></svg>activation</span>}
        {signs.repression && <span className="key-item"><svg width="20" height="10" aria-hidden="true"><path d="M1 5H18M18 .5V9.5" stroke={T.represses} strokeWidth="1.8" fill="none"/></svg>repression</span>}
        {signs.unknown && <span className="key-item"><svg width="20" height="10" aria-hidden="true"><path d="M1 5H19" stroke={T.unknown} strokeWidth="1.6"/></svg>sign unknown</span>}
      </span>}
      {directionSplit && <span className="key-group" title="Each gene is split by the direction of its edges, in its own colour.">
        <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6.5" fill={T.pieTF[1]}/><path d="M7 7V.5A6.5 6.5 0 1 1 1.4 10.3Z" fill={T.pieTF[0]}/></svg>
        <span>dark regulates · light regulated by{hasUndirected ? " · pale unknown" : ""}</span>
      </span>}
      {hasUndirected && <span className="key-group" title="A solid line has a resolved direction and its tip marks the regulated gene. A dashed line has no resolved direction.">
        <svg width="24" height="8" aria-hidden="true"><path d="M1 4H23" stroke={T.activates} strokeWidth="1.6" strokeDasharray="4 3"/></svg>
        <span>direction unknown</span>
      </span>}
      {!onWidthByChange && <span className="key-group" title={widthTip}>{support ? "Line width: methods agreeing" : "Line width: evidence score"}</span>}
      {counts?.hasConfidence && <span className="key-group" title={fadeTip}>
        <svg width="30" height="8" aria-hidden="true">{[0.2, 0.5, 1].map((o, i) => <path key={i} d={`M${1 + i * 10} 4h8`} stroke={T.activates} strokeWidth="2" opacity={o}/>)}</svg>
        <span>faded = low confidence</span>
      </span>}
    </div>
    {/* How the figure is drawn: same row, right after the key. Each picker
      * shows its own small-to-large scale; only the value is clickable-looking. */}
    {controls && <div className="key-controls" role="group" aria-label="Figure settings">
      {filter && <div className="key-control key-filter">{filter}</div>}
      {sizeBy && onSizeByChange && <label className="key-control" title={NODE_SIZE_OPTIONS[sizeBy].help}>
        <svg width="20" height="12" aria-hidden="true"><circle cx="3.5" cy="8" r="2.5" fill={T.node}/><circle cx="13" cy="6" r="5.5" fill={T.node}/></svg>
        <span className="key-control-name">Node size by</span>
        <select value={sizeBy} onChange={event => onSizeByChange(event.target.value as NodeSizeBy)} aria-label="Node size">
          {SIZE_ORDER.map(key => <option key={key} value={key} disabled={key !== "all" && !sizeChoice}>{SIZE_WORDS[key]}</option>)}
        </select>
      </label>}
      {onWidthByChange && <label className="key-control" title={widthTip}>
        <svg width="20" height="12" aria-hidden="true"><path d="M1 10L19 10" stroke="#5f6b72" strokeWidth=".8"/><path d="M1 6H19" stroke="#5f6b72" strokeWidth="1.6"/><path d="M1 2H19" stroke="#5f6b72" strokeWidth="2.6"/></svg>
        <span className="key-control-name">Line width</span>
        <select value={support ? "support" : "evidence"} onChange={event => onWidthByChange(event.target.value as EdgeWidthBy)} aria-label="Line width">
          <option value="evidence">evidence score</option>
          <option value="support" disabled={methodCount <= 1}>methods agreeing</option>
        </select>
      </label>}
    </div>}
  </div>;
}
