"use client";

/**
 * Method-agreement figures drawn as journal figures (Comparison tab):
 *  - AgreementHeatmap: clustered similarity heatmap with a dendrogram
 *    (average linkage on 1 − similarity) — the pheatmap / ComplexHeatmap layout used in McCalla et al. (G3 2023).
 *  - UpSetPlot: UpSetR default styling (gray23 marks, gray88 row shading,
 *    set sizes pointing left), optionally grouped by number of methods
 *    ("aggregate by degree", Lex et al. 2014).
 *  - EulerDiagram: area-proportional circles for 2–3 methods (eulerr style),
 *    counts and share of all edges in every region.
 * All three are plain SVG so the PNG/SVG downloads are exactly what is shown.
 */

import { useCallback, useMemo, useRef, useState, type Ref } from "react";

export type AgreementIntersection = { key: string; members: string[]; edges: string[] };

const FONT = "Arial, Helvetica, sans-serif";
const INK = "#1a1a1a";
const MUTED = "#6b7580";
const UPSET_INK = "#3b3b3b"; // UpSetR default ("gray23")
const UPSET_ABSENT = "#dcdcdc";
const UPSET_SHADE = "#f3f3f3"; // gray88 at the UpSetR shade alpha, on white
const SELECT = "#087ead";

/* ------------------------------------------------------------------ */
/* Clustering                                                          */
/* ------------------------------------------------------------------ */

export type ClusterNode = { members: string[]; height: number; left?: ClusterNode; right?: ClusterNode };

/** Average-linkage hierarchical clustering on distance = 1 − similarity. */
export function clusterMethods(ids: string[], similarity: (a: string, b: string) => number): ClusterNode | null {
  if (!ids.length) return null;
  let nodes: ClusterNode[] = ids.map((id) => ({ members: [id], height: 0 }));
  const distance = (a: ClusterNode, b: ClusterNode) => {
    let sum = 0;
    for (const i of a.members) for (const j of b.members) sum += 1 - similarity(i, j);
    return sum / (a.members.length * b.members.length);
  };
  while (nodes.length > 1) {
    let best: [number, number] = [0, 1];
    let bestDistance = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const d = distance(nodes[i], nodes[j]);
        if (d < bestDistance) {
          bestDistance = d;
          best = [i, j];
        }
      }
    }
    const [i, j] = best;
    const merged: ClusterNode = {
      members: [...nodes[i].members, ...nodes[j].members],
      height: Math.max(bestDistance, nodes[i].height, nodes[j].height),
      left: nodes[i],
      right: nodes[j],
    };
    nodes = nodes.filter((_, index) => index !== i && index !== j);
    nodes.push(merged);
  }
  return nodes[0];
}

/* ------------------------------------------------------------------ */
/* Heatmap                                                             */
/* ------------------------------------------------------------------ */

