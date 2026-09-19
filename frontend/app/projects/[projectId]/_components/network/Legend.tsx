"use client";

import { NETWORK_THEME as T } from "./theme";

type Props = {
  regulatorShare: number;
  hasSign: boolean;
  hasUnsigned: boolean;
  directionResolved: boolean;
};
const item: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" };

export default function NetworkLegendBar({ regulatorShare, hasSign, hasUnsigned, directionResolved }: Props) {
  return <div className="grn-legend-bar publication-legend" aria-label="Network legend">
    <span style={item}><svg width="18" height="18" aria-hidden="true"><circle cx="9" cy="9" r="5" fill={T.node} stroke={T.nodeRim} strokeWidth="0.5" /></svg>Other gene</span>
    <span style={item} title={`${Math.round(regulatorShare * 100)}% of displayed genes are transcription factors`}><svg width="18" height="18" aria-hidden="true"><circle cx="9" cy="9" r="5" fill={T.tf} stroke={T.tfRim} strokeWidth="0.5" /></svg>Transcription factor</span>
    <span style={item} title="Size increases with incident relationships in the displayed network; it does not measure biological importance."><svg width="36" height="18" aria-hidden="true"><circle cx="6" cy="9" r="3" fill={T.node}/><circle cx="25" cy="9" r="7" fill={T.node}/></svg>Size: displayed connections</span>
    <span style={item} title={hasSign ? "Colour shows predicted sign" : "No sign has been resolved in this view"}><svg width="25" height="18" aria-hidden="true"><path d="M1 9H19" stroke={T.activates} strokeWidth="1.5"/><path d="M17 4L24 9L17 14Z" fill={T.activates}/></svg>Activation</span>
    <span style={item}><svg width="25" height="18" aria-hidden="true"><path d="M1 9H22M22 3V15" stroke={T.represses} strokeWidth="1.5" fill="none"/></svg>Repression</span>
    {hasUnsigned && <span style={item}><svg width="25" height="18" aria-hidden="true"><path d="M1 9H24" stroke={T.unknown} strokeWidth="1.5"/></svg>Sign unresolved</span>}
    <span style={item} title="End marks are drawn only when direction is supported. Dashed negative links have unresolved direction.">
      {directionResolved && <svg width="53" height="18" aria-hidden="true"><path d="M1 9H17M30 9H48M48 4V14" stroke={T.label} fill="none"/><path d="M14 5L21 9L14 13Z" fill={T.label}/></svg>}
      {directionResolved ? "Arrow / bar: regulated end · No tip: direction unresolved" : "No tips: direction unresolved"}
    </span>
  </div>;
}
