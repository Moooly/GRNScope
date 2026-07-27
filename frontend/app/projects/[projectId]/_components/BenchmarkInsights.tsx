"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AggregatedEdge,
  AlgorithmCatalogItem,
  AlgorithmStoredResult,
  ProjectTask,
} from "../_lib/types";

type GroundTruthContext = {
  available: boolean;
  reason?: string;
  filename?: string;
  edge_count?: number;
  edges?: Array<{ source: string; target: string; sign?: string }>;
};

type CurvePoint = { x: number; y: number };
type SignValue = -1 | 0 | 1;
type MotifCounts = {
  feedbackLoops: number;
  feedForwardLoops: number;
  mutualInteractions: number;
};
type PathCounts = {
  truePositive: number;
  path2: number;
  path3: number;
  path4: number;
  path5: number;
  noPath: number;
};
type BenchmarkRow = {
  algorithmId: string;
  evaluatedEdges: number;
  possibleEdges: number;
  isPartial: boolean;
  auprc: number;
  auprcRatio: number;
  auroc: number;
  precisionAtK: number;
  earlyPrecisionRatio: number;
  activationEpr: number | null;
  repressionEpr: number | null;
  runtimeSeconds: number;
  pr: CurvePoint[];
  roc: CurvePoint[];
  motifs: MotifCounts;
  pathCounts: PathCounts;
};
type BenchmarkMenuOption<T extends string | number> = {
  value: T;
  label: string;
  detail?: string;
};

const PALETTE = [
  "#087ead",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#059669",
  "#475569",
  "#ca8a04",
  "#0891b2",
];

function edgeKey(source: string, target: string) {
  return `${source}\u0000${target}`;
}

function normalizeSign(value?: string): SignValue {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "+" ||
    normalized === "1" ||
    normalized === "activation" ||
    normalized === "activating" ||
    normalized === "positive"
  ) {
    return 1;
  }
  if (
    normalized === "-" ||
    normalized === "-1" ||
    normalized === "inhibition" ||
    normalized === "inhibitory" ||
    normalized === "repression" ||
    normalized === "negative"
  ) {
    return -1;
  }
  return 0;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const content = rows
    .map((row) =>
      row
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-14 text-center">
      <p className="text-base font-bold text-slate-950">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
        {detail}
      </p>
    </div>
  );
}

