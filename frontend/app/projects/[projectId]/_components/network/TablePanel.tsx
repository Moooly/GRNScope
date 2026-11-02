"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NetworkEdge, NetworkNode } from "../networkGraphTypes";
import { hasDirection } from "../networkVisualEncoding";
import { PALETTES, DEFAULT_PALETTE, type Palette, type PaletteName } from "./theme";
import { nodeDegrees } from "./model";
import { downloadSvg, downloadSvgPng } from "../../_lib/downloads";
import { SCORE_BIN_COUNT, SCORE_BIN_STEP, scoreDistributions } from "./encoding";

/** Ink, grid and hues of the Comparison and Benchmark figures: evidence in
 * their blue, confidence in their orange. */
const SERIES = { e: { name: "Evidence", fill: "rgb(33,113,181)" }, c: { name: "Confidence", fill: "rgb(253,141,60)" } } as const;
type SeriesKey = keyof typeof SERIES;
const FIG_FONT = "Arial, Helvetica, sans-serif", FIG_INK = "#1a1a1a", FIG_SUB = "#4b5560", FIG_GRID = "#e9edf0", FIG_SELECT = "#087ead";

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
  /** A group of links to emphasise together on the canvas (a histogram segment). */
  onHighlightEdges?: (keys: string[] | null) => void;
  onHide: () => void;
  onFocus?: (id: string) => void;
  /** The figure's link filter, shown at the top of the sheet. */
  filter?: ReactNode;
  palette?: PaletteName;
  /** A layout can supply its own overview while sharing tables and detail cards. */
  overviewContent?: ReactNode;
  contextHeader?: ReactNode;
  contextKey?: string;
  onOverview?: () => void;
  edgeHoverHint?: boolean;
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

/** A solid gene mark matching its fill on the network canvas. */
export function GeneGlyph({ tf, size = 14, T }: { tf: boolean; size?: number; T: Palette }) {
  const r = size / 2;
  return <svg width={size} height={size} aria-hidden="true"><circle cx={r} cy={r} r={r} fill={tf ? T.tf : T.node} /></svg>;
}

