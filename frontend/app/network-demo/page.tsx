"use client";

import { useMemo, useState, type CSSProperties } from "react";
import NetworkGraph from "../projects/[projectId]/_components/NetworkGraph";
import {
  BRAID_MAX_NODES,
  NETWORK_APPEARANCES,
  resolveNetworkAppearance,
} from "../projects/[projectId]/_components/networkAppearance";
import {
  MODULE_COLORS,
  MODULE_NEUTRAL,
} from "../projects/[projectId]/_components/networkModules";
import type {
  NetworkEdge,
  NetworkNode,
} from "../projects/[projectId]/_components/networkGraphTypes";
import "../projects/[projectId]/_components/networkWorkspace.css";

const PALETTES = NETWORK_APPEARANCES;


const INK = "#4a5b6b";
const TF_FILL = "#1b75a6";
const TF_RING = "#61d0c4";
const GENE_FILL = "#dfeaf2";
const GENE_EDGE = "#a8c3d5";

/** A labelled cluster of legend keys, so the reader scans three groups rather
 * than eight equal-weight phrases. */
function LegendGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#9aa8b6",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}

/** Icon carries the encoding, the word names the metric, and the long
 * explanation waits in the tooltip instead of crowding the bar. */
function LegendItem({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={hint}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        whiteSpace: "nowrap",
        cursor: "help",
      }}
    >
      {children}
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "#334155" }}>
        {label}
      </span>
    </span>
  );
}

// Deterministic PRNG so a given size always renders the same network.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const METHODS = [
  "GENIE3", "GRNBOOST2", "PIDC", "PPCOR", "SINCERITIES", "SCRIBE",
  "SINGE", "GRISLI", "GRNVBEM", "LEAP", "SCODE", "PEARSON",
];

const GONAD_GENES = [
  "SRY", "SOX9", "NR5A1", "WT1pKTS", "WT1mKTS", "GATA4", "DMRT1", "FGF9",
  "AMH", "NR0B1", "CBX2", "FOXL2", "WNT4", "RSPO1", "CTNNB1", "DKK1",
  "DHH", "PGD2", "UGR",
];

function geneName(index: number) {
  return index < GONAD_GENES.length
    ? GONAD_GENES[index]
    : `GENE${String(index + 1).padStart(4, "0")}`;
}

