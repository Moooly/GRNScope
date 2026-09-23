"use client";

import { NETWORK_THEME as T } from "./theme";
import {
  CONFIDENCE_LABELS, CONFIDENCE_OPACITY, EVIDENCE_LABELS, NODE_SIZE_OPTIONS, WIDTH_STEPS, supportLabels,
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
};

const n = (value: number) => value.toLocaleString();

/** One aligned band: each channel is a column with a small heading, and every
 * key reports how much of this figure it describes. */
export default function NetworkLegendBar({ regulatorShare, hasUnsigned, directionResolved, hasUndirected = false, sizeBy = "all", widthBy = "evidence", methodCount = 1, counts }: Props) {
  const width = widthBy === "support" && methodCount > 1 ? "support" : "evidence";
  const widthLabels = width === "support" ? supportLabels(methodCount) : [...EVIDENCE_LABELS];
  const size = counts?.size;
  return <div className="grn-legend-bar publication-legend figure-key" aria-label="Network legend">
    <div className="key-col">
      <span className="key-head">Genes</span>
      <span className="key-row" title={`${Math.round(regulatorShare * 100)}% of displayed genes are transcription factors`}><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill={T.tf} /></svg>Transcription factor</span>
      <span className="key-row"><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill={T.node} /></svg>Other gene</span>
    </div>
    <div className="key-col" title={NODE_SIZE_OPTIONS[sizeBy].help}>
      <span className="key-head">{NODE_SIZE_OPTIONS[sizeBy].legend.replace(/^Size: /, "Size · ")}</span>
      <span className="key-row key-size">
        <svg width="40" height="22" aria-hidden="true"><circle cx="5" cy="17" r="3" fill={T.node}/><circle cx="27" cy="11" r="10" fill={T.node}/></svg>
        {size ? <span className="key-num">{n(size.min)} – {n(size.max)}</span> : null}
      </span>
    </div>
    <div className="key-col">
      <span className="key-head">Effect</span>
      <span className="key-row"><svg width="26" height="12" aria-hidden="true"><path d="M1 6H18" stroke={T.activates} strokeWidth="1.4"/><path d="M17 2.5L25 6L17 9.5Z" fill={T.activates}/></svg>Activation</span>
      <span className="key-row"><svg width="26" height="12" aria-hidden="true"><path d="M1 6H23M23 1.5V10.5" stroke={T.represses} strokeWidth="1.6" fill="none"/></svg>Repression</span>
      {hasUnsigned && <span className="key-row"><svg width="26" height="12" aria-hidden="true"><path d="M1 6H17" stroke={T.unknown} strokeWidth="1.4"/><path d="M17 2.5L25 6L17 9.5Z" fill="#fff" stroke={T.unknown} strokeWidth="1"/></svg>Sign unknown</span>}
      <span className="key-note">{directionResolved ? "Tip marks the regulated gene" : "No direction resolved"}{directionResolved && hasUndirected ? "; no tip, direction unknown" : ""}</span>
    </div>
    <div className="key-col" title={width === "support" ? "Number of selected methods reporting the relationship" : "Evidence: per-target rank of the relationship, 0–1"}>
      <span className="key-head">{width === "support" ? "Width · method support" : "Width · evidence"}</span>
      {WIDTH_STEPS.map((w, i) => widthLabels[i] ? <span key={i} className="key-row"><svg width="26" height="10" aria-hidden="true"><path d="M1 5H25" stroke="#3a3a3a" strokeWidth={w}/></svg><span>{widthLabels[i]}</span>{counts ? <span className="key-num">{n(counts.width[i])}</span> : null}</span> : null)}
    </div>
    {counts?.hasConfidence && <div className="key-col" title="Bootstrap confidence: how often the relationship was recovered across cell resamples. Relationships without a verified value are drawn solid.">
      <span className="key-head">Opacity · confidence</span>
      {CONFIDENCE_OPACITY.map((o, i) => <span key={i} className="key-row"><svg width="26" height="10" aria-hidden="true"><path d="M1 5H25" stroke="#3a3a3a" strokeWidth="2.2" opacity={o}/></svg><span>{CONFIDENCE_LABELS[i]}</span><span className="key-num">{n(counts.confidence[i])}</span></span>)}
    </div>}
  </div>;
}
