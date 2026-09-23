"use client";

import { NETWORK_THEME as T } from "./theme";
import {
  CONFIDENCE_LABELS, CONFIDENCE_OPACITY, EVIDENCE_LABELS, NODE_SIZE_OPTIONS, WIDTH_STEPS, supportLabels,
  type EdgeWidthBy, type NodeSizeBy,
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
};
const item: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" };
const group: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" };
const small: React.CSSProperties = { fontSize: "0.92em", color: "#555" };

/** Names each channel once, in the same order as the figure's own key. */
export default function NetworkLegendBar({ regulatorShare, hasUnsigned, directionResolved, hasUndirected = false, hasConfidence = false, sizeBy = "all", widthBy = "evidence", methodCount = 1 }: Props) {
  const width = widthBy === "support" && methodCount > 1 ? "support" : "evidence";
  const widthLabels = width === "support" ? supportLabels(methodCount) : [...EVIDENCE_LABELS];
  return <div className="grn-legend-bar publication-legend" aria-label="Network legend">
    <span style={group}>
      <span style={item} title={`${Math.round(regulatorShare * 100)}% of displayed genes are transcription factors`}><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill={T.tf} /></svg>Transcription factor</span>
      <span style={item}><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill={T.node} /></svg>Other gene</span>
      <span style={item} title={NODE_SIZE_OPTIONS[sizeBy].help}><svg width="34" height="18" aria-hidden="true"><circle cx="5" cy="12" r="3.5" fill={T.node}/><circle cx="23" cy="9" r="8" fill={T.node}/></svg>{NODE_SIZE_OPTIONS[sizeBy].legend}</span>
    </span>
    <span style={group}>
      <span style={item}><svg width="28" height="16" aria-hidden="true"><path d="M1 8H19" stroke={T.activates} strokeWidth="1.6"/><path d="M18 3.5L26 8L18 12.5Z" fill={T.activates}/></svg>Activation</span>
      <span style={item}><svg width="26" height="16" aria-hidden="true"><path d="M1 8H23M23 2.5V13.5" stroke={T.represses} strokeWidth="1.8" fill="none"/></svg>Repression</span>
      {hasUnsigned && <span style={item}><svg width="28" height="16" aria-hidden="true"><path d="M1 8H18" stroke={T.unknown} strokeWidth="1.6"/><path d="M18 3.5L26 8L18 12.5Z" fill="#fff" stroke={T.unknown} strokeWidth="1.1"/></svg>Sign unknown</span>}
      <span style={{ ...item, ...small }} title="A tip marks the regulated gene. A line without a tip means no method resolved which gene regulates the other.">
        {directionResolved ? "Tip = regulated gene" : "No direction resolved"}{directionResolved && hasUndirected ? " · no tip = direction unknown" : ""}
      </span>
    </span>
    <span style={group} title={width === "support" ? "Number of selected methods reporting the relationship" : "Evidence: per-target rank of the relationship, 0–1"}>
      <span style={small}>{width === "support" ? "Width: method support" : "Width: evidence"}</span>
      {WIDTH_STEPS.map((w, i) => widthLabels[i] ? <span key={i} style={item}><svg width="22" height="10" aria-hidden="true"><path d="M1 5H21" stroke="#333" strokeWidth={w}/></svg><span style={small}>{widthLabels[i]}</span></span> : null)}
    </span>
    {hasConfidence && <span style={group} title="Bootstrap confidence: how often the relationship was recovered across cell resamples. Relationships without a verified value are drawn solid.">
      <span style={small}>Opacity: confidence</span>
      {CONFIDENCE_OPACITY.map((o, i) => <span key={i} style={item}><svg width="22" height="10" aria-hidden="true"><path d="M1 5H21" stroke="#333" strokeWidth="2.2" opacity={o}/></svg><span style={small}>{CONFIDENCE_LABELS[i]}</span></span>)}
    </span>}
  </div>;
}
