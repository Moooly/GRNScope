"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import { API_BASE } from "../../../_lib/apiConfig";
import { apiFetch } from "../../../_lib/clientIdentity";
import type {
  GeneExpressionDistribution,
  GeneExpressionProfile,
  PerturbationResult,
  PerturbationRun,
  PerturbationState,
} from "../_lib/types";
import {
  DOWNLOAD_BUTTON_CLASS,
  DownloadIcon,
} from "./DownloadMenu";
import { RESULT_SECTION_HEADING_CLASS } from "./sectionStyles";


const ACTIVE_STATUSES = new Set(["Queued", "Preparing", "Running"]);
const PLOT_WIDTH = 520;
const PLOT_HEIGHT = 330;
const PLOT_PADDING = 24;
const FIGURE_WIDTH = 1600;
const FIGURE_HEIGHT = 700;
const FIGURE_SCALE = 2;
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
type NormalizedPlotViewport = { x: number; y: number; width: number; height: number };
type PlotKind = "predicted" | "randomized";
type SafariGestureEvent = Event & {
  clientX: number;
  clientY: number;
  scale: number;
};

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

function formatPValue(value: number) {
  if (!Number.isFinite(value)) return "Unavailable";
  if (value < 0.0001) return "< 0.0001";
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function formatPerturbation(gene: string, value: number) {
  return value === 0
    ? `${gene} knockout`
    : `${gene} set to ${formatScientific(value)}`;
}

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "figure";
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cleanPlotSvgContents(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelector("title")?.remove();
  clone.querySelectorAll("[data-export-ignore]").forEach((node) => node.remove());
  clone.querySelectorAll<SVGGElement>("[data-vector]").forEach((group) => {
    const color = group.dataset.exportColor ?? "#087ead";
    const opacity = group.dataset.exportOpacity ?? "0.78";
    const strokeWidth = group.dataset.exportStrokeWidth ?? "1.35";
    group.setAttribute("opacity", opacity);
    group.querySelectorAll<SVGElement>("line, path").forEach((element) => {
      element.setAttribute("stroke", color);
      element.setAttribute("stroke-width", strokeWidth);
    });
  });
  return clone.innerHTML;
}

function buildComparisonFigureSvg({
  predictedSvg,
  randomizedSvg,
  predictedTitle,
  randomizedTitle,
  subtitle,
}: {
  predictedSvg: SVGSVGElement;
  randomizedSvg: SVGSVGElement;
  predictedTitle: string;
  randomizedTitle: string;
  subtitle: string;
}) {
  const predictedViewBox = predictedSvg.getAttribute("viewBox") ?? `0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`;
  const randomizedViewBox = randomizedSvg.getAttribute("viewBox") ?? `0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`;
  const predictedContents = cleanPlotSvgContents(predictedSvg);
  const randomizedContents = cleanPlotSvgContents(randomizedSvg);
  const panelWidth = 740;
  const panelHeight = 470;
  const leftX = 40;
  const rightX = 820;
  const panelY = 158;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${FIGURE_WIDTH}" height="${FIGURE_HEIGHT}" viewBox="0 0 ${FIGURE_WIDTH} ${FIGURE_HEIGHT}" role="img" aria-label="Cell-state shift comparison">
  <rect width="${FIGURE_WIDTH}" height="${FIGURE_HEIGHT}" fill="#ffffff"/>
  <text x="40" y="46" fill="#0f172a" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700">Cell-state shift</text>
  <text x="40" y="76" fill="#64748b" font-family="Arial, Helvetica, sans-serif" font-size="16">${escapeXml(subtitle)}</text>
  <g transform="translate(1130 40)" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="600" fill="#64748b">
    <circle cx="5" cy="31" r="5" fill="#9fb6c8"/><text x="18" y="36">Cells</text>
    <line x1="94" y1="31" x2="124" y2="31" stroke="#087ead" stroke-width="2"/>
    <path d="M 116 25 L 124 31 L 116 37" fill="none" stroke="#087ead" stroke-width="2"/>
    <text x="136" y="36">Average local shift</text>
  </g>
  <text x="${leftX}" y="137" fill="#0f172a" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">${escapeXml(predictedTitle)}</text>
  <text x="${rightX}" y="137" fill="#0f172a" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">${escapeXml(randomizedTitle)}</text>
  <rect x="${leftX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="18" fill="#f7fbff" stroke="#e2e8f0" stroke-width="2"/>
  <rect x="${rightX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="18" fill="#f7fbff" stroke="#e2e8f0" stroke-width="2"/>
  <svg x="${leftX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" viewBox="${escapeXml(predictedViewBox)}" preserveAspectRatio="xMidYMid meet" overflow="hidden">${predictedContents}</svg>
  <svg x="${rightX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" viewBox="${escapeXml(randomizedViewBox)}" preserveAspectRatio="xMidYMid meet" overflow="hidden">${randomizedContents}</svg>
  <line x1="40" y1="658" x2="1560" y2="658" stroke="#e2e8f0"/>
  <text x="40" y="682" fill="#64748b" font-family="Arial, Helvetica, sans-serif" font-size="13">Current synchronized view · CellOracle density-smoothed grid field · Shared arrow scale</text>
</svg>`;
}

function buildDevelopmentFigureSvg({
  panels,
  title,
  limit,
}: {
  panels: Array<{ svg: SVGSVGElement; title: string }>;
  title: string;
  limit: number;
}) {
  const panelWidth = panels.length === 1 ? 1080 : 740;
  const panelHeight = 490;
  const panelY = 130;
  const panelXs = panels.length === 1 ? [260] : [40, 820];
  const panelMarkup = panels.map(({ svg, title }, index) => {
    const viewBox = svg.getAttribute("viewBox") ?? "0 0 480 330";
    const x = panelXs[index];
    return `
  <text x="${x}" y="111" fill="#0f172a" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">${escapeXml(title)}</text>
  <rect x="${x}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="18" fill="#f7fbff" stroke="#e2e8f0" stroke-width="2"/>
  <svg x="${x}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" viewBox="${escapeXml(viewBox)}" preserveAspectRatio="xMidYMid meet" overflow="hidden">${cleanPlotSvgContents(svg)}</svg>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${FIGURE_WIDTH}" height="${FIGURE_HEIGHT}" viewBox="0 0 ${FIGURE_WIDTH} ${FIGURE_HEIGHT}" role="img" aria-label="Development impact comparison">
  <defs>
    <linearGradient id="development-alignment-scale" x1="0" x2="1">
      <stop offset="0" stop-color="rgb(226,75,74)"/>
      <stop offset="0.5" stop-color="rgb(226,232,240)"/>
      <stop offset="1" stop-color="rgb(22,163,120)"/>
    </linearGradient>
  </defs>
  <rect width="${FIGURE_WIDTH}" height="${FIGURE_HEIGHT}" fill="#ffffff"/>
  <text x="40" y="54" fill="#0f172a" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700">${escapeXml(title)}</text>
  <g transform="translate(1200 32)" font-family="Arial, Helvetica, sans-serif">
    <text x="0" y="14" fill="#64748b" font-size="13" font-weight="700">Blocks</text>
    <text x="130" y="14" fill="#64748b" font-size="13" font-weight="700" text-anchor="middle">Neutral</text>
    <text x="260" y="14" fill="#64748b" font-size="13" font-weight="700" text-anchor="end">Promotes</text>
    <rect x="0" y="23" width="260" height="10" rx="5" fill="url(#development-alignment-scale)"/>
    <text x="0" y="52" fill="#94a3b8" font-size="12">${escapeXml(formatScoreLimit(-limit))}</text>
    <text x="130" y="52" fill="#94a3b8" font-size="12" text-anchor="middle">0</text>
    <text x="260" y="52" fill="#94a3b8" font-size="12" text-anchor="end">${escapeXml(formatScoreLimit(limit))}</text>
  </g>${panelMarkup}
  <text x="40" y="666" fill="#64748b" font-family="Arial, Helvetica, sans-serif" font-size="13">Color shows the inner product of perturbation and developmental flow.</text>
</svg>`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function svgToPngBlob(svgMarkup: string) {
  return new Promise<Blob>((resolve, reject) => {
    const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = FIGURE_WIDTH * FIGURE_SCALE;
        canvas.height = FIGURE_HEIGHT * FIGURE_SCALE;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas is unavailable.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error("PNG export failed."));
        }, "image/png");
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The exported SVG could not be rendered as PNG."));
    };
    image.src = url;
  });
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

function zoomViewportAtPoint(
  viewport: PlotViewport,
  factor: number,
  pointerX: number,
  pointerY: number
): PlotViewport {
  const nextWidth = clamp(viewport.width * factor, PLOT_WIDTH * 0.36, PLOT_WIDTH);
  const nextHeight = nextWidth * (PLOT_HEIGHT / PLOT_WIDTH);
  const worldX = viewport.x + pointerX * viewport.width;
  const worldY = viewport.y + pointerY * viewport.height;
  return {
    x: clamp(worldX - pointerX * nextWidth, 0, PLOT_WIDTH - nextWidth),
    y: clamp(worldY - pointerY * nextHeight, 0, PLOT_HEIGHT - nextHeight),
    width: nextWidth,
    height: nextHeight,
  };
}

const DEFAULT_NORMALIZED_VIEWPORT: NormalizedPlotViewport = { x: 0, y: 0, width: 1, height: 1 };

function zoomNormalizedViewportAtPoint(
  viewport: NormalizedPlotViewport,
  factor: number,
  pointerX: number,
  pointerY: number,
): NormalizedPlotViewport {
  const nextWidth = clamp(viewport.width * factor, 0.36, 1);
  const nextHeight = nextWidth;
  const worldX = viewport.x + pointerX * viewport.width;
  const worldY = viewport.y + pointerY * viewport.height;
  return {
    x: clamp(worldX - pointerX * nextWidth, 0, 1 - nextWidth),
    y: clamp(worldY - pointerY * nextHeight, 0, 1 - nextHeight),
    width: nextWidth,
    height: nextHeight,
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
  svgRef,
  randomized = false,
  clusterColors,
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
  svgRef?: RefObject<SVGSVGElement | null>;
  randomized?: boolean;
  clusterColors?: Map<string, string> | null;
}) {
  const localSvgRef = useRef<SVGSVGElement | null>(null);
  const viewportRef = useRef(viewport);
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    viewport: PlotViewport;
  } | null>(null);
  const gestureStartViewportRef = useRef<PlotViewport | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

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

  const setSvgElement = useCallback((node: SVGSVGElement | null) => {
    localSvgRef.current = node;
    if (svgRef) svgRef.current = node;
  }, [svgRef]);

  useEffect(() => {
    const svg = localSvgRef.current;
    if (!svg) return;

    const pointerPosition = (clientX: number, clientY: number) => {
      const bounds = svg.getBoundingClientRect();
      return {
        x: clamp((clientX - bounds.left) / bounds.width, 0, 1),
        y: clamp((clientY - bounds.top) / bounds.height, 0, 1),
      };
    };
    const updateViewport = (nextViewport: PlotViewport) => {
      viewportRef.current = nextViewport;
      onViewportChange(nextViewport);
    };
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const pointer = pointerPosition(event.clientX, event.clientY);
      const pixelDelta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * 16
        : event.deltaY;
      const factor = Math.exp(clamp(pixelDelta, -120, 120) * 0.008);
      updateViewport(zoomViewportAtPoint(viewportRef.current, factor, pointer.x, pointer.y));
    };
    const handleGestureStart = (event: Event) => {
      event.preventDefault();
      gestureStartViewportRef.current = viewportRef.current;
    };
    const handleGestureChange = (event: Event) => {
      event.preventDefault();
      const gestureEvent = event as SafariGestureEvent;
      const startViewport = gestureStartViewportRef.current ?? viewportRef.current;
      const pointer = pointerPosition(gestureEvent.clientX, gestureEvent.clientY);
      const scale = Number.isFinite(gestureEvent.scale) && gestureEvent.scale > 0
        ? gestureEvent.scale
        : 1;
      updateViewport(zoomViewportAtPoint(startViewport, 1 / scale, pointer.x, pointer.y));
    };
    const handleGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureStartViewportRef.current = null;
    };

    svg.addEventListener("wheel", handleWheel, { passive: false });
    svg.addEventListener("gesturestart", handleGestureStart, { passive: false });
    svg.addEventListener("gesturechange", handleGestureChange, { passive: false });
    svg.addEventListener("gestureend", handleGestureEnd, { passive: false });
    return () => {
      svg.removeEventListener("wheel", handleWheel);
      svg.removeEventListener("gesturestart", handleGestureStart);
      svg.removeEventListener("gesturechange", handleGestureChange);
      svg.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [onViewportChange]);

  const canPan = viewport.width < PLOT_WIDTH - 0.01;
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!canPan || event.button !== 0 || event.pointerType !== "mouse") return;
    event.preventDefault();
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
        <svg
          ref={setSvgElement}
          viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
          className={`h-auto w-full rounded-xl border border-slate-100 bg-[#f7fbff] ${canPan ? isDragging ? "cursor-grabbing" : "cursor-grab" : ""}`}
          role="img"
          aria-label={`${title}. Pinch to zoom. When zoomed in, drag with a mouse to pan.`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerDrag}
          onPointerCancel={finishPointerDrag}
        >
          <title>{title}</title>
          {points.map((point, index) => {
            const fill = clusterColors?.get(point.cluster) ?? "#9fb6c8";
            return (
              <circle
                key={`point-${index}`}
                cx={mapX(point.x)}
                cy={mapY(point.y)}
                r="1.25"
                fill={fill}
                fillOpacity={clusterColors ? 0.55 : 0.3}
              />
            );
          })}
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
              <g
                key={`vector-${index}`}
                opacity={isActive ? "1" : randomized ? "0.58" : "0.78"}
                data-vector
                data-export-color={randomized ? "#94a3b8" : "#087ead"}
                data-export-opacity={randomized ? "0.58" : "0.78"}
                data-export-stroke-width="1.35"
              >
                {isActive && (
                  <circle data-export-ignore cx={startX} cy={startY} r="4.5" fill="white" stroke={color} strokeWidth="1.5" />
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
                  data-export-ignore
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

function PlotZoomControls({
  viewport,
  onViewportChange,
  connected = false,
}: {
  viewport: PlotViewport;
  onViewportChange: (viewport: PlotViewport) => void;
  connected?: boolean;
}) {
  const isFullyZoomedOut = viewport.width >= PLOT_WIDTH - 0.01;
  const isFullyZoomedIn = viewport.width <= PLOT_WIDTH * 0.36 + 0.01;
  return (
    <div
      className={connected
        ? "inline-flex h-full"
        : "inline-flex h-10 overflow-hidden rounded-full border border-slate-200 bg-white"}
      aria-label="Shared plot zoom"
    >
      <button
        type="button"
        onClick={() => onViewportChange(zoomViewportAtPoint(viewport, 1.2, 0.5, 0.5))}
        disabled={isFullyZoomedOut}
        className="inline-flex w-10 items-center justify-center border-r border-slate-200 text-base font-bold text-slate-700 transition hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-white disabled:hover:text-slate-600"
        aria-label="Zoom out both plots"
        title="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        onClick={() => onViewportChange(zoomViewportAtPoint(viewport, 0.84, 0.5, 0.5))}
        disabled={isFullyZoomedIn}
        className={`inline-flex w-10 items-center justify-center text-base font-bold text-slate-700 transition hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-white disabled:hover:text-slate-600 ${connected ? "border-r border-slate-200" : ""}`}
        aria-label="Zoom in both plots"
        title="Zoom in"
      >
        +
      </button>
    </div>
  );
}

function ExpandComparisonButton({
  onClick,
  connected = false,
}: {
  onClick: () => void;
  connected?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Expand comparison"
      title="Expand comparison"
      className={connected
        ? "inline-flex h-full w-10 items-center justify-center bg-white text-slate-700 transition hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10"
        : "inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-[#087ead]/30 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10"}
    >
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
        <path d="M7 3.5H3.5V7M13 3.5h3.5V7M7 16.5H3.5V13M13 16.5h3.5V13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function FigureExportMenu({
  menuRef,
  isOpen,
  isExporting,
  error,
  onToggle,
  onExport,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  isOpen: boolean;
  isExporting: boolean;
  error: string | null;
  onToggle: () => void;
  onExport: (format: "svg" | "png") => void;
}) {
  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        disabled={isExporting}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className={DOWNLOAD_BUTTON_CLASS}
      >
        <DownloadIcon />
        {isExporting ? "Preparing…" : "Download"}
        <svg
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {isOpen && (
        <div
          role="menu"
          aria-label="Figure export formats"
          className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/20"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => onExport("svg")}
            className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-3 text-left transition hover:bg-[#f2f9fc]"
          >
            <span>
              <span className="block text-sm font-bold text-slate-950">Vector figure</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">Best for papers and editing.</span>
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">SVG</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onExport("png")}
            className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-3 text-left transition hover:bg-[#f2f9fc]"
          >
            <span>
              <span className="block text-sm font-bold text-slate-950">High-resolution image</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">Best for slides and documents.</span>
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">PNG</span>
          </button>
          {error && (
            <p className="mx-2 mb-1 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] leading-4 text-rose-700" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
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
      description: "Per-cell predicted and randomized shifts, including their distance.",
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
      aria-label="Download perturbation data"
    >
      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/20">
        <div className="p-2">
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
  embedded = false,
}: {
  runs: PerturbationRun[];
  result: PerturbationResult | null;
  loadingRunId: string | null;
  onSelect: (run: PerturbationRun) => void;
  embedded?: boolean;
}) {
  return (
    <aside
      className={
        embedded
          ? "min-w-0"
          : "min-w-0 rounded-[1.1rem] border border-slate-200 bg-white p-4 lg:sticky lg:top-24"
      }
      aria-label="Saved perturbation runs"
    >
      {!embedded && (
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
      )}

      <div className={`flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] lg:flex-col lg:overflow-visible lg:pb-0 ${embedded ? "" : "mt-3"}`}>
        {runs.slice(0, 8).map((run, index) => {
          const isCompleted = run.status === "Completed";
          const isSelected = result?.run_id === run.run_id;
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

function PerturbationRunActions({
  runCount,
  onOpenHistory,
  onOpenNewRun,
  historyExpanded,
  newRunExpanded,
}: {
  runCount: number;
  onOpenHistory: () => void;
  onOpenNewRun: () => void;
  historyExpanded: boolean;
  newRunExpanded: boolean;
}) {
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <button
        type="button"
        onClick={onOpenHistory}
        aria-expanded={historyExpanded}
        aria-controls="perturbation-side-panel"
        aria-label={`Open run history, ${runCount} saved ${runCount === 1 ? "run" : "runs"}`}
        className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 sm:flex-none ${
          historyExpanded
            ? "border-[#087ead]/30 bg-[#f2f9fc] text-[#087ead]"
            : "border-slate-200 bg-white text-slate-700 hover:border-[#087ead]/30 hover:bg-[#f2f9fc] hover:text-[#087ead]"
        }`}
      >
        <svg viewBox="0 0 18 18" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="M9 4.5V9l3 1.75M15 9a6 6 0 1 1-1.76-4.24" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.25 2.75v2.5h2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>History</span>
        <span
          aria-hidden="true"
          className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500"
        >
          {runCount}
        </span>
      </button>
      <button
        type="button"
        onClick={onOpenNewRun}
        aria-expanded={newRunExpanded}
        aria-controls="perturbation-side-panel"
        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[#087ead] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#066b94] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/20 sm:flex-none"
      >
        <svg viewBox="0 0 18 18" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="M9 4v10M4 9h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        New run
      </button>
    </div>
  );
}

function SelectedResultHeader({
  result,
  resultScope,
  onScopeChange,
  onRerunWithClipping,
  rerunDisabled,
  runCount,
  onOpenHistory,
  onOpenNewRun,
  historyExpanded,
  newRunExpanded,
}: {
  result: PerturbationResult;
  resultScope: string;
  onScopeChange: (scope: string) => void;
  onRerunWithClipping: () => void;
  rerunDisabled: boolean;
  runCount: number;
  onOpenHistory: () => void;
  onOpenNewRun: () => void;
  historyExpanded: boolean;
  newRunExpanded: boolean;
}) {
  const [showAllOodGenes, setShowAllOodGenes] = useState(false);
  const [isOodDetailsOpen, setIsOodDetailsOpen] = useState(false);
  const oodDetailsRef = useRef<HTMLDivElement | null>(null);
  const oodMetricButtonRef = useRef<HTMLButtonElement | null>(null);
  const oodGenes = result.ood_genes ?? [];
  const visibleOodGenes = showAllOodGenes ? oodGenes : oodGenes.slice(0, 5);

  useEffect(() => {
    if (!isOodDetailsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (oodDetailsRef.current?.contains(target)) return;
      if (oodMetricButtonRef.current?.contains(target)) return;
      setIsOodDetailsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOodDetailsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOodDetailsOpen]);
  const clusterCounts = new Map<string, number>();
  for (const point of result.embedding_points) {
    clusterCounts.set(point.cluster, (clusterCounts.get(point.cluster) ?? 0) + 1);
  }
  const clusterOptions = (result.cluster_summary ?? [...clusterCounts.keys()].map((cluster) => ({
    cluster,
    cell_count: clusterCounts.get(cluster) ?? 0,
  }))).sort((left, right) => left.cluster.localeCompare(right.cluster, undefined, { numeric: true }));
  // Only offer the Global/per-cluster scope picker when a cluster annotation was
  // actually uploaded (i.e. there is more than one cluster to choose between).
  const hasSelectableClusters = clusterOptions.length > 1;
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
  const perturbationScore = resultScope === "global"
    ? result.perturbation_score ?? null
    : selectedCluster?.perturbation_score ?? null;
  const perturbationScorePValue = resultScope === "global"
    ? result.perturbation_score_p_value ?? null
    : selectedCluster?.perturbation_score_p_value ?? null;
  const perturbationScoreUnavailableReason = resultScope === "global"
    ? result.perturbation_score_unavailable_reason
    : selectedCluster?.perturbation_score_unavailable_reason;
  const perturbationScoreAvailable = perturbationScore !== null;
  const oodWarningCount = resultScope === "global"
    ? result.ood_warning_gene_count
    : selectedCluster?.ood_warning_gene_count ?? null;
  const metrics = [
    {
      label: "Predicted / control",
      value: shiftRatio === null ? "—" : `${shiftRatio.toFixed(2)}×`,
      primary: true,
    },
    {
      label: "Perturbation score",
      value: perturbationScore === null ? "—" : formatScientific(perturbationScore),
      primary: true,
    },
    {
      label: "PS p-value",
      value: perturbationScorePValue === null ? "—" : formatPValue(perturbationScorePValue),
      primary: true,
    },
    {
      label: "Mean shift",
      value: meanShift === null ? "—" : formatScientific(meanShift),
    },
    {
      label: "Randomized control",
      value: meanRandomShift === null ? "—" : formatScientific(meanRandomShift),
    },
    {
      label: "OOD warning",
      value: oodWarningCount === null
        ? "—"
        : `${oodWarningCount.toLocaleString()} ${oodWarningCount === 1 ? "gene" : "genes"}`,
      warning: (oodWarningCount ?? 0) > 0,
    },
  ];

  const perturbationValue = result.perturbation_value.toLocaleString(undefined, {
    maximumFractionDigits: 3,
  });

  return (
    <div>
      <div className="border-b border-slate-100 pb-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-slate-950 sm:text-[1.7rem]">
                {result.gene} <span className="px-0.5 font-semibold text-[#087ead]">→</span> {perturbationValue}
              </h2>
              {result.clip_delta_x ? (
                <span className="rounded-full bg-[#eef8f5] px-2.5 py-1 text-[11px] font-semibold text-[#217a68]">
                  Range clipped
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:flex-nowrap lg:justify-end">
            {hasSelectableClusters ? (
              <>
                <label className="block w-full shrink-0 sm:w-[9.5rem]">
                  <span className="relative flex h-10 w-full items-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 transition focus-within:border-[#087ead] focus-within:ring-4 focus-within:ring-[#087ead]/10">
                    <select
                      value={resultScope}
                      onChange={(event) => {
                        setIsOodDetailsOpen(false);
                        setShowAllOodGenes(false);
                        onScopeChange(event.target.value);
                      }}
                      className="h-full w-full appearance-none bg-transparent pl-3.5 pr-9 outline-none"
                      aria-label="Analysis scope"
                    >
                      <option value="global">Global</option>
                      {clusterOptions.map((cluster) => (
                        <option key={cluster.cluster} value={cluster.cluster}>
                          {cluster.cluster} ({cluster.cell_count.toLocaleString()})
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 text-slate-600"><SelectChevron /></span>
                  </span>
                </label>

                <span className="hidden h-5 w-px shrink-0 bg-slate-200 lg:block" aria-hidden="true" />
              </>
            ) : null}

            <PerturbationRunActions
              runCount={runCount}
              onOpenHistory={onOpenHistory}
              onOpenNewRun={onOpenNewRun}
              historyExpanded={historyExpanded}
              newRunExpanded={newRunExpanded}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric) => {
          const isWarning = "warning" in metric && metric.warning;
          const isPrimary = "primary" in metric && metric.primary;
          const isOodMetric = metric.label === "OOD warning";
          const canInspectOod = isOodMetric && resultScope === "global" && result.ood_warning_gene_count > 0;
          const cardContent = (
            <>
              <span className={`text-[10px] font-bold uppercase leading-4 tracking-[0.12em] ${isPrimary ? "text-[#087ead]" : "text-slate-500"}`}>
                {metric.label}
              </span>
              <span className={`mt-auto flex items-center gap-1.5 pt-2 font-extrabold ${isPrimary ? "text-2xl text-slate-950" : "text-xl"} ${isWarning ? "text-amber-700" : "text-slate-950"}`}>
                {metric.value}
              </span>
            </>
          );

          if (canInspectOod) {
            return (
              <div key={metric.label} className="relative">
                <button
                  ref={oodMetricButtonRef}
                  type="button"
                  onClick={() => setIsOodDetailsOpen((current) => !current)}
                  aria-expanded={isOodDetailsOpen}
                  aria-haspopup="dialog"
                  aria-label={`View details for ${metric.value} outside the observed range`}
                  className="flex h-full min-h-[84px] w-full cursor-pointer flex-col rounded-xl border border-amber-200/70 bg-amber-50/70 p-3 text-left transition hover:bg-amber-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-500/15"
                >
                  {cardContent}
                </button>
                {isOodDetailsOpen ? (
                  <div
                    ref={oodDetailsRef}
                    role="dialog"
                    aria-modal="false"
                    aria-label="Out-of-distribution gene details"
                    className="absolute right-0 top-[calc(100%+0.75rem)] z-50 w-[min(26rem,calc(100vw-3rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_-18px_rgba(15,23,42,0.3)]"
                  >
                    <div className="px-4 pb-3 pt-4">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-600" aria-hidden="true">
                          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                            <path d="M10 3.2 17 16H3L10 3.2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                            <path d="M10 7.4v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            <circle cx="10" cy="14" r=".9" fill="currentColor" />
                          </svg>
                        </span>
                        <h3 className="text-sm font-semibold text-slate-950">Out-of-distribution genes</h3>
                        <span className="ml-auto rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-700">
                          {result.ood_warning_gene_count.toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        Predictions beyond the observed expression range should be interpreted cautiously.
                      </p>
                    </div>

                    {oodGenes.length ? (
                      <div className={`border-y border-slate-100 ${showAllOodGenes ? "max-h-72 overflow-y-auto" : ""}`}>
                        {visibleOodGenes.map((row) => (
                          <div
                            key={row.gene}
                            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-3 first:border-t-0"
                          >
                            <p className="text-sm font-semibold text-slate-950">{row.gene}</p>
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                              <span>{(row.ood_cell_ratio * 100).toFixed(1)}% cells affected</span>
                              <span aria-hidden="true" className="text-slate-300">·</span>
                              <span>{(row.max_exceeding_ratio * 100).toFixed(1)}% beyond range</span>
                            </p>
                          </div>
                        ))}
                        {oodGenes.length > 5 ? (
                          <button
                            type="button"
                            onClick={() => setShowAllOodGenes((current) => !current)}
                            className="flex w-full items-center justify-center border-t border-slate-100 px-4 py-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-[#087ead]"
                            aria-expanded={showAllOodGenes}
                          >
                            {showAllOodGenes ? "Show highest 5 only" : `Show all ${oodGenes.length} genes`}
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <p className="border-y border-slate-100 px-4 py-3 text-xs leading-5 text-slate-500">
                        This saved run includes the count, but its gene-level diagnostics were not stored.
                      </p>
                    )}

                    {!result.clip_delta_x ? (
                      <div className="flex justify-end px-4 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            setIsOodDetailsOpen(false);
                            onRerunWithClipping();
                          }}
                          disabled={rerunDisabled}
                          className="inline-flex h-9 items-center justify-center rounded-full bg-slate-800 px-4 text-xs font-semibold text-white transition hover:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Rerun with clipping
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          }

          return (
            <div
              key={metric.label}
              className={`flex min-h-[84px] flex-col rounded-xl border p-3 ${
                isWarning
                  ? "border-amber-200/70 bg-amber-50/70"
                  : "border-transparent bg-[#f8fafc]"
              }`}
            >
              {cardContent}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] leading-4 text-slate-500">
        {perturbationScoreAvailable
          ? `Compared with randomized GRN${result.pseudotime_trajectory ? ` · ${result.pseudotime_trajectory}` : ""}`
          : `Perturbation score and p-value unavailable · ${perturbationScoreUnavailableReason ?? "Upload pseudotime and rerun to calculate them."}`}
      </p>

    </div>
  );
}

type ClusterSummaryView = {
  cluster: string;
  cell_count: number;
  mean_shift_magnitude: number | null;
  mean_random_shift_magnitude: number | null;
  shift_ratio: number | null;
  perturbation_score: number | null;
  perturbation_score_p_value: number | null;
  perturbation_score_unavailable_reason?: string | null;
  ood_warning_gene_count: number | null;
  top_genes: Array<{ gene: string; mean_change: number }>;
};

// --- Shared projection for the development-direction panels -----------------
// The development-flow quiver, the perturbation quiver and the promotes/blocks
// overlay are all drawn on the SAME grid + cell embedding, so they share one
// bounding box and one aspect-preserving projector. Preserving aspect ratio keeps
// arrow angles honest (independent x/y scaling would shear them). The bounds
// include the cell embedding so every cell is visible as a background dot.
type DevBounds = { minX: number; maxX: number; minY: number; maxY: number };
type DevProjector = ReturnType<typeof makeDevProjector>;
type XY = { x: number; y: number };
type Arrow = { x: number; y: number; dx: number; dy: number };
type ScorePoint = { x: number; y: number; score: number };

const DEV_PLOT_LONG = 480; // long-axis viewBox length in SVG units
const DEV_MARGIN_FRAC = 0.05; // breathing room around the data, as a fraction
// CellOracle draws every arrow of its 40x40 mass-filtered grid, so this is only a
// safety cap for pathologically dense grids — a normal mass-filtered field
// (~300-500 arrows) renders in full, at CellOracle's native density.
const DEV_ARROW_TARGET = 900;
const DEV_CELL_TARGET = 2600; // cap on background cell dots for performance

const DEV_NEUTRAL_RGB = [226, 232, 240] as const; // slate-200, the zero color
const DEV_GREEN_RGB = [22, 163, 120] as const; // promotes
const DEV_RED_RGB = [226, 75, 74] as const; // blocks

function computeDevBounds(points: Array<XY>): DevBounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, maxX, minY, maxY };
}

function mergeDevBounds(...parts: Array<DevBounds | null>): DevBounds | null {
  let out: DevBounds | null = null;
  for (const part of parts) {
    if (!part) continue;
    out = out
      ? {
          minX: Math.min(out.minX, part.minX),
          maxX: Math.max(out.maxX, part.maxX),
          minY: Math.min(out.minY, part.minY),
          maxY: Math.max(out.maxY, part.maxY),
        }
      : part;
  }
  return out;
}

function makeDevProjector(bounds: DevBounds) {
  const rawW = Math.max(1e-9, bounds.maxX - bounds.minX);
  const rawH = Math.max(1e-9, bounds.maxY - bounds.minY);
  const margin = Math.max(rawW, rawH) * DEV_MARGIN_FRAC;
  const minX = bounds.minX - margin;
  const minY = bounds.minY - margin;
  const dataW = rawW + margin * 2;
  const dataH = rawH + margin * 2;
  // viewBox matches the data aspect ratio -> a single uniform scale, no shear,
  // and no letterboxing when the SVG is rendered with w-full h-auto.
  const vbW = dataW >= dataH ? DEV_PLOT_LONG : DEV_PLOT_LONG * (dataW / dataH);
  const vbH = dataH >= dataW ? DEV_PLOT_LONG : DEV_PLOT_LONG * (dataH / dataW);
  const scale = DEV_PLOT_LONG / Math.max(dataW, dataH);
  const mapX = (value: number) => (value - minX) * scale;
  const mapY = (value: number) => vbH - (value - minY) * scale; // invert data-y
  return { mapX, mapY, vbW, vbH, scale, span: Math.min(vbW, vbH) };
}

// Sorted unique values, collapsing coordinates within `tol` (grid coords are
// regular but carry float noise). Used to recover the lattice step.
function uniqueSorted(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    if (out.length === 0 || Math.abs(value - out[out.length - 1]) > tol) out.push(value);
  }
  return out;
}

function medianSpacing(sortedUnique: number[]): number | null {
  if (sortedUnique.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < sortedUnique.length; i += 1) diffs.push(sortedUnique[i] - sortedUnique[i - 1]);
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || null;
}

// Recover the regular grid step (data units) in x and y, so tiles can be sized
// to actually tile instead of guessing from a point count.
function gridSpacing(points: Array<XY>): { sx: number; sy: number } | null {
  if (points.length < 4) return null;
  const bounds = computeDevBounds(points);
  if (!bounds) return null;
  const tolX = Math.max(1e-9, (bounds.maxX - bounds.minX) / 2000);
  const tolY = Math.max(1e-9, (bounds.maxY - bounds.minY) / 2000);
  const sx = medianSpacing(uniqueSorted(points.map((p) => p.x), tolX));
  const sy = medianSpacing(uniqueSorted(points.map((p) => p.y), tolY));
  if (!sx || !sy) return null;
  return { sx, sy };
}

// Thin a lattice of arrows down toward `target` by keeping every k-th grid line
// in both axes, so what remains is still an even field (not a random subset).
function thinLatticeArrows(vectors: Array<Arrow>, target: number): Array<Arrow> {
  if (vectors.length <= target) return vectors;
  const spacing = gridSpacing(vectors);
  if (!spacing) {
    const stride = Math.ceil(vectors.length / target);
    return vectors.filter((_, index) => index % stride === 0);
  }
  const bounds = computeDevBounds(vectors);
  if (!bounds) return vectors;
  const step = Math.max(1, Math.round(Math.sqrt(vectors.length / target)));
  return vectors.filter((vector) => {
    const col = Math.round((vector.x - bounds.minX) / spacing.sx);
    const row = Math.round((vector.y - bounds.minY) / spacing.sy);
    return col % step === 0 && row % step === 0;
  });
}

function subsampleCells<T extends XY>(points: Array<T>, max: number): Array<T> {
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / max);
  return points.filter((_, index) => index % stride === 0);
}

// Deterministic categorical palette for cluster coloring, assigned by sorted
// cluster label so a cluster always keeps its color. Deliberately avoids
// saturated red and green so cluster hues never rhyme with the promotes (green)
// / blocks (red) diverging scale used on the perturbation-alignment map.
const CLUSTER_PALETTE = [
  "#4E79A7", "#F28E2B", "#B07AA1", "#76B7B2", "#EDC948", "#9C755F", "#5B8FB0", "#FFBE7D", "#D4A6C8", "#86BCB6",
  "#B6992D", "#79706E", "#D37295", "#8CD0E8", "#C7A5CE", "#BAB0AC", "#9D8CC7", "#E8A752", "#7FB0C4", "#B5926A",
];

type CellPoint = { x: number; y: number; cluster?: string };

// Cluster -> color map from the sorted labels (numeric-aware so "2" precedes
// "10"). Returns null when there is nothing to distinguish (0 or 1 cluster), so
// the manifold stays neutral gray.
function buildClusterColorMap(points: Array<CellPoint>): Map<string, string> | null {
  const labels = new Set<string>();
  for (const point of points) {
    if (point.cluster != null && point.cluster !== "") labels.add(point.cluster);
  }
  if (labels.size < 2) return null;
  const sorted = [...labels].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const map = new Map<string, string>();
  sorted.forEach((label, index) => map.set(label, CLUSTER_PALETTE[index % CLUSTER_PALETTE.length]));
  return map;
}

// Continuous, zero-centred diverging color: red (blocks) -> neutral (~0) -> green
// (promotes). `absLimit` is a robust symmetric limit so one outlier can't wash
// out the scale. Alpha ramps with magnitude so near-zero tiles stay faint and let
// the cell manifold show through.
function divergingScoreColor(score: number, absLimit: number): string {
  const t = clamp(score / absLimit, -1, 1);
  const mag = Math.abs(t);
  const target = t >= 0 ? DEV_GREEN_RGB : DEV_RED_RGB;
  const r = Math.round(DEV_NEUTRAL_RGB[0] + (target[0] - DEV_NEUTRAL_RGB[0]) * mag);
  const g = Math.round(DEV_NEUTRAL_RGB[1] + (target[1] - DEV_NEUTRAL_RGB[1]) * mag);
  const b = Math.round(DEV_NEUTRAL_RGB[2] + (target[2] - DEV_NEUTRAL_RGB[2]) * mag);
  const alpha = 0.22 + 0.7 * mag;
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

function robustScoreLimit(grid: Array<ScorePoint>): number {
  if (grid.length === 0) return 1e-9;
  return Math.max(1e-9, quantile(grid.map((point) => Math.abs(point.score)), 0.98));
}

// Faint cell embedding so the arrows and tiles sit on the real manifold (and a
// detached island can be confirmed to actually contain cells).
function renderCellPoints(cells: Array<CellPoint>, proj: DevProjector, clusterColors?: Map<string, string> | null) {
  const r = Math.max(0.8, proj.span * 0.0034);
  const colored = clusterColors != null;
  return cells.map((cell, index) => {
    const fill = colored && cell.cluster != null ? clusterColors.get(cell.cluster) ?? "#cbd5e1" : "#cbd5e1";
    return (
      <circle key={`c${index}`} cx={proj.mapX(cell.x)} cy={proj.mapY(cell.y)} r={r} fill={fill} opacity={colored ? 0.62 : 0.5} />
    );
  });
}

// Score tiles sized from the true grid spacing (no rounded corners / gaps, which
// otherwise read as a checkerboard). A hair of overlap kills anti-alias seams.
function renderScoreTiles(grid: Array<ScorePoint>, proj: DevProjector, absLimit: number) {
  const spacing = gridSpacing(grid);
  const fallback = proj.span / Math.max(6, Math.sqrt(grid.length));
  const w = Math.max(2, (spacing ? spacing.sx * proj.scale : fallback)) * 1.03;
  const h = Math.max(2, (spacing ? spacing.sy * proj.scale : fallback)) * 1.03;
  return grid.map((point, index) => (
    <rect
      key={`t${index}`}
      x={proj.mapX(point.x) - w / 2}
      y={proj.mapY(point.y) - h / 2}
      width={w}
      height={h}
      fill={divergingScoreColor(point.score, absLimit)}
      shapeRendering="crispEdges"
    />
  ));
}

// Neutral arrows (charcoal) so hue is reserved exclusively for the signed score.
// `onColor` lightens them slightly for contrast over the colored tiles.
function renderFlowArrows(vectors: Array<Arrow>, proj: DevProjector, onColor = false) {
  // Render the full CellOracle grid (only thinned if pathologically dense), and
  // keep every non-zero arrow — CellOracle draws all grid points, short ones
  // included — so the field matches its native quiver density.
  const drawn = thinLatticeArrows(vectors, DEV_ARROW_TARGET);
  const magnitudes = drawn.map((vector) => Math.hypot(vector.dx, vector.dy));
  const referenceMagnitude = Math.max(1e-9, quantile(magnitudes, 0.9));
  const arrowScale = (proj.span * 0.042) / referenceMagnitude;
  const maxArrowLength = proj.span * 0.058;
  const stroke = onColor ? "#1e293b" : "#334155"; // slate-800 / slate-700
  const strokeWidth = 1.05;
  const opacity = onColor ? 0.85 : 0.8;
  const headSize = 2.9;
  return drawn.map((vector, index) => {
    const magnitude = Math.hypot(vector.dx, vector.dy);
    if (magnitude < 1e-9) return null;
    const startX = proj.mapX(vector.x);
    const startY = proj.mapY(vector.y);
    const length = Math.min(magnitude * arrowScale, maxArrowLength);
    const unitX = vector.dx / magnitude;
    const unitY = -vector.dy / magnitude; // screen y is inverted vs data y
    const endX = startX + unitX * length;
    const endY = startY + unitY * length;
    const angle = Math.atan2(endY - startY, endX - startX);
    return (
      <g key={`a${index}`} stroke={stroke} strokeWidth={strokeWidth} opacity={opacity} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <line x1={startX} y1={startY} x2={endX} y2={endY} />
        <path
          d={`M ${endX - headSize * Math.cos(angle - Math.PI / 6)} ${endY - headSize * Math.sin(angle - Math.PI / 6)} L ${endX} ${endY} L ${endX - headSize * Math.cos(angle + Math.PI / 6)} ${endY - headSize * Math.sin(angle + Math.PI / 6)}`}
        />
      </g>
    );
  });
}

const DEV_SVG_CLASS = "h-auto w-full rounded-xl border border-slate-100 bg-[#f7fbff]";

function InteractiveDevelopmentSvg({
  proj,
  viewport,
  onViewportChange,
  svgRef,
  label,
  children,
}: {
  proj: DevProjector;
  viewport: NormalizedPlotViewport;
  onViewportChange: (viewport: NormalizedPlotViewport) => void;
  svgRef?: RefObject<SVGSVGElement | null>;
  label: string;
  children: ReactNode;
}) {
  const localSvgRef = useRef<SVGSVGElement | null>(null);
  const viewportRef = useRef(viewport);
  const gestureStartViewportRef = useRef<NormalizedPlotViewport | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    viewport: NormalizedPlotViewport;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const setSvgElement = useCallback((node: SVGSVGElement | null) => {
    localSvgRef.current = node;
    if (svgRef) svgRef.current = node;
  }, [svgRef]);

  useEffect(() => {
    const svg = localSvgRef.current;
    if (!svg) return;
    const pointerPosition = (clientX: number, clientY: number) => {
      const bounds = svg.getBoundingClientRect();
      return {
        x: clamp((clientX - bounds.left) / bounds.width, 0, 1),
        y: clamp((clientY - bounds.top) / bounds.height, 0, 1),
      };
    };
    const updateViewport = (nextViewport: NormalizedPlotViewport) => {
      viewportRef.current = nextViewport;
      onViewportChange(nextViewport);
    };
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const pointer = pointerPosition(event.clientX, event.clientY);
      const pixelDelta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      const factor = Math.exp(clamp(pixelDelta, -120, 120) * 0.008);
      updateViewport(zoomNormalizedViewportAtPoint(viewportRef.current, factor, pointer.x, pointer.y));
    };
    const handleGestureStart = (event: Event) => {
      event.preventDefault();
      gestureStartViewportRef.current = viewportRef.current;
    };
    const handleGestureChange = (event: Event) => {
      event.preventDefault();
      const gestureEvent = event as SafariGestureEvent;
      const startViewport = gestureStartViewportRef.current ?? viewportRef.current;
      const pointer = pointerPosition(gestureEvent.clientX, gestureEvent.clientY);
      const scale = Number.isFinite(gestureEvent.scale) && gestureEvent.scale > 0 ? gestureEvent.scale : 1;
      updateViewport(zoomNormalizedViewportAtPoint(startViewport, 1 / scale, pointer.x, pointer.y));
    };
    const handleGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureStartViewportRef.current = null;
    };

    svg.addEventListener("wheel", handleWheel, { passive: false });
    svg.addEventListener("gesturestart", handleGestureStart, { passive: false });
    svg.addEventListener("gesturechange", handleGestureChange, { passive: false });
    svg.addEventListener("gestureend", handleGestureEnd, { passive: false });
    return () => {
      svg.removeEventListener("wheel", handleWheel);
      svg.removeEventListener("gesturestart", handleGestureStart);
      svg.removeEventListener("gesturechange", handleGestureChange);
      svg.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [onViewportChange]);

  const canPan = viewport.width < 0.999;
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!canPan || event.button !== 0 || event.pointerType !== "mouse") return;
    event.preventDefault();
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
      x: clamp(drag.viewport.x - deltaX, 0, 1 - drag.viewport.width),
      y: clamp(drag.viewport.y - deltaY, 0, 1 - drag.viewport.height),
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
    <svg
      ref={setSvgElement}
      viewBox={`${viewport.x * proj.vbW} ${viewport.y * proj.vbH} ${viewport.width * proj.vbW} ${viewport.height * proj.vbH}`}
      className={`${DEV_SVG_CLASS} ${canPan ? isDragging ? "cursor-grabbing" : "cursor-grab" : ""}`}
      role="img"
      aria-label={`${label}. Pinch to zoom. When zoomed in, drag with a mouse to pan.`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
    >
      <title>{label}</title>
      {children}
    </svg>
  );
}

function DevelopmentZoomControls({
  viewport,
  onViewportChange,
  connected = false,
}: {
  viewport: NormalizedPlotViewport;
  onViewportChange: (viewport: NormalizedPlotViewport) => void;
  connected?: boolean;
}) {
  const isFullyZoomedOut = viewport.width >= 0.999;
  const isFullyZoomedIn = viewport.width <= 0.361;
  return (
    <div
      className={connected ? "inline-flex h-full" : "inline-flex h-10 overflow-hidden rounded-full border border-slate-200 bg-white"}
      aria-label="Shared development map zoom"
    >
      <button
        type="button"
        onClick={() => onViewportChange(zoomNormalizedViewportAtPoint(viewport, 1.2, 0.5, 0.5))}
        disabled={isFullyZoomedOut}
        className="inline-flex w-10 items-center justify-center border-r border-slate-200 text-base font-bold text-slate-700 transition hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-white disabled:hover:text-slate-600"
        aria-label="Zoom out development maps"
        title="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        onClick={() => onViewportChange(zoomNormalizedViewportAtPoint(viewport, 0.84, 0.5, 0.5))}
        disabled={isFullyZoomedIn}
        className={`inline-flex w-10 items-center justify-center text-base font-bold text-slate-700 transition hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-white disabled:hover:text-slate-600 ${connected ? "border-r border-slate-200" : ""}`}
        aria-label="Zoom in development maps"
        title="Zoom in"
      >
        +
      </button>
    </div>
  );
}

// Development-flow reference quiver over the cell manifold.
function DevelopmentFlowPlot({ vectors, cells, proj, viewport, onViewportChange, svgRef, clusterColors }: { vectors: Array<Arrow>; cells: Array<CellPoint>; proj: DevProjector; viewport: NormalizedPlotViewport; onViewportChange: (viewport: NormalizedPlotViewport) => void; svgRef?: RefObject<SVGSVGElement | null>; clusterColors?: Map<string, string> | null }) {
  return (
    <InteractiveDevelopmentSvg proj={proj} viewport={viewport} onViewportChange={onViewportChange} svgRef={svgRef} label="Development flow — natural differentiation direction">
      {renderCellPoints(cells, proj, clusterColors)}
      {renderFlowArrows(vectors, proj)}
    </InteractiveDevelopmentSvg>
  );
}

// Promotes/blocks tiles over the cell manifold.
function DirectionalityPlot({ grid, cells, proj, absLimit, viewport, onViewportChange, svgRef }: { grid: Array<ScorePoint>; cells: Array<XY>; proj: DevProjector; absLimit: number; viewport: NormalizedPlotViewport; onViewportChange: (viewport: NormalizedPlotViewport) => void; svgRef?: RefObject<SVGSVGElement | null> }) {
  return (
    <InteractiveDevelopmentSvg proj={proj} viewport={viewport} onViewportChange={onViewportChange} svgRef={svgRef} label="Perturbation directionality — promotes vs blocks development">
      {renderCellPoints(cells, proj)}
      {renderScoreTiles(grid, proj, absLimit)}
    </InteractiveDevelopmentSvg>
  );
}

// Combined view: score tiles with the (perturbation or development) arrows drawn
// on top — the canonical CellOracle figure. All three layers share `proj`, so an
// arrow and the tile beneath it describe the exact same grid point.
function CombinedFieldPlot({
  vectors,
  grid,
  cells,
  proj,
  absLimit,
  viewport,
  onViewportChange,
  svgRef,
}: {
  vectors: Array<Arrow>;
  grid: Array<ScorePoint>;
  cells: Array<XY>;
  proj: DevProjector;
  absLimit: number;
  viewport: NormalizedPlotViewport;
  onViewportChange: (viewport: NormalizedPlotViewport) => void;
  svgRef?: RefObject<SVGSVGElement | null>;
}) {
  return (
    <InteractiveDevelopmentSvg proj={proj} viewport={viewport} onViewportChange={onViewportChange} svgRef={svgRef} label="Perturbation flow overlaid on promotes-vs-blocks map">
      {renderCellPoints(cells, proj)}
      {renderScoreTiles(grid, proj, absLimit)}
      {renderFlowArrows(vectors, proj, true)}
    </InteractiveDevelopmentSvg>
  );
}

// Placeholder shown when one panel of the development-direction pair has no data
// (e.g. a perturbation computed before the development-flow field was captured).
// Matches the plot's aspect ratio so the two-column layout stays balanced.
function DevelopmentPlotPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex aspect-[520/330] w-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-[#f7fbff] px-6 text-center">
      <p className="max-w-[16rem] text-xs leading-5 text-slate-400">{message}</p>
    </div>
  );
}

function formatScoreLimit(value: number): string {
  const abs = Math.abs(value);
  const body = abs >= 0.1 ? abs.toFixed(2) : abs >= 0.001 ? abs.toFixed(3) : abs.toExponential(1);
  return value < 0 ? `−${body}` : `+${body}`;
}

// Continuous zero-centred color bar with numeric limits (replaces the old
// two-swatch legend). The neutral centre is exactly the score = 0 point.
function DirectionalityColorBar({ limit }: { limit: number }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex w-44 items-center justify-between text-[11px] font-semibold text-slate-500">
        <span>Blocks</span>
        <span>Neutral</span>
        <span>Promotes</span>
      </div>
      <div
        className="h-2 w-44 rounded-full"
        style={{
          background:
            "linear-gradient(to right, rgba(226,75,74,0.92), rgb(226,232,240) 50%, rgba(22,163,120,0.92))",
        }}
      />
      <div className="flex w-44 items-center justify-between text-[10px] font-medium text-slate-400">
        <span>{formatScoreLimit(-limit)}</span>
        <span>0</span>
        <span>{formatScoreLimit(limit)}</span>
      </div>
    </div>
  );
}

// Compact swatch legend for the cluster-colored manifold. Caps the number of
// visible entries so a high-cardinality annotation can't overrun the layout.
function ClusterLegend({ colors, className = "mt-2" }: { colors: Map<string, string>; className?: string }) {
  const entries = [...colors.entries()];
  const MAX_SHOWN = 18;
  const shown = entries.slice(0, MAX_SHOWN);
  const extra = entries.length - shown.length;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium text-slate-500 ${className}`} aria-label="Cluster colors">
      {shown.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
          <span className="max-w-[9rem] truncate">{label}</span>
        </span>
      ))}
      {extra > 0 ? <span className="text-slate-400">+{extra} more</span> : null}
    </div>
  );
}

type DevelopmentImpactLayout = "side-by-side" | "overlay";

// Development flow and perturbation alignment answer one biological question,
// so they live in one view. Side-by-side is the explanatory default; overlay is
// available when the user wants to inspect both fields at the same coordinates.
function DevelopmentImpactPanel({
  projectId,
  result,
  controlsHost,
}: {
  projectId: string;
  result: PerturbationResult;
  controlsHost: HTMLDivElement | null;
}) {
  const developmentVectors = result.development_vectors ?? [];
  const innerProductGrid = result.inner_product_grid ?? [];
  // Use only the trajectory-specific flow CellOracle multiplied by ref_flow to
  // produce inner_product_grid. Whole-dataset grid_vectors can point elsewhere
  // when pseudotime covers a subset, so legacy results safely show score-only.
  const perturbationArrows = useMemo<Array<Arrow>>(
    () => (result.development_perturbation_vectors ?? []).map((vector) => ({ x: vector.x, y: vector.y, dx: vector.dx, dy: vector.dy })),
    [result.development_perturbation_vectors],
  );
  const hasField = developmentVectors.length > 0 || innerProductGrid.length > 0;
  const hasDevArrows = developmentVectors.length > 0;
  const hasPerturbationArrows = perturbationArrows.length > 0;

  const [isEstimating, setIsEstimating] = useState(false);
  const [estimateMessage, setEstimateMessage] = useState<string | null>(null);
  const [layout, setLayout] = useState<DevelopmentImpactLayout>("side-by-side");
  const [viewport, setViewport] = useState<NormalizedPlotViewport>(DEFAULT_NORMALIZED_VIEWPORT);
  const [isExpanded, setIsExpanded] = useState(false);
  const [exportMenu, setExportMenu] = useState<"main" | "expanded" | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const mainFlowSvgRef = useRef<SVGSVGElement | null>(null);
  const mainAlignmentSvgRef = useRef<SVGSVGElement | null>(null);
  const expandedFlowSvgRef = useRef<SVGSVGElement | null>(null);
  const expandedAlignmentSvgRef = useRef<SVGSVGElement | null>(null);
  const mainExportMenuRef = useRef<HTMLDivElement | null>(null);
  const expandedExportMenuRef = useRef<HTMLDivElement | null>(null);

  // Faint cell manifold shared by every panel (capped for performance).
  const cells = useMemo(
    () => subsampleCells(result.embedding_points ?? [], DEV_CELL_TARGET),
    [result.embedding_points],
  );
  // Color the manifold by uploaded cluster labels (null when there's nothing to
  // distinguish). Used only in the development-flow panel — the alignment panel
  // reserves hue for the promotes/blocks score.
  const clusterColors = useMemo(
    () => buildClusterColorMap(result.embedding_points ?? []),
    [result.embedding_points],
  );
  // Robust, symmetric color limit so one extreme grid point can't wash out the scale.
  const absLimit = useMemo(() => robustScoreLimit(result.inner_product_grid ?? []), [result.inner_product_grid]);

  // One bounding box + projector shared by every panel. Frame to the analyzed
  // region (the gradient grid + arrow fields), NOT the full embedding: the
  // embedding's sparse stragglers otherwise pad the plot with empty space. Cells
  // that fall outside this region are simply clipped by the SVG viewport, and the
  // grid only exists where cells have mass, so the manifold stays visible.
  const proj = useMemo(() => {
    const bounds =
      mergeDevBounds(
        computeDevBounds(result.development_vectors ?? []),
        computeDevBounds(result.inner_product_grid ?? []),
        computeDevBounds(perturbationArrows),
      ) ?? computeDevBounds(result.embedding_points ?? []);
    return bounds ? makeDevProjector(bounds) : null;
  }, [result.embedding_points, result.development_vectors, result.inner_product_grid, perturbationArrows]);

  // CellOracle's combined view places the simulated perturbation field over
  // the inner-product colors. The developmental field remains the reference
  // panel at left rather than becoming an interchangeable overlay.
  const canOverlay = innerProductGrid.length > 0 && hasPerturbationArrows;
  const activeLayout = layout === "overlay" && canOverlay ? "overlay" : "side-by-side";

  const estimatePseudotime = useCallback(async () => {
    setIsEstimating(true);
    setEstimateMessage(null);
    try {
      const response = await apiFetch(`${API_BASE}/projects/${projectId}/pseudotime/estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setEstimateMessage(
        response.ok
          ? "Estimating pseudotime… once it finishes, re-run this perturbation to see the development comparison."
          : "Couldn't start pseudotime estimation. Please try again.",
      );
    } catch {
      setEstimateMessage("Couldn't reach the server to start estimation.");
    } finally {
      setIsEstimating(false);
    }
  }, [projectId]);

  const handleDevelopmentExport = async (format: "svg" | "png", source: "main" | "expanded") => {
    const flowSvg = source === "expanded" ? expandedFlowSvgRef.current : mainFlowSvgRef.current;
    const alignmentSvg = source === "expanded" ? expandedAlignmentSvgRef.current : mainAlignmentSvgRef.current;
    const panels = activeLayout === "overlay"
      ? alignmentSvg
        ? [{ svg: alignmentSvg, title: "Perturbation alignment" }]
        : []
      : [
          ...(flowSvg ? [{ svg: flowSvg, title: "Natural development flow" }] : []),
          ...(alignmentSvg ? [{ svg: alignmentSvg, title: "Perturbation alignment" }] : []),
        ];
    if (panels.length === 0 || (activeLayout === "side-by-side" && panels.length < 2)) {
      setExportError("The development maps are not ready to export yet.");
      return;
    }

    setIsExporting(true);
    setExportError(null);
    try {
      const svgMarkup = buildDevelopmentFigureSvg({
        panels,
        title: `${formatPerturbation(result.gene, result.perturbation_value)} · Development impact`,
        limit: absLimit,
      });
      const perturbationLabel = result.perturbation_value === 0
        ? "knockout"
        : `set-${formatScientific(result.perturbation_value)}`;
      const filename = [
        "celloracle",
        result.gene,
        perturbationLabel,
        "development-impact",
        activeLayout,
      ].map(sanitizeFilenamePart).join("_");
      if (format === "svg") {
        downloadBlob(new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" }), `${filename}.svg`);
      } else {
        downloadBlob(await svgToPngBlob(svgMarkup), `${filename}.png`);
      }
      setExportMenu(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Figure export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    if (!isExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (exportMenu) setExportMenu(null);
      else setIsExpanded(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [exportMenu, isExpanded]);

  useEffect(() => {
    if (!exportMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      const activeMenuRef = exportMenu === "expanded" ? expandedExportMenuRef : mainExportMenuRef;
      if (target instanceof Node && !activeMenuRef.current?.contains(target)) setExportMenu(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [exportMenu]);

  if (!hasField) {
    const reason = result.perturbation_score_unavailable_reason;
    const needsPseudotime = !result.pseudotime_trajectory;
    return (
      <div className="mt-3">
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Compare this perturbation against the natural differentiation trajectory.{" "}
          {reason ?? "This needs a pseudotime trajectory."}
        </p>
        {needsPseudotime ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={estimatePseudotime}
              disabled={isEstimating}
              className="inline-flex h-9 items-center rounded-full bg-[#1b75a6] px-4 text-xs font-bold text-white transition hover:bg-[#155f87] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isEstimating ? "Starting…" : "Estimate pseudotime"}
            </button>
            {estimateMessage ? (
              <p className="mt-2 text-xs leading-5 text-slate-500">{estimateMessage}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const renderDevelopmentMaps = (source: "main" | "expanded") => {
    const flowSvgRef = source === "expanded" ? expandedFlowSvgRef : mainFlowSvgRef;
    const alignmentSvgRef = source === "expanded" ? expandedAlignmentSvgRef : mainAlignmentSvgRef;
    if (activeLayout === "side-by-side") {
      return (
        <div className="mt-3 grid gap-5 xl:grid-cols-2">
          <article className="min-w-0">
            <div className="mb-3 flex min-h-9 flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-950">Natural development flow</h4>
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-500" aria-label="Pseudotime runs from early to late">
                <span>Early</span>
                <span aria-hidden="true">→</span>
                <span>Late</span>
              </div>
            </div>
            {hasDevArrows && proj ? (
              <DevelopmentFlowPlot vectors={developmentVectors} cells={cells} proj={proj} viewport={viewport} onViewportChange={setViewport} svgRef={flowSvgRef} clusterColors={clusterColors} />
            ) : (
              <DevelopmentPlotPlaceholder message="Re-run this CellOracle perturbation to generate the development-flow field." />
            )}
          </article>

          <article className="min-w-0">
            <div className="mb-3 flex min-h-9 flex-wrap items-center justify-between gap-3">
              <h4 className="text-sm font-bold text-slate-950">Perturbation alignment</h4>
            </div>
            {innerProductGrid.length > 0 && proj ? (
              hasPerturbationArrows ? (
                <CombinedFieldPlot vectors={perturbationArrows} grid={innerProductGrid} cells={cells} proj={proj} absLimit={absLimit} viewport={viewport} onViewportChange={setViewport} svgRef={alignmentSvgRef} />
              ) : (
                <DirectionalityPlot grid={innerProductGrid} cells={cells} proj={proj} absLimit={absLimit} viewport={viewport} onViewportChange={setViewport} svgRef={alignmentSvgRef} />
              )
            ) : (
              <DevelopmentPlotPlaceholder message="Re-run this CellOracle perturbation to generate the promotes-vs-blocks map." />
            )}
          </article>
        </div>
      );
    }
    return (
      <div className="mt-3">
        <div className="mx-auto max-w-5xl">
          {proj ? (
            <CombinedFieldPlot vectors={perturbationArrows} grid={innerProductGrid} cells={cells} proj={proj} absLimit={absLimit} viewport={viewport} onViewportChange={setViewport} svgRef={alignmentSvgRef} />
          ) : (
            <DevelopmentPlotPlaceholder message="Re-run this CellOracle perturbation to generate the development-impact overlay." />
          )}
        </div>
      </div>
    );
  };

  return (
    <>
    {controlsHost ? createPortal(
      <>
        <div className="inline-flex h-10 overflow-hidden rounded-full border border-slate-200 bg-white" aria-label="Development map view controls">
          <DevelopmentZoomControls viewport={viewport} onViewportChange={setViewport} connected />
          <ExpandComparisonButton
            connected
            onClick={() => {
              setExportMenu(null);
              setIsExpanded(true);
            }}
          />
        </div>
        <FigureExportMenu
          menuRef={mainExportMenuRef}
          isOpen={exportMenu === "main"}
          isExporting={isExporting}
          error={exportError}
          onToggle={() => {
            setExportError(null);
            setExportMenu((current) => current === "main" ? null : "main");
          }}
          onExport={(format) => handleDevelopmentExport(format, "main")}
        />
      </>,
      controlsHost,
    ) : null}
    <div className="mt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h4 className="text-sm font-bold text-slate-950">Development comparison</h4>
          {canOverlay ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Layout</span>
              <div
                className="inline-flex rounded-full border border-slate-200 bg-white p-0.5 text-[11px] font-semibold"
                role="tablist"
                aria-label="Development impact layout"
              >
                {(["side-by-side", "overlay"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={activeLayout === option}
                    onClick={() => setLayout(option)}
                    className={
                      activeLayout === option
                        ? "rounded-full bg-slate-800 px-2.5 py-0.5 text-white"
                        : "rounded-full px-2.5 py-0.5 text-slate-500 transition hover:text-slate-700"
                    }
                  >
                    {option === "side-by-side" ? "Side by side" : "Overlay"}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        {innerProductGrid.length > 0 ? <DirectionalityColorBar limit={absLimit} /> : null}
      </div>

      {renderDevelopmentMaps("main")}
    </div>
    {isExpanded && (
      <div
        className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm animate-modal-overlay"
        onClick={() => {
          setExportMenu(null);
          setIsExpanded(false);
        }}
        role="presentation"
      >
        <div
          className="max-h-[96vh] w-[calc(100vw-2rem)] max-w-[1500px] overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl shadow-slate-950/25 animate-modal-panel"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Expanded development impact comparison"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-950">Development impact comparison</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {formatPerturbation(result.gene, result.perturbation_value)} · synchronized view
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <DevelopmentZoomControls viewport={viewport} onViewportChange={setViewport} />
              <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" aria-hidden="true" />
              <FigureExportMenu
                menuRef={expandedExportMenuRef}
                isOpen={exportMenu === "expanded"}
                isExporting={isExporting}
                error={exportError}
                onToggle={() => {
                  setExportError(null);
                  setExportMenu((current) => current === "expanded" ? null : "expanded");
                }}
                onExport={(format) => handleDevelopmentExport(format, "expanded")}
              />
              <button
                type="button"
                onClick={() => {
                  setExportMenu(null);
                  setIsExpanded(false);
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200"
                aria-label="Close expanded development comparison"
                title="Close"
              >
                ×
              </button>
            </div>
          </div>
          {renderDevelopmentMaps("expanded")}
        </div>
      </div>
    )}
    </>
  );
}

// Retained for the alternate cluster-focused perturbation presentation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ClusterResponseView({
  result,
  clusters,
}: {
  result: PerturbationResult;
  clusters: ClusterSummaryView[];
}) {
  const [selectedClusterId, setSelectedClusterId] = useState(clusters[0]?.cluster ?? "");
  const [plotViewport, setPlotViewport] = useState<PlotViewport>(DEFAULT_PLOT_VIEWPORT);
  const [hoveredVectorIndex, setHoveredVectorIndex] = useState<number | null>(null);
  const [hoveredVectorPlot, setHoveredVectorPlot] = useState<PlotKind | null>(null);
  const [pinnedVectorIndex, setPinnedVectorIndex] = useState<number | null>(null);
  const [pinnedVectorPlot, setPinnedVectorPlot] = useState<PlotKind | null>(null);

  const selectedCluster = clusters.some((cluster) => cluster.cluster === selectedClusterId)
    ? selectedClusterId
    : clusters[0]?.cluster ?? "";
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

  const handleClusterChange = (cluster: string) => {
    setSelectedClusterId(cluster);
    setPlotViewport(DEFAULT_PLOT_VIEWPORT);
    setHoveredVectorIndex(null);
    setHoveredVectorPlot(null);
    setPinnedVectorIndex(null);
    setPinnedVectorPlot(null);
  };

  return (
    <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className={RESULT_SECTION_HEADING_CLASS}>Response by cluster</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Choose one cluster to inspect its gene response and cell-state shift. The perturbation is applied to every modeled cell, with cluster-specific GRN coefficients used for each group.
          </p>
        </div>
        <label className="block w-full shrink-0 sm:w-56">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Cluster</span>
          <div className="relative flex h-11 items-center overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-[#087ead] focus-within:ring-4 focus-within:ring-[#087ead]/10">
            <select
              value={selectedCluster}
              onChange={(event) => handleClusterChange(event.target.value)}
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

function describeGeneExpressionResponse(distribution: GeneExpressionDistribution) {
  const increasedPercent = Math.round(distribution.increased_cell_fraction * 100);
  const decreasedPercent = Math.round(distribution.decreased_cell_fraction * 100);
  if (Math.abs(distribution.mean_change) <= DISPLAY_CHANGE_EPSILON) {
    return "Average expression remains broadly stable after the perturbation.";
  }
  if (distribution.mean_change > 0) {
    return increasedPercent >= 50
      ? `Expression is higher in ${increasedPercent}% of modeled cells.`
      : `Average expression increases, with higher values in ${increasedPercent}% of modeled cells.`;
  }
  return decreasedPercent >= 50
    ? `Expression is lower in ${decreasedPercent}% of modeled cells.`
    : `Average expression decreases, with lower values in ${decreasedPercent}% of modeled cells.`;
}

function GeneExpressionDistributionInspector({
  gene,
  distribution,
}: {
  gene: string;
  distribution: GeneExpressionDistribution | null;
}) {
  if (!distribution) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4">
        <p className="text-sm font-bold text-slate-800">Expression distribution unavailable for this saved run</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          This result was created before model-scale distributions were stored. Rerun the perturbation to compare baseline and simulated expression for {gene}.
        </p>
      </div>
    );
  }

  const maxBinCount = Math.max(
    1,
    ...distribution.histogram.flatMap((bin) => [bin.baseline_count, bin.simulated_count])
  );
  const histogramMinimum = distribution.histogram[0]?.start ?? 0;
  const histogramMaximum = distribution.histogram.at(-1)?.end ?? 0;
  const increasedPercent = Math.round(distribution.increased_cell_fraction * 100);
  const decreasedPercent = Math.round(distribution.decreased_cell_fraction * 100);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-bold text-slate-950">{gene} expression response</h4>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {describeGeneExpressionResponse(distribution)}
          </p>
        </div>
        <span className="shrink-0 text-[11px] font-semibold text-slate-500">
          {distribution.cell_count.toLocaleString()} modeled cells
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-end">
        <div>
          <div
            className="flex h-24 items-end gap-1 rounded-lg border border-slate-200 bg-white px-3 pt-3"
            role="img"
            aria-label={`Baseline and simulated CellOracle expression distributions for ${gene}`}
          >
            {distribution.histogram.map((bin, index) => (
              <span
                key={`${bin.start}-${index}`}
                className="flex h-full min-w-0 flex-1 items-end justify-center gap-px"
                title={`${formatScientific(bin.start)}–${formatScientific(bin.end)}: baseline ${bin.baseline_count}, simulated ${bin.simulated_count}`}
              >
                <span
                  className="w-[42%] rounded-t-sm bg-slate-300"
                  style={{
                    height: bin.baseline_count
                      ? `${Math.max(2, (bin.baseline_count / maxBinCount) * 78)}px`
                      : 0,
                  }}
                  aria-hidden="true"
                />
                <span
                  className="w-[42%] rounded-t-sm bg-[#1688b4]"
                  style={{
                    height: bin.simulated_count
                      ? `${Math.max(2, (bin.simulated_count / maxBinCount) * 78)}px`
                      : 0,
                  }}
                  aria-hidden="true"
                />
              </span>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] font-semibold text-slate-400">
            <span>{formatScientific(histogramMinimum)}</span>
            <span>CellOracle expression</span>
            <span>{formatScientific(histogramMaximum)}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] font-semibold text-slate-600" aria-label="Distribution legend">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" aria-hidden="true" />
              Baseline
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#1688b4]" aria-hidden="true" />
              Simulated
            </span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-200 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Mean</dt>
            <dd className="mt-1 text-sm font-bold text-slate-900">
              {formatScientific(distribution.baseline_mean)} <span className="text-slate-400">→</span> {formatScientific(distribution.simulated_mean)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Median</dt>
            <dd className="mt-1 text-sm font-bold text-slate-900">
              {formatScientific(distribution.baseline_median)} <span className="text-slate-400">→</span> {formatScientific(distribution.simulated_median)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Higher cells</dt>
            <dd className="mt-1 text-sm font-bold text-emerald-700">{increasedPercent}%</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Lower cells</dt>
            <dd className="mt-1 text-sm font-bold text-rose-600">{decreasedPercent}%</dd>
          </div>
        </dl>
      </div>

      <p className="mt-3 border-t border-slate-200 pt-3 text-[11px] leading-5 text-slate-500">
        Both distributions use CellOracle&apos;s imputed-expression scale, so their shift is directly comparable.
      </p>
    </div>
  );
}

function ResultSummary({
  projectId,
  result,
  resultScope,
}: {
  projectId: string;
  result: PerturbationResult;
  resultScope: string;
}) {
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const [hoveredVectorIndex, setHoveredVectorIndex] = useState<number | null>(null);
  const [hoveredVectorPlot, setHoveredVectorPlot] = useState<PlotKind | null>(null);
  const [pinnedVectorIndex, setPinnedVectorIndex] = useState<number | null>(null);
  const [pinnedVectorPlot, setPinnedVectorPlot] = useState<PlotKind | null>(null);
  const [plotViewport, setPlotViewport] = useState<PlotViewport>(DEFAULT_PLOT_VIEWPORT);
  const [isComparisonExpanded, setIsComparisonExpanded] = useState(false);
  const [mapView, setMapView] = useState<"shift" | "development-impact">("shift");
  const [mapControlsHost, setMapControlsHost] = useState<HTMLDivElement | null>(null);

  // Keep the first decision biological, not graphical. Development flow and the
  // promotes/blocks score are paired inside Development impact because neither is
  // very meaningful without the other as context.
  const mapTabs: Array<{ id: "shift" | "development-impact"; label: string }> = [
    { id: "shift", label: "Cell-state shift" },
    { id: "development-impact", label: "Development impact" },
  ];
  const [figureExportMenu, setFigureExportMenu] = useState<"main" | "expanded" | null>(null);
  const [isFigureExporting, setIsFigureExporting] = useState(false);
  const [figureExportError, setFigureExportError] = useState<string | null>(null);
  const [showAllGenes, setShowAllGenes] = useState(false);
  const [expandedGene, setExpandedGene] = useState<string | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const howToReadRef = useRef<HTMLDetailsElement | null>(null);
  const figureExportMenuRef = useRef<HTMLDivElement | null>(null);
  const expandedFigureExportMenuRef = useRef<HTMLDivElement | null>(null);
  const predictedPlotSvgRef = useRef<SVGSVGElement | null>(null);
  const randomizedPlotSvgRef = useRef<SVGSVGElement | null>(null);
  const globalGridVectorFields = useMemo(
    () => resolveGridVectorFields(result),
    [result]
  );
  // Shared cluster -> color map so the cell-state and development maps agree on
  // colors. Null when the upload has 0/1 cluster (nothing to distinguish).
  const clusterColors = useMemo(
    () => buildClusterColorMap(result.embedding_points ?? []),
    [result.embedding_points]
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
          perturbation_score: Number.isFinite(cluster.perturbation_score)
            ? cluster.perturbation_score ?? null
            : null,
          perturbation_score_p_value: Number.isFinite(cluster.perturbation_score_p_value)
            ? cluster.perturbation_score_p_value ?? null
            : null,
          perturbation_score_unavailable_reason: cluster.perturbation_score_unavailable_reason,
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
        perturbation_score: null,
        perturbation_score_p_value: null,
        perturbation_score_unavailable_reason: "Pseudotime is required.",
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
  const selectedClusterName = selectedClusterSummary?.cluster;
  const selectedClusterPoints = useMemo(
    () => selectedClusterName
      ? result.embedding_points.filter((point) => point.cluster === selectedClusterName)
      : [],
    [result.embedding_points, selectedClusterName]
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
  const predictedPlotTitle = isClusterScope ? `${resultScope} predicted response` : "Predicted response";
  const randomizedPlotTitle = isClusterScope ? `${resultScope} randomized control` : "Randomized control";
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
  const increaseGenes = rankedChangedGenes.filter((row) => row.mean_change > 0).slice(0, 5);
  const decreaseGenes = rankedChangedGenes.filter((row) => row.mean_change < 0).slice(0, 5);
  const maxIncreaseMagnitude = Math.max(
    ...increaseGenes.map((row) => row.mean_absolute_change),
    DISPLAY_CHANGE_EPSILON
  );
  const maxDecreaseMagnitude = Math.max(
    ...decreaseGenes.map((row) => row.mean_absolute_change),
    DISPLAY_CHANGE_EPSILON
  );
  const expressionDistributions = useMemo(() => {
    const byGene = new Map<string, GeneExpressionDistribution>();
    for (const distribution of result.gene_expression_distributions ?? []) {
      const matchesScope = isClusterScope
        ? distribution.scope_type === "cluster" && distribution.scope_label === resultScope
        : distribution.scope_type === "global";
      if (matchesScope) byGene.set(distribution.gene, distribution);
    }
    return byGene;
  }, [isClusterScope, result.gene_expression_distributions, resultScope]);

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

  const handleFigureExport = async (format: "svg" | "png") => {
    const predictedSvg = predictedPlotSvgRef.current;
    const randomizedSvg = randomizedPlotSvgRef.current;
    if (!predictedSvg || !randomizedSvg) {
      setFigureExportError("The plots are not ready to export yet.");
      return;
    }

    setIsFigureExporting(true);
    setFigureExportError(null);
    try {
      const subtitle = `${formatPerturbation(result.gene, result.perturbation_value)} · ${isClusterScope ? resultScope : "Global"} · ${result.n_propagation} propagation steps`;
      const svgMarkup = buildComparisonFigureSvg({
        predictedSvg,
        randomizedSvg,
        predictedTitle: predictedPlotTitle,
        randomizedTitle: randomizedPlotTitle,
        subtitle,
      });
      const perturbationLabel = result.perturbation_value === 0
        ? "knockout"
        : `set-${formatScientific(result.perturbation_value)}`;
      const filename = [
        "celloracle",
        result.gene,
        perturbationLabel,
        isClusterScope ? resultScope : "global",
        "predicted-vs-control",
      ].map(sanitizeFilenamePart).join("_");

      if (format === "svg") {
        downloadBlob(new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" }), `${filename}.svg`);
      } else {
        downloadBlob(await svgToPngBlob(svgMarkup), `${filename}.png`);
      }
      setFigureExportMenu(null);
    } catch (error) {
      setFigureExportError(error instanceof Error ? error.message : "Figure export failed.");
    } finally {
      setIsFigureExporting(false);
    }
  };

  useEffect(() => {
    if (!isComparisonExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const exportMenuIsOpen = Boolean(
        figureExportMenuRef.current?.querySelector('[role="menu"]') ||
        expandedFigureExportMenuRef.current?.querySelector('[role="menu"]')
      );
      if (exportMenuIsOpen) setFigureExportMenu(null);
      else setIsComparisonExpanded(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isComparisonExpanded]);

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

  useEffect(() => {
    const dismissHowToRead = () => {
      if (howToReadRef.current) howToReadRef.current.open = false;
    };
    const handlePointerDown = (event: PointerEvent) => {
      const popup = howToReadRef.current;
      const target = event.target;
      if (popup?.open && target instanceof Node && !popup.contains(target)) dismissHowToRead();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && howToReadRef.current?.open) dismissHowToRead();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!figureExportMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      const activeMenuRef = figureExportMenu === "expanded"
        ? expandedFigureExportMenuRef
        : figureExportMenuRef;
      if (target instanceof Node && !activeMenuRef.current?.contains(target)) {
        setFigureExportMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isComparisonExpanded) setFigureExportMenu(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [figureExportMenu, isComparisonExpanded]);

  return (
    <div>
      <div className="mt-5 border-t border-slate-100 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className={RESULT_SECTION_HEADING_CLASS}>
              Predicted gene changes{isClusterScope ? ` · ${resultScope}` : ""}
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Genes with the largest predicted increase and decrease.
            </p>
          </div>
          <div ref={downloadMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsDownloadDialogOpen((current) => !current)}
              aria-expanded={isDownloadDialogOpen}
              aria-haspopup="dialog"
              aria-label="Download perturbation data"
              title="Download perturbation data"
              className={DOWNLOAD_BUTTON_CLASS}
            >
              <DownloadIcon />
              Download
              <svg
                viewBox="0 0 16 16"
                className={`h-3.5 w-3.5 transition-transform ${
                  isDownloadDialogOpen ? "rotate-180" : ""
                }`}
                fill="none"
                aria-hidden="true"
              >
                <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
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

        {rankedChangedGenes.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No measurable gene-expression changes were predicted.
          </p>
        ) : (
          <>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.06em] text-slate-500">
                  <span aria-hidden="true">↑</span> Increases most
                </h4>
                {increaseGenes.length > 0 ? (
                  increaseGenes.map((row) => (
                    <div key={row.gene} className="flex items-center gap-3 py-1.5 text-sm">
                      <span className="w-24 shrink-0 truncate font-bold text-slate-950">{row.gene}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span
                          className="block h-full rounded-full bg-emerald-600"
                          style={{ width: `${Math.max(4, (row.mean_absolute_change / maxIncreaseMagnitude) * 100)}%` }}
                        />
                      </span>
                      <span className="shrink-0 font-bold tabular-nums text-emerald-700">
                        +{formatScientific(row.mean_change)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="py-2 text-xs text-slate-400">No predicted increases.</p>
                )}
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.06em] text-slate-500">
                  <span aria-hidden="true">↓</span> Decreases most
                </h4>
                {decreaseGenes.length > 0 ? (
                  decreaseGenes.map((row) => (
                    <div key={row.gene} className="flex items-center gap-3 py-1.5 text-sm">
                      <span className="w-24 shrink-0 truncate font-bold text-slate-950">{row.gene}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span
                          className="block h-full rounded-full bg-rose-500"
                          style={{ width: `${Math.max(4, (row.mean_absolute_change / maxDecreaseMagnitude) * 100)}%` }}
                        />
                      </span>
                      <span className="shrink-0 font-bold tabular-nums text-rose-600">
                        {formatScientific(row.mean_change)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="py-2 text-xs text-slate-400">No predicted decreases.</p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAllGenes((current) => !current)}
              aria-expanded={showAllGenes}
              className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-[#087ead]/30 hover:bg-[#f2f9fc] hover:text-[#087ead]"
            >
              {showAllGenes ? "Hide full list" : `See all ${rankedChangedGenes.length} genes · inspect distributions`}
            </button>

            {showAllGenes && (
              <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead className="grn-table-header">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-3">Rank</th>
                <th className="px-3 py-3">Gene</th>
                <th className="px-3 py-3 text-right">Mean change</th>
                <th className="px-3 py-3 text-right">Mean absolute change</th>
              </tr>
            </thead>
            <tbody>
              {rankedChangedGenes.map((row, index) => {
                const isExpanded = expandedGene === row.gene;
                const inspectorId = `gene-distribution-${result.run_id}-${resultScope}-${index}`;
                const distribution = expressionDistributions.get(row.gene) ?? null;
                return (
                  <Fragment key={`${row.gene}-${index}`}>
                    <tr
                      onClick={() => setExpandedGene((current) => current === row.gene ? null : row.gene)}
                      className={`cursor-pointer border-b transition ${
                        isExpanded
                          ? "border-slate-200 bg-[#f4f9fc]"
                          : "border-slate-100 hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-3 py-3 text-slate-500">{index + 1}</td>
                      <td className="px-3 py-3 font-bold text-slate-950">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={inspectorId}
                          aria-label={`${isExpanded ? "Hide" : "Inspect"} ${row.gene} expression distribution`}
                          className="inline-flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10"
                        >
                          <span>{row.gene}</span>
                          <span
                            className={`h-1.5 w-1.5 border-b-2 border-r-2 border-slate-400 transition ${
                              isExpanded ? "rotate-[225deg] translate-y-0.5" : "rotate-45 -translate-y-0.5"
                            }`}
                            aria-hidden="true"
                          />
                        </button>
                      </td>
                      <td className={`px-3 py-3 text-right font-semibold ${row.mean_change < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                        {row.mean_change > 0 ? "+" : ""}{formatScientific(row.mean_change)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-700">
                        {formatScientific(row.mean_absolute_change)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr id={inspectorId} className="border-b border-slate-200">
                        <td colSpan={4} className="bg-white px-3 py-3">
                          <GeneExpressionDistributionInspector
                            gene={row.gene}
                            distribution={distribution}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
            )}
          </>
        )}
      </div>

      <section className="mt-5 border-t border-slate-100 pt-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={RESULT_SECTION_HEADING_CLASS}>Cell fate response</h3>
            <details ref={howToReadRef} className="group relative">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 [&::-webkit-details-marker]:hidden">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold" aria-hidden="true">?</span>
                How to read
              </summary>
              <div className="absolute left-0 top-8 z-30 w-[calc(100vw-3rem)] max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-950/10">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-950">Cell-state shift</h4>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Shows where the simulated perturbation moves cells compared with a randomized GRN control. Both maps use the same arrow scale.
                    </p>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-950">Development impact</h4>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Flow arrows follow pseudotime. Green alignment follows development, red opposes it, and pale regions have little alignment.
                    </p>
                  </div>
                </div>
                <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-5 text-slate-500">
                  In Overlay, perturbation arrows are drawn over the alignment colors; the separate development-flow map remains the natural reference. Alignment limits are symmetric and clipped at the 98th percentile.
                  The predicted/control ratio is descriptive, not a significance test.
                </p>
              </div>
            </details>
          </div>
          <p className="mt-1.5 text-sm leading-6 text-slate-600">
            Predicted cell movement and its alignment with natural development.
          </p>
        </div>

        <div
          className="mt-4 flex flex-wrap items-end justify-between gap-x-5 gap-y-3 border-b border-slate-200"
        >
          <div role="tablist" aria-label="Perturbation map view" className="flex flex-wrap items-center gap-6">
            {mapTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={mapView === tab.id}
                onClick={() => {
                  setFigureExportMenu(null);
                  setMapView(tab.id);
                }}
                className={
                  "-mb-px border-b-2 pb-2.5 text-sm font-semibold transition focus-visible:outline-none " +
                  (mapView === tab.id
                    ? "border-[#1b75a6] text-slate-950"
                    : "border-transparent text-slate-500 hover:text-slate-700 focus-visible:text-slate-700")
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div ref={setMapControlsHost} className="mb-2 flex items-center gap-2">
            {mapView === "shift" ? (
              <>
                <div className="inline-flex h-10 overflow-hidden rounded-full border border-slate-200 bg-white" aria-label="Plot view controls">
                  <PlotZoomControls viewport={plotViewport} onViewportChange={setPlotViewport} connected />
                  <ExpandComparisonButton
                    connected
                    onClick={() => {
                      setFigureExportMenu(null);
                      setIsComparisonExpanded(true);
                    }}
                  />
                </div>
                <FigureExportMenu
                  menuRef={figureExportMenuRef}
                  isOpen={figureExportMenu === "main"}
                  isExporting={isFigureExporting}
                  error={figureExportError}
                  onToggle={() => {
                    setFigureExportError(null);
                    setFigureExportMenu((current) => current === "main" ? null : "main");
                  }}
                  onExport={handleFigureExport}
                />
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-slate-500" aria-label="Plot legend">
          {clusterColors ? (
            <ClusterLegend colors={clusterColors} className="" />
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#9fb6c8]" aria-hidden="true" />
              Cells
            </span>
          )}
        </div>

        {mapView === "shift" ? (
          <div className="mt-3">
            <div className="grid gap-5 xl:grid-cols-2">
              <VectorFieldPlot
                title={predictedPlotTitle}
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
                svgRef={predictedPlotSvgRef}
                clusterColors={clusterColors}
              />
              <VectorFieldPlot
                title={randomizedPlotTitle}
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
                svgRef={randomizedPlotSvgRef}
                randomized
                clusterColors={clusterColors}
              />
            </div>

          </div>
        ) : (
          <DevelopmentImpactPanel key={result.run_id} projectId={projectId} result={result} controlsHost={mapControlsHost} />
        )}
      </section>

      {isComparisonExpanded && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm animate-modal-overlay"
          onClick={() => {
            setFigureExportMenu(null);
            setIsComparisonExpanded(false);
          }}
          role="presentation"
        >
          <div
            className="max-h-[96vh] w-[calc(100vw-2rem)] max-w-[1500px] overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl shadow-slate-950/25 animate-modal-panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Expanded predicted and randomized comparison"
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-950">Cell-state shift comparison</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {formatPerturbation(result.gene, result.perturbation_value)} · {isClusterScope ? resultScope : "Global"} · synchronized view
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <PlotZoomControls viewport={plotViewport} onViewportChange={setPlotViewport} />
                <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" aria-hidden="true" />
                <FigureExportMenu
                  menuRef={expandedFigureExportMenuRef}
                  isOpen={figureExportMenu === "expanded"}
                  isExporting={isFigureExporting}
                  error={figureExportError}
                  onToggle={() => {
                    setFigureExportError(null);
                    setFigureExportMenu((current) => current === "expanded" ? null : "expanded");
                  }}
                  onExport={handleFigureExport}
                />
                <button
                  type="button"
                  onClick={() => {
                    setFigureExportMenu(null);
                    setIsComparisonExpanded(false);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200"
                  aria-label="Close expanded comparison"
                  title="Close"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <VectorFieldPlot
                title={predictedPlotTitle}
                points={displayPoints}
                vectors={gridVectorFields.predicted}
                comparisonVectors={gridVectorFields.randomized}
                referenceMagnitude={sharedVectorReferenceMagnitude}
                viewport={plotViewport}
                activeVectorIndex={activeVectorPlot === "predicted" ? activeVectorIndex : null}
                pinnedVectorIndex={pinnedVectorPlot === "predicted" ? pinnedVectorIndex : null}
                tooltipVisible={activeVectorPlot === "predicted"}
                onViewportChange={setPlotViewport}
                onHoverVector={(index) => handleVectorHover("predicted", index)}
                onTogglePin={(index) => handleVectorPin("predicted", index)}
                clusterColors={clusterColors}
              />
              <VectorFieldPlot
                title={randomizedPlotTitle}
                points={displayPoints}
                vectors={gridVectorFields.randomized}
                comparisonVectors={gridVectorFields.predicted}
                referenceMagnitude={sharedVectorReferenceMagnitude}
                viewport={plotViewport}
                activeVectorIndex={activeVectorPlot === "randomized" ? activeVectorIndex : null}
                pinnedVectorIndex={pinnedVectorPlot === "randomized" ? pinnedVectorIndex : null}
                tooltipVisible={activeVectorPlot === "randomized"}
                onViewportChange={setPlotViewport}
                onHoverVector={(index) => handleVectorHover("randomized", index)}
                onTogglePin={(index) => handleVectorPin("randomized", index)}
                randomized
                clusterColors={clusterColors}
              />
            </div>
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
  const [openPanel, setOpenPanel] = useState<"form" | "history" | null>(null);
  const [isPanelClosing, setIsPanelClosing] = useState(false);
  const panelCloseTimeoutRef = useRef<number | null>(null);
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
    setOpenPanel("form");
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

  const openSheet = (kind: "form" | "history") => {
    if (panelCloseTimeoutRef.current) {
      window.clearTimeout(panelCloseTimeoutRef.current);
      panelCloseTimeoutRef.current = null;
    }
    setIsPanelClosing(false);
    setOpenPanel(kind);
  };

  const closePanel = useCallback(() => {
    if (panelCloseTimeoutRef.current) return;
    setIsPanelClosing(true);
    panelCloseTimeoutRef.current = window.setTimeout(() => {
      setOpenPanel(null);
      setIsPanelClosing(false);
      panelCloseTimeoutRef.current = null;
    }, 240);
  }, []);

  useEffect(() => {
    if (!openPanel) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePanel, openPanel]);

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
      {!displayedResult ? (
        <div className="flex items-center">
          <PerturbationRunActions
            runCount={state.runs.length}
            onOpenHistory={() => openSheet("history")}
            onOpenNewRun={() => openSheet("form")}
            historyExpanded={openPanel === "history"}
            newRunExpanded={openPanel === "form"}
          />
        </div>
      ) : null}

      {openPanel && createPortal(
        <div className="fixed inset-0 z-[80]">
          <div
            className={`absolute inset-0 bg-slate-950/40 backdrop-blur-sm ${
              isPanelClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
            }`}
            onMouseDown={closePanel}
          />
          <aside
            id="perturbation-side-panel"
            ref={openPanel === "form" ? formRef : undefined}
            role="dialog"
            aria-modal="true"
            aria-labelledby="perturbation-panel-title"
            className={`absolute inset-y-0 left-0 w-[390px] max-w-[92vw] overflow-y-auto border-r border-slate-200 bg-white p-6 shadow-[18px_0_48px_-24px_rgba(15,23,42,0.45)] ${
              isPanelClosing ? "animate-slide-out-left" : "animate-slide-in-left"
            }`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="-mx-6 -mt-6 mb-5 flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/75 px-6 py-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e8f5fa] text-[#087ead]" aria-hidden="true">
                  {openPanel === "history" ? (
                    <svg viewBox="0 0 20 20" className="h-[1.125rem] w-[1.125rem]" fill="none">
                      <path d="M10 5v5l3.25 1.8M16.5 10A6.5 6.5 0 1 1 14.6 5.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M14.5 3.5v2.75h2.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 20 20" className="h-[1.125rem] w-[1.125rem]" fill="none">
                      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.11em] text-slate-400">
                    Perturbation workspace
                  </p>
                  <h2 id="perturbation-panel-title" className="truncate text-lg font-bold text-slate-950">
                    {openPanel === "form" ? "New perturbation" : "Run history"}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Close panel"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
              >
                ✕
              </button>
            </div>

            {openPanel === "history" ? (
              <>
                <p className="mb-3 text-sm leading-6 text-slate-600">
                  Select a run to view its results.
                </p>
                <PerturbationHistoryStrip
                  runs={state.runs}
                  result={displayedResult}
                  loadingRunId={loadingHistoryRunId}
                  onSelect={(run) => {
                    void handleSelectHistoryRun(run);
                    closePanel();
                  }}
                  embedded
                />
              </>
            ) : (
              <>
                <p className="text-sm leading-6 text-slate-600">
                  Choose a regulator and set its non-negative target expression across modeled cells—0 simulates a knockout.
                </p>

                <div className="mt-5 grid gap-5">
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

                <div className="mt-6 flex flex-col gap-4 border-t border-slate-100 pt-5">
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
                    onClick={() => {
                      handleRun();
                      closePanel();
                    }}
                    disabled={!selectedGene || !isPerturbationValueValid || isExpressionProfileLoading || Boolean(activeRun) || isSubmitting}
                    className="h-12 w-full rounded-xl bg-[#087ead] px-6 text-sm font-bold text-white shadow-sm transition hover:bg-[#066b94] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {activeRun ? "Perturbation running" : isSubmitting ? "Starting…" : `Run ${selectedGene || "gene"} perturbation`}
                  </button>
                </div>
              </>
            )}
          </aside>
        </div>,
        document.body
      )}

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
        <div ref={resultViewRef} className="scroll-mt-24 rounded-[1.25rem] border border-slate-200 bg-white p-5 sm:p-6">
          <SelectedResultHeader
            result={displayedResult}
            resultScope={resultScope}
            onScopeChange={setResultScope}
            onRerunWithClipping={() => handleRerunWithClipping(displayedResult)}
            rerunDisabled={Boolean(activeRun) || isSubmitting}
            runCount={state.runs.length}
            onOpenHistory={() => openSheet("history")}
            onOpenNewRun={() => openSheet("form")}
            historyExpanded={openPanel === "history"}
            newRunExpanded={openPanel === "form"}
          />
          <ResultSummary
            key={displayedResult.run_id}
            projectId={projectId}
            result={displayedResult}
            resultScope={resultScope}
          />
        </div>
      ) : !activeRun ? (
        <div className="rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
          <h3 className="text-base font-bold text-slate-950">No perturbation results yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
            Start a run with the “New run” button above to see predicted gene changes here.
          </p>
        </div>
      ) : null}

    </section>
  );
}
