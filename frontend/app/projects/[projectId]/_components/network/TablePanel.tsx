"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NetworkEdge, NetworkNode } from "../networkGraphTypes";
import { hasDirection } from "../networkVisualEncoding";
import { PALETTES, DEFAULT_PALETTE, type Palette, type PaletteName } from "./theme";
import { nodeDegrees } from "./model";

/**
 * The side panel of the network: a soft sheet in the same card as the figure
 * that answers whatever was last touched. Nothing selected → an Overview (with
 * the full Links and Genes tables one tab away); a gene selected → its gene
 * card; a link selected → its link card. Hovering any link row focuses that
 * link on the canvas; the figure's link filter sits at the top of the sheet.
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
  /** The figure's link filter, shown at the top of the sheet. */
  filter?: ReactNode;
  palette?: PaletteName;
};

type View = "overview" | "links" | "genes";
type LinkKey = "regulator" | "target" | "evidence" | "confidence" | "methods";
type GeneKey = "gene" | "targets" | "regulators" | "unknown" | "total";
type Row = { edge: NetworkEdge; regulator: string; target: string; directed: boolean };
type GeneRow = { id: string; tf: boolean; targets: number; regulators: number; unknown: number; total: number };
const LIMIT = 300;

const pct = (v: number | null | undefined) => typeof v === "number" && Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—";
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function orient(edge: NetworkEdge): Row {
  const directed = hasDirection(edge);
  const reversed = directed && edge.direction === -1;
  return { edge, directed, regulator: reversed ? edge.target : edge.source, target: reversed ? edge.source : edge.target };
}

function csv(rows: string[][]) {
  return rows.map(r => r.map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(",")).join("\n");
}

/** A gene's pie in its own colours: dark = regulates, light = regulated by,
 * pale = direction unknown, from 12 o'clock — the same mark as on the canvas. */
export function PieGlyph({ tf, out, inn, unknown, size = 14, T }: { tf: boolean; out: number; inn: number; unknown: number; size?: number; T: Palette }) {
  const pal = tf ? T.pieTF : T.pieGene, r = size / 2, total = out + inn + unknown;
  if (!total || out + inn === 0) return <svg width={size} height={size} aria-hidden="true"><circle cx={r} cy={r} r={r} fill={tf ? T.tf : T.node} /></svg>;
  const parts = [out, inn, unknown].map(v => v / total);
  let start = 0;
  return <svg width={size} height={size} aria-hidden="true">{parts.map((p, i) => {
    if (p <= 0) return null;
    if (p >= 0.9999) return <circle key={i} cx={r} cy={r} r={r} fill={pal[i]} />;
    const a0 = start * 2 * Math.PI - Math.PI / 2, a1 = (start + p) * 2 * Math.PI - Math.PI / 2; start += p;
    return <path key={i} fill={pal[i]} d={`M${r},${r}L${r + r * Math.cos(a0)},${r + r * Math.sin(a0)}A${r},${r} 0 ${p > 0.5 ? 1 : 0} 1 ${r + r * Math.cos(a1)},${r + r * Math.sin(a1)}Z`} />;
  })}</svg>;
}