function blues(t: number) {
  const stops = [[239, 245, 250], [198, 219, 239], [107, 174, 214], [33, 113, 181], [8, 48, 107]];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Distance from the top of the heatmap SVG to its first row of cells. */
export function heatmapPlotTop(methods: string[]) {
  const longest = Math.max(0, ...methods.map((id) => id.length));
  return Math.min(120, 24 + longest * 6.2);
}
/** Distance from the top of the UpSet SVG to the top of its bar axis. */
export function upsetPlotTop(byDegree: boolean) {
  return byDegree ? 46 : 26;
}

export function AgreementHeatmap({
  tree,
  similarity,
  sizeOf,
  topK,
  metricLabel,
  showValues,
  selectedPair,
  onSelectPair,
  svgRef,
}: {
  tree: ClusterNode;
  similarity: (a: string, b: string) => number;
  sizeOf: (id: string) => number;
  topK: number;
  metricLabel: string;
  showValues: boolean;
  selectedPair: [string, string] | null;
  onSelectPair: (pair: [string, string] | null) => void;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const order = tree.members;
  const n = order.length;
  const showTree = n >= 3;
  const cell = n <= 5 ? 66 : n <= 8 ? 54 : n <= 12 ? 48 : 34;
  const treeW = showTree ? 96 : 0;
  const nameW = 128;
  const strip = 0;
  const top = heatmapPlotTop(order);
  const left = treeW + nameW + strip + 8;
  const legendX = left + n * cell + 24;
  const W = legendX;
  const H = top + n * cell + (showTree ? 50 : 20);

  let minValue = 1;
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) minValue = Math.min(minValue, similarity(order[i], order[j]));
  const lo = Math.min(0, Math.floor(minValue * 10) / 10);
  const scale = (v: number) => (v - lo) / (1 - lo);

  // Dendrogram geometry: distance axis runs right (0) to left (max).
  const maxDist = Math.max(1, Math.ceil(tree.height * 2) / 2);
  const hx = (h: number) => treeW - 8 - (h / maxDist) * (treeW - 16);
  const leafY = new Map(order.map((id, index) => [id, top + index * cell + cell / 2]));
  const branches: string[] = [];
  const walk = (node: ClusterNode): { x: number; y: number } => {
    if (!node.left || !node.right) return { x: treeW - 8, y: leafY.get(node.members[0]) ?? 0 };
    const a = walk(node.left);
    const b = walk(node.right);
    const x = hx(node.height);
    branches.push(`M${a.x} ${a.y}H${x}V${b.y}H${b.x}`);
    return { x, y: (a.y + b.y) / 2 };
  };
  if (showTree) walk(tree);

  const valueText = (v: number) => (Math.abs(v) >= 0.995 ? v.toFixed(1) : v.toFixed(2).replace(/^(-?)0\./, "$1."));

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ display: "block" }}
      fontFamily={FONT}
      role="img"
      aria-label={`Clustered heatmap of ${metricLabel} between methods' top ${topK} edges`}
      onMouseLeave={() => setHovered(null)}
    >
      <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
      {showTree && (
        <>
          {branches.map((d, i) => <path key={i} d={d} fill="none" stroke={INK} strokeWidth="0.8" />)}
          <line x1={hx(maxDist)} x2={hx(0)} y1={top + n * cell + 10} y2={top + n * cell + 10} stroke={INK} strokeWidth="0.8" />
          {[0, maxDist / 2, maxDist].map((t) => (
            <g key={t}>
              <line x1={hx(t)} x2={hx(t)} y1={top + n * cell + 10} y2={top + n * cell + 14} stroke={INK} strokeWidth="0.8" />
              <text x={hx(t)} y={top + n * cell + 25} fontSize="9.5" textAnchor="middle" fill={INK}>{t === 0 ? "0" : String(Number(t.toFixed(2))).replace(/^0\./, ".")}</text>
            </g>
          ))}
          <text x={hx(maxDist / 2)} y={top + n * cell + 39} fontSize="9.5" textAnchor="middle" fill={MUTED}>1 − similarity</text>
        </>
      )}
      {order.map((id, index) => {
        const y = top + index * cell;
        const size = sizeOf(id);
        const on = !!selectedPair && selectedPair.includes(id);
        return (
          <g key={id}>
            <text x={treeW + nameW - 4} y={y + cell / 2 + 4} fontSize="12.5" textAnchor="end" fill={on ? SELECT : INK} fontWeight={on ? 700 : 400} data-export-fill={INK} data-export-weight="400">
              {id}
              {size < topK && <tspan fill={MUTED} fontSize="9.5" dx="4">{`n = ${size}`}</tspan>}
            </text>
            <text transform={`translate(${left + index * cell + cell / 2 + 4} ${top - 10}) rotate(-50)`} fontSize="12" fill={on ? SELECT : INK} fontWeight={on ? 700 : 400} data-export-fill={INK} data-export-weight="400">{id}</text>
          </g>
        );
      })}
      {order.map((rowId, r) =>
        order.map((columnId, c) => {
          const x = left + c * cell;
          const y = top + r * cell;
          if (rowId === columnId) {
            // A method compared with itself: similarity 1, drawn like any other cell.
            return (
              <g key={`${r}-${c}`}>
                <title>{`${rowId} vs itself: ${metricLabel} 1`}</title>
                <rect x={x} y={y} width={cell} height={cell} fill={blues(scale(1))} stroke="#ffffff" strokeWidth="1" />
                {showValues && (
                  <text x={x + cell / 2} y={y + cell / 2 + 3.5} fontSize={cell >= 48 ? 11.5 : cell >= 40 ? 10.5 : 9} textAnchor="middle" fill="#ffffff" pointerEvents="none">
                    1
                  </text>
                )}
              </g>
            );
          }
          const v = similarity(rowId, columnId);
          const selected =
            !!selectedPair &&
            ((selectedPair[0] === rowId && selectedPair[1] === columnId) || (selectedPair[0] === columnId && selectedPair[1] === rowId));
          const t = scale(v);
          return (
            <g
              key={`${r}-${c}`}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(`${rowId}|${columnId}`)}
              onClick={() => onSelectPair(selected ? null : [columnId, rowId])}
            >
              <title>{`${rowId} vs ${columnId}: ${metricLabel} ${v.toFixed(3)}. Click to inspect shared edges.`}</title>
              <rect x={x} y={y} width={cell} height={cell} fill={blues(t)} stroke="#ffffff" strokeWidth="1" />
              {showValues && (
                <text x={x + cell / 2} y={y + cell / 2 + 3.5} fontSize={cell >= 48 ? 11.5 : cell >= 40 ? 10.5 : 9} textAnchor="middle" fill={t > 0.55 ? "#ffffff" : "#1f2a33"} pointerEvents="none">
                  {valueText(v)}
                </text>
              )}
              {selected ? (
                <>
                  <rect x={x + 1.5} y={y + 1.5} width={cell - 3} height={cell - 3} fill="none" stroke="#111111" strokeWidth="3" pointerEvents="none" data-ui="" />
                  <rect x={x + 3.5} y={y + 3.5} width={cell - 7} height={cell - 7} fill="none" stroke="#ffffff" strokeWidth="1.2" pointerEvents="none" data-ui="" />
                </>
              ) : hovered === `${rowId}|${columnId}` ? (
                <rect x={x + 1} y={y + 1} width={cell - 2} height={cell - 2} fill="none" stroke="#111111" strokeWidth="1.2" pointerEvents="none" data-ui="" />
              ) : null}
            </g>
          );
        }),
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* UpSet                                                               */
/* ------------------------------------------------------------------ */

export function UpSetPlot({
  methodOrder,
  intersections,
  visibleCount,
  byDegree,
  selectedKey,
  onSelect,
  svgRef,
}: {
  methodOrder: string[];
  intersections: AgreementIntersection[];
  visibleCount: number;
  byDegree: boolean;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  // Columns widen to fill the available width (text size stays fixed).
  const [boxWidth, setBoxWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!node) return;
    setBoxWidth(node.clientWidth);
    observer.current = new ResizeObserver(([entry]) => setBoxWidth(Math.round(entry.contentRect.width)));
    observer.current.observe(node);
  }, []);
  const shown = useMemo(() => {
    const top = intersections.slice(0, visibleCount);
    return byDegree
      ? [...top].sort((a, b) => a.members.length - b.members.length || b.edges.length - a.edges.length)
      : top;
  }, [intersections, visibleCount, byDegree]);
  const setSize = new Map(methodOrder.map((id) => [id, 0]));
  intersections.forEach((item) => item.members.forEach((id) => setSize.set(id, (setSize.get(id) ?? 0) + item.edges.length)));

  const n = methodOrder.length;
  const k = shown.length;
  const rowH = 26, setW = 120, nameW = 124, barH = 210;
  const top = upsetPlotTop(byDegree);
  const gx = setW + nameW + 16;
  const col = Math.max(30, Math.min(56, ((boxWidth || 700) - gx - 20) / Math.max(k, 4)));
  const W = gx + Math.max(k, 4) * col + 20;
  const gy = top + barH + 12;
  const H = gy + n * rowH + 34;
  const maxCount = Math.max(1, ...shown.map((item) => item.edges.length));
  const niceMax = (() => {
    const step = maxCount <= 10 ? 2 : maxCount <= 30 ? 5 : maxCount <= 60 ? 10 : maxCount <= 150 ? 25 : maxCount <= 300 ? 50 : 100;
    return { max: Math.ceil(maxCount / step) * step, step };
  })();
  const barY = (v: number) => top + barH - (v / niceMax.max) * barH;
  const maxSet = Math.max(1, ...methodOrder.map((id) => setSize.get(id) ?? 0));
  const inSelected = new Set(intersections.find((item) => item.key === selectedKey)?.members ?? []);
  const setX = (v: number) => (v / maxSet) * (setW - 40);

  // Degree blocks for the grouped order.
  const blocks: { degree: number; start: number; end: number }[] = [];
  if (byDegree) {
    shown.forEach((item, index) => {
      const last = blocks[blocks.length - 1];
      if (last && last.degree === item.members.length) last.end = index;
      else blocks.push({ degree: item.members.length, start: index, end: index });
    });
  }

  return (
    <div ref={measure} className="min-w-0">
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ display: "block" }}
      fontFamily={FONT}
      role="img"
      aria-label="UpSet plot of edges shared between methods"
      onMouseLeave={() => setHovered(null)}
    >
      <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
      {methodOrder.map((id, r) => (r % 2 === 0 ? <rect key={id} x={setW} y={gy + r * rowH} width={W - setW - 8} height={rowH} fill={UPSET_SHADE} /> : null))}
      {/* selection / hover band (not exported) */}
      {shown.map((item, c) => (item.key === selectedKey || item.key === hovered) ? (
        <rect key={`band-${item.key}`} x={gx + c * col + 2} y={top} width={col - 4} height={gy + n * rowH - top} fill={SELECT} fillOpacity={item.key === selectedKey ? 0.09 : 0.05} data-ui="" />
      ) : null)}
      {/* y axis */}
      <line x1={gx - 6} x2={gx - 6} y1={top} y2={top + barH} stroke={INK} strokeWidth="0.8" />
      {Array.from({ length: niceMax.max / niceMax.step + 1 }, (_, i) => i * niceMax.step).map((t) => (
        <g key={t}>
          <line x1={gx - 10} x2={gx - 6} y1={barY(t)} y2={barY(t)} stroke={INK} strokeWidth="0.8" />
          <text x={gx - 13} y={barY(t) + 3.5} fontSize="10" textAnchor="end" fill={INK}>{t}</text>
        </g>
      ))}
      <text transform={`translate(${gx - 44} ${top + barH / 2}) rotate(-90)`} fontSize="10.5" textAnchor="middle" fill={INK}>Intersection size</text>
      <line x1={gx - 6} x2={gx + k * col} y1={top + barH} y2={top + barH} stroke={INK} strokeWidth="0.8" />
      {blocks.map((block, i) => {
        const x1 = gx + block.start * col + 3;
        const x2 = gx + (block.end + 1) * col - 3;
        const wide = block.end > block.start;
        return (
          <g key={block.degree}>
            <line x1={x1} x2={x2} y1={top - 14} y2={top - 14} stroke={MUTED} strokeWidth="0.8" />
            <text x={(x1 + x2) / 2} y={top - 19} fontSize="9.5" textAnchor="middle" fill={MUTED}>
              {wide ? `${block.degree} method${block.degree > 1 ? "s" : ""}` : block.degree}
            </text>
            {i < blocks.length - 1 && <line x1={x2 + 3} x2={x2 + 3} y1={top - 8} y2={gy + n * rowH} stroke="#e1e5e9" strokeWidth="1" />}
          </g>
        );
      })}
      {byDegree && <text x={gx - 10} y={top - 19} fontSize="9.5" textAnchor="end" fill={MUTED}>Methods</text>}
      {shown.map((item, c) => {
        const cx = gx + c * col + col / 2;
        const count = item.edges.length;
        const rows = methodOrder.map((id, r) => (item.members.includes(id) ? r : -1)).filter((r) => r >= 0);
        const label = item.members.length === 1 ? `${item.members[0]} only` : item.members.join(" + ");
        const isSel = item.key === selectedKey;
        return (
          <g
            key={item.key}
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHovered(item.key)}
            onClick={() => onSelect(item.key === selectedKey ? null : item.key)}
          >
            <title>{`${label}: ${count} edge${count === 1 ? "" : "s"} (${item.members.length} method${item.members.length === 1 ? "" : "s"}). Click to list them.`}</title>
            <rect x={gx + c * col} y={top} width={col} height={gy + n * rowH - top} fill="transparent" />
            <rect x={cx - Math.min(12, col * 0.32)} y={barY(count)} width={Math.min(24, col * 0.64)} height={top + barH - barY(count)} fill={isSel ? SELECT : UPSET_INK} data-export-fill={UPSET_INK} />
            <text x={cx} y={barY(count) - 4} fontSize="10.5" textAnchor="middle" fill={isSel ? SELECT : INK} fontWeight={isSel ? 700 : 400} data-export-fill={INK} data-export-weight="400">{count}</text>
            {rows.length > 1 && (
              <line x1={cx} x2={cx} y1={gy + rows[0] * rowH + rowH / 2} y2={gy + rows[rows.length - 1] * rowH + rowH / 2} stroke={isSel ? SELECT : UPSET_INK} strokeWidth="1.8" data-export-stroke={UPSET_INK} />
            )}
            {methodOrder.map((id, r) => (
              <circle key={id} cx={cx} cy={gy + r * rowH + rowH / 2} r="5.4" fill={item.members.includes(id) ? (isSel ? SELECT : UPSET_INK) : UPSET_ABSENT} data-export-fill={item.members.includes(id) ? UPSET_INK : UPSET_ABSENT} />
            ))}
          </g>
        );
      })}
      {methodOrder.map((id, r) => {
        const y = gy + r * rowH;
        const size = setSize.get(id) ?? 0;
        return (
          <g key={id}>
            <text x={setW + nameW} y={y + rowH / 2 + 4} fontSize="12" textAnchor="end" fill={inSelected.has(id) ? SELECT : INK} fontWeight={inSelected.has(id) ? 700 : 400} data-export-fill={INK} data-export-weight="400">{id}</text>
            <rect x={setW - 8 - setX(size)} y={y + 5} width={setX(size)} height={rowH - 10} fill={UPSET_INK}>
              <title>{`${id}: ${size} edges`}</title>
            </rect>
            <text x={setW - 12 - setX(size)} y={y + rowH / 2 + 3.5} fontSize="9.5" textAnchor="end" fill={INK}>{size}</text>
          </g>
        );
      })}
      <text x={setW - 8} y={gy + n * rowH + 18} fontSize="10" textAnchor="end" fill={INK}>Set size</text>
      <text x={gx} y={gy + n * rowH + 18} fontSize="10" fill={MUTED}>
        {`Top ${k} of ${intersections.length} intersections`}
      </text>
    </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Euler (area-proportional Venn) for 2–3 methods                     */
