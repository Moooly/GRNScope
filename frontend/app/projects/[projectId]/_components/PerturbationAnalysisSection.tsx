"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { API_BASE } from "../../../_lib/apiConfig";
import { apiFetch } from "../../../_lib/clientIdentity";
import type {
  GeneExpressionProfile,
  PerturbationResult,
  PerturbationRun,
  PerturbationState,
} from "../_lib/types";


const ACTIVE_STATUSES = new Set(["Queued", "Preparing", "Running"]);
const PLOT_WIDTH = 520;
const PLOT_HEIGHT = 330;
const PLOT_PADDING = 24;
const DISPLAY_CHANGE_EPSILON = 1e-6;
const DEFAULT_PLOT_VIEWPORT = { x: 0, y: 0, width: PLOT_WIDTH, height: PLOT_HEIGHT };
const PROPAGATION_OPTIONS = [
  { value: 1, label: "1 — Direct" },
  { value: 2, label: "2 — Short" },
  { value: 3, label: "3 — Standard" },
  { value: 4, label: "4 — Extended" },
  { value: 5, label: "5 — Maximum" },
];

type PerturbationAnalysisSectionProps = {
  projectId: string;
  cellOracleStatus?: string | null;
  initialGene?: string | null;
};

type PlotPoint = {
  x: number;
  y: number;
  cluster: string;
  shift_x?: number;
  shift_y?: number;
  random_shift_x?: number;
  random_shift_y?: number;
};
type PlotVector = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  random_dx: number;
  random_dy: number;
};
type DisplayVector = { x: number; y: number; dx: number; dy: number };
type GridVectorFields = {
  predicted: DisplayVector[];
  randomized: DisplayVector[];
};
type PlotViewport = typeof DEFAULT_PLOT_VIEWPORT;
type PlotKind = "predicted" | "randomized";

function formatElapsed(seconds?: number) {
  const value = Math.max(0, Number(seconds ?? 0));
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return `${minutes}m ${remainder}s`;
}

function formatTimestamp(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatScientific(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 0.01 && Math.abs(value) < 1000) {
    return value.toFixed(3).replace(/\.?0+$/, "");
  }
  return value.toExponential(2);
}

function formatPerturbation(gene: string, value: number) {
  return value === 0
    ? `${gene} knockout`
    : `${gene} set to ${formatScientific(value)}`;
}

function statusClasses(status: string) {
  if (status === "Completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Failed") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function SelectChevron() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="m6 8 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function quantile(values: number[], percentile: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile))];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function zoomViewportFromCenter(viewport: PlotViewport, factor: number): PlotViewport {
  const centerX = viewport.x + viewport.width / 2;
  const centerY = viewport.y + viewport.height / 2;
  const width = clamp(viewport.width * factor, PLOT_WIDTH * 0.36, PLOT_WIDTH);
  const height = width * (PLOT_HEIGHT / PLOT_WIDTH);
  return {
    x: clamp(centerX - width / 2, 0, PLOT_WIDTH - width),
    y: clamp(centerY - height / 2, 0, PLOT_HEIGHT - height),
    width,
    height,
  };
}

function calculateGridVectorFields(
  points: PlotPoint[],
  vectors: PlotVector[]
): GridVectorFields {
  const finitePoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const finiteVectors = vectors.filter((vector) =>
    [
      vector.x,
      vector.y,
      vector.dx,
      vector.dy,
      vector.random_dx,
      vector.random_dy,
    ].every(Number.isFinite)
  );
  if (finitePoints.length === 0 || finiteVectors.length === 0) {
    return { predicted: [], randomized: [] };
  }

  const minX = Math.min(...finitePoints.map((point) => point.x));
  const maxX = Math.max(...finitePoints.map((point) => point.x));
  const minY = Math.min(...finitePoints.map((point) => point.y));
  const maxY = Math.max(...finitePoints.map((point) => point.y));
  const rawXRange = Math.max(1e-9, maxX - minX);
  const rawYRange = Math.max(1e-9, maxY - minY);
  const gridMinX = minX - rawXRange * 0.025;
  const gridMaxX = maxX + rawXRange * 0.025;
  const gridMinY = minY - rawYRange * 0.025;
  const gridMaxY = maxY + rawYRange * 0.025;
  const gridSize = 40;
  const xSpacing = (gridMaxX - gridMinX) / (gridSize - 1);
  const ySpacing = (gridMaxY - gridMinY) / (gridSize - 1);
  const bandwidth = Math.max(((xSpacing + ySpacing) / 2) * 0.8, 1e-9);
  const inverseBandwidth = 1 / (2 * bandwidth * bandwidth);
  const gaussianNormalizer = 1 / (Math.sqrt(2 * Math.PI) * bandwidth);
  const samplingCorrection = finitePoints.length / finiteVectors.length;
  const minMass = 0.01;
  const predicted: DisplayVector[] = [];
  const randomized: DisplayVector[] = [];

  for (let row = 0; row < gridSize; row += 1) {
    const y = gridMinY + (row / (gridSize - 1)) * (gridMaxY - gridMinY);
    for (let column = 0; column < gridSize; column += 1) {
      const x = gridMinX + (column / (gridSize - 1)) * (gridMaxX - gridMinX);
      let density = 0;
      for (const point of finitePoints) {
        const distanceSquared = (point.x - x) ** 2 + (point.y - y) ** 2;
        density += gaussianNormalizer * Math.exp(-distanceSquared * inverseBandwidth);
      }
      if (density < minMass) continue;

      let vectorMass = 0;
      let dx = 0;
      let dy = 0;
      let randomDx = 0;
      let randomDy = 0;
      for (const vector of finiteVectors) {
        const distanceSquared = (vector.x - x) ** 2 + (vector.y - y) ** 2;
        const weight = gaussianNormalizer * Math.exp(-distanceSquared * inverseBandwidth);
        vectorMass += weight;
        dx += vector.dx * weight;
        dy += vector.dy * weight;
        randomDx += vector.random_dx * weight;
        randomDy += vector.random_dy * weight;
      }
      if (vectorMass <= 1e-9) continue;
      const correctedMass = vectorMass * samplingCorrection;
      const denominator = Math.max(1, correctedMass);
      predicted.push({
        x,
        y,
        dx: (dx * samplingCorrection) / denominator,
        dy: (dy * samplingCorrection) / denominator,
      });
      randomized.push({
        x,
        y,
        dx: (randomDx * samplingCorrection) / denominator,
        dy: (randomDy * samplingCorrection) / denominator,
      });
    }
  }

  return { predicted, randomized };
}

function resolveGridVectorFields(result: PerturbationResult): GridVectorFields {
  if (result.grid_vectors?.length) {
    return {
      predicted: result.grid_vectors.map((vector) => ({
        x: vector.x,
        y: vector.y,
        dx: vector.dx,
        dy: vector.dy,
      })),
      randomized: result.grid_vectors.map((vector) => ({
        x: vector.x,
        y: vector.y,
        dx: vector.random_dx,
        dy: vector.random_dy,
      })),
    };
  }
  return calculateGridVectorFields(result.embedding_points, result.vectors ?? []);
}

