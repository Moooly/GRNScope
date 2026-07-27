"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type TrajectoryData = {
  available: boolean;
  reason?: string;
  genes?: string[];
  available_genes?: string[];
  lineages?: Array<{
    name: string;
    cell_count: number;
    bins: Array<{
      pseudotime: number;
      cell_count: number;
      raw_expression: Record<string, number>;
      scaled_expression: Record<string, number | null>;
    }>;
  }>;
  embedding?: {
    method: string;
    path_source?: "pseudotime_bin_centroids" | "slingshot_curve";
    sampled_cell_count: number;
    total_cell_count: number;
    points: Array<{
      cell: string;
      x: number;
      y: number;
      pseudotime: Record<string, number | null>;
    }>;
    paths: Array<{
      name: string;
      points: Array<{
        x: number;
        y: number;
        pseudotime: number;
        cell_count: number;
      }>;
    }>;
  } | null;
};

type ChartPoint = {
  x: number;
  y: number;
};

type GenePoint = ChartPoint & {
  cellCount: number;
};

const GENE_COLORS = [
  "#087ead",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#059669",
  "#475569",
  "#ca8a04",
  "#0891b2",
];

function formatAxisValue(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 100) return value.toFixed(0);
  if (absolute >= 10) return value.toFixed(1);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function interpolateColor(progress: number) {
  const start = [7, 89, 133];
  const end = [186, 230, 253];
  const ratio = Math.max(0, Math.min(1, progress));
  const color = start.map((value, index) =>
    Math.round(value + (end[index] - value) * ratio),
  );
  return `rgb(${color.join(",")})`;
}

