"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadCsv,
  downloadSvg,
  downloadSvgPng,
} from "../_lib/downloads";
import DownloadMenu from "./DownloadMenu";

export type TrajectoryData = {
  available: boolean;
  reason?: string;
  pseudotime_source?: "uploaded" | "estimated";
  trajectory_method?: string | null;
  genes?: string[];
  available_genes?: string[];
  expression_label?: string;
  trend_method?: string;
  lineages?: Array<{
    name: string;
    cell_count: number;
    trends: Record<
      string,
      Array<{
        pseudotime: number;
        expression: number;
      }>
    >;
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

type ExpressionSeries = {
  name: string;
  color: string;
  trend: ChartPoint[];
};

// Okabe-Ito, extended to eight. Chosen so adjacent series stay separable under
// the common colour-vision deficiencies and none of them collide with the
// slate used for axes and UI text.
const GENE_COLORS = [
  "#0072b2",
  "#d55e00",
  "#009e73",
  "#cc79a7",
  "#e69f00",
  "#56b4e9",
  "#5d3a9b",
  "#7a4900",
];

// Light early -> deep late, so "faded" reads as the start of the trajectory
// rather than as unimportant.
const PSEUDOTIME_EARLY_RGB: [number, number, number] = [125, 211, 252];
const PSEUDOTIME_LATE_RGB: [number, number, number] = [12, 74, 110];

function formatAxisValue(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 100) return value.toFixed(0);
  if (absolute >= 10) return value.toFixed(1);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function stepDecimals(step: number) {
  for (let decimals = 0; decimals <= 6; decimals += 1) {
    const scaled = step * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return decimals;
  }
  return 6;
}

/** Ticks on 1/2/2.5/5/10 multiples, picking the step closest to `target` count. */
function niceTicks(minimum: number, maximum: number, target = 5) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) {
    return { ticks: [minimum], step: 1 };
  }
  const magnitude = 10 ** Math.floor(Math.log10((maximum - minimum) / Math.max(1, target - 1)));
  let best: { ticks: number[]; step: number } | null = null;
  let bestScore = Infinity;
  for (const multiplier of [1, 2, 2.5, 5, 10]) {
    for (const scale of [0.1, 1, 10]) {
      const step = multiplier * magnitude * scale;
      if (!(step > 0)) continue;
      const decimals = stepDecimals(step);
      const ticks: number[] = [];
      for (
        let value = Math.ceil(minimum / step - 1e-9) * step;
        value <= maximum + step * 1e-9 && ticks.length <= 24;
        value += step
      ) {
        ticks.push(Number(value.toFixed(decimals + 2)));
      }
      if (ticks.length < 2) continue;
      const score = Math.abs(ticks.length - target);
      if (score < bestScore) {
        bestScore = score;
        best = { ticks, step };
      }
    }
  }
  return best ?? { ticks: [minimum, maximum], step: maximum - minimum };
}

function formatTick(value: number, step: number) {
  return value.toFixed(stepDecimals(step));
}

function srgbToLinear(channel: number) {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number) {
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function rgbToOklab([red, green, blue]: [number, number, number]) {
  const r = srgbToLinear(red / 255);
  const g = srgbToLinear(green / 255);
  const b = srgbToLinear(blue / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ] as [number, number, number];
}

function oklabToRgb([lightness, greenRed, blueYellow]: [number, number, number]) {
  const l = (lightness + 0.3963377774 * greenRed + 0.2158037573 * blueYellow) ** 3;
  const m = (lightness - 0.1055613458 * greenRed - 0.0638541728 * blueYellow) ** 3;
  const s = (lightness - 0.0894841775 * greenRed - 1.291485548 * blueYellow) ** 3;
  const channel = (value: number) =>
    Math.round(Math.max(0, Math.min(1, linearToSrgb(value))) * 255);
  return [
    channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const PSEUDOTIME_EARLY_LAB = rgbToOklab(PSEUDOTIME_EARLY_RGB);
const PSEUDOTIME_LATE_LAB = rgbToOklab(PSEUDOTIME_LATE_RGB);

/** Interpolated in Oklab so equal pseudotime steps look like equal colour steps. */
function interpolateColor(progress: number) {
  const ratio = Math.max(0, Math.min(1, progress));
  const lab = PSEUDOTIME_EARLY_LAB.map(
    (value, index) => value + (PSEUDOTIME_LATE_LAB[index] - value) * ratio,
  ) as [number, number, number];
  return `rgb(${oklabToRgb(lab).join(",")})`;
}

const PSEUDOTIME_STOPS = Array.from({ length: 7 }, (_, index) => ({
  offset: index / 6,
  color: interpolateColor(index / 6),
}));

const PSEUDOTIME_CSS_GRADIENT = `linear-gradient(90deg, ${PSEUDOTIME_STOPS.map(
  (stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`,
).join(", ")})`;

function linearSvgPath(points: ChartPoint[]) {
  if (!points.length) return "";
  return points
    .map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`)
    .join(" ");
}

