"use client";

import { NETWORK_THEME as T } from "./theme";
import {
  CONFIDENCE_LABELS, CONFIDENCE_OPACITY, EVIDENCE_LABELS, NODE_SIZE_OPTIONS, PIE_SHADES, WIDTH_STEPS, supportLabels, widthEnds,
  type EdgeWidthBy, type FigureCounts, type NodeSizeBy,
} from "./encoding";

type Props = {
  regulatorShare: number;
  hasSign: boolean;
  hasUnsigned: boolean;
  directionResolved: boolean;
  hasUndirected?: boolean;
  hasConfidence?: boolean;
  sizeBy?: NodeSizeBy;
  widthBy?: EdgeWidthBy;
  methodCount?: number;
  counts?: FigureCounts;
  /** Caption line: displayed genes and relationships, then e.g. "5 methods · evidence ≥ 0.50". */
  genes?: number;
  relationships?: number;
  /** All displayed relationships, when a links filter shows only some. */
  totalRelationships?: number;
  /** Nodes are split by link direction (only when the view has directed links). */
  directionSplit?: boolean;
  note?: string;
};

const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;

/** Two quiet lines: the figure caption, then every encoding on one line.
 * Each scale reads the same way -- what it measures, low end, samples, high
 * end -- and the per-step counts live in the tooltip. */
export default function NetworkLegendBar({ regulatorShare, hasUnsigned, hasUndirected = false, directionResolved, sizeBy = "all", widthBy = "evidence", methodCount = 1, counts, genes, relationships, totalRelationships, directionSplit = false, note }: Props) {
  const support = widthBy === "support" && methodCount > 1;
  const stepLabels = support ? supportLabels(methodCount) : [...EVIDENCE_LABELS];
  const [low, high] = widthEnds(widthBy, methodCount);
  const widthTip = counts ? WIDTH_STEPS.map((_, i) => stepLabels[i] ? `${stepLabels[i]}: ${plural(counts.width[i], "link")}` : "").filter(Boolean).join("\n") : "";
  const confidenceTip = counts ? CONFIDENCE_LABELS.map((label, i) => `${label}: ${plural(counts.confidence[i], "link")}`).join("\n") : "";
  const size = counts?.size;
  const shaft = directionResolved ? "M1 5H16" : "M1 5H23";
  return <div className="grn-legend-bar publication-legend figure-key" aria-label="Network legend">
    {genes !== undefined && <p className="key-caption">
      <span><b>{genes.toLocaleString()}</b> genes</span>
      <span><b>{(relationships ?? 0).toLocaleString()}</b>{totalRelationships !== undefined && totalRelationships !== relationships ? ` of ${totalRelationships.toLocaleString()}` : ""} relationships</span>
      {note ? <span>{note}</span> : null}
    </p>}
    <div className="key-line">
      <span className="key-group">
        <span className="key-item" title={`${Math.round(regulatorShare * 100)}% of displayed genes are transcription factors`}><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5.5" fill={T.tf} /></svg>TF</span>
        <span className="key-item"><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5.5" fill={T.node} /></svg>Other gene</span>
      </span>
      {directionSplit && <span className="key-group" title="Each gene is split by the direction of its links, in its own colour: dark = regulates other genes, light = regulated by other genes, pale = direction unknown.">
        <svg width="16" height="16" aria-hidden="true"><path d="M8 8V0.5A7.5 7.5 0 0 1 15.1 10.4Z" fill={PIE_SHADES.tf[0]}/><path d="M8 8L15.1 10.4A7.5 7.5 0 0 1 2.3 12.9Z" fill={PIE_SHADES.tf[1]}/><path d="M8 8L2.3 12.9A7.5 7.5 0 0 1 8 0.5Z" fill={PIE_SHADES.tf[2]}/></svg>
        <span className="key-item"><i className="key-swatch" style={{ background: PIE_SHADES.tf[0] }} />regulates</span>
        <span className="key-item"><i className="key-swatch" style={{ background: PIE_SHADES.tf[1] }} />regulated by</span>
        {hasUndirected && <span className="key-item"><i className="key-swatch" style={{ background: PIE_SHADES.tf[2] }} />unknown</span>}
      </span>}
      {size && <span className="key-group" title={NODE_SIZE_OPTIONS[sizeBy].help}>
        <span className="key-label">{NODE_SIZE_OPTIONS[sizeBy].scale}</span>
        <span className="key-item">{size.min.toLocaleString()}<svg width="44" height="18" aria-hidden="true"><circle cx="5" cy="13" r="2.5" fill={T.node}/><circle cx="17" cy="11" r="5" fill={T.node}/><circle cx="34" cy="9" r="8" fill={T.node}/></svg>{size.max.toLocaleString()}</span>
      </span>}
      <span className="key-group" title={directionResolved ? "The tip marks the regulated gene; a link without a tip has no resolved direction." : "No method resolved a direction in this view, so links have no tips."}>
        <span className="key-item"><svg width="24" height="10" aria-hidden="true"><path d={shaft} stroke={T.activates} strokeWidth="1.4"/>{directionResolved && <path d="M15 1.5L23 5L15 8.5Z" fill={T.activates}/>}</svg>Activates</span>
        <span className="key-item"><svg width="22" height="10" aria-hidden="true"><path d={directionResolved ? "M1 5H20M20 .5V9.5" : "M1 5H21"} stroke={T.represses} strokeWidth="1.6" fill="none"/></svg>Represses</span>
        {hasUnsigned && <span className="key-item"><svg width="24" height="10" aria-hidden="true"><path d={shaft} stroke={T.unknown} strokeWidth="1.4"/>{directionResolved && <path d="M15 1.5L23 5L15 8.5Z" fill="#fff" stroke={T.unknown} strokeWidth="1"/>}</svg>Sign unknown</span>}
      </span>
      <span className="key-group" title={`${support ? "Line width: number of selected methods reporting the link" : "Line width: evidence (per-target rank, 0–1)"}${widthTip ? `\n${widthTip}` : ""}`}>
        <span className="key-label">{support ? "Methods" : "Evidence"}</span>
        <span className="key-item">{low}<svg width="72" height="10" aria-hidden="true">{WIDTH_STEPS.map((w, i) => <path key={i} d={`M${2 + i * 18.7} 5h12.5`} stroke="#333" strokeWidth={w}/>)}</svg>{high}</span>
      </span>
      {counts?.hasConfidence && <span className="key-group" title={`Opacity: bootstrap confidence\n${confidenceTip}\nLinks without a verified value are drawn solid.`}>
        <span className="key-label">Confidence</span>
        <span className="key-item">&lt;0.5<svg width="54" height="10" aria-hidden="true">{[...CONFIDENCE_OPACITY].reverse().map((o, i) => <path key={i} d={`M${2 + i * 18.5} 5h12.5`} stroke="#333" strokeWidth="2.2" opacity={o}/>)}</svg>≥0.8</span>
      </span>}
    </div>
  </div>;
}
