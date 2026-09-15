"use client";

import { NETWORK_THEME as T } from "./theme";

/**
 * One legend. The same rows at five genes and at five thousand.
 *
 * The old legend had two completely different bodies and picked between them
 * on node count, because the canvas itself swapped encodings at sixty nodes.
 * Crossing that boundary changed what colour meant, what shape meant, and
 * which controls existed -- so a reader who added one gene to a 59-gene upload
 * had to relearn the figure.
 *
 * Nothing swaps now, so nothing here is conditional. When a channel has
 * nothing to say -- every gene in the upload is a regulator, so the diamond
 * marks all of them -- the row stays exactly where it was and dims, with the
 * reason on hover. A legend that rearranges itself is worse than one that
 * admits a channel is idle.
 */

type Props = {
  /** Fraction of displayed genes that are transcription factors. */
  regulatorShare: number;
  /** Whether any method in this run resolved activation vs repression. */
  hasSign: boolean;
  /** Whether any displayed relationship has no resolved sign at all. */
  hasUnsigned: boolean;
  /** Whether any method in this run resolved which gene regulates which. Only
   * the tooltips change on it: when nothing did, the canvas marks both ends of
   * every relationship, and a reader who notices that deserves to be told why
   * without a second symbol being added to the key. */
  directionResolved: boolean;
};

/** The one fill both node marks use, defined once and referenced by both. */
const NODE_FILL = "url(#grnNodeFill)";

/** Half the width of a mark's box. */
const MARK_R = 5.4;
/** sqrt(pi / 2): the diagonal that gives a diamond a circle's area. */
const EQUAL_AREA = 1.2533;

/**
 * A gene mark, in the two silhouettes the canvas draws.
 *
 * Both are the same fill and the same *area* -- not the same bounding box. A
 * diamond drawn inside a circle's box covers only two thirds of the ink, so
 * matching boxes would quietly make regulators look like the lesser category
 * when the only thing meant to differ is the shape.
 */
function GeneMark({ diamond }: { diamond?: boolean }) {
  const h = MARK_R * EQUAL_AREA;
  return (
    <svg width="19" height="17" aria-hidden="true">
      {diamond ? (
        <path
          d={`M9.5 ${8.5 - h} L${9.5 + h} 8.5 L9.5 ${8.5 + h} L${9.5 - h} 8.5 Z`}
          fill={NODE_FILL}
          strokeLinejoin="round"
        />
      ) : (
        <circle cx="9.5" cy="8.5" r={MARK_R} fill={NODE_FILL} />
      )}
    </svg>
  );
}

/**
 * A relationship, with the mark that names its effect.
 *
 * Single-ended, always, even though the canvas marks both ends of a
 * relationship whose direction no method resolved. The swatch's job is to teach
 * one thing -- this glyph means activation, that one means repression -- and a
 * double-headed arrow reads as a third symbol to decode rather than as the same
 * symbol twice. Where the mark sits is a statement about direction, which is a
 * different fact; it lives in the row's tooltip instead.
 *
 * One glyph vocabulary throughout -- arrowhead for activation, crossbar for
 * repression -- so the swatch matches the canvas whether or not the run
 * resolved a direction. Only the unresolved-effect row varies, and only to
 * follow whether a hollow direction-only tip is being drawn at all.
 */