/** Catmull-Rom converted to cubic beziers, so binned paths curve instead of kinking. */
function smoothSvgPath(points: ChartPoint[]) {
  if (points.length < 3) return linearSvgPath(points);
  const round = (value: number) => Number(value.toFixed(2));
  let path = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const start = points[index];
    const end = points[index + 1];
    const next = points[index + 2] ?? end;
    const control1X = start.x + (end.x - previous.x) / 6;
    const control1Y = start.y + (end.y - previous.y) / 6;
    const control2X = end.x - (next.x - start.x) / 6;
    const control2Y = end.y - (next.y - start.y) / 6;
    path += ` C ${round(control1X)} ${round(control1Y)}, ${round(control2X)} ${round(
      control2Y,
    )}, ${round(end.x)} ${round(end.y)}`;
  }
  return path;
}

/** Nudges end-of-line labels apart while keeping their original vertical order. */
function resolveLabelPositions(
  targets: number[],
  minimumGap: number,
  minimumY: number,
  maximumY: number,
) {
  const ordered = targets
    .map((y, index) => ({ index, y }))
    .sort((left, right) => left.y - right.y);
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index].y - ordered[index - 1].y;
    if (gap < minimumGap) ordered[index].y = ordered[index - 1].y + minimumGap;
  }
  const overflow = ordered.length
    ? ordered[ordered.length - 1].y - maximumY
    : 0;
  if (overflow > 0) for (const entry of ordered) entry.y -= overflow;
  if (ordered.length && ordered[0].y < minimumY) {
    const shift = minimumY - ordered[0].y;
    for (const entry of ordered) entry.y += shift;
  }
  const resolved = new Array<number>(targets.length);
  for (const entry of ordered) resolved[entry.index] = entry.y;
  return resolved;
}

/**
 * SVG text shrinks with the viewBox, so on a phone a 12-unit label renders at
 * ~5px. Holding the chart to a minimum width and letting its own container
 * scroll keeps every label legible without measuring the viewport.
 */
const CHART_MIN_WIDTH = 640;

/**
 * The embedding canvas spans the full column at a fixed aspect. An equal-aspect
 * cloud cannot fill a landscape canvas without cropping or distortion, so the
 * leftover room is pan/zoom workspace rather than dead margin.
 */
