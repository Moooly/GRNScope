"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  AggregatedEdge,
  AlgorithmCatalogItem,
  AlgorithmStoredResult,
  ProjectTask,
} from "../_lib/types";
import type { ResultsHubView } from "./ResultsHubViewSelector";
import BenchmarkInsights from "./BenchmarkInsights";
import TrajectoryInsights, {
  type TrajectoryData,
} from "./TrajectoryInsights";

export type VisualizationContext = {
  trajectory?: TrajectoryData;
  ground_truth?: {
    available: boolean;
    reason?: string;
    filename?: string;
    edge_count?: number;
    edges?: Array<{ source: string; target: string; sign?: string }>;
  };
};

type InsightView = Exclude<ResultsHubView, "network" | "perturbation">;

type ResultsInsightsSectionProps = {
  view: InsightView;
  algorithmEdgeRows: Record<string, AggregatedEdge[]>;
  algorithmMetaMap: Map<string, AlgorithmCatalogItem>;
  algorithmResults: Record<string, AlgorithmStoredResult>;
  activeAlgorithmIds: string[];
  edgeExplorerRows: AggregatedEdge[];
  selectedResultScopeId: string;
  tasks: ProjectTask[];
  visualizationContext: VisualizationContext | null;
  isContextLoading: boolean;
  onTrajectoryGenesChange: (genes: string[]) => void;
};

function plural(value: number, singular: string, pluralForm = `${singular}s`) {
  return `${value.toLocaleString()} ${value === 1 ? singular : pluralForm}`;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
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
        <div className="min-w-0 flex-1 basis-80">
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

function ExportButton({
  label = "Export CSV",
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead]"
    >
      {label}
    </button>
  );
}


type ComparisonMode = "topology" | "direction" | "sign";
type AgreementMetric = "jaccard" | "rbo" | "spearman";
type PairDetailGroup = "shared" | "first" | "second";
type EdgeExplorerSort = "confidence" | "evidence" | "support" | "edge";

const AGREEMENT_METRIC_LABELS: Record<AgreementMetric, string> = {
  jaccard: "Jaccard overlap",
  rbo: "Top-rank overlap",
  spearman: "Spearman correlation",
};

const AGREEMENT_METRIC_SHORT_LABELS: Record<AgreementMetric, string> = {
  jaccard: "Jaccard",
  rbo: "RBO",
  spearman: "Spearman",
};

const COMPARISON_MODE_LABELS: Record<ComparisonMode, string> = {
  topology: "Adjacency",
  direction: "Direction",
  sign: "Direction + sign",
};