// Synthetic GRN generator.
//  - Small networks: a few transcription factors with many targets (a clean
//    star, like a curated benchmark network).
//  - Large networks: modular communities, each with local TF hubs and sparse
//    bridges between them, so the layout resolves into separable islands
//    instead of one hairball -- the structure real regulatory atlases show.
function generateNetwork(size: number): {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
} {
  const rand = mulberry32(size * 2654435761);
  const outDegree = new Array(size).fill(0);
  const inDegree = new Array(size).fill(0);
  const isTF = new Array<boolean>(size).fill(false);
  const seen = new Set<string>();
  const edges: NetworkEdge[] = [];

  const addEdge = (s: number, t: number) => {
    if (s === t) return;
    const key = `${geneName(s)}|||${geneName(t)}`;
    if (seen.has(key) || seen.has(`${geneName(t)}|||${geneName(s)}`)) return;
    seen.add(key);
    outDegree[s] += 1;
    inDegree[t] += 1;
    const sign: -1 | 1 = rand() < 0.65 ? 1 : -1;
    // Skewed so most links have thin support and a few are broadly agreed.
    const support = Math.max(
      1,
      Math.min(METHODS.length, Math.round(Math.pow(rand(), 1.7) * METHODS.length)),
    );
    const offset = Math.floor(rand() * METHODS.length);
    const methods = Array.from(
      { length: support },
      (_, k) => METHODS[(offset + k) % METHODS.length],
    );
    edges.push({
      key,
      source: geneName(s),
      target: geneName(t),
      score: 0.2 + rand() * 0.75,
      confidence: 0.35 + rand() * 0.62,
      bootstrapVerified: true,
      count: support,
      rank: edges.length + 1,
      supportingAlgorithms: methods,
      direction: 1,
      directionConfidence: 0.5 + rand() * 0.5,
      directionCoverage: 1,
      sign,
      signConfidence: 0.5 + rand() * 0.5,
      signCoverage: 1,
    });
  };

  const pickPreferential = (candidates: number[]) => {
    const total = candidates.reduce((a, i) => a + outDegree[i] + 1, 0);
    let roll = rand() * total;
    for (const i of candidates) {
      roll -= outDegree[i] + 1;
      if (roll <= 0) return i;
    }
    return candidates[0];
  };

  if (size <= 60) {
    const tfCount = Math.max(3, Math.round(size * 0.18));
    for (let i = 0; i < tfCount; i += 1) isTF[i] = true;
    const tfs = Array.from({ length: tfCount }, (_, i) => i);
    for (let i = 1; i < tfCount; i += 1) {
      const links = 1 + Math.floor(rand() * 2);
      for (let l = 0; l < links; l += 1)
        addEdge(pickPreferential(tfs.slice(0, i)), i);
    }
    for (let t = tfCount; t < size; t += 1) {
      const regulators = 1 + Math.floor(rand() * 3);
      for (let r = 0; r < regulators; r += 1) addEdge(pickPreferential(tfs), t);
    }
  } else {
    const numModules = Math.max(5, Math.min(16, Math.round(size / 150)));
    const bounds: number[] = [];
    for (let m = 0; m < numModules; m += 1)
      bounds.push(Math.floor((m * size) / numModules));
    bounds.push(size);
    const moduleTFs: number[][] = [];
    for (let m = 0; m < numModules; m += 1) {
      const start = bounds[m];
      const end = bounds[m + 1];
      const localTFs = Math.max(1, Math.round((end - start) * 0.1));
      const tfs: number[] = [];
      for (let k = 0; k < localTFs; k += 1) {
        isTF[start + k] = true;
        tfs.push(start + k);
      }
      moduleTFs.push(tfs);
      for (let k = 1; k < tfs.length; k += 1) addEdge(tfs[k - 1], tfs[k]);
      for (let g = start + localTFs; g < end; g += 1) {
        const regulators = 1 + Math.floor(rand() * 2);
        for (let r = 0; r < regulators; r += 1)
          addEdge(pickPreferential(tfs), g);
      }
    }
    // Sparse bridges between neighbouring module hubs keep it one network.
    for (let m = 0; m < numModules; m += 1) {
      addEdge(moduleTFs[m][0], moduleTFs[(m + 1) % numModules][0]);
      if (rand() < 0.4)
        addEdge(moduleTFs[m][0], moduleTFs[(m + 2) % numModules][0]);
    }
  }

  const nodes: NetworkNode[] = Array.from({ length: size }, (_, i) => ({
    id: geneName(i),
    inDegree: inDegree[i],
    outDegree: outDegree[i],
    degree: inDegree[i] + outDegree[i],
    isTF: isTF[i],
  }));

  return { nodes, edges };
}

const SIZES = [19, 200, 800, 2000];