// Deliberately landscape: the canvas fills the column width and its height
// follows from this aspect, so it never needs a height cap (which would
// letterbox the plot and pull the axes in from the edges).
const CELL_CANVAS_WIDTH = 1200;
const CELL_CANVAS_HEIGHT = 700;

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
  note,
}: {
  embedding: NonNullable<TrajectoryData["embedding"]>;
  lineageName: string;
  note: string;
}) {
  // Embedding coordinates are arbitrary, so there are no tick values to leave
  // room for: the gutters hold only the axis titles, at the canvas edge.
  const left = 30;
  const right = 18;
  const top = 16;
  const bottom = 32;
  const width = CELL_CANVAS_WIDTH;
  const height = CELL_CANVAS_HEIGHT;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [transform, setTransform] = useState({ k: 1, x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

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
  const padding = Math.max(
    (rawXMax - rawXMin) * 0.03,
    (rawYMax - rawYMin) * 0.03,
    1e-6,
  );
  const xMin = rawXMin - padding;
  const xMax = rawXMax + padding;
  const yMin = rawYMin - padding;
  const yMax = rawYMax + padding;
  // One shared scale for both axes: in an embedding, relative distance is the
  // content, so the cloud must never be stretched to fill the canvas. Whatever
  // room is left over becomes pan/zoom workspace instead.
  const xSpan = Math.max(1e-9, xMax - xMin);
  const ySpan = Math.max(1e-9, yMax - yMin);
  const unitsPerPixel = Math.max(xSpan / plotWidth, ySpan / plotHeight);
  const renderedWidth = xSpan / unitsPerPixel;
  const renderedHeight = ySpan / unitsPerPixel;
  const originX = left + (plotWidth - renderedWidth) / 2;
  const originY = top + (plotHeight - renderedHeight) / 2;
  const xPosition = (value: number) =>
    originX + ((value - xMin) / xSpan) * renderedWidth;
  const yPosition = (value: number) =>
    originY + (1 - (value - yMin) / ySpan) * renderedHeight;

  const activeValues = embedding.points
    .map((point) => point.pseudotime[lineageName])
    .filter((value): value is number => typeof value === "number");
  const pseudotimeMin = Math.min(...activeValues);
  const pseudotimeMax = Math.max(...activeValues);
  const activePath = embedding.paths.find((path) => path.name === lineageName);
  const displayedCount = activeValues.length;
  const otherLineageCount = Math.max(0, embedding.points.length - displayedCount);
  const isFittedSlingshotCurve = embedding.path_source === "slingshot_curve";
  const exportLegendExtraHeight = otherLineageCount > 0 ? 108 : 88;
  const activeChartPoints = (activePath?.points ?? []).map((point) => ({
    x: xPosition(point.x),
    y: yPosition(point.y),
  }));
  const activePathData = smoothSvgPath(activeChartPoints);
  const arrowTip = activeChartPoints.at(-1);
  const arrowFrom = activeChartPoints.at(-2) ?? arrowTip;
  const arrowAngle =
    arrowTip && arrowFrom
      ? (Math.atan2(arrowTip.y - arrowFrom.y, arrowTip.x - arrowFrom.x) * 180) /
        Math.PI
      : 0;

  const { k, x: tx, y: ty } = transform;

  // Marks are drawn inside the zoomed group, so divide by k to hold their
  // on-screen size steady while zooming.
  const strokeScale = 1 / k;
  const activeStrokeDasharray = isFittedSlingshotCurve
    ? undefined
    : `${8 * strokeScale} ${6 * strokeScale}`;
  const contextStrokeDasharray = `${5 * strokeScale} ${5 * strokeScale}`;
  const isZoomed = k > 1.001 || Math.abs(tx) > 0.5 || Math.abs(ty) > 0.5;

  /** Keeps the cloud from being dragged out of the plot area entirely. */
  const clampPan = (nextK: number, nextX: number, nextY: number) => {
    const spanX = renderedWidth * nextK;
    const spanY = renderedHeight * nextK;
    const clampAxis = (
      value: number,
      origin: number,
      span: number,
      frameStart: number,
      frameSize: number,
    ) => {
      // Smaller than the frame: pin it centred, so there is nothing to pan.
      if (span <= frameSize) {
        return frameStart + (frameSize - span) / 2 - origin * nextK;
      }
      // Larger: let it move, but never past its own edges.
      const min = frameStart + frameSize - span - origin * nextK;
      const max = frameStart - origin * nextK;
      return Math.max(min, Math.min(value, max));
    };
    return {
      x: clampAxis(nextX, originX, spanX, left, plotWidth),
      y: clampAxis(nextY, originY, spanY, top, plotHeight),
    };
  };

  const applyZoom = (factor: number, focusX: number, focusY: number) => {
    setTransform((current) => {
      const nextK = Math.max(1, Math.min(12, current.k * factor));
      if (nextK === current.k) return current;
      const ratio = nextK / current.k;
      const rawX = focusX - (focusX - current.x) * ratio;
      const rawY = focusY - (focusY - current.y) * ratio;
      return { k: nextK, ...clampPan(nextK, rawX, rawY) };
    });
  };

  /** Client coordinates -> viewBox coordinates, accounting for `meet` letterboxing. */
  const toViewBox = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const scale = Math.min(rect.width / width, rect.height / height);
    const offsetX = rect.left + (rect.width - width * scale) / 2;
    const offsetY = rect.top + (rect.height - height * scale) / 2;
    return {
      x: (clientX - offsetX) / scale,
      y: (clientY - offsetY) / scale,
    };
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // A trackpad pinch arrives as a wheel event with ctrlKey set; plain
    // two-finger scrolling does not, and is left alone so the page scrolls.
    // Registered natively because React's synthetic onWheel is passive and
    // cannot preventDefault.
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (!event.deltaY) return;
      event.preventDefault();
      const point = toViewBox(event.clientX, event.clientY);
      if (!point) return;
      applyZoom(Math.exp(-event.deltaY * 0.01), point.x, point.y);
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  });

  const zoomAboutCentre = (factor: number) =>
    applyZoom(factor, left + plotWidth / 2, top + plotHeight / 2);

  const controlClass =
    "grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-[#1b75a6]/40 hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_13rem] lg:items-start">
      {/*
        No height cap: one would letterbox the viewBox inside a wider box and
        float the axes away from the edges. The canvas aspect is wide enough
        that a full-width frame stays a sensible height on its own.
      */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-[#f8fafc]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className={`block w-full ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
          role="img"
          aria-label={`${embedding.method} cell embedding colored by ${lineageName} pseudotime, light early to deep late. Drag to pan; pinch or use the zoom controls to magnify.`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const point = toViewBox(event.clientX, event.clientY);
            if (!point) return;
            panRef.current = {
              pointerId: event.pointerId,
              startX: point.x,
              startY: point.y,
              originX: transform.x,
              originY: transform.y,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            setIsPanning(true);
          }}
          onPointerMove={(event) => {
            const pan = panRef.current;
            if (!pan || pan.pointerId !== event.pointerId) return;
            const point = toViewBox(event.clientX, event.clientY);
            if (!point) return;
            const rawX = pan.originX + (point.x - pan.startX);
            const rawY = pan.originY + (point.y - pan.startY);
            setTransform((current) => ({
              ...current,
              ...clampPan(current.k, rawX, rawY),
            }));
          }}
          onPointerUp={(event) => {
            if (panRef.current?.pointerId === event.pointerId) {
              panRef.current = null;
              setIsPanning(false);
            }
          }}
          onPointerCancel={() => {
            panRef.current = null;
            setIsPanning(false);
          }}
        >
          <defs>
            <linearGradient id="trajectory-pseudotime-export-scale" x1="0" x2="1">
              {PSEUDOTIME_STOPS.map((stop) => (
                <stop
                  key={stop.offset}
                  offset={stop.offset}
                  stopColor={stop.color}
                />
              ))}
            </linearGradient>
            <clipPath id="trajectory-plot-clip">
              <rect x={left} y={top} width={plotWidth} height={plotHeight} />
            </clipPath>
          </defs>
          <rect width={width} height={height} fill="#f8fafc" />
          <g clipPath="url(#trajectory-plot-clip)">
            <g transform={`translate(${tx} ${ty}) scale(${k})`}>
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
                    r={(isActive ? 2.8 : 1.6) * strokeScale}
                    fill={isActive ? interpolateColor(progress) : "#cbd5e1"}
                    fillOpacity={isActive ? 0.85 : 0.22}
                  >
                    <title>
                      {point.cell}
                      {isActive
                        ? ` · pseudotime ${formatAxisValue(pseudotime)}`
                        : ""}
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
                    d={smoothSvgPath(chartPoints)}
                    fill="none"
                    stroke="#cbd5e1"
                    strokeWidth={2 * strokeScale}
                    strokeDasharray={contextStrokeDasharray}
                    strokeLinecap="round"
                    opacity="0.35"
                  />
                );
              })}
              {activePath && activeChartPoints.length ? (
                <>
                  <path
                    d={activePathData}
                    fill="none"
                    stroke="white"
                    strokeWidth={(isFittedSlingshotCurve ? 7 : 6) * strokeScale}
                    strokeDasharray={activeStrokeDasharray}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.9"
                  />
                  <path
                    d={activePathData}
                    fill="none"
                    stroke="#0f789f"
                    strokeWidth={(isFittedSlingshotCurve ? 3.5 : 3) * strokeScale}
                    strokeDasharray={activeStrokeDasharray}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle
                    cx={activeChartPoints[0].x}
                    cy={activeChartPoints[0].y}
                    r={5 * strokeScale}
                    fill="white"
                    stroke="#0f789f"
                    strokeWidth={2.5 * strokeScale}
                  />
                  {arrowTip ? (
                    <polygon
                      points={`${-11},${-7} ${3},${0} ${-11},${7}`}
                      transform={`translate(${arrowTip.x} ${arrowTip.y}) rotate(${arrowAngle}) scale(${strokeScale})`}
                      fill="#0f789f"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  ) : null}
                </>
              ) : null}
            </g>
          </g>
          <text
            x={left + plotWidth / 2}
            y={height - 6}
            textAnchor="middle"
            fill="#64748b"
            fontSize="12"
            fontWeight="600"
          >
            {embedding.method} 1
          </text>
          <text
            x="12"
            y={top + plotHeight / 2}
            textAnchor="middle"
            fill="#64748b"
            fontSize="12"
            fontWeight="600"
            transform={`rotate(-90 12 ${top + plotHeight / 2})`}
          >
            {embedding.method} 2
          </text>
          <g
            data-export-only
            data-export-extra-height={exportLegendExtraHeight}
            style={{ display: "none" }}
            aria-label="Cell trajectory legend"
          >
            <line
              x1={left}
              x2={width - right}
              y1={height + 8}
              y2={height + 8}
              stroke="#e2e8f0"
            />
            <text x={left} y={height + 27} fill="#475569" fontSize="11" fontWeight="700">
              Legend
            </text>
            <text x={left} y={height + 51} fill="#64748b" fontSize="10.5" fontWeight="600">
              {formatAxisValue(pseudotimeMin)}
            </text>
            <rect
              x={left + 40}
              y={height + 42}
              width="104"
              height="9"
              rx="4.5"
              fill="url(#trajectory-pseudotime-export-scale)"
            />
            <text x={left + 152} y={height + 51} fill="#64748b" fontSize="10.5" fontWeight="600">
              {formatAxisValue(pseudotimeMax)} pseudotime
            </text>
            <line
              x1={left}
              x2={left + 34}
              y1={height + 68}
              y2={height + 68}
              stroke="#0f789f"
              strokeWidth="3"
              strokeDasharray={isFittedSlingshotCurve ? undefined : "8 6"}
              strokeLinecap="round"
            />
            <text x={left + 44} y={height + 72} fill="#334155" fontSize="10.5" fontWeight="600">
              {isFittedSlingshotCurve
                ? "Fitted Slingshot curve, arrow at late end"
                : "Pseudotime guide, arrow at late end"}
            </text>
            {otherLineageCount > 0 ? (
              <>
                <circle cx={left + 3} cy={height + 89} r="3" fill="#cbd5e1" />
                <text x={left + 44} y={height + 93} fill="#334155" fontSize="10.5" fontWeight="600">
                  Other-lineage cells
                </text>
              </>
            ) : null}
          </g>
        </svg>
      </div>

      <aside className="flex flex-col gap-5 text-xs lg:pt-1">
        <div>
          <p className="font-semibold text-slate-400">Pseudotime</p>
          <div
            className="mt-2 h-2 w-full rounded-full"
            style={{ background: PSEUDOTIME_CSS_GRADIENT }}
            aria-hidden="true"
          />
          <div className="mt-1.5 flex items-baseline justify-between text-[11px] tabular-nums text-slate-400">
            <span>{formatAxisValue(pseudotimeMin)}</span>
            <span>{formatAxisValue(pseudotimeMax)}</span>
          </div>
        </div>

        {/* Legend and counts merged: each swatch carries the number it explains. */}
        <dl className="space-y-2">
          <div className="flex items-center gap-2.5">
            <span
              className="flex w-5 shrink-0 justify-center"
              aria-hidden="true"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: interpolateColor(0.45) }}
              />
            </span>
            <dt className="flex-1 truncate text-slate-600">In {lineageName}</dt>
            <dd className="font-semibold tabular-nums text-slate-800">
              {displayedCount.toLocaleString()}
            </dd>
          </div>
          {otherLineageCount > 0 ? (
            <div className="flex items-center gap-2.5">
              <span
                className="flex w-5 shrink-0 justify-center"
                aria-hidden="true"
              >
                <span className="h-2 w-2 rounded-full bg-slate-300" />
              </span>
              <dt className="flex-1 truncate text-slate-500">Other lineages</dt>
              <dd className="font-semibold tabular-nums text-slate-500">
                {otherLineageCount.toLocaleString()}
              </dd>
            </div>
          ) : null}
          <div className="flex items-center gap-2.5">
            <span
              className="flex w-5 shrink-0 items-center justify-center gap-0.5 text-[#0f789f]"
              aria-hidden="true"
            >
              <span
                className={`inline-block w-3 border-t-2 border-[#0f789f] ${
                  isFittedSlingshotCurve ? "" : "border-dashed"
                }`}
              />
              ▸
            </span>
            <dt className="flex-1 text-slate-600">
              {isFittedSlingshotCurve ? "Fitted curve" : "Pseudotime guide"}
            </dt>
          </div>
        </dl>

        <div className="flex items-center gap-1.5 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => zoomAboutCentre(1 / 1.4)}
            disabled={k <= 1}
            className={controlClass}
            aria-label="Zoom out"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
              <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <span className="w-10 text-center font-semibold tabular-nums text-slate-600">
            {k.toFixed(1)}×
          </span>
          <button
            type="button"
            onClick={() => zoomAboutCentre(1.4)}
            disabled={k >= 12}
            className={controlClass}
            aria-label="Zoom in"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
              <path
                d="M8 3.5v9M3.5 8h9"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setTransform({ k: 1, x: 0, y: 0 })}
            disabled={!isZoomed}
            className="ml-auto rounded-lg px-2 py-1.5 font-semibold text-slate-500 transition hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Fit
          </button>
        </div>

        <p className="text-[11px] leading-4 text-slate-400">{note}</p>
      </aside>
    </div>
  );
}