function linearSvgPath(points: ChartPoint[]) {
  if (!points.length) return "";
  return points
    .map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`)
    .join(" ");
}

function monotoneSvgPath(points: ChartPoint[]) {
  if (points.length < 3) return linearSvgPath(points);

  const intervals = points.slice(0, -1).map((point, index) => {
    const width = points[index + 1].x - point.x;
    return {
      width,
      slope: width > 0 ? (points[index + 1].y - point.y) / width : 0,
    };
  });
  if (intervals.some((interval) => interval.width <= 0)) {
    return linearSvgPath(points);
  }

  const tangents = points.map((_, index) => {
    if (index === 0) return intervals[0].slope;
    if (index === points.length - 1) return intervals.at(-1)?.slope ?? 0;
    const previous = intervals[index - 1];
    const next = intervals[index];
    if (!previous.slope || !next.slope || previous.slope * next.slope <= 0) {
      return 0;
    }
    const previousWeight = 2 * next.width + previous.width;
    const nextWeight = next.width + 2 * previous.width;
    return (
      (previousWeight + nextWeight) /
      (previousWeight / previous.slope + nextWeight / next.slope)
    );
  });

  let path = `M ${points[0].x} ${points[0].y}`;
  intervals.forEach((interval, index) => {
    let startTangent = tangents[index];
    let endTangent = tangents[index + 1];
    if (interval.slope === 0) {
      startTangent = 0;
      endTangent = 0;
    } else {
      const startRatio = startTangent / interval.slope;
      const endRatio = endTangent / interval.slope;
      const magnitude = Math.hypot(startRatio, endRatio);
      if (magnitude > 3) {
        const scale = 3 / magnitude;
        startTangent = scale * startRatio * interval.slope;
        endTangent = scale * endRatio * interval.slope;
      }
    }
    const current = points[index];
    const next = points[index + 1];
    const third = interval.width / 3;
    path += ` C ${current.x + third} ${current.y + startTangent * third}, ${next.x - third} ${next.y - endTangent * third}, ${next.x} ${next.y}`;
  });
  return path;
}

function EmptyTrajectory({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
      <p className="text-base font-extrabold text-slate-950">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
        {detail}
      </p>
    </div>
  );
}

function CellTrajectoryChart({
  embedding,
  lineageName,
}: {
  embedding: NonNullable<TrajectoryData["embedding"]>;
  lineageName: string;
}) {
  const width = 820;
  const height = 430;
  const left = 38;
  const right = 24;
  const top = 22;
  const bottom = 42;
  const allCoordinates = [
    ...embedding.points.map((point) => ({ x: point.x, y: point.y })),
    ...embedding.paths.flatMap((path) => path.points),
  ];
  const xValues = allCoordinates.map((point) => point.x);
  const yValues = allCoordinates.map((point) => point.y);
  const rawXMin = Math.min(...xValues);
  const rawXMax = Math.max(...xValues);
  const rawYMin = Math.min(...yValues);
  const rawYMax = Math.max(...yValues);
  const xPadding = Math.max((rawXMax - rawXMin) * 0.03, 1e-6);
  const yPadding = Math.max((rawYMax - rawYMin) * 0.04, 1e-6);
  const xMin = rawXMin - xPadding;
  const xMax = rawXMax + xPadding;
  const yMin = rawYMin - yPadding;
  const yMax = rawYMax + yPadding;
  const xPosition = (value: number) =>
    left + ((value - xMin) / Math.max(1e-9, xMax - xMin)) * (width - left - right);
  const yPosition = (value: number) =>
    top +
    (1 - (value - yMin) / Math.max(1e-9, yMax - yMin)) *
      (height - top - bottom);
  const activeValues = embedding.points
    .map((point) => point.pseudotime[lineageName])
    .filter((value): value is number => typeof value === "number");
  const pseudotimeMin = Math.min(...activeValues);
  const pseudotimeMax = Math.max(...activeValues);
  const activePath = embedding.paths.find((path) => path.name === lineageName);
  const displayedCount = activeValues.length;

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block w-full"
          role="img"
          aria-label={`${embedding.method} cell embedding colored by ${lineageName} pseudotime`}
        >
          <rect width={width} height={height} fill="#f8fafc" />
          {embedding.points.map((point) => {
            const pseudotime = point.pseudotime[lineageName];
            const isActive = typeof pseudotime === "number";
            const progress = isActive
              ? (pseudotime - pseudotimeMin) /
                Math.max(1e-9, pseudotimeMax - pseudotimeMin)
              : 0;
            return (
              <circle
                key={point.cell}
                cx={xPosition(point.x)}
                cy={yPosition(point.y)}
                r={isActive ? 2.8 : 2.3}
                fill={isActive ? interpolateColor(progress) : "#b6c2d0"}
                fillOpacity={isActive ? 0.82 : 0.5}
              >
                <title>
                  {point.cell}
                  {isActive ? ` · pseudotime ${formatAxisValue(pseudotime)}` : ""}
                </title>
              </circle>
            );
          })}
          {embedding.paths.map((path) => {
            if (path.name === lineageName) return null;
            const chartPoints = path.points.map((point) => ({
              x: xPosition(point.x),
              y: yPosition(point.y),
            }));
            return (
              <path
                key={path.name}
                d={linearSvgPath(chartPoints)}
                fill="none"
                stroke="#94a3b8"
                strokeWidth="2"
                strokeDasharray="5 5"
                strokeLinecap="round"
                opacity="0.58"
              />
            );
          })}
          {activePath ? (
            <>
              <path
                d={linearSvgPath(
                  activePath.points.map((point) => ({
                    x: xPosition(point.x),
                    y: yPosition(point.y),
                  })),
                )}
                fill="none"
                stroke="white"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.9"
              />
              <path
                d={linearSvgPath(
                  activePath.points.map((point) => ({
                    x: xPosition(point.x),
                    y: yPosition(point.y),
                  })),
                )}
                fill="none"
                stroke="#0f789f"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {activePath.points.length ? (
                <>
                  <circle
                    cx={xPosition(activePath.points[0].x)}
                    cy={yPosition(activePath.points[0].y)}
                    r="5"
                    fill="#075985"
                    stroke="white"
                    strokeWidth="2"
                  />
                  <circle
                    cx={xPosition(activePath.points.at(-1)?.x ?? 0)}
                    cy={yPosition(activePath.points.at(-1)?.y ?? 0)}
                    r="5"
                    fill="#bae6fd"
                    stroke="white"
                    strokeWidth="2"
                  />
                </>
              ) : null}
            </>
          ) : null}
          <text
            x={(left + width - right) / 2}
            y={height - 10}
            textAnchor="middle"
            fill="#64748b"
            fontSize="12"
            fontWeight="600"
          >
            {embedding.method} 1
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
            {embedding.method} 2
          </text>
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-slate-500">
        <div className="flex items-center gap-2">
          <span>Early</span>
          <span
            className="h-2.5 w-28 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, rgb(7,89,133), rgb(186,230,253))",
            }}
            aria-hidden="true"
          />
          <span>Late</span>
        </div>
        <span>
          {displayedCount.toLocaleString()} displayed cells in {lineageName}
        </span>
      </div>
    </div>
  );
}

function smoothGenePoints(points: GenePoint[]) {
  if (points.length < 3) return points;
  return points.map((point, index) => {
    let weightedValue = 2 * point.y;
    let weight = 2;
    if (points[index - 1]) {
      weightedValue += points[index - 1].y;
      weight += 1;
    }
    if (points[index + 1]) {
      weightedValue += points[index + 1].y;
      weight += 1;
    }
    return {
      ...point,
      y: weightedValue / weight,
    };
  });
}

function GeneDynamicsChart({
  series,
}: {
  series: Array<{ name: string; color: string; points: GenePoint[] }>;
}) {
  const width = 820;
  const height = 380;
  const left = 62;
  const right = 24;
  const top = 22;
  const bottom = 50;
  const allPoints = series.flatMap((item) => item.points);
  const xValues = allPoints.map((point) => point.x);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const xPosition = (value: number) =>
    left + ((value - xMin) / Math.max(1e-9, xMax - xMin)) * (width - left - right);
  const yPosition = (value: number) =>
    top + (1 - value) * (height - top - bottom);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xTicks = Array.from(
    { length: 5 },
    (_, index) => xMin + ((xMax - xMin) * index) / 4,
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full"
        role="img"
        aria-label="Scaled gene expression over pseudotime"
      >
        {yTicks.map((tick) => (
          <g key={tick}>
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
        {xTicks.map((tick, index) => (
          <g key={`${tick}-${index}`}>
            <line
              x1={xPosition(tick)}
              x2={xPosition(tick)}
              y1={height - bottom}
              y2={height - bottom + 5}
              stroke="#94a3b8"
            />
            <text
              x={xPosition(tick)}
              y={height - bottom + 20}
              textAnchor="middle"
              fill="#64748b"
              fontSize="11"
              fontWeight="600"
            >
              {formatAxisValue(tick)}
            </text>
          </g>
        ))}
        <line
          x1={left}
          x2={left}
          y1={top}
          y2={height - bottom}
          stroke="#94a3b8"
        />
        <line
          x1={left}
          x2={width - right}
          y1={height - bottom}
          y2={height - bottom}
          stroke="#94a3b8"
        />
        {series.map((item) => {
          const smoothed = smoothGenePoints(item.points).map((point) => ({
            x: xPosition(point.x),
            y: yPosition(point.y),
          }));
          return (
            <g key={item.name}>
              <path
                d={monotoneSvgPath(smoothed)}
                fill="none"
                stroke={item.color}
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {item.points.map((point, index) => (
                <circle
                  key={`${item.name}-${index}`}
                  cx={xPosition(point.x)}
                  cy={yPosition(point.y)}
                  r="2.2"
                  fill="white"
                  stroke={item.color}
                  strokeWidth="1.4"
                  opacity="0.72"
                >
                  <title>
                    {item.name} · pseudotime {formatAxisValue(point.x)} · scaled{" "}
                    {point.y.toFixed(3)} · {point.cellCount} cells
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
        <text
          x={(left + width - right) / 2}
          y={height - 8}
          textAnchor="middle"
          fill="#64748b"
          fontSize="12"
          fontWeight="600"
        >
          Pseudotime
        </text>
        <text
          x="16"
          y={(top + height - bottom) / 2}
          textAnchor="middle"
          fill="#64748b"
          fontSize="12"
          fontWeight="600"
          transform={`rotate(-90 16 ${(top + height - bottom) / 2})`}
        >
          Relative expression
        </text>
      </svg>
    </div>
  );
}

function LineageMenu({
  lineages,
  value,
  onChange,
}: {
  lineages: NonNullable<TrajectoryData["lineages"]>;
  value: string;
  onChange: (lineageName: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
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
        aria-label={`Select lineage. Current lineage: ${value}`}
        className={`inline-flex h-10 max-w-[18rem] items-center gap-2 rounded-full border bg-white px-4 text-sm font-semibold transition ${
          isOpen
            ? "border-[#1b75a6]/40 text-[#1b75a6] ring-4 ring-[#1b75a6]/[0.06]"
            : "border-slate-200 text-slate-600 hover:border-[#1b75a6]/30 hover:text-[#1b75a6]"
        }`}
      >
        <span className="text-slate-500">Lineage</span>
        <span className="text-slate-300" aria-hidden="true">
          ·
        </span>
        <span className="min-w-0 truncate font-bold text-slate-900">{value}</span>
        <svg
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
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
          aria-label="Available lineages"
          className="absolute right-0 top-full z-40 mt-1.5 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/15"
        >
          {lineages.map((item) => {
            const isActive = item.name === value;
            return (
              <button
                key={item.name}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  onChange(item.name);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                  isActive
                    ? "bg-[#f2f9fc] text-[#1b75a6]"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-bold">
                  {item.name}
                </span>
                <span
                  className={`shrink-0 text-[11px] font-bold tabular-nums ${
                    isActive ? "text-[#1b75a6]/75" : "text-slate-400"
                  }`}
                >
                  {item.cell_count.toLocaleString()} cells
                </span>
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {isActive ? (
                    <svg
                      viewBox="0 0 16 16"
                      className="h-3.5 w-3.5"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="m3.5 8.2 3 3 6-6"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function TrajectoryInsights({
  trajectory,
  loading,
  onGenesChange,
}: {
  trajectory?: TrajectoryData;
  loading: boolean;
  onGenesChange: (genes: string[]) => void;
}) {
  const [mode, setMode] = useState<"cells" | "genes">("cells");
  const [requestedLineageName, setRequestedLineageName] = useState("");
  const [geneQuery, setGeneQuery] = useState("");
  const [isGeneSearchOpen, setIsGeneSearchOpen] = useState(false);
  const lineages = useMemo(
    () => trajectory?.lineages ?? [],
    [trajectory?.lineages],
  );
  const lineage =
    lineages.find((item) => item.name === requestedLineageName) ?? lineages[0];
  const genes = (trajectory?.genes ?? []).slice(0, 8);
  const availableGenes = trajectory?.available_genes ?? genes;
  const matchingGenes = useMemo(() => {
    const normalizedQuery = geneQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return [];
    return availableGenes
      .filter(
        (gene) =>
          !genes.includes(gene) &&
          gene.toLocaleLowerCase().includes(normalizedQuery),
      )
      .sort((left, right) => {
        const leftStarts = left.toLocaleLowerCase().startsWith(normalizedQuery);
        const rightStarts = right.toLocaleLowerCase().startsWith(normalizedQuery);
        if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
        return left.localeCompare(right);
      })
      .slice(0, 8);
  }, [availableGenes, geneQuery, genes]);

  if (loading) {
    return (
      <EmptyTrajectory
        title="Preparing trajectory"
        detail="Reading pseudotime, arranging the cells, and calculating gene-expression trends."
      />
    );
  }
  if (!trajectory?.available || !lineage) {
    return (
      <EmptyTrajectory
        title="Trajectory is unavailable"
        detail={
          trajectory?.reason ?? "This project does not include usable pseudotime."
        }
      />
    );
  }

  const series = genes.map((gene) => {
    const colorIndex = Math.max(0, genes.indexOf(gene));
    return {
      name: gene,
      color: GENE_COLORS[colorIndex % GENE_COLORS.length],
      points: lineage.bins.map((bin) => ({
        x: bin.pseudotime,
        y: Number(bin.scaled_expression[gene] ?? 0),
        cellCount: bin.cell_count,
      })),
    };
  });
  const hasEmbedding = Boolean(
    trajectory.embedding?.points.length && trajectory.embedding.paths.length,
  );

  return (
    <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-extrabold text-slate-950">
            {mode === "cells" ? "Cell trajectory" : "Gene dynamics"}
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            {mode === "cells"
              ? `${trajectory.embedding?.method ?? "2D"} embedding colored from dark early to light late pseudotime, with an ordered lineage guide.`
              : "Equal-cell bin means with a three-bin smoothing curve; every gene is scaled independently from 0 to 1."}
          </p>
        </div>
        <LineageMenu
          lineages={lineages}
          value={lineage.name}
          onChange={setRequestedLineageName}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex items-center gap-6" role="tablist" aria-label="Trajectory visualization">
          {[
            { value: "cells" as const, label: "Cell trajectory" },
            { value: "genes" as const, label: "Gene dynamics" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={mode === option.value}
              onClick={() => setMode(option.value)}
              className={`relative pb-3 text-sm font-bold transition ${
                mode === option.value
                  ? "text-[#087ead] after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:rounded-full after:bg-[#087ead]"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
            {lineage.cell_count.toLocaleString()} lineage cells
          </span>
          {mode === "cells" && trajectory.embedding ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
              {trajectory.embedding.sampled_cell_count.toLocaleString()} displayed
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
              {lineage.bins.length} bins
            </span>
          )}
        </div>
      </div>

      <div className="mt-5">
        {mode === "cells" ? (
          hasEmbedding && trajectory.embedding ? (
            <>
              <CellTrajectoryChart
                embedding={trajectory.embedding}
                lineageName={lineage.name}
              />
              <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
                Cell positions are generated from this project&apos;s expression
                matrix. The guide follows ordered pseudotime-bin centers, while
                lineage membership and direction come from the uploaded or estimated
                pseudotime data.
              </p>
            </>
          ) : (
            <EmptyTrajectory
              title="Cell embedding unavailable"
              detail="The pseudotime trends are available, but there are not enough usable cells to build the two-dimensional cell view. Gene dynamics can still be explored."
            />
          )
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs font-bold text-slate-500">Genes</span>
                {genes.map((gene, index) => {
                  const color = GENE_COLORS[index % GENE_COLORS.length];
                  return (
                    <span
                      key={gene}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      {gene}
                      <button
                        type="button"
                        disabled={genes.length === 1}
                        onClick={() =>
                          onGenesChange(genes.filter((value) => value !== gene))
                        }
                        className="-mr-1 grid h-4 w-4 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
                        aria-label={`Remove ${gene}`}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
              <div className="relative">
                <div className="flex h-9 w-52 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-slate-500 shadow-sm transition focus-within:border-[#087ead]/50 focus-within:ring-2 focus-within:ring-[#087ead]/10">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    value={geneQuery}
                    disabled={genes.length >= 8}
                    onFocus={() => setIsGeneSearchOpen(true)}
                    onBlur={() =>
                      window.setTimeout(() => setIsGeneSearchOpen(false), 120)
                    }
                    onChange={(event) => {
                      setGeneQuery(event.target.value);
                      setIsGeneSearchOpen(true);
                    }}
                    placeholder={genes.length >= 8 ? "8 genes selected" : "Add a gene"}
                    className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
                    aria-label="Search genes to add"
                  />
                </div>
                {isGeneSearchOpen && geneQuery.trim() ? (
                  <div className="absolute right-0 z-20 mt-2 max-h-60 w-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
                    {matchingGenes.length ? (
                      matchingGenes.map((gene) => (
                        <button
                          key={gene}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            onGenesChange([...genes, gene]);
                            setGeneQuery("");
                            setIsGeneSearchOpen(false);
                          }}
                          className="block w-full rounded-xl px-3 py-2 text-left text-xs font-bold text-slate-700 transition hover:bg-sky-50 hover:text-[#087ead]"
                        >
                          {gene}
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-3 text-xs font-semibold text-slate-500">
                        No matching genes
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            <GeneDynamicsChart series={series} />
            <p className="mt-4 rounded-xl bg-amber-50/70 px-4 py-3 text-xs leading-5 text-amber-900">
              Compare when genes change, not their absolute heights. Each gene uses
              its own 0–1 scale; outlined points are observed bin means and solid
              curves are lightly smoothed.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
