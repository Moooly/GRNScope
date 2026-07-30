"use client";

import {
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AlgorithmCatalogItem,
  AlgorithmResultEdge,
  AlgorithmStoredResult,
  BeelinePathStats,
  ProjectTask,
} from "../_lib/types";
import {
  benchmarkEdgeKey,
  computeBeelineBenchmarkMetrics,
  normalizeReferenceSign,
  type BenchmarkCurvePoint,
  type ReferenceSign,
} from "../_lib/benchmark";

type GroundTruthContext = {
  available: boolean;
  reason?: string;
  filename?: string;
  edge_count?: number;
  eligible_edge_count?: number;
  excluded_edge_count?: number;
  analysis_gene_count?: number | null;
  motif_reference?: {
    edge_count: number;
    feedback_loops: number;
    feed_forward_loops: number;
    mutual_interactions: number;
  };
  edges?: Array<{ source: string; target: string; sign?: string }>;
};

type CurvePoint = BenchmarkCurvePoint;
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
  pathMoreThan5: number;
  noPath: number;
};
type BenchmarkRow = {
  algorithmId: string;
  evaluatedEdges: number;
  possibleEdges: number;
  auprc: number;
  auprcRatio: number;
  auroc: number;
  precisionAtK: number;
  earlyPrecisionSelectedCount: number;
  earlyPrecisionRatio: number;
  activationPrecision: number | null;
  activationEpr: number | null;
  activationSelectedCount: number | null;
  inhibitionPrecision: number | null;
  inhibitionEpr: number | null;
  inhibitionSelectedCount: number | null;
  runtimeSeconds: number;
  pr: CurvePoint[];
  roc: CurvePoint[];
  directionAware: boolean;
  motifs: MotifCounts | null;
  pathCounts: PathCounts | null;
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
  return benchmarkEdgeKey(source, target);
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

function resultEdgesForScope(
  result: AlgorithmStoredResult | undefined,
  scopeId: string,
) {
  if (!result) return [];
  if (scopeId !== "global") {
    return result.scopes?.[scopeId]?.top_edges ?? [];
  }
  return result.top_edges ?? result.edges ?? result.ranked_edges ?? [];
}

function pathStatsForScope(
  result: AlgorithmStoredResult | undefined,
  scopeId: string,
) {
  if (!result) return null;
  if (scopeId !== "global") {
    return result.scopes?.[scopeId]?.beeline_path_stats ?? null;
  }
  return (
    result.beeline_path_stats ??
    result.scopes?.global?.beeline_path_stats ??
    null
  );
}

function beelineMotifNetwork(
  edges: AlgorithmResultEdge[],
  referenceEdgeCount: number,
) {
  // Confidence-enabled results combine bootstrap evidence with the unmodified
  // full-data run. BEELINE's motif evaluator receives that full-data ranked
  // network, so reconstruct it before applying BEELINE's absolute-score top-k.
  const hasFullDataMarkers = edges.some(
    (edge) => edge.full_data_present !== undefined,
  );
  return edges
    .filter((edge) => {
      const source = String(edge.source ?? "").trim();
      const target = String(edge.target ?? "").trim();
      return (
        source &&
        target &&
        source !== target &&
        (!hasFullDataMarkers || edge.full_data_present === true)
      );
    })
    .map((edge) => ({
      source: String(edge.source).trim(),
      target: String(edge.target).trim(),
      weight: Math.abs(
        Number(
          edge.full_data_raw_score ??
            edge.mean_raw_score ??
            edge.weight ??
            edge.edge_weight ??
            edge.score ??
            0,
        ),
      ),
    }))
    .sort((first, second) => second.weight - first.weight)
    .slice(0, referenceEdgeCount)
    .map(({ source, target }) => ({ source, target }));
}

function benchmarkAlgorithm({
  algorithmId,
  edges,
  truth,
  truthSigns,
  possibleEdges,
  runtimeSeconds,
  methodSupportsDirection,
  candidateGenes,
  motifEdges,
  motifReferenceEdgeCount,
  pathStats,
}: {
  algorithmId: string;
  edges: AlgorithmResultEdge[];
  truth: Set<string>;
  truthSigns: Map<string, ReferenceSign>;
  possibleEdges: number;
  runtimeSeconds: number;
  methodSupportsDirection: boolean;
  candidateGenes: Set<string>;
  motifEdges: AlgorithmResultEdge[];
  motifReferenceEdgeCount: number;
  pathStats: BeelinePathStats | null;
}): BenchmarkRow {
  const metrics = computeBeelineBenchmarkMetrics({
    algorithmId,
    edges,
    candidateGenes,
    truth,
    truthSigns,
    possibleEdges,
  });
  const motifNetwork = beelineMotifNetwork(
    motifEdges,
    motifReferenceEdgeCount,
  );
  const pathCounts: PathCounts | null = pathStats
    ? {
        truePositive: pathStats.num_true_positive,
        path2: pathStats.path_2,
        path3: pathStats.path_3,
        path4: pathStats.path_4,
        path5: pathStats.path_5,
        pathMoreThan5: pathStats.path_more_than_5,
        noPath: pathStats.num_false_positive_no_path,
      }
    : null;

  return {
    algorithmId,
    evaluatedEdges: metrics.nonzeroPredictionCount,
    possibleEdges,
    auprc: metrics.auprc,
    auprcRatio: metrics.auprcRatio,
    auroc: metrics.auroc,
    precisionAtK: metrics.earlyPrecision.precision,
    earlyPrecisionSelectedCount: metrics.earlyPrecision.selectedCount,
    earlyPrecisionRatio: metrics.earlyPrecision.ratio,
    activationPrecision: metrics.activation?.precision ?? null,
    activationEpr: metrics.activation?.ratio ?? null,
    activationSelectedCount: metrics.activation?.selectedCount ?? null,
    inhibitionPrecision: metrics.inhibition?.precision ?? null,
    inhibitionEpr: metrics.inhibition?.ratio ?? null,
    inhibitionSelectedCount: metrics.inhibition?.selectedCount ?? null,
    runtimeSeconds,
    pr: metrics.pr,
    roc: metrics.roc,
    directionAware: methodSupportsDirection,
    motifs: motifCounts(motifNetwork),
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

function RatioMetric({
  ratio,
  metric,
  rawValue,
}: {
  ratio: number | null;
  metric: string;
  rawValue: number | null;
}) {
  if (ratio === null || !Number.isFinite(ratio)) {
    return (
      <div className="py-1 text-sm font-semibold text-slate-300">
        —
      </div>
    );
  }

  return (
    <div
      title={`${metric} ratio: ${ratio.toFixed(3)}×; ${metric}: ${
        rawValue === null ? "not available" : rawValue.toFixed(3)
      }`}
      className="py-1 tabular-nums"
    >
      <p className="text-base font-extrabold text-slate-800">
        {ratio.toFixed(3)}×
      </p>
      <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
        {metric} {rawValue === null ? "—" : rawValue.toFixed(3)}
      </p>
    </div>
  );
}

function MotifRecovery({
  rows,
  reference,
  referenceEdgeCount,
}: {
  rows: BenchmarkRow[];
  reference: MotifCounts;
  referenceEdgeCount: number;
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
    <div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[46rem] table-fixed border-collapse">
          <thead className="bg-slate-50/80">
            <tr className="text-left">
              <th className="w-[22%] border-b border-slate-200 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                Algorithm
              </th>
            {motifs.map((motif) => (
                <th
                  key={motif.key}
                  className="border-b border-l border-slate-200 px-4 py-3"
                >
                  <span className="block text-xs font-bold text-slate-700">
                    {motif.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] font-medium text-slate-400">
                    {motif.note}
                  </span>
                </th>
            ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.algorithmId} className="last:[&>*]:border-b-0">
                <th className="border-b border-slate-100 px-4 py-4 text-left text-sm font-extrabold text-slate-800">
                  {row.algorithmId}
                </th>
                {motifs.map((motif) => {
                  const predicted = row.motifs?.[motif.key] ?? null;
                  const referenceCount = reference[motif.key];
                  const ratio =
                    predicted !== null && referenceCount > 0
                      ? predicted / referenceCount
                      : null;
                  return (
                    <td
                      key={motif.key}
                      className="border-b border-l border-slate-100 px-4 py-4"
                    >
                      <p className="text-base font-extrabold tabular-nums text-slate-800">
                        {ratio === null ? "—" : `${ratio.toFixed(3)}×`}
                      </p>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Ratio = motif count in a method&apos;s top {referenceEdgeCount} non-self
        edges ÷ motif count in the reference network. It compares counts, not
        exact motif overlap.
      </p>
    </div>
  );
}

function PathBreakdown({
  rows,
  referenceEdgeCount,
}: {
  rows: BenchmarkRow[];
  referenceEdgeCount: number;
}) {
  const colors = {
    truePositive: "#087ead",
    path2: "#72c9be",
    path3: "#eab35e",
    path4Plus: "#dc6b5d",
    noPath: "#cbd5e1",
  };
  const [hoveredSegment, setHoveredSegment] = useState<{
    algorithmId: string;
    key: keyof typeof colors;
    label: string;
    value: number;
    percentage: number;
    start: number;
    position: number;
  } | null>(null);
  const labels: Array<{
    key: "path2" | "path3" | "path4Plus" | "noPath";
    label: string;
    value: (counts: PathCounts) => number;
  }> = [
    {
      key: "path2",
      label: "Incorrect · 2 steps",
      value: (counts) => counts.path2,
    },
    {
      key: "path3",
      label: "Incorrect · 3 steps",
      value: (counts) => counts.path3,
    },
    {
      key: "path4Plus",
      label: "Incorrect · 4+ steps",
      value: (counts) =>
        counts.path4 + counts.path5 + counts.pathMoreThan5,
    },
    {
      key: "noPath",
      label: "Incorrect · no path",
      value: (counts) => counts.noPath,
    },
  ];
  return (
    <div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <div className="min-w-[40rem]">
          <div className="grid grid-cols-[10rem_1fr] items-center gap-4 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
            <span>Algorithm</span>
            <span>Top predictions</span>
          </div>
          {rows.map((row, rowIndex) => {
            const pathCounts = row.pathCounts;
            if (!pathCounts) {
              return (
                <div
                  key={row.algorithmId}
                  className="grid grid-cols-[10rem_1fr] items-center gap-4 border-b border-slate-100 px-4 py-3 text-center last:border-b-0"
                >
                  <span className="truncate text-sm font-extrabold text-slate-800">
                    {row.algorithmId}
                  </span>
                  <span className="text-xs font-semibold text-slate-400">
                    Path statistics unavailable
                  </span>
                </div>
              );
            }
            const falsePositiveTotal = labels.reduce(
              (sum, item) => sum + item.value(pathCounts),
              0,
            );
            const selectedTotal =
              pathCounts.truePositive + falsePositiveTotal;
            const segments: Array<{
              key: keyof typeof colors;
              label: string;
              value: number;
            }> = [
              {
                key: "truePositive",
                label: "Correct reference edge",
                value: pathCounts.truePositive,
              },
              ...labels.map((item) => ({
                key: item.key,
                label: item.label,
                value: item.value(pathCounts),
              })),
            ];
            let accumulatedPercentage = 0;
            const positionedSegments = segments.map((item) => {
              const percentage =
                selectedTotal > 0
                  ? (item.value / selectedTotal) * 100
                  : 0;
              const start = accumulatedPercentage;
              const position =
                accumulatedPercentage + percentage / 2;
              accumulatedPercentage += percentage;
              return {
                ...item,
                percentage,
                start,
                position: Math.max(7, Math.min(93, position)),
              };
            });
            const activeSegment =
              hoveredSegment?.algorithmId === row.algorithmId
                ? hoveredSegment
                : null;
            return (
              <div
                key={row.algorithmId}
                className={`relative grid grid-cols-[10rem_1fr] items-center gap-4 border-b border-slate-100 px-4 py-3 text-center last:border-b-0 ${
                  activeSegment ? "z-20" : "z-0"
                }`}
              >
                <span className="truncate text-sm font-extrabold text-slate-800">
                  {row.algorithmId}
                </span>
                <div className="relative mx-auto h-4 w-full max-w-[64rem]">
                  <div
                    className="flex h-4 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70"
                    aria-label={`${row.algorithmId}: ${pathCounts.truePositive} of ${selectedTotal} predictions exactly match the reference; ${falsePositiveTotal} are incorrect`}
                  >
                    {positionedSegments.map((item) =>
                      item.value > 0 ? (
                        <button
                          type="button"
                          key={item.key}
                          style={{
                            width: `${item.percentage}%`,
                            backgroundColor: colors[item.key],
                          }}
                          aria-label={`${item.label}: ${item.value} predicted edges, ${item.percentage.toFixed(1)}% of selected predictions`}
                          className={`h-full cursor-help transition-opacity duration-75 focus-visible:z-10 focus-visible:outline-none ${
                            activeSegment ? "opacity-60" : ""
                          }`}
                          onPointerEnter={() =>
                            setHoveredSegment({
                              algorithmId: row.algorithmId,
                              key: item.key,
                              label: item.label,
                              value: item.value,
                              percentage: item.percentage,
                              start: item.start,
                              position: item.position,
                            })
                          }
                          onPointerLeave={() => setHoveredSegment(null)}
                          onFocus={() =>
                            setHoveredSegment({
                              algorithmId: row.algorithmId,
                              key: item.key,
                              label: item.label,
                              value: item.value,
                              percentage: item.percentage,
                              start: item.start,
                              position: item.position,
                            })
                          }
                          onBlur={() => setHoveredSegment(null)}
                        />
                      ) : null,
                    )}
                  </div>
                  {activeSegment ? (
                    <div
                      className="pointer-events-none absolute -top-0.5 z-10 h-5 rounded-[0.3rem] ring-2 ring-white shadow-[0_2px_8px_rgba(15,23,42,0.18)]"
                      style={{
                        left: `${activeSegment.start}%`,
                        width: `${activeSegment.percentage}%`,
                        backgroundColor: colors[activeSegment.key],
                      }}
                      aria-hidden="true"
                    />
                  ) : null}
                  {activeSegment ? (
                    <div
                      className={`pointer-events-none absolute z-20 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-left shadow-lg shadow-slate-900/10 ${
                        rowIndex === rows.length - 1
                          ? "bottom-6"
                          : "top-6"
                      }`}
                      style={{ left: `${activeSegment.position}%` }}
                      role="tooltip"
                    >
                      <p className="text-[11px] font-extrabold text-slate-800">
                        {activeSegment.label}
                      </p>
                      <p className="mt-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
                        {activeSegment.value} predicted edges ·{" "}
                        {activeSegment.percentage.toFixed(1)}%
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: colors.truePositive }}
          />
          Exact reference edge
        </span>
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
      <p className="mt-3 max-w-5xl text-xs leading-5 text-slate-500">
        Hover a segment to see its edge count. Each complete bar is a
        method&apos;s top {referenceEdgeCount} non-self predictions by absolute
        weight; ties at the cutoff are included. Blue is an exact reference
        match. For an incorrect edge, “2 steps” means its two genes are
        connected indirectly by a two-edge directed path in the reference;
        gray means no directed path connects them.
      </p>
    </div>
  );
}

export default function BenchmarkInsights({
  groundTruth,
  loading,
  algorithmMetaMap,
  algorithmResults,
  activeAlgorithmIds,
  selectedResultScopeId,
  tasks,
}: {
  groundTruth: GroundTruthContext | undefined;
  loading: boolean;
  algorithmMetaMap: Map<string, AlgorithmCatalogItem>;
  algorithmResults: Record<string, AlgorithmStoredResult>;
  activeAlgorithmIds: string[];
  selectedResultScopeId: string;
  tasks: ProjectTask[];
}) {
  const benchmark = useMemo(() => {
    const truthEdges = groundTruth?.edges ?? [];
    if (!truthEdges.length) {
      return {
        rows: [] as BenchmarkRow[],
        eligibleReferenceEdges: 0,
        uploadedReferenceEdges: 0,
        excludedReferenceEdges: 0,
        candidateGeneCount: 0,
        possibleEdges: 0,
        randomBaseline: 0,
        motifReferenceEdgeCount: 0,
        referenceMotifs: {
          feedbackLoops: 0,
          feedForwardLoops: 0,
          mutualInteractions: 0,
        },
      };
    }

    // BEELINE derives one fixed directed universe from the genes present in
    // the reference network after it has been intersected with analyzed genes.
    const candidateGenes = new Set<string>();
    const eligibleTruthEdges = truthEdges.filter(
      (edge) => edge.source !== edge.target,
    );
    eligibleTruthEdges.forEach((edge) => {
      candidateGenes.add(edge.source);
      candidateGenes.add(edge.target);
    });
    const truth = new Set(
      eligibleTruthEdges.map((edge) => edgeKey(edge.source, edge.target)),
    );
    const truthSigns = new Map(
      eligibleTruthEdges.map((edge) => [
        edgeKey(edge.source, edge.target),
        normalizeReferenceSign(edge.sign),
      ]),
    );
    const candidateGeneCount = candidateGenes.size;
    const possibleEdges = candidateGeneCount * (candidateGeneCount - 1);
    const motifReference = groundTruth?.motif_reference;
    const motifReferenceEdgeCount =
      motifReference?.edge_count ?? truth.size;
    const referenceMotifs: MotifCounts = motifReference
      ? {
          feedbackLoops: motifReference.feedback_loops,
          feedForwardLoops: motifReference.feed_forward_loops,
          mutualInteractions: motifReference.mutual_interactions,
        }
      : motifCounts(eligibleTruthEdges);
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
        edges: resultEdgesForScope(
          algorithmResults[algorithmId],
          selectedResultScopeId,
        ),
        truth,
        truthSigns,
        possibleEdges,
        runtimeSeconds: Number.isFinite(seconds) ? seconds : 0,
        methodSupportsDirection:
          algorithmMetaMap.get(algorithmId)?.directed ?? true,
        candidateGenes,
        motifEdges: resultEdgesForScope(
          algorithmResults[algorithmId],
          selectedResultScopeId,
        ),
        motifReferenceEdgeCount,
        pathStats: pathStatsForScope(
          algorithmResults[algorithmId],
          selectedResultScopeId,
        ),
      });
    });
    return {
      rows,
      eligibleReferenceEdges: truth.size,
      uploadedReferenceEdges:
        groundTruth?.edge_count ?? truthEdges.length,
      excludedReferenceEdges:
        groundTruth?.excluded_edge_count ??
        Math.max(0, (groundTruth?.edge_count ?? truthEdges.length) - truth.size),
      candidateGeneCount,
      possibleEdges,
      randomBaseline: truth.size / possibleEdges,
      motifReferenceEdgeCount,
      referenceMotifs,
    };
  }, [
    activeAlgorithmIds,
    algorithmMetaMap,
    algorithmResults,
    groundTruth,
    selectedResultScopeId,
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
  if (!benchmark.eligibleReferenceEdges) {
    return (
      <EmptyState
        title="No comparable reference edges"
        detail="The uploaded reference does not contain non-self interactions between genes retained for this analysis."
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

  const rows = benchmark.rows;
  const sortedRows = [...rows].sort(
    (first, second) => second.auprcRatio - first.auprcRatio,
  );
  const signedMetricsAvailable = rows.some(
    (row) => row.activationEpr !== null || row.inhibitionEpr !== null,
  );
  return (
    <div className="space-y-5">
      <Panel
        title="Benchmark summary"
        description="How well each method recovers the uploaded reference network."
        aside={
          <ExportButton
            onClick={() =>
              downloadCsv("benchmark-summary.csv", [
                [
                  "algorithm",
                  "directionality",
                  "nonzero_predictions",
                  "evaluated_genes",
                  "possible_directed_interactions",
                  "reference_interactions",
                  "random_precision",
                  "auprc",
                  "auprc_ratio",
                  "early_precision",
                  "early_precision_ratio",
                  "early_precision_selected_edges",
                  "activation_early_precision",
                  "activation_epr",
                  "activation_selected_edges",
                  "inhibition_early_precision",
                  "inhibition_epr",
                  "inhibition_selected_edges",
                  "auroc",
                  "runtime_seconds",
                ],
                ...rows.map((row) => [
                  row.algorithmId,
                  algorithmMetaMap.get(row.algorithmId)?.directed === false
                    ? "undirected"
                    : "directed",
                  row.evaluatedEdges,
                  benchmark.candidateGeneCount,
                  benchmark.possibleEdges,
                  benchmark.eligibleReferenceEdges,
                  benchmark.randomBaseline.toFixed(6),
                  row.auprc.toFixed(3),
                  row.auprcRatio.toFixed(3),
                  row.precisionAtK.toFixed(3),
                  row.earlyPrecisionRatio.toFixed(3),
                  row.earlyPrecisionSelectedCount,
                  row.activationPrecision?.toFixed(3) ?? "",
                  row.activationEpr?.toFixed(3) ?? "",
                  row.activationSelectedCount ?? "",
                  row.inhibitionPrecision?.toFixed(3) ?? "",
                  row.inhibitionEpr?.toFixed(3) ?? "",
                  row.inhibitionSelectedCount ?? "",
                  row.auroc.toFixed(3),
                  row.runtimeSeconds.toFixed(3),
                ]),
              ])
            }
          />
        }
      >
        <p className="flex flex-wrap gap-x-2 gap-y-1 border-y border-slate-100 py-3 text-xs leading-5 text-slate-500">
          <span>
            <strong className="font-bold text-slate-700">
              {benchmark.candidateGeneCount.toLocaleString()}
            </strong>{" "}
            genes
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="font-bold text-slate-700">
              {benchmark.possibleEdges.toLocaleString()}
            </strong>{" "}
            possible directed interactions
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="font-bold text-slate-700">
              {benchmark.eligibleReferenceEdges.toLocaleString()}
            </strong>{" "}
            reference interactions
          </span>
          <span aria-hidden="true">·</span>
          <span>
            random precision{" "}
            <strong className="font-bold text-slate-700">
              {benchmark.randomBaseline.toFixed(3)}
            </strong>
          </span>
        </p>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
          <table
            className={`w-full table-fixed border-collapse ${
              signedMetricsAvailable ? "min-w-[52rem]" : "min-w-[34rem]"
            }`}
          >
            <colgroup>
              <col className="w-44" />
              <col className="w-48" />
              <col className="w-48" />
              {signedMetricsAvailable ? (
                <>
                  <col className="w-44" />
                  <col className="w-44" />
                </>
              ) : null}
            </colgroup>
            <thead className="bg-slate-50/80">
              <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-500">
                <th className="sticky left-0 z-20 bg-slate-50 px-4 py-3 text-left shadow-[1px_0_0_0_#e2e8f0]">
                  Algorithm
                </th>
                <th className="border-l border-slate-200 px-4 py-3 text-left">
                  <MetricLabel explanation="AUPRC across the complete ranked network, divided by random precision. The raw AUPRC appears underneath.">
                    AUPRC ratio
                  </MetricLabel>
                </th>
                <th className="px-4 py-3 text-left">
                  <MetricLabel explanation="Precision among approximately the top K predictions, divided by random precision. K is the number of reference interactions and ties are included.">
                    Early precision ratio
                  </MetricLabel>
                </th>
                {signedMetricsAvailable ? (
                  <>
                    <th className="border-l border-slate-200 px-4 py-3 text-left">
                      <MetricLabel explanation="Early precision ratio for interactions labelled activating in the reference. It does not mean that the method inferred a positive sign.">
                        Activation EPR
                      </MetricLabel>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <MetricLabel explanation="Early precision ratio for interactions labelled inhibitory in the reference. It does not mean that the method inferred a negative sign.">
                        Inhibition EPR
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
                  <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left shadow-[1px_0_0_0_#f1f5f9] transition group-hover:bg-slate-50">
                    <span className="font-extrabold text-slate-900">
                      {row.algorithmId}
                    </span>
                  </th>
                  <td className="border-l border-slate-100 px-4 py-2.5">
                    <RatioMetric
                      ratio={row.auprcRatio}
                      metric="AUPRC"
                      rawValue={row.auprc}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <RatioMetric
                      ratio={row.earlyPrecisionRatio}
                      metric="EP"
                      rawValue={row.precisionAtK}
                    />
                  </td>
                  {signedMetricsAvailable ? (
                    <>
                      <td className="border-l border-slate-100 px-4 py-2.5">
                        <RatioMetric
                          ratio={row.activationEpr}
                          metric="EP"
                          rawValue={row.activationPrecision}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <RatioMetric
                          ratio={row.inhibitionEpr}
                          metric="EP"
                          rawValue={row.inhibitionPrecision}
                        />
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          BEELINE evaluation uses one directed candidate set and absolute edge
          weights. Undirected outputs contain the same score in both
          orientations, so they cannot favor the correct direction.
        </p>
        {!signedMetricsAvailable ? (
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Activating and inhibitory recovery are unavailable because the
            reference does not label interaction types.
          </p>
        ) : null}
        {benchmark.excludedReferenceEdges > 0 ? (
          <p className="mt-2 text-xs leading-5 text-slate-500">
            {benchmark.excludedReferenceEdges.toLocaleString()} uploaded
            reference{" "}
            {benchmark.excludedReferenceEdges === 1 ? "row was" : "rows were"}{" "}
            excluded because of a self-interaction or a gene not retained for
            this analysis.
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Precision–recall performance"
        description="Performance across all directed candidate edges; missing predictions score zero."
      >
        <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1.5">
            {benchmark.eligibleReferenceEdges.toLocaleString()} reference edges
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1.5">
            Random precision {benchmark.randomBaseline.toFixed(3)}
          </span>
        </div>
        <LineChart
          series={rows.map((row) => ({
            name: row.algorithmId,
            points: row.pr,
            summary: `AUPRC ${row.auprc.toFixed(3)}`,
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
              Motif counts, top-prediction errors, and ROC curves.
            </p>
          </div>
          <span className="text-xl font-light text-slate-400 transition group-open:rotate-45">
            +
          </span>
        </summary>
        <div className="space-y-7 border-t border-slate-100 px-5 py-5 sm:px-6">
          <section>
            <h4 className="text-sm font-extrabold text-slate-900">
              Motif count ratios
            </h4>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Counts in each top-k predicted network divided by the
              corresponding reference-network count.
            </p>
            <div className="mt-4">
              <MotifRecovery
                rows={rows}
                reference={benchmark.referenceMotifs}
                referenceEdgeCount={benchmark.motifReferenceEdgeCount}
              />
            </div>
          </section>
          <section className="border-t border-slate-100 pt-6">
            <h4 className="text-sm font-extrabold text-slate-900">
              How the top predictions compare with the reference
            </h4>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Every bar contains the top {benchmark.eligibleReferenceEdges}{" "}
              predictions. Blue is correct; the remaining colors explain the
              incorrect predictions.
            </p>
            <div className="mt-4">
              <PathBreakdown
                rows={rows}
                referenceEdgeCount={benchmark.eligibleReferenceEdges}
              />
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
