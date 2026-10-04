"use client";

/**
 * Journal-style gene-trend figures for the Trajectory tab:
 *  - CascadeHeatmap: smoothed trends as rows, pseudotime as columns, each row
 *    scaled 0–1 across all lineages together (as tradeSeq recommends for
 *    comparing lineages) and sorted by peak time (CellRank 2 Fig. 3e,
 *    Monocle plot_pseudotime_heatmap), lineages side by side.
 *  - GeneTrendPanel: the inspection panel for one gene, its trend in real
 *    expression units in every lineage (tradeSeq plotSmoothers).
 * Plain SVG, one unit per pixel, so downloads match the screen.
 */

import { useCallback, useId, useRef, useState, type Ref } from "react";

const FONT = "Arial, Helvetica, sans-serif";
const INK = "#1a1a1a";
const MUTED = "#6b7580";
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
 * A gene has no peak in a lineage when its fitted trend barely moves compared
 * with the most dynamic gene in the dataset. Such a lineage does not order the
 * gene; the heatmap itself simply draws it pale, because rows are scaled across
 * lineages.
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
  selectedGene,
  onSelect,
  sortIndex = 0,
  onSortChange,
  svgRef,
}: {
  lineages: CascadeLineage[];
  rows: CascadeRow[];
  selectedGene: string | null;
  onSelect: (gene: string | null) => void;
  /** Which lineage orders the rows, and what clicking a lineage name does. */
  sortIndex?: number;
  onSortChange?: (lineageIndex: number) => void;
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
  // No strip above the rows: the pseudotime colour key is the axis under them,
  // the same place and form as in the cell-trajectory figure.
  const top = 28;
  const plotH = rows.length * rowH;
  const W = nameW + L * panelW + (L - 1) * gap + keyW;
  const H = top + plotH + 60;
  const panelX = (index: number) => nameW + index * (panelW + gap);
  const rowScale: Record<string, [number, number]> = Object.fromEntries(
    rows.map((row) => {
      const all = lineages.flatMap((lineage) => lineage.expression[row.gene] ?? []);
      return [row.gene, all.length ? [Math.min(...all), Math.max(...all)] : [0, 1]];
    }),
  );

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
        <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
        {lineages.map((lineage, li) => {
          const x0 = panelX(li);
          const n = lineage.pseudotime.length;
          const colW = panelW / n;
          const tMin = lineage.pseudotime[0] ?? 0;
          const tMax = lineage.pseudotime[n - 1] ?? 1;
          return (
            <g key={lineage.name}>
              {/* With several lineages one of them orders the rows: its name says
                * so, and clicking another name sorts by that one instead. */}
              <text
                x={x0 + panelW / 2}
                y={14}
                fontSize="13"
                fontWeight="700"
                textAnchor="middle"
                fill={INK}
                style={L > 1 && onSortChange && li !== sortIndex ? { cursor: "pointer" } : undefined}
                onClick={L > 1 && onSortChange && li !== sortIndex ? () => onSortChange(li) : undefined}
              >
                {L > 1 && onSortChange ? (
                  <title>{li === sortIndex ? `Genes are sorted by when they peak along ${lineage.name}` : `Sort genes by when they peak along ${lineage.name}`}</title>
                ) : null}
                {lineage.name}
              </text>
              {rows.map((row, r) => {
                const values = lineage.expression[row.gene] ?? [];
                // One scale per gene across every lineage: a gene that is off
                // in this lineage stays pale here instead of being stretched.
                const [lo, hi] = rowScale[row.gene] ?? [0, 1];
                const y = top + r * rowH;
                return (
                  <g key={row.gene}>
                    {values.map((value, i) => (
                      <rect
                        key={i}
                        x={x0 + i * colW}
                        y={y}
                        width={colW + 0.4}
                        height={rowH - 1}
                        fill={blues((value - lo) / Math.max(1e-9, hi - lo))}
                      />
                    ))}
                  </g>
                );
              })}
              {/* Pseudotime axis: the colour key with ticks. */}
              {Array.from({ length: n }, (_, i) => (
                <rect key={i} x={x0 + i * colW} y={top + plotH + 3} width={colW + 0.4} height={9} fill={viridis(i / Math.max(1, n - 1))} />
              ))}
              <line x1={x0} x2={x0 + panelW} y1={top + plotH + 12} y2={top + plotH + 12} stroke={INK} strokeWidth="0.9" />
              {[0, 0.25, 0.5, 0.75, 1].map((f) => {
                const x = x0 + f * panelW;
                const value = tMin + f * (tMax - tMin);
                return (
                  <g key={f}>
                    <line x1={x} x2={x} y1={top + plotH + 12} y2={top + plotH + 16} stroke={INK} strokeWidth="0.9" />
                    <text x={x} y={top + plotH + 29} fontSize="11" textAnchor="middle" fill={INK}>
                      {Math.round(value)}
                    </text>
                  </g>
                );
              })}
              <text x={x0 + panelW / 2} y={top + plotH + 48} fontSize="12" textAnchor="middle" fill={INK}>
                {`${lineage.name} pseudotime`}
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
            .map((peak, i) => `${lineages[i].name}: ${peak === null ? "no peak" : `peak at ${Math.round(peak)}`}`)
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

/* ------------------------------------------------------------------ */
/* Regulators of one target: chooser diagram + curves on one axis      */
/* ------------------------------------------------------------------ */

const PATH_COLORS = ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#e69f00", "#56b4e9", "#7a5195", "#8c6d31"];
const FAINT = "#b4bcc4";

export function RegulatorPathFigure({
  lineage,
  target,
  direct,
  upstream,
  focus,
  pickedDirect,
  pickedUpstream,
  plotted,
  colorOrder,
  onsets,
  onDirect,
  onUpstream,
  targets,
  onTarget,
}: {
  lineage: CascadeLineage;
  target: string;
  /** Genes that can be chosen as the target, from the menu on the target box. */
  targets: Array<{ gene: string; count: number }>;
  onTarget: (gene: string) => void;
  /** Genes with an edge into the target, earliest onset first. */
  direct: string[];
  /** Genes with an edge into the focused direct regulator. */
  upstream: string[];
  /** The direct regulator whose own regulators are listed on the left. */
  focus: string | null;
  pickedDirect: string[];
  /** Upstream genes picked for the focused direct regulator. */
  pickedUpstream: string[];
  /** Every gene drawn in the plot besides the target. */
  plotted: string[];
  /** Fixes each gene's colour while the selection changes. */
  colorOrder: string[];
  onsets: Record<string, number>;
  onDirect: (gene: string) => void;
  onUpstream: (gene: string) => void;
}) {
  const [boxWidth, measure] = useWidth();
  const [hover, setHover] = useState<string | null>(null);
  const uid = useId().replace(/:/g, "");
  const W = Math.max(840, Math.min(1100, boxWidth || 900));
  const longest = Math.max(...[target, ...direct, ...upstream].map((gene) => gene.length));
  const cw = Math.max(84, Math.min(128, longest * 7.4 + 38));
  const gap = 44;
  const rowH = 34;
  const X = [12, 12 + cw + gap, 12 + 2 * (cw + gap)];
  const left = X[2] + cw + 76;
  const pw = W - left - 18;
  const top = 50;
  const ph = 260;
  const ty = top + 44;
  const rowsN = Math.max(direct.length, upstream.length, 1);
  // One key row along the bottom of the whole figure.
  const H = Math.max(top + ph + 72, ty + rowsN * rowH + 36);
  const keyY = H - 14;
  const t = lineage.pseudotime;
  const tMin = t[0] ?? 0;
  const tMax = t.at(-1) ?? 1;
  const sx = (value: number) => left + ((value - tMin) / Math.max(1e-9, tMax - tMin)) * pw;
  const sy = (value: number) => top + ph - value * ph;
  const step = niceMax((tMax - tMin) / 5);
  const xTicks: number[] = [];
  for (let value = Math.ceil(tMin / step) * step; value <= tMax + 1e-9; value += step) xTicks.push(value);
  const scaledOf = (gene: string) => {
    const values = lineage.expression[gene] ?? [];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return values.map((value) => (hi > lo ? (value - lo) / (hi - lo) : 0));
  };
  const pathOf = (gene: string) =>
    scaledOf(gene).map((value, i) => `${i ? "L" : "M"}${sx(t[i]).toFixed(1)} ${sy(value).toFixed(1)}`).join("");
  const colorOf = (gene: string) =>
    gene === target ? INK : PATH_COLORS[Math.max(0, colorOrder.indexOf(gene)) % PATH_COLORS.length];
  const hoverGene = hover ? hover.slice(2) : null;
  const ghost = hoverGene && hoverGene !== target && !plotted.includes(hoverGene) ? hoverGene : null;
  const curves = [...plotted, target];
  // Gene names sit above each curve's peak, on up to three levels so neighbours do not collide.
  const lastX: number[] = [];
  const labels = [...curves, ...(ghost ? [ghost] : [])]
    .map((gene) => {
      const scaled = scaledOf(gene);
      return { gene, x: sx(t[scaled.indexOf(Math.max(...scaled))] ?? tMin) };
    })
    .sort((a, b) => a.x - b.x)
    .map((label) => {
      let level = 0;
      while (level < 2 && lastX[level] !== undefined && label.x - lastX[level] < label.gene.length * 7.2 + 14) level += 1;
      lastX[level] = label.x;
      const half = label.gene.length * 3.6;
      return { ...label, y: top - 8 - level * 14, tx: Math.max(left + half, Math.min(left + pw - half, label.x)) };
    });
  const yOf = (index: number, count: number) => ty + ((rowsN - count) * rowH) / 2 + index * rowH;
  const upstreamY = (gene: string) => yOf(upstream.indexOf(gene), upstream.length);
  const directY = (gene: string) => yOf(direct.indexOf(gene), direct.length);
  const targetY = yOf(0, 1);
  const arrows = [
    ...(focus
      ? upstream.map((gene) => ({
          key: `u-${gene}`,
          x1: X[0] + cw,
          y1: upstreamY(gene),
          x2: X[1] - 3,
          y2: directY(focus),
          ordered: onsets[gene] < onsets[focus],
          on: pickedUpstream.includes(gene) || hover === `u:${gene}`,
        }))
      : []),
    ...direct.map((gene) => ({
      key: `d-${gene}`,
      x1: X[1] + cw,
      y1: directY(gene),
      x2: X[2] - 3,
      y2: targetY,
      ordered: onsets[gene] < onsets[target],
      on: pickedDirect.includes(gene) || hover === `d:${gene}`,
    })),
  ].sort((a, b) => Number(a.on) - Number(b.on));
  const box = (kind: "u" | "d" | "t", gene: string, x: number, y: number) => {
    const on = kind === "t" || (kind === "u" ? pickedUpstream.includes(gene) : pickedDirect.includes(gene));
    const hot = hover === `${kind}:${gene}`;
    const color = colorOf(gene);
    return (
      <g
        key={`${kind}-${gene}`}
        onClick={kind === "t" ? undefined : () => (kind === "u" ? onUpstream(gene) : onDirect(gene))}
        onMouseEnter={() => setHover(`${kind}:${gene}`)}
        onMouseLeave={() => setHover(null)}
        style={{ cursor: kind === "t" ? "default" : "pointer" }}
      >
        <title>{`${gene}: switches on at ${onsets[gene]?.toFixed(0) ?? "?"}`}</title>
        <rect
          x={x}
          y={y - 12}
          width={cw}
          height={24}
          rx={4}
          fill={on || hot ? "#ffffff" : "#f7f9fa"}
          stroke={on || hot ? color : "#c3cbd2"}
          strokeWidth={on ? 2 : 1}
        />
        <text x={x + 10} y={y + 4} fontSize="12" fontStyle="italic" fontWeight={on ? 700 : 400} fill={on || hot ? color : MUTED}>
          {gene}
        </text>
        {kind === "t" ? (
          <path d={`M${x + cw - 17} ${y - 2.5}l4 4l4 -4`} fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" data-ui="true" />
        ) : null}
      </g>
    );
  };
  return (
    <div ref={measure} className="min-w-0 overflow-x-auto">
      <div style={{ position: "relative", width: W }}>
      {/* The target box is the target menu: an invisible native select sits on top of it. */}
      <select
        id="trajectory-timing-target"
        aria-label="Target gene"
        title="Choose the target gene"
        value={target}
        onChange={(event) => onTarget(event.target.value)}
        style={{ position: "absolute", left: X[2], top: targetY - 12, width: cw, height: 24, opacity: 0, cursor: "pointer" }}
      >
        {targets.map((item) => (
          <option key={item.gene} value={item.gene}>
            {item.gene} · {item.count} regulator{item.count === 1 ? "" : "s"}
          </option>
        ))}
      </select>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ display: "block" }}
        fontFamily={FONT}
        role="img"
        aria-label={`Regulators of ${target} and their expression along ${lineage.name}`}
      >
        <defs>
          {([["d", INK], ["f", FAINT]] as const).map(([kind, color]) => (
            <marker key={kind} id={`${uid}-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
              <path d="M0 0L10 5L0 10z" fill={color} />
            </marker>
          ))}
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="#ffffff" />

        {/* Left: who regulates whom. */}
        {focus ? (
          <text x={X[0] + cw / 2} y={ty - 22} fontSize="11" textAnchor="middle" fill={MUTED}>
            Regulators of <tspan fontStyle="italic">{focus}</tspan>
          </text>
        ) : (
          <text fontSize="10.5" textAnchor="middle" fill={MUTED}>
            <tspan x={X[0] + cw / 2} y={targetY - 3}>Pick a direct regulator</tspan>
            <tspan x={X[0] + cw / 2} y={targetY + 11}>to see what regulates it</tspan>
          </text>
        )}
        {focus && !upstream.length ? (
          <text x={X[0] + cw / 2} y={directY(focus) + 4} fontSize="10.5" textAnchor="middle" fill={MUTED}>none found</text>
        ) : null}
        <text x={X[1] + cw / 2} y={ty - 22} fontSize="11" textAnchor="middle" fill={MUTED}>Direct regulators</text>
        <text x={X[2] + cw / 2} y={ty - 22} fontSize="11" textAnchor="middle" fill={MUTED}>Target</text>
        <text x={X[2] + cw / 2} y={targetY + 26} fontSize="10" textAnchor="middle" fill={MUTED} data-ui="true">click to change</text>
        {arrows.map((arrow) => {
          const mx = (arrow.x1 + arrow.x2) / 2;
          return (
            <path
              key={arrow.key}
              d={`M${arrow.x1} ${arrow.y1}C${mx} ${arrow.y1} ${mx} ${arrow.y2} ${arrow.x2} ${arrow.y2}`}
              fill="none"
              stroke={arrow.on ? INK : FAINT}
              strokeWidth={arrow.on ? 1.6 : 0.9}
              strokeDasharray={arrow.ordered ? undefined : "3 2.5"}
              markerEnd={`url(#${uid}-${arrow.on ? "d" : "f"})`}
            />
          );
        })}
        {upstream.map((gene) => box("u", gene, X[0], upstreamY(gene)))}
        {direct.map((gene) => box("d", gene, X[1], directY(gene)))}
        {box("t", target, X[2], targetY)}
        <g fontSize="10.5" fill={INK}>
          <line x1={X[0]} x2={X[0] + 22} y1={keyY} y2={keyY} stroke={INK} strokeWidth="0.9" markerEnd={`url(#${uid}-d)`} />
          <text x={X[0] + 29} y={keyY + 3.5}>regulator on first</text>
          <line x1={X[0] + 150} x2={X[0] + 172} y1={keyY} y2={keyY} stroke={INK} strokeWidth="0.9" strokeDasharray="3 2.5" markerEnd={`url(#${uid}-d)`} />
          <text x={X[0] + 179} y={keyY + 3.5}>regulator on later</text>
          <line x1={X[0] + 300} x2={X[0] + 322} y1={keyY} y2={keyY} stroke={INK} strokeWidth="1.8" />
          <text x={X[0] + 329} y={keyY + 3.5}>between plotted genes</text>
          <circle cx={X[0] + 471} cy={keyY} r="3" fill="#ffffff" stroke={INK} strokeWidth="1.4" />
          <text x={X[0] + 480} y={keyY + 3.5}>switch-on: first point at half of the gene&apos;s range</text>
        </g>

        {/* Right: the picked genes on one axis. */}
        {[0, 0.5, 1].map((value) => (
          <g key={value}>
            <line x1={left} x2={left + pw} y1={sy(value)} y2={sy(value)} stroke="#e9edf0" strokeWidth="0.8" />
            <line x1={left - 4} x2={left} y1={sy(value)} y2={sy(value)} stroke={INK} strokeWidth="1" />
            <text x={left - 8} y={sy(value) + 4} fontSize="12" textAnchor="end" fill={INK}>{value}</text>
          </g>
        ))}
        <path d={`M${left} ${top}V${top + ph}H${left + pw}`} fill="none" stroke={INK} strokeWidth="1" />
        {xTicks.map((value) => (
          <g key={value}>
            <line x1={sx(value)} x2={sx(value)} y1={top + ph} y2={top + ph + 4} stroke={INK} strokeWidth="1" />
            <text x={sx(value)} y={top + ph + 18} fontSize="12" textAnchor="middle" fill={INK}>{Number(value.toFixed(1))}</text>
          </g>
        ))}
        <text x={left + pw / 2} y={top + ph + 38} fontSize="13" textAnchor="middle" fill={INK}>{`${lineage.name} pseudotime`}</text>
        <text transform={`translate(${left - 42} ${top + ph / 2}) rotate(-90)`} fontSize="13" textAnchor="middle" fill={INK}>Scaled expression</text>
        {ghost ? <path d={pathOf(ghost)} fill="none" stroke={colorOf(ghost)} strokeWidth="1.6" strokeDasharray="5 3" opacity="0.8" /> : null}
        {curves.map((gene) => (
          <g key={gene} opacity={hoverGene && hoverGene !== gene && gene !== target && plotted.includes(hoverGene) ? 0.35 : 1}>
            <path d={pathOf(gene)} fill="none" stroke={colorOf(gene)} strokeWidth={gene === target ? 2.6 : 2} />
            {onsets[gene] !== undefined ? (
              <circle cx={sx(onsets[gene])} cy={sy(0.5)} r="3.4" fill="#ffffff" stroke={colorOf(gene)} strokeWidth="1.5" />
            ) : null}
          </g>
        ))}
        {labels.map((label) => (
          <g key={label.gene}>
            <line x1={label.x} x2={label.x} y1={top - 1} y2={label.y + 3} stroke={colorOf(label.gene)} strokeWidth="0.8" />
            <text x={label.tx} y={label.y} fontSize="12" fontStyle="italic" fontWeight="700" textAnchor="middle" fill={colorOf(label.gene)}>
              {label.gene}
            </text>
          </g>
        ))}
      </svg>
      </div>
    </div>
  );
}
