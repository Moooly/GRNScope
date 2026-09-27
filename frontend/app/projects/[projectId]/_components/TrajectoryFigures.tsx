"use client";

/**
 * Journal-style gene-trend figures for the Trajectory tab:
 *  - CascadeHeatmap: smoothed trends as rows, pseudotime as columns, each row
 *    scaled 0–1 within a lineage and sorted by peak time (CellRank 2 Fig. 3e,
 *    Monocle plot_pseudotime_heatmap), lineages side by side.
 *  - GeneTrendPanel: the inspection panel for one gene, its trend in real
 *    expression units in every lineage (tradeSeq plotSmoothers).
 * Plain SVG, one unit per pixel, so downloads match the screen.
 */

import { useCallback, useRef, useState, type Ref } from "react";

const FONT = "Arial, Helvetica, sans-serif";
const INK = "#1a1a1a";
const MUTED = "#6b7580";
const FLAT = "#eef1f3";
const SELECT = "#087ead";
/** Okabe-Ito blue and vermilion, then the rest of the set for more lineages. */
export const LINEAGE_COLORS = ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#e69f00", "#56b4e9"];
const LINEAGE_DASH = ["", "6 4", "2 3", "8 3 2 3"];

const VIRIDIS: [number, number, number][] = [
  [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
  [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37],
];
export function viridis(progress: number) {
  const ratio = Math.max(0, Math.min(1, progress)) * (VIRIDIS.length - 1);
  const index = Math.min(VIRIDIS.length - 2, Math.floor(ratio));
  const fraction = ratio - index;
  const color = VIRIDIS[index].map((value, channel) => Math.round(value + (VIRIDIS[index + 1][channel] - value) * fraction));
  return `rgb(${color.join(",")})`;
}

/**
 * Expression uses the same light → dark blue scale as the Comparison heatmaps
 * (dark = high), keeping viridis for pseudotime only, so the two quantities
 * never share colours.
 */
export function blues(progress: number) {
  const stops = [[239, 245, 250], [198, 219, 239], [107, 174, 214], [33, 113, 181], [8, 48, 107]];
  const x = Math.max(0, Math.min(1, progress)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const FLAT_FILL = "url(#cascade-not-expressed)";

export type CascadeLineage = {
  name: string;
  pseudotime: number[];
  expression: Record<string, number[]>;
};

export type CascadeRow = {
  gene: string;
  /** Per lineage: pseudotime of the peak, or null when the gene stays flat there. */
  peaks: (number | null)[];
};

/**
 * A gene is "not expressed" in a lineage when its fitted trend barely moves
 * compared with the most dynamic gene in the dataset; stretching such a trend
 * to 0–1 would paint noise as a full-contrast pattern.
 */
export function buildCascadeRows(lineages: CascadeLineage[], orderBy: number) {
  const genes = [...new Set(lineages.flatMap((lineage) => Object.keys(lineage.expression)))];
  const range = (values: number[]) => Math.max(...values) - Math.min(...values);
  const globalRange = Math.max(1e-9, ...lineages.flatMap((lineage) => Object.values(lineage.expression).map(range)));
  const threshold = 0.1 * globalRange;
  const rows: CascadeRow[] = genes.map((gene) => ({
    gene,
    peaks: lineages.map((lineage) => {
      const values = lineage.expression[gene];
      if (!values?.length || range(values) < threshold) return null;
      let best = 0;
      values.forEach((value, index) => {
        if (value > values[best]) best = index;
      });
      return lineage.pseudotime[best];
    }),
  }));
  const shown = rows.filter((row) => row.peaks.some((peak) => peak !== null));
  const hidden = rows.filter((row) => row.peaks.every((peak) => peak === null)).map((row) => row.gene);
  const key = (row: CascadeRow) => {
    const own = row.peaks[orderBy];
    if (own !== null && own !== undefined) return [0, own] as const;
    const other = row.peaks.find((peak) => peak !== null) ?? 0;
    return [1, other] as const;
  };
  shown.sort((a, b) => {
    const [ga, va] = key(a);
    const [gb, vb] = key(b);
    return ga - gb || va - vb || a.gene.localeCompare(b.gene);
  });
  return { rows: shown, hidden, isFlat: (lineageIndex: number, gene: string) => {
    const values = lineages[lineageIndex].expression[gene];
    return !values?.length || range(values) < threshold;
  } };
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

function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

export function CascadeHeatmap({
  lineages,
  rows,
  isFlat,
  selectedGene,
  onSelect,
  svgRef,
}: {
  lineages: CascadeLineage[];
  rows: CascadeRow[];
  isFlat: (lineageIndex: number, gene: string) => boolean;
  selectedGene: string | null;
  onSelect: (gene: string | null) => void;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [boxWidth, measure] = useWidth();
  const L = lineages.length;
  const longest = Math.max(4, ...rows.map((row) => row.gene.length));
  const nameW = Math.min(150, 20 + longest * 7.4);
  const keyW = 118;
  const gap = 28;
  const available = Math.max(360, (boxWidth || 900) - nameW - keyW - 8);
  const panelW = Math.max(160, Math.min(560, (available - gap * (L - 1)) / L));
  const rowH = rows.length > 30 ? 16 : rows.length > 20 ? 18 : 21;
  const top = 46;
  const plotH = rows.length * rowH;
  const W = nameW + L * panelW + (L - 1) * gap + keyW;
  const H = top + plotH + 52;
  const panelX = (index: number) => nameW + index * (panelW + gap);

  return (
    <div ref={measure} className="min-w-0 overflow-x-auto">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ display: "block" }}
        fontFamily={FONT}
        role="img"
        aria-label="Expression cascade: smoothed gene trends along pseudotime, each scaled 0 to 1 and sorted by peak time"
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <pattern id="cascade-not-expressed" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={FLAT} />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#cfd5db" strokeWidth="1.4" />
          </pattern>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
        {lineages.map((lineage, li) => {
          const x0 = panelX(li);
          const n = lineage.pseudotime.length;
          const colW = panelW / n;
          const tMin = lineage.pseudotime[0] ?? 0;
          const tMax = lineage.pseudotime[n - 1] ?? 1;
          return (
            <g key={lineage.name}>
              <text x={x0 + panelW / 2} y={14} fontSize="13" fontWeight="700" textAnchor="middle" fill={INK}>
                {lineage.name}
              </text>
              {li === 0 ? (
                <text x={x0 - 8} y={32} fontSize="10.5" textAnchor="end" fill={MUTED}>
                  Pseudotime
                </text>
              ) : null}
              {Array.from({ length: n }, (_, i) => (
                <rect key={i} x={x0 + i * colW} y={24} width={colW + 0.4} height={9} fill={viridis(i / Math.max(1, n - 1))} />
              ))}
              {rows.map((row, r) => {
                const values = lineage.expression[row.gene] ?? [];
                const flat = isFlat(li, row.gene);
                const lo = Math.min(...values);
                const hi = Math.max(...values);
                const y = top + r * rowH;
                return (
                  <g key={row.gene}>
                    {flat ? (
                      <rect x={x0} y={y} width={panelW} height={rowH - 1} fill={FLAT_FILL}>
                        <title>{`${row.gene} is not expressed along ${lineage.name}`}</title>
                      </rect>
                    ) : (
                      values.map((value, i) => (
                        <rect
                          key={i}
                          x={x0 + i * colW}
                          y={y}
                          width={colW + 0.4}
                          height={rowH - 1}
                          fill={blues((value - lo) / Math.max(1e-9, hi - lo))}
                        />
                      ))
                    )}
                  </g>
                );
              })}
              <line x1={x0} x2={x0 + panelW} y1={top + plotH + 3} y2={top + plotH + 3} stroke={INK} strokeWidth="0.9" />
              {[0, 0.5, 1].map((f) => {
                const x = x0 + f * panelW;
                const value = tMin + f * (tMax - tMin);
                return (
                  <g key={f}>
                    <line x1={x} x2={x} y1={top + plotH + 3} y2={top + plotH + 7} stroke={INK} strokeWidth="0.9" />
                    <text x={x} y={top + plotH + 20} fontSize="11" textAnchor="middle" fill={INK}>
                      {Math.round(value)}
                    </text>
                  </g>
                );
              })}
              <text x={x0 + panelW / 2} y={top + plotH + 38} fontSize="12" textAnchor="middle" fill={INK}>
                Pseudotime
              </text>
            </g>
          );
        })}
        {/* Row labels and interaction bands span every lineage panel. */}
        {rows.map((row, r) => {
          const y = top + r * rowH;
          const on = row.gene === selectedGene;
          const x2 = panelX(L - 1) + panelW;
          const peakText = row.peaks
            .map((peak, i) => `${lineages[i].name}: ${peak === null ? "not expressed" : `peak at ${Math.round(peak)}`}`)
            .join(" · ");
          return (
            <g
              key={row.gene}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(row.gene)}
              onClick={() => onSelect(on ? null : row.gene)}
            >
              <title>{`${row.gene} — ${peakText}. Click to inspect.`}</title>
              <rect x={0} y={y} width={x2} height={rowH} fill="transparent" />
              <text
                x={nameW - 8}
                y={y + rowH / 2 + 4}
                fontSize={rowH >= 18 ? 12 : 11}
                fontStyle="italic"
                textAnchor="end"
                fill={on ? SELECT : INK}
                fontWeight={on ? 700 : 400}
                data-export-fill={INK}
                data-export-weight="400"
              >
                {row.gene}
              </text>
              {lineages.map((lineage, li) => {
                const x = panelX(li);
                return on ? (
                  <g key={lineage.name}>
                    <rect x={x + 1} y={y + 0.5} width={panelW - 2} height={rowH - 2} fill="none" stroke="#111111" strokeWidth="2.5" pointerEvents="none" data-ui="" />
                    <rect x={x + 3} y={y + 2.5} width={panelW - 6} height={rowH - 6} fill="none" stroke="#ffffff" strokeWidth="1" pointerEvents="none" data-ui="" />
                  </g>
                ) : hovered === row.gene ? (
                  <rect key={lineage.name} x={x + 0.5} y={y} width={panelW - 1} height={rowH - 1} fill="none" stroke="#111111" strokeWidth="1.2" pointerEvents="none" data-ui="" />
                ) : null;
              })}
            </g>
          );
        })}
        {/* Colour key */}
        {(() => {
          const kx = panelX(L - 1) + panelW + 22;
          const ky = top;
          const kh = Math.min(130, Math.max(80, plotH * 0.45));
          return (
            <g>
              {Array.from({ length: 40 }, (_, i) => (
                <rect key={i} x={kx} y={ky + kh - ((i + 1) * kh) / 40} width="10" height={kh / 40 + 0.4} fill={blues(i / 39)} />
              ))}
              <text x={kx + 15} y={ky + 8} fontSize="11" fill={INK}>1</text>
              <text x={kx + 15} y={ky + kh + 1} fontSize="11" fill={INK}>0</text>
              <text transform={`translate(${kx + 34} ${ky + kh / 2}) rotate(90)`} fontSize="11" textAnchor="middle" fill={INK}>
                Scaled expression
              </text>
              <rect x={kx} y={ky + kh + 20} width="10" height="10" fill={FLAT_FILL} stroke="#cfd5db" strokeWidth="0.8" />
              <text x={kx + 15} y={ky + kh + 29} fontSize="11" fill={INK}>Not expressed</text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

/** Line plot of one gene in every lineage, real expression units. */
export function GeneTrendPlot({
  gene,
  lineages,
  expressionLabel,
}: {
  gene: string;
  lineages: CascadeLineage[];
  expressionLabel: string;
}) {
  const W = 330;
  const H = 190;
  const left = 38;
  const right = 8;
  const top = 26;
  const bottom = 34;
  const pw = W - left - right;
  const ph = H - top - bottom;
  const tMax = Math.max(1, ...lineages.map((lineage) => lineage.pseudotime.at(-1) ?? 0));
  const yMax = niceMax(Math.max(0, ...lineages.flatMap((lineage) => lineage.expression[gene] ?? [])));
  const sx = (t: number) => left + (t / tMax) * pw;
  const sy = (v: number) => top + ph - (v / yMax) * ph;
  const xTicks = [0, tMax / 2, tMax].map((t) => Math.round(t));
  const yTicks = [0, yMax / 2, yMax];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", maxWidth: W }} fontFamily={FONT} role="img" aria-label={`${gene} trend in each lineage`}>
      <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
      {lineages.map((lineage, li) => (
        <g key={lineage.name} transform={`translate(${left + li * 120} 8)`}>
          <line x1="0" x2="20" y1="4" y2="4" stroke={LINEAGE_COLORS[li % LINEAGE_COLORS.length]} strokeWidth="2" strokeDasharray={LINEAGE_DASH[li % LINEAGE_DASH.length]} />
          <text x="25" y="8" fontSize="10.5" fill={INK}>{lineage.name}</text>
        </g>
      ))}
      <path d={`M${left} ${top}V${top + ph}H${left + pw}`} fill="none" stroke={INK} strokeWidth="0.9" />
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={left - 3} x2={left} y1={sy(v)} y2={sy(v)} stroke={INK} strokeWidth="0.9" />
          <text x={left - 6} y={sy(v) + 3.5} fontSize="10" textAnchor="end" fill={INK}>{Number(v.toFixed(2))}</text>
        </g>
      ))}
      {xTicks.map((t) => (
        <g key={t}>
          <line x1={sx(t)} x2={sx(t)} y1={top + ph} y2={top + ph + 3} stroke={INK} strokeWidth="0.9" />
          <text x={sx(t)} y={top + ph + 14} fontSize="10" textAnchor="middle" fill={INK}>{t}</text>
        </g>
      ))}
      <text x={left + pw / 2} y={H - 4} fontSize="10.5" textAnchor="middle" fill={MUTED}>Pseudotime</text>
      <text transform={`translate(10 ${top + ph / 2}) rotate(-90)`} fontSize="10.5" textAnchor="middle" fill={MUTED}>
        {expressionLabel.replace(/ expression$/i, "")}
      </text>
      {lineages.map((lineage, li) => {
        const values = lineage.expression[gene];
        if (!values?.length) return null;
        const d = values.map((v, i) => `${i ? "L" : "M"}${sx(lineage.pseudotime[i]).toFixed(1)} ${sy(v).toFixed(1)}`).join("");
        return (
          <path
            key={lineage.name}
            d={d}
            fill="none"
            stroke={LINEAGE_COLORS[li % LINEAGE_COLORS.length]}
            strokeWidth="2"
            strokeDasharray={LINEAGE_DASH[li % LINEAGE_DASH.length]}
          />
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Regulator → target timing                                           */
/* ------------------------------------------------------------------ */

export type TimingEdge = {
  source: string;
  target: string;
  /** Number of directed methods with this edge in their top-ranked list. */
  support: number;
  methods: number;
  sign: -1 | 0 | 1;
};

/**
 * Onset = first pseudotime at which the trend reaches half of its range
 * (min to max), searched up to the peak, with linear interpolation.
 */
export function onsetTime(pseudotime: number[], values: number[]): number | null {
  if (!values.length) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi <= lo) return null;
  const half = lo + 0.5 * (hi - lo);
  const peak = values.indexOf(hi);
  for (let i = 0; i <= peak; i += 1) {
    if (values[i] >= half) {
      if (i === 0) return pseudotime[0];
      const f = (half - values[i - 1]) / Math.max(1e-12, values[i] - values[i - 1]);
      return pseudotime[i - 1] + f * (pseudotime[i] - pseudotime[i - 1]);
    }
  }
  return pseudotime[peak];
}

export function RegulatorTimingPlot({
  lineage,
  regulator,
  target,
  showOnsets = false,
  svgRef,
}: {
  lineage: CascadeLineage;
  regulator: string;
  target: string;
  /** Adds the half-maximum onset marks and the lag bracket (off by default). */
  showOnsets?: boolean;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const [boxWidth, measure] = useWidth();
  const W = Math.max(520, Math.min(980, boxWidth || 760));
  const H = 360;
  const left = 58;
  const right = 150;
  const top = showOnsets ? 58 : 24;
  const bottom = 52;
  const pw = W - left - right;
  const ph = H - top - bottom;
  const t = lineage.pseudotime;
  const tMin = t[0] ?? 0;
  const tMax = t.at(-1) ?? 1;
  const sx = (value: number) => left + ((value - tMin) / Math.max(1e-9, tMax - tMin)) * pw;
  const sy = (value: number) => top + ph - value * ph;
  const genes = [
    { gene: regulator, role: "regulator", color: INK, dash: "" },
    { gene: target, role: "target", color: LINEAGE_COLORS[0], dash: "" },
  ].map((item) => {
    const values = lineage.expression[item.gene] ?? [];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const scaled = values.map((value) => (hi > lo ? (value - lo) / (hi - lo) : 0));
    return { ...item, scaled, onset: onsetTime(t, values) };
  });
  const [reg, tar] = genes;
  const lag = reg.onset !== null && tar.onset !== null ? tar.onset - reg.onset : null;
  const step = niceMax((tMax - tMin) / 5);
  const xTicks: number[] = [];
  for (let value = Math.ceil(tMin / step) * step; value <= tMax + 1e-9; value += step) xTicks.push(value);
  // Curve-end labels, nudged apart when the curves finish close together.
  const ends = genes.map((item) => ({ item, y: sy(item.scaled.at(-1) ?? 0) }));
  if (Math.abs(ends[0].y - ends[1].y) < 30) {
    const mid = (ends[0].y + ends[1].y) / 2;
    const upper = ends[0].y <= ends[1].y ? 0 : 1;
    ends[upper].y = mid - 15;
    ends[1 - upper].y = mid + 15;
  }
  return (
    <div ref={measure} className="min-w-0 overflow-x-auto">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ display: "block" }}
        fontFamily={FONT}
        role="img"
        aria-label={`${regulator} and ${target} trends along ${lineage.name}, with the onset of each`}
      >
        <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
        <path d={`M${left} ${top}V${top + ph}H${left + pw}`} fill="none" stroke={INK} strokeWidth="1" />
        {[0, 0.5, 1].map((value) => (
          <g key={value}>
            <line x1={left - 4} x2={left} y1={sy(value)} y2={sy(value)} stroke={INK} strokeWidth="1" />
            <text x={left - 8} y={sy(value) + 4} fontSize="12" textAnchor="end" fill={INK}>{value}</text>
          </g>
        ))}
        {xTicks.map((value) => (
          <g key={value}>
            <line x1={sx(value)} x2={sx(value)} y1={top + ph} y2={top + ph + 4} stroke={INK} strokeWidth="1" />
            <text x={sx(value)} y={top + ph + 18} fontSize="12" textAnchor="middle" fill={INK}>{Number(value.toFixed(1))}</text>
          </g>
        ))}
        <text x={left + pw / 2} y={H - 10} fontSize="13" textAnchor="middle" fill={INK}>{`${lineage.name} pseudotime`}</text>
        <text transform={`translate(16 ${top + ph / 2}) rotate(-90)`} fontSize="13" textAnchor="middle" fill={INK}>Scaled expression</text>
        {showOnsets ? <line x1={left} x2={left + pw} y1={sy(0.5)} y2={sy(0.5)} stroke="#c3c9ce" strokeDasharray="3 3" /> : null}
        {genes.map((item) => (
          <g key={item.role}>
            <path
              d={item.scaled.map((value, i) => `${i ? "L" : "M"}${sx(t[i]).toFixed(1)} ${sy(value).toFixed(1)}`).join("")}
              fill="none"
              stroke={item.color}
              strokeWidth="2.2"
            />
            {showOnsets && item.onset !== null ? (
              <g>
                <line x1={sx(item.onset)} x2={sx(item.onset)} y1={sy(0.5)} y2={top + ph} stroke={item.color} strokeWidth="1" />
                <circle cx={sx(item.onset)} cy={sy(0.5)} r="3.5" fill="#ffffff" stroke={item.color} strokeWidth="1.6" />
              </g>
            ) : null}
          </g>
        ))}
        {ends.map(({ item, y }) => (
          <text key={item.role} x={left + pw + 10} y={y + 4} fontSize="13" fill={item.color}>
            <tspan fontStyle="italic" fontWeight="700">{item.gene}</tspan>
            <tspan fill={MUTED} fontSize="11.5">{` ${item.role}`}</tspan>
          </text>
        ))}
        {showOnsets && lag !== null && reg.onset !== null && tar.onset !== null ? (
          <g>
            <path
              d={`M${sx(reg.onset)} ${top - 18}v6M${sx(reg.onset)} ${top - 15}H${sx(tar.onset)}M${sx(tar.onset)} ${top - 18}v6`}
              fill="none"
              stroke={INK}
              strokeWidth="1"
            />
            <text x={(sx(reg.onset) + sx(tar.onset)) / 2} y={top - 24} fontSize="12.5" textAnchor="middle" fill={INK}>
              {`Onset lag ${lag >= 0 ? "+" : "−"}${Math.abs(lag).toFixed(0)}`}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