function GeneTrendComparisonChart({
  series,
  pinnedGene,
  onPinnedGeneChange,
}: {
  series: ExpressionSeries[];
  pinnedGene: string | null;
  onPinnedGeneChange: (gene: string | null) => void;
}) {
  const [hoveredTrend, setHoveredTrend] = useState<{
    name: string;
    color: string;
    pseudotime: number;
    relative: number;
    expression: number;
    minimum: number;
    maximum: number;
    x: number;
    y: number;
    /** Anchor in container pixels, so the tooltip tracks horizontal scrolling. */
    anchorX: number;
    anchorY: number;
    flip: boolean;
  } | null>(null);
  const width = 820;
  const height = 380;
  const left = 58;
  // Room on the right for end-of-line gene labels, which replace the legend.
  const right = 70;
  const top = 14;
  const bottom = 40;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const allPoints = series.flatMap((item) => item.trend);
  const xValues = allPoints.map((point) => point.x);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const xPosition = (value: number) =>
    left + ((value - xMin) / Math.max(1e-9, xMax - xMin)) * (width - left - right);
  const yPosition = (value: number) =>
    top + (1 - value) * (height - top - bottom);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const { ticks: xTicks, step: xTickStep } = niceTicks(xMin, xMax, 6);
  const normalizedSeries = series.map((item) => {
    const expressionValues = item.trend.map((point) => point.y);
    const minimum = Math.min(...expressionValues);
    const maximum = Math.max(...expressionValues);
    const normalizedPoints = item.trend.map((point) => ({
      pseudotime: point.x,
      expression: point.y,
      relative:
        maximum > minimum ? (point.y - minimum) / (maximum - minimum) : 0,
    }));
    return {
      ...item,
      minimum,
      maximum,
      normalizedPoints,
      chartPoints: normalizedPoints.map((point) => ({
        x: xPosition(point.pseudotime),
        y: yPosition(point.relative),
      })),
    };
  });
  const focusedName = pinnedGene ?? hoveredTrend?.name ?? null;
  const labelY = resolveLabelPositions(
    normalizedSeries.map((item) => item.chartPoints.at(-1)?.y ?? yPosition(0)),
    14,
    top + 4,
    height - bottom,
  );

  const resolveNearest = (clientX: number, clientY: number, svg: SVGSVGElement) => {
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const chartX = ((clientX - bounds.left) / bounds.width) * width;
    const chartY = ((clientY - bounds.top) / bounds.height) * height;
    const pseudotime =
      xMin +
      ((Math.max(left, Math.min(width - right, chartX)) - left) /
        Math.max(1e-9, width - left - right)) *
        (xMax - xMin);
    let best: (typeof hoveredTrend) | null = null;
    let bestDistance = Infinity;
    for (const item of normalizedSeries) {
      if (!item.normalizedPoints.length) continue;
      const nearest = item.normalizedPoints.reduce((closest, point) =>
        Math.abs(point.pseudotime - pseudotime) <
        Math.abs(closest.pseudotime - pseudotime)
          ? point
          : closest,
      );
      const pointY = yPosition(nearest.relative);
      const distance = Math.abs(pointY - chartY);
      if (distance < bestDistance) {
        bestDistance = distance;
        const pointX = xPosition(nearest.pseudotime);
        const container = containerRef.current?.getBoundingClientRect();
        const offsetLeft = container ? bounds.left - container.left : 0;
        const offsetTop = container ? bounds.top - container.top : 0;
        best = {
          name: item.name,
          color: item.color,
          pseudotime: nearest.pseudotime,
          relative: nearest.relative,
          expression: nearest.expression,
          minimum: item.minimum,
          maximum: item.maximum,
          x: pointX,
          y: pointY,
          anchorX: offsetLeft + (pointX / width) * bounds.width,
          anchorY:
            offsetTop +
            Math.max(
              70,
              Math.min(bounds.height - 70, (pointY / height) * bounds.height),
            ),
          flip: pointX > width * 0.58,
        };
      }
    }
    return best;
  };

  return (
    <div
      ref={containerRef}
      className="relative overflow-x-auto rounded-2xl border border-slate-200 bg-white"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full"
        style={{ minWidth: CHART_MIN_WIDTH }}
        role="img"
        aria-label="Independently scaled gene-expression trend shapes over pseudotime"
        onPointerLeave={() => setHoveredTrend(null)}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={width - right}
              y1={yPosition(tick)}
              y2={yPosition(tick)}
              stroke={tick === 0 ? "#e2e8f0" : "#f1f5f9"}
            />
            <text
              x={left - 10}
              y={yPosition(tick) + 4}
              textAnchor="end"
              fill="#64748b"
              fontSize="12"
              fontWeight="600"
            >
              {formatAxisValue(tick)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text
            key={tick}
            x={xPosition(tick)}
            y={height - bottom + 16}
            textAnchor="middle"
            fill="#64748b"
            fontSize="12"
            fontWeight="600"
          >
            {formatTick(tick, xTickStep)}
          </text>
        ))}
        {hoveredTrend ? (
          <line
            x1={hoveredTrend.x}
            x2={hoveredTrend.x}
            y1={top}
            y2={height - bottom}
            stroke="#cbd5e1"
            strokeWidth="1"
          />
        ) : null}
        {normalizedSeries.map((item) => {
          const isFocused = !focusedName || focusedName === item.name;
          return (
            <path
              key={item.name}
              d={linearSvgPath(item.chartPoints)}
              fill="none"
              stroke={item.color}
              strokeWidth={focusedName === item.name ? "4" : "3"}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={isFocused ? 1 : 0.22}
              className="transition-opacity duration-150"
            />
          );
        })}
        {normalizedSeries.map((item, index) => {
          const endPoint = item.chartPoints.at(-1);
          if (!endPoint) return null;
          const isFocused = !focusedName || focusedName === item.name;
          const y = labelY[index];
          return (
            <g
              key={`${item.name}-label`}
              opacity={isFocused ? 1 : 0.24}
              className="transition-opacity duration-150"
            >
              {Math.abs(y - endPoint.y) > 2 ? (
                <polyline
                  points={`${endPoint.x},${endPoint.y} ${endPoint.x + 6},${y} ${
                    width - right + 4
                  },${y}`}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="1"
                  opacity="0.5"
                />
              ) : null}
              <text
                x={width - right + 8}
                y={y + 4}
                fill={item.color}
                fontSize="12.5"
                fontWeight="700"
              >
                {item.name}
              </text>
            </g>
          );
        })}
        {hoveredTrend ? (
          <circle
            cx={hoveredTrend.x}
            cy={hoveredTrend.y}
            r="4.5"
            fill={hoveredTrend.color}
            stroke="white"
            strokeWidth="2"
          />
        ) : null}
        <rect
          x={left}
          y={top}
          width={Math.max(0, width - left - right)}
          height={Math.max(0, height - top - bottom)}
          fill="transparent"
          className="cursor-pointer"
          onPointerMove={(event) => {
            const svg = event.currentTarget.ownerSVGElement;
            if (!svg) return;
            setHoveredTrend(resolveNearest(event.clientX, event.clientY, svg));
          }}
          onClick={(event) => {
            const svg = event.currentTarget.ownerSVGElement;
            if (!svg) return;
            const nearest = resolveNearest(event.clientX, event.clientY, svg);
            if (!nearest) return;
            onPinnedGeneChange(pinnedGene === nearest.name ? null : nearest.name);
          }}
        >
          <title>Hover to inspect a trend, click to keep it highlighted</title>
        </rect>
        <text
          x={(left + width - right) / 2}
          y={height - 8}
          textAnchor="middle"
          fill="#64748b"
          fontSize="13"
          fontWeight="600"
        >
          Pseudotime
        </text>
        <text
          x="16"
          y={(top + height - bottom) / 2}
          textAnchor="middle"
          fill="#64748b"
          fontSize="13"
          fontWeight="600"
          transform={`rotate(-90 16 ${(top + height - bottom) / 2})`}
        >
          Relative trend
        </text>
      </svg>
      {hoveredTrend ? (
        <div
          className="pointer-events-none absolute z-10 min-w-48 rounded-xl border border-slate-200 bg-white/95 px-3.5 py-3 text-xs shadow-lg backdrop-blur-sm"
          style={{
            top: hoveredTrend.anchorY,
            left: hoveredTrend.anchorX + (hoveredTrend.flip ? -14 : 14),
            transform: hoveredTrend.flip
              ? "translate(-100%, -50%)"
              : "translateY(-50%)",
          }}
        >
          <div className="flex items-center gap-2 font-extrabold text-slate-900">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: hoveredTrend.color }}
              aria-hidden="true"
            />
            {hoveredTrend.name}
          </div>
          {/*
            Two rows only. The normalised height is already readable off the
            y-axis, and pairing the fitted value with its range on one line is
            what shows how small a gene's actual span is.
          */}
          <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-slate-600">
            <dt>Pseudotime</dt>
            <dd className="text-right font-bold tabular-nums text-slate-800">
              {formatAxisValue(hoveredTrend.pseudotime)}
            </dd>
            <dt>Expression</dt>
            <dd className="text-right tabular-nums">
              <span className="font-bold text-slate-800">
                {formatAxisValue(hoveredTrend.expression)}
              </span>{" "}
              <span className="text-slate-400">
                of {formatAxisValue(hoveredTrend.minimum)}–
                {formatAxisValue(hoveredTrend.maximum)}
              </span>
            </dd>
          </dl>
        </div>
      ) : null}
      {pinnedGene ? (
        <button
          type="button"
          onClick={() => onPinnedGeneChange(null)}
          style={{ left: `${((left + 8) / width) * 100}%` }}
          className="absolute top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 text-[11px] font-bold text-slate-600 shadow-sm transition hover:text-slate-900"
        >
          {pinnedGene} pinned
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
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
  const [pinnedGene, setPinnedGene] = useState<string | null>(null);
  const cellChartRef = useRef<HTMLDivElement | null>(null);
  const geneChartRef = useRef<HTMLDivElement | null>(null);
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
      trend: (lineage.trends[gene] ?? []).map((point) => ({
        x: point.pseudotime,
        y: point.expression,
      })),
    };
  });
  const expressionLabel = trajectory.expression_label ?? "Expression";
  const hasEmbedding = Boolean(
    trajectory.embedding?.points.length && trajectory.embedding.paths.length,
  );
  const hasFittedSlingshotCurve =
    trajectory.embedding?.path_source === "slingshot_curve";
  const pseudotimeSourceLabel =
    trajectory.pseudotime_source === "estimated"
      ? "Estimated pseudotime"
      : "Uploaded pseudotime";
  const activeChartRef = mode === "cells" ? cellChartRef : geneChartRef;
  const activeFilename =
    mode === "cells" ? "cell-trajectory" : "gene-trends-over-pseudotime";
  const downloadActiveChart = async (format: "svg" | "png") => {
    const svg = activeChartRef.current?.querySelector("svg");
    if (!svg) throw new Error("The current chart is not available to download.");
    if (format === "svg") {
      downloadSvg(svg, `${activeFilename}.svg`);
    } else {
      await downloadSvgPng(svg, `${activeFilename}.png`);
    }
  };
  const downloadActiveData = () => {
    if (mode === "cells" && trajectory.embedding) {
      downloadCsv("cell-trajectory.csv", [
        ["cell", "embedding_x", "embedding_y", "lineage", "pseudotime"],
        ...trajectory.embedding.points.map((point) => [
          point.cell,
          point.x,
          point.y,
          lineage.name,
          point.pseudotime[lineage.name],
        ]),
      ]);
      return;
    }
    downloadCsv("gene-trends-over-pseudotime.csv", [
      ["gene", "pseudotime", "fitted_expression"],
      ...series.flatMap((item) =>
        item.trend.map((point) => [item.name, point.x, point.y]),
      ),
    ]);
  };

  return (
    <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5 sm:p-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-extrabold text-slate-950">
            {mode === "cells"
              ? "Cell trajectory"
              : "Gene trends over pseudotime"}
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            {mode === "cells"
              ? hasFittedSlingshotCurve
                ? `${trajectory.embedding?.method ?? "2D"} embedding colored from light early to deep late pseudotime, with the fitted Slingshot lineage curve. Both axes share one scale, so distances are undistorted.`
                : `${trajectory.embedding?.method ?? "2D"} embedding colored from light early to deep late pseudotime. The dashed line is a descriptive guide through ordered cell groups.`
              : "Relative gene-trend shapes independently scaled from 0 to 1. Compare timing and shape, not expression magnitude."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <LineageMenu
            lineages={lineages}
            value={lineage.name}
            onChange={setRequestedLineageName}
          />
          <DownloadMenu
            ariaLabel={`Download ${mode === "cells" ? "cell trajectory" : "gene trends"}`}
            items={[
              {
                label: "Chart image",
                format: "PNG",
                onSelect: () => downloadActiveChart("png"),
              },
              {
                label: "Vector chart",
                format: "SVG",
                onSelect: () => downloadActiveChart("svg"),
              },
              {
                label: "Chart values",
                format: "CSV",
                onSelect: downloadActiveData,
              },
            ]}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex items-center gap-6" role="tablist" aria-label="Trajectory visualization">
          {[
            { value: "cells" as const, label: "Cell trajectory" },
            { value: "genes" as const, label: "Gene trends" },
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
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-[#087ead]">
            {pseudotimeSourceLabel}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
            {lineage.cell_count.toLocaleString()} lineage cells
          </span>
          {mode === "cells" && trajectory.embedding ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
              {trajectory.embedding.sampled_cell_count.toLocaleString()} displayed
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        {mode === "cells" ? (
          hasEmbedding && trajectory.embedding ? (
            <div ref={cellChartRef}>
              <CellTrajectoryChart
                embedding={trajectory.embedding}
                lineageName={lineage.name}
                note={
                  hasFittedSlingshotCurve
                    ? `Slingshot's fitted principal curve, on the ${trajectory.embedding.method} coordinates it was given.`
                    : "Guide joins smoothed pseudotime-bin averages — descriptive, not a fitted Slingshot curve."
                }
              />
            </div>
          ) : (
            <EmptyTrajectory
              title="Cell embedding unavailable"
              detail="The pseudotime trends are available, but there are not enough usable cells to build the two-dimensional cell view. Expression over pseudotime can still be explored."
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
            <div ref={geneChartRef}>
              <GeneTrendComparisonChart
                series={series}
                pinnedGene={
                  pinnedGene && genes.includes(pinnedGene) ? pinnedGene : null
                }
                onPinnedGeneChange={setPinnedGene}
              />
            </div>
            <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
              Shape only: every low-complexity cubic trend is independently
              scaled from 0 to 1. Hover anywhere to read the nearest line&apos;s
              original fitted {expressionLabel.toLowerCase()} and range, and
              click to keep it highlighted; heights cannot be compared between
              genes. Pseudotime orders different cells and is not elapsed time.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
