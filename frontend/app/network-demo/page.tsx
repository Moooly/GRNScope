"use client";

import { useMemo, useState, type CSSProperties } from "react";
import NetworkGraph from "../projects/[projectId]/_components/NetworkGraph";
import { NETWORK_APPEARANCES } from "../projects/[projectId]/_components/networkAppearance";
import type {
  NetworkEdge,
  NetworkNode,
} from "../projects/[projectId]/_components/networkGraphTypes";
import "../projects/[projectId]/_components/networkWorkspace.css";

const PALETTES = NETWORK_APPEARANCES;

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
        <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800 }}>
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
                  background: style === option ? "#0f766e" : "#fff",
                  color: style === option ? "#fff" : "#334155",
                }}
              >
                {option === "braid" ? "Consensus braid" : "Atlas"}
              </button>
            ))}
          </div>
          {style === "braid" && nodes.length > 60 && (
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
              Braid is a focused view (≤60 genes) — showing Atlas at this scale
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

        <div
          className="grn-atlas"
          data-appearance={style}
          style={
            {
              borderRadius: 24,
              overflow: "hidden",
              boxShadow: "0 1px 3px rgba(15,23,42,0.12)",
              "--grn-network-bg": PALETTES[style].background,
              "--grn-network-text": PALETTES[style].text,
              "--grn-network-node": PALETTES[style].node,
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
              methodCount={5}
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
      </div>
    </main>
  );
}