function Panel({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-extrabold text-slate-950">{title}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            {description}
          </p>
        </div>
        {aside}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function BenchmarkMenu<T extends string | number>({
  prefix,
  value,
  options,
  onChange,
}: {
  prefix: string;
  value: T;
  options: Array<BenchmarkMenuOption<T>>;
  onChange: (value: T) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`inline-flex h-10 items-center gap-2 rounded-full border bg-white px-4 text-sm font-semibold transition ${
          isOpen
            ? "border-[#1b75a6]/40 text-[#1b75a6] ring-4 ring-[#1b75a6]/[0.06]"
            : "border-slate-200 text-slate-600 hover:border-[#1b75a6]/30 hover:text-[#1b75a6]"
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
          <path
            d="M4 6h5m3 0h4M4 14h3m3 0h6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="10.5" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8.5" cy="14" r="1.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="whitespace-nowrap">
          {prefix} <span className="text-slate-300">·</span>{" "}
          <strong className="text-slate-900">{selected?.label}</strong>
        </span>
        <svg
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m3.5 6 4.5 4 4.5-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {isOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/15"
        >
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <button
                key={String(option.value)}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  isActive
                    ? "bg-[#f2f9fc] text-[#1b75a6]"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{option.label}</span>
                  {option.detail ? (
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                      {option.detail}
                    </span>
                  ) : null}
                </span>
                {isActive ? (
                  <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none">
                    <path
                      d="m3 8.5 3 3 7-7"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Export benchmark summary as CSV"
      title="Export benchmark summary as CSV"
      className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10"
    >
      <svg
        viewBox="0 0 20 20"
        className="h-4 w-4"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M10 3.25v8.5m0 0 3-3m-3 3-3-3M4.25 13.5v1.25A1.75 1.75 0 0 0 6 16.5h8a1.75 1.75 0 0 0 1.75-1.75V13.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      CSV
    </button>
  );
}

function MetricLabel({
  children,
  explanation,
}: {
  children: ReactNode;
  explanation: string;
}) {
  return (
    <span className="group relative inline-flex cursor-help items-center gap-1">
      <span>{children}</span>
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-extrabold normal-case tracking-normal text-slate-400">
        i
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-1/2 top-full z-30 mt-2 w-60 -translate-x-1/2 translate-y-1 rounded-xl border border-slate-200 bg-white p-3 text-left text-xs font-medium normal-case leading-5 tracking-normal text-slate-600 opacity-0 shadow-xl shadow-slate-900/10 transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
      >
        {explanation}
      </span>
    </span>
  );
}

function motifCounts(edges: Array<{ source: string; target: string }>): MotifCounts {
  const adjacency = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    if (edge.source === edge.target) return;
    const targets = adjacency.get(edge.source) ?? new Set<string>();
    targets.add(edge.target);
    adjacency.set(edge.source, targets);
  });

  let mutualInteractions = 0;
  let feedbackLoops = 0;
  let feedForwardLoops = 0;

  adjacency.forEach((targets, source) => {
    targets.forEach((target) => {
      if (source < target && adjacency.get(target)?.has(source)) {
        mutualInteractions += 1;
      }
      adjacency.get(target)?.forEach((third) => {
        if (third === source || third === target) return;
        if (adjacency.get(third)?.has(source)) feedbackLoops += 1;
        if (targets.has(third)) feedForwardLoops += 1;
      });
    });
  });

  return {
    feedbackLoops: Math.floor(feedbackLoops / 3),
    feedForwardLoops,
    mutualInteractions,
  };
}

function shortestPathLength(
  adjacency: Map<string, Set<string>>,
  source: string,
  target: string,
  maximum = 5,
) {
  if (source === target) return 0;
  const visited = new Set([source]);
  let frontier = [source];
  for (let depth = 1; depth <= maximum; depth += 1) {
    const next: string[] = [];
    frontier.forEach((node) => {
      adjacency.get(node)?.forEach((neighbor) => {
        if (visited.has(neighbor)) return;
        visited.add(neighbor);
        next.push(neighbor);
      });
    });
    if (next.includes(target)) return depth;
    frontier = next;
    if (!frontier.length) break;
  }
  return null;
}

function signedEarlyPrecisionRatio({
  ranked,
  truthSigns,
  sign,
  possibleEdges,
  methodSupportsSign,
}: {
  ranked: AggregatedEdge[];
  truthSigns: Map<string, SignValue>;
  sign: -1 | 1;
  possibleEdges: number;
  methodSupportsSign: boolean;
}) {
  if (!methodSupportsSign) return null;
  const truthCount = [...truthSigns.values()].filter((value) => value === sign).length;
  if (!truthCount || possibleEdges <= 0) return null;
  const predictions = ranked.filter((edge) => edge.sign === sign).slice(0, truthCount);
  const correct = predictions.filter(
    (edge) => truthSigns.get(edgeKey(edge.source, edge.target)) === sign,
  ).length;
  const precision = correct / truthCount;
  const randomBaseline = truthCount / possibleEdges;
  return randomBaseline > 0 ? precision / randomBaseline : null;
}

function benchmarkAlgorithm({
  algorithmId,
  edges,
  truth,
  truthSigns,
  possibleEdges,
  evaluationDepth,
  runtimeSeconds,
  methodSupportsSign,
  referenceAdjacency,
  candidateSources,
  candidateTargets,
}: {
  algorithmId: string;
  edges: AggregatedEdge[];
  truth: Set<string>;
  truthSigns: Map<string, SignValue>;
  possibleEdges: number;
  evaluationDepth: number;
  runtimeSeconds: number;
  methodSupportsSign: boolean;
  referenceAdjacency: Map<string, Set<string>>;
  candidateSources: Set<string>;
  candidateTargets: Set<string>;
}): BenchmarkRow {
  const seen = new Set<string>();
  const completeRanking = [...edges]
    .filter((edge) => {
      const key = edgeKey(edge.source, edge.target);
      if (
        edge.source === edge.target ||
        !candidateSources.has(edge.source) ||
        !candidateTargets.has(edge.target) ||
        seen.has(key)
      ) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.rank - b.rank || b.confidence - a.confidence)
  const ranked = completeRanking.slice(
    0,
    evaluationDepth > 0 ? evaluationDepth : undefined,
  );
  const isPartial = evaluationDepth > 0 && ranked.length < possibleEdges;
  const positiveCount = Math.max(1, truth.size);
  const negativeCount = Math.max(1, possibleEdges - truth.size);
  let truePositive = 0;
  let falsePositive = 0;
  let auprc = 0;
  let auroc = 0;
  let previousRecall = 0;
  let previousFpr = 0;
  let previousTpr = 0;
  const pr: CurvePoint[] = [{ x: 0, y: 1 }];
  const roc: CurvePoint[] = [{ x: 0, y: 0 }];
  let trueAtK = 0;
  const k = Math.min(truth.size, ranked.length);

  ranked.forEach((edge, index) => {
    if (truth.has(edgeKey(edge.source, edge.target))) {
      truePositive += 1;
      if (index < k) trueAtK += 1;
    } else {
      falsePositive += 1;
    }
    const recall = truePositive / positiveCount;
    const precision = truePositive / (index + 1);
    const falsePositiveRate = falsePositive / negativeCount;
    const truePositiveRate = recall;
    auprc += (recall - previousRecall) * precision;
    auroc +=
      (falsePositiveRate - previousFpr) *
      ((previousTpr + truePositiveRate) / 2);
    previousRecall = recall;
    previousFpr = falsePositiveRate;
    previousTpr = truePositiveRate;
    if (
      index === ranked.length - 1 ||
      index % Math.max(1, Math.floor(ranked.length / 180)) === 0
    ) {
      pr.push({ x: recall, y: precision });
      roc.push({ x: falsePositiveRate, y: truePositiveRate });
    }
  });

  // Missing predictions share the lowest possible score. When the complete
  // ranking is requested, evaluate that tied group as one threshold so every
  // method reaches the same candidate-universe endpoint without inventing an
  // arbitrary ordering among absent edges.
  if (!isPartial && ranked.length < possibleEdges) {
    const finalPrecision = truth.size / Math.max(1, possibleEdges);
    auprc += Math.max(0, 1 - previousRecall) * finalPrecision;
    auroc += Math.max(0, 1 - previousFpr) * ((previousTpr + 1) / 2);
    pr.push({ x: 1, y: finalPrecision });
    roc.push({ x: 1, y: 1 });
  }

  const precisionAtK = k ? trueAtK / k : 0;
  const randomBaseline = truth.size / Math.max(1, possibleEdges);
  const topologyEdges = ranked.slice(0, k);
  const pathCounts: PathCounts = {
    truePositive: 0,
    path2: 0,
    path3: 0,
    path4: 0,
    path5: 0,
    noPath: 0,
  };
  topologyEdges.forEach((edge) => {
    const key = edgeKey(edge.source, edge.target);
    if (truth.has(key)) {
      pathCounts.truePositive += 1;
      return;
    }
    const length = shortestPathLength(
      referenceAdjacency,
      edge.source,
      edge.target,
    );
    if (length === 2) pathCounts.path2 += 1;
    else if (length === 3) pathCounts.path3 += 1;
    else if (length === 4) pathCounts.path4 += 1;
    else if (length === 5) pathCounts.path5 += 1;
    else pathCounts.noPath += 1;
  });

  return {
    algorithmId,
    evaluatedEdges: ranked.length,
    possibleEdges,
    isPartial,
    auprc,
    auprcRatio: randomBaseline > 0 ? auprc / randomBaseline : 0,
    auroc,
    precisionAtK,
    earlyPrecisionRatio:
      randomBaseline > 0 ? precisionAtK / randomBaseline : 0,
    activationEpr: signedEarlyPrecisionRatio({
      ranked,
      truthSigns,
      sign: 1,
      possibleEdges,
      methodSupportsSign,
    }),
    repressionEpr: signedEarlyPrecisionRatio({
      ranked,
      truthSigns,
      sign: -1,
      possibleEdges,
      methodSupportsSign,
    }),
    runtimeSeconds,
    pr,
    roc,
    motifs: motifCounts(topologyEdges),
    pathCounts,
  };
}

function LineChart({
  series,
  xLabel,
  yLabel,
  randomBaseline,
  diagonalBaseline = false,
}: {
  series: Array<{
    name: string;
    points: CurvePoint[];
    summary?: string;
  }>;
  xLabel: string;
  yLabel: string;
  randomBaseline?: number;
  diagonalBaseline?: boolean;
}) {
  const [focusedSeries, setFocusedSeries] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{
    series: string;
    point: CurvePoint;
    color: string;
  } | null>(null);
  const width = 840;
  const height = 286;
  const left = 60;
  const right = 24;
  const top = 20;
  const bottom = 48;
  const points = series.flatMap((item) => item.points);
  if (!points.length) {
    return (
      <EmptyState
        title="No curve data"
        detail="The selected methods do not contain ranked edges for this scope."
      />
    );
  }
  const xPosition = (value: number) =>
    left + value * (width - left - right);
  const yPosition = (value: number) =>
    top + (1 - value) * (height - top - bottom);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const hoveredX = hoveredPoint ? xPosition(hoveredPoint.point.x) : 0;
  const hoveredY = hoveredPoint ? yPosition(hoveredPoint.point.y) : 0;
  const tooltipWidth = 206;
  const tooltipHeight = 52;
  const tooltipX = hoveredPoint
    ? hoveredX + tooltipWidth + 16 > width - right
      ? Math.max(left, hoveredX - tooltipWidth - 12)
      : hoveredX + 12
    : 0;
  const tooltipY = hoveredPoint
    ? hoveredY - tooltipHeight - 12 < top
      ? hoveredY + 12
      : hoveredY - tooltipHeight - 12
    : 0;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`${yLabel} by ${xLabel}`}
      >
        {ticks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              x1={left}
              x2={width - right}
              y1={yPosition(tick)}
              y2={yPosition(tick)}
              stroke="#e2e8f0"
            />
            <text
              x={left - 10}
              y={yPosition(tick) + 4}
              textAnchor="end"
              fill="#64748b"
              fontSize="11"
              fontWeight="600"
            >
              {tick.toFixed(2)}
            </text>
          </g>
        ))}
        {ticks.map((tick) => (
          <g key={`x-${tick}`}>
            <line
              x1={xPosition(tick)}
              x2={xPosition(tick)}
              y1={height - bottom}
              y2={height - bottom + 5}
              stroke="#94a3b8"
            />
            <text
              x={xPosition(tick)}
              y={height - bottom + 19}
              textAnchor="middle"
              fill="#64748b"
              fontSize="11"
              fontWeight="600"
            >
              {tick.toFixed(2)}
            </text>
          </g>
        ))}
        <line x1={left} x2={left} y1={top} y2={height - bottom} stroke="#94a3b8" />
        <line
          x1={left}
          x2={width - right}
          y1={height - bottom}
          y2={height - bottom}
          stroke="#94a3b8"
        />
        {randomBaseline !== undefined ? (
          <g>
            <line
              x1={left}
              x2={width - right}
              y1={yPosition(randomBaseline)}
              y2={yPosition(randomBaseline)}
              stroke="#5fc8bd"
              strokeDasharray="5 5"
            />
            <text
              x={width - right}
              y={Math.max(top + 11, yPosition(randomBaseline) - 7)}
              textAnchor="end"
              fill="#0f766e"
              fontSize="10"
              fontWeight="700"
            >
              Random precision {randomBaseline.toFixed(3)}
            </text>
          </g>
        ) : null}
        {diagonalBaseline ? (
          <line
            x1={xPosition(0)}
            x2={xPosition(1)}
            y1={yPosition(0)}
            y2={yPosition(1)}
            stroke="#94a3b8"
            strokeDasharray="5 5"
          />
        ) : null}
        {series.map((item, index) => {
          const isDimmed =
            focusedSeries !== null && focusedSeries !== item.name;
          const color = PALETTE[index % PALETTE.length];
          const path = item.points
            .map(
              (point, pointIndex) =>
                `${pointIndex ? "L" : "M"} ${xPosition(point.x)} ${yPosition(point.y)}`,
            )
            .join(" ");
          return (
            <path
              key={item.name}
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={focusedSeries === item.name ? "4" : "2.75"}
              opacity={isDimmed ? 0.16 : 1}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="cursor-pointer transition-opacity"
              onPointerEnter={() => setFocusedSeries(item.name)}
              onPointerLeave={() => {
                setFocusedSeries(null);
                setHoveredPoint(null);
              }}
            />
          );
        })}
        {series.flatMap((item, index) => {
          const color = PALETTE[index % PALETTE.length];
          const step = Math.max(1, Math.ceil(item.points.length / 45));
          return item.points
            .filter((_, pointIndex) => pointIndex % step === 0)
            .map((point, pointIndex) => (
              <circle
                key={`${item.name}-${pointIndex}`}
                cx={xPosition(point.x)}
                cy={yPosition(point.y)}
                r="6"
                fill="transparent"
                className="cursor-crosshair"
                onPointerEnter={() => {
                  setFocusedSeries(item.name);
                  setHoveredPoint({ series: item.name, point, color });
                }}
                onPointerLeave={() => setHoveredPoint(null)}
              />
            ));
        })}
        {hoveredPoint ? (
          <g pointerEvents="none">
            <circle
              cx={hoveredX}
              cy={hoveredY}
              r="4"
              fill="white"
              stroke={hoveredPoint.color}
              strokeWidth="2"
            />
            <rect
              x={tooltipX}
              y={tooltipY}
              width={tooltipWidth}
              height={tooltipHeight}
              rx="10"
              fill="#0f172a"
              opacity="0.94"
            />
            <text
              x={tooltipX + 12}
              y={tooltipY + 20}
              fill="white"
              fontSize="11"
              fontWeight="800"
            >
              {hoveredPoint.series}
            </text>
            <text
              x={tooltipX + 12}
              y={tooltipY + 39}
              fill="#cbd5e1"
              fontSize="10.5"
              fontWeight="700"
            >
              {xLabel} {hoveredPoint.point.x.toFixed(3)}
              <tspan fill="#64748b"> · </tspan>
              {yLabel} {hoveredPoint.point.y.toFixed(3)}
            </text>
          </g>
        ) : null}
        <text
          x={(left + width - right) / 2}
          y={height - 8}
          textAnchor="middle"
          fill="#64748b"
          fontSize="12"
          fontWeight="600"
        >
          {xLabel}
        </text>
        <text
          x="14"
          y={(top + height - bottom) / 2}
          textAnchor="middle"
          fill="#64748b"
          fontSize="12"
          fontWeight="600"
          transform={`rotate(-90 14 ${(top + height - bottom) / 2})`}
        >
          {yLabel}
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {series.map((item, index) => (
          <button
            type="button"
            key={item.name}
            onClick={() =>
              setFocusedSeries((current) =>
                current === item.name ? null : item.name,
              )
            }
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              focusedSeries === item.name
                ? "border-[#087ead]/30 bg-[#f2f9fc] text-[#087ead]"
                : focusedSeries
                  ? "border-slate-200 text-slate-400"
                  : "border-slate-200 text-slate-600 hover:border-[#087ead]/25"
            }`}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: PALETTE[index % PALETTE.length] }}
            />
            {item.name}
            {item.summary ? (
              <span className="tabular-nums text-slate-400">{item.summary}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function HeatmapCell({
  value,
  display,
  intensity,
  title,
  subdued = false,
}: {
  value: number | null;
  display: string;
  intensity: number;
  title: string;
  subdued?: boolean;
}) {
  if (value === null || !Number.isFinite(value)) {
    return (
      <div
        title={`${title}: not available`}
        className="flex h-10 items-center justify-center rounded-lg border border-slate-100 bg-slate-50/70 px-2 text-sm font-semibold text-slate-300"
      >
        —
      </div>
    );
  }

  const strength = Math.max(0, Math.min(1, intensity));
  const alpha = 0.07 + strength * 0.2;
  return (
    <div
      title={`${title}: ${display}`}
      className={`flex h-10 items-center justify-center rounded-lg border px-2 text-sm font-extrabold tabular-nums ${
        subdued
          ? "border-slate-200/70 text-slate-600"
          : "border-[#087ead]/10 text-[#076f99]"
      }`}
      style={{
        backgroundColor: subdued
          ? `rgba(148, 163, 184, ${alpha})`
          : `rgba(8, 126, 173, ${alpha})`,
      }}
    >
      {display}
    </div>
  );
}

function MotifRecovery({
  rows,
  reference,
}: {
  rows: BenchmarkRow[];
  reference: MotifCounts;
}) {
  const motifs = [
    {
      key: "feedbackLoops" as const,
      label: "Feedback loops",
      note: "A→B→C→A",
    },
    {
      key: "feedForwardLoops" as const,
      label: "Feed-forward loops",
      note: "A→B, A→C, B→C",
    },
    {
      key: "mutualInteractions" as const,
      label: "Mutual interactions",
      note: "A↔B",
    },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-separate border-spacing-y-2">
        <thead>
          <tr className="text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
            <th className="pb-1">Method</th>
            {motifs.map((motif) => (
              <th key={motif.key} className="pb-1 text-center">
                {motif.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.algorithmId}>
              <th className="pr-4 text-sm font-extrabold text-slate-800">
                {row.algorithmId}
              </th>
              {motifs.map((motif) => {
                const predicted = row.motifs[motif.key];
                const referenceCount = reference[motif.key];
                const ratio =
                  referenceCount > 0 ? predicted / referenceCount : null;
                return (
                  <td key={motif.key} className="px-1">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center">
                      <p className="text-sm font-extrabold tabular-nums text-slate-800">
                        {ratio === null ? "—" : `${ratio.toFixed(3)}×`}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        {predicted} predicted / {referenceCount} reference
                      </p>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        Ratios compare top-k predicted networks with the reference network.
      </p>
    </div>
  );
}

function PathBreakdown({ rows }: { rows: BenchmarkRow[] }) {
  const colors = {
    truePositive: "#087ead",
    path2: "#5fc8bd",
    path3: "#8b5cf6",
    path4: "#f59e0b",
    path5: "#f97316",
    noPath: "#cbd5e1",
  };
  const labels: Array<{ key: keyof PathCounts; label: string }> = [
    { key: "truePositive", label: "True positive" },
    { key: "path2", label: "2-step path" },
    { key: "path3", label: "3-step path" },
    { key: "path4", label: "4-step path" },
    { key: "path5", label: "5-step path" },
    { key: "noPath", label: "No short path" },
  ];
  return (
    <div>
      <div className="space-y-4">
        {rows.map((row) => {
          const total = Object.values(row.pathCounts).reduce(
            (sum, value) => sum + value,
            0,
          );
          return (
            <div
              key={row.algorithmId}
              className="grid grid-cols-[7rem_1fr_4rem] items-center gap-3"
            >
              <span className="truncate text-sm font-extrabold text-slate-800">
                {row.algorithmId}
              </span>
              <span className="flex h-4 overflow-hidden rounded-full bg-slate-100">
                {labels.map((item) => {
                  const value = row.pathCounts[item.key];
                  return value > 0 ? (
                    <span
                      key={item.key}
                      style={{
                        width: `${(value / Math.max(1, total)) * 100}%`,
                        backgroundColor: colors[item.key],
                      }}
                      title={`${item.label}: ${value}`}
                    />
                  ) : null;
                })}
              </span>
              <span className="text-right text-xs font-bold tabular-nums text-slate-500">
                {total}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-3">
        {labels.map((item) => (
          <span
            key={item.key}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: colors[item.key] }}
            />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function BenchmarkInsights({
  groundTruth,
  loading,
  algorithmEdgeRows,
  algorithmMetaMap,
  algorithmResults,
  activeAlgorithmIds,
  tasks,
}: {
  groundTruth: GroundTruthContext | undefined;
  loading: boolean;
  algorithmEdgeRows: Record<string, AggregatedEdge[]>;
  algorithmMetaMap: Map<string, AlgorithmCatalogItem>;
  algorithmResults: Record<string, AlgorithmStoredResult>;
  activeAlgorithmIds: string[];
  tasks: ProjectTask[];
}) {
  const [evaluationDepth, setEvaluationDepth] = useState(0);

  const benchmark = useMemo(() => {
    const truthEdges = groundTruth?.edges ?? [];
    if (!truthEdges.length) {
      return {
        rows: [] as BenchmarkRow[],
        eligibleReferenceEdges: 0,
        uploadedReferenceEdges: 0,
        possibleEdges: 0,
        randomBaseline: 0,
        referenceMotifs: {
          feedbackLoops: 0,
          feedForwardLoops: 0,
          mutualInteractions: 0,
        },
      };
    }
    // All methods are evaluated over one shared regulator-target universe.
    // Regulators are inferred from method outputs; targets are the genes that
    // those methods could rank. Reference-only genes are intentionally excluded
    // because no selected method had an opportunity to predict them.
    const candidateSources = new Set<string>();
    const candidateTargets = new Set<string>();
    activeAlgorithmIds.forEach((algorithmId) => {
      (algorithmEdgeRows[algorithmId] ?? []).forEach((edge) => {
        if (!edge.source || !edge.target || edge.source === edge.target) return;
        candidateSources.add(edge.source);
        candidateTargets.add(edge.source);
        candidateTargets.add(edge.target);
      });
    });
    if (!candidateSources.size || !candidateTargets.size) {
      truthEdges.forEach((edge) => {
        candidateSources.add(edge.source);
        candidateTargets.add(edge.source);
        candidateTargets.add(edge.target);
      });
    }
    const eligibleTruthEdges = truthEdges.filter(
      (edge) =>
        edge.source !== edge.target &&
        candidateSources.has(edge.source) &&
        candidateTargets.has(edge.target),
    );
    const truth = new Set(
      eligibleTruthEdges.map((edge) => edgeKey(edge.source, edge.target)),
    );
    const truthSigns = new Map(
      eligibleTruthEdges.map((edge) => [
        edgeKey(edge.source, edge.target),
        normalizeSign(edge.sign),
      ]),
    );
    const referenceAdjacency = new Map<string, Set<string>>();
    eligibleTruthEdges.forEach((edge) => {
      const targets = referenceAdjacency.get(edge.source) ?? new Set<string>();
      targets.add(edge.target);
      referenceAdjacency.set(edge.source, targets);
    });
    let possibleEdges = 0;
    candidateSources.forEach((source) => {
      candidateTargets.forEach((target) => {
        if (source !== target) possibleEdges += 1;
      });
    });
    possibleEdges = Math.max(1, possibleEdges);
    const rows = activeAlgorithmIds.map((algorithmId) => {
      const task = tasks.find(
        (item) =>
          item.algorithm_id.toUpperCase() === algorithmId.toUpperCase(),
      );
      const seconds = Number(
        algorithmResults[algorithmId]?.elapsed_seconds ??
          task?.elapsed_seconds ??
          0,
      );
      return benchmarkAlgorithm({
        algorithmId,
        edges: algorithmEdgeRows[algorithmId] ?? [],
        truth,
        truthSigns,
        possibleEdges,
        evaluationDepth,
        runtimeSeconds: Number.isFinite(seconds) ? seconds : 0,
        methodSupportsSign: algorithmMetaMap.get(algorithmId)?.signed ?? false,
        referenceAdjacency,
        candidateSources,
        candidateTargets,
      });
    });
    return {
      rows,
      eligibleReferenceEdges: eligibleTruthEdges.length,
      uploadedReferenceEdges: truthEdges.length,
      possibleEdges,
      randomBaseline: eligibleTruthEdges.length / possibleEdges,
      referenceMotifs: motifCounts(eligibleTruthEdges),
    };
  }, [
    activeAlgorithmIds,
    algorithmEdgeRows,
    algorithmMetaMap,
    algorithmResults,
    evaluationDepth,
    groundTruth,
    tasks,
  ]);

  if (loading) {
    return (
      <EmptyState
        title="Preparing benchmark"
        detail="Reading the project reference network."
      />
    );
  }
  if (!groundTruth?.available) {
    return (
      <EmptyState
        title="Reference network required"
        detail={
          groundTruth?.reason ??
          "Add a ground-truth network to evaluate predictions."
        }
      />
    );
  }
  if (!benchmark.rows.length) {
    return (
      <EmptyState
        title="No methods to benchmark"
        detail="Select at least one completed method with ranked edges."
      />
    );
  }
  if (!benchmark.eligibleReferenceEdges) {
    return (
      <EmptyState
        title="No comparable reference edges"
        detail="The uploaded reference does not contain directed edges inside the candidate universe shared by the selected methods."
      />
    );
  }

  const rows = benchmark.rows;
  const sortedRows = [...rows].sort(
    (first, second) => second.auprcRatio - first.auprcRatio,
  );
  const signedMetricsAvailable = rows.some(
    (row) => row.activationEpr !== null || row.repressionEpr !== null,
  );
  const normalizeColumn = (
    value: number | null,
    values: Array<number | null>,
  ) => {
    if (value === null || !Number.isFinite(value)) return 0;
    const available = values.filter(
      (item): item is number => item !== null && Number.isFinite(item),
    );
    if (!available.length) return 0;
    const minimum = Math.min(...available);
    const maximum = Math.max(...available);
    if (maximum === minimum) return 0.65;
    const normalized = (value - minimum) / (maximum - minimum);
    return 0.18 + normalized * 0.82;
  };
  const auprcRatios = rows.map((row) => row.auprcRatio);
  const earlyPrecisionRatios = rows.map((row) => row.earlyPrecisionRatio);
  const activationRatios = rows.map((row) => row.activationEpr);
  const repressionRatios = rows.map((row) => row.repressionEpr);
  const evaluationOptions: Array<BenchmarkMenuOption<number>> = [
    {
      value: 0,
      label: "Complete ranking",
      detail: "Evaluate the shared candidate universe and tie missing edges at the bottom.",
    },
    ...[100, 250, 500, 1000, 2500].map((value) => ({
      value,
      label: `Top ${value.toLocaleString()}`,
      detail: "Report partial performance at this fixed evaluation depth.",
    })),
  ];
  return (
    <div className="space-y-5">
      <Panel
        title="Benchmark summary"
        description="Compare predictive accuracy over one shared regulator–target universe."
        aside={
          <ExportButton
            onClick={() =>
              downloadCsv("benchmark-summary.csv", [
                [
                  "algorithm",
                  "evaluated_edges",
                  "auprc",
                  "auprc_ratio",
                  "precision_at_k",
                  "early_precision_ratio",
                  "activation_epr",
                  "repression_epr",
                  "auroc",
                  "runtime_seconds",
                ],
                ...rows.map((row) => [
                  row.algorithmId,
                  row.evaluatedEdges,
                  row.auprc.toFixed(3),
                  row.auprcRatio.toFixed(3),
                  row.precisionAtK.toFixed(3),
                  row.earlyPrecisionRatio.toFixed(3),
                  row.activationEpr?.toFixed(3) ?? "",
                  row.repressionEpr?.toFixed(3) ?? "",
                  row.auroc.toFixed(3),
                  row.runtimeSeconds.toFixed(3),
                ]),
              ])
            }
          />
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1.5">
            {benchmark.possibleEdges.toLocaleString()} candidates
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1.5">
            {benchmark.eligibleReferenceEdges.toLocaleString()} reference edges
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1.5">
            Sorted by {evaluationDepth > 0 ? "partial " : ""}AUPRC ratio
          </span>
        </div>

        <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
          <table
            className={`w-full table-fixed border-collapse ${
              signedMetricsAvailable ? "min-w-[44rem]" : "min-w-[30rem]"
            }`}
          >
            <colgroup>
              <col className="w-44" />
              {Array.from({
                length: signedMetricsAvailable ? 4 : 2,
              }).map((_, index) => (
                <col key={index} />
              ))}
            </colgroup>
            <thead className="bg-slate-50/80">
              <tr className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-20 bg-slate-50 px-4 py-3 text-left align-bottom shadow-[1px_0_0_0_#e2e8f0]"
                >
                  Method
                </th>
                <th
                  colSpan={2}
                  className="border-l border-slate-200 px-3 py-2 text-center"
                >
                  Accuracy
                </th>
                {signedMetricsAvailable ? (
                  <th
                    colSpan={2}
                    className="border-l border-slate-200 px-3 py-2 text-center"
                  >
                    Signed recovery
                  </th>
                ) : null}
              </tr>
              <tr className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                <th className="border-l border-slate-200 px-3 py-3 text-center">
                  <MetricLabel explanation="Area under the precision–recall curve divided by random-predictor performance. Values above 1× outperform random.">
                    {evaluationDepth > 0 ? "Partial AUPRC ratio" : "AUPRC ratio"}
                  </MetricLabel>
                </th>
                <th className="px-3 py-3 text-center">
                  <MetricLabel explanation="Precision among the highest-ranked edges divided by random-predictor precision. Values above 1× indicate useful early enrichment.">
                    Early precision
                  </MetricLabel>
                </th>
                {signedMetricsAvailable ? (
                  <>
                    <th className="border-l border-slate-200 px-3 py-3 text-center">
                      <MetricLabel explanation="Early precision ratio calculated only for reference activation edges. Values above 1× outperform random.">
                        Activation EPR
                      </MetricLabel>
                    </th>
                    <th className="px-3 py-3 text-center">
                      <MetricLabel explanation="Early precision ratio calculated only for reference repression edges. Values above 1× outperform random.">
                        Repression EPR
                      </MetricLabel>
                    </th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr
                  key={row.algorithmId}
                  className="group border-t border-slate-100 text-sm text-slate-700 transition hover:bg-slate-50/70"
                >
                    <th className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left shadow-[1px_0_0_0_#f1f5f9] transition group-hover:bg-slate-50">
                      <span className="block font-extrabold text-slate-900">
                        {row.algorithmId}
                      </span>
                    </th>
                    <td className="border-l border-slate-100 px-1.5 py-1.5">
                      <HeatmapCell
                        value={row.auprcRatio}
                        display={`${row.auprcRatio.toFixed(3)}×`}
                        intensity={normalizeColumn(
                          row.auprcRatio,
                          auprcRatios,
                        )}
                        title="AUPRC ratio"
                        subdued={row.auprcRatio < 1}
                      />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <HeatmapCell
                        value={row.earlyPrecisionRatio}
                        display={`${row.earlyPrecisionRatio.toFixed(3)}×`}
                        intensity={normalizeColumn(
                          row.earlyPrecisionRatio,
                          earlyPrecisionRatios,
                        )}
                        title="Early precision ratio"
                        subdued={row.earlyPrecisionRatio < 1}
                      />
                    </td>
                    {signedMetricsAvailable ? (
                      <>
                        <td className="border-l border-slate-100 px-1.5 py-1.5">
                          <HeatmapCell
                            value={row.activationEpr}
                            display={
                              row.activationEpr === null
                                ? ""
                                : `${row.activationEpr.toFixed(3)}×`
                            }
                            intensity={normalizeColumn(
                              row.activationEpr,
                              activationRatios,
                            )}
                            title="Activation early precision ratio"
                            subdued={
                              row.activationEpr !== null &&
                              row.activationEpr < 1
                            }
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <HeatmapCell
                            value={row.repressionEpr}
                            display={
                              row.repressionEpr === null
                                ? ""
                                : `${row.repressionEpr.toFixed(3)}×`
                            }
                            intensity={normalizeColumn(
                              row.repressionEpr,
                              repressionRatios,
                            )}
                            title="Repression early precision ratio"
                            subdued={
                              row.repressionEpr !== null &&
                              row.repressionEpr < 1
                            }
                          />
                        </td>
                      </>
                    ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold text-slate-500">
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-8 rounded-full bg-[#087ead]/20" />
            Shade compares methods within each column; darker is stronger.
          </span>
          <span>Ratios above 1× outperform random.</span>
        </div>
        {!signedMetricsAvailable ? (
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Signed evaluation is unavailable because the reference or selected
            method outputs do not contain activation and repression labels.
          </p>
        ) : null}
        {benchmark.eligibleReferenceEdges < benchmark.uploadedReferenceEdges ? (
          <p className="mt-2 text-xs leading-5 text-slate-500">
            {(
              benchmark.uploadedReferenceEdges -
              benchmark.eligibleReferenceEdges
            ).toLocaleString()}{" "}
            uploaded reference edges fall outside the selected methods&apos;
            candidate universe and were excluded.
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Precision–recall performance"
        description={
          evaluationDepth > 0
            ? `Partial precision–recall performance across the first ${evaluationDepth.toLocaleString()} ranked edges. Select a method in the legend to focus it.`
            : "Precision–recall performance across the complete shared candidate universe. Select a method in the legend to focus it."
        }
        aside={
          <BenchmarkMenu
            prefix="Evaluation"
            value={evaluationDepth}
            options={evaluationOptions}
            onChange={setEvaluationDepth}
          />
        }
      >
        <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1.5">
            {benchmark.eligibleReferenceEdges.toLocaleString()} reference edges
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1.5">
            Random precision {benchmark.randomBaseline.toFixed(3)}
          </span>
          {evaluationDepth > 0 ? (
            <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-700">
              Partial metrics at top {evaluationDepth.toLocaleString()}
            </span>
          ) : null}
        </div>
        <LineChart
          series={rows.map((row) => ({
            name: row.algorithmId,
            points: row.pr,
            summary: `${evaluationDepth > 0 ? "pAUPRC" : "AUPRC"} ${row.auprc.toFixed(3)}`,
          }))}
          xLabel="Recall"
          yLabel="Precision"
          randomBaseline={benchmark.randomBaseline}
        />
      </Panel>

      <details className="group rounded-[1.25rem] border border-slate-200 bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div>
            <h3 className="text-base font-extrabold text-slate-950">
              Additional benchmark diagnostics
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Motif recovery, false-positive path context, and ROC curves.
            </p>
          </div>
          <span className="text-xl font-light text-slate-400 transition group-open:rotate-45">
            +
          </span>
        </summary>
        <div className="space-y-7 border-t border-slate-100 px-5 py-5 sm:px-6">
          <section>
            <h4 className="text-sm font-extrabold text-slate-900">
              Motif recovery
            </h4>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Predicted-to-reference ratios for BEELINE’s feedback,
              feed-forward, and mutual-interaction motifs.
            </p>
            <div className="mt-4">
              <MotifRecovery
                rows={rows}
                reference={benchmark.referenceMotifs}
              />
            </div>
          </section>
          <section className="border-t border-slate-100 pt-6">
            <h4 className="text-sm font-extrabold text-slate-900">
              False-positive path context
            </h4>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Incorrect top-k edges are grouped by the shortest corresponding
              path in the reference network.
            </p>
            <div className="mt-4">
              <PathBreakdown rows={rows} />
            </div>
          </section>
          <section className="border-t border-slate-100 pt-6">
            <h4 className="text-sm font-extrabold text-slate-900">ROC curves</h4>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              A secondary view; sparse networks can make ROC performance look
              optimistic.
            </p>
            <div className="mt-4">
              <LineChart
                series={rows.map((row) => ({
                  name: row.algorithmId,
                  points: row.roc,
                  summary: `AUROC ${row.auroc.toFixed(3)}`,
                }))}
                xLabel="False-positive rate"
                yLabel="True-positive rate"
                diagonalBaseline
              />
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}