export default function NetworkDemoPage() {
  const [size, setSize] = useState(19);
  const [selectedGene, setSelectedGene] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  // The renderer falls back to atlas past 60 genes; reflect what is really shown.
  const [minStrength, setMinStrength] = useState(0);
  const [style, setStyle] = useState<"braid" | "atlas">("braid");
  const base = useMemo(() => generateNetwork(size), [size]);
  const { nodes, edges } = useMemo(() => {
    if (minStrength <= 0) return base;
    const keptEdges = base.edges.filter((e) => e.confidence >= minStrength);
    const connected = new Set<string>();
    keptEdges.forEach((e) => {
      connected.add(e.source);
      connected.add(e.target);
    });
    const keptNodes = base.nodes.filter((n) => connected.has(n.id));
    return {
      nodes: keptNodes.length ? keptNodes : base.nodes,
      edges: keptEdges,
    };
  }, [base, minStrength]);

  const effective: "braid" | "atlas" =
    resolveNetworkAppearance(style, nodes.length) as "braid" | "atlas";
  const selectedEdge = edges.find((e) => e.key === selectedEdgeKey) ?? null;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#eef2f7",
        padding: "20px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "#0f172a" }}>
          Regulatory atlas — force network preview
        </h1>
        <p style={{ margin: "0 0 14px", color: "#475569", fontSize: 14 }}>
          The rebuilt Cytoscape.js force view (fcose layout) in the new
          screenshot style. Switch scale to see it hold from a curated network
          to a transcriptome-scale one. Click a gene to trace its regulation.
        </p>

        <div
          style={{
            display: "flex",
            gap: 16,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            {SIZES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setSelectedGene(null);
                  setSelectedEdgeKey(null);
                  setSize(value);
                }}
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: "1px solid #cbd5e1",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  background: size === value ? "#1b75a6" : "#fff",
                  color: size === value ? "#fff" : "#334155",
                }}
              >
                {value.toLocaleString()} genes
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["braid", "atlas"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setStyle(option)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: "1px solid #cbd5e1",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  background: effective === option ? "#0f766e" : "#fff",
                  color: effective === option ? "#fff" : "#334155",
                }}
              >
                {option === "braid" ? "Focused consensus" : "Atlas"}
              </button>
            ))}
          </div>
          {style === "braid" && nodes.length > BRAID_MAX_NODES && (
            <span
              style={{
                color: "#92400e",
                background: "#fef3c7",
                border: "1px solid #fde68a",
                borderRadius: 8,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {`Focused view (≤${BRAID_MAX_NODES} genes) — showing Atlas at this scale`}
            </span>
          )}
          <span style={{ color: "#64748b", fontSize: 13 }}>
            {nodes.length.toLocaleString()} genes ·{" "}
            {edges.length.toLocaleString()} relationships
          </span>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#475569",
              fontSize: 13,
            }}
          >
            <span>Min. edge strength</span>
            <input
              type="range"
              min={0}
              max={90}
              step={5}
              value={Math.round(minStrength * 100)}
              onChange={(event) =>
                setMinStrength(Number(event.target.value) / 100)
              }
            />
            <b style={{ minWidth: 34 }}>
              {minStrength > 0 ? `${Math.round(minStrength * 100)}%` : "Off"}
            </b>
          </label>
        </div>

        {effective === "braid" && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "10px 26px",
              padding: "10px 16px",
              marginBottom: 10,
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              color: "#475569",
            }}
          >
            <LegendGroup title="Link">
              <LegendItem
                label="Activates"
                hint="The regulator increases its target's expression"
              >
                <svg width="30" height="12" aria-hidden="true">
                  <path d="M1 6h17" stroke={PALETTES.braid.positive} strokeWidth="2" />
                  <path d="M17 1.5L28 6L17 10.5Z" fill={PALETTES.braid.positive} />
                </svg>
              </LegendItem>
              <LegendItem
                label="Represses"
                hint="The regulator decreases its target's expression"
              >
                <svg width="30" height="12" aria-hidden="true">
                  <path d="M1 6h23" stroke={PALETTES.braid.negative} strokeWidth="2" />
                  <path d="M25 1v10" stroke={PALETTES.braid.negative} strokeWidth="2.6" />
                </svg>
              </LegendItem>
            </LegendGroup>

            <LegendGroup title="Strength">
              <LegendItem
                label="Agreement"
                hint="Arrowhead size — how many inference methods called this relationship"
              >
                {/* Size varies, fill held constant. */}
                <svg width="36" height="14" aria-hidden="true">
                  <path d="M1 7h10" stroke={INK} strokeWidth="1.5" />
                  <path d="M10 5L14 7L10 9Z" fill={INK} />
                  <path d="M19 7h5" stroke={INK} strokeWidth="1.5" />
                  <path d="M24 1L35 7L24 13Z" fill={INK} />
                </svg>
              </LegendItem>
              <LegendItem
                label="Evidence"
                hint="Arrowhead fill — solid means this regulator is among the stronger explanations for its target"
              >
                {/* Fill varies, size held constant. */}
                <svg width="36" height="14" aria-hidden="true">
                  <path d="M1 7h8" stroke={INK} strokeWidth="1.6" />
                  <path
                    d="M9 2.6L16 7L9 11.4Z"
                    fill="#fff"
                    stroke={INK}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <path d="M21 7h8" stroke={INK} strokeWidth="1.6" />
                  <path d="M29 2.6L36 7L29 11.4Z" fill={INK} />
                </svg>
              </LegendItem>
              <LegendItem
                label="Confidence"
                hint="Line darkness — bootstrap confidence in the relationship"
              >
                <svg width="34" height="14" aria-hidden="true">
                  <defs>
                    {/* userSpaceOnUse: a horizontal stroke has a zero-height
                        bounding box, which makes the default objectBoundingBox
                        units degenerate and the gradient render as nothing. */}
                    <linearGradient
                      id="grnConfidenceRamp"
                      gradientUnits="userSpaceOnUse"
                      x1="1"
                      y1="0"
                      x2="33"
                      y2="0"
                    >
                      <stop offset="0%" stopColor={INK} stopOpacity="0.16" />
                      <stop offset="100%" stopColor={INK} stopOpacity="1" />
                    </linearGradient>
                  </defs>
                  <path d="M1 7h32" stroke="url(#grnConfidenceRamp)" strokeWidth="3" />
                </svg>
              </LegendItem>
            </LegendGroup>

            <LegendGroup title="Gene">
              <LegendItem label="TF" hint="Transcription factor">
                <svg width="18" height="18" aria-hidden="true">
                  <circle cx="9" cy="9" r="6.5" fill={TF_FILL} stroke={TF_RING} strokeWidth="2" />
                </svg>
              </LegendItem>
              <LegendItem label="Target" hint="Regulated gene">
                <svg width="18" height="18" aria-hidden="true">
                  <circle cx="9" cy="9" r="6" fill={GENE_FILL} stroke={GENE_EDGE} strokeWidth="1.5" />
                </svg>
              </LegendItem>
              <LegendItem
                label="Connections"
                hint="Node size — number of regulatory links the gene takes part in"
              >
                <svg width="34" height="18" aria-hidden="true">
                  <circle cx="6" cy="9" r="3.5" fill={GENE_FILL} stroke={GENE_EDGE} strokeWidth="1.3" />
                  <circle cx="22" cy="9" r="7.5" fill={GENE_FILL} stroke={GENE_EDGE} strokeWidth="1.3" />
                </svg>
              </LegendItem>
            </LegendGroup>
          </div>
        )}
        {effective === "atlas" && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "10px 26px",
              padding: "10px 16px",
              marginBottom: 10,
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              color: "#475569",
            }}
          >
            <LegendGroup title="Colour">
              <LegendItem
                label="Regulatory module"
                hint="Genes reached by the same master regulator before any other one"
              >
                <svg width="46" height="14" aria-hidden="true">
                  {MODULE_COLORS.slice(0, 6).map((color, index) => (
                    <circle
                      key={color}
                      cx={5 + index * 7.6}
                      cy={7}
                      r={3.4}
                      fill={color}
                    />
                  ))}
                </svg>
              </LegendItem>
              <LegendItem
                label="Outside"
                hint="Genes more than four steps from any of the main hubs"
              >
                <svg width="16" height="14" aria-hidden="true">
                  <circle cx="7" cy="7" r="3.4" fill={MODULE_NEUTRAL} />
                </svg>
              </LegendItem>
              <LegendItem
                label="Bridge"
                hint="A relationship linking two different modules"
              >
                <svg width="26" height="14" aria-hidden="true">
                  <path d="M1 7h24" stroke="#b9c6d1" strokeWidth="2" />
                </svg>
              </LegendItem>
            </LegendGroup>

            <LegendGroup title="Shape">
              <LegendItem label="TF" hint="Transcription factor">
                <svg width="18" height="16" aria-hidden="true">
                  <rect x="4" y="2" width="10" height="10" fill="#3e6d88" transform="rotate(45 9 7)" />
                </svg>
              </LegendItem>
              <LegendItem label="Target" hint="Regulated gene">
                <svg width="16" height="16" aria-hidden="true">
                  <circle cx="8" cy="8" r="5" fill="#3e6d88" />
                </svg>
              </LegendItem>
              <LegendItem
                label="Size = connections"
                hint="Node size grows with the number of regulatory links"
              >
                <svg width="30" height="16" aria-hidden="true">
                  <circle cx="5" cy="8" r="2.6" fill="#7a9bb0" />
                  <circle cx="19" cy="8" r="6" fill="#7a9bb0" />
                </svg>
              </LegendItem>
            </LegendGroup>

            <span style={{ fontSize: 12, color: "#8496a6", fontStyle: "italic" }}>
              Zoom in to see activation and repression
            </span>
          </div>
        )}
        <div
          className="grn-atlas"
          data-appearance={effective}
          style={
            {
              borderRadius: 24,
              overflow: "hidden",
              boxShadow: "0 1px 3px rgba(15,23,42,0.12)",
              "--grn-network-bg": PALETTES[effective].background,
              "--grn-network-text": PALETTES[effective].text,
              "--grn-network-node": PALETTES[effective].node,
            } as CSSProperties
          }
        >
          <div className="grn-graph-region">
            <NetworkGraph
              nodes={nodes}
              edges={edges}
              layout="force"
              appearance={style}
              metric="confidence"
              methodCount={METHODS.length}
              selectedGene={selectedGene}
              selectedEdgeKey={selectedEdgeKey}
              onSelectGene={(gene) => {
                setSelectedGene(gene);
                setSelectedEdgeKey(null);
              }}
              onSelectEdge={(edge) => {
                setSelectedEdgeKey(edge);
                setSelectedGene(null);
              }}
            />
          </div>
        </div>

        {selectedEdge && (
          <div
            style={{
              marginTop: 10,
              padding: "12px 14px",
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              fontSize: 13,
              color: "#334155",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <strong style={{ fontSize: 15, color: "#0f172a" }}>
                {selectedEdge.source}{" "}
                {selectedEdge.sign < 0 ? "⊣" : "→"} {selectedEdge.target}
              </strong>
              <span
                style={{
                  color: selectedEdge.sign < 0 ? "#c4693a" : "#2f8f7f",
                  fontWeight: 700,
                }}
              >
                {selectedEdge.sign < 0 ? "Repression" : "Activation"}
              </span>
              <span style={{ color: "#64748b" }}>
                Confidence {Math.round(selectedEdge.confidence * 100)}% ·
                Evidence {selectedEdge.score.toFixed(2)} · Support{" "}
                {selectedEdge.supportingAlgorithms.length}/{METHODS.length}
              </span>
              <button
                type="button"
                onClick={() => setSelectedEdgeKey(null)}
                style={{
                  marginLeft: "auto",
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  borderRadius: 8,
                  padding: "3px 9px",
                  cursor: "pointer",
                  color: "#475569",
                }}
              >
                Close
              </button>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 10,
              }}
            >
              {selectedEdge.supportingAlgorithms.map((method) => (
                <span
                  key={method}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 9px",
                    borderRadius: 999,
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {method}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
