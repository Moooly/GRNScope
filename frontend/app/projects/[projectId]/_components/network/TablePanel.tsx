"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NetworkEdge, NetworkNode } from "../networkGraphTypes";
import { hasDirection } from "../networkVisualEncoding";
import { PALETTES, DEFAULT_PALETTE, type PaletteName } from "./theme";
import { nodeDegrees } from "./model";

/**
 * The exact numbers behind the network, beside it. Links and Genes share the
 * figure's filters; a gene or link selected in either place is selected in
 * both. Replaces the old pop-up inspector for the force canvas.
 */
type Props = {
  edges: NetworkEdge[];
  nodes: NetworkNode[];
  methodCount: number;
  selectedGene: string | null;
  selectedEdgeKey: string | null;
  onSelectGene: (id: string | null) => void;
  onSelectEdge: (key: string | null) => void;
  onHoverEdge: (key: string | null) => void;
  onHide: () => void;
  onFocus?: (id: string) => void;
  palette?: PaletteName;
};

type LinkKey = "regulator" | "target" | "evidence" | "confidence" | "methods";
type GeneKey = "gene" | "targets" | "regulators" | "unknown" | "total";
type Row = { edge: NetworkEdge; regulator: string; target: string; directed: boolean };
const LIMIT = 300;

const pct = (v: number | null | undefined) => typeof v === "number" && Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—";

function orient(edge: NetworkEdge): Row {
  const directed = hasDirection(edge);
  const reversed = directed && edge.direction === -1;
  return { edge, directed, regulator: reversed ? edge.target : edge.source, target: reversed ? edge.source : edge.target };
}

function csv(rows: string[][]) {
  return rows.map(r => r.map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(",")).join("\n");
}

