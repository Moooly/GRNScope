"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  downloadCsv,
  downloadSvg,
  downloadSvgPng,
} from "../_lib/downloads";
import DownloadMenu from "./DownloadMenu";
import {
  CascadeHeatmap,
  GeneTrendPlot,
  LINEAGE_COLORS,
  RegulatorPathFigure,
  buildCascadeRows,
  onsetTime,
  type CascadeLineage,
  type TimingEdge,
} from "./TrajectoryFigures";

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
    /** Compact trends for the cascade heatmap (one grid, one value per point). */
    cascade?: {
      pseudotime: number[];
      expression: Record<string, number[]>;
    };
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

// Viridis: the default pseudotime scale in scanpy, Slingshot and CellRank
// figures; perceptually uniform and readable in greyscale.
const VIRIDIS: [number, number, number][] = [
  [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
  [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37],
];
const FIG_INK = "#1a1a1a";
const FIG_MUTED = "#6b7580";

function interpolateColor(progress: number) {
  const ratio = Math.max(0, Math.min(1, progress)) * (VIRIDIS.length - 1);
  const index = Math.min(VIRIDIS.length - 2, Math.floor(ratio));
  const fraction = ratio - index;
  const color = VIRIDIS[index].map((value, channel) =>
    Math.round(value + (VIRIDIS[index + 1][channel] - value) * fraction),
  );
  return `rgb(${color.join(",")})`;
}

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


/**
 * The embedding canvas spans the full column at a fixed aspect. An equal-aspect
 * cloud cannot fill a landscape canvas without cropping or distortion, so the
 * leftover room is pan/zoom workspace rather than dead margin.
 */
// Deliberately landscape: the canvas fills the column width and its height
// follows from this aspect, so it never needs a height cap (which would
// letterbox the plot and pull the axes in from the edges).
const CELL_CANVAS_WIDTH = 1200;
const CELL_CANVAS_HEIGHT = 500;

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

function TrajectoryFormula({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-slate-900 [&_math]:mx-auto [&_math]:min-w-max [&_math]:text-[1.05rem] sm:[&_math]:text-[1.15rem]">
      {children}
    </div>
  );
}

function TrajectoryHelpModal({
  mode,
  trajectory,
  lineage,
  expressionLabel,
  onClose,
}: {
  mode: "cells" | "genes" | "timing";
  trajectory: TrajectoryData;
  lineage: NonNullable<TrajectoryData["lineages"]>[number];
  expressionLabel: string;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const isCells = mode === "cells";
  const isFittedSlingshotCurve =
    trajectory.embedding?.path_source === "slingshot_curve";
  const titleId = `${mode}-trajectory-help-title`;
  const summaryId = `${mode}-trajectory-help-summary`;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/30 px-4 py-8 backdrop-blur-[2px] animate-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        className="flex max-h-[min(800px,calc(100vh-4rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl animate-modal-panel"
      >
        <header className="flex items-start justify-between gap-5 border-b border-slate-100 px-6 py-5">
          <div>
            <h3
              id={titleId}
              className="text-lg font-extrabold tracking-tight text-slate-950"
            >
              {isCells
                ? "Understanding the cell trajectory"
                : mode === "timing"
                  ? "Understanding regulator and target plots"
                  : "Understanding the expression cascade"}
            </h3>
            <p id={summaryId} className="mt-1 text-sm leading-5 text-slate-500">
              {isCells
                ? "How cells, pseudotime, lineages, and the trajectory path are displayed."
                : mode === "timing"
                  ? "How network edges are placed on the trajectory and how the lag is measured."
                  : "How gene trends are fitted, scaled, ordered, and downloaded."}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 transition hover:border-[#087ead]/30 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
            aria-label={`Close ${isCells ? "cell trajectory" : mode === "timing" ? "regulator and target" : "expression cascade"} help`}
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5 text-sm leading-6 text-slate-600">
          {isCells ? (
            <>
              <section>
                <h4 className="font-extrabold text-slate-900">How to read the view</h4>
                <ul className="mt-2 space-y-2">
                  <li>
                    <strong className="text-slate-800">Each dot is one displayed cell.</strong>{" "}
                    Colored cells belong to <strong>{lineage.name}</strong>, on the viridis
                    scale from dark purple (early) to yellow (late). Gray cells belong only to
                    other lineages and provide spatial context. The bars under the map count
                    displayed cells along pseudotime, so sparse stretches are visible.
                  </li>
                  <li>
                    <strong className="text-slate-800">Pseudotime is an ordering, not elapsed time.</strong>{" "}
                    Its units and spacing do not imply minutes, division rates, or equal
                    biological change between adjacent values.
                  </li>
                  <li>
                    The {trajectory.embedding?.method ?? "2D"} axes are embedding
                    coordinates, not pseudotime axes. Both use the same scale so the cloud
                    is not stretched; local neighborhoods are generally more meaningful
                    than long-range distances.
                  </li>
                </ul>
              </section>

              <section className="mt-5 border-t border-slate-100 pt-5">
                <h4 className="font-extrabold text-slate-900">How this map is constructed</h4>
                {isFittedSlingshotCurve ? (
                  <p className="mt-2">
                    The chart uses the saved {trajectory.embedding?.method ?? "2D"}
                    coordinates and Slingshot principal curves supplied with the project.
                    GRNScope does not refit the embedding or lineage curve in this view.
                    The solid line is that fitted curve; the open circle marks its early
                    end and the arrow marks its late end.
                  </p>
                ) : (
                  <>
                    <p className="mt-2">
                      GRNScope takes up to 700 cells while preserving coverage across every
                      lineage and its early-to-late range. It embeds the cells using the 500
                      most variable genes: missing values are replaced by the gene mean,
                      every gene is standardized and clipped to ±8, then t-SNE is used when
                      at least 25 cells are available; otherwise PCA is used as the fallback.
                    </p>
                    <p className="mt-2">
                      The dashed path is descriptive. Cells in the selected lineage are
                      rank-ordered by pseudotime, split into as many as 24 equal-count bins,
                      and each bin becomes one mean coordinate. Interior coordinates receive
                      one weighted smoothing pass before a terminal reversal, when detected,
                      is trimmed.
                    </p>
                    <TrajectoryFormula>
                      <math display="block" aria-label="Smoothed coordinate j equals coordinate j minus one plus two coordinate j plus coordinate j plus one, divided by four">
                        <mrow>
                          <msub><mi>c̃</mi><mi>j</mi></msub>
                          <mo>=</mo>
                          <mfrac>
                            <mrow>
                              <msub><mi>c</mi><mrow><mi>j</mi><mo>−</mo><mn>1</mn></mrow></msub>
                              <mo>+</mo><mn>2</mn><msub><mi>c</mi><mi>j</mi></msub>
                              <mo>+</mo><msub><mi>c</mi><mrow><mi>j</mi><mo>+</mo><mn>1</mn></mrow></msub>
                            </mrow>
                            <mn>4</mn>
                          </mfrac>
                        </mrow>
                      </math>
                    </TrajectoryFormula>
                    <p className="mt-2 text-xs text-slate-500">
                      This guide summarizes the ordering in the displayed embedding; it is
                      not a fitted Slingshot curve and should not be read as a statistical
                      trajectory model.
                    </p>
                  </>
                )}
              </section>

              <section className="mt-5 border-t border-slate-100 pt-5">
                <h4 className="font-extrabold text-slate-900">Counts and controls</h4>
                <p className="mt-2">
                  <strong>{lineage.cell_count.toLocaleString()}</strong> cells have a finite
                  pseudotime in this lineage. The chart currently contains{" "}
                  <strong>{trajectory.embedding?.sampled_cell_count.toLocaleString() ?? "0"}</strong>{" "}
                  of <strong>{trajectory.embedding?.total_cell_count.toLocaleString() ?? "0"}</strong>{" "}
                  total cells. Hover a dot for its cell ID and pseudotime; drag to pan,
                  pinch or use ± to zoom, and choose Fit to reset the view.
                </p>
              </section>

              <section className="mt-5 border-t border-slate-100 pt-5">
                <h4 className="font-extrabold text-slate-900">Downloads</h4>
                <p className="mt-2">
                  PNG and SVG export the map with its density strip and colour scale. CSV exports the displayed
                  cell IDs, embedding coordinates, selected lineage, and each cell&apos;s
                  pseudotime; blank pseudotime means the cell belongs only to another lineage.
                </p>
              </section>
            </>
          ) : mode === "timing" ? (
            <>
              <section>
                <h4 className="font-extrabold text-slate-900">What the figure shows</h4>
                <p className="mt-2">
                  Choose a target gene. The diagram on the left lists the genes with a network edge into it
                  (direct regulators). Click one to draw its curve next to the target&apos;s along{" "}
                  <strong>{lineage.name}</strong>, each scaled 0–1; this also lists the genes that regulate that
                  regulator, so a chain A → B → target can be built one step at a time. If a regulator drives its
                  target, its expression should usually change first; methods such as SCODE, SINCERITIES and SINGE
                  use this pseudotime lag to infer direction. A solid arrow means the regulator switches on first,
                  a dashed arrow that it switches on later.
                </p>
              </section>
              <section className="mt-5 border-t border-slate-100 pt-5">
                <h4 className="font-extrabold text-slate-900">Onset and lag</h4>
                <p className="mt-2">
                  A gene&apos;s onset (the open circle on its curve) is the first pseudotime, up to its peak, at
                  which its fitted trend reaches half of its range. The lag is the target&apos;s onset minus the regulator&apos;s:
                  positive means the regulator switches on first. Timing agrees with direction but does not
                  prove regulation, and repressors or genes that fall rather than rise can show other patterns.
                </p>
              </section>
              <section className="mt-5 border-t border-slate-100 pt-5">
                <h4 className="font-extrabold text-slate-900">Which edges are listed</h4>
                <p className="mt-2">
                  Directed edges from each directed method&apos;s top 100, ranked by how many methods include
                  them and then by average rank. Edges whose regulator or target barely changes along this
                  lineage are left out, because an onset cannot be measured. CSV exports every listed edge with
                  its support, sign, onsets and lag.
                </p>
              </section>
            </>
          ) : (
            <>
              <section>
                <h4 className="font-extrabold text-slate-900">What the heatmap shows</h4>
                <p className="mt-2">
                  Each row is one gene&apos;s fitted trend of <strong>{expressionLabel.toLowerCase()}</strong>{" "}
                  along pseudotime, with one panel per lineage. Rows are sorted by the pseudotime at
                  which each gene peaks in <strong>{lineage.name}</strong>, so genes that switch on in
                  sequence form a diagonal from top-left to bottom-right (an expression cascade, as in
                  CellRank and Monocle). Pseudotime is a relative progression, not elapsed time.
                </p>
                <p className="mt-2">
                  Up to 40 genes are shown: any gene you look up first, then the most variable ones.
                  Each gene has one colour scale across all lineages, so a gene that stays off along
                  a lineage is simply pale there. A gene whose trend changes by less than 10% of the
                  most dynamic gene&apos;s range along a lineage has no peak in it and is not ordered
                  by that lineage. Click a row to see the gene in real expression units in every lineage.
                </p>
              </section>

              <section className="mt-5 border-t border-slate-100 pt-5">
                <h4 className="font-extrabold text-slate-900">How each trend is fitted</h4>
                <p className="mt-2">
                  For every selected gene, cells with finite pseudotime and expression are
                  sorted by pseudotime. Cells sharing an identical pseudotime are collapsed
                  to their mean expression, while their count is retained as the fit weight.
                  The fitted curve is evaluated at 100 evenly spaced pseudotime points and
                  clipped to the gene&apos;s observed expression range.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <strong className="block text-slate-800">8+ unique values</strong>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">
                      Weighted least-squares cubic B-spline with two internal knots at the
                      ⅓ and ⅔ pseudotime quantiles.
                    </span>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <strong className="block text-slate-800">5–7 unique values</strong>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">
                      Weighted cubic smoothing spline.
                    </span>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <strong className="block text-slate-800">Fewer than 5</strong>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">
                      Linear interpolation. A failed spline fit also falls back safely.
                    </span>
                  </div>
                </div>
              </section>

              <section className="mt-5 border-t border-slate-100 pt-5">
                <h4 className="font-extrabold text-slate-900">Why every row spans 0–1</h4>
                <p className="mt-2">
                  The heatmap rescales each gene&apos;s fitted values across all lineages together: 0 is the
                  gene&apos;s lowest value in any lineage and 1 its highest. This makes activation timing
                  comparable between genes and shows in which lineage a gene is on, but deliberately
                  removes between-gene magnitude differences.
                </p>
                <TrajectoryFormula>
                  <math display="block" aria-label="Relative trend for gene g at pseudotime t equals fitted expression minus its minimum, divided by its maximum minus its minimum">
                    <mrow>
                      <msub><mi>R</mi><mi>g</mi></msub>
                      <mo stretchy="false">(</mo><mi>t</mi><mo stretchy="false">)</mo>
                      <mo>=</mo>
                      <mfrac>
                        <mrow>
                          <msub><mi>x̂</mi><mi>g</mi></msub>
                          <mo stretchy="false">(</mo><mi>t</mi><mo stretchy="false">)</mo>
                          <mo>−</mo><msub><mi>x</mi><mrow><mi>g</mi><mo>,</mo><mi>min</mi></mrow></msub>
                        </mrow>
                        <mrow>
                          <msub><mi>x</mi><mrow><mi>g</mi><mo>,</mo><mi>max</mi></mrow></msub>
                          <mo>−</mo><msub><mi>x</mi><mrow><mi>g</mi><mo>,</mo><mi>min</mi></mrow></msub>
                        </mrow>
                      </mfrac>
                    </mrow>
                  </math>
                </TrajectoryFormula>
                <p className="mt-2 text-xs text-slate-500">
                  If a fitted trend is constant, its relative value is 0 throughout. A peak
                  at 1 means that gene&apos;s own maximum—not equal absolute expression across genes.
                </p>
              </section>

              <section className="mt-5 border-t border-slate-100 pt-5">
                <h4 className="font-extrabold text-slate-900">Downloads</h4>
                <p className="mt-2">
                  PNG and SVG export the heatmap. CSV keeps the original fitted expression
                  values and the scaled 0–1 values for every gene, lineage and pseudotime
                  point, so quantitative values are not lost.
                </p>
              </section>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function CellTrajectoryChart({
  embedding,
  lineageName,
}: {
  embedding: NonNullable<TrajectoryData["embedding"]>;
  lineageName: string;
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
  const isFittedSlingshotCurve = embedding.path_source === "slingshot_curve";
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
    "grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40";

  // Cell density along pseudotime, drawn under the embedding (displayed cells).
  const DENSITY_BINS = 40;
  const densityCounts = new Array<number>(DENSITY_BINS).fill(0);
  activeValues.forEach((value) => {
    const bin = Math.min(
      DENSITY_BINS - 1,
      Math.floor(((value - pseudotimeMin) / Math.max(1e-9, pseudotimeMax - pseudotimeMin)) * DENSITY_BINS),
    );
    densityCounts[bin] += 1;
  });
  const densityMax = Math.max(1, ...densityCounts);
  const stripLeft = left + 40;
  const stripWidth = plotWidth - 80;
  const stripTop = height + 26;
  const stripHeight = 46;
  const barTop = stripTop + stripHeight + 4;
  const { ticks: pseudotimeTicks, step: pseudotimeStep } = niceTicks(pseudotimeMin, pseudotimeMax, 6);
  const stripX = (value: number) =>
    stripLeft + ((value - pseudotimeMin) / Math.max(1e-9, pseudotimeMax - pseudotimeMin)) * stripWidth;
  const totalHeight = height + 150;

  const tipLabel = (points: ChartPoint[], name: string, active: boolean) => {
    const tip = points.at(-1);
    const from = points.at(-2) ?? tip;
    if (!tip || !from) return null;
    const rightward = tip.x >= from.x;
    return (
      <text
        x={tip.x + (rightward ? -4 : 4) * strokeScale}
        y={tip.y + 22 * strokeScale}
        textAnchor={rightward ? "end" : "start"}
        fontSize={15 * strokeScale}
        fontWeight={active ? 700 : 400}
        fill={active ? FIG_INK : FIG_MUTED}
        stroke="#ffffff"
        strokeWidth={4 * strokeScale}
        paintOrder="stroke"
      >
        {name}
      </text>
    );
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${totalHeight}`}
        // Whole figure (map and cell-count strip) stays within one screen: the
        // height is capped to the viewport and the viewBox letterboxes inside.
        style={{ maxHeight: "max(460px, calc(100vh - 260px))" }}
        className={`block h-auto w-full ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
        fontFamily="Arial, Helvetica, sans-serif"
        role="img"
        aria-label={`${embedding.method} cell embedding colored by ${lineageName} pseudotime (viridis, dark early to yellow late), with cell density along pseudotime below. Drag to pan; pinch or use the zoom controls to magnify.`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const point = toViewBox(event.clientX, event.clientY);
          if (!point || point.y > height) return;
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
          <clipPath id="trajectory-plot-clip">
            <rect x={left} y={top} width={plotWidth} height={plotHeight} />
          </clipPath>
        </defs>
        <rect width={width} height={totalHeight} fill="#ffffff" />
        <g clipPath="url(#trajectory-plot-clip)">
          <g transform={`translate(${tx} ${ty}) scale(${k})`}>
            {embedding.points.map((point) => {
              if (typeof point.pseudotime[lineageName] === "number") return null;
              return (
                <circle
                  key={point.cell}
                  cx={xPosition(point.x)}
                  cy={yPosition(point.y)}
                  r={3.2 * strokeScale}
                  fill="#d6dbe0"
                >
                  <title>{`${point.cell} · not in ${lineageName}`}</title>
                </circle>
              );
            })}
            {[...embedding.points]
              .filter((point) => typeof point.pseudotime[lineageName] === "number")
              .sort((a, b) => (a.pseudotime[lineageName] as number) - (b.pseudotime[lineageName] as number))
              .map((point) => {
                const pseudotime = point.pseudotime[lineageName] as number;
                const progress =
                  (pseudotime - pseudotimeMin) / Math.max(1e-9, pseudotimeMax - pseudotimeMin);
                return (
                  <circle
                    key={point.cell}
                    cx={xPosition(point.x)}
                    cy={yPosition(point.y)}
                    r={4.2 * strokeScale}
                    fill={interpolateColor(progress)}
                    stroke="#ffffff"
                    strokeWidth={0.6 * strokeScale}
                  >
                    <title>{`${point.cell} · pseudotime ${formatAxisValue(pseudotime)}`}</title>
                  </circle>
                );
              })}
            {embedding.paths.map((path) => {
              if (path.name === lineageName) return null;
              const chartPoints = path.points.map((point) => ({
                x: xPosition(point.x),
                y: yPosition(point.y),
              }));
              const tip = chartPoints.at(-1);
              const from = chartPoints.at(-2) ?? tip;
              const angle = tip && from ? (Math.atan2(tip.y - from.y, tip.x - from.x) * 180) / Math.PI : 0;
              return (
                <g key={path.name}>
                  <path
                    d={smoothSvgPath(chartPoints)}
                    fill="none"
                    stroke="#9aa3ab"
                    strokeWidth={1.6 * strokeScale}
                    strokeDasharray={contextStrokeDasharray}
                    strokeLinecap="round"
                  />
                  {tip ? (
                    <polygon
                      points="-10,-6 2,0 -10,6"
                      transform={`translate(${tip.x} ${tip.y}) rotate(${angle}) scale(${strokeScale})`}
                      fill="#9aa3ab"
                    />
                  ) : null}
                  {tipLabel(chartPoints, path.name, false)}
                </g>
              );
            })}
            {activePath && activeChartPoints.length ? (
              <>
                <path
                  d={activePathData}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={6 * strokeScale}
                  strokeDasharray={activeStrokeDasharray}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.9"
                />
                <path
                  d={activePathData}
                  fill="none"
                  stroke={FIG_INK}
                  strokeWidth={2.6 * strokeScale}
                  strokeDasharray={activeStrokeDasharray}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle
                  cx={activeChartPoints[0].x}
                  cy={activeChartPoints[0].y}
                  r={6 * strokeScale}
                  fill="#ffffff"
                  stroke={FIG_INK}
                  strokeWidth={2 * strokeScale}
                />
                <text
                  x={activeChartPoints[0].x - 11 * strokeScale}
                  y={activeChartPoints[0].y + 5 * strokeScale}
                  textAnchor="end"
                  fontSize={15 * strokeScale}
                  fill={FIG_INK}
                  stroke="#ffffff"
                  strokeWidth={4 * strokeScale}
                  paintOrder="stroke"
                >
                  Start
                </text>
                {arrowTip ? (
                  <polygon
                    points="-13,-8 3,0 -13,8"
                    transform={`translate(${arrowTip.x} ${arrowTip.y}) rotate(${arrowAngle}) scale(${strokeScale})`}
                    fill={FIG_INK}
                    stroke="#ffffff"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                ) : null}
                {tipLabel(activeChartPoints, lineageName, true)}
              </>
            ) : null}
          </g>
        </g>

        {/* Axis arrows in the corner: embedding coordinates carry no units. */}
        <g aria-hidden="true">
          <path
            d={`M${left + 4} ${top + plotHeight - 4}h52M${left + 4} ${top + plotHeight - 4}v-52`}
            stroke={FIG_INK}
            strokeWidth="1.4"
            fill="none"
          />
          <path
            d={`M${left + 58} ${top + plotHeight - 4}l-8 -4.5v9z M${left + 4} ${top + plotHeight - 58}l-4.5 8h9z`}
            fill={FIG_INK}
          />
          <text x={left + 6} y={top + plotHeight + 14} fontSize="14" fill={FIG_MUTED}>
            {embedding.method} 1
          </text>
          <text
            transform={`translate(${left - 6} ${top + plotHeight - 6}) rotate(-90)`}
            fontSize="14"
            fill={FIG_MUTED}
          >
            {embedding.method} 2
          </text>
        </g>

        {/* Cell density along pseudotime, with the colour key as its axis. */}
        <g>
          <text x={stripLeft - 10} y={stripTop + 14} textAnchor="end" fontSize="13" fill={FIG_MUTED}>
            Cells
          </text>
          {densityCounts.map((count, index) => {
            const barWidth = stripWidth / DENSITY_BINS;
            const barHeight = (count / densityMax) * stripHeight;
            return (
              <rect
                key={index}
                x={stripLeft + index * barWidth + 0.75}
                y={stripTop + stripHeight - barHeight}
                width={Math.max(0.5, barWidth - 1.5)}
                height={barHeight}
                fill="#8e979f"
              >
                <title>{`${count} displayed cells`}</title>
              </rect>
            );
          })}
          {Array.from({ length: 80 }, (_, index) => (
            <rect
              key={index}
              x={stripLeft + (index * stripWidth) / 80}
              y={barTop}
              width={stripWidth / 80 + 0.6}
              height="11"
              fill={interpolateColor(index / 79)}
            />
          ))}
          <line x1={stripLeft} x2={stripLeft + stripWidth} y1={barTop + 11} y2={barTop + 11} stroke={FIG_INK} strokeWidth="1" />
          {pseudotimeTicks.map((tick) => (
            <g key={tick}>
              <line x1={stripX(tick)} x2={stripX(tick)} y1={barTop + 11} y2={barTop + 16} stroke={FIG_INK} strokeWidth="1" />
              <text x={stripX(tick)} y={barTop + 31} textAnchor="middle" fontSize="13" fill={FIG_INK}>
                {formatTick(tick, pseudotimeStep)}
              </text>
            </g>
          ))}
          <text x={stripLeft + stripWidth / 2} y={barTop + 50} textAnchor="middle" fontSize="14" fill={FIG_INK}>
            {`${lineageName} pseudotime`}
          </text>
        </g>
      </svg>

      <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-xl bg-white/90 p-1 text-xs shadow-sm ring-1 ring-slate-200">
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
        <span className="w-9 text-center font-semibold tabular-nums text-slate-600">{k.toFixed(1)}×</span>
        <button
          type="button"
          onClick={() => zoomAboutCentre(1.4)}
          disabled={k >= 12}
          className={controlClass}
          aria-label="Zoom in"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setTransform({ k: 1, x: 0, y: 0 })}
          disabled={!isZoomed}
          className="rounded-lg px-2 py-1.5 font-semibold text-slate-500 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Fit
        </button>
      </div>
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
  edges = [],
}: {
  trajectory?: TrajectoryData;
  loading: boolean;
  onGenesChange: (genes: string[]) => void;
  /** Directed network edges, best-supported first, for regulator timing. */
  edges?: TimingEdge[];
}) {
  const [requestedTarget, setRequestedTarget] = useState<string | null>(null);
  const [pathPicks, setPathPicks] = useState<{ key: string; direct: string[]; upstream: string[]; focus: string | null } | null>(null);
  const timingChartRef = useRef<HTMLDivElement | null>(null);
  const [requestedLineageName, setRequestedLineageName] = useState("");
  // The cascade shows every lineage; this is only which one orders its rows.
  const [cascadeSortName, setCascadeSortName] = useState("");
  const [geneQuery, setGeneQuery] = useState("");
  const [isGeneSearchOpen, setIsGeneSearchOpen] = useState(false);
  const [requestedGene, setRequestedGene] = useState<string | null>(null);
  const [helpMode, setHelpMode] = useState<"cells" | "genes" | "timing" | null>(null);
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
        (gene) => gene.toLocaleLowerCase().includes(normalizedQuery),
      )
      .sort((left, right) => {
        const leftStarts = left.toLocaleLowerCase().startsWith(normalizedQuery);
        const rightStarts = right.toLocaleLowerCase().startsWith(normalizedQuery);
        if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
        return left.localeCompare(right);
      })
      .slice(0, 8);
  }, [availableGenes, geneQuery]);
  const lineageIndex = Math.max(0, lineages.findIndex((item) => item.name === (requestedLineageName || lineages[0]?.name)));
  const cascadeLineages = useMemo<CascadeLineage[]>(
    () =>
      lineages.map((item) =>
        item.cascade?.pseudotime.length
          ? { name: item.name, pseudotime: item.cascade.pseudotime, expression: item.cascade.expression }
          : {
              name: item.name,
              pseudotime: (Object.values(item.trends)[0] ?? []).map((point) => point.pseudotime),
              expression: Object.fromEntries(
                Object.entries(item.trends).map(([gene, points]) => [gene, points.map((point) => point.expression)]),
              ),
            },
      ),
    [lineages],
  );
  const cascadeSortIndex = Math.max(0, cascadeLineages.findIndex((item) => item.name === cascadeSortName));
  const cascade = useMemo(() => buildCascadeRows(cascadeLineages, cascadeSortIndex), [cascadeLineages, cascadeSortIndex]);
  const selectedGene =
    cascade.rows.find((row) => row.gene === requestedGene)?.gene ?? cascade.rows[0]?.gene ?? null;
  const isDefaultGene = !cascade.rows.some((row) => row.gene === requestedGene);
  const timingRows = useMemo(() => {
    const current = cascadeLineages[lineageIndex];
    if (!current) return [];
    const rows = edges.flatMap((edge) => {
      const regulator = current.expression[edge.source];
      const target = current.expression[edge.target];
      if (!regulator || !target) return [];
      if (cascade.isFlat(lineageIndex, edge.source) || cascade.isFlat(lineageIndex, edge.target)) return [];
      const regulatorOnset = onsetTime(current.pseudotime, regulator);
      const targetOnset = onsetTime(current.pseudotime, target);
      if (regulatorOnset === null || targetOnset === null) return [];
      return [{ ...edge, regulatorOnset, targetOnset, lag: targetOnset - regulatorOnset }];
    });
    return rows;
  }, [cascade, cascadeLineages, edges, lineageIndex]);
  // Regulators of one target: which target, and which genes are picked for the plot.
  const onsetOf: Record<string, number> = {};
  timingRows.forEach((row) => {
    onsetOf[row.source] = row.regulatorOnset;
    onsetOf[row.target] = row.targetOnset;
  });
  const byOnset = (a: string, b: string) => onsetOf[a] - onsetOf[b] || a.localeCompare(b);
  const regulatorsOf = (gene: string) =>
    timingRows.filter((row) => row.target === gene && row.source !== gene).map((row) => row.source).sort(byOnset);
  const timingTargets = [...new Set(timingRows.map((row) => row.target))]
    .map((gene) => ({ gene, count: regulatorsOf(gene).length }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.gene.localeCompare(b.gene));
  const timingTarget = timingTargets.find((item) => item.gene === requestedTarget)?.gene ?? timingTargets[0]?.gene ?? null;
  const directRegulators = timingTarget ? regulatorsOf(timingTarget) : [];
  const upstreamOf = (gene: string) => regulatorsOf(gene).filter((source) => source !== timingTarget);
  const supportOf = (source: string, target: string) =>
    timingRows.find((row) => row.source === source && row.target === target)?.support ?? 0;
  const picksKey = `${cascadeLineages[lineageIndex]?.name ?? ""}|${timingTarget ?? ""}`;
  // Opens on the best-supported two-step path whose genes switch on in order.
  const defaultPicks = (() => {
    let best: { a: string; b: string; score: number } | null = null;
    if (timingTarget) {
      for (const b of directRegulators) {
        for (const a of upstreamOf(b)) {
          const ordered = onsetOf[a] < onsetOf[b] && onsetOf[b] < onsetOf[timingTarget];
          const score = (ordered ? 1000 : 0) + supportOf(a, b) + supportOf(b, timingTarget);
          if (!best || score > best.score) best = { a, b, score };
        }
      }
    }
    const first = best?.b ?? directRegulators[0] ?? null;
    return { direct: first ? [first] : [], upstream: best ? [`${best.a}|${best.b}`] : [], focus: first };
  })();
  const picks = pathPicks?.key === picksKey ? pathPicks : defaultPicks;
  const savePicks = (next: { direct: string[]; upstream: string[]; focus: string | null }) =>
    setPathPicks({ key: picksKey, ...next });
  const toggleDirect = (gene: string) => {
    if (!picks.direct.includes(gene)) savePicks({ ...picks, direct: [...picks.direct, gene], focus: gene });
    else if (picks.focus !== gene) savePicks({ ...picks, focus: gene });
    else {
      const direct = picks.direct.filter((item) => item !== gene);
      savePicks({ ...picks, direct, focus: direct.at(-1) ?? null });
    }
  };
  const toggleUpstream = (gene: string) => {
    const key = `${gene}|${picks.focus}`;
    savePicks({
      ...picks,
      upstream: picks.upstream.includes(key) ? picks.upstream.filter((item) => item !== key) : [...picks.upstream, key],
    });
  };
  const plottedGenes = [
    ...new Set([
      ...picks.direct,
      ...picks.upstream.map((key) => key.split("|")).filter(([, via]) => picks.direct.includes(via)).map(([gene]) => gene),
    ]),
  ]
    .filter((gene) => gene !== timingTarget)
    .sort(byOnset);
  const timingColorOrder = [...new Set([...directRegulators, ...directRegulators.flatMap(upstreamOf)])].sort(byOnset);

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

  const expressionLabel = trajectory.expression_label ?? "Expression";
  const hasEmbedding = Boolean(
    trajectory.embedding?.points.length && trajectory.embedding.paths.length,
  );
  const pseudotimeSourceLabel =
    trajectory.pseudotime_source === "estimated"
      ? "Estimated pseudotime"
      : "Uploaded pseudotime";
  type PanelKey = "cells" | "genes" | "timing";
  const chartRefOf = (panel: PanelKey) =>
    panel === "cells" ? cellChartRef : panel === "timing" ? timingChartRef : geneChartRef;
  const filenameOf = (panel: PanelKey) =>
    panel === "cells"
      ? `cell-trajectory-${lineage.name}`
      : panel === "timing"
        ? `regulators-of-${timingTarget ?? "target"}-${lineage.name}`
        : `gene-expression-cascade-by-${lineage.name}`;
  const downloadTimingCsv = () =>
    downloadCsv(`regulator-timing-${lineage.name}.csv`, [
      ["regulator", "target", "methods_supporting", "directed_methods", "sign", "regulator_onset", "target_onset", "onset_lag"],
      ...timingRows.map((row) => [
        row.source,
        row.target,
        row.support,
        row.methods,
        row.sign,
        row.regulatorOnset.toFixed(2),
        row.targetOnset.toFixed(2),
        row.lag.toFixed(2),
      ]),
    ]);
  const downloadChart = async (panel: PanelKey, format: "svg" | "png") => {
    const svg = chartRefOf(panel).current?.querySelector("svg");
    if (!svg) throw new Error("The current chart is not available to download.");
    if (format === "svg") {
      downloadSvg(svg, `${filenameOf(panel)}.svg`);
    } else {
      await downloadSvgPng(svg, `${filenameOf(panel)}.png`);
    }
  };
  const downloadData = (panel: PanelKey) => {
    if (panel === "timing") {
      downloadTimingCsv();
      return;
    }
    if (panel === "cells" && trajectory.embedding) {
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
    downloadCsv("gene-expression-cascade.csv", [
      ["gene", "lineage", "pseudotime", "fitted_expression", "scaled_0_1"],
      ...cascade.rows.flatMap((row) =>
        cascadeLineages.flatMap((item) => {
          const values = item.expression[row.gene] ?? [];
          const lo = Math.min(...values);
          const hi = Math.max(...values);
          return values.map((value, index) => [
            row.gene,
            item.name,
            item.pseudotime[index],
            value,
            hi > lo ? ((value - lo) / (hi - lo)).toFixed(4) : "",
          ]);
        }),
      ),
    ]);
  };

  const panels: Array<{
    key: "cells" | "genes" | "timing";
    title: string;
    description: string;
    chips: string[];
    actions?: ReactNode;
    body: ReactNode;
  }> = [
    {
      key: "cells",
      title: "Cell trajectory",
      description: `${trajectory.embedding?.method ?? "2D"} view of cells coloured by pseudotime, with the lineage path and cell density along pseudotime.`,
      chips: [
        pseudotimeSourceLabel,
        `${lineage.cell_count.toLocaleString()} lineage cells`,
        ...(trajectory.embedding ? [`${trajectory.embedding.sampled_cell_count.toLocaleString()} displayed`] : []),
      ],
      body: (
          hasEmbedding && trajectory.embedding ? (
            <div ref={cellChartRef}>
              <CellTrajectoryChart
                embedding={trajectory.embedding}
                lineageName={lineage.name}
              />
            </div>
          ) : (
            <EmptyTrajectory
              title="Cell embedding unavailable"
              detail="The pseudotime trends are available, but there are not enough usable cells to build the two-dimensional cell view. Expression over pseudotime can still be explored."
            />
          )
      ),
    },
    {
      key: "genes",
      title: "Gene expression cascade",
      description: lineages.length > 1
        ? "Smoothed gene trends along pseudotime, sorted by when each gene peaks. Click a lineage name to sort by that lineage."
        : "Smoothed gene trends along pseudotime, sorted by when each gene peaks.",
      chips: [],
      actions: (
          <div className="relative">
            <div className="flex h-9 w-56 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-slate-500 shadow-sm transition focus-within:border-[#087ead]/50 focus-within:ring-2 focus-within:ring-[#087ead]/10">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                id="trajectory-gene-search"
                value={geneQuery}
                onFocus={() => setIsGeneSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setIsGeneSearchOpen(false), 120)}
                onChange={(event) => {
                  setGeneQuery(event.target.value);
                  setIsGeneSearchOpen(true);
                }}
                placeholder="Find a gene"
                className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-slate-800 outline-none placeholder:text-slate-400"
                aria-label="Find a gene"
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
                        if (!cascade.rows.some((row) => row.gene === gene)) {
                          onGenesChange([...genes.filter((value) => value !== gene), gene].slice(-8));
                        }
                        setRequestedGene(gene);
                        setGeneQuery("");
                        setIsGeneSearchOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-bold text-slate-700 transition hover:bg-sky-50 hover:text-[#087ead]"
                    >
                      <span className="italic">{gene}</span>
                      {cascade.hidden.includes(gene) ? <span className="font-semibold text-slate-400">no clear trend</span> : null}
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-3 text-xs font-semibold text-slate-500">No matching genes</p>
                )}
              </div>
            ) : null}
          </div>
      ),
      body: (
          <>
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
              <div className="min-w-0">
                <div ref={geneChartRef}>
                  <CascadeHeatmap
                    lineages={cascadeLineages}
                    rows={cascade.rows}
                    selectedGene={selectedGene}
                    onSelect={setRequestedGene}
                    sortIndex={cascadeSortIndex}
                    onSortChange={(index) => setCascadeSortName(cascadeLineages[index]?.name ?? "")}
                  />
                </div>
                <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">
                  Each row is a gene&apos;s smoothed trend, scaled 0–1 across all lineages together; a diagonal from top-left to
                  bottom-right is a cascade of sequential activation. Darker blue = higher expression; a row that stays pale in one lineage means the gene is off there. The colour bar under each panel is pseudotime.
                  {cascade.hidden.length
                    ? ` No clear trend along any lineage (not shown): ${cascade.hidden.join(", ")}.`
                    : ""}
                </p>
              </div>
              {selectedGene ? (
                <aside
                  key={selectedGene}
                  className="agreement-detail flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white"
                  aria-label={`${selectedGene} details`}
                  aria-live="polite"
                >
                  <div className="border-b border-slate-100 px-5 pb-4 pt-5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#087ead]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#087ead]" aria-hidden="true" />
                        {isDefaultGene ? "Selected · earliest peak" : "Selected gene"}
                      </p>
                      {isDefaultGene ? null : (
                        <button type="button" onClick={() => setRequestedGene(null)} className="text-[11px] font-semibold text-slate-400 transition hover:text-[#087ead]">
                          Back to first
                        </button>
                      )}
                    </div>
                    <h4 className="mt-1.5 text-[17px] font-extrabold italic leading-snug text-slate-950">{selectedGene}</h4>
                    <table className="mt-4 w-full border-collapse text-[12.5px]">
                      <thead>
                        <tr className="text-[10.5px] uppercase tracking-[0.08em] text-slate-400">
                          <th className="py-1 pr-2 text-left font-semibold">Lineage</th>
                          <th className="py-1 pl-2 text-right font-semibold" title="Highest value of the smoothed trend along this lineage, in expression units">Max</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cascadeLineages.map((item, index) => {
                          const values = item.expression[selectedGene] ?? [];
                          return (
                            <tr key={item.name} className="border-t border-slate-100">
                              <td className="py-1.5 pr-2 font-semibold text-slate-700">
                                <span className="mr-2 inline-block h-0.5 w-4 align-middle" style={{ backgroundColor: LINEAGE_COLORS[index % LINEAGE_COLORS.length] }} />
                                {item.name}
                              </td>
                              <td className="py-1.5 pl-2 text-right tabular-nums text-slate-500">{values.length ? Math.max(...values).toFixed(2) : "–"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-4">
                    <GeneTrendPlot gene={selectedGene} lineages={cascadeLineages} expressionLabel={expressionLabel} />
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500">
                    <span>{expressionLabel}, fitted spline</span>
                    <button
                      type="button"
                      onClick={() =>
                        downloadCsv(`gene-trend-${selectedGene}.csv`, [
                          ["gene", "lineage", "pseudotime", "fitted_expression"],
                          ...cascadeLineages.flatMap((item) =>
                            (item.expression[selectedGene] ?? []).map((value, index) => [selectedGene, item.name, item.pseudotime[index], value]),
                          ),
                        ])
                      }
                      className="shrink-0 font-bold text-[#087ead] transition hover:text-[#06688f]"
                    >
                      CSV
                    </button>
                  </div>
                </aside>
              ) : null}
            </div>
          </>
      ),
    },
    {
      key: "timing",
      title: "Regulator and target along pseudotime",
      description: "Click the target box to choose a target, pick its regulators on the left, and compare their expression on one axis.",
      chips: [],
      body: (
          timingRows.length && timingTarget ? (
            <div className="min-w-0">
              {/* Choose on the left of the figure, read the curves on the right. */}
              <div ref={timingChartRef}>
                <RegulatorPathFigure
                  lineage={cascadeLineages[lineageIndex]}
                  target={timingTarget}
                  targets={timingTargets}
                  onTarget={setRequestedTarget}
                  direct={directRegulators}
                  upstream={picks.focus ? upstreamOf(picks.focus) : []}
                  focus={picks.focus}
                  pickedDirect={picks.direct}
                  pickedUpstream={picks.focus ? picks.upstream.filter((key) => key.endsWith(`|${picks.focus}`)).map((key) => key.split("|")[0]) : []}
                  plotted={plottedGenes}
                  colorOrder={timingColorOrder}
                  onsets={onsetOf}
                  onDirect={toggleDirect}
                  onUpstream={toggleUpstream}
                />
              </div>
            </div>
          ) : (
            <EmptyTrajectory
              title="No regulator timing to show"
              detail="Timing needs directed network edges whose regulator and target both change along this lineage. Try another lineage or include directed methods."
            />
          )
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {panels.map((panel) => (
        <section key={panel.key} className="rounded-[1.25rem] border border-slate-200 bg-white p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-extrabold text-slate-950">{panel.title}</h3>
                <button
                  type="button"
                  onClick={() => setHelpMode(panel.key)}
                  aria-label={`How to read ${panel.title.toLowerCase()}`}
                  aria-haspopup="dialog"
                  aria-controls={`${panel.key}-trajectory-help-title`}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-extrabold leading-none text-slate-500 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
                >
                  ?
                </button>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600">{panel.description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {panel.actions}
              {panel.key === "genes" ? null : (
                <LineageMenu lineages={lineages} value={lineage.name} onChange={setRequestedLineageName} />
              )}
              <DownloadMenu
                ariaLabel={`Download ${panel.title.toLowerCase()}`}
                items={[
                  { label: "Chart image", format: "PNG", onSelect: () => downloadChart(panel.key, "png") },
                  { label: "Vector chart", format: "SVG", onSelect: () => downloadChart(panel.key, "svg") },
                  { label: "Chart values", format: "CSV", onSelect: () => downloadData(panel.key) },
                ]}
              />
            </div>
          </div>
          {panel.chips.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {panel.chips.map((chip, index) => (
                <span
                  key={chip}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${index === 0 && panel.key === "cells" ? "bg-sky-50 text-[#087ead]" : "bg-slate-100 text-slate-600"}`}
                >
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-5">{panel.body}</div>
        </section>
      ))}
      {helpMode && typeof document !== "undefined" ? (
        <TrajectoryHelpModal
          mode={helpMode}
          trajectory={trajectory}
          lineage={lineage}
          expressionLabel={expressionLabel}
          onClose={() => setHelpMode(null)}
        />
      ) : null}
    </div>
  );
}