function ComparisonSettingsMenu({
  topK,
  metric,
  mode,
  onTopKChange,
  onMetricChange,
  onModeChange,
}: {
  topK: number;
  metric: AgreementMetric;
  mode: ComparisonMode;
  onTopKChange: (value: number) => void;
  onMetricChange: (value: AgreementMetric) => void;
  onModeChange: (value: ComparisonMode) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const isDefault =
    topK === 100 && metric === "jaccard" && mode === "topology";
  const settingsSummary = `Top ${topK.toLocaleString()} · ${
    AGREEMENT_METRIC_LABELS[metric]
  } · ${COMPARISON_MODE_LABELS[mode]}`;

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setIsOpen(false);
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
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Comparison settings: ${settingsSummary}`}
        title={`Comparison settings: ${settingsSummary}`}
        className={`inline-flex h-10 items-center gap-2 rounded-full border bg-white px-4 text-sm font-semibold transition ${
          isOpen
            ? "border-[#1b75a6]/40 text-[#1b75a6] ring-4 ring-[#1b75a6]/[0.06]"
            : "border-slate-200 text-slate-600 hover:border-[#1b75a6]/30 hover:text-[#1b75a6]"
        }`}
      >
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4"
          fill="none"
          aria-hidden="true"
        >
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
          Top {topK.toLocaleString()} · {AGREEMENT_METRIC_SHORT_LABELS[metric]} ·{" "}
          {COMPARISON_MODE_LABELS[mode]}
        </span>
        <svg
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 transition-transform ${
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
          className="absolute right-0 top-full z-40 mt-1.5 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xl shadow-slate-900/15"
        >
          <div className="space-y-4">
            <SettingsSegmentGroup
              label="Top edges"
              value={String(topK)}
              options={[50, 100, 250, 500, 1000].map((value) => ({
                value: String(value),
                label: value.toLocaleString(),
              }))}
              onChange={(value) => onTopKChange(Number(value))}
            />
            <SettingsSegmentGroup
              label="Agreement metric"
              value={metric}
              options={[
                { value: "jaccard", label: "Jaccard" },
                { value: "rbo", label: "Top-rank" },
                { value: "spearman", label: "Spearman" },
              ]}
              onChange={(value) => onMetricChange(value as AgreementMetric)}
            />
            <SettingsSegmentGroup
              label="Edge identity"
              value={mode}
              options={[
                { value: "topology", label: "Adjacency" },
                { value: "direction", label: "Direction" },
                { value: "sign", label: "Direction + sign" },
              ]}
              onChange={(value) => onModeChange(value as ComparisonMode)}
            />
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <span className="text-xs font-medium text-slate-400">
              Controls this comparison
            </span>
            <button
              type="button"
              disabled={isDefault}
              onClick={() => {
                onTopKChange(100);
                onMetricChange("jaccard");
                onModeChange("topology");
              }}
              className="text-xs font-semibold text-slate-500 transition hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Restore defaults
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingsSegmentGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <div
        className="mt-1.5 flex w-full rounded-lg bg-slate-100 p-0.5"
        role="radiogroup"
        aria-label={label}
      >
        {options.map((option) => {
          const isActive = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(option.value)}
              className={`min-w-0 flex-1 rounded-md px-1.5 py-1.5 text-[11px] font-semibold leading-4 transition ${
                isActive
                  ? "bg-white text-[#1b75a6] shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function comparisonKey(edge: AggregatedEdge, mode: ComparisonMode) {
  if (mode === "topology") {
    return [edge.source, edge.target].sort().join(" — ");
  }
  if (mode === "sign") {
    return `${edge.source} → ${edge.target} | ${
      edge.sign > 0 ? "+" : edge.sign < 0 ? "−" : "?"
    }`;
  }
  return `${edge.source} → ${edge.target}`;
}

function uniqueRankedKeys(
  rows: AggregatedEdge[],
  mode: ComparisonMode,
  topK: number,
) {
  const seen = new Set<string>();
  const keys: string[] = [];
  [...rows]
    .sort((a, b) => a.rank - b.rank || b.confidence - a.confidence)
    .some((edge) => {
      const key = comparisonKey(edge, mode);
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
      return keys.length >= topK;
    });
  return keys;
}

function jaccardSimilarity(a: string[], b: string[]) {
  const first = new Set(a);
  const second = new Set(b);
  const intersection = [...first].filter((key) => second.has(key)).length;
  const union = new Set([...first, ...second]).size;
  return union ? intersection / union : 0;
}

function rankBiasedOverlap(a: string[], b: string[], persistence = 0.9) {
  const depth = Math.max(a.length, b.length);
  if (!depth) return 0;
  const first = new Set<string>();
  const second = new Set<string>();
  let weighted = 0;
  let overlapAtDepth = 0;
  for (let index = 0; index < depth; index += 1) {
    if (a[index]) first.add(a[index]);
    if (b[index]) second.add(b[index]);
    overlapAtDepth = [...first].filter((key) => second.has(key)).length;
    weighted +=
      (1 - persistence) *
      (overlapAtDepth / (index + 1)) *
      persistence ** index;
  }
  return weighted + (overlapAtDepth / depth) * persistence ** depth;
}

function spearmanSimilarity(a: string[], b: string[]) {
  const union = [...new Set([...a, ...b])];
  if (union.length < 2) return union.length ? 1 : 0;
  const firstRanks = new Map(a.map((key, index) => [key, index + 1]));
  const secondRanks = new Map(b.map((key, index) => [key, index + 1]));
  const missingRank = Math.max(a.length, b.length) + 1;
  const x = union.map((key) => firstRanks.get(key) ?? missingRank);
  const y = union.map((key) => secondRanks.get(key) ?? missingRank);
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  const numerator = x.reduce(
    (sum, value, index) => sum + (value - meanX) * (y[index] - meanY),
    0,
  );
  const denominator = Math.sqrt(
    x.reduce((sum, value) => sum + (value - meanX) ** 2, 0) *
      y.reduce((sum, value) => sum + (value - meanY) ** 2, 0),
  );
  return denominator ? numerator / denominator : 0;
}

function numericValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function selectedResultForScope(
  result: AlgorithmStoredResult | undefined,
  scopeId: string,
) {
  if (!result) return null;
  if (result.scopes?.[scopeId]?.status === "Completed") {
    return {
      confidenceSummary: result.scopes[scopeId]?.confidence_summary ?? null,
      edges: result.scopes[scopeId]?.top_edges ?? [],
    };
  }
  if (scopeId === "global") {
    return {
      confidenceSummary: result.confidence_summary ?? null,
      edges: result.top_edges ?? result.ranked_edges ?? result.edges ?? [],
    };
  }
  return null;
}

function correlation(first: number[], second: number[]) {
  if (first.length !== second.length || first.length < 2) return null;
  const meanFirst =
    first.reduce((sum, value) => sum + value, 0) / first.length;
  const meanSecond =
    second.reduce((sum, value) => sum + value, 0) / second.length;
  const covariance = first.reduce(
    (sum, value, index) =>
      sum + (value - meanFirst) * (second[index] - meanSecond),
    0,
  );
  const varianceFirst = first.reduce(
    (sum, value) => sum + (value - meanFirst) ** 2,
    0,
  );
  const varianceSecond = second.reduce(
    (sum, value) => sum + (value - meanSecond) ** 2,
    0,
  );
  const denominator = Math.sqrt(varianceFirst * varianceSecond);
  return denominator ? covariance / denominator : null;
}

function legacyRunStability(
  edges: NonNullable<ReturnType<typeof selectedResultForScope>>["edges"],
) {
  const runIds = [
    ...new Set(edges.flatMap((edge) => Object.keys(edge.run_ranks ?? {}))),
  ].sort((first, second) => {
    const firstNumber = Number(first.split("-").at(-1));
    const secondNumber = Number(second.split("-").at(-1));
    return firstNumber - secondNumber || first.localeCompare(second);
  });
  if (runIds.length < 2) return null;

  const maximumRank =
    Math.max(
      1,
      ...edges.flatMap((edge) =>
        Object.values(edge.run_ranks ?? {}).map((value) => Number(value) || 0),
      ),
    ) + 1;
  const vectors = new Map(
    runIds.map((runId) => [
      runId,
      edges.map((edge) => numericValue(edge.run_ranks?.[runId]) ?? maximumRank),
    ]),
  );
  const values: number[] = [];
  for (let firstIndex = 0; firstIndex < runIds.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < runIds.length;
      secondIndex += 1
    ) {
      const value = correlation(
        vectors.get(runIds[firstIndex]) ?? [],
        vectors.get(runIds[secondIndex]) ?? [],
      );
      if (value !== null) values.push(value);
    }
  }
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    runCount: runIds.length,
    pairCount: values.length,
    medianRho: median(values),
    madRho:
      values.reduce((sum, value) => sum + Math.abs(value - mean), 0) /
      values.length,
  };
}