function VectorFieldPlot({
  title,
  points,
  vectors,
  comparisonVectors,
  referenceMagnitude,
  viewport,
  activeVectorIndex,
  pinnedVectorIndex,
  tooltipVisible,
  onViewportChange,
  onHoverVector,
  onTogglePin,
  onExpand,
  isExpanded = false,
  randomized = false,
}: {
  title: string;
  points: PlotPoint[];
  vectors: DisplayVector[];
  comparisonVectors: DisplayVector[];
  referenceMagnitude: number;
  viewport: PlotViewport;
  activeVectorIndex: number | null;
  pinnedVectorIndex: number | null;
  tooltipVisible: boolean;
  onViewportChange: (viewport: PlotViewport) => void;
  onHoverVector: (index: number | null) => void;
  onTogglePin: (index: number) => void;
  onExpand?: () => void;
  isExpanded?: boolean;
  randomized?: boolean;
}) {
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    viewport: PlotViewport;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const allX = [...points.map((point) => point.x), ...vectors.map((vector) => vector.x)];
  const allY = [...points.map((point) => point.y), ...vectors.map((vector) => vector.y)];
  const minX = allX.length > 0 ? Math.min(...allX) : 0;
  const maxX = allX.length > 0 ? Math.max(...allX) : 1;
  const minY = allY.length > 0 ? Math.min(...allY) : 0;
  const maxY = allY.length > 0 ? Math.max(...allY) : 1;
  const xRange = Math.max(1e-9, maxX - minX);
  const yRange = Math.max(1e-9, maxY - minY);
  const plotWidth = PLOT_WIDTH - PLOT_PADDING * 2;
  const plotHeight = PLOT_HEIGHT - PLOT_PADDING * 2;
  const mapX = (value: number) => PLOT_PADDING + ((value - minX) / xRange) * plotWidth;
  const mapY = (value: number) => PLOT_HEIGHT - PLOT_PADDING - ((value - minY) / yRange) * plotHeight;
  const arrowScale = (Math.min(plotWidth, plotHeight) * 0.06) / referenceMagnitude;
  const maxArrowLength = Math.min(plotWidth, plotHeight) * 0.085;
  const activeVector = activeVectorIndex === null ? null : vectors[activeVectorIndex] ?? null;
  const comparisonVector = activeVectorIndex === null
    ? null
    : comparisonVectors[activeVectorIndex] ?? null;
  const predictedVector = randomized ? comparisonVector : activeVector;
  const randomizedVector = randomized ? activeVector : comparisonVector;
  const predictedMagnitude = predictedVector ? Math.hypot(predictedVector.dx, predictedVector.dy) : 0;
  const randomizedMagnitude = randomizedVector ? Math.hypot(randomizedVector.dx, randomizedVector.dy) : 0;
  const activePlotX = activeVector ? mapX(activeVector.x) : 0;
  const activePlotY = activeVector ? mapY(activeVector.y) : 0;
  const tooltipX = ((activePlotX - viewport.x) / viewport.width) * 100;
  const tooltipY = ((activePlotY - viewport.y) / viewport.height) * 100;
  const showTooltip = Boolean(
    tooltipVisible &&
    activeVector &&
    tooltipX >= 0 &&
    tooltipX <= 100 &&
    tooltipY >= 0 &&
    tooltipY <= 100
  );
  const tooltipTranslateX = tooltipX < 25 ? "0%" : tooltipX > 75 ? "-100%" : "-50%";
  const tooltipTranslateY = tooltipY < 38 ? "14px" : "calc(-100% - 14px)";

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const pointerY = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    const factor = event.deltaY > 0 ? 1.14 : 0.86;
    const nextWidth = clamp(viewport.width * factor, PLOT_WIDTH * 0.36, PLOT_WIDTH);
    const nextHeight = nextWidth * (PLOT_HEIGHT / PLOT_WIDTH);
    const worldX = viewport.x + pointerX * viewport.width;
    const worldY = viewport.y + pointerY * viewport.height;
    onViewportChange({
      x: clamp(worldX - pointerX * nextWidth, 0, PLOT_WIDTH - nextWidth),
      y: clamp(worldY - pointerY * nextHeight, 0, PLOT_HEIGHT - nextHeight),
      width: nextWidth,
      height: nextHeight,
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      viewport,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const deltaX = ((event.clientX - drag.clientX) / bounds.width) * drag.viewport.width;
    const deltaY = ((event.clientY - drag.clientY) / bounds.height) * drag.viewport.height;
    onViewportChange({
      ...drag.viewport,
      x: clamp(drag.viewport.x - deltaX, 0, PLOT_WIDTH - drag.viewport.width),
      y: clamp(drag.viewport.y - deltaY, 0, PLOT_HEIGHT - drag.viewport.height),
    });
  };

  const finishPointerDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2">
        <span className="text-sm font-bold text-slate-950">{title}</span>
      </figcaption>
      <div className="relative">
        <div className="absolute right-3 top-3 z-20 inline-flex h-8 overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={() => onViewportChange(zoomViewportFromCenter(viewport, 1.25))}
            disabled={viewport.width >= PLOT_WIDTH - 0.01}
            className="inline-flex w-8 items-center justify-center border-r border-slate-200 text-base font-bold text-slate-600 transition hover:bg-[#f2f9fc] hover:text-[#087ead] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-white disabled:hover:text-slate-600"
            aria-label={`Zoom out ${title}`}
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => onViewportChange(zoomViewportFromCenter(viewport, 0.8))}
            disabled={viewport.width <= PLOT_WIDTH * 0.36 + 0.01}
            className="inline-flex w-8 items-center justify-center border-r border-slate-200 text-base font-bold text-slate-600 transition hover:bg-[#f2f9fc] hover:text-[#087ead] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-white disabled:hover:text-slate-600"
            aria-label={`Zoom in ${title}`}
            title="Zoom in"
          >
            +
          </button>
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="inline-flex w-8 items-center justify-center text-[15px] font-bold text-slate-600 transition hover:bg-[#f2f9fc] hover:text-[#087ead]"
              aria-label={`${isExpanded ? "Exit expanded" : "Expand"} ${title}`}
              title={isExpanded ? "Exit expanded view" : "Expand"}
            >
              ⛶
            </button>
          )}
        </div>
        <svg
          viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
          className={`h-auto w-full rounded-xl border border-slate-100 bg-[#f7fbff] ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
          role="img"
          aria-label={`${title}. Scroll to zoom and drag to pan.`}
          style={{ touchAction: "none" }}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerDrag}
          onPointerCancel={finishPointerDrag}
          onDoubleClick={() => onViewportChange(DEFAULT_PLOT_VIEWPORT)}
        >
          <title>{title}</title>
          {points.map((point, index) => (
            <circle
              key={`point-${index}`}
              cx={mapX(point.x)}
              cy={mapY(point.y)}
              r="1.25"
              fill="#9fb6c8"
              fillOpacity="0.3"
            />
          ))}
          {vectors.map((vector, index) => {
            const magnitude = Math.hypot(vector.dx, vector.dy);
            const isActive = activeVectorIndex === index;
            if (magnitude < referenceMagnitude * 0.035 && !isActive) return null;
            const startX = mapX(vector.x);
            const startY = mapY(vector.y);
            const scale = Math.min(arrowScale, maxArrowLength / Math.max(magnitude, 1e-9));
            const endX = startX + vector.dx * scale;
            const endY = startY - vector.dy * scale;
            const angle = Math.atan2(endY - startY, endX - startX);
            const headSize = isActive ? 4.2 : 3.4;
            const leftX = endX - headSize * Math.cos(angle - Math.PI / 6);
            const leftY = endY - headSize * Math.sin(angle - Math.PI / 6);
            const rightX = endX - headSize * Math.cos(angle + Math.PI / 6);
            const rightY = endY - headSize * Math.sin(angle + Math.PI / 6);
            const color = isActive ? "#0f172a" : randomized ? "#94a3b8" : "#087ead";
            const strokeWidth = isActive ? 2.25 : 1.35;
            return (
              <g key={`vector-${index}`} opacity={isActive ? "1" : randomized ? "0.58" : "0.78"}>
                {isActive && (
                  <circle cx={startX} cy={startY} r="4.5" fill="white" stroke={color} strokeWidth="1.5" />
                )}
                <line x1={startX} y1={startY} x2={endX} y2={endY} stroke={color} strokeWidth={strokeWidth} />
                <path
                  d={`M ${leftX} ${leftY} L ${endX} ${endY} L ${rightX} ${rightY}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={strokeWidth}
                />
                <line
                  x1={startX}
                  y1={startY}
                  x2={endX}
                  y2={endY}
                  stroke="transparent"
                  strokeWidth="12"
                  className="cursor-pointer"
                  onPointerEnter={() => onHoverVector(index)}
                  onPointerLeave={() => onHoverVector(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTogglePin(index);
                  }}
                />
              </g>
            );
          })}
        </svg>

        {showTooltip && (
          <div
            className="pointer-events-none absolute z-20 w-48 rounded-xl border border-slate-200 bg-white/95 p-3 text-xs shadow-xl shadow-slate-900/15 backdrop-blur"
            style={{
              left: `${tooltipX}%`,
              top: `${tooltipY}%`,
              transform: `translate(${tooltipTranslateX}, ${tooltipTranslateY})`,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="font-bold text-slate-950">Local shift comparison</p>
              {pinnedVectorIndex === activeVectorIndex && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                  Pinned
                </span>
              )}
            </div>
            <dl className="mt-2 space-y-1.5 text-slate-600">
              <div className="flex justify-between gap-3">
                <dt>Predicted</dt>
                <dd className="font-bold text-[#087ead]">{formatScientific(predictedMagnitude)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Randomized</dt>
                <dd className="font-bold text-slate-600">{formatScientific(randomizedMagnitude)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-slate-100 pt-1.5">
                <dt>Ratio</dt>
                <dd className="font-bold text-slate-950">
                  {randomizedMagnitude > 0 ? `${(predictedMagnitude / randomizedMagnitude).toFixed(2)}×` : "—"}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </figure>
  );
}

function ActiveRunCard({ run }: { run: PerturbationRun }) {
  return (
    <div className="rounded-[1.25rem] border border-sky-200 bg-sky-50/80 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-[#087ead]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-950">
            {formatPerturbation(run.gene, run.perturbation_value)} is {run.status.toLowerCase()}
          </p>
          <p className="mt-1 text-sm text-slate-600">{run.progress_label || "Working"}</p>
        </div>
        <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-bold text-sky-700">
          {run.status}
        </span>
      </div>
      {run.status === "Preparing" && (
        <p className="mt-4 border-t border-sky-200 pt-4 text-xs leading-5 text-sky-800">
          The reusable CellOracle perturbation model is being prepared. Later perturbations will skip this one-time stage.
        </p>
      )}
    </div>
  );
}

function PerturbationDownloadPopover({
  projectId,
  result,
  onClose,
}: {
  projectId: string;
  result: PerturbationResult;
  onClose: () => void;
}) {
  const files = [
    {
      label: "Affected genes",
      filename: "affected_genes.csv",
      description: "Per-gene original, simulated, and average expression changes.",
    },
    {
      label: "Cell shifts",
      filename: "cell_shifts.csv",
      description: "Per-cell embedding coordinates and predicted shift vectors.",
    },
    {
      label: "Cluster effects",
      filename: "cluster_effects.csv",
      description: "Top predicted gene-expression changes within each cell cluster.",
    },
    {
      label: "OOD diagnostics",
      filename: "ood_diagnostics.csv",
      description: "Genes outside the modeled expression range and the affected-cell fraction.",
    },
  ].filter((file) => file.filename !== "ood_diagnostics.csv" || result.ood_genes !== undefined);

  return (
    <div
      className="absolute right-0 top-[calc(100%+0.75rem)] z-40 w-[min(28rem,calc(100vw-3rem))] text-slate-900"
      role="dialog"
      aria-modal="false"
      aria-labelledby="perturbation-download-title"
    >
      <span
        aria-hidden="true"
        className="absolute -top-1.5 right-8 z-20 h-3 w-3 rotate-45 border-l border-t border-slate-200 bg-white"
      />
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/20">
        <div className="px-4 pb-3 pt-4">
          <h3 id="perturbation-download-title" className="text-sm font-bold text-slate-950">
            Download perturbation data
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Choose a CSV file from {formatPerturbation(result.gene, result.perturbation_value)}.
          </p>
        </div>

        <div className="border-t border-slate-100 p-2">
          {files.map((file) => (
            <a
              key={file.filename}
              href={`${API_BASE}/projects/${projectId}/perturbations/${result.run_id}/downloads/${file.filename}`}
              download
              onClick={onClose}
              className="group flex items-center justify-between gap-4 rounded-xl px-3 py-3 transition hover:bg-[#f2f9fc]"
            >
              <div>
                <p className="text-sm font-bold text-slate-950 group-hover:text-[#1b75a6]">
                  {file.label}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">{file.description}</p>
              </div>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                CSV
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function PerturbationHistoryStrip({
  runs,
  result,
  loadingRunId,
  onSelect,
}: {
  runs: PerturbationRun[];
  result: PerturbationResult;
  loadingRunId: string | null;
  onSelect: (run: PerturbationRun) => void;
}) {
  return (
    <aside
      className="rounded-[1.1rem] border border-slate-200 bg-white p-4 lg:sticky lg:top-24"
      aria-label="Saved perturbation runs"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-1 lg:block">
        <div>
          <h3 className="text-sm font-bold text-slate-950">Run history</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Select a run to view its results.
          </p>
        </div>
        <p className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500 lg:mt-3 lg:inline-flex">
          {Math.min(runs.length, 8)} saved {runs.length === 1 ? "run" : "runs"}
        </p>
      </div>

      <div className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] lg:flex-col lg:overflow-visible lg:pb-0">
        {runs.slice(0, 8).map((run, index) => {
          const isCompleted = run.status === "Completed";
          const isSelected = result.run_id === run.run_id;
          const isRunLoading = loadingRunId === run.run_id;
          const cardContent = (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className={`text-sm font-bold ${isSelected ? "text-[#087ead]" : "text-slate-950"}`}>
                  {formatPerturbation(run.gene, run.perturbation_value)}
                </p>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                  isSelected
                    ? "border-sky-200 bg-white text-sky-700"
                    : statusClasses(run.status)
                }`}>
                  {isRunLoading ? "Loading…" : isSelected ? "Selected" : run.status}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {run.n_propagation} propagation steps
                {run.elapsed_seconds ? ` · ${formatElapsed(run.elapsed_seconds)}` : ""}
              </p>
              <p className="mt-1 text-[11px] font-semibold text-slate-400">
                {run.completed_at ? formatTimestamp(run.completed_at) : `Run ${index + 1}`}
              </p>
            </>
          );

          return isCompleted ? (
            <button
              key={run.run_id}
              type="button"
              onClick={() => onSelect(run)}
              disabled={Boolean(loadingRunId)}
              aria-pressed={isSelected}
              className={`relative min-w-[16rem] flex-1 snap-start overflow-hidden rounded-xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 disabled:cursor-wait lg:min-w-0 lg:w-full ${
                isSelected
                  ? "border-[#087ead]/35 bg-[#f2f9fc] shadow-sm before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[#087ead]"
                  : "border-slate-200 bg-white hover:border-[#087ead]/25 hover:bg-slate-50"
              }`}
            >
              {cardContent}
            </button>
          ) : (
            <div
              key={run.run_id}
              className="min-w-[16rem] flex-1 snap-start rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 lg:min-w-0 lg:w-full"
            >
              {cardContent}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function SelectedResultHeader({
  result,
  resultScope,
  onScopeChange,
}: {
  result: PerturbationResult;
  resultScope: string;
  onScopeChange: (scope: string) => void;
}) {
  const clusterCounts = new Map<string, number>();
  for (const point of result.embedding_points) {
    clusterCounts.set(point.cluster, (clusterCounts.get(point.cluster) ?? 0) + 1);
  }
  const clusterOptions = (result.cluster_summary ?? [...clusterCounts.keys()].map((cluster) => ({
    cluster,
    cell_count: clusterCounts.get(cluster) ?? 0,
  }))).sort((left, right) => left.cluster.localeCompare(right.cluster, undefined, { numeric: true }));
  const selectedCluster = result.cluster_summary?.find((cluster) => cluster.cluster === resultScope);
  const meanShift = resultScope === "global"
    ? result.mean_shift_magnitude
    : selectedCluster?.mean_shift_magnitude ?? null;
  const meanRandomShift = resultScope === "global"
    ? result.mean_random_shift_magnitude
    : selectedCluster?.mean_random_shift_magnitude ?? null;
  const shiftRatio = meanRandomShift !== null && meanRandomShift > 0
    ? (meanShift ?? 0) / meanRandomShift
    : null;
  const metrics = [
    {
      label: "Mean shift",
      value: meanShift === null ? "—" : formatScientific(meanShift),
    },
    {
      label: "Randomized control",
      value: meanRandomShift === null ? "—" : formatScientific(meanRandomShift),
    },
    {
      label: "Predicted / control",
      value: shiftRatio === null ? "—" : `${shiftRatio.toFixed(2)}×`,
    },
    {
      label: "OOD genes",
      value: resultScope === "global"
        ? result.ood_warning_gene_count.toLocaleString()
        : selectedCluster?.ood_warning_gene_count === null || selectedCluster?.ood_warning_gene_count === undefined
          ? "—"
          : selectedCluster.ood_warning_gene_count.toLocaleString(),
      warning: resultScope === "global"
        ? result.ood_warning_gene_count > 0
        : (selectedCluster?.ood_warning_gene_count ?? 0) > 0,
    },
  ];

  return (
    <div className="rounded-[1.1rem] border border-[#087ead]/20 bg-gradient-to-r from-[#eef8fc] to-white p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#087ead]">
            Selected result
          </p>
          <h3 className="mt-1 text-lg font-bold text-slate-950">
            {formatPerturbation(result.gene, result.perturbation_value)}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {result.n_propagation} propagation steps
            {result.completed_at ? ` · ${formatTimestamp(result.completed_at)}` : ""}
            {result.model_scope === "cluster_specific"
              ? ` · Cluster-specific GRNs${result.cluster_count ? ` (${result.cluster_count} clusters)` : ""}`
              : result.model_scope === "global"
                ? " · Global GRN"
                : ""}
            {resultScope !== "global" ? ` · Showing ${resultScope}` : ""}
          </p>
        </div>
        <label className="relative flex h-10 w-full shrink-0 items-center overflow-hidden rounded-full border border-sky-200 bg-white text-xs font-bold text-slate-700 shadow-sm focus-within:border-[#087ead] focus-within:ring-4 focus-within:ring-[#087ead]/10 sm:w-[15rem]">
          <select
            value={resultScope}
            onChange={(event) => onScopeChange(event.target.value)}
            className="h-full w-full appearance-none bg-transparent px-4 pr-10 outline-none"
            aria-label="Result scope"
          >
            <option value="global">Global</option>
            {clusterOptions.map((cluster) => (
              <option key={cluster.cluster} value={cluster.cluster}>
                {cluster.cluster} ({cluster.cell_count})
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 text-slate-700"><SelectChevron /></span>
        </label>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-[#087ead]/10 pt-4 md:grid-cols-4 md:gap-0 md:divide-x md:divide-[#087ead]/10">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="min-w-0 md:px-5 md:first:pl-0 md:last:pr-0"
          >
            <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
              {metric.label}
            </dt>
            <dd className={`mt-1 text-lg font-bold ${metric.warning ? "text-amber-700" : "text-slate-950"}`}>
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type ClusterSummaryView = {
  cluster: string;
  cell_count: number;
  mean_shift_magnitude: number | null;
  mean_random_shift_magnitude: number | null;
  shift_ratio: number | null;
  ood_warning_gene_count: number | null;
  top_genes: Array<{ gene: string; mean_change: number }>;
};

function ClusterResponseView({
  result,
  clusters,
}: {
  result: PerturbationResult;
  clusters: ClusterSummaryView[];
}) {
  const [selectedCluster, setSelectedCluster] = useState(clusters[0]?.cluster ?? "");
  const [plotViewport, setPlotViewport] = useState<PlotViewport>(DEFAULT_PLOT_VIEWPORT);
  const [hoveredVectorIndex, setHoveredVectorIndex] = useState<number | null>(null);
  const [hoveredVectorPlot, setHoveredVectorPlot] = useState<PlotKind | null>(null);
  const [pinnedVectorIndex, setPinnedVectorIndex] = useState<number | null>(null);
  const [pinnedVectorPlot, setPinnedVectorPlot] = useState<PlotKind | null>(null);

  useEffect(() => {
    if (!clusters.some((cluster) => cluster.cluster === selectedCluster)) {
      setSelectedCluster(clusters[0]?.cluster ?? "");
    }
  }, [clusters, selectedCluster]);

  const selectedSummary = clusters.find((cluster) => cluster.cluster === selectedCluster) ?? clusters[0];
  const selectedPoints = useMemo(
    () => result.embedding_points.filter((point) => point.cluster === selectedSummary?.cluster),
    [result.embedding_points, selectedSummary?.cluster]
  );
  const selectedVectors = useMemo<PlotVector[]>(
    () => selectedPoints
      .filter((point) => [point.shift_x, point.shift_y, point.random_shift_x, point.random_shift_y].every(Number.isFinite))
      .map((point) => ({
        x: point.x,
        y: point.y,
        dx: point.shift_x ?? 0,
        dy: point.shift_y ?? 0,
        random_dx: point.random_shift_x ?? 0,
        random_dy: point.random_shift_y ?? 0,
      })),
    [selectedPoints]
  );
  const clusterGridVectorFields = useMemo(
    () => calculateGridVectorFields(selectedPoints, selectedVectors),
    [selectedPoints, selectedVectors]
  );
  const sharedVectorReferenceMagnitude = useMemo(
    () => Math.max(
      1e-9,
      quantile(
        [...clusterGridVectorFields.predicted, ...clusterGridVectorFields.randomized].map((vector) =>
          Math.hypot(vector.dx, vector.dy)
        ),
        0.85
      )
    ),
    [clusterGridVectorFields]
  );
  const activeVectorIndex = pinnedVectorIndex ?? hoveredVectorIndex;
  const activeVectorPlot = pinnedVectorIndex !== null ? pinnedVectorPlot : hoveredVectorPlot;
  const selectedClusterSummary = selectedSummary;

  const handleVectorHover = (plot: PlotKind, index: number | null) => {
    setHoveredVectorIndex(index);
    setHoveredVectorPlot(index === null ? null : plot);
  };

  const handleVectorPin = (plot: PlotKind, index: number) => {
    if (pinnedVectorIndex === index && pinnedVectorPlot === plot) {
      setPinnedVectorIndex(null);
      setPinnedVectorPlot(null);
      return;
    }
    setPinnedVectorIndex(index);
    setPinnedVectorPlot(plot);
  };

  useEffect(() => {
    setPlotViewport(DEFAULT_PLOT_VIEWPORT);
    setHoveredVectorIndex(null);
    setHoveredVectorPlot(null);
    setPinnedVectorIndex(null);
    setPinnedVectorPlot(null);
  }, [selectedCluster]);

  return (
    <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-950">Response by cluster</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Choose one cluster to inspect its gene response and cell-state shift. The perturbation is applied to every modeled cell, with cluster-specific GRN coefficients used for each group.
          </p>
        </div>
        <label className="block w-full shrink-0 sm:w-56">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Cluster</span>
          <div className="relative flex h-11 items-center overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-[#087ead] focus-within:ring-4 focus-within:ring-[#087ead]/10">
            <select
              value={selectedCluster}
              onChange={(event) => setSelectedCluster(event.target.value)}
              className="h-full w-full appearance-none bg-transparent px-3 pr-10 text-sm font-bold text-slate-900 outline-none"
            >
              {clusters.map((cluster) => (
                <option key={cluster.cluster} value={cluster.cluster}>{cluster.cluster}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 text-slate-700"><SelectChevron /></span>
          </div>
        </label>
      </div>

      {selectedClusterSummary && (
        <div className="mt-4 rounded-xl border border-[#087ead]/15 bg-[#f7fbfd] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-slate-950">{selectedClusterSummary.cluster}</h4>
              <p className="mt-1 text-xs text-slate-500">{selectedClusterSummary.cell_count.toLocaleString()} modeled cells</p>
            </div>
            {selectedClusterSummary.shift_ratio !== null && Number.isFinite(selectedClusterSummary.shift_ratio) && (
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 shadow-sm">
                {selectedClusterSummary.shift_ratio.toFixed(2)}× randomized control
              </span>
            )}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-4 border-t border-[#087ead]/10 pt-3 sm:grid-cols-3">
            <div><dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Mean shift</dt><dd className="mt-1 text-sm font-bold text-slate-950">{selectedClusterSummary.mean_shift_magnitude === null ? "—" : formatScientific(selectedClusterSummary.mean_shift_magnitude)}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Randomized</dt><dd className="mt-1 text-sm font-bold text-slate-700">{selectedClusterSummary.mean_random_shift_magnitude === null ? "—" : formatScientific(selectedClusterSummary.mean_random_shift_magnitude)}</dd></div>
            <div className="col-span-2 sm:col-span-1"><dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Top changes</dt><dd className="mt-1 truncate text-sm font-bold text-slate-950">{selectedClusterSummary.top_genes.slice(0, 3).map((gene) => gene.gene).join(" · ") || "—"}</dd></div>
          </dl>
        </div>
      )}

      {selectedVectors.length > 0 ? (
        <>
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <VectorFieldPlot
              title={`${selectedClusterSummary?.cluster ?? "Cluster"} predicted response`}
              points={selectedPoints}
              vectors={clusterGridVectorFields.predicted}
              comparisonVectors={clusterGridVectorFields.randomized}
              referenceMagnitude={sharedVectorReferenceMagnitude}
              viewport={plotViewport}
              activeVectorIndex={activeVectorPlot === "predicted" ? activeVectorIndex : null}
              pinnedVectorIndex={pinnedVectorPlot === "predicted" ? pinnedVectorIndex : null}
              tooltipVisible={activeVectorPlot === "predicted"}
              onViewportChange={setPlotViewport}
              onHoverVector={(index) => handleVectorHover("predicted", index)}
              onTogglePin={(index) => handleVectorPin("predicted", index)}
            />
            <VectorFieldPlot
              title={`${selectedClusterSummary?.cluster ?? "Cluster"} randomized control`}
              points={selectedPoints}
              vectors={clusterGridVectorFields.randomized}
              comparisonVectors={clusterGridVectorFields.predicted}
              referenceMagnitude={sharedVectorReferenceMagnitude}
              viewport={plotViewport}
              activeVectorIndex={activeVectorPlot === "randomized" ? activeVectorIndex : null}
              pinnedVectorIndex={pinnedVectorPlot === "randomized" ? pinnedVectorIndex : null}
              tooltipVisible={activeVectorPlot === "randomized"}
              onViewportChange={setPlotViewport}
              onHoverVector={(index) => handleVectorHover("randomized", index)}
              onTogglePin={(index) => handleVectorPin("randomized", index)}
              randomized
            />
          </div>
          <p className="mt-4 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
            These panels use only cells from {selectedClusterSummary?.cluster ?? "the selected cluster"}; arrows are density-smoothed with the same scale within this cluster comparison.
          </p>
        </>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          This saved result contains cluster-level gene effects but not per-cell shift coordinates, so cluster-specific diagrams are unavailable. New perturbation runs will include them.
        </p>
      )}
    </section>
  );
}

function ResultSummary({
  projectId,
  result,
  resultScope,
  onRerunWithClipping,
  rerunDisabled,
}: {
  projectId: string;
  result: PerturbationResult;
  resultScope: string;
  onRerunWithClipping: () => void;
  rerunDisabled: boolean;
}) {
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const [hoveredVectorIndex, setHoveredVectorIndex] = useState<number | null>(null);
  const [hoveredVectorPlot, setHoveredVectorPlot] = useState<PlotKind | null>(null);
  const [pinnedVectorIndex, setPinnedVectorIndex] = useState<number | null>(null);
  const [pinnedVectorPlot, setPinnedVectorPlot] = useState<PlotKind | null>(null);
  const [plotViewport, setPlotViewport] = useState<PlotViewport>(DEFAULT_PLOT_VIEWPORT);
  const [expandedPlot, setExpandedPlot] = useState<PlotKind | null>(null);
  const [showAllOodGenes, setShowAllOodGenes] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const globalGridVectorFields = useMemo(
    () => resolveGridVectorFields(result),
    [result]
  );
  const activeVectorIndex = pinnedVectorIndex ?? hoveredVectorIndex;
  const activeVectorPlot = pinnedVectorIndex !== null ? pinnedVectorPlot : hoveredVectorPlot;
  const clusterSummaries = useMemo<ClusterSummaryView[]>(() => {
    const pointCounts = new Map<string, number>();
    for (const point of result.embedding_points) {
      pointCounts.set(point.cluster, (pointCounts.get(point.cluster) ?? 0) + 1);
    }

    if (result.cluster_summary?.length) {
      return [...result.cluster_summary]
        .map((cluster) => ({
          cluster: cluster.cluster,
          cell_count: cluster.cell_count || pointCounts.get(cluster.cluster) || 0,
          mean_shift_magnitude: Number.isFinite(cluster.mean_shift_magnitude)
            ? cluster.mean_shift_magnitude
            : null,
          mean_random_shift_magnitude: Number.isFinite(cluster.mean_random_shift_magnitude)
            ? cluster.mean_random_shift_magnitude
            : null,
          shift_ratio: cluster.shift_ratio === null || cluster.shift_ratio === undefined
            ? null
            : cluster.shift_ratio,
          ood_warning_gene_count: cluster.ood_warning_gene_count ?? null,
          top_genes: cluster.top_genes ?? [],
        }))
        .sort((left, right) => left.cluster.localeCompare(right.cluster, undefined, { numeric: true }));
    }

    const grouped = new Map<string, Array<{ gene: string; mean_change: number }>>();
    for (const effect of result.cluster_effects) {
      const genes = grouped.get(effect.cluster) ?? [];
      genes.push({ gene: effect.gene, mean_change: effect.mean_change });
      grouped.set(effect.cluster, genes);
    }
    return [...grouped.entries()]
      .map(([cluster, genes]) => ({
        cluster,
        cell_count: pointCounts.get(cluster) ?? 0,
        mean_shift_magnitude: null,
        mean_random_shift_magnitude: null,
        shift_ratio: null,
        ood_warning_gene_count: null,
        top_genes: genes
          .sort((left, right) => Math.abs(right.mean_change) - Math.abs(left.mean_change))
          .slice(0, 5),
      }))
      .sort((left, right) => left.cluster.localeCompare(right.cluster, undefined, { numeric: true }));
  }, [result]);
  const selectedClusterSummary = resultScope === "global"
    ? null
    : clusterSummaries.find((cluster) => cluster.cluster === resultScope) ?? null;
  const selectedClusterPoints = useMemo(
    () => selectedClusterSummary
      ? result.embedding_points.filter((point) => point.cluster === selectedClusterSummary.cluster)
      : [],
    [result.embedding_points, selectedClusterSummary?.cluster]
  );
  const selectedClusterVectors = useMemo<PlotVector[]>(
    () => selectedClusterPoints
      .filter((point) => [point.shift_x, point.shift_y, point.random_shift_x, point.random_shift_y].every(Number.isFinite))
      .map((point) => ({
        x: point.x,
        y: point.y,
        dx: point.shift_x ?? 0,
        dy: point.shift_y ?? 0,
        random_dx: point.random_shift_x ?? 0,
        random_dy: point.random_shift_y ?? 0,
      })),
    [selectedClusterPoints]
  );
  const selectedClusterGridVectorFields = useMemo(
    () => calculateGridVectorFields(selectedClusterPoints, selectedClusterVectors),
    [selectedClusterPoints, selectedClusterVectors]
  );
  const isClusterScope = resultScope !== "global";
  const displayPoints = isClusterScope ? selectedClusterPoints : result.embedding_points;
  const gridVectorFields = isClusterScope ? selectedClusterGridVectorFields : globalGridVectorFields;
  const sharedVectorReferenceMagnitude = useMemo(
    () => Math.max(
      1e-9,
      quantile(
        [...gridVectorFields.predicted, ...gridVectorFields.randomized].map((vector) =>
          Math.hypot(vector.dx, vector.dy)
        ),
        0.85
      )
    ),
    [gridVectorFields]
  );
  const rankedChangedGenes = isClusterScope
    ? (result.cluster_effects ?? [])
      .filter((row) => row.cluster === resultScope && Math.abs(row.mean_change) > DISPLAY_CHANGE_EPSILON)
      .sort((left, right) => Math.abs(right.mean_change) - Math.abs(left.mean_change))
      .slice(0, 15)
      .map((row) => ({
        gene: row.gene,
        mean_change: row.mean_change,
        mean_absolute_change: Math.abs(row.mean_change),
      }))
    : result.top_affected_genes
      .filter((row) => row.mean_absolute_change > DISPLAY_CHANGE_EPSILON)
      .slice(0, 15);
  const oodGenes = result.ood_genes ?? [];
  const visibleOodGenes = showAllOodGenes ? oodGenes : oodGenes.slice(0, 5);

  const handleVectorHover = (plot: PlotKind, index: number | null) => {
    setHoveredVectorIndex(index);
    setHoveredVectorPlot(index === null ? null : plot);
  };

  const handleVectorPin = (plot: PlotKind, index: number) => {
    if (pinnedVectorIndex === index && pinnedVectorPlot === plot) {
      setPinnedVectorIndex(null);
      setPinnedVectorPlot(null);
      return;
    }
    setPinnedVectorIndex(index);
    setPinnedVectorPlot(plot);
  };

  useEffect(() => {
    if (!expandedPlot) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedPlot(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [expandedPlot]);

  useEffect(() => {
    if (!isDownloadDialogOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !downloadMenuRef.current?.contains(target)) {
        setIsDownloadDialogOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDownloadDialogOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDownloadDialogOpen]);

  return (
    <div className="space-y-5">
      {!isClusterScope && result.ood_warning_gene_count > 0 && (
        <section className="rounded-[1.1rem] border border-amber-200/90 bg-gradient-to-r from-amber-50/90 to-white p-4 text-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
                  <path d="M10 3.2 17 16H3L10 3.2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="M10 7.4v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <circle cx="10" cy="14" r=".9" fill="currentColor" />
                </svg>
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-950">
                  {result.ood_warning_gene_count.toLocaleString()} predicted {result.ood_warning_gene_count === 1 ? "gene exceeds" : "genes exceed"} the observed range
                </h3>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
                  Interpret cautiously, or rerun with clipping to constrain shifts to the observed expression range.
                </p>
              </div>
            </div>
            {!result.clip_delta_x && (
              <button
                type="button"
                onClick={onRerunWithClipping}
                disabled={rerunDisabled}
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl bg-amber-800 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Rerun with clipping
              </button>
            )}
          </div>
          {oodGenes.length ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-amber-200/80 bg-white/75">
              <div className="hidden grid-cols-[minmax(0,1fr)_minmax(10rem,0.75fr)_minmax(12rem,0.9fr)] bg-amber-50/70 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 sm:grid">
                <span className="px-3 py-2">Gene</span>
                <span className="border-l border-amber-100 px-3 py-2">Affected cells</span>
                <span className="border-l border-amber-100 px-3 py-2">Largest exceedance</span>
              </div>
              <div className={showAllOodGenes ? "max-h-72 overflow-y-auto" : ""}>
                {visibleOodGenes.map((row) => (
                  <div
                    key={row.gene}
                    className="grid gap-2 border-t border-amber-100 px-3 py-2.5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.75fr)_minmax(12rem,0.9fr)] sm:gap-0 sm:px-0 sm:py-0 sm:first:border-t"
                  >
                    <span className="truncate text-sm font-bold text-slate-950 sm:px-3 sm:py-2.5">
                      {row.gene}
                    </span>
                    <span className="flex items-center justify-between text-xs text-slate-600 sm:block sm:border-l sm:border-amber-100 sm:px-3 sm:py-2.5">
                      <span className="sm:hidden">Affected cells</span>
                      <strong className="text-slate-900">{(row.ood_cell_ratio * 100).toFixed(1)}%</strong>
                    </span>
                    <span className="flex items-center justify-between text-xs text-slate-600 sm:block sm:border-l sm:border-amber-100 sm:px-3 sm:py-2.5">
                      <span className="sm:hidden">Largest exceedance</span>
                      <strong className="text-slate-900">{(row.max_exceeding_ratio * 100).toFixed(1)}% beyond range</strong>
                    </span>
                  </div>
                ))}
              </div>
              {oodGenes.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllOodGenes((current) => !current)}
                  className="flex w-full items-center justify-center border-t border-amber-100 bg-white px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-50"
                  aria-expanded={showAllOodGenes}
                >
                  {showAllOodGenes ? "Show highest 5 only" : `Show all ${oodGenes.length} OOD genes`}
                </button>
              )}
            </div>
          ) : (
            <p className="mt-3 border-t border-amber-100 pt-3 text-xs leading-5 text-slate-500">
              This saved run predates gene-level OOD diagnostics. Its count is available, but the affected gene names were not stored.
            </p>
          )}
        </section>
      )}

      <div className="rounded-[1.25rem] border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-950">
            Genes ranked by predicted change{isClusterScope ? ` · ${resultScope}` : ""}
          </h3>
          <div ref={downloadMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsDownloadDialogOpen((current) => !current)}
              aria-expanded={isDownloadDialogOpen}
              aria-haspopup="dialog"
              className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-[#087ead]/30 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10"
            >
              Download data
            </button>
            {isDownloadDialogOpen && (
              <PerturbationDownloadPopover
                projectId={projectId}
                result={result}
                onClose={() => setIsDownloadDialogOpen(false)}
              />
            )}
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                <th className="px-3 py-3 font-bold">Rank</th>
                <th className="px-3 py-3 font-bold">Gene</th>
                <th className="px-3 py-3 text-right font-bold">Mean change</th>
                <th className="px-3 py-3 text-right font-bold">Mean absolute change</th>
              </tr>
            </thead>
            <tbody>
              {rankedChangedGenes.map((row, index) => (
                <tr key={`${row.gene}-${index}`} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-3 text-slate-500">{index + 1}</td>
                  <td className="px-3 py-3 font-bold text-slate-950">{row.gene}</td>
                  <td className={`px-3 py-3 text-right font-semibold ${row.mean_change < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                    {row.mean_change > 0 ? "+" : ""}{formatScientific(row.mean_change)}
                  </td>
                  <td className="px-3 py-3 text-right text-slate-700">
                    {formatScientific(row.mean_absolute_change)}
                  </td>
                </tr>
              ))}
              {rankedChangedGenes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                    No measurable gene-expression changes were predicted.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-950">Cell-state shift</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Compare the predicted response to {formatPerturbation(result.gene, result.perturbation_value)} with a randomized-network control.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-4">
            <div className="flex items-center gap-4 text-xs font-semibold text-slate-500" aria-label="Plot legend">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#9fb6c8]" aria-hidden="true" />
                Cells
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-base font-bold text-[#087ead]" aria-hidden="true">→</span>
                Average local shift
              </span>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <VectorFieldPlot
            title={isClusterScope ? `${resultScope} predicted response` : "Predicted response"}
            points={displayPoints}
            vectors={gridVectorFields.predicted}
            comparisonVectors={gridVectorFields.randomized}
            referenceMagnitude={sharedVectorReferenceMagnitude}
            viewport={plotViewport}
            activeVectorIndex={activeVectorIndex}
            pinnedVectorIndex={pinnedVectorPlot === "predicted" ? pinnedVectorIndex : null}
            tooltipVisible={activeVectorPlot === "predicted"}
            onViewportChange={setPlotViewport}
            onHoverVector={(index) => handleVectorHover("predicted", index)}
            onTogglePin={(index) => handleVectorPin("predicted", index)}
            onExpand={() => setExpandedPlot("predicted")}
          />
          <VectorFieldPlot
            title={isClusterScope ? `${resultScope} randomized control` : "Randomized control"}
            points={displayPoints}
            vectors={gridVectorFields.randomized}
            comparisonVectors={gridVectorFields.predicted}
            referenceMagnitude={sharedVectorReferenceMagnitude}
            viewport={plotViewport}
            activeVectorIndex={activeVectorIndex}
            pinnedVectorIndex={pinnedVectorPlot === "randomized" ? pinnedVectorIndex : null}
            tooltipVisible={activeVectorPlot === "randomized"}
            onViewportChange={setPlotViewport}
            onHoverVector={(index) => handleVectorHover("randomized", index)}
            onTogglePin={(index) => handleVectorPin("randomized", index)}
            onExpand={() => setExpandedPlot("randomized")}
            randomized
          />
        </div>

        <p className="mt-4 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
          Arrows use CellOracle&apos;s density-smoothed grid field. Both panels remain synchronized and use the same arrow scale. The predicted/control ratio is descriptive and is not a significance test.
        </p>
      </section>

      {expandedPlot && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm animate-modal-overlay"
          onClick={() => setExpandedPlot(null)}
          role="presentation"
        >
          <div
            className="max-h-[94vh] w-[min(92vw,1100px)] overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl shadow-slate-950/25 animate-modal-panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={expandedPlot === "predicted" ? "Expanded predicted response" : "Expanded randomized control"}
          >
            <VectorFieldPlot
              title={expandedPlot === "predicted"
                ? (isClusterScope ? `${resultScope} predicted response` : "Predicted response")
                : (isClusterScope ? `${resultScope} randomized control` : "Randomized control")}
              points={displayPoints}
              vectors={expandedPlot === "predicted" ? gridVectorFields.predicted : gridVectorFields.randomized}
              comparisonVectors={expandedPlot === "predicted" ? gridVectorFields.randomized : gridVectorFields.predicted}
              referenceMagnitude={sharedVectorReferenceMagnitude}
              viewport={plotViewport}
              activeVectorIndex={activeVectorPlot === expandedPlot ? activeVectorIndex : null}
              pinnedVectorIndex={pinnedVectorPlot === expandedPlot ? pinnedVectorIndex : null}
              tooltipVisible={activeVectorPlot === expandedPlot}
              onViewportChange={setPlotViewport}
              onHoverVector={(index) => handleVectorHover(expandedPlot, index)}
              onTogglePin={(index) => handleVectorPin(expandedPlot, index)}
              onExpand={() => setExpandedPlot(null)}
              isExpanded
              randomized={expandedPlot === "randomized"}
            />
          </div>
        </div>
      )}

    </div>
  );
}

export default function PerturbationAnalysisSection({
  projectId,
  cellOracleStatus,
  initialGene,
}: PerturbationAnalysisSectionProps) {
  const [state, setState] = useState<PerturbationState | null>(null);
  const [selectedGene, setSelectedGene] = useState("");
  const [expressionProfile, setExpressionProfile] = useState<GeneExpressionProfile | null>(null);
  const [isExpressionProfileLoading, setIsExpressionProfileLoading] = useState(false);
  const [perturbationValue, setPerturbationValue] = useState("0");
  const [nPropagation, setNPropagation] = useState(3);
  const [clipDeltaX, setClipDeltaX] = useState(false);
  const [selectedResult, setSelectedResult] = useState<PerturbationResult | null>(null);
  const [resultScope, setResultScope] = useState("global");
  const [loadingHistoryRunId, setLoadingHistoryRunId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLDivElement | null>(null);
  const resultViewRef = useRef<HTMLDivElement | null>(null);

  const loadState = useCallback(async () => {
    try {
      const response = await apiFetch(`${API_BASE}/projects/${projectId}/perturbations`);
      if (!response.ok) return;
      const payload = await response.json();
      const nextState = payload.perturbations as PerturbationState;
      setState(nextState);
      setSelectedGene((current) =>
        current && nextState.eligible_genes.includes(current)
          ? current
          : nextState.eligible_genes[0] ?? ""
      );
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setSelectedResult(null);
    setLoadingHistoryRunId(null);
  }, [projectId]);

  useEffect(() => {
    loadState();
  }, [loadState, cellOracleStatus]);

  useEffect(() => {
    if (!initialGene || !state?.eligible_genes.includes(initialGene)) return;
    setSelectedGene(initialGene);
    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [initialGene, state?.eligible_genes]);

  useEffect(() => {
    if (!selectedGene) {
      setExpressionProfile(null);
      return;
    }
    const controller = new AbortController();
    setIsExpressionProfileLoading(true);
    setExpressionProfile(null);
    void apiFetch(
      `${API_BASE}/projects/${projectId}/perturbations/expression-profile/${encodeURIComponent(selectedGene)}`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.json();
        return payload.profile as GeneExpressionProfile;
      })
      .then((profile) => {
        if (!controller.signal.aborted && profile) setExpressionProfile(profile);
      })
      .catch((profileError) => {
        if (profileError instanceof DOMException && profileError.name === "AbortError") return;
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsExpressionProfileLoading(false);
      });
    return () => controller.abort();
  }, [projectId, selectedGene]);

  const activeRun = useMemo(
    () => state?.runs.find((run) => ACTIVE_STATUSES.has(run.status)) ?? null,
    [state]
  );
  const displayedResult = selectedResult ?? state?.latest_result ?? null;

  useEffect(() => {
    setResultScope("global");
  }, [displayedResult?.run_id]);

  useEffect(() => {
    if (!activeRun) return;
    const timer = window.setInterval(loadState, 5000);
    return () => window.clearInterval(timer);
  }, [activeRun, loadState]);

  const submitPerturbation = async ({
    gene,
    value,
    propagation,
    clip,
  }: {
    gene: string;
    value: number;
    propagation: number;
    clip: boolean;
  }) => {
    if (!gene || isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    try {
      const response = await apiFetch(`${API_BASE}/projects/${projectId}/perturbations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gene,
          perturbation_value: value,
          n_propagation: propagation,
          clip_delta_x: clip,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || "The perturbation could not be started.");
      }
      setSelectedResult(null);
      await loadState();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "The perturbation could not be started.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRun = () => {
    if (!selectedGene || isSubmitting) return;
    const numericPerturbationValue = Number(perturbationValue);
    if (
      perturbationValue.trim() === "" ||
      !Number.isFinite(numericPerturbationValue) ||
      numericPerturbationValue < 0
    ) {
      setError("Enter a non-negative target expression value. Use 0 for a knockout.");
      return;
    }
    if (
      expressionProfile &&
      numericPerturbationValue > expressionProfile.safe_upper_limit
    ) {
      setError(
        `Target expression must be between 0 and ${formatScientific(expressionProfile.safe_upper_limit)} for ${selectedGene}.`
      );
      return;
    }
    void submitPerturbation({
      gene: selectedGene,
      value: numericPerturbationValue,
      propagation: nPropagation,
      clip: clipDeltaX,
    });
  };

  const handleRerunWithClipping = (result: PerturbationResult) => {
    setSelectedGene(result.gene);
    setPerturbationValue(String(result.perturbation_value));
    setNPropagation(result.n_propagation);
    setClipDeltaX(true);
    void submitPerturbation({
      gene: result.gene,
      value: result.perturbation_value,
      propagation: result.n_propagation,
      clip: true,
    });
  };

  const handleSelectHistoryRun = async (run: PerturbationRun) => {
    if (run.status !== "Completed" || loadingHistoryRunId) return;

    const revealResult = () => {
      window.requestAnimationFrame(() => {
        resultViewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    if (state?.latest_result?.run_id === run.run_id) {
      setSelectedResult(null);
      revealResult();
      return;
    }

    setLoadingHistoryRunId(run.run_id);
    setError("");
    try {
      const response = await apiFetch(
        `${API_BASE}/projects/${projectId}/perturbations/${run.run_id}`
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.result) {
        throw new Error(payload.detail || "The saved perturbation result could not be loaded.");
      }
      setSelectedResult(payload.result as PerturbationResult);
      revealResult();
    } catch (selectionError) {
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : "The saved perturbation result could not be loaded."
      );
    } finally {
      setLoadingHistoryRunId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-[1.25rem] border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">
        Loading CellOracle perturbation tools…
      </div>
    );
  }

  if (!state?.available) {
    return (
      <div className="rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
        <h3 className="text-lg font-bold text-slate-950">CellOracle perturbation is not available yet</h3>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          {state?.reason || "A completed CellOracle network is required."}
        </p>
      </div>
    );
  }

  const failedRun = state.runs[0]?.status === "Failed" ? state.runs[0] : null;
  const numericPerturbationValue = Number(perturbationValue);
  const isNonnegativePerturbationValue =
    perturbationValue.trim() !== "" &&
    Number.isFinite(numericPerturbationValue) &&
    numericPerturbationValue >= 0;
  const targetExceedsSafeLimit = Boolean(
    isNonnegativePerturbationValue &&
    expressionProfile &&
    numericPerturbationValue > expressionProfile.safe_upper_limit
  );
  const isPerturbationValueValid =
    isNonnegativePerturbationValue && !targetExceedsSafeLimit;
  const targetAboveObservedRange = Boolean(
    isNonnegativePerturbationValue &&
    expressionProfile &&
    !targetExceedsSafeLimit &&
    numericPerturbationValue > expressionProfile.maximum
  );
  const maxHistogramCount = Math.max(
    1,
    ...(expressionProfile?.histogram.map((bin) => bin.count) ?? [1])
  );

  return (
    <section className="space-y-5" aria-label="CellOracle perturbation analysis">
      <div ref={formRef} className="rounded-[1.25rem] border border-slate-200 bg-white p-5">
        <div className="max-w-4xl">
          <h2 className="text-lg font-bold text-slate-950">Run a CellOracle perturbation</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Choose a regulator and set its non-negative target expression across modeled cells—0 simulates a knockout.
          </p>
        </div>

        <div className="mt-6 grid gap-x-4 gap-y-5 md:grid-cols-2 xl:grid-cols-[minmax(240px,360px)_220px_240px]">
          <label className="block min-w-0">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Regulator</span>
            <div className="relative flex h-12 w-full items-center overflow-hidden rounded-xl border border-slate-200 bg-white transition focus-within:border-[#087ead] focus-within:ring-4 focus-within:ring-[#087ead]/10">
              <select
                value={selectedGene}
                onChange={(event) => setSelectedGene(event.target.value)}
                className="h-full w-full appearance-none bg-transparent px-4 pr-11 text-sm font-semibold text-slate-900 outline-none"
              >
                {state.eligible_genes.map((gene) => (
                  <option key={gene} value={gene}>{gene}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3.5 text-slate-700">
                <SelectChevron />
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-slate-500">
              {state.eligible_genes.length} network regulators available. Genes without inferred outgoing GRN edges are not perturbable.
            </p>
          </label>

          <label className="block min-w-0">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              Target expression
            </span>
            <div
              className={`flex h-12 w-full items-center rounded-xl border bg-white transition focus-within:border-[#087ead] focus-within:ring-4 focus-within:ring-[#087ead]/10 ${
                !isPerturbationValueValid
                  ? "border-rose-300"
                  : targetAboveObservedRange
                    ? "border-amber-300"
                    : "border-slate-200"
              }`}
            >
              <input
                type="number"
                min="0"
                max={expressionProfile?.safe_upper_limit}
                step="any"
                inputMode="decimal"
                value={perturbationValue}
                onChange={(event) => setPerturbationValue(event.target.value)}
                aria-invalid={!isPerturbationValueValid}
                className="h-full min-w-0 flex-1 bg-transparent px-4 text-sm font-semibold text-slate-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              {isPerturbationValueValid && numericPerturbationValue === 0 && (
                <span className="mr-3 shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                  Knockout
                </span>
              )}
            </div>
            {isExpressionProfileLoading ? (
              <p className="mt-2 text-[11px] font-semibold text-slate-400">Loading observed range…</p>
            ) : expressionProfile ? (
              <div className="mt-2">
                <div className="flex h-5 items-end gap-px" aria-hidden="true">
                  {expressionProfile.histogram.map((bin, index) => (
                    <span
                      key={`${bin.start}-${index}`}
                      className={`min-w-0 flex-1 rounded-t-sm ${targetExceedsSafeLimit ? "bg-rose-300" : targetAboveObservedRange ? "bg-amber-300" : "bg-sky-200"}`}
                      style={{ height: `${Math.max(2, (bin.count / maxHistogramCount) * 20)}px` }}
                    />
                  ))}
                </div>
                <p className={`mt-1 text-[11px] leading-4 ${targetExceedsSafeLimit ? "font-semibold text-rose-700" : targetAboveObservedRange ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                  Observed {formatScientific(expressionProfile.minimum)}–{formatScientific(expressionProfile.maximum)} · median {formatScientific(expressionProfile.median)} · {(expressionProfile.nonzero_fraction * 100).toFixed(0)}% nonzero
                  {targetExceedsSafeLimit
                    ? ` · maximum allowed is ${formatScientific(expressionProfile.safe_upper_limit)}`
                    : targetAboveObservedRange
                      ? ` · extrapolated; limit ${formatScientific(expressionProfile.safe_upper_limit)}`
                      : ` · limit ${formatScientific(expressionProfile.safe_upper_limit)}`}
                </p>
              </div>
            ) : null}
          </label>

          <label className="block min-w-0 md:col-span-2 xl:col-span-1">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Propagation steps</span>
            <div className="relative flex h-12 w-full items-center overflow-hidden rounded-xl border border-slate-200 bg-white transition focus-within:border-[#087ead] focus-within:ring-4 focus-within:ring-[#087ead]/10">
              <select
                value={nPropagation}
                onChange={(event) => setNPropagation(Number(event.target.value))}
                className="h-full w-full appearance-none bg-transparent px-4 pr-11 text-sm font-semibold text-slate-900 outline-none"
              >
                {PROPAGATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3.5 text-slate-700">
                <SelectChevron />
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-slate-500">
              3 is recommended. This is propagation depth, not biological time; steps 4–5 may add noise.
            </p>
          </label>
        </div>

        <div className="mt-5 flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex cursor-pointer items-start gap-3 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={clipDeltaX}
              onChange={(event) => setClipDeltaX(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#087ead]"
            />
            <span>
              Clip predictions to the observed expression range
            </span>
          </label>

          <button
            type="button"
            onClick={handleRun}
            disabled={!selectedGene || !isPerturbationValueValid || isExpressionProfileLoading || Boolean(activeRun) || isSubmitting}
            className="h-12 w-full shrink-0 rounded-xl bg-[#087ead] px-6 text-sm font-bold text-white shadow-sm transition hover:bg-[#066b94] disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto sm:min-w-[240px]"
          >
            {activeRun ? "Perturbation running" : isSubmitting ? "Starting…" : `Run ${selectedGene || "gene"} perturbation`}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700">
          {error}
        </div>
      )}
      {activeRun && <ActiveRunCard run={activeRun} />}
      {!activeRun && failedRun?.error_message && failedRun.run_id !== state.latest_result?.run_id && (
        <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50 p-5 text-rose-700">
          <p className="text-sm font-bold">The latest perturbation failed</p>
          <p className="mt-2 text-sm leading-6">{failedRun.error_message}</p>
        </div>
      )}

      {displayedResult ? (
        <div ref={resultViewRef} className="scroll-mt-24">
          <div className="mb-4 px-1">
            <h2 className="text-lg font-bold text-slate-950">Perturbation results</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Review the selected run or switch to a previous result.
            </p>
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
            <PerturbationHistoryStrip
              runs={state.runs}
              result={displayedResult}
              loadingRunId={loadingHistoryRunId}
              onSelect={(run) => void handleSelectHistoryRun(run)}
            />
            <div className="min-w-0 space-y-4">
              <SelectedResultHeader
                result={displayedResult}
                resultScope={resultScope}
                onScopeChange={setResultScope}
              />
              <ResultSummary
                key={displayedResult.run_id}
                projectId={projectId}
                result={displayedResult}
                resultScope={resultScope}
                onRerunWithClipping={() => handleRerunWithClipping(displayedResult)}
                rerunDisabled={Boolean(activeRun) || isSubmitting}
              />
            </div>
          </div>
        </div>
      ) : !activeRun ? (
        <div className="rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
          <h3 className="text-base font-bold text-slate-950">No perturbation results yet</h3>
          <p className="mt-2 text-sm text-slate-600">Select an eligible regulator and target expression value above to run a perturbation.</p>
        </div>
      ) : null}

    </section>
  );
}
