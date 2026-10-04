"use client";

import type { NetworkEdge, NetworkNode } from "../networkGraphTypes";
import { NETWORK_THEME as T } from "./theme";
import { edgeMetric, hasDirection, relationshipLabel } from "../networkVisualEncoding";

/**
 * What the canvas deliberately does not draw.
 *
 * Direction, sign and agreement are properties of one relationship, and the
 * canvas has no honest way to show them on four hundred hairlines at once --
 * the previous design tried, by moving support and evidence into the arrowhead
 * and then dropping line width, which meant that on an undirected-only run
 * (the common case: PEARSON, PIDC and PPCOR have no direction to give) the
 * entire strength encoding rendered as nothing at all, while the legend went
 * on advertising it.
 *
 * So they live here, where there is room to state them plainly, including when
 * the answer is that the methods cannot say.
 */

type Props = {
  node: NetworkNode | null;
  edge: NetworkEdge | null;
  methodCount: number;
  onClose: () => void;
  onFocus?: (id: string) => void;
};

const LABEL: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  color: "#8796a2",
};

const VALUE: React.CSSProperties = {
  fontSize: 13,
  color: "#2c3a46",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={LABEL}>{label}</span>
      <span style={VALUE}>{value}</span>
    </div>
  );
}

/**
 * "Unresolved" hides two different situations, and the canvas cannot tell them
 * apart -- both are grey, because in both cases there is no sign to believe.
 * Here there is room to say which:
 *
 *   coverage 0   no method reported a sign at all. Absence of information.
 *   coverage > 0 methods reported one and did not agree. Conflicting
 *                information, which is a different thing to know, and the
 *                reason the Sign confidence threshold exists.
 */
function unresolved(coverage: number, methodCount: number, what: string) {
  if (coverage > 0)
    return `Methods disagree on ${what}${
      methodCount > 1 ? ` — ${coverage} of ${methodCount} reported one` : ""
    }`;
  return `No method in this run reports ${what}`;
}

function signText(
  sign: -1 | 0 | 1,
  confidence: number | null,
  coverage: number,
  methodCount: number,
) {
  if (sign === 1)
    return (
      <span style={{ color: T.activates }}>
        Activates{confidence !== null ? ` · ${Math.round(confidence * 100)}% stable` : ""}
      </span>
    );
  if (sign === -1)
    return (
      <span style={{ color: T.represses }}>
        Represses{confidence !== null ? ` · ${Math.round(confidence * 100)}% stable` : ""}
      </span>
    );
  return (
    <span style={{ color: T.unknown }}>
      {unresolved(coverage, methodCount, "the effect")}
    </span>
  );
}

export default function NetworkInspectorPanel({
  node,
  edge,
  methodCount,
  onClose,
  onFocus,
}: Props) {
  if (!node && !edge) return null;

  return (
    <aside
      style={{
        border: "1px solid #e2e9ed",
        borderRadius: 10,
        background: "#ffffff",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        minWidth: 230,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <strong style={{ fontSize: 15, color: "#1f2c37" }}>
          {edge
            ? `${edge.source} — ${edge.target}`
            : (node?.id ?? "")}
        </strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            border: 0,
            background: "transparent",
            color: "#8796a2",
            cursor: "pointer",
            fontSize: 15,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </header>

      {edge ? (
        <>
          <Row
            label="Effect"
            value={signText(
              edge.sign,
              edge.signConfidence,
              edge.signCoverage,
              methodCount,
            )}
          />
          <Row
            label="Agreement"
            value={
              <>
                {edge.supportingAlgorithms.length} of {methodCount} method
                {methodCount === 1 ? "" : "s"}
                <span style={{ color: "#8796a2" }}>
                  {edge.supportingAlgorithms.length
                    ? ` · ${edge.supportingAlgorithms.join(", ")}`
                    : ""}
                </span>
              </>
            }
          />
          <Row
            label="Confidence"
            value={
              Number.isFinite(edge.confidence)
                && edgeMetric(edge, "confidence", methodCount) !== null ? `${Math.round(edge.confidence * 100)}%`
                : "Not available"
            }
          />
          <Row
            label="Direction"
            value={
              hasDirection(edge) ? (
                `${relationshipLabel(edge)} · ${Math.round(
                  (edge.directionConfidence ?? 0) * 100,
                )}% confident`
              ) : (
                <span style={{ color: T.unknown }}>
                  {unresolved(
                    edge.directionCoverage,
                    methodCount,
                    "which gene regulates which",
                  )}
                </span>
              )
            }
          />
        </>
      ) : (
        <>
          <Row
            label="Role"
            value={node?.isTF ? "Transcription factor" : "Target gene"}
          />
          <Row label="Connections" value={node?.degree ?? 0} />
          <Row
            label="Regulates / regulated by"
            value={`${node?.outDegree ?? 0} out · ${node?.inDegree ?? 0} in`}
          />
          {node && onFocus && <button type="button" className="grn-btn" onClick={() => onFocus(node.id)}>Focus neighborhood</button>}
        </>
      )}
    </aside>
  );
}
