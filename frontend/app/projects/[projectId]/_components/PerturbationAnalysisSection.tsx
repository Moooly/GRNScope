"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE } from "../../../_lib/apiConfig";
import { apiFetch } from "../../../_lib/clientIdentity";
import type {
  PerturbationResult,
  PerturbationRun,
  PerturbationState,
} from "../_lib/types";


const ACTIVE_STATUSES = new Set(["Queued", "Preparing", "Running"]);
const PLOT_WIDTH = 520;
const PLOT_HEIGHT = 330;
const PLOT_PADDING = 24;

type PerturbationAnalysisSectionProps = {
  projectId: string;
  cellOracleStatus?: string | null;
};

type PlotPoint = { x: number; y: number; cluster: string };
type PlotVector = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  random_dx: number;
  random_dy: number;
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

function statusClasses(status: string) {
  if (status === "Completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Failed") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function quantile(values: number[], percentile: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile))];
}

function VectorFieldPlot({
  title,
  points,
  vectors,
  randomized = false,
}: {
  title: string;
  points: PlotPoint[];
  vectors: PlotVector[];
  randomized?: boolean;
}) {
  const allX = points.map((point) => point.x);
  const allY = points.map((point) => point.y);
  const minX = Math.min(...allX, 0);
  const maxX = Math.max(...allX, 1);
  const minY = Math.min(...allY, 0);
  const maxY = Math.max(...allY, 1);
  const xRange = Math.max(1e-9, maxX - minX);
  const yRange = Math.max(1e-9, maxY - minY);
  const plotWidth = PLOT_WIDTH - PLOT_PADDING * 2;
  const plotHeight = PLOT_HEIGHT - PLOT_PADDING * 2;
  const mapX = (value: number) => PLOT_PADDING + ((value - minX) / xRange) * plotWidth;
  const mapY = (value: number) => PLOT_HEIGHT - PLOT_PADDING - ((value - minY) / yRange) * plotHeight;

  const magnitudes = vectors.map((vector) =>
    Math.hypot(
      randomized ? vector.random_dx : vector.dx,
      randomized ? vector.random_dy : vector.dy
    )
  );
  const referenceMagnitude = Math.max(1e-9, quantile(magnitudes, 0.85));
  const arrowScale = (Math.min(plotWidth, plotHeight) * 0.055) / referenceMagnitude;

  return (
    <figure className="min-w-0 rounded-[1.25rem] border border-slate-200 bg-white p-4">
      <figcaption className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-slate-950">{title}</span>
        <span className="text-xs font-semibold text-slate-500">
          {vectors.length.toLocaleString()} sampled vectors
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
        className="h-auto w-full rounded-xl bg-[#f7fbff]"
        role="img"
        aria-label={title}
      >
        <title>{title}</title>
        {points.map((point, index) => (
          <circle
            key={`point-${index}`}
            cx={mapX(point.x)}
            cy={mapY(point.y)}
            r="1.45"
            fill="#9fb6c8"
            fillOpacity="0.38"
          />
        ))}
        {vectors.map((vector, index) => {
          const dx = randomized ? vector.random_dx : vector.dx;
          const dy = randomized ? vector.random_dy : vector.dy;
          const startX = mapX(vector.x);
          const startY = mapY(vector.y);
          const endX = startX + dx * arrowScale;
          const endY = startY - dy * arrowScale;
          const angle = Math.atan2(endY - startY, endX - startX);
          const headSize = 2.8;
          const leftX = endX - headSize * Math.cos(angle - Math.PI / 6);
          const leftY = endY - headSize * Math.sin(angle - Math.PI / 6);
          const rightX = endX - headSize * Math.cos(angle + Math.PI / 6);
          const rightY = endY - headSize * Math.sin(angle + Math.PI / 6);
          const color = randomized ? "#94a3b8" : "#087ead";
          return (
            <g key={`vector-${index}`} opacity="0.72">
              <line x1={startX} y1={startY} x2={endX} y2={endY} stroke={color} strokeWidth="1" />
              <path
                d={`M ${leftX} ${leftY} L ${endX} ${endY} L ${rightX} ${rightY}`}
                fill="none"
                stroke={color}
                strokeWidth="1"
              />
            </g>
          );
        })}
      </svg>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Arrow lengths are scaled within this panel for readability; compare the numerical shift summaries between panels.
      </p>
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
            {run.gene} knockout is {run.status.toLowerCase()}
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

function ResultSummary({ projectId, result }: { projectId: string; result: PerturbationResult }) {
  const shiftRatio =
    result.mean_random_shift_magnitude > 0
      ? result.mean_shift_magnitude / result.mean_random_shift_magnitude
      : null;

  return (
    <div className="space-y-5">
      <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#087ead]">Latest result</p>
            <h3 className="mt-2 text-xl font-bold text-slate-950">{result.gene} knockout</h3>
            <p className="mt-1 text-sm text-slate-600">
              {result.n_propagation} propagation steps · {result.cells_analyzed.toLocaleString()} cells · {result.genes_analyzed.toLocaleString()} genes
            </p>
            {result.input_cells && result.input_cells > result.cells_analyzed && (
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Cell-state projection used a reproducible sample of {result.cells_analyzed.toLocaleString()} from {result.input_cells.toLocaleString()} input cells to keep memory use bounded.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["Affected genes", "affected_genes.csv"],
              ["Cell shifts", "cell_shifts.csv"],
              ["Cluster effects", "cluster_effects.csv"],
            ].map(([label, filename]) => (
              <a
                key={filename}
                href={`${API_BASE}/projects/${projectId}/perturbations/${result.run_id}/downloads/${filename}`}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-[#087ead]/30 hover:text-[#087ead]"
              >
                {label} CSV
              </a>
            ))}
          </div>
        </div>
      </div>

      {result.ood_warning_gene_count > 0 && (
        <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <p className="text-sm font-bold">Out-of-distribution warning</p>
          <p className="mt-2 text-sm leading-6">
            {result.ood_warning_gene_count} genes exceeded CellOracle&apos;s recommended expression range. Review the affected-gene data or rerun with clipping enabled.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Mean shift", formatScientific(result.mean_shift_magnitude)],
          ["Random control", formatScientific(result.mean_random_shift_magnitude)],
          ["Shift / control", shiftRatio === null ? "—" : `${shiftRatio.toFixed(2)}×`],
          ["OOD genes", result.ood_warning_gene_count.toLocaleString()],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[1.1rem] border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
            <p className="mt-2 text-xl font-bold text-slate-950">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <VectorFieldPlot
          title={`Predicted cell-state shift: ${result.gene} KO`}
          points={result.embedding_points}
          vectors={result.vectors}
        />
        <VectorFieldPlot
          title="Randomized negative control"
          points={result.embedding_points}
          vectors={result.vectors}
          randomized
        />
      </div>

      <div className="rounded-[1.25rem] border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-950">Top affected genes</h3>
          <span className="text-xs font-semibold text-slate-500">Ranked by mean absolute change</span>
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
              {result.top_affected_genes.slice(0, 15).map((row, index) => (
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
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function PerturbationAnalysisSection({
  projectId,
  cellOracleStatus,
}: PerturbationAnalysisSectionProps) {
  const [state, setState] = useState<PerturbationState | null>(null);
  const [selectedGene, setSelectedGene] = useState("");
  const [nPropagation, setNPropagation] = useState(3);
  const [clipDeltaX, setClipDeltaX] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

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
    loadState();
  }, [loadState, cellOracleStatus]);

  const activeRun = useMemo(
    () => state?.runs.find((run) => ACTIVE_STATUSES.has(run.status)) ?? null,
    [state]
  );

  useEffect(() => {
    if (!activeRun) return;
    const timer = window.setInterval(loadState, 5000);
    return () => window.clearInterval(timer);
  }, [activeRun, loadState]);

  const handleRun = async () => {
    if (!selectedGene || isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    try {
      const response = await apiFetch(`${API_BASE}/projects/${projectId}/perturbations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gene: selectedGene,
          perturbation_value: 0,
          n_propagation: nPropagation,
          clip_delta_x: clipDeltaX,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || "The perturbation could not be started.");
      }
      await loadState();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "The perturbation could not be started.");
    } finally {
      setIsSubmitting(false);
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

  const failedRun = state.runs.find((run) => run.status === "Failed");

  return (
    <section className="space-y-5" aria-label="CellOracle perturbation analysis">
      <div className="rounded-[1.25rem] border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-lg font-bold text-slate-950">Run a CellOracle knockout</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Choose a regulator from the completed CellOracle network. The first run prepares a reusable simulation model; subsequent runs reuse it.
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Results are model-predicted cell-state responses for exploration and are not a substitute for experimental perturbation evidence.
            </p>
          </div>
          <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-700">
            CellOracle network ready
          </span>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(220px,1fr)_200px_minmax(220px,auto)] lg:items-end">
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Regulator</span>
            <select
              value={selectedGene}
              onChange={(event) => setSelectedGene(event.target.value)}
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-[#087ead] focus:ring-4 focus:ring-[#087ead]/10"
            >
              {state.eligible_genes.map((gene) => (
                <option key={gene} value={gene}>{gene}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Propagation steps</span>
            <select
              value={nPropagation}
              onChange={(event) => setNPropagation(Number(event.target.value))}
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-[#087ead] focus:ring-4 focus:ring-[#087ead]/10"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>{value}{value === 3 ? " (recommended)" : ""}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={handleRun}
            disabled={!selectedGene || Boolean(activeRun) || isSubmitting}
            className="h-12 rounded-xl bg-[#087ead] px-6 text-sm font-bold text-white shadow-sm transition hover:bg-[#066b94] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {activeRun ? "Perturbation running" : isSubmitting ? "Starting…" : `Run ${selectedGene || "gene"} knockout`}
          </button>
        </div>

        <label className="mt-4 inline-flex cursor-pointer items-start gap-3 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={clipDeltaX}
            onChange={(event) => setClipDeltaX(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#087ead]"
          />
          <span>
            Clip predictions to the observed expression range
            <span className="block text-xs leading-5 text-slate-500">Useful when an earlier run reports out-of-distribution genes.</span>
          </span>
        </label>
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

      {state.latest_result ? (
        <ResultSummary projectId={projectId} result={state.latest_result} />
      ) : !activeRun ? (
        <div className="rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
          <h3 className="text-base font-bold text-slate-950">No perturbation results yet</h3>
          <p className="mt-2 text-sm text-slate-600">Select an eligible regulator above to simulate its knockout.</p>
        </div>
      ) : null}

      {state.runs.length > 0 && (
        <div className="rounded-[1.25rem] border border-slate-200 bg-white p-5">
          <h3 className="text-base font-bold text-slate-950">Perturbation history</h3>
          <div className="mt-4 divide-y divide-slate-100">
            {state.runs.slice(0, 8).map((run) => (
              <div key={run.run_id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-950">{run.gene} knockout</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {run.n_propagation} propagation steps
                    {run.completed_at ? ` · ${formatTimestamp(run.completed_at)}` : ""}
                    {run.elapsed_seconds ? ` · ${formatElapsed(run.elapsed_seconds)}` : ""}
                  </p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusClasses(run.status)}`}>
                  {run.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
