"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NetworkEdge } from "../networkGraphTypes";
import { displayEndpoints, hasDirection } from "../networkVisualEncoding";
import { downloadSvg, downloadSvgPng } from "../../_lib/downloads";
import { countAxis, edgeDistributions } from "./distributions";

export default function EdgeDistributions({ edges, onHighlightEdges, onSelectEdge, onHoverEdge, onExportFigure }: {
  edges: NetworkEdge[];
  onHighlightEdges?: (keys: string[] | null) => void;
  onSelectEdge: (key: string) => void; onHoverEdge: (key: string | null) => void;
  onExportFigure?: (figure: SVGSVGElement | null) => void;
}) {
  const distributions = useMemo(() => edgeDistributions(edges), [edges]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [width, setWidth] = useState(340);
  const container = useRef<HTMLElement>(null), figure = useRef<SVGSVGElement>(null);
  const active = hovered ?? pinned;
  const [seriesKey, binIndex] = active?.split(":") ?? [];
  const series = distributions.find(d => d.key === seriesKey);
  const entries = series?.bins[Number(binIndex)] ?? [];
  const selectedEdges = [...new Map(entries.map(entry => [entry.edge.key, entry.edge])).values()];
  const highlighted = useMemo(() => {
    const [key, index] = active?.split(":") ?? [];
    const entries = distributions.find(d => d.key === key)?.bins[Number(index)];
    return entries?.length ? [...new Set(entries.map(entry => entry.edge.key))] : null;
  }, [active, distributions]);
  useEffect(() => { onHighlightEdges?.(highlighted); }, [highlighted, onHighlightEdges]);
  useEffect(() => () => onHighlightEdges?.(null), [onHighlightEdges]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const axis = countAxis(distributions), left = 28, right = width - 6, plotHeight = 100, rowHeight = 178;
  const interval = (domain: [number, number], i: number) => {
    const step = (domain[1] - domain[0]) / 12;
    return `${(domain[0] + i * step).toFixed(2)}–${(domain[0] + (i + 1) * step).toFixed(2)}`;
  };
  return <section ref={container} className="edge-distributions" aria-label="Edge distributions" onMouseLeave={() => setHovered(null)}>
    <header className="ed-heading"><h3>Edge distributions</h3><span>{edges.length.toLocaleString()} edges</span>
      <button type="button" className="ed-download" aria-label="Download distributions" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(v => !v)}>↓</button>
      {menu && <div className="tp-figure-pop" role="menu">
        <button type="button" role="menuitem" onClick={() => { setMenu(false); if (figure.current) void downloadSvgPng(figure.current, "edge-distributions.png"); }}>PNG</button>
        <button type="button" role="menuitem" onClick={() => { setMenu(false); if (figure.current) downloadSvg(figure.current, "edge-distributions.svg"); }}>SVG</button>
      </div>}
    </header>
    <svg ref={node => { figure.current = node; onExportFigure?.(node); }} width="100%" viewBox={`0 0 ${width} ${distributions.length * rowHeight}`} role="group" aria-label="Evidence and verified confidence distributions; shared count scale" fontFamily="Arial, Helvetica, sans-serif">
      <title>Edge distributions</title>
      {distributions.map((d, row) => {
        const offset = row * rowHeight, top = offset + 34, bottom = top + plotHeight, slot = (right - left) / 12;
        const status = !d.total ? d.key === "c" ? "No verified bootstrap confidence" : "No evidence available" : "";
        return <g key={d.key} aria-label={`${d.name}: ${d.total} ${"edges"}`}>
          <circle cx="4" cy={offset + 10} r="3.5" fill={d.color}/><text x="15" y={offset + 14} fontSize="13" fill="#334652">{d.name}</text>
          <text x={right} y={offset + 14} textAnchor="end" fontSize="11" fill="#6b7a86">Count</text>
          {Array.from({ length: axis.max / axis.step + 1 }, (_, i) => i * axis.step).map(v => {
            const y = bottom - v / axis.max * plotHeight;
            return <g key={v}><line x1={left} x2={right} y1={y} y2={y} stroke="#dce4e9" strokeWidth="0.8"/><text x={left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#6b7a86">{v}</text></g>;
          })}
          {!status && d.bins.map((bin, i) => {
            if (!bin.length) return null;
            const key = `${d.key}:${i}`, h = bin.length / axis.max * plotHeight;
            const label = `${d.name} ${interval(d.domain, i)}: ${bin.length} ${"edges"}`;
            return <g key={key}>
              <rect x={left + i * slot + 1} y={bottom - h} width={Math.max(1, slot - 2)} height={h} fill={active === key ? "#153f55" : d.color} data-export-fill={d.color}/>
              <rect className="ed-hit" data-ui="" x={left + i * slot} y={top} width={slot} height={plotHeight} fill="transparent" role="button" tabIndex={0} aria-label={label} aria-pressed={pinned === key}
                onMouseEnter={() => setHovered(key)} onFocus={() => setHovered(key)} onBlur={() => setHovered(null)}
                onClick={() => { setHovered(null); setPinned(p => p === key ? null : key); }}
                onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setHovered(null); setPinned(p => p === key ? null : key); } }}><title data-ui="">{label}</title></rect>
            </g>;
          })}
          {status && <text x={(left + right) / 2} y={top + plotHeight / 2} textAnchor="middle" fontSize="11" fill="#6b7a86">{status}</text>}
          {[d.domain[0], (d.domain[0] + d.domain[1]) / 2, d.domain[1]].map((v, i) => <text key={i} x={left + i / 2 * (right - left)} y={bottom + 17} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize="11" fill="#6b7a86">{v}</text>)}
          <text x={(left + right) / 2} y={bottom + 35} textAnchor="middle" fontSize="11" fill="#6b7a86">{"Score"}</text>
        </g>;
      })}
    </svg>
    <p className="ed-detail">{series && entries.length ? `${series.name} · ${interval(series.domain, Number(binIndex))} · ${entries.length} ${"edges"}` : "Hover to highlight edges · Click a bar to list them"}</p>
    {pinned && selectedEdges.length > 0 && <div className="ed-edge-list">{selectedEdges.slice(0, 300).map(edge => {
      const { source, target } = displayEndpoints(edge);
      return <button type="button" key={edge.key} onClick={() => onSelectEdge(edge.key)} onMouseEnter={() => onHoverEdge(edge.key)} onMouseLeave={() => onHoverEdge(null)}>{source} {hasDirection(edge) ? "→" : "—"} {target}</button>;
    })}{selectedEdges.length > 300 && <p className="ed-status">Showing 300 of {selectedEdges.length} edges</p>}</div>}
  </section>;
}
