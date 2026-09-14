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

function signText(sign: -1 | 0 | 1, confidence: number | null) {
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
  return <span style={{ color: T.unknown }}>Direction of effect not resolved</span>;
}

export default function NetworkInspectorPanel({
  node,
  edge,
  methodCount,
  onClose,
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
          <Row label="Effect" value={signText(edge.sign, edge.signConfidence)} />
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
                  Undirected — none of the methods in this run infer direction
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
        </>
      )}
    </aside>
  );
}