function EffectMark({
  color,
  glyph,
}: {
  color: string;
  glyph: "triangle" | "circle" | "tee" | "hollow" | "none";
}) {
  const y = 8.5;
  const lineEnd =
    glyph === "triangle" || glyph === "hollow"
      ? 25
      : glyph === "circle"
        ? 26.5
        : glyph === "none"
          ? 33
          : 29;
  return (
    <svg width="34" height="17" aria-hidden="true">
      <path
        d={`M1 ${y} H ${lineEnd}`}
        stroke={color}
        strokeWidth="2.1"
        fill="none"
      />
      {glyph === "triangle" && (
        <path d={`M25 ${y - 4.4} L33 ${y} L25 ${y + 4.4} Z`} fill={color} />
      )}
      {glyph === "hollow" && (
        <path
          d={`M25 ${y - 4.4} L33 ${y} L25 ${y + 4.4} Z`}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      )}
      {glyph === "circle" && <circle cx="30" cy={y} r="3.6" fill={color} />}
      {glyph === "tee" && (
        <path
          d={`M30 ${y - 5} V ${y + 5}`}
          stroke={color}
          strokeWidth="2.6"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </svg>
  );
}

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
  hasUnsigned,
  directionResolved,
}: Props) {
  // A mark that applies to every gene is not marking anything. The row dims
  // in place rather than disappearing, so the legend never changes shape
  // underneath the reader.
  const shapeIdle = regulatorShare >= 0.98 || regulatorShare === 0;

  return (
    <div
      aria-label="Network legend"
      className="grn-legend-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      {/* One gradient for every mark on this row, so the legend cannot drift
          from the canvas or from itself. Zero-sized: it only carries the def. */}
      <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
        <defs>
          <linearGradient id="grnNodeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.nodeTop} />
            <stop offset="100%" stopColor={T.nodeBottom} />
          </linearGradient>
        </defs>
      </svg>

      <span style={ROW}>
        <GeneMark />
        Gene
      </span>

      <span
        style={{ ...ROW, opacity: shapeIdle ? 0.45 : 1 }}
        title={
          shapeIdle
            ? regulatorShare === 0 ? "No transcription factors in this view" : "Every gene in this view is a transcription factor"
            : "Transcription factor — drawn as a diamond"
        }
      >
        <GeneMark diamond />
        Regulator
      </span>

      <span style={DIVIDER} />

      <span style={ROW} title="Node size — displayed relationships, with a compressed size range in dense networks">
        <svg width="33" height="17" aria-hidden="true">
          <circle cx="5.5" cy="8.5" r="3" fill={NODE_FILL} />
          <circle cx="21.5" cy="8.5" r="6.8" fill={NODE_FILL} />
        </svg>
        Connections
      </span>

      {/* Two rows, each naming one thing. The single row this replaced put both
          glyphs in one swatch under the label "Effect", which made the reader
          match mark to meaning themselves -- the one job a legend exists to do. */}
      <span
        style={{ ...ROW, opacity: hasSign ? 1 : 0.45 }}
        title={
          directionResolved
            ? "Activation. The arrowhead sits on the regulated gene."
            : "Activation. No method in this run resolved which gene regulates which, so both ends are marked."
        }
      >
        <EffectMark color={T.activates} glyph="triangle" />
        Activation
      </span>

      <span
        style={{ ...ROW, opacity: hasSign ? 1 : 0.45 }}
        title={
          directionResolved
            ? "Repression. The bar sits on the regulated gene."
            : "Repression. No method in this run resolved which gene regulates which, so the mark is drawn at both ends."
        }
      >
        <EffectMark color={T.represses} glyph="tee" />
        Repression
      </span>

      {/* Grey is a value, not an absence. It dims when nothing in view is
          unsigned rather than disappearing, so the legend keeps its shape --
          a row that comes and goes as the reader drags a threshold is worse
          than one that admits its channel is idle. */}
      <span
        style={{ ...ROW, opacity: hasUnsigned ? 1 : 0.45 }}
        title={
          hasUnsigned
            ? "No method resolved whether this relationship activates or represses. Select it to see whether the methods disagreed or simply never reported a sign."
            : "Every relationship in this view has a resolved effect."
        }
      >
        <EffectMark
          color={T.unknown}
          glyph={directionResolved ? "hollow" : "none"}
        />
        Effect unresolved
      </span>

      <span style={ROW} title="Link thickness — how strong the evidence is">
        <svg width="34" height="16" aria-hidden="true">
          <path d="M2 8 H 15" stroke={T.link} strokeWidth="1.3" fill="none" />
          <path d="M17 8 H 32" stroke={T.link} strokeWidth="3.6" fill="none" />
        </svg>
        Evidence
      </span>
    </div>
  );
}
