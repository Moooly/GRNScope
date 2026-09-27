"use client";

/**
 * Benchmark figures in the style of BEELINE (Pratapa et al., Nature Methods
 * 2020) and the dynbenchmark summary: plain SVG, one unit per pixel, Arial,
 * so downloads match what is on screen.
 */

import { useCallback, useRef, useState, type Ref } from "react";

const FONT = "Arial, Helvetica, sans-serif";
const INK = "#1a1a1a";
const MUTED = "#6b7580";
const FAINT = "#9aa3ab";
const BELOW = "#d5d9dd";
const CONSENSUS = "#0072b2";
const WARN = "#d55e00";

type Rgb = [number, number, number];
const BLUES: Rgb[] = [[198, 219, 239], [107, 174, 214], [33, 113, 181], [8, 48, 107]];
const ORANGES: Rgb[] = [[253, 208, 162], [253, 141, 60], [217, 72, 1], [127, 39, 4]];
const GREENS: Rgb[] = [[199, 233, 192], [116, 196, 118], [35, 139, 69], [0, 68, 27]];
const DIVERGING: Rgb[] = [[33, 102, 172], [103, 169, 207], [209, 229, 240], [247, 247, 247], [253, 219, 199], [239, 138, 98], [178, 24, 43]];

function ramp(stops: Rgb[], value: number) {
  const x = Math.max(0, Math.min(1, value)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function useWidth() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!node) return;
    setWidth(node.clientWidth);
    observer.current = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.current.observe(node);
  }, []);
  return [width, measure] as const;
}

export type CurvePoint = { x: number; y: number };

export type FigureRow = {
  id: string;
  consensus?: boolean;
  auprcRatio: number;
  eprRatio: number;
  auroc: number;
  activation: number | null;
  inhibition: number | null;
  stability: number | null;
  runtime: number | null;
  ci: [number, number] | null;
  pValue: number | null;
  pr: CurvePoint[];
  roc: CurvePoint[];
};

const label = (row: FigureRow) => (row.consensus ? "Consensus" : row.id);

/** Mean rank over AUPRC ratio, early precision ratio and AUROC (1 = best). */
export function overallRanks(rows: FigureRow[]) {
  const rank = (key: "auprcRatio" | "eprRatio" | "auroc") =>
    rows.map((row) => 1 + rows.filter((other) => other[key] > row[key]).length);
  const a = rank("auprcRatio");
  const b = rank("eprRatio");
  const c = rank("auroc");
  return new Map(rows.map((row, index) => [row.id, (a[index] + b[index] + c[index]) / 3]));
}

/* ------------------------------------------------------------------ */
/* Summary heatmap                                                     */
/* ------------------------------------------------------------------ */

type SummaryColumn = {
  group: string;
  key: "auprcRatio" | "eprRatio" | "auroc" | "activation" | "inhibition" | "stability";
  title: string[];
  random: number;
  palette: Rgb[];
};

