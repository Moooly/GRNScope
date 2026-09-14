"use client";

import { NETWORK_THEME as T } from "./theme";

/**
 * One legend. The same five rows at five genes and at five thousand.
 *
 * The old legend had two completely different bodies and picked between them
 * on node count, because the canvas itself swapped encodings at sixty nodes.
 * Crossing that boundary changed what colour meant, what shape meant, and
 * which controls existed -- so a reader who added one gene to a 59-gene upload
 * had to relearn the figure.
 *
 * Nothing swaps now, so nothing here is conditional. When a channel has
 * nothing to say -- every gene in the upload is a regulator, so the ring marks
 * all of them -- the row stays exactly where it was and dims, with the reason
 * on hover. A legend that rearranges itself is worse than one that admits a
 * channel is idle.
 */

type Props = {
  /** Fraction of displayed genes that are transcription factors. */
  regulatorShare: number;
  /** Whether any method in this run resolved a direction of effect. */
  hasSign: boolean;
  /** Whether anything is currently selected, so the accent row is live. */
  hasSelection: boolean;
};

const ROW: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  fontSize: 11,
  letterSpacing: 0.2,
  color: "#5b6b78",
  whiteSpace: "nowrap",
};

const DIVIDER: React.CSSProperties = {
  width: 1,
  height: 14,
  background: "#dfe6eb",
};

export default function NetworkLegendBar({
  regulatorShare,
  hasSign,
  hasSelection,
}: Props) {
  // A mark that applies to every gene is not marking anything. The row dims
  // in place rather than disappearing, so the legend never changes shape
  // underneath the reader.
  const shapeIdle = regulatorShare >= 0.98 || regulatorShare === 0;

  return (
    <div
      aria-label="Network legend"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        padding: "8px 2px",
      }}
    >
      <span style={ROW}>
        <svg width="16" height="16" aria-hidden="true">
          <circle
            cx="8"
            cy="8"
            r="5"
            fill={T.node}
            stroke={T.nodeRim}
            strokeWidth="1"
          />
        </svg>
        Gene
      </span>

      <span
        style={{ ...ROW, opacity: shapeIdle ? 0.45 : 1 }}
        title={
          shapeIdle
            ? regulatorShare === 0 ? "No transcription factors in this view" : "Every gene in this view is a transcription factor"
            : "Transcription factor"
        }
      >
        <svg width="17" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" fill={T.node} stroke="#548d85" strokeWidth="1.8" />
        </svg>
        Regulator
      </span>

      <span style={DIVIDER} />

      <span style={ROW} title="Node size — relationships this gene takes part in">
        <svg width="34" height="16" aria-hidden="true">
          <circle cx="6" cy="8" r="3" fill={T.node} stroke={T.nodeRim} strokeWidth="1" />
          <circle cx="22" cy="8" r="7" fill={T.node} stroke={T.nodeRim} strokeWidth="1" />
        </svg>
        Connections
      </span>

      <span
        style={{ ...ROW, opacity: hasSign ? 1 : 0.45 }}
        title={
          hasSign
            ? "Teal: activation or unresolved effect; clay: repression. Select a relationship or zoom in to see resolved direction."
            : "Teal links have unresolved effect. Select a relationship to inspect its evidence."
        }
      >
        <svg width="44" height="17" aria-hidden="true">
          <path d="M2 5 H 30" stroke={T.activates} strokeWidth="2.2" fill="none" />
          <path d="M30 1.6 L 38 5 L 30 8.4 Z" fill={T.activates} />
          <path d="M2 12 H 34" stroke={T.represses} strokeWidth="2.2" fill="none" />
          <path d="M34.6 8.4 V 15.6" stroke={T.represses} strokeWidth="2.6" fill="none" />
        </svg>
        Effect · select for direction
      </span>

      <span style={ROW} title="Link thickness — how strong the evidence is">
        <svg width="34" height="16" aria-hidden="true">
          <path d="M2 8 H 15" stroke={T.link} strokeWidth="1.3" fill="none" />
          <path d="M17 8 H 32" stroke={T.link} strokeWidth="3.6" fill="none" />
        </svg>
        Evidence
      </span>

      <span style={DIVIDER} />

      <span
        style={{ ...ROW, opacity: hasSelection ? 1 : 0.55 }}
        title="Click any gene or link: it and everything it reaches take the accent, and the rest of the network steps back"
      >
        <svg width="30" height="16" aria-hidden="true">
          <path d="M3 8 H 27" stroke={T.accent} strokeWidth="2" fill="none" />
          <circle cx="9" cy="8" r="4.5" fill={T.accent} />
          <circle
            cx="23"
            cy="8"
            r="4"
            fill={T.accentSoft}
            stroke={T.accent}
            strokeWidth="1.4"
          />
        </svg>
        Selection
      </span>
    </div>
  );
}