/* ------------------------------------------------------------------ */

function lensArea(r1: number, r2: number, d: number) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a + b - c;
}
function distanceForOverlap(r1: number, r2: number, target: number) {
  let lo = Math.abs(r1 - r2);
  let hi = r1 + r2;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (lensArea(r1, r2, mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function EulerDiagram({
  methods,
  intersections,
  svgRef,
}: {
  methods: string[];
  intersections: AgreementIntersection[];
  svgRef?: Ref<SVGSVGElement>;
}) {
  const m = methods.length;
  const regionCount = new Map<string, number>();
  intersections.forEach((item) => {
    const code = methods.map((id) => (item.members.includes(id) ? "1" : "0")).join("");
    regionCount.set(code, (regionCount.get(code) ?? 0) + item.edges.length);
  });
  const union = [...regionCount.values()].reduce((a, b) => a + b, 0);
  const sizeOf = (i: number) => [...regionCount].filter(([code]) => code[i] === "1").reduce((s, [, v]) => s + v, 0);
  const pairOf = (i: number, j: number) => [...regionCount].filter(([code]) => code[i] === "1" && code[j] === "1").reduce((s, [, v]) => s + v, 0);
  const sizes = methods.map((_, i) => sizeOf(i));
  const maxSize = Math.max(1, ...sizes);
  const unit = 130 / Math.sqrt(maxSize);
  const radius = sizes.map((s) => Math.max(18, Math.sqrt(s) * unit));
  const areaOf = (count: number) => count * unit * unit * Math.PI;

  let centres: [number, number][];
  if (m === 2) {
    const d = distanceForOverlap(radius[0], radius[1], areaOf(pairOf(0, 1)));
    centres = [[0, 0], [Math.max(d, 1), 0]];
  } else {
    const d01 = distanceForOverlap(radius[0], radius[1], areaOf(pairOf(0, 1)));
    const d02 = distanceForOverlap(radius[0], radius[2], areaOf(pairOf(0, 2)));
    const d12 = distanceForOverlap(radius[1], radius[2], areaOf(pairOf(1, 2)));
    const base = Math.max(d01, 1);
    const x = (d02 * d02 - d12 * d12 + base * base) / (2 * base);
    const y = Math.sqrt(Math.max(0, d02 * d02 - x * x));
    centres = [[0, 0], [base, 0], [x, y]];
  }
  const minX = Math.min(...centres.map(([x], i) => x - radius[i]));
  const maxX = Math.max(...centres.map(([x], i) => x + radius[i]));
  const minY = Math.min(...centres.map(([, y], i) => y - radius[i]));
  const maxY = Math.max(...centres.map(([, y], i) => y + radius[i]));
  const pad = 52;
  const W = Math.max(520, maxX - minX + 2 * pad + 160);
  const H = maxY - minY + 2 * pad;
  const ox = (W - (maxX - minX)) / 2 - minX;
  const oy = pad - minY;
  const P = centres.map(([x, y]) => [x + ox, y + oy] as [number, number]);

  // Label each region at the centroid of grid samples that fall inside it.
  const centroids = new Map<string, [number, number, number]>();
  for (let x = 0; x < W; x += 3) {
    for (let y = 0; y < H; y += 3) {
      const code = P.map(([cx, cy], i) => ((x - cx) ** 2 + (y - cy) ** 2 <= radius[i] ** 2 ? "1" : "0")).join("");
      if (!code.includes("1")) continue;
      const acc = centroids.get(code) ?? [0, 0, 0];
      centroids.set(code, [acc[0] + x, acc[1] + y, acc[2] + 1]);
    }
  }
  const allCode = "1".repeat(m);
  const labelAnchor: [number, number, "start" | "end" | "middle"][] =
    m === 2 ? [[-1, -1, "end"], [1, -1, "start"]] : [[-1, -1, "end"], [1, -1, "start"], [0, 1, "middle"]];

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ display: "block", maxWidth: "100%", height: "auto", margin: "0 auto" }}
      fontFamily={FONT}
      role="img"
      aria-label={`Area-proportional Euler diagram of ${methods.join(", ")}`}
    >
      <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
      {P.map(([x, y], i) => <circle key={methods[i]} cx={x} cy={y} r={radius[i]} fill="rgba(8,126,173,0.05)" stroke={INK} strokeWidth="1.2" />)}
      {[...regionCount].map(([code, count]) => {
        const c = centroids.get(code);
        if (!c || !count) return null;
        const x = c[0] / c[2];
        const y = c[1] / c[2];
        const names = methods.filter((_, i) => code[i] === "1");
        const core = code === allCode && m > 1;
        return (
          <g key={code}>
            <title>{`${count} edges in ${names.join(" ∩ ")}${names.length === 1 ? " only" : ""}`}</title>
            <text x={x} y={y} fontSize={core ? 16 : 13.5} fontWeight={core ? 700 : 500} textAnchor="middle" fill={INK} stroke="#ffffff" strokeWidth="3" paintOrder="stroke">{count}</text>
            <text x={x} y={y + 13} fontSize="9.5" textAnchor="middle" fill={MUTED} stroke="#ffffff" strokeWidth="3" paintOrder="stroke">{`${Math.round((count / Math.max(1, union)) * 100)}%`}</text>
          </g>
        );
      })}
      {P.map(([x, y], i) => {
        const [sx, sy, anchor] = labelAnchor[i];
        const lx = x + sx * radius[i] * 0.72;
        const ly = sy < 0 ? y - radius[i] * 0.72 - 12 : y + radius[i] + 22;
        return (
          <text key={methods[i]} x={lx} y={ly} fontSize="12.5" fontWeight="700" textAnchor={anchor} fill={INK}>
            {methods[i]}
            <tspan fontWeight="400" fill={MUTED} fontSize="10.5" dx="5">{`${sizes[i]} edges`}</tspan>
          </text>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Key regulators across methods                                       */
/* ------------------------------------------------------------------ */

export type RegulatorRow = {
  gene: string;
  /** Rank per method (1 = most links), null when the gene has no edge there. */
  ranks: (number | null)[];
  /** Targets (directed) or connections (undirected) per method. */
  links: number[];
  median: number;
  rankedBy: number;
};

type RankableEdge = { source: string; target: string; rank: number; confidence: number };

/**
 * Ranks genes as regulators in each method's top-K edges: out-degree for
 * directed methods, degree for undirected ones (competition ranking, ties
 * share a rank). Genes are ordered by median rank across methods, a gene
 * missing from a method counting as ranked just after that method's last one.
 */
export function rankRegulators(
  methods: string[],
  rowsOf: (id: string) => RankableEdge[],
  directedOf: (id: string) => boolean,
  topK: number,
  limit = 15,
): RegulatorRow[] {
  const perMethod = methods.map((id) => {
    const directed = directedOf(id);
    const seen = new Set<string>();
    const counts = new Map<string, number>();
    const sorted = [...rowsOf(id)].sort((a, b) => a.rank - b.rank || b.confidence - a.confidence);
    for (const edge of sorted) {
      if (seen.size >= topK) break;
      if (edge.source === edge.target) continue;
      const key = directed ? `${edge.source}\u0000${edge.target}` : [edge.source, edge.target].sort().join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
      if (!directed) counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
    }
    const values = [...counts.values()];
    const rank = new Map([...counts].map(([gene, count]) => [gene, 1 + values.filter((value) => value > count).length]));
    const unranked = values.length ? Math.max(...rank.values()) + 1 : 1;
    return { counts, rank, unranked };
  });
  const genes = new Set(perMethod.flatMap((method) => [...method.counts.keys()]));
  const rows = [...genes].map((gene) => {
    const ranks = perMethod.map((method) => method.rank.get(gene) ?? null);
    const filled = perMethod.map((method, index) => ranks[index] ?? method.unranked).sort((a, b) => a - b);
    const mid = Math.floor(filled.length / 2);
    const median = filled.length % 2 ? filled[mid] : (filled[mid - 1] + filled[mid]) / 2;
    return {
      gene,
      ranks,
      links: perMethod.map((method) => method.counts.get(gene) ?? 0),
      median,
      rankedBy: ranks.filter((rank) => rank !== null).length,
    };
  });
  rows.sort((a, b) => a.median - b.median || b.rankedBy - a.rankedBy || a.gene.localeCompare(b.gene));
  return rows.slice(0, limit);
}

export function formatRank(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Distance from the top of the regulator SVG to its first row. */
export function regulatorPlotTop(methods: string[]) {
  return heatmapPlotTop([...methods, "Median rank"]);
}

export function RegulatorHeatmap({
  methods,
  directed,
  rows,
  topK,
  selectedGene,
  onSelect,
  svgRef,
}: {
  methods: string[];
  directed: boolean[];
  rows: RegulatorRow[];
  topK: number;
  selectedGene: string | null;
  onSelect: (gene: string | null) => void;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const n = methods.length;
  const cell = n <= 5 ? 66 : n <= 8 ? 58 : n <= 12 ? 52 : 40;
  const rowH = 30;
  const longest = Math.max(4, ...rows.map((row) => row.gene.length));
  const nameW = Math.min(170, 18 + longest * 7.6);
  const top = regulatorPlotTop(methods);
  const left = nameW;
  const medX = left + n * cell + 12;
  const medW = 44;
  const W = medX + medW + 64;
  const H = top + rows.length * rowH + 12;
  const shown = rows.flatMap((row) => row.ranks.filter((rank): rank is number => rank !== null));
  const maxRank = Math.max(8, ...shown);
  const tone = (rank: number) => 0.1 + 0.85 * (1 - (rank - 1) / (maxRank - 1));

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ display: "block" }}
      fontFamily={FONT}
      role="img"
      aria-label={`Regulator rank in each method's top ${topK} edges`}
      onMouseLeave={() => setHovered(null)}
    >
      <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
      {methods.map((id, index) => (
        <text key={id} transform={`translate(${left + index * cell + cell / 2 + 4} ${top - 10}) rotate(-50)`} fontSize="12" fill={INK}>
          {id}
        </text>
      ))}
      <text transform={`translate(${medX + medW / 2 + 4} ${top - 10}) rotate(-50)`} fontSize="12" fontWeight="700" fill={INK}>
        Median rank
      </text>
      {rows.map((row, r) => {
        const y = top + r * rowH;
        const on = row.gene === selectedGene;
        return (
          <g
            key={row.gene}
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHovered(row.gene)}
            onClick={() => onSelect(on ? null : row.gene)}
          >
            <rect x="0" y={y} width={W} height={rowH} fill="transparent" />
            <text x={left - 8} y={y + rowH / 2 + 4} fontSize="12.5" fontStyle="italic" textAnchor="end" fill={on ? SELECT : INK} fontWeight={on ? 700 : 400} data-export-fill={INK} data-export-weight="400">
              {row.gene}
            </text>
            {methods.map((method, c) => {
              const rank = row.ranks[c];
              const x = left + c * cell;
              const unit = directed[c] ? "targets" : "connections";
              if (rank === null) {
                return (
                  <g key={method}>
                    <title>{`${row.gene}: no edge in ${method}'s top ${topK}`}</title>
                    <rect x={x} y={y} width={cell} height={rowH} fill="#ffffff" stroke="#ffffff" strokeWidth="1" />
                    <rect x={x + 1} y={y + 1} width={cell - 2} height={rowH - 2} fill="none" stroke="#e8ecf0" strokeWidth="1" />
                  </g>
                );
              }
              const t = tone(rank);
              return (
                <g key={method}>
                  <title>{`${row.gene} in ${method}: rank ${rank} (${row.links[c]} ${unit} in top ${topK})`}</title>
                  <rect x={x} y={y} width={cell} height={rowH} fill={blues(t)} stroke="#ffffff" strokeWidth="1" />
                  <text x={x + cell / 2} y={y + rowH / 2 + 4} fontSize="12" textAnchor="middle" fill={t > 0.55 ? "#ffffff" : "#1f2a33"} pointerEvents="none">
                    {rank}
                  </text>
                </g>
              );
            })}
            <text x={medX + medW / 2} y={y + rowH / 2 + 4} fontSize="12" fontWeight="700" textAnchor="middle" fill={INK}>
              {formatRank(row.median)}
            </text>
            {on ? (
              <>
                <rect x={left + 1.5} y={y + 1.5} width={n * cell - 3} height={rowH - 3} fill="none" stroke="#111111" strokeWidth="3" pointerEvents="none" data-ui="" />
                <rect x={left + 3.5} y={y + 3.5} width={n * cell - 7} height={rowH - 7} fill="none" stroke="#ffffff" strokeWidth="1.2" pointerEvents="none" data-ui="" />
              </>
            ) : hovered === row.gene ? (
              <rect x={left + 1} y={y + 1} width={n * cell - 2} height={rowH - 2} fill="none" stroke="#111111" strokeWidth="1.2" pointerEvents="none" data-ui="" />
            ) : null}
          </g>
        );
      })}
      <line x1={medX - 6} x2={medX - 6} y1={top} y2={top + rows.length * rowH} stroke="#d5dbe1" strokeWidth="1" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Detail panel (right of the figure)                                  */
/* ------------------------------------------------------------------ */

export type DetailRow = { edge: string; ranks: (number | null)[]; extra?: { text: string; warn?: boolean; title?: string } };
export type DetailGroup = { key: string; label: string; rows: DetailRow[] };

/**
 * The inspection panel beside a figure: a compact summary (key figures and a
 * proportion bar), then the edges behind the selection as a small ranked
 * table, the way a supplementary table would list them.
 */
export function AgreementDetailPanel({
  eyebrow,
  title,
  subtitle,
  stats,
  proportion,
  groups,
  activeGroup,
  onGroupChange,
  rankHeaders,
  onDownload,
  onReset,
  resetLabel,
  plotTop = 0,
  selectionKey,
  secondaryStats,
  extraHeader,
  firstHeader = "Edge",
  monoFirst = true,
  footnote,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  stats: { label: string; value: string }[];
  proportion?: { label: string; count: number; tone: "left" | "core" | "right" }[];
  groups: DetailGroup[];
  activeGroup: string;
  onGroupChange: (key: string) => void;
  rankHeaders: string[];
  onDownload?: () => void;
  onReset?: () => void;
  resetLabel?: string;
  /** Pixels between the top of the figure and its plot area; the panel starts there on wide screens. */
  plotTop?: number;
  /** Changes whenever the selection does, to replay the short fade. */
  selectionKey?: string;
  /** Smaller figures under the key stats, each with a one-line explanation. */
  secondaryStats?: { label: string; value: string; note: string }[];
  /** Adds a narrow column after the edge (e.g. "Sign"), filled from each row's `extra`. */
  extraHeader?: string;
  firstHeader?: string;
  monoFirst?: boolean;
  footnote?: string;
}) {
  const group = groups.find((item) => item.key === activeGroup) ?? groups[0];
  const limit = 60;
  const total = proportion?.reduce((sum, part) => sum + part.count, 0) ?? 0;
  const toneClass = { left: "bg-slate-400", core: "bg-slate-800", right: "bg-slate-300" } as const;
  return (
    // On wide screens the panel is taken out of the flow and stretched from the
    // plot's top edge to the bottom of the figure column, so both sides end
    // together; the edge list scrolls inside whatever height remains.
    <div
      className="relative min-w-0 xl:self-stretch xl:min-h-[calc(var(--plot-top)+440px)]"
      style={{ ["--plot-top" as string]: `${plotTop}px` }}
    >
    <aside
      key={selectionKey}
      className="agreement-detail flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white xl:absolute xl:inset-x-0 xl:bottom-0 xl:top-[var(--plot-top)]"
      aria-label={`${title} details`}
      aria-live="polite"
    >
      <div className="border-b border-slate-100 px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <p className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#087ead]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#087ead]" aria-hidden="true" />
            {eyebrow}
          </p>
          {onReset ? (
            <button type="button" onClick={onReset} className="text-[11px] font-semibold text-slate-400 transition hover:text-[#087ead]">
              {resetLabel ?? "Reset"}
            </button>
          ) : null}
        </div>
        <h4 className="mt-1.5 text-[17px] font-extrabold leading-snug text-slate-950 [text-wrap:balance]">{title}</h4>
        {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}

        <dl className="mt-4 grid divide-x divide-slate-100" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
          {stats.map((stat, index) => (
            <div key={stat.label} className={index === 0 ? "pr-3" : "px-3"}>
              <dt className="truncate text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400" title={stat.label}>{stat.label}</dt>
              <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{stat.value}</dd>
            </div>
          ))}
        </dl>

        {proportion && total > 0 ? (
          <div className="mt-4">
            <div className="flex h-2 w-full overflow-hidden rounded-sm bg-slate-100" role="img" aria-label={proportion.map((part) => `${part.label}: ${part.count}`).join(", ")}>
              {proportion.map((part) => (
                <span key={part.label} className={toneClass[part.tone]} style={{ width: `${(part.count / total) * 100}%` }} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
              {proportion.map((part) => (
                <span key={part.label} className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-[2px] ${toneClass[part.tone]}`} />
                  <span className="truncate">{part.label}</span>
                  <span className="font-semibold tabular-nums text-slate-700">{part.count}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {secondaryStats?.length ? (
          <dl className="mt-4 grid gap-x-3 border-t border-dashed border-slate-200 pt-3" style={{ gridTemplateColumns: `repeat(${secondaryStats.length}, minmax(0, 1fr))` }}>
            {secondaryStats.map((stat, index) => (
              <div key={stat.label} className={index === 0 ? "pr-3" : "border-l border-slate-100 pl-3"}>
                <dt className="truncate text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400" title={stat.label}>{stat.label}</dt>
                <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{stat.value}</dd>
                <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{stat.note}</p>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      {groups.length > 1 ? (
        <div className="flex gap-4 border-b border-slate-100 px-5" role="tablist" aria-label="Edge groups">
          {groups.map((item) => {
            const on = item.key === group?.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onGroupChange(item.key)}
                className={`-mb-px min-w-0 truncate border-b-2 py-2.5 text-xs font-bold transition ${on ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-700"}`}
                title={item.label}
              >
                {item.label} <span className="font-semibold tabular-nums text-slate-400">{item.rows.length}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="max-h-[330px] min-h-[120px] overflow-y-auto px-5 xl:max-h-none xl:flex-1">
        {group && group.rows.length ? (
          <table className="w-full table-fixed border-collapse text-[12.5px]">
            <colgroup>
              <col />
              {extraHeader ? <col style={{ width: "3.75rem" }} /> : null}
              {rankHeaders.map((header) => <col key={header} style={{ width: "4.75rem" }} />)}
            </colgroup>
            <thead className="sticky top-0 bg-white">
              <tr className="text-[10.5px] uppercase tracking-[0.08em] text-slate-400">
                <th className="py-2 pr-2 text-left font-semibold">{firstHeader}</th>
                {extraHeader ? <th className="py-2 pl-2 text-center font-semibold">{extraHeader}</th> : null}
                {rankHeaders.map((header) => (
                  <th key={header} className="truncate py-2 pl-2 text-right font-semibold" title={`${header} rank`}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.rows.slice(0, limit).map((row) => (
                <tr key={row.edge} className="border-t border-slate-100">
                  <td className={`truncate py-1.5 pr-2 text-slate-700 ${monoFirst ? "font-mono text-[12px]" : "font-semibold"}`} title={row.edge}>{row.edge}</td>
                  {extraHeader ? (
                    <td className={`whitespace-nowrap py-1.5 pl-2 text-center tabular-nums ${row.extra?.warn ? "font-bold text-amber-700" : "text-slate-500"}`} title={row.extra?.title}>{row.extra?.text ?? "–"}</td>
                  ) : null}
                  {row.ranks.map((rank, index) => (
                    <td key={index} className="py-1.5 pl-2 text-right tabular-nums text-slate-500">{rank ?? "–"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-8 text-center text-sm text-slate-400">No edges in this group.</p>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500">
        <span>
          {group && group.rows.length > limit
            ? `Showing ${limit} of ${group.rows.length.toLocaleString()} · ${footnote ?? "rank = position in each method's list"}`
            : (footnote ?? "Rank = position in each method's top-ranked list")}
        </span>
        {onDownload ? (
          <button type="button" onClick={onDownload} className="shrink-0 font-bold text-[#087ead] transition hover:text-[#06688f]">
            CSV
          </button>
        ) : null}
      </div>
    </aside>
    </div>
  );
}