export function SummaryHeatmap({
  rows,
  showSigned,
  showStability,
  svgRef,
}: {
  rows: FigureRow[];
  showSigned: boolean;
  showStability: boolean;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const showStats = rows.some((row) => row.ci);
  const [boxWidth, measure] = useWidth();
  const columns: SummaryColumn[] = [
    { group: "Accuracy", key: "auprcRatio", title: ["AUPRC", "ratio"], random: 1, palette: BLUES },
    { group: "Accuracy", key: "eprRatio", title: ["Early precision", "ratio"], random: 1, palette: BLUES },
    { group: "Accuracy", key: "auroc", title: ["AUROC"], random: 0.5, palette: BLUES },
    ...(showSigned
      ? ([
          { group: "Signed edges", key: "activation", title: ["Activation", "EPR"], random: 1, palette: ORANGES },
          { group: "Signed edges", key: "inhibition", title: ["Inhibition", "EPR"], random: 1, palette: ORANGES },
        ] as SummaryColumn[])
      : []),
    ...(showStability ? ([{ group: "Stability", key: "stability", title: ["Median ρ", "across runs"], random: -Infinity, palette: GREENS }] as SummaryColumn[]) : []),
  ];
  const methods = rows.filter((row) => !row.consensus);
  const consensus = rows.find((row) => row.consensus) ?? null;
  const ranks = overallRanks(rows);
  const ordered = [...methods].sort((a, b) => (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0) || b.auprcRatio - a.auprcRatio);
  const display = consensus ? [...ordered, consensus] : ordered;
  const maxRank = rows.length;

  const nameW = Math.min(170, 24 + Math.max(...display.map((row) => label(row).length)) * 7.4);
  const rankW = 132;
  // Fill the panel: spare width widens the metric columns first, then the
  // confidence-interval track, each up to a comfortable maximum.
  const baseW = nameW + rankW + 18 + columns.length * 84 + 3 * 18 + (showStats ? 26 + 250 + 14 + 112 + 70 : 8);
  const spare = Math.max(0, (boxWidth || baseW) - baseW - 4);
  const colW = 84 + Math.min(36, (spare * 0.55) / columns.length);
  const forestExtra = Math.min(160, spare - (colW - 84) * columns.length);
  const groupGap = 18;
  const rowH = 32;
  const top = 76;
  const consensusGap = consensus ? 10 : 0;
  const colX: number[] = [];
  let x = nameW + rankW + 18;
  columns.forEach((column, index) => {
    if (index && columns[index - 1].group !== column.group) x += groupGap;
    colX.push(x);
    x += colW;
  });
  // Statistical support: the AUPRC ratio with its 95% interval, drawn as a
  // forest plot in the same rows, then the permutation p-value.
  const forestX = x + groupGap + 8;
  const forestW = 250 + Math.max(0, forestExtra);
  // Axis spans the data (and 1×, random), not 0 to max, so the intervals use the width.
  const ciValues = rows.flatMap((row) => (row.ci ? [row.ci[0], row.ci[1], row.auprcRatio] : []));
  const ciMin = showStats ? Math.max(0, Math.min(1, Math.floor(Math.min(...ciValues) * 4) / 4 - 0.25)) : 0;
  const ciMax = showStats ? Math.max(1.5, Math.ceil(Math.max(...ciValues) * 4) / 4 + 0.25) : 2;
  const ciStep = ciMax - ciMin > 2 ? 0.5 : 0.25;
  const fx = (value: number) => forestX + ((Math.max(ciMin, Math.min(ciMax, value)) - ciMin) / (ciMax - ciMin)) * forestW;
  const ciTextX = forestX + forestW + 14;
  const pX = ciTextX + 112;
  const W = showStats ? pX + 70 : x + 8;
  const axisH = showStats ? 34 : 0;
  const H = top + display.length * rowH + consensusGap + 12 + axisH;
  const groups = [...new Set(columns.map((column) => column.group))];
  const rowY = (index: number) => top + index * rowH + (consensus && index === display.length - 1 ? consensusGap : 0);

  return (
    <div ref={measure} className="min-w-0 overflow-x-auto">
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }} fontFamily={FONT} role="img" aria-label="Benchmark summary heatmap">
      <rect width={W} height={H} fill="#ffffff" />
      {display.map((row, index) =>
        index % 2 === 0 && !row.consensus ? <rect key={row.id} x={0} y={rowY(index)} width={W} height={rowH} fill="#f6f8fa" /> : null,
      )}
      {consensus ? (
        <>
          <line x1={0} x2={W} y1={rowY(display.length - 1) - consensusGap / 2} y2={rowY(display.length - 1) - consensusGap / 2} stroke="#c9ced3" strokeDasharray="3 3" />
          <rect x={0} y={rowY(display.length - 1)} width={W} height={rowH} fill="#eaf3f9" />
        </>
      ) : null}
      <text x={nameW + 8} y={top - 10} fontSize="11" fill={MUTED}>Overall rank</text>
      {showStats ? (
        <g>
          <text x={(forestX + pX + 62) / 2} y={16} fontSize="12.5" fontWeight="700" textAnchor="middle" fill={INK}>Statistical support</text>
          <line x1={forestX + 4} x2={pX + 62} y1={23} y2={23} stroke={INK} strokeWidth="1" />
          <text x={ciTextX + 50} y={42} fontSize="11" textAnchor="middle" fill={INK}>
            <tspan x={ciTextX + 50}>Ratio</tspan>
            <tspan x={ciTextX + 50} dy={13}>[95% CI]</tspan>
          </text>
          <text x={forestX + forestW / 2} y={42} fontSize="11" textAnchor="middle" fill={INK}>
            <tspan x={forestX + forestW / 2}>AUPRC ratio</tspan>
            <tspan x={forestX + forestW / 2} dy={13}>with 95% CI</tspan>
          </text>
          <text x={pX + 30} y={42} fontSize="11" textAnchor="middle" fill={INK}>
            <tspan x={pX + 30}>p vs</tspan>
            <tspan x={pX + 30} dy={13}>random</tspan>
          </text>
          <line x1={fx(1)} x2={fx(1)} y1={top} y2={top + display.length * rowH + consensusGap} stroke={FAINT} strokeDasharray="4 3" />
          {(() => {
            const y = top + display.length * rowH + consensusGap + 6;
            const ticks: number[] = [];
            for (let v = Math.ceil(ciMin / ciStep) * ciStep; v <= ciMax + 1e-9; v += ciStep) ticks.push(Number(v.toFixed(2)));
            return (
              <g>
                <line x1={fx(ciMin)} x2={fx(ciMax)} y1={y} y2={y} stroke={INK} />
                {ticks.map((tick) => (
                  <g key={tick}>
                    <line x1={fx(tick)} x2={fx(tick)} y1={y} y2={y + 4} stroke={INK} />
                    <text x={fx(tick)} y={y + 16} fontSize="10.5" textAnchor="middle" fill={INK}>{`${tick}×`}</text>
                  </g>
                ))}
              </g>
            );
          })()}
        </g>
      ) : null}
      {groups.map((group) => {
        const indexes = columns.map((column, index) => (column.group === group ? index : -1)).filter((index) => index >= 0);
        const x0 = colX[indexes[0]];
        const x1 = colX[indexes[indexes.length - 1]] + colW;
        return (
          <g key={group}>
            <text x={(x0 + x1) / 2} y={16} fontSize="12.5" fontWeight="700" textAnchor="middle" fill={INK}>{group}</text>
            <line x1={x0 + 4} x2={x1 - 4} y1={23} y2={23} stroke={INK} strokeWidth="1" />
          </g>
        );
      })}
      {columns.map((column, index) => (
        <text key={column.key} x={colX[index] + colW / 2} y={42} fontSize="11" textAnchor="middle" fill={INK}>
          {column.title.map((line, lineIndex) => (
            <tspan key={line} x={colX[index] + colW / 2} dy={lineIndex ? 13 : 0}>{line}</tspan>
          ))}
        </text>
      ))}
      {display.map((row, index) => {
        const y = rowY(index) + rowH / 2;
        const rank = ranks.get(row.id) ?? maxRank;
        const barW = (1 - (rank - 1) / Math.max(1, maxRank - 1)) * (rankW - 40) + 6;
        return (
          <g key={row.id}>
            <text x={nameW} y={y + 4} fontSize="12.5" textAnchor="end" fill={row.consensus ? CONSENSUS : INK} fontWeight={row.consensus || index < 3 ? 700 : 400}>
              {row.consensus ? "Consensus" : row.id}
            </text>
            <rect x={nameW + 8} y={y - 7} width={barW} height={14} fill={row.consensus ? CONSENSUS : "#3b3b3b"} />
            <text x={nameW + 14 + barW} y={y + 4} fontSize="11" fill={INK}>{rank.toFixed(1)}</text>
            {columns.map((column, columnIndex) => {
              const value = row[column.key];
              const cx = colX[columnIndex] + colW / 2;
              if (value === null || value === undefined) {
                return <text key={column.key} x={cx} y={y + 4} fontSize="11" textAnchor="middle" fill={FAINT}>n/a</text>;
              }
              const all = rows.map((other) => other[column.key]).filter((v): v is number => v !== null && v !== undefined);
              const hi = Math.max(...all);
              const lo = Number.isFinite(column.random) ? column.random : Math.min(...all);
              const above = value > column.random;
              const t = above ? (value - lo) / Math.max(1e-9, hi - lo) : 0;
              return (
                <g key={column.key}>
                  <title>{`${label(row)} · ${column.title.join(" ")}: ${value.toFixed(3)}${above ? "" : " (not better than random)"}`}</title>
                  <circle cx={cx - 16} cy={y} r={above ? 6 + t * 8 : 4.5} fill={above ? ramp(column.palette, t) : BELOW} />
                  <text x={cx + 2} y={y + 4} fontSize="11" fill={above ? INK : FAINT}>{value.toFixed(2)}</text>
                </g>
              );
            })}
            {showStats && row.ci ? (() => {
              const [lo, hi] = row.ci;
              const solid = lo > 1;
              const color = row.consensus ? CONSENSUS : solid ? INK : FAINT;
              const p = row.pValue;
              const significant = p !== null && p < 0.05;
              return (
                <g>
                  <title>{`${label(row)}: AUPRC ratio ${row.auprcRatio.toFixed(2)}× (95% CI ${lo.toFixed(2)}–${hi.toFixed(2)})${p !== null ? `, p = ${p.toFixed(3)}` : ""}`}</title>
                  <line x1={fx(lo)} x2={fx(hi)} y1={y} y2={y} stroke={color} strokeWidth="1.6" />
                  <line x1={fx(lo)} x2={fx(lo)} y1={y - 4} y2={y + 4} stroke={color} strokeWidth="1.6" />
                  <line x1={fx(hi)} x2={fx(hi)} y1={y - 4} y2={y + 4} stroke={color} strokeWidth="1.6" />
                  <rect x={fx(row.auprcRatio) - 4.5} y={y - 4.5} width={9} height={9} fill={solid ? color : "#ffffff"} stroke={color} strokeWidth="1.4" />
                  <text x={ciTextX + 50} y={y + 4} fontSize="11" textAnchor="middle" fill={solid ? INK : MUTED}>
                    {`${row.auprcRatio.toFixed(2)} [${lo.toFixed(2)}–${hi.toFixed(2)}]`}
                  </text>
                  <text x={pX + 30} y={y + 4} fontSize="11" textAnchor="middle" fill={significant ? INK : MUTED} fontWeight={significant ? 700 : 400}>
                    {p === null ? "n/a" : `${p < 0.001 ? "<0.001" : p.toFixed(3)}${p < 0.01 ? " **" : p < 0.05 ? " *" : ""}`}
                  </text>
                </g>
              );
            })() : null}
          </g>
        );
      })}
    </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Curve small multiples                                               */
/* ------------------------------------------------------------------ */

export function CurveSmallMultiples({
  rows,
  kind,
  randomBaseline,
  svgRef,
}: {
  rows: FigureRow[];
  kind: "pr" | "roc";
  randomBaseline: number;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const [boxWidth, measure] = useWidth();
  const methods = rows.filter((row) => !row.consensus).sort((a, b) => (kind === "pr" ? b.auprcRatio - a.auprcRatio : b.auroc - a.auroc));
  const consensus = rows.find((row) => row.consensus);
  const display = consensus ? [...methods, consensus] : methods;
  const left = 46;
  const available = Math.max(620, (boxWidth || 1000) - left - 10);
  const cols = Math.max(2, Math.min(5, Math.floor((available + 30) / 230)));
  const gapX = 30;
  const pw = (available - gapX * (cols - 1)) / cols;
  const ph = Math.min(170, pw * 0.72);
  const gapY = 54;
  const top = 26;
  const rowsCount = Math.ceil(display.length / cols);
  const W = left + cols * pw + (cols - 1) * gapX + 10;
  const H = top + rowsCount * (ph + gapY) + 18;
  const yMax = kind === "pr" ? Math.min(1, Math.max(0.5, Math.ceil(Math.max(...display.flatMap((row) => row.pr.slice(1).map((p) => p.y))) * 10) / 10)) : 1;
  const series = (row: FigureRow) => (kind === "pr" ? row.pr.slice(1) : row.roc);
  return (
    <div ref={measure} className="min-w-0 overflow-x-auto">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }} fontFamily={FONT} role="img" aria-label={kind === "pr" ? "Precision–recall curve for each method" : "ROC curve for each method"}>
        <rect width={W} height={H} fill="#ffffff" />
        {display.map((row, index) => {
          const ox = left + (index % cols) * (pw + gapX);
          const oy = top + Math.floor(index / cols) * (ph + gapY);
          const sx = (v: number) => ox + v * pw;
          const sy = (v: number) => oy + ph - (Math.min(yMax, v) / yMax) * ph;
          const path = (points: CurvePoint[]) => points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join("");
          const metric = kind === "pr" ? `AUPRC ${row.auprcRatio.toFixed(2)}×` : `AUROC ${row.auroc.toFixed(3)}`;
          return (
            <g key={row.id}>
              <text x={ox} y={oy - 9} fontSize="12.5" fontWeight="700" fill={row.consensus ? CONSENSUS : INK}>{label(row)}</text>
              <text x={ox + pw} y={oy - 9} fontSize="11" textAnchor="end" fill={MUTED}>{metric}</text>
              <path d={`M${ox} ${oy}V${oy + ph}H${ox + pw}`} fill="none" stroke={INK} strokeWidth="0.9" />
              {[0, yMax / 2, yMax].map((v) => (
                <g key={v}>
                  <line x1={ox - 3} x2={ox} y1={sy(v)} y2={sy(v)} stroke={INK} strokeWidth="0.9" />
                  {index % cols === 0 ? <text x={ox - 6} y={sy(v) + 3.5} fontSize="10" textAnchor="end" fill={INK}>{Number(v.toFixed(2))}</text> : null}
                </g>
              ))}
              {[0, 0.5, 1].map((v) => (
                <g key={v}>
                  <line x1={sx(v)} x2={sx(v)} y1={oy + ph} y2={oy + ph + 3} stroke={INK} strokeWidth="0.9" />
                  <text x={sx(v)} y={oy + ph + 14} fontSize="10" textAnchor="middle" fill={INK}>{v}</text>
                </g>
              ))}
              {kind === "pr" ? (
                <line x1={ox} x2={ox + pw} y1={sy(randomBaseline)} y2={sy(randomBaseline)} stroke={FAINT} strokeDasharray="4 3" />
              ) : (
                <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke={FAINT} strokeDasharray="4 3" />
              )}
              {display.filter((other) => other.id !== row.id).map((other) => (
                <path key={other.id} d={path(series(other))} fill="none" stroke="#e1e5e9" strokeWidth="1" />
              ))}
              <path d={path(series(row))} fill="none" stroke={row.consensus ? CONSENSUS : INK} strokeWidth="1.8" />
            </g>
          );
        })}
        <text x={left + (W - left) / 2} y={H - 4} fontSize="12" textAnchor="middle" fill={INK}>{kind === "pr" ? "Recall" : "False-positive rate"}</text>
        <text transform={`translate(12 ${top + (rowsCount * (ph + gapY)) / 2}) rotate(-90)`} fontSize="12" textAnchor="middle" fill={INK}>
          {kind === "pr" ? "Precision" : "True-positive rate"}
        </text>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Accuracy vs runtime                                                 */
/* ------------------------------------------------------------------ */

function formatSeconds(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(seconds < 36000 ? 1 : 0)} h`;
}

export function RuntimeScatter({ rows, svgRef }: { rows: FigureRow[]; svgRef?: Ref<SVGSVGElement> }) {
  const points = rows.filter((row) => !row.consensus && row.runtime && row.runtime > 0) as Array<FigureRow & { runtime: number }>;
  const W = 720;
  const H = 480;
  const left = 70;
  const right = 150;
  const top = 20;
  const bottom = 56;
  const pw = W - left - right;
  const ph = H - top - bottom;
  const logMin = Math.floor(Math.log10(Math.max(1, Math.min(...points.map((p) => p.runtime)))) * 2) / 2;
  const logMax = Math.log10(Math.max(...points.map((p) => p.runtime), 10)) + 0.25;
  const yMax = Math.max(1.5, Math.ceil(Math.max(...points.map((p) => p.auprcRatio)) * 5) / 5 + 0.1);
  const yMin = Math.max(0, Math.min(0.5, Math.floor((Math.min(...points.map((p) => p.auprcRatio)) - 0.15) * 2) / 2));
  const sx = (seconds: number) => left + ((Math.log10(seconds) - logMin) / (logMax - logMin)) * pw;
  const sy = (value: number) => top + ph - ((value - yMin) / (yMax - yMin)) * ph;
  const tickCandidates = [1, 5, 10, 30, 60, 300, 600, 1800, 3600, 7200, 18000, 36000, 86400];
  const xTicks = tickCandidates.filter((t) => Math.log10(t) >= logMin - 1e-9 && Math.log10(t) <= logMax);
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += 0.25) yTicks.push(Number(v.toFixed(2)));
  // Pareto front: no faster method is more accurate.
  const front = [...points].sort((a, b) => a.runtime - b.runtime).reduce<typeof points>((acc, p) => {
    if (!acc.length || p.auprcRatio > acc[acc.length - 1].auprcRatio) acc.push(p);
    return acc;
  }, []);
  const frontIds = new Set(front.map((p) => p.id));
  // Simple label placement: flip left when a neighbour sits just to the right.
  const labels = points.map((p) => {
    const px = sx(p.runtime);
    const py = sy(p.auprcRatio);
    const crowded = points.some((q) => q !== p && sx(q.runtime) > px - 4 && sx(q.runtime) - px < 8 + q.id.length * 6.5 && Math.abs(sy(q.auprcRatio) - py) < 13);
    return { p, px, py, flip: crowded && px - left > 90 };
  });
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} fontFamily={FONT} role="img" aria-label="AUPRC ratio against runtime">
      <rect width={W} height={H} fill="#ffffff" />
      <path d={`M${left} ${top}V${top + ph}H${left + pw}`} fill="none" stroke={INK} />
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={left - 4} x2={left} y1={sy(v)} y2={sy(v)} stroke={INK} />
          <text x={left - 8} y={sy(v) + 4} fontSize="11" textAnchor="end" fill={INK}>{`${v}×`}</text>
        </g>
      ))}
      {xTicks.map((t) => (
        <g key={t}>
          <line x1={sx(t)} x2={sx(t)} y1={top + ph} y2={top + ph + 4} stroke={INK} />
          <text x={sx(t)} y={top + ph + 17} fontSize="11" textAnchor="middle" fill={INK}>{formatSeconds(t)}</text>
        </g>
      ))}
      <text x={left + pw / 2} y={H - 10} fontSize="12" textAnchor="middle" fill={INK}>Runtime (log scale)</text>
      <text transform={`translate(22 ${top + ph / 2}) rotate(-90)`} fontSize="12" textAnchor="middle" fill={INK}>AUPRC ratio</text>
      <line x1={left} x2={left + pw} y1={sy(1)} y2={sy(1)} stroke={FAINT} strokeDasharray="4 3" />
      <text x={left + 6} y={sy(1) - 5} fontSize="10.5" fill={MUTED}>random</text>
      {front.length > 1 ? (
        <path d={front.map((p, i) => `${i ? "L" : "M"}${sx(p.runtime)} ${sy(p.auprcRatio)}`).join("")} fill="none" stroke={CONSENSUS} strokeWidth="1.4" strokeDasharray="2 3" />
      ) : null}
      {labels.map(({ p, px, py, flip }) => {
        const onFront = frontIds.has(p.id);
        return (
          <g key={p.id}>
            <title>{`${p.id}: ${p.auprcRatio.toFixed(2)}× in ${formatSeconds(p.runtime)}`}</title>
            <circle cx={px} cy={py} r="5" fill={onFront ? CONSENSUS : INK} />
            <text x={flip ? px - 8 : px + 8} y={py + 4} fontSize="11" textAnchor={flip ? "end" : "start"} fill={onFront ? CONSENSUS : INK} fontWeight={onFront ? 700 : 400}>{p.id}</text>
          </g>
        );
      })}
      <line x1={left + pw + 14} x2={left + pw + 34} y1={top + 10} y2={top + 10} stroke={CONSENSUS} strokeWidth="1.4" strokeDasharray="2 3" />
      <text x={left + pw + 40} y={top + 14} fontSize="11" fill={CONSENSUS}>best trade-off</text>
      <text x={left + pw + 14} y={top + 30} fontSize="10.5" fill={MUTED}>no faster method</text>
      <text x={left + pw + 14} y={top + 44} fontSize="10.5" fill={MUTED}>is more accurate</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Motif heatmap                                                       */
/* ------------------------------------------------------------------ */

export type MotifRow = { id: string; ratios: [number | null, number | null, number | null] };

export function MotifHeatmap({ rows, svgRef }: { rows: MotifRow[]; svgRef?: Ref<SVGSVGElement> }) {
  const cols = [
    ["Feedback loops", "A→B→C→A"],
    ["Feed-forward loops", "A→B, A→C, B→C"],
    ["Mutual interactions", "A↔B"],
  ];
  const nameW = Math.min(170, 24 + Math.max(...rows.map((row) => row.id.length)) * 7.4);
  const cw = 124;
  const rh = 28;
  const top = 50;
  const keyX = nameW + 8 + cols.length * cw + 26;
  const W = keyX + 80;
  const H = Math.max(top + rows.length * rh + 12, top + 190);
  const color = (v: number) => ramp(DIVERGING, (Math.log2(Math.max(v, 1 / 8)) + 3) / 6);
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }} fontFamily={FONT} role="img" aria-label="Motif counts relative to the reference">
      <rect width={W} height={H} fill="#ffffff" />
      {cols.map(([title, sub], i) => (
        <g key={title}>
          <text x={nameW + 8 + i * cw + cw / 2} y={18} fontSize="12" fontWeight="700" textAnchor="middle" fill={INK}>{title}</text>
          <text x={nameW + 8 + i * cw + cw / 2} y={34} fontSize="10.5" textAnchor="middle" fill={MUTED}>{sub}</text>
        </g>
      ))}
      {rows.map((row, r) => {
        const y = top + r * rh;
        return (
          <g key={row.id}>
            <text x={nameW} y={y + rh / 2 + 4} fontSize="12" textAnchor="end" fill={INK}>{row.id}</text>
            {row.ratios.map((value, i) => {
              const x = nameW + 8 + i * cw;
              if (value === null) {
                return (
                  <g key={i}>
                    <rect x={x} y={y} width={cw} height={rh} fill="#f1f3f5" stroke="#ffffff" strokeWidth="1.5" />
                    <text x={x + cw / 2} y={y + rh / 2 + 4} fontSize="11" textAnchor="middle" fill={FAINT}>n/a</text>
                  </g>
                );
              }
              const strong = Math.abs(Math.log2(Math.max(value, 1 / 8))) > 1.6;
              return (
                <g key={i}>
                  <title>{`${row.id} · ${cols[i][0]}: ${value.toFixed(3)}× the reference`}</title>
                  <rect x={x} y={y} width={cw} height={rh} fill={color(value)} stroke="#ffffff" strokeWidth="1.5" />
                  <text x={x + cw / 2} y={y + rh / 2 + 4} fontSize="11.5" textAnchor="middle" fill={strong ? "#ffffff" : INK}>
                    {value === 0 ? "0" : `${value.toFixed(2)}×`}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
      {Array.from({ length: 60 }, (_, i) => (
        <rect key={i} x={keyX} y={top + 150 - ((i + 1) * 150) / 60} width="12" height={150 / 60 + 0.4} fill={ramp(DIVERGING, i / 59)} />
      ))}
      <text x={keyX + 18} y={top + 4} fontSize="11" fill={INK}>8×</text>
      <text x={keyX + 18} y={top + 79} fontSize="11" fill={INK}>1×</text>
      <text x={keyX + 18} y={top + 154} fontSize="11" fill={INK}>≤⅛×</text>
      <text transform={`translate(${keyX + 60} ${top + 75}) rotate(90)`} fontSize="11" textAnchor="middle" fill={INK}>vs reference</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Stacked bars: path context and direction / sign                     */
/* ------------------------------------------------------------------ */

export type StackRow = { id: string; parts: number[]; note?: string };

export function StackedBars({
  rows,
  categories,
  colors,
  svgRef,
  ariaLabel,
}: {
  rows: StackRow[];
  categories: string[];
  colors: string[];
  svgRef?: Ref<SVGSVGElement>;
  ariaLabel: string;
}) {
  const [boxWidth, measure] = useWidth();
  const nameW = Math.min(170, 24 + Math.max(...rows.map((row) => row.id.length)) * 7.4);
  const barW = Math.max(300, Math.min(900, (boxWidth || 640) - nameW - 10 - 170));
  const rh = 26;
  // Legend items flow left to right and wrap at the bar width.
  const legend: Array<{ x: number; y: number }> = [];
  let lx = 0;
  let ly = 0;
  categories.forEach((name) => {
    const w = 16 + name.length * 5.9 + 18;
    if (lx > 0 && lx + w > barW + 160) {
      lx = 0;
      ly += 18;
    }
    legend.push({ x: lx, y: ly });
    lx += w;
  });
  const top = 14 + ly + 18 + 8;
  const W = nameW + 10 + barW + 170;
  const H = top + rows.length * rh + 10;
  return (
    <div ref={measure} className="min-w-0 overflow-x-auto">
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }} fontFamily={FONT} role="img" aria-label={ariaLabel}>
      <rect width={W} height={H} fill="#ffffff" />
      {categories.map((name, i) => {
        const x = nameW + 10 + legend[i].x;
        const y = 8 + legend[i].y;
        return (
          <g key={name}>
            <rect x={x} y={y} width="11" height="11" fill={colors[i]} stroke={colors[i] === "#ffffff" ? "#c9ced3" : "none"} />
            <text x={x + 16} y={y + 10} fontSize="11" fill={INK}>{name}</text>
          </g>
        );
      })}
      {rows.map((row, r) => {
        const y = top + r * rh;
        const total = row.parts.reduce((sum, v) => sum + v, 0);
        let x = nameW + 10;
        return (
          <g key={row.id}>
            <text x={nameW} y={y + rh / 2 + 4} fontSize="12" textAnchor="end" fill={INK}>{row.id}</text>
            {total ? (
              row.parts.map((value, i) => {
                const w = (value / total) * barW;
                const rect = w > 0 ? (
                  <rect key={i} x={x} y={y + 4} width={w} height={rh - 8} fill={colors[i]}>
                    <title>{`${row.id} · ${categories[i]}: ${value} (${Math.round((value / total) * 100)}%)`}</title>
                  </rect>
                ) : null;
                x += w;
                return rect;
              })
            ) : (
              <text x={nameW + 10} y={y + rh / 2 + 4} fontSize="11" fill={FAINT}>none</text>
            )}
            {row.note ? <text x={nameW + 18 + barW} y={y + rh / 2 + 4} fontSize="11" fill={MUTED}>{row.note}</text> : null}
          </g>
        );
      })}
    </svg>
    </div>
  );
}

export const PATH_COLORS = ["#1f2a33", "#5b6670", "#8e979f", "#bcc3c9", "#e3e6e9"];
export const DIRECTION_COLORS = ["#1f2a33", WARN, "#9aa3ab", "#e6c9a8"];