function RepeatRunStabilityPanel({
  algorithmResults,
  activeAlgorithmIds,
  selectedResultScopeId,
}: {
  algorithmResults: Record<string, AlgorithmStoredResult>;
  activeAlgorithmIds: string[];
  selectedResultScopeId: string;
}) {
  const [expandedAlgorithmId, setExpandedAlgorithmId] = useState<string | null>(
    null,
  );
  const rows = useMemo(
    () =>
      activeAlgorithmIds.map((algorithmId) => {
        const selected = selectedResultForScope(
          algorithmResults[algorithmId],
          selectedResultScopeId,
        );
        const summary = selected?.confidenceSummary;
        const isGenuineBootstrap =
          summary?.resampling_scheme ===
            "cell_bootstrap_with_replacement_v1" &&
          summary?.sampling_with_replacement === true;
        const repeat = summary?.repeat_run_stability;
        const earlyStopping = summary?.early_stopping;
        const checks = (earlyStopping?.checks ?? [])
          .map((check) => ({
            runCount: Number(check.run_count) || 0,
            rho: numericValue(check.rho),
            status: check.status ?? "",
          }))
          .filter((check) => check.runCount > 0);
        const fallback = repeat ? null : legacyRunStability(selected?.edges ?? []);
        const runCount =
          numericValue(summary?.bootstrap_runs) ??
          numericValue(repeat?.run_count) ??
          fallback?.runCount ??
          0;
        const usableRunCount =
          numericValue(repeat?.usable_run_count) ??
          numericValue(repeat?.run_count) ??
          fallback?.runCount ??
          runCount;
        const medianRho =
          numericValue(repeat?.median_rho) ?? fallback?.medianRho ?? null;
        const madRho =
          numericValue(repeat?.mad_rho) ?? fallback?.madRho ?? null;
        const stopRho =
          numericValue(earlyStopping?.stop_rho) ??
          numericValue(summary?.stop_rho) ??
          0.95;
        const stopStreak =
          numericValue(earlyStopping?.stop_streak) ??
          numericValue(summary?.stop_streak) ??
          2;

        let status = "Unavailable";
        let tone = "bg-slate-100 text-slate-600";
        if (isGenuineBootstrap) {
          status = "Fixed bootstrap";
          tone = "bg-emerald-50 text-emerald-700";
        } else if (earlyStopping?.stopped_early) {
          status = "Stop rule met";
          tone = "bg-emerald-50 text-emerald-700";
        } else if (checks.length) {
          status = "Run cap reached";
          tone = "bg-amber-50 text-amber-700";
        } else if (medianRho !== null) {
          status = "Stability only";
          tone = "bg-sky-50 text-[#087ead]";
        }

        return {
          algorithmId,
          checks,
          runCount,
          usableRunCount,
          pairCount:
            numericValue(repeat?.pair_count) ?? fallback?.pairCount ?? 0,
          medianRho,
          madRho,
          stopRho,
          stopStreak,
          status,
          tone,
          isGenuineBootstrap,
          hasLegacySummary: Boolean(fallback),
        };
      }),
    [activeAlgorithmIds, algorithmResults, selectedResultScopeId],
  );

  return (
    <Panel
      title="Repeat-run stability"
      description="Spearman correlation summarizes consistency across bootstrap networks. Open a method for its run details."
    >
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="hidden grid-cols-[minmax(8rem,0.8fr)_minmax(12rem,1.4fr)_5rem_4.5rem_8rem] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400 md:grid">
          <span>Method</span>
          <span>Run-to-run stability</span>
          <span
            className="cursor-help text-right"
            tabIndex={0}
            title="Mean absolute deviation of the pairwise Spearman correlations. Lower values indicate more consistent run pairs."
            aria-label="MAD: mean absolute deviation of pairwise Spearman correlations"
          >
            MAD <span aria-hidden="true">ⓘ</span>
          </span>
          <span className="text-right">Runs</span>
          <span className="text-right">Run plan</span>
        </div>
        <div className="divide-y divide-slate-100">
          {rows.map((row, rowIndex) => {
            const normalized =
              row.medianRho === null
                ? null
                : Math.max(0, Math.min(100, ((row.medianRho + 1) / 2) * 100));
            const isExpanded = expandedAlgorithmId === row.algorithmId;
            const panelId = `stability-checks-${rowIndex}`;
            const excludedRunCount = Math.max(
              0,
              row.runCount - row.usableRunCount,
            );
            return (
              <div key={row.algorithmId}>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedAlgorithmId((current) =>
                      current === row.algorithmId ? null : row.algorithmId,
                    )
                  }
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                  className={`grid w-full cursor-pointer gap-3 px-4 py-3.5 text-left transition md:grid-cols-[minmax(8rem,0.8fr)_minmax(12rem,1.4fr)_5rem_4.5rem_8rem] md:items-center md:gap-4 ${
                    isExpanded ? "bg-slate-50/70" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm font-extrabold text-slate-900">
                      {row.algorithmId}
                    </span>
                    <svg
                      viewBox="0 0 16 16"
                      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform md:hidden ${
                        isExpanded ? "rotate-180" : ""
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
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400 md:hidden">
                      Stability
                    </span>
                    <span className="relative h-2.5 min-w-24 flex-1 rounded-full bg-gradient-to-r from-rose-100 via-slate-100 to-sky-200">
                      {normalized !== null ? (
                        <span
                          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#087ead] shadow-[0_0_0_2px_white]"
                          style={{ left: `${normalized}%` }}
                        />
                      ) : null}
                    </span>
                    <span className="w-12 text-right text-sm font-extrabold tabular-nums text-slate-800">
                      {row.medianRho === null ? "—" : row.medianRho.toFixed(3)}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-3 text-xs font-bold tabular-nums text-slate-600 md:block md:text-right">
                    <span className="font-semibold text-slate-400 md:hidden">
                      MAD
                    </span>
                    {row.madRho === null ? "—" : row.madRho.toFixed(3)}
                  </span>
                  <span className="flex items-center justify-between gap-3 text-xs font-bold tabular-nums text-slate-600 md:block md:text-right">
                    <span className="font-semibold text-slate-400 md:hidden">
                      Runs
                    </span>
                    {row.runCount || "—"}
                  </span>
                  <span className="flex items-center justify-between gap-2 md:justify-end">
                    <span className="font-semibold text-slate-400 md:hidden">
                      Run plan
                    </span>
                    <span
                      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-extrabold ${row.tone}`}
                    >
                      {row.status}
                    </span>
                    <svg
                      viewBox="0 0 16 16"
                      className={`hidden h-4 w-4 shrink-0 text-slate-400 transition-transform md:block ${
                        isExpanded ? "rotate-180" : ""
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
                  </span>
                </button>
                {isExpanded ? (
                  <div
                    id={panelId}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs"
                  >
                    {row.checks.length ? (
                      <>
                        <span className="font-bold text-slate-500">
                          Stopping checks
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {row.checks.map((check) => {
                            const passes =
                              check.rho !== null && check.rho >= row.stopRho;
                            return (
                              <span
                                key={`${row.algorithmId}-${check.runCount}`}
                                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600"
                                title={
                                  check.rho === null
                                    ? check.status || "Unavailable"
                                    : passes
                                      ? "Stop condition met"
                                      : "Below stop threshold"
                                }
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    check.rho === null
                                      ? "bg-slate-300"
                                      : passes
                                        ? "bg-emerald-500"
                                        : "bg-[#087ead]"
                                  }`}
                                />
                                Run {check.runCount}
                                <span className="tabular-nums text-slate-800">
                                  {check.rho === null
                                    ? "ρ —"
                                    : `ρ ${check.rho.toFixed(3)}`}
                                </span>
                              </span>
                            );
                          })}
                        </span>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-medium text-slate-500">
                          Rule: {row.stopStreak} consecutive{" "}
                          {row.stopStreak === 1 ? "check" : "checks"} at ρ ≥{" "}
                          {row.stopRho.toFixed(2)}
                        </span>
                      </>
                    ) : (
                      <span className="leading-5 text-slate-500">
                        {row.isGenuineBootstrap
                          ? "All planned with-replacement cell-bootstrap samples were used; data-dependent early stopping is disabled."
                          : row.hasLegacySummary
                          ? "Stopping checks were not saved; stability was reconstructed from the run rankings."
                          : "No stopping checks were saved for this result."}
                      </span>
                    )}
                    {row.medianRho !== null ? (
                      <span className="ml-auto flex items-center gap-2 whitespace-nowrap text-[11px] font-semibold text-slate-400">
                        <span>{plural(row.pairCount, "run pair")}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {excludedRunCount.toLocaleString()} excluded
                        </span>
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-500">
        <span
          className="mt-0.5 inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold text-slate-500"
          tabIndex={0}
          title="Pairwise correlations use the saved directed-edge universe. Edges missing from a run are aligned to zero; constant runs that cannot be correlated are excluded."
          aria-label="Stability calculation details"
        >
          i
        </span>
        <p>
          This measures consistency within each method. It is separate from the
          method-agreement matrix below, which compares different algorithms.
        </p>
      </div>
    </Panel>
  );
}

const EDGE_EXPLORER_PAGE_SIZE = 20;