export default function NetworkTablePanel({ edges, nodes, methodCount, selectedGene, selectedEdgeKey, onSelectGene, onSelectEdge, onHoverEdge, onHighlightEdges, onHide, onFocus, filter, palette = DEFAULT_PALETTE, overviewContent, contextHeader, contextKey, onOverview, edgeHoverHint = true }: Props) {
  const T = PALETTES[palette];
  const [view, setView] = useState<View>("overview");
  const [linkSort, setLinkSort] = useState<{ key: LinkKey; desc: boolean }>({ key: "evidence", desc: true });
  const [geneSort, setGeneSort] = useState<{ key: GeneKey; desc: boolean }>({ key: "total", desc: true });
  const [showAll, setShowAll] = useState(false);
  // Histogram bar under the pointer, and the one pinned by a click: "e:bin" or "c:bin".
  const [segHover, setSegHover] = useState<string | null>(null);
  const [segPinned, setSegPinned] = useState<string | null>(null);
  const [figureMenu, setFigureMenu] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const figureRef = useRef<SVGSVGElement | null>(null);

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
  useEffect(() => { bodyRef.current?.scrollTo?.({ top: 0 }); onHoverEdge(null); }, [selectedGene, selectedEdgeKey, view, contextKey, onHoverEdge]);

  const histogram = useMemo(() => scoreDistributions(edges), [edges]);
  const segKey = segHover ?? segPinned;
  const segEdges = useMemo(() => {
    if (!segKey) return null;
    const [series, i] = segKey.split(":");
    const group = (series === "e" ? histogram.evidence : histogram.confidence)[Number(i)];
    return group?.length ? group : null;
  }, [segKey, histogram]);
  const overviewShown = view === "overview" && !selectedGene && !selectedEdgeKey;
  // The segment's links stand out on the canvas while it is hovered or pinned.
  useEffect(() => {
    onHighlightEdges?.(overviewShown && segEdges ? segEdges.map(e => e.key) : null);
  }, [overviewShown, segEdges, onHighlightEdges]);
  useEffect(() => () => onHighlightEdges?.(null), [onHighlightEdges]);

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
  const geneGlyph = (id: string, size = 14) => <GeneGlyph tf={!!tfOf.get(id)} size={size} T={T} />;
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
      : [["gene", "transcription_factor", "targets", "regulators", "direction_unknown", "total_edges"], ...genes.map(g => [g.id, g.tf ? "yes" : "no", String(g.targets), String(g.regulators), String(g.unknown), String(g.total)])];
    const url = URL.createObjectURL(new Blob([csv(data)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `network-${name ?? what}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const stat = (value: ReactNode, label: ReactNode) => <div className="tp-stat"><b>{value}</b><span>{label}</span></div>;
  const crumb = (label: string, onClose: () => void) => <div className="tp-crumb">
    <button type="button" className="tp-back" onClick={onClose}>{view === "overview" ? "Overview" : view === "links" ? "Edges" : "Genes"}</button>
    <span aria-hidden="true">›</span><b><i>{label}</i></b>
    <button type="button" className="tp-x" aria-label="Close" onClick={onClose}>✕</button>
  </div>;

  // ---- Link card -------------------------------------------------------
  const linkCard = (e: NetworkEdge) => {
    const r = orient(e);
    return <div className="tp-card">
      {crumb(`${r.regulator} – ${r.target}`, () => onSelectEdge(null))}
      <div className="tp-link-head">
        <button type="button" onClick={() => onSelectGene(r.regulator)} title={`Open ${r.regulator}`}>{geneGlyph(r.regulator, 28)}<em>{r.regulator}</em></button>
        {glyph(r, 40)}
        <button type="button" onClick={() => onSelectGene(r.target)} title={`Open ${r.target}`}>{geneGlyph(r.target, 28)}<em>{r.target}</em></button>
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
      <div className="tp-gene-head">{geneGlyph(id, 56)}<div><h3><i>{id}</i></h3><span className={`tp-tag${tf ? " is-tf" : ""}`}>{tf ? "Transcription factor" : "Other gene"}</span></div></div>
      <div className="tp-stats">
        {anyDirected ? <>{stat(regulates.length, "regulates")}{stat(regulatedBy.length, "regulated by")}</> : stat(mine.length, plural(mine.length, "edge").replace(/^\d+ /, ""))}
        {stat(mine.length ? mine[0].edge.score.toFixed(2) : "—", "strongest evidence")}
      </div>
      {(act > 0 || rep > 0) && <div className="tp-split">
        <div><span>{signGlyph(1, true, 16)} activation {act}</span><span>repression {rep} {signGlyph(-1, true, 16)}</span></div>
        <div className="tp-splitbar"><i style={{ flex: act }} /><i style={{ flex: rep }} /></div>
      </div>}
      {anyDirected && list("Regulates", regulates, r => r.target, `${id} regulates no displayed gene.`)}
      {anyDirected && list("Regulated by", regulatedBy, r => r.regulator, "No regulator among the displayed edges.")}
      {unknown.length > 0 && list(anyDirected ? "Direction unknown" : "Edges", unknown, r => r.regulator === id ? r.target : r.regulator, "")}
      <div className="tp-card-actions">
        {onFocus && <button type="button" className="tp-link" onClick={() => onFocus(id)}>◎ Show only this neighbourhood</button>}
        <button type="button" className="tp-link" onClick={() => download("links", mine, id)}>⤓ CSV</button>
      </div>
    </div>;
  };

  // ---- Overview --------------------------------------------------------
  const overview = () => {
    // Evidence (up) and bootstrap confidence (down) on one 0–1 axis, one count scale.
    const N = SCORE_BIN_COUNT, W = 340, X0 = 44, X1 = 326, TOP = 36, MID = 136, BOT = 236, AXIS = BOT + 4, H = 282;
    const peak = Math.max(1, ...histogram.evidence.map(g => g.length), ...histogram.confidence.map(g => g.length));
    const yTick = Math.max(1, Math.ceil(peak / 4)), yMax = Math.ceil(peak / yTick) * yTick;
    const slot = (X1 - X0) / N, half = MID - TOP;
    const range = (i: number) => `${(i * SCORE_BIN_STEP).toFixed(2)}–${((i + 1) * SCORE_BIN_STEP).toFixed(2)}`;
    const [segSeries, segBin] = segKey ? [segKey.split(":")[0] as SeriesKey, Number(segKey.split(":")[1])] : [null, -1];
    const segRows = segPinned && segEdges ? segEdges.map(orient).sort((a, b) => b.edge.score - a.edge.score) : [];
    const counts: Record<SeriesKey, number> = { e: edges.length, c: histogram.verified };
    const bars = (series: SeriesKey, groups: NetworkEdge[][]) => groups.map((group, i) => {
      const n = group.length;
      if (!n) return null;
      const h = (n / yMax) * half, key = `${series}:${i}`, on = segKey === key;
      return <rect key={key} className="tp-seg" x={X0 + i * slot + 1} y={series === "e" ? MID - h : MID} width={slot - 2} height={h}
        fill={on ? FIG_SELECT : SERIES[series].fill} data-export-fill={SERIES[series].fill}
        onMouseEnter={() => setSegHover(key)} onClick={() => setSegPinned(p => p === key ? null : key)}>
        <title data-ui="">{`${SERIES[series].name} ${range(i)}: ${plural(n, "edge")}\nClick to ${segPinned === key ? "release" : "keep and list these edges"}`}</title>
      </rect>;
    });
    const top = [...genes].sort((a, b) => (anyDirected ? b.targets - a.targets : b.total - a.total) || a.id.localeCompare(b.id)).slice(0, 6).filter(g => (anyDirected ? g.targets : g.total) > 0);
    const topMax = Math.max(1, ...top.map(g => anyDirected ? g.targets : g.total));
    // No headline numbers here: the tabs already count links and genes, and
    // the filter chips count links by sign.
    return <div className="tp-card">
      {edges.length > 0 && <section className="tp-section">
        <div className="tp-figure" onMouseLeave={() => { setSegHover(null); setFigureMenu(false); }}>
          <button type="button" className="tp-figure-dl" aria-label="Download chart" title="Download chart" aria-haspopup="menu" aria-expanded={figureMenu} onClick={() => setFigureMenu(open => !open)}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.5 1.5v7M3.5 6l3 3 3-3M2 11.5h9" /></svg>
          </button>
          {figureMenu && <div className="tp-figure-pop" role="menu">
            <button type="button" role="menuitem" onClick={() => { setFigureMenu(false); if (figureRef.current) void downloadSvgPng(figureRef.current, "evidence-confidence.png"); }}>PNG</button>
            <button type="button" role="menuitem" onClick={() => { setFigureMenu(false); if (figureRef.current) downloadSvg(figureRef.current, "evidence-confidence.svg"); }}>SVG</button>
          </div>}
          <svg ref={figureRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" fontFamily={FIG_FONT}
            aria-label="Number of displayed edges by evidence score (bars up) and by bootstrap confidence (bars down), on one axis from 0 to 1">
            {(["e", "c"] as SeriesKey[]).map((k, n) => <g key={k}>
              <rect x={4 + n * 118} y="6" width="10" height="10" fill={SERIES[k].fill} />
              <text x={18 + n * 118} y="15" fontSize="10" fill={FIG_INK}>{SERIES[k].name} (n = {counts[k].toLocaleString()})</text>
            </g>)}
            {Array.from({ length: yMax / yTick + 1 }, (_, k) => k * yTick).flatMap(v => (v === 0 ? [0] : [-1, 1]).map(side => {
              const y = MID - side * (v / yMax) * half;
              return <g key={`${v}:${side}`}>
                <line x1={X0} x2={X1} y1={y} y2={y} stroke={FIG_GRID} strokeWidth="0.8" />
                <line x1={X0 - 4} x2={X0} y1={y} y2={y} stroke={FIG_INK} strokeWidth="0.8" />
                <text x={X0 - 7} y={y + 3.8} fontSize="11" textAnchor="end" fill={FIG_INK}>{v}</text>
              </g>;
            }))}
            {bars("e", histogram.evidence)}
            {bars("c", histogram.confidence)}
            {histogram.verified === 0 && <text x={(X0 + X1) / 2} y={MID + half / 2} fontSize="11" textAnchor="middle" fill={FIG_SUB}>No verified bootstrap confidence for these edges</text>}
            <line x1={X0} x2={X0} y1={TOP} y2={AXIS} stroke={FIG_INK} strokeWidth="0.8" />
            <line x1={X0} x2={X1} y1={MID} y2={MID} stroke={FIG_INK} strokeWidth="0.8" />
            <line x1={X0} x2={X1} y1={AXIS} y2={AXIS} stroke={FIG_INK} strokeWidth="0.8" />
            {Array.from({ length: 11 }, (_, t) => { const x = X0 + (t / 10) * (X1 - X0); return <g key={t}>
              <line x1={x} x2={x} y1={AXIS} y2={AXIS + 4} stroke={FIG_INK} strokeWidth="0.8" />
              {t % 2 === 0 && <text x={x} y={AXIS + 16} fontSize="11" textAnchor="middle" fill={FIG_INK}>{(t / 10).toFixed(1)}</text>}
            </g>; })}
            <text x={(X0 + X1) / 2} y={AXIS + 36} fontSize="12" textAnchor="middle" fill={FIG_INK}>Score (0–1)</text>
            <text transform={`translate(13 ${MID}) rotate(-90)`} fontSize="12" textAnchor="middle" fill={FIG_INK}>Number of edges</text>
          </svg>
          <p className="tp-figure-note">{segEdges
            ? <>{plural(segEdges.length, "edge")} · {segSeries ? SERIES[segSeries].name.toLowerCase() : ""} {range(segBin)}</>
            : "Hover a bar to see its edges in the network; click to list them."}</p>
          {segRows.length > 0 && <table><tbody>{segRows.map(r => <tr key={r.edge.key} {...rowEvents(r)}>
            <td>{gene(r.regulator)}</td><td className="tp-gl">{glyph(r)}</td><td>{gene(r.target)}</td><td className="n">{evidence(r.edge.score, 44)}</td>
          </tr>)}</tbody></table>}
        </div>
      </section>}
      {top.length > 0 && <section className="tp-section">
        <div className="tp-section-head"><h4>Top {top.length} {anyDirected ? "regulators" : "hubs"}</h4><button type="button" className="tp-more-link" onClick={() => setView("genes")}>All genes →</button></div>
        <table><tbody>{top.map(g => {
          const v = anyDirected ? g.targets : g.total;
          return <tr key={g.id} onClick={() => onSelectGene(g.id)} title={`Open ${g.id}`}>
            <td className="tp-node-glyph">{geneGlyph(g.id, 16)}</td><td><span className="tp-gene is-strong"><em>{g.id}</em></span></td>
            <td className="n"><span className="tp-ev"><span className="tp-track" style={{ width: 110 }}><span className="tp-fill is-tf" style={{ width: Math.round((v / topMax) * 110), background: T.tf }} /></span><span className="tp-num">{v}</span></span></td>
          </tr>;
        })}</tbody></table>
      </section>}
      {byEvidence.length > 0 && <section className="tp-section">
        <div className="tp-section-head"><h4>Top {Math.min(5, byEvidence.length)} edges</h4><button type="button" className="tp-more-link" onClick={() => setView("links")}>All edges →</button></div>
        <table><tbody>{byEvidence.slice(0, 5).map(r => <tr key={r.edge.key} {...rowEvents(r)}>
          <td>{gene(r.regulator)}</td><td className="tp-gl">{glyph(r)}</td><td>{gene(r.target)}</td><td className="n">{evidence(r.edge.score, 44)}</td>
        </tr>)}</tbody></table>
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
    {rows.length > LIMIT && !showAll && <button type="button" className="tp-more" onClick={() => setShowAll(true)}>Show all {rows.length.toLocaleString()} edges</button>}
  </>;
  const genesTable = <table className="tp-table">
    <thead><tr>
      <th onClick={() => sortGene("gene")}>Gene{arrow(geneSort.key === "gene", geneSort.desc)}</th>
      {anyDirected && <th className="n" onClick={() => sortGene("targets")} title="Genes it regulates">Targets{arrow(geneSort.key === "targets", geneSort.desc)}</th>}
      {anyDirected && <th className="n" onClick={() => sortGene("regulators")} title="Genes that regulate it">Regulators{arrow(geneSort.key === "regulators", geneSort.desc)}</th>}
      {anyDirected && anyUnknown && <th className="n" onClick={() => sortGene("unknown")} title="Edges with no resolved direction">Unknown{arrow(geneSort.key === "unknown", geneSort.desc)}</th>}
      <th className="n" onClick={() => sortGene("total")}>Edges{arrow(geneSort.key === "total", geneSort.desc)}</th>
    </tr></thead>
    <tbody>{genes.map(g => <tr key={g.id} className={g.id === selectedGene ? "is-sel" : undefined} onClick={() => onSelectGene(g.id === selectedGene ? null : g.id)}>
      <td><span className="tp-gene">{geneGlyph(g.id, 12)}<em>{g.id}</em></span></td>
      {anyDirected && <td className="n tp-num">{g.targets}</td>}
      {anyDirected && <td className="n tp-num">{g.regulators}</td>}
      {anyDirected && anyUnknown && <td className="n tp-num">{g.unknown}</td>}
      <td className="n tp-num">{g.total}</td>
    </tr>)}</tbody>
  </table>;

  const card = selectedEdge ? linkCard(selectedEdge) : selectedGene && tfOf.has(selectedGene) ? geneCard(selectedGene) : null;
  const tab = (key: View, label: string, count?: number) => <button type="button" role="tab" aria-selected={!card && view === key}
    onClick={() => { setView(key); if (selectedEdgeKey) onSelectEdge(null); else if (selectedGene) onSelectGene(null); if (key === "overview") onOverview?.(); }}>
    {label}{count !== undefined && <span className="tp-count">{count.toLocaleString()}</span>}
  </button>;

  return <aside className="tp" aria-label="Network details">
    <div className="tp-head">
      <div className="tp-tabs" role="tablist">
        {tab("overview", "Overview")}
        {tab("links", "Edges", edges.length)}
        {tab("genes", "Genes", nodes.length)}
      </div>
      <button type="button" className="tp-hide" onClick={onHide} aria-label="Hide panel" title="Hide panel">⟩</button>
    </div>
    {filter && <div className="tp-filter">{filter}</div>}
    {contextHeader}
    <div className="tp-body" ref={bodyRef} onMouseLeave={() => onHoverEdge(null)}>
      {card ?? (view === "overview" ? overviewContent ?? overview() : view === "links" ? linksTable : genesTable)}
    </div>
    {!card && view !== "overview" && <div className="tp-foot">
      <span>{view === "links" ? `${plural(rows.length, "edge")}${edgeHoverHint ? " · hover a row to see it on the network" : ""}` : plural(genes.length, "gene")}</span>
      <button type="button" className="tp-link" onClick={() => download(view)}>⤓ CSV</button>
    </div>}
  </aside>;
}