export default function NetworkTablePanel({ edges, nodes, methodCount, selectedGene, selectedEdgeKey, onSelectGene, onSelectEdge, onHoverEdge, onHide, onFocus, filter, palette = DEFAULT_PALETTE }: Props) {
  const T = PALETTES[palette];
  const [view, setView] = useState<View>("overview");
  const [linkSort, setLinkSort] = useState<{ key: LinkKey; desc: boolean }>({ key: "evidence", desc: true });
  const [geneSort, setGeneSort] = useState<{ key: GeneKey; desc: boolean }>({ key: "total", desc: true });
  const [showAll, setShowAll] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const tfOf = useMemo(() => new Map(nodes.map(n => [n.id, n.isTF])), [nodes]);
  const degrees = useMemo(() => nodeDegrees(edges), [edges]);
  const anyDirected = edges.some(hasDirection);
  const selectedEdge = selectedEdgeKey ? edges.find(e => e.key === selectedEdgeKey) ?? null : null;
  const allRows = useMemo(() => edges.map(orient), [edges]);
  const byEvidence = useMemo(() => [...allRows].sort((a, b) => b.edge.score - a.edge.score), [allRows]);
  const rows = useMemo(() => {
    const value = (r: Row): number | string => linkSort.key === "regulator" ? r.regulator : linkSort.key === "target" ? r.target
      : linkSort.key === "evidence" ? r.edge.score : linkSort.key === "confidence" ? (r.edge.bootstrapVerified ? r.edge.confidence : -1) : r.edge.count;
    return [...allRows].sort((a, b) => {
      const x = value(a), y = value(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return (linkSort.desc ? -c : c) || b.edge.score - a.edge.score;
    });
  }, [allRows, linkSort]);

  const genes: GeneRow[] = useMemo(() => {
    const list = nodes.map(n => ({ id: n.id, tf: n.isTF, targets: degrees.out.get(n.id) ?? 0, regulators: degrees.in.get(n.id) ?? 0, unknown: degrees.unknown.get(n.id) ?? 0, total: degrees.all.get(n.id) ?? 0 }));
    const k = geneSort.key;
    return list.sort((a, b) => {
      const c = k === "gene" ? a.id.localeCompare(b.id) : a[k] - b[k];
      return (geneSort.desc ? -c : c) || a.id.localeCompare(b.id);
    });
  }, [nodes, degrees, geneSort]);
  const anyUnknown = genes.some(g => g.unknown > 0);

  // Keep the selected link in view when it is chosen in the network.
  useEffect(() => {
    if (!selectedEdgeKey || !bodyRef.current) return;
    bodyRef.current.querySelector(`[data-key="${CSS.escape(selectedEdgeKey)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedEdgeKey]);
  // A new card starts at its top, and a row that vanished with the old view
  // must not keep its link focused on the canvas.
  useEffect(() => { bodyRef.current?.scrollTo?.({ top: 0 }); onHoverEdge(null); }, [selectedGene, selectedEdgeKey, view, onHoverEdge]);

  const sortLink = (key: LinkKey) => setLinkSort(s => ({ key, desc: s.key === key ? !s.desc : key !== "regulator" && key !== "target" }));
  const sortGene = (key: GeneKey) => setGeneSort(s => ({ key, desc: s.key === key ? !s.desc : key !== "gene" }));
  const arrow = (on: boolean, desc: boolean) => on ? <span aria-hidden="true">{desc ? " ↓" : " ↑"}</span> : null;

  const glyph = (r: Row, width = 22) => signGlyph(r.edge.sign, r.directed, width);
  const signGlyph = (sign: number, directed: boolean, w = 22) => {
    // Same scheme as the network: tip = sign, dashed = direction unknown.
    const col = "#3f4850", dash = directed ? undefined : "3 2.5";
    const what = `${sign === 1 ? "activates" : sign === -1 ? "represses" : "sign unknown"}${directed ? "" : ", direction unknown"}`;
    if (sign === -1) return <svg className="tp-glyph" width={w} height="10" aria-label={what}><path d={`M1 5H${w - 2}`} stroke={col} strokeWidth="1.4" strokeDasharray={dash}/><path d={`M${w - 2} .5V9.5`} stroke={col} strokeWidth="1.8"/></svg>;
    if (sign === 1) return <svg className="tp-glyph" width={w} height="10" aria-label={what}><path d={`M1 5H${w - 7}`} stroke={col} strokeWidth="1.4" strokeDasharray={dash}/><path d={`M${w - 8} 1.2L${w - 1} 5L${w - 8} 8.8Z`} fill={col}/></svg>;
    return <svg className="tp-glyph" width={w} height="10" aria-label={what}><path d={`M1 5H${w - 1}`} stroke={col} strokeWidth="1.4" strokeDasharray={dash}/></svg>;
  };
  const gene = (id: string, strong = false) => <span className={`tp-gene${strong ? " is-strong" : ""}`}>
    <i className="tp-dot" style={{ background: tfOf.get(id) ? T.tf : T.node }} aria-label={tfOf.get(id) ? "transcription factor" : "other gene"} /><em>{id}</em>
  </span>;
  const pie = (id: string, size = 14) => <PieGlyph tf={!!tfOf.get(id)} out={degrees.out.get(id) ?? 0} inn={degrees.in.get(id) ?? 0} unknown={degrees.unknown.get(id) ?? 0} size={size} T={T} />;
  // Evidence bar: most links sit high on the 0–1 scale, so the bar starts at
  // 0.4 to keep differences visible; the number stays exact.
  const evidence = (v: number, width = 56) => <span className="tp-ev">
    <span className="tp-track" style={{ width }}><span className="tp-fill" style={{ width: Math.round(Math.max(0.04, Math.min(1, (v - 0.4) / 0.6)) * width) }} /></span>
    <span className="tp-num">{v.toFixed(3)}</span>
  </span>;
  const pips = (count: number) => <span className="tp-pips" aria-label={`${count} of ${methodCount} methods`} title={`${count} of ${methodCount} methods`}>
    {Array.from({ length: Math.min(methodCount, 12) }, (_, i) => <i key={i} className={i < count ? "is-on" : undefined} />)}
  </span>;
  const confidence = (e: NetworkEdge) => e.bootstrapVerified
    ? <span className="tp-num" style={{ opacity: e.confidence >= 0.9 ? 1 : e.confidence >= 0.6 ? 0.7 : 0.45 }}>{pct(e.confidence)}</span>
    : <span className="tp-num tp-muted">—</span>;
  const rowEvents = (r: Row) => ({
    "data-key": r.edge.key,
    onMouseEnter: () => onHoverEdge(r.edge.key),
    onClick: () => onSelectEdge(r.edge.key === selectedEdgeKey ? null : r.edge.key),
    title: `${r.regulator} → ${r.target}\nDirection: ${r.directed ? `resolved (${pct(r.edge.directionConfidence)} agreement)` : "not resolved"}\nMethods: ${r.edge.supportingAlgorithms.join(", ") || "—"}`,
  });

  const download = (what: "links" | "genes", subset?: Row[], name?: string) => {
    const data = what === "links"
      ? [["regulator", "target", "effect", "direction_resolved", "evidence", "bootstrap_confidence", "methods", "method_names"],
         ...(subset ?? rows).map(r => [r.regulator, r.target, r.edge.sign === 1 ? "activation" : r.edge.sign === -1 ? "repression" : "unknown", r.directed ? "yes" : "no", r.edge.score.toFixed(3), r.edge.bootstrapVerified ? r.edge.confidence.toFixed(3) : "", String(r.edge.count), r.edge.supportingAlgorithms.join(";")])]
      : [["gene", "transcription_factor", "targets", "regulators", "direction_unknown", "total_links"], ...genes.map(g => [g.id, g.tf ? "yes" : "no", String(g.targets), String(g.regulators), String(g.unknown), String(g.total)])];
    const url = URL.createObjectURL(new Blob([csv(data)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `network-${name ?? what}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const stat = (value: ReactNode, label: ReactNode) => <div className="tp-stat"><b>{value}</b><span>{label}</span></div>;
  const crumb = (label: string, onClose: () => void) => <div className="tp-crumb">
    <button type="button" className="tp-back" onClick={onClose}>{view === "overview" ? "Overview" : view === "links" ? "Links" : "Genes"}</button>
    <span aria-hidden="true">›</span><b><i>{label}</i></b>
    <button type="button" className="tp-x" aria-label="Close" onClick={onClose}>✕</button>
  </div>;

  // ---- Link card -------------------------------------------------------
  const linkCard = (e: NetworkEdge) => {
    const r = orient(e);
    return <div className="tp-card">
      {crumb(`${r.regulator} – ${r.target}`, () => onSelectEdge(null))}
      <div className="tp-link-head">
        <button type="button" onClick={() => onSelectGene(r.regulator)} title={`Open ${r.regulator}`}>{pie(r.regulator, 28)}<em>{r.regulator}</em></button>
        {glyph(r, 40)}
        <button type="button" onClick={() => onSelectGene(r.target)} title={`Open ${r.target}`}>{pie(r.target, 28)}<em>{r.target}</em></button>
      </div>
      <p className="tp-sub">{e.sign === 1 ? "Activation" : e.sign === -1 ? "Repression" : "Sign unknown"}{r.directed ? "" : " · direction not resolved"}</p>
      <div className="tp-stats">
        {stat(e.score.toFixed(3), "evidence")}
        {stat(e.bootstrapVerified ? pct(e.confidence) : "—", e.bootstrapVerified ? "bootstrap confidence" : "not verified")}
        {stat(`${e.count}/${methodCount}`, "methods agree")}
      </div>
      <dl className="tp-detail">
        <dt>Direction</dt><dd>{r.directed ? `resolved · ${pct(e.directionConfidence)} agreement` : "not resolved"}</dd>
        <dt>Sign</dt><dd>{e.sign === 0 ? "not resolved" : `${e.sign === 1 ? "activation" : "repression"} · ${pct(e.signConfidence)} stable`}</dd>
        <dt>Methods</dt><dd>{e.supportingAlgorithms.length ? e.supportingAlgorithms.join(", ") : "—"}</dd>
      </dl>
    </div>;
  };

  // ---- Gene card -------------------------------------------------------
  const geneCard = (id: string) => {
    const mine = byEvidence.filter(r => r.edge.source === id || r.edge.target === id);
    const regulates = mine.filter(r => r.directed && r.regulator === id);
    const regulatedBy = mine.filter(r => r.directed && r.target === id);
    const unknown = mine.filter(r => !r.directed);
    const act = mine.filter(r => r.edge.sign === 1).length, rep = mine.filter(r => r.edge.sign === -1).length;
    const tf = !!tfOf.get(id);
    const list = (title: string, items: Row[], other: (r: Row) => string, empty: string) => <section className="tp-section">
      <h4>{title} · {items.length}</h4>
      {items.length ? <table><tbody>{items.map(r => <tr key={r.edge.key} {...rowEvents(r)} className={r.edge.key === selectedEdgeKey ? "is-sel" : undefined}>
        <td className="tp-gl">{glyph(r)}</td><td>{gene(other(r))}</td><td className="n">{evidence(r.edge.score, 84)}</td><td className="n">{pips(r.edge.count)}</td>
      </tr>)}</tbody></table> : <p className="tp-empty">{empty}</p>}
    </section>;
    return <div className="tp-card">
      {crumb(id, () => onSelectGene(null))}
      <div className="tp-gene-head">{pie(id, 56)}<div><h3><i>{id}</i></h3><span className={`tp-tag${tf ? " is-tf" : ""}`}>{tf ? "Transcription factor" : "Other gene"}</span></div></div>
      <div className="tp-stats">
        {anyDirected ? <>{stat(regulates.length, "regulates")}{stat(regulatedBy.length, "regulated by")}</> : stat(mine.length, plural(mine.length, "link").replace(/^\d+ /, ""))}
        {stat(mine.length ? mine[0].edge.score.toFixed(2) : "—", "strongest evidence")}
      </div>
      {(act > 0 || rep > 0) && <div className="tp-split">
        <div><span>{signGlyph(1, true, 16)} activation {act}</span><span>repression {rep} {signGlyph(-1, true, 16)}</span></div>
        <div className="tp-splitbar"><i style={{ flex: act }} /><i style={{ flex: rep }} /></div>
      </div>}
      {anyDirected && list("Regulates", regulates, r => r.target, `${id} regulates no displayed gene.`)}
      {anyDirected && list("Regulated by", regulatedBy, r => r.regulator, "No regulator among the displayed links.")}
      {unknown.length > 0 && list(anyDirected ? "Direction unknown" : "Links", unknown, r => r.regulator === id ? r.target : r.regulator, "")}
      <div className="tp-card-actions">
        {onFocus && <button type="button" className="tp-link" onClick={() => onFocus(id)}>◎ Show only this neighbourhood</button>}
        <button type="button" className="tp-link" onClick={() => download("links", mine, id)}>⤓ CSV</button>
      </div>
    </div>;
  };

  // ---- Overview --------------------------------------------------------
  const overview = () => {
    const tfCount = nodes.filter(n => n.isTF).length;
    const signed = edges.filter(e => e.sign !== 0).length;
    const act = edges.filter(e => e.sign === 1).length;
    const lo = edges.length ? Math.min(0.9, Math.floor(Math.min(...edges.map(e => e.score)) * 10) / 10) : 0;
    const steps = Math.max(1, Math.round((1 - lo) * 10));
    const bins = Array.from({ length: steps }, () => 0);
    edges.forEach(e => { bins[Math.min(steps - 1, Math.max(0, Math.floor((e.score - lo) * 10)))] += 1; });
    const peak = Math.max(1, ...bins);
    const top = [...genes].sort((a, b) => (anyDirected ? b.targets - a.targets : b.total - a.total) || a.id.localeCompare(b.id)).slice(0, 6).filter(g => (anyDirected ? g.targets : g.total) > 0);
    const topMax = Math.max(1, ...top.map(g => anyDirected ? g.targets : g.total));
    return <div className="tp-card">
      <div className="tp-stats">
        {stat(nodes.length.toLocaleString(), `genes · ${plural(tfCount, "TF")}`)}
        {stat(edges.length.toLocaleString(), "links")}
        {stat(signed ? `${Math.round((act / signed) * 100)}%` : "—", "activation")}
      </div>
      {edges.length > 0 && <section className="tp-section">
        <h4>Evidence of displayed links</h4>
        <div className="tp-hist" role="img" aria-label="Number of links by evidence">
          {bins.map((n, i) => <div key={i} title={`${(lo + i / 10).toFixed(1)}–${(lo + (i + 1) / 10).toFixed(1)}: ${plural(n, "link")}`}>
            <span>{n}</span><i style={{ height: `${Math.round((n / peak) * 64)}px`, opacity: 0.45 + 0.55 * (i + 1) / steps }} />
          </div>)}
        </div>
        <div className="tp-hist-axis">{Array.from({ length: steps + 1 }, (_, i) => <span key={i}>{(lo + i / 10).toFixed(1)}</span>)}</div>
      </section>}
      {top.length > 0 && <section className="tp-section">
        <h4>Top {anyDirected ? "regulators · targets" : "hubs · links"}</h4>
        <table><tbody>{top.map(g => {
          const v = anyDirected ? g.targets : g.total;
          return <tr key={g.id} onClick={() => onSelectGene(g.id)} title={`Open ${g.id}`}>
            <td className="tp-pie">{pie(g.id, 16)}</td><td><span className="tp-gene is-strong"><em>{g.id}</em></span></td>
            <td className="n"><span className="tp-ev"><span className="tp-track" style={{ width: 110 }}><span className="tp-fill is-tf" style={{ width: Math.round((v / topMax) * 110), background: T.tf }} /></span><span className="tp-num">{v}</span></span></td>
          </tr>;
        })}</tbody></table>
      </section>}
      {byEvidence.length > 0 && <section className="tp-section">
        <h4>Strongest links</h4>
        <table><tbody>{byEvidence.slice(0, 5).map(r => <tr key={r.edge.key} {...rowEvents(r)}>
          <td>{gene(r.regulator)}</td><td className="tp-gl">{glyph(r)}</td><td>{gene(r.target)}</td><td className="n">{evidence(r.edge.score, 44)}</td>
        </tr>)}</tbody></table>
        <button type="button" className="tp-more-link" onClick={() => setView("links")}>All {plural(edges.length, "link")} →</button>
      </section>}
    </div>;
  };

  // ---- Tables ----------------------------------------------------------
  const shownRows = showAll ? rows : rows.slice(0, LIMIT);
  const linksTable = <>
    <table className="tp-table">
      <thead><tr>
        <th onClick={() => sortLink("regulator")}>{anyDirected ? "Regulator" : "Gene"}{arrow(linkSort.key === "regulator", linkSort.desc)}</th>
        <th aria-label="Effect" />
        <th onClick={() => sortLink("target")}>{anyDirected ? "Target" : "Gene"}{arrow(linkSort.key === "target", linkSort.desc)}</th>
        <th className="n" onClick={() => sortLink("evidence")}>Evidence{arrow(linkSort.key === "evidence", linkSort.desc)}</th>
        <th className="n" onClick={() => sortLink("confidence")} title="Bootstrap confidence">Conf{arrow(linkSort.key === "confidence", linkSort.desc)}</th>
        <th className="n" onClick={() => sortLink("methods")}>Methods{arrow(linkSort.key === "methods", linkSort.desc)}</th>
      </tr></thead>
      <tbody>{shownRows.map(r => <tr key={r.edge.key} {...rowEvents(r)} className={r.edge.key === selectedEdgeKey ? "is-sel" : undefined}>
        <td>{gene(r.regulator)}</td><td className="tp-gl">{glyph(r)}</td><td>{gene(r.target)}</td>
        <td className="n">{evidence(r.edge.score)}</td><td className="n">{confidence(r.edge)}</td><td className="n">{pips(r.edge.count)}</td>
      </tr>)}</tbody>
    </table>
    {rows.length > LIMIT && !showAll && <button type="button" className="tp-more" onClick={() => setShowAll(true)}>Show all {rows.length.toLocaleString()} links</button>}
  </>;
  const genesTable = <table className="tp-table">
    <thead><tr>
      <th onClick={() => sortGene("gene")}>Gene{arrow(geneSort.key === "gene", geneSort.desc)}</th>
      {anyDirected && <th className="n" onClick={() => sortGene("targets")} title="Genes it regulates">Targets{arrow(geneSort.key === "targets", geneSort.desc)}</th>}
      {anyDirected && <th className="n" onClick={() => sortGene("regulators")} title="Genes that regulate it">Regulators{arrow(geneSort.key === "regulators", geneSort.desc)}</th>}
      {anyDirected && anyUnknown && <th className="n" onClick={() => sortGene("unknown")} title="Links with no resolved direction">Unknown{arrow(geneSort.key === "unknown", geneSort.desc)}</th>}
      <th className="n" onClick={() => sortGene("total")}>Links{arrow(geneSort.key === "total", geneSort.desc)}</th>
    </tr></thead>
    <tbody>{genes.map(g => <tr key={g.id} className={g.id === selectedGene ? "is-sel" : undefined} onClick={() => onSelectGene(g.id === selectedGene ? null : g.id)}>
      <td><span className="tp-gene">{pie(g.id, 12)}<em>{g.id}</em></span></td>
      {anyDirected && <td className="n tp-num">{g.targets}</td>}
      {anyDirected && <td className="n tp-num">{g.regulators}</td>}
      {anyDirected && anyUnknown && <td className="n tp-num">{g.unknown}</td>}
      <td className="n tp-num">{g.total}</td>
    </tr>)}</tbody>
  </table>;

  const card = selectedEdge ? linkCard(selectedEdge) : selectedGene && tfOf.has(selectedGene) ? geneCard(selectedGene) : null;
  const tab = (key: View, label: string, count?: number) => <button type="button" role="tab" aria-selected={!card && view === key}
    onClick={() => { setView(key); if (selectedEdgeKey) onSelectEdge(null); else if (selectedGene) onSelectGene(null); }}>
    {label}{count !== undefined && <span className="tp-count">{count.toLocaleString()}</span>}
  </button>;

  return <aside className="tp" aria-label="Network details">
    <div className="tp-head">
      <div className="tp-tabs" role="tablist">
        {tab("overview", "Overview")}
        {tab("links", "Links", edges.length)}
        {tab("genes", "Genes", nodes.length)}
      </div>
      <button type="button" className="tp-hide" onClick={onHide} aria-label="Hide panel" title="Hide panel">⟩</button>
    </div>
    {filter && <div className="tp-filter">{filter}</div>}
    <div className="tp-body" ref={bodyRef} onMouseLeave={() => onHoverEdge(null)}>
      {card ?? (view === "overview" ? overview() : view === "links" ? linksTable : genesTable)}
    </div>
    {!card && view !== "overview" && <div className="tp-foot">
      <span>{view === "links" ? `${plural(rows.length, "link")} · hover a row to see it on the network` : plural(genes.length, "gene")}</span>
      <button type="button" className="tp-link" onClick={() => download(view)}>⤓ CSV</button>
    </div>}
  </aside>;
}