export default function NetworkTablePanel({ edges, nodes, methodCount, selectedGene, selectedEdgeKey, onSelectGene, onSelectEdge, onHoverEdge, onHide, onFocus, palette = DEFAULT_PALETTE }: Props) {
  const T = PALETTES[palette];
  const [tab, setTab] = useState<"links" | "genes">("links");
  const [linkSort, setLinkSort] = useState<{ key: LinkKey; desc: boolean }>({ key: "evidence", desc: true });
  const [geneSort, setGeneSort] = useState<{ key: GeneKey; desc: boolean }>({ key: "total", desc: true });
  const [showAll, setShowAll] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const selectedEdge = selectedEdgeKey ? edges.find(e => e.key === selectedEdgeKey) ?? null : null;
  const allRows = useMemo(() => edges.map(orient), [edges]);
  const rows = useMemo(() => {
    const scoped = selectedGene ? allRows.filter(r => r.edge.source === selectedGene || r.edge.target === selectedGene) : allRows;
    const value = (r: Row): number | string => linkSort.key === "regulator" ? r.regulator : linkSort.key === "target" ? r.target
      : linkSort.key === "evidence" ? r.edge.score : linkSort.key === "confidence" ? (r.edge.bootstrapVerified ? r.edge.confidence : -1) : r.edge.count;
    return [...scoped].sort((a, b) => {
      const x = value(a), y = value(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return (linkSort.desc ? -c : c) || b.edge.score - a.edge.score;
    });
  }, [allRows, selectedGene, linkSort]);

  const genes = useMemo(() => {
    const d = nodeDegrees(edges);
    const list = nodes.map(n => ({ id: n.id, tf: n.isTF, targets: d.out.get(n.id) ?? 0, regulators: d.in.get(n.id) ?? 0, unknown: d.unknown.get(n.id) ?? 0, total: d.all.get(n.id) ?? 0 }));
    const k = geneSort.key;
    return list.sort((a, b) => {
      const c = k === "gene" ? a.id.localeCompare(b.id) : a[k] - b[k];
      return (geneSort.desc ? -c : c) || a.id.localeCompare(b.id);
    });
  }, [edges, nodes, geneSort]);
  const anyDirected = edges.some(hasDirection);
  const anyUnknown = genes.some(g => g.unknown > 0);

  // Keep the selected link in view when it is chosen in the network.
  useEffect(() => {
    if (!selectedEdgeKey || !bodyRef.current) return;
    bodyRef.current.querySelector(`[data-key="${CSS.escape(selectedEdgeKey)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedEdgeKey]);

  const sortLink = (key: LinkKey) => setLinkSort(s => ({ key, desc: s.key === key ? !s.desc : key !== "regulator" && key !== "target" }));
  const sortGene = (key: GeneKey) => setGeneSort(s => ({ key, desc: s.key === key ? !s.desc : key !== "gene" }));
  const arrow = (on: boolean, desc: boolean) => on ? <span aria-hidden="true">{desc ? " ▾" : " ▴"}</span> : null;

  const glyph = (r: Row) => {
    // Same scheme as the network: tip = sign, dashed = direction unknown.
    const col = T.activates, dash = r.directed ? undefined : "3 2.5";
    const what = `${r.edge.sign === 1 ? "activates" : r.edge.sign === -1 ? "represses" : "sign unknown"}${r.directed ? "" : ", direction unknown"}`;
    if (r.edge.sign === -1) return <svg width="20" height="10" aria-label={what}><path d="M1 5H18" stroke={col} strokeWidth="1.6" strokeDasharray={dash}/><path d="M18 .5V9.5" stroke={col} strokeWidth="1.8"/></svg>;
    if (r.edge.sign === 1) return <svg width="20" height="10" aria-label={what}><path d="M1 5H12" stroke={col} strokeWidth="1.6" strokeDasharray={dash}/><path d="M11 1L19 5L11 9Z" fill={col}/></svg>;
    return <svg width="20" height="10" aria-label={what}><path d="M1 5H19" stroke={col} strokeWidth="1.6" strokeDasharray={dash}/></svg>;
  };

  const download = () => {
    const data = tab === "links"
      ? [["regulator", "target", "effect", "direction_resolved", "evidence", "bootstrap_confidence", "methods", "method_names"],
         ...rows.map(r => [r.regulator, r.target, r.edge.sign === 1 ? "activation" : r.edge.sign === -1 ? "repression" : "unknown", r.directed ? "yes" : "no", r.edge.score.toFixed(3), r.edge.bootstrapVerified ? r.edge.confidence.toFixed(3) : "", String(r.edge.count), r.edge.supportingAlgorithms.join(";")])]
      : [["gene", "transcription_factor", "targets", "regulators", "direction_unknown", "total_links"], ...genes.map(g => [g.id, g.tf ? "yes" : "no", String(g.targets), String(g.regulators), String(g.unknown), String(g.total)])];
    const url = URL.createObjectURL(new Blob([csv(data)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `network-${tab}${selectedGene ? `-${selectedGene}` : ""}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const selectedInfo = (() => {
    if (selectedEdge) {
      const r = orient(selectedEdge);
      return <div className="tp-chip">
        <span>Selected <i>{r.regulator}</i> {glyph(r)} <i>{r.target}</i></span>
        <button type="button" className="tp-x" aria-label="Clear selection" onClick={() => onSelectEdge(null)}>✕</button>
        <dl className="tp-detail">
          <dt>Evidence</dt><dd>{selectedEdge.score.toFixed(3)}</dd>
          <dt>Confidence</dt><dd>{selectedEdge.bootstrapVerified ? pct(selectedEdge.confidence) : "not verified"}</dd>
          <dt>Methods</dt><dd>{selectedEdge.count} / {methodCount}{selectedEdge.supportingAlgorithms.length ? ` · ${selectedEdge.supportingAlgorithms.join(", ")}` : ""}</dd>
          <dt>Direction</dt><dd>{r.directed ? `resolved · ${pct(selectedEdge.directionConfidence)} agreement` : "not resolved"}</dd>
          <dt>Sign</dt><dd>{selectedEdge.sign === 0 ? "not resolved" : `${selectedEdge.sign === 1 ? "activation" : "repression"} · ${pct(selectedEdge.signConfidence)} stable`}</dd>
        </dl>
      </div>;
    }
    if (selectedGene) {
      const g = genes.find(x => x.id === selectedGene);
      if (!g) return null;
      return <div className="tp-chip">
        <span>Selected <i>{g.id}</i> · {g.total} {g.total === 1 ? "link" : "links"}{anyDirected ? ` · regulates ${g.targets}, regulated by ${g.regulators}` : ""}{g.unknown && anyDirected ? `, ${g.unknown} unknown` : ""}</span>
        {onFocus && <button type="button" className="tp-link" onClick={() => onFocus(g.id)} title="Show only this gene's neighbourhood">Focus</button>}
        <button type="button" className="tp-x" aria-label="Clear selection" onClick={() => onSelectGene(null)}>✕</button>
      </div>;
    }
    return null;
  })();

  const shownRows = showAll ? rows : rows.slice(0, LIMIT);
  return <aside className="tp" aria-label="Network table">
    <div className="tp-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === "links"} onClick={() => setTab("links")}>Links</button>
      <button type="button" role="tab" aria-selected={tab === "genes"} onClick={() => setTab("genes")}>Genes</button>
      <button type="button" className="tp-hide" onClick={onHide} aria-label="Hide table" title="Hide table">⟩</button>
    </div>
    {selectedInfo}
    <div className="tp-body" ref={bodyRef} onMouseLeave={() => onHoverEdge(null)}>
      {tab === "links" ? <table>
        <thead><tr>
          <th onClick={() => sortLink("regulator")}>{anyDirected ? "Regulator" : "Gene"}{arrow(linkSort.key === "regulator", linkSort.desc)}</th>
          <th aria-label="Effect" />
          <th onClick={() => sortLink("target")}>{anyDirected ? "Target" : "Gene"}{arrow(linkSort.key === "target", linkSort.desc)}</th>
          <th className="n" onClick={() => sortLink("evidence")}>Evidence{arrow(linkSort.key === "evidence", linkSort.desc)}</th>
          <th className="n" onClick={() => sortLink("confidence")} title="Bootstrap confidence">Conf.{arrow(linkSort.key === "confidence", linkSort.desc)}</th>
          <th className="n" onClick={() => sortLink("methods")}>Methods{arrow(linkSort.key === "methods", linkSort.desc)}</th>
        </tr></thead>
        <tbody>{shownRows.map(r => <tr key={r.edge.key} data-key={r.edge.key} className={r.edge.key === selectedEdgeKey ? "is-sel" : undefined}
          onMouseEnter={() => onHoverEdge(r.edge.key)} onClick={() => onSelectEdge(r.edge.key === selectedEdgeKey ? null : r.edge.key)}
          title={`${r.regulator} → ${r.target}\nDirection: ${r.directed ? `resolved (${pct(r.edge.directionConfidence)} agreement)` : "not resolved"}\nMethods: ${r.edge.supportingAlgorithms.join(", ") || "—"}`}>
          <td className="g">{r.regulator}</td><td>{glyph(r)}</td><td className="g">{r.target}</td>
          <td className="n">{r.edge.score.toFixed(3)}<span className="tp-bar" style={{ width: `${Math.round(Math.max(0, Math.min(1, r.edge.score)) * 40)}px` }} /></td>
          <td className="n">{r.edge.bootstrapVerified ? pct(r.edge.confidence) : "—"}</td>
          <td className="n">{r.edge.count} / {methodCount}</td>
        </tr>)}</tbody>
      </table> : <table>
        <thead><tr>
          <th onClick={() => sortGene("gene")}>Gene{arrow(geneSort.key === "gene", geneSort.desc)}</th>
          {anyDirected && <th className="n" onClick={() => sortGene("targets")} title="Genes it regulates">Targets{arrow(geneSort.key === "targets", geneSort.desc)}</th>}
          {anyDirected && <th className="n" onClick={() => sortGene("regulators")} title="Genes that regulate it">Regulators{arrow(geneSort.key === "regulators", geneSort.desc)}</th>}
          {anyDirected && anyUnknown && <th className="n" onClick={() => sortGene("unknown")} title="Links with no resolved direction">Unknown{arrow(geneSort.key === "unknown", geneSort.desc)}</th>}
          <th className="n" onClick={() => sortGene("total")}>Links{arrow(geneSort.key === "total", geneSort.desc)}</th>
        </tr></thead>
        <tbody>{genes.map(g => <tr key={g.id} className={g.id === selectedGene ? "is-sel" : undefined} onClick={() => onSelectGene(g.id === selectedGene ? null : g.id)}>
          <td className="g"><svg width="9" height="9" aria-label={g.tf ? "transcription factor" : "other gene"}><circle cx="4.5" cy="4.5" r="4" fill={g.tf ? T.tf : T.node}/></svg>{g.id}</td>
          {anyDirected && <td className="n">{g.targets}</td>}
          {anyDirected && <td className="n">{g.regulators}</td>}
          {anyDirected && anyUnknown && <td className="n">{g.unknown}</td>}
          <td className="n">{g.total}</td>
        </tr>)}</tbody>
      </table>}
      {tab === "links" && rows.length > LIMIT && !showAll && <button type="button" className="tp-more" onClick={() => setShowAll(true)}>Show all {rows.length.toLocaleString()} links</button>}
    </div>
    <div className="tp-foot">
      <span>{tab === "links" ? `${rows.length.toLocaleString()} of ${edges.length.toLocaleString()} links` : `${genes.length.toLocaleString()} genes`}</span>
      <button type="button" className="tp-link" onClick={download}>⤓ CSV</button>
    </div>
  </aside>;
}