function EdgeExplorerSettingsMenu({
  sort,
  minimumSupport,
  methodCount,
  onSortChange,
  onMinimumSupportChange,
}: {
  sort: EdgeExplorerSort;
  minimumSupport: number;
  methodCount: number;
  onSortChange: (value: EdgeExplorerSort) => void;
  onMinimumSupportChange: (value: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const sortLabels: Record<EdgeExplorerSort, string> = {
    confidence: "Confidence",
    evidence: "Evidence",
    support: "Support",
    edge: "Gene name",
  };
  const comparesMethods = methodCount > 1;

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setIsOpen(false);
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
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Edge explorer settings: ${sortLabels[sort]}${
          comparesMethods
            ? `, ${minimumSupport} or more supporting methods`
            : ""
        }`}
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
          {sortLabels[sort]}
          {comparesMethods ? ` · ≥${minimumSupport}` : ""}
        </span>
        <svg
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 transition-transform ${
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
          className="absolute right-0 top-full z-40 mt-1.5 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/15"
        >
          <SettingsSegmentGroup
            label="Rank edges by"
            value={sort}
            options={[
              { value: "confidence", label: "Confidence" },
              { value: "evidence", label: "Evidence" },
              { value: "support", label: "Support" },
              { value: "edge", label: "Gene name" },
            ]}
            onChange={(value) => onSortChange(value as EdgeExplorerSort)}
          />
          {comparesMethods ? (
            <div className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                Minimum method support
              </p>
              <div className="mt-1.5 grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
                {Array.from({ length: methodCount }).map((_, index) => {
                  const value = index + 1;
                  const isActive = minimumSupport === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onMinimumSupportChange(value)}
                      aria-pressed={isActive}
                      className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                        isActive
                          ? "bg-white text-[#1b75a6] shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {value}+
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-xs font-medium text-slate-400">
              {comparesMethods
                ? "Independent of Network filters"
                : "Uses the complete saved ranking"}
            </span>
            <button
              type="button"
              disabled={sort === "confidence" && minimumSupport === 1}
              onClick={() => {
                onSortChange("confidence");
                onMinimumSupportChange(1);
              }}
              className="text-xs font-semibold text-slate-500 transition hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Restore defaults
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ConsensusEdgeExplorer({
  rows,
  activeAlgorithmIds,
}: {
  rows: AggregatedEdge[];
  activeAlgorithmIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<EdgeExplorerSort>("confidence");
  const [minimumSupport, setMinimumSupport] = useState(1);
  const [page, setPage] = useState(1);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [methodEvidencePopover, setMethodEvidencePopover] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const methodEvidenceButtonRef = useRef<HTMLButtonElement | null>(null);
  const methodEvidencePopoverRef = useRef<HTMLDivElement | null>(null);
  const methodCount = Math.max(1, activeAlgorithmIds.length);
  const comparesMethods = activeAlgorithmIds.length >= 2;

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows
      .filter((edge) => edge.count >= minimumSupport)
      .filter(
        (edge) =>
          !normalizedQuery ||
          edge.source.toLowerCase().includes(normalizedQuery) ||
          edge.target.toLowerCase().includes(normalizedQuery) ||
          edge.supportingAlgorithms.some((algorithmId) =>
            algorithmId.toLowerCase().includes(normalizedQuery),
          ),
      )
      .sort((first, second) => {
        if (sort === "edge") {
          return (
            first.source.localeCompare(second.source) ||
            first.target.localeCompare(second.target)
          );
        }
        if (sort === "support") {
          return (
            second.count - first.count ||
            second.confidence - first.confidence ||
            first.rank - second.rank
          );
        }
        if (sort === "evidence") {
          return (
            second.score - first.score ||
            second.confidence - first.confidence ||
            first.rank - second.rank
          );
        }
        return (
          second.confidence - first.confidence ||
          second.score - first.score ||
          first.rank - second.rank
        );
      });
  }, [minimumSupport, query, rows, sort]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredRows.length / EDGE_EXPLORER_PAGE_SIZE),
  );
  const safePage = Math.min(page, totalPages);
  const visibleRows = filteredRows.slice(
    (safePage - 1) * EDGE_EXPLORER_PAGE_SIZE,
    safePage * EDGE_EXPLORER_PAGE_SIZE,
  );
  const selectedEdge =
    filteredRows.find((edge) => edge.key === selectedEdgeKey) ?? null;
  const methodEvidenceRows = useMemo(
    () =>
      selectedEdge
        ? activeAlgorithmIds
            .map((algorithmId) => ({
              algorithmId,
              evidence: selectedEdge.perAlgorithmScores[algorithmId] ?? 0,
              supports:
                selectedEdge.supportingAlgorithms.includes(algorithmId),
            }))
            .sort(
              (first, second) =>
                Number(second.supports) - Number(first.supports) ||
                second.evidence - first.evidence ||
                first.algorithmId.localeCompare(second.algorithmId),
            )
        : [],
    [activeAlgorithmIds, selectedEdge],
  );
  const previewMethodEvidenceRows = methodEvidenceRows.slice(0, 3);
  const remainingMethodCount = Math.max(0, methodEvidenceRows.length - 3);
  const title =
    comparesMethods
      ? "Consensus edge explorer"
      : "Ranked edge explorer";
  const exportPrefix = comparesMethods ? "consensus" : "ranked";

  const changeMinimumSupport = (value: number) => {
    setMinimumSupport(value);
    setPage(1);
    setSelectedEdgeKey(null);
    setMethodEvidencePopover(null);
  };
  const changeSort = (value: EdgeExplorerSort) => {
    setSort(value);
    setPage(1);
  };

  useEffect(() => {
    if (!methodEvidencePopover) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        methodEvidenceButtonRef.current?.contains(target) ||
        methodEvidencePopoverRef.current?.contains(target)
      ) {
        return;
      }
      setMethodEvidencePopover(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMethodEvidencePopover(null);
    };
    const handleViewportChange = () => setMethodEvidencePopover(null);

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [methodEvidencePopover]);
  const handleExport = () =>
    downloadCsv(`${exportPrefix}-edge-explorer.csv`, [
      [
        comparesMethods ? "consensus_rank" : "rank",
        "source",
        "target",
        comparesMethods ? "consensus_evidence" : "evidence",
        "bootstrap_confidence",
        "bootstrap_scheme",
        "bootstrap_selected_samples",
        "bootstrap_samples",
        "evidence_ci_lower",
        "evidence_ci_upper",
        "method_support",
        "supporting_methods",
        "direction",
        "direction_confidence",
        "sign",
        "sign_stability",
        "sign_coverage",
        "signed_bootstrap_recoveries",
        "sign_agreeing_recoveries",
        "bootstrap_positive_probability",
        "bootstrap_negative_probability",
      ],
      ...filteredRows.map((edge) => [
        edge.rank,
        edge.source,
        edge.target,
        edge.score.toFixed(3),
        edge.confidence.toFixed(3),
        edge.bootstrapVerified
          ? "cell_bootstrap_with_replacement_v1"
          : "legacy_subsampling",
        edge.bootstrapSelectedRuns ?? "",
        edge.bootstrapRunCount ?? "",
        edge.evidenceCiLower?.toFixed(3) ?? "",
        edge.evidenceCiUpper?.toFixed(3) ?? "",
        edge.count,
        edge.supportingAlgorithms.join("; "),
        edge.direction === 0 ? "unknown" : "source_to_target",
        edge.directionConfidence?.toFixed(3) ?? "",
        edge.sign > 0
          ? "activation"
          : edge.sign < 0
            ? "repression"
            : "unsigned",
        edge.signConfidence?.toFixed(3) ?? "",
        edge.signCoverage.toFixed(3),
        edge.bootstrapSignedSelectedRuns ?? "",
        edge.bootstrapSignAgreeingRuns ?? "",
        edge.bootstrapPositiveProbability?.toFixed(3) ?? "",
        edge.bootstrapNegativeProbability?.toFixed(3) ?? "",
      ]),
    ]);

  return (
    <>
      <Panel
      title={title}
      description={
        comparesMethods
          ? "Explore combined evidence across methods."
          : "Explore the complete ranked edge evidence from the selected method."
      }
      aside={
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <div className="relative min-w-48 flex-1 sm:flex-none">
            <svg
              viewBox="0 0 20 20"
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="m13.5 13.5 3 3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
                setSelectedEdgeKey(null);
                setMethodEvidencePopover(null);
              }}
              placeholder="Search edges"
              aria-label={comparesMethods ? "Search consensus edges" : "Search ranked edges"}
              className="h-10 w-full rounded-full border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10 sm:w-52"
            />
          </div>
          <EdgeExplorerSettingsMenu
            sort={sort}
            minimumSupport={minimumSupport}
            methodCount={methodCount}
            onSortChange={changeSort}
            onMinimumSupportChange={changeMinimumSupport}
          />
        </div>
      }
    >
      {visibleRows.length ? (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="max-h-[42rem] overflow-auto">
              <table
                className={`w-full table-fixed text-left text-sm ${
                  comparesMethods ? "min-w-[62rem]" : "min-w-[46rem]"
                }`}
              >
                <colgroup>
                  <col className="w-[6%]" />
                  <col className={comparesMethods ? "w-[28%]" : "w-[45%]"} />
                  {comparesMethods ? <col className="w-[10%]" /> : null}
                  <col className={comparesMethods ? "w-[10%]" : "w-[13%]"} />
                  {comparesMethods ? <col className="w-[10%]" /> : null}
                  <col className="w-[14%]" />
                  <col className="w-[17%]" />
                  <col className="w-[5%]" />
                </colgroup>
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-400 shadow-[0_1px_0_0_#e2e8f0]">
                  <tr>
                    <th className="px-4 py-3 text-center">Rank</th>
                    <th className="px-4 py-3">Regulation</th>
                    {comparesMethods ? (
                      <th
                        className="cursor-help px-4 py-3 text-center"
                        title="Mean normalized edge evidence across the selected methods."
                      >
                        Evidence
                      </th>
                    ) : null}
                    <th
                      className="cursor-help px-4 py-3 text-center"
                      title={
                        comparesMethods
                          ? "Median genuine bootstrap recovery across supporting methods. Legacy results are identified in each row."
                          : "Percentage of with-replacement cell-bootstrap samples that recovered this edge."
                      }
                    >
                      Bootstrap confidence
                    </th>
                    {comparesMethods ? (
                      <th className="px-4 py-3 text-center">Support</th>
                    ) : null}
                    <th
                      className="cursor-help px-4 py-3 text-center"
                      title="Confidence that the displayed source-to-target orientation is correct."
                    >
                      Direction confidence
                    </th>
                    <th
                      className="cursor-help px-4 py-3 text-center"
                      title="Predicted activation or repression, followed by agreement with that sign across signed bootstrap recoveries when available."
                    >
                      Regulatory sign
                    </th>
                    <th className="px-4 py-3 text-center">
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.map((edge) => {
                    const isSelected = edge.key === selectedEdgeKey;
                    const detailId = `edge-evidence-${edge.key.replace(
                      /[^a-zA-Z0-9_-]/g,
                      "-",
                    )}`;
                    const toggleSelected = () => {
                      setSelectedEdgeKey(isSelected ? null : edge.key);
                      setMethodEvidencePopover(null);
                    };
                    const annotation =
                      edge.sign > 0
                        ? "Activation"
                        : edge.sign < 0
                          ? "Repression"
                          : edge.direction === 0
                            ? "Undirected"
                            : "Unsigned";
                    const signConfidencePercent =
                      edge.sign !== 0 && edge.signConfidence !== null
                        ? Math.round(edge.signConfidence * 100)
                        : null;
                    const directionConfidencePercent =
                      edge.directionConfidence === null
                        ? null
                        : Math.round(edge.directionConfidence * 100);
                    return (
                      <Fragment key={edge.key}>
                        <tr
                          tabIndex={0}
                          aria-expanded={isSelected}
                          aria-controls={detailId}
                          onClick={toggleSelected}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleSelected();
                            }
                          }}
                          className={`cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#087ead]/35 ${
                            isSelected
                              ? "bg-[#f2f9fc]"
                              : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-4 py-3 text-center text-xs font-bold tabular-nums text-slate-400">
                            {edge.rank.toLocaleString(undefined, {
                              maximumFractionDigits: 1,
                            })}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-extrabold text-slate-900">
                              {edge.source}
                              <span className="px-2 text-[#087ead]">→</span>
                              {edge.target}
                            </span>
                          </td>
                          {comparesMethods ? (
                            <td className="px-4 py-3 text-center text-xs font-bold tabular-nums text-slate-600">
                              {edge.score.toFixed(3)}
                            </td>
                          ) : null}
                          <td className="px-4 py-3 text-center text-xs font-extrabold tabular-nums text-[#087ead]">
                            <span
                              title={
                                edge.bootstrapVerified
                                  ? edge.bootstrapSelectedRuns !== undefined &&
                                    edge.bootstrapRunCount !== undefined
                                    ? `Recovered in ${edge.bootstrapSelectedRuns} of ${edge.bootstrapRunCount} bootstrap samples`
                                    : "Median bootstrap recovery across supporting methods"
                                  : "Legacy subsampling result; rerun to calculate genuine bootstrap confidence"
                              }
                            >
                              {edge.bootstrapVerified
                                ? `${Math.round(edge.confidence * 100)}%`
                                : `${edge.confidence.toFixed(3)} legacy`}
                            </span>
                          </td>
                          {comparesMethods ? (
                            <td className="px-4 py-3 text-center">
                              <span className="inline-flex min-w-14 items-center justify-center rounded-full bg-sky-50 px-2 py-1 text-[11px] font-extrabold text-[#087ead]">
                                {edge.count}/{methodCount}
                              </span>
                            </td>
                          ) : null}
                          <td className="px-4 py-3 text-center text-xs font-bold tabular-nums text-slate-600">
                            {directionConfidencePercent === null
                              ? "—"
                              : `${directionConfidencePercent}%`}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                edge.sign > 0
                                  ? "bg-sky-50 text-[#0072B2]"
                                  : edge.sign < 0
                                    ? "bg-orange-50 text-[#D55E00]"
                                    : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {annotation}
                              {signConfidencePercent !== null
                                ? ` · ${signConfidencePercent}%`
                                : edge.sign !== 0
                                  ? " · no stability data"
                                  : ""}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className="inline-flex h-8 w-8 items-center justify-center text-slate-400"
                              aria-hidden="true"
                            >
                              <svg
                                viewBox="0 0 16 16"
                                className={`h-4 w-4 transition-transform ${
                                  isSelected ? "rotate-180" : ""
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
                            </span>
                          </td>
                        </tr>
                        {isSelected && selectedEdge ? (
                          <tr>
                            <td
                              id={detailId}
                              colSpan={comparesMethods ? 8 : 6}
                              className="bg-slate-50/60 px-4 py-3"
                            >
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                                <div className="flex w-full flex-wrap items-center gap-1.5">
                                  <span className="mr-1 font-semibold text-slate-500">
                                    Method evidence
                                  </span>
                                  {previewMethodEvidenceRows.map(
                                    (method, methodIndex) => (
                                      <Fragment key={method.algorithmId}>
                                        {methodIndex > 0 ? (
                                          <span
                                            className="mx-1 h-4 w-px bg-slate-200"
                                            aria-hidden="true"
                                          />
                                        ) : null}
                                        <span className="inline-flex min-w-0 items-baseline gap-2">
                                          <strong
                                            className={`max-w-32 truncate font-bold ${
                                              method.supports
                                                ? "text-slate-600"
                                                : "text-slate-400"
                                            }`}
                                            title={method.algorithmId}
                                          >
                                            {method.algorithmId}
                                          </strong>
                                          <span
                                            className={`tabular-nums ${
                                              method.supports
                                                ? "font-extrabold text-[#087ead]"
                                                : "font-semibold text-slate-400"
                                            }`}
                                          >
                                            {method.supports
                                              ? method.evidence.toFixed(3)
                                              : "No support"}
                                          </span>
                                        </span>
                                      </Fragment>
                                    ),
                                  )}
                                  {remainingMethodCount > 0 ? (
                                    <>
                                      <span
                                        className="mx-1 h-4 w-px bg-slate-200"
                                        aria-hidden="true"
                                      />
                                      <button
                                        ref={methodEvidenceButtonRef}
                                        type="button"
                                        aria-haspopup="dialog"
                                        aria-controls="method-evidence-popover"
                                        aria-expanded={Boolean(
                                          methodEvidencePopover,
                                        )}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          if (methodEvidencePopover) {
                                            setMethodEvidencePopover(null);
                                            return;
                                          }
                                          const rect =
                                            event.currentTarget.getBoundingClientRect();
                                          const width = Math.min(
                                            352,
                                            window.innerWidth - 32,
                                          );
                                          const estimatedHeight = Math.min(
                                            320,
                                            64 +
                                              Math.ceil(
                                                methodEvidenceRows.length / 2,
                                              ) *
                                                40,
                                          );
                                          const left = Math.min(
                                            window.innerWidth - width - 16,
                                            Math.max(16, rect.right - width),
                                          );
                                          const top =
                                            window.innerHeight - rect.bottom >=
                                            estimatedHeight + 12
                                              ? rect.bottom + 8
                                              : Math.max(
                                                  16,
                                                  rect.top -
                                                    estimatedHeight -
                                                    8,
                                                );
                                          setMethodEvidencePopover({
                                            top,
                                            left,
                                            width,
                                          });
                                        }}
                                        className="rounded-full px-2 py-1 font-bold text-[#087ead] transition hover:bg-sky-50"
                                      >
                                        +{remainingMethodCount} more
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1 py-1 text-xs">
            <p className="font-semibold text-slate-500">
              <span className="font-bold text-slate-700">
                {plural(filteredRows.length, "matching edge")}
              </span>
              <span className="mx-2 text-slate-300" aria-hidden="true">
                ·
              </span>
              Page {safePage} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 font-bold text-slate-600 transition hover:border-[#087ead]/35 hover:bg-[#f2f9fc] hover:text-[#087ead]"
              >
                <svg
                  viewBox="0 0 16 16"
                  className="h-4 w-4"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M8 2.5v7m0 0 2.5-2.5M8 9.5 5.5 7M3 11.5v1.25c0 .41.34.75.75.75h8.5c.41 0 .75-.34.75-.75V11.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                CSV
              </button>
              <div
                className="inline-flex h-9 items-stretch overflow-hidden rounded-full border border-slate-200 bg-white"
                role="group"
                aria-label="Edge explorer pagination"
              >
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={safePage === 1}
                  className="inline-flex w-9 items-center justify-center text-slate-500 transition hover:bg-[#f2f9fc] hover:text-[#087ead] disabled:cursor-not-allowed disabled:text-slate-300"
                  aria-label="Previous page"
                  title="Previous page"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="h-4 w-4"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="m9.5 4-4 4 4 4"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <span className="inline-flex min-w-16 items-center justify-center border-x border-slate-200 px-2 font-bold tabular-nums text-slate-600">
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                  disabled={safePage === totalPages}
                  className="inline-flex w-9 items-center justify-center text-slate-500 transition hover:bg-[#f2f9fc] hover:text-[#087ead] disabled:cursor-not-allowed disabled:text-slate-300"
                  aria-label="Next page"
                  title="Next page"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="h-4 w-4"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="m6.5 4 4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
          <p className="text-sm font-bold text-slate-800">
            No edges match these controls
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Clear the search or choose a lower minimum support.
          </p>
        </div>
      )}
      </Panel>
      {methodEvidencePopover && typeof document !== "undefined"
        ? createPortal(
            <div
              id="method-evidence-popover"
              ref={methodEvidencePopoverRef}
              role="dialog"
              aria-label="All method evidence"
              className="fixed z-[100] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/15"
              style={{
                top: methodEvidencePopover.top,
                left: methodEvidencePopover.left,
                width: methodEvidencePopover.width,
              }}
            >
              <div className="flex items-center justify-between gap-3 px-1 pb-2">
                <div>
                  <p className="text-sm font-extrabold text-slate-900">
                    Method evidence
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                    {plural(methodEvidenceRows.length, "selected method")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMethodEvidencePopover(null)}
                  aria-label="Close method evidence"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="h-4 w-4"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="m4 4 8 8m0-8-8 8"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
              <div className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                {methodEvidenceRows.map((method) => (
                  <div
                    key={method.algorithmId}
                    className={`flex min-w-0 items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-xs ${
                      method.supports ? "bg-slate-50" : "bg-slate-50/60"
                    }`}
                  >
                    <span
                      className={`truncate font-bold ${
                        method.supports ? "text-slate-700" : "text-slate-400"
                      }`}
                      title={method.algorithmId}
                    >
                      {method.algorithmId}
                    </span>
                    <span
                      className={`shrink-0 tabular-nums ${
                        method.supports
                          ? "font-extrabold text-[#087ead]"
                          : "font-semibold text-slate-400"
                      }`}
                    >
                      {method.supports
                        ? method.evidence.toFixed(3)
                        : "No support"}
                    </span>
                  </div>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function AgreementView({
  algorithmEdgeRows,
  algorithmMetaMap,
  algorithmResults,
  activeAlgorithmIds,
  edgeExplorerRows,
  selectedResultScopeId,
}: {
  algorithmEdgeRows: Record<string, AggregatedEdge[]>;
  algorithmMetaMap: Map<string, AlgorithmCatalogItem>;
  algorithmResults: Record<string, AlgorithmStoredResult>;
  activeAlgorithmIds: string[];
  edgeExplorerRows: AggregatedEdge[];
  selectedResultScopeId: string;
}) {
  const [topK, setTopK] = useState(100);
  const [metric, setMetric] = useState<AgreementMetric>("jaccard");
  const [mode, setMode] = useState<ComparisonMode>("topology");
  const [requestedPair, setRequestedPair] = useState<[string, string] | null>(null);
  const [pairDetailGroup, setPairDetailGroup] =
    useState<PairDetailGroup>("shared");

  const eligibleAlgorithmIds = useMemo(
    () =>
      activeAlgorithmIds.filter((algorithmId) => {
        const metadata = algorithmMetaMap.get(algorithmId);
        if (mode === "direction") return metadata?.directed ?? true;
        if (mode === "sign") return metadata?.signed ?? false;
        return true;
      }),
    [activeAlgorithmIds, algorithmMetaMap, mode],
  );
  const omittedAlgorithmIds = activeAlgorithmIds.filter(
    (algorithmId) => !eligibleAlgorithmIds.includes(algorithmId),
  );
  const rankedKeys = useMemo(() => {
    const values = new Map<string, string[]>();
    eligibleAlgorithmIds.forEach((algorithmId) => {
      values.set(
        algorithmId,
        uniqueRankedKeys(algorithmEdgeRows[algorithmId] ?? [], mode, topK),
      );
    });
    return values;
  }, [algorithmEdgeRows, eligibleAlgorithmIds, mode, topK]);

  const similarity = (firstId: string, secondId: string) => {
    const first = rankedKeys.get(firstId) ?? [];
    const second = rankedKeys.get(secondId) ?? [];
    if (metric === "rbo") return rankBiasedOverlap(first, second);
    if (metric === "spearman") return spearmanSimilarity(first, second);
    return jaccardSimilarity(first, second);
  };

  const selectedPair = useMemo(
    () =>
      requestedPair &&
      eligibleAlgorithmIds.includes(requestedPair[0]) &&
      eligibleAlgorithmIds.includes(requestedPair[1])
        ? requestedPair
        : null,
    [eligibleAlgorithmIds, requestedPair],
  );

  const pairDetails = useMemo(() => {
    if (!selectedPair) return null;
    const [firstId, secondId] = selectedPair;
    const first = rankedKeys.get(firstId) ?? [];
    const second = rankedKeys.get(secondId) ?? [];
    const firstSet = new Set(first);
    const secondSet = new Set(second);
    return {
      firstId,
      secondId,
      shared: first.filter((key) => secondSet.has(key)),
      firstOnly: first.filter((key) => !secondSet.has(key)),
      secondOnly: second.filter((key) => !firstSet.has(key)),
    };
  }, [rankedKeys, selectedPair]);

  const pairDetailGroups = pairDetails
    ? [
        {
          key: "shared" as const,
          label: "Shared",
          values: pairDetails.shared,
          dotClass: "bg-teal-500",
        },
        {
          key: "first" as const,
          label: `${pairDetails.firstId} only`,
          values: pairDetails.firstOnly,
          dotClass: "bg-sky-500",
        },
        {
          key: "second" as const,
          label: `${pairDetails.secondId} only`,
          values: pairDetails.secondOnly,
          dotClass: "bg-violet-500",
        },
      ]
    : [];
  const activePairDetailGroup =
    pairDetailGroups.find((group) => group.key === pairDetailGroup) ??
    pairDetailGroups[0];
  const selectedPairScore = pairDetails
    ? similarity(pairDetails.firstId, pairDetails.secondId)
    : null;

  useEffect(() => {
    if (!selectedPair) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRequestedPair(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedPair]);

  return (
    <div className="space-y-5">
      <RepeatRunStabilityPanel
        algorithmResults={algorithmResults}
        activeAlgorithmIds={activeAlgorithmIds}
        selectedResultScopeId={selectedResultScopeId}
      />
      {activeAlgorithmIds.length >= 2 ? (
      <Panel
        title="Method agreement"
        description="Compare top-ranked results across methods. Select a cell to inspect shared and method-specific edges."
        aside={
          <ComparisonSettingsMenu
            topK={topK}
            metric={metric}
            mode={mode}
            onTopKChange={setTopK}
            onMetricChange={setMetric}
            onModeChange={setMode}
          />
        }
      >
        {eligibleAlgorithmIds.length >= 2 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] border-separate border-spacing-1.5">
                <thead>
                  <tr>
                    <th />
                    {eligibleAlgorithmIds.map((algorithmId) => (
                      <th
                        key={algorithmId}
                        className="max-w-28 truncate pb-2 text-center text-xs font-bold text-slate-500"
                        title={algorithmId}
                      >
                        {algorithmId}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {eligibleAlgorithmIds.map((rowId, rowIndex) => (
                    <tr key={rowId}>
                      <th className="max-w-32 truncate pr-3 text-left text-xs font-bold text-slate-600">
                        {rowId}
                      </th>
                      {eligibleAlgorithmIds.map((columnId, columnIndex) => {
                        if (columnIndex > rowIndex) {
                          return (
                            <td
                              key={columnId}
                              className="h-12 min-w-16 rounded-lg bg-slate-50 text-center text-slate-300"
                              aria-hidden="true"
                            >
                              —
                            </td>
                          );
                        }
                        const value =
                          rowId === columnId ? 1 : similarity(rowId, columnId);
                        const normalized =
                          metric === "spearman" ? (value + 1) / 2 : value;
                        const isSelected =
                          selectedPair?.[0] === columnId &&
                          selectedPair?.[1] === rowId;
                        return (
                          <td key={columnId}>
                            <button
                              type="button"
                              disabled={rowId === columnId}
                              aria-pressed={
                                rowId === columnId ? undefined : isSelected
                              }
                              onClick={() => {
                                if (isSelected) {
                                  setRequestedPair(null);
                                  return;
                                }
                                setPairDetailGroup("shared");
                                setRequestedPair([columnId, rowId]);
                              }}
                              className={`h-12 w-full min-w-16 rounded-lg text-center text-xs font-extrabold transition ${
                                rowId === columnId
                                  ? "cursor-default"
                                  : isSelected
                                    ? "ring-2 ring-[#087ead] ring-offset-2"
                                    : "ring-offset-2 hover:ring-2 hover:ring-[#087ead]/40"
                              }`}
                              style={{
                                backgroundColor: `rgba(8, 126, 173, ${
                                  0.08 + Math.max(0, normalized) * 0.84
                                })`,
                                color: normalized > 0.55 ? "white" : "#334155",
                              }}
                              title={`${rowId} vs ${columnId}: ${value.toFixed(3)}`}
                            >
                              {value.toFixed(3)}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <p className="text-xs leading-5 text-slate-500">
                {metric === "jaccard"
                  ? "Jaccard = shared edges ÷ unique edges."
                  : metric === "rbo"
                    ? "Rank-biased overlap emphasizes agreement near the top of each ranking (p = 0.9)."
                    : "Spearman compares ranks across the union; missing edges receive the next rank."}
              </p>
              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                <span>{metric === "spearman" ? "−1" : "0"}</span>
                <span className="h-2.5 w-28 rounded-full bg-gradient-to-r from-sky-50 via-sky-400 to-[#087ead]" />
                <span>1</span>
              </div>
            </div>
            {omittedAlgorithmIds.length ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                Not included in this mode: {omittedAlgorithmIds.join(", ")}.{" "}
                {mode === "sign"
                  ? "These methods do not report edge signs."
                  : "These methods do not report direction."}
              </p>
            ) : null}
            {pairDetails && activePairDetailGroup ? (
              <section
                className="mt-5 border-t border-slate-200 pt-5"
                aria-label={`${pairDetails.firstId} and ${pairDetails.secondId} comparison details`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#087ead]">
                      Pair inspection
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-extrabold text-slate-950">
                        {pairDetails.firstId} vs {pairDetails.secondId}
                      </h4>
                      <span className="inline-flex items-center rounded-full bg-[#f2f9fc] px-2.5 py-1 text-xs font-bold tabular-nums text-[#087ead]">
                        {selectedPairScore?.toFixed(3)}{" "}
                        {AGREEMENT_METRIC_SHORT_LABELS[metric]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-medium text-slate-500">
                      Top {topK.toLocaleString()} ·{" "}
                      {COMPARISON_MODE_LABELS[mode]}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ExportButton
                      onClick={() =>
                        downloadCsv("algorithm-pair-comparison.csv", [
                          ["group", "edge"],
                          ...pairDetails.shared.map((key) => ["shared", key]),
                          ...pairDetails.firstOnly.map((key) => [
                            `${pairDetails.firstId}_only`,
                            key,
                          ]),
                          ...pairDetails.secondOnly.map((key) => [
                            `${pairDetails.secondId}_only`,
                            key,
                          ]),
                        ])
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setRequestedPair(null)}
                      aria-label="Close comparison details"
                      title="Close comparison details"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead]"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="h-3.5 w-3.5"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="m4 4 8 8m0-8-8 8"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                <div
                  className="mt-4 flex w-full rounded-xl bg-slate-100 p-1"
                  role="tablist"
                  aria-label="Pair comparison edge groups"
                >
                  {pairDetailGroups.map((group) => {
                    const isActive = group.key === activePairDetailGroup.key;
                    return (
                      <button
                        key={group.key}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-controls="pair-inspection-edge-list"
                        onClick={() => setPairDetailGroup(group.key)}
                        className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-bold transition ${
                          isActive
                            ? "bg-white text-slate-900 shadow-sm"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${group.dotClass}`}
                        />
                        <span className="truncate">{group.label}</span>
                        <span
                          className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                            isActive
                              ? "bg-[#f2f9fc] text-[#087ead]"
                              : "bg-white/80 text-slate-500"
                          }`}
                        >
                          {group.values.length}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div
                  id="pair-inspection-edge-list"
                  role="tabpanel"
                  className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${activePairDetailGroup.dotClass}`}
                      />
                      <h5 className="text-sm font-extrabold text-slate-900">
                        {activePairDetailGroup.label}
                      </h5>
                    </div>
                    <p className="text-xs font-medium text-slate-400">
                      {activePairDetailGroup.values.length > 50
                        ? `Showing first 50 of ${activePairDetailGroup.values.length.toLocaleString()}`
                        : plural(
                            activePairDetailGroup.values.length,
                            "edge",
                          )}
                    </p>
                  </div>
                  {activePairDetailGroup.values.length ? (
                    <div className="mt-2 grid max-h-52 gap-x-6 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
                      {activePairDetailGroup.values
                        .slice(0, 50)
                        .map((key) => (
                          <div
                            key={key}
                            className="flex min-w-0 items-center gap-2 border-b border-slate-100 py-2 text-xs font-semibold text-slate-700"
                          >
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${activePairDetailGroup.dotClass}`}
                            />
                            <span className="truncate" title={key}>
                              {key}
                            </span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="py-6 text-center text-sm text-slate-500">
                      No edges in this group.
                    </p>
                  )}
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <EmptyState
            title={`Not enough ${mode === "sign" ? "signed" : "directed"} methods`}
            detail="Choose another comparison mode or select more compatible algorithms."
          />
        )}
      </Panel>
      ) : null}
      <ConsensusEdgeExplorer
        rows={edgeExplorerRows}
        activeAlgorithmIds={activeAlgorithmIds}
      />
    </div>
  );
}

export default function ResultsInsightsSection({
  view,
  algorithmEdgeRows,
  algorithmMetaMap,
  algorithmResults,
  activeAlgorithmIds,
  edgeExplorerRows,
  selectedResultScopeId,
  tasks,
  visualizationContext,
  isContextLoading,
  onTrajectoryGenesChange,
}: ResultsInsightsSectionProps) {
  if (view === "agreement") {
    return (
      <AgreementView
        algorithmEdgeRows={algorithmEdgeRows}
        algorithmMetaMap={algorithmMetaMap}
        algorithmResults={algorithmResults}
        activeAlgorithmIds={activeAlgorithmIds}
        edgeExplorerRows={edgeExplorerRows}
        selectedResultScopeId={selectedResultScopeId}
      />
    );
  }
  if (view === "trajectory") {
    return (
      <TrajectoryInsights
        trajectory={visualizationContext?.trajectory}
        loading={isContextLoading}
        onGenesChange={onTrajectoryGenesChange}
      />
    );
  }
  return (
    <BenchmarkInsights
      groundTruth={visualizationContext?.ground_truth}
      loading={isContextLoading}
      algorithmEdgeRows={algorithmEdgeRows}
      algorithmMetaMap={algorithmMetaMap}
      algorithmResults={algorithmResults}
      activeAlgorithmIds={activeAlgorithmIds}
      tasks={tasks}
    />
  );
}
