"use client";

import {
  Fragment,
  useCallback,
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
import DownloadMenu from "./DownloadMenu";
import NetworkHelpModal from "./NetworkHelpModal";
import { WEBSITE_FONT_FAMILY } from "../_lib/downloads";

export type VisualizationContext = {
  trajectory?: TrajectoryData;
  ground_truth?: {
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
  titleAction,
}: {
  title: string;
  description: string;
  children: ReactNode;
  aside?: ReactNode;
  titleAction?: ReactNode;
}) {
  return (
    <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-extrabold text-slate-950">{title}</h3>
            {titleAction}
          </div>
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

function RepeatRunStabilityHelpModal({
  uniformRule,
  onClose,
}: {
  uniformRule: { stopRho: number; stopStreak: number } | null;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

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
        aria-labelledby="repeat-run-stability-help-title"
        aria-describedby="repeat-run-stability-help-summary"
        className="flex max-h-[min(760px,calc(100vh-4rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl animate-modal-panel"
      >
        <header className="flex items-start justify-between gap-5 border-b border-slate-100 px-6 py-5">
          <div>
            <h3
              id="repeat-run-stability-help-title"
              className="text-lg font-extrabold tracking-tight text-slate-950"
            >
              Understanding repeat-run stability
            </h3>
            <p
              id="repeat-run-stability-help-summary"
              className="mt-1 text-sm leading-5 text-slate-500"
            >
              A consistency check for the networks produced by repeated
              bootstrap samples.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 transition hover:border-[#087ead]/30 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
            aria-label="Close repeat-run stability help"
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5 text-sm leading-6 text-slate-600">
          <section>
            <h4 className="font-extrabold text-slate-900">How to read the table</h4>
            <ul className="mt-2 space-y-2">
              <li className="flex gap-3">
                <span
                  className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-white bg-[#087ead] shadow-sm"
                  aria-hidden="true"
                />
                <span>
                  The <strong className="text-slate-800">blue dot</strong> is
                  the median pairwise Spearman ρ. Values near 1 mean the run
                  rankings are very similar; values near 0 mean little rank
                  consistency, and negative values mean reversed rankings.
                </span>
              </li>
              <li className="flex gap-3">
                <span
                  className="mt-[0.65rem] h-1 w-7 shrink-0 rounded-full bg-[#8fc4d8]"
                  aria-hidden="true"
                />
                <span>
                  The <strong className="text-slate-800">light bar</strong>{" "}
                  shows ± mean absolute deviation. A shorter bar means the
                  pairwise correlations are more tightly grouped.
                </span>
              </li>
              <li className="flex gap-3">
                <span
                  className="mt-1.5 inline-flex h-4 min-w-7 shrink-0 items-center justify-center rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500"
                  aria-hidden="true"
                >
                  runs
                </span>
                <span>
                  <strong className="text-slate-800">Bootstrap runs</strong>{" "}
                  is the number completed. “Stopped early” means the aggregate
                  ranking met the stability rule before the run cap.
                </span>
              </li>
            </ul>
          </section>

          <section className="mt-5 border-t border-slate-100 pt-5">
            <h4 className="font-extrabold text-slate-900">How values are calculated</h4>
            <p className="mt-2">
              For each algorithm, we align every usable pair of bootstrap runs
              on the union of their directed edges. An edge missing from one
              run receives a score of 0. We then calculate Spearman rank
              correlation for every run pair and report the median ρ.
            </p>
            <p className="mt-2">
              The deviation is the average absolute distance of those pairwise
              ρ values from their mean. Runs without enough edges or rank
              variation cannot produce a correlation and are excluded.
            </p>
          </section>

          <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h4 className="font-extrabold text-slate-900">Brief example</h4>
            <p className="mt-2">
              Suppose the correlations between three run pairs are 0.95, 0.96,
              and 0.97. The blue dot is their median, 0.96, and the mean
              absolute deviation is about 0.007—so the light bar is short and
              the runs are consistently ranked.
            </p>
            <h5 className="mt-4 font-bold text-slate-800">
              How consecutive checks work
            </h5>
            <p className="mt-1">
              After each bootstrap run, we rebuild one cumulative
              edge-confidence ranking using every run completed so far. We
              then calculate Spearman ρ between that new aggregate and the
              immediately previous aggregate—not directly between the two raw
              bootstrap runs. Edges found in only one snapshot are aligned with
              confidence 0 in the other.
            </p>
            <ol className="mt-3 grid gap-2 text-xs leading-5 sm:grid-cols-3">
              <li className="rounded-lg border border-slate-200 bg-white p-3">
                <span className="block font-bold text-slate-800">After Run 1</span>
                Build the first aggregate from Run 1. There is no earlier
                aggregate to score yet.
              </li>
              <li className="rounded-lg border border-slate-200 bg-white p-3">
                <span className="block font-bold text-slate-800">Run 2 check</span>
                Compare the Run 1–2 aggregate with the Run 1 aggregate. If ρ =
                0.96, the passing streak becomes 1.
              </li>
              <li className="rounded-lg border border-slate-200 bg-white p-3">
                <span className="block font-bold text-slate-800">Run 3 check</span>
                Compare the Run 1–3 aggregate with the Run 1–2 aggregate. If ρ
                = 0.97, the streak becomes 2.
              </li>
            </ol>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              With a minimum of 3 runs and a rule of ρ ≥ 0.95 for 2 consecutive
              checks, the analysis may now stop. If the Run 3 check were 0.94,
              the streak would reset to 0; two new passing checks would then be
              required.
            </p>
          </section>

          <section className="mt-5 rounded-xl border border-[#cfe5ee] bg-[#f2f9fc] p-4">
            <h4 className="font-extrabold text-slate-900">Confidence-run strategy</h4>
            <p className="mt-2">
              We fit the algorithm once on the full dataset, then run between
              3 and 50 bootstrap replicates. Each replicate draws the same
              number of cells as the original dataset, with replacement, and
              reruns the algorithm. Edge confidence is its recovery frequency
              when its normalized per-target evidence reaches the configured
              threshold τ across these replicates. Automatic runs may stop
              early; fixed runs always use the selected count.
            </p>
            <p className="mt-2">
              {uniformRule ? (
                <>
                  After at least 3 bootstrap runs, we stop when the aggregate
                  edge-confidence ranking reaches ρ ≥{" "}
                  <strong className="tabular-nums text-slate-800">
                    {uniformRule.stopRho.toFixed(2)}
                  </strong>{" "}
                  for{" "}
                  <strong className="tabular-nums text-slate-800">
                    {uniformRule.stopStreak}
                  </strong>{" "}
                  consecutive checks. Otherwise, the run continues to its cap.
                </>
              ) : (
                <>
                  After at least 3 bootstrap runs, consecutive aggregate
                  edge-confidence rankings are compared for stability. Stored
                  results in this table use their own recorded thresholds and
                  streak requirements; otherwise, the run continues to its cap.
                </>
              )}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              The stopping check compares consecutive aggregate rankings. It
              is separate from the all-pairs median shown by the blue dot.
            </p>
          </section>
        </div>
      </section>
    </div>,
    document.body,
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

const METHOD_AGREEMENT_ROW_LIMIT = 6;
const METHOD_AGREEMENT_LABEL_WIDTH = 154;
const METHOD_AGREEMENT_COLUMN_WIDTH = 128;

function MethodAgreementHelpModal({ onClose }: { onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

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
        aria-labelledby="method-agreement-help-title"
        aria-describedby="method-agreement-help-summary"
        className="flex max-h-[min(780px,calc(100vh-4rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl animate-modal-panel"
      >
        <header className="flex items-start justify-between gap-5 border-b border-slate-100 px-6 py-5">
          <div>
            <h3
              id="method-agreement-help-title"
              className="text-lg font-extrabold tracking-tight text-slate-950"
            >
              Understanding method agreement
            </h3>
            <p
              id="method-agreement-help-summary"
              className="mt-1 text-sm leading-5 text-slate-500"
            >
              How top-ranked networks are matched and scored across algorithms.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 transition hover:border-[#087ead]/30 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
            aria-label="Close method agreement help"
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5 text-sm leading-6 text-slate-600">
          <section>
            <h4 className="font-extrabold text-slate-900">How to read the matrix</h4>
            <p className="mt-2">
              Each row and column is an algorithm. Select a scored cell to
              inspect shared and method-specific edges. Only the lower half is
              filled because every comparison is symmetric; the pale diagonal
              represents a method compared with itself.
            </p>
            <p className="mt-2">
              Darker blue means higher agreement. The color scale uses the
              lowest and highest off-diagonal values currently visible, so use
              the numbers—not color alone—when comparing different settings.
              Similar methods are placed near one another; this ordering does
              not change their scores.
            </p>
          </section>

          <section className="mt-5 border-t border-slate-100 pt-5">
            <h4 className="font-extrabold text-slate-900">Edge identity modes</h4>
            <dl className="mt-2 space-y-3">
              <div>
                <dt className="font-bold text-slate-800">Adjacency</dt>
                <dd>
                  Compares connected gene pairs only. Direction and sign are
                  ignored, so A → B and B → A count as the same connection.
                </dd>
              </div>
              <div>
                <dt className="font-bold text-slate-800">Direction</dt>
                <dd>
                  Source and target must match. A → B is different from B → A;
                  methods without directed output are omitted.
                </dd>
              </div>
              <div>
                <dt className="font-bold text-slate-800">Direction + sign</dt>
                <dd>
                  Source, target, and regulatory sign must match. Activation,
                  repression, and unknown sign are distinct; methods without
                  signed output are omitted.
                </dd>
              </div>
            </dl>
          </section>

          <section className="mt-5 border-t border-slate-100 pt-5">
            <h4 className="font-extrabold text-slate-900">Agreement metrics</h4>
            <dl className="mt-2 space-y-3">
              <div>
                <dt className="font-bold text-slate-800">Jaccard</dt>
                <dd>
                  Shared edges ÷ all distinct edges in the two top-edge sets.
                  Rank order within each set is ignored.
                </dd>
              </div>
              <div>
                <dt className="font-bold text-slate-800">Top-rank overlap</dt>
                <dd>
                  Rank-biased overlap with persistence p = 0.9. Agreement near
                  the top receives the most weight, while deeper matches still
                  contribute progressively less.
                </dd>
              </div>
              <div>
                <dt className="font-bold text-slate-800">Spearman</dt>
                <dd>
                  Correlates edge ranks across the union of both lists. An edge
                  missing from a list receives the next rank after the longer
                  list; scores range from −1 to 1.
                </dd>
              </div>
            </dl>
          </section>

          <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h4 className="font-extrabold text-slate-900">Brief example</h4>
            <div className="mt-2 space-y-1 font-semibold text-slate-700">
              <p>Method A: A → B, C → D, E → F</p>
              <p>Method B: A → B, C → D, G → H</p>
            </div>
            <p className="mt-2">
              In Adjacency mode, Jaccard is 2 shared connections ÷ 4 distinct
              connections = 0.50. If Method B reverses A → B to B → A,
              Adjacency still treats it as shared, but Direction does not.
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Top-rank overlap gives extra credit because the two matches are
              near the top. Spearman instead asks whether the full edge order
              is similar, including the penalty ranks assigned to missing edges.
            </p>
          </section>

          <section className="mt-5 rounded-xl border border-[#cfe5ee] bg-[#f2f9fc] p-4">
            <h4 className="font-extrabold text-slate-900">Top-edge selection</h4>
            <p className="mt-2">
              Within each algorithm, edges are sorted by saved rank and then by
              confidence. Duplicate identities under the selected mode are
              collapsed before the chosen Top 50–1,000 limit is applied.
            </p>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}

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

/**
 * Cheap seriation: grow a chain from the most-similar pair, repeatedly adding
 * whichever method is closest to either end. Puts methods that agree next to
 * each other so the matrix shows blocks instead of an arbitrary order.
 */
function seriateBySimilarity(
  ids: string[],
  similarityOf: (first: string, second: string) => number,
) {
  if (ids.length < 3) return ids;
  let seed: [string, string] | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const score = similarityOf(ids[i], ids[j]);
      if (score > bestScore) {
        bestScore = score;
        seed = [ids[i], ids[j]];
      }
    }
  }
  if (!seed) return ids;
  const order = [seed[0], seed[1]];
  const remaining = new Set(ids.filter((id) => !order.includes(id)));
  while (remaining.size) {
    let pick: string | null = null;
    let pickScore = -Infinity;
    let prepend = false;
    for (const id of remaining) {
      const toStart = similarityOf(id, order[0]);
      if (toStart > pickScore) {
        pickScore = toStart;
        pick = id;
        prepend = true;
      }
      const toEnd = similarityOf(id, order[order.length - 1]);
      if (toEnd > pickScore) {
        pickScore = toEnd;
        pick = id;
        prepend = false;
      }
    }
    if (!pick) break;
    if (prepend) order.unshift(pick);
    else order.push(pick);
    remaining.delete(pick);
  }
  return order;
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
  const valuesByRun = new Map(runIds.map((runId) => [runId, [] as number[]]));
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
      if (value !== null) {
        values.push(value);
        valuesByRun.get(runIds[firstIndex])?.push(value);
        valuesByRun.get(runIds[secondIndex])?.push(value);
      }
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
    runAgreement: runIds.map((runId) => {
      const runValues = valuesByRun.get(runId) ?? [];
      return {
        runId,
        rho: runValues.length ? median(runValues) : null,
      };
    }),
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
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const rows = useMemo(() => {
    const built = activeAlgorithmIds.map((algorithmId) => {
      const selected = selectedResultForScope(
        algorithmResults[algorithmId],
        selectedResultScopeId,
      );
      const summary = selected?.confidenceSummary;
      const isGenuineBootstrap =
        summary?.resampling_scheme === "cell_bootstrap_with_replacement_v1" &&
        summary?.sampling_with_replacement === true;
      const repeat = summary?.repeat_run_stability;
      const earlyStopping = summary?.early_stopping;
      const fallback = repeat ? null : legacyRunStability(selected?.edges ?? []);
      const pairValuesByRun = new Map<string, number[]>();
      for (const pair of repeat?.pairs ?? []) {
        const firstRun = String(pair.first_run ?? "").trim();
        const secondRun = String(pair.second_run ?? "").trim();
        const rho = numericValue(pair.rho);
        if (!firstRun || !secondRun || rho === null) continue;
        if (!pairValuesByRun.has(firstRun)) pairValuesByRun.set(firstRun, []);
        if (!pairValuesByRun.has(secondRun)) pairValuesByRun.set(secondRun, []);
        pairValuesByRun.get(firstRun)?.push(rho);
        pairValuesByRun.get(secondRun)?.push(rho);
      }
      const runAgreement = pairValuesByRun.size
        ? [...pairValuesByRun.entries()]
            .map(([runId, values]) => ({
              runId,
              rho: values.length ? median(values) : null,
            }))
            .sort((first, second) => {
              const firstNumber = Number(first.runId.split("-").at(-1));
              const secondNumber = Number(second.runId.split("-").at(-1));
              return (
                firstNumber - secondNumber ||
                first.runId.localeCompare(second.runId)
              );
            })
        : (fallback?.runAgreement ?? []);
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
      const earlyStoppingEnabled =
        earlyStopping?.enabled === true ||
        summary?.early_stopping_enabled === true;

      return {
        algorithmId,
        runAgreement,
        runCount,
        usableRunCount,
        medianRho,
        madRho,
        stopRho,
        stopStreak,
        stoppedEarly: earlyStopping?.stopped_early === true,
        isGenuineBootstrap,
        earlyStoppingEnabled,
      };
    });
    return built.slice().sort((a, b) => {
      if (a.medianRho === null && b.medianRho === null) return 0;
      if (a.medianRho === null) return 1;
      if (b.medianRho === null) return -1;
      return b.medianRho - a.medianRho;
    });
  }, [activeAlgorithmIds, algorithmResults, selectedResultScopeId]);

  const uniformRule =
    rows.length > 0 &&
    rows.every(
      (r) =>
        r.stopRho === rows[0].stopRho && r.stopStreak === rows[0].stopStreak,
    )
      ? { stopRho: rows[0].stopRho, stopStreak: rows[0].stopStreak }
      : null;
  const stabilityDescription =
    "Median rank agreement across bootstrap runs; higher values mean more consistent results.";
  const validRhos = rows
    .map((row) => row.medianRho)
    .filter((rho): rho is number => rho !== null);
  const lowestRho = validRhos.length ? Math.min(...validRhos) : 0;
  const plotMin = Math.max(
    -1,
    Math.min(0.9, Math.floor((lowestRho - 0.04) * 10) / 10),
  );
  const plotMidpoint = (plotMin + 1) / 2;
  const plotPosition = (rho: number) =>
    Math.max(0, Math.min(100, ((rho - plotMin) / (1 - plotMin)) * 100));

  const handleDownloadCsv = () => {
    const maximumRunCount = Math.max(
      0,
      ...rows.map((row) => row.runAgreement.length),
    );
    const runHeaders = Array.from(
      { length: maximumRunCount },
      (_, index) => `run_${index + 1}_median_spearman_rho`,
    );
    downloadCsv("repeat-run-stability.csv", [
      [
        "algorithm",
        "median_pairwise_spearman_rho",
        "mean_absolute_deviation",
        "bootstrap_runs",
        "usable_runs",
        "excluded_runs",
        "stopped_early",
        "stop_rho",
        "required_consecutive_checks",
        ...runHeaders,
      ],
      ...rows.map((row) => [
        row.algorithmId,
        row.medianRho ?? "",
        row.madRho ?? "",
        row.runCount,
        row.usableRunCount,
        Math.max(0, row.runCount - row.usableRunCount),
        row.stoppedEarly ? "yes" : "no",
        row.stopRho,
        row.stopStreak,
        ...Array.from({ length: maximumRunCount }, (_, index) => {
          const rho = row.runAgreement[index]?.rho;
          return rho === null || rho === undefined ? "" : rho;
        }),
      ]),
    ]);
  };

  const handleDownloadPng = () => {
    const width = 1600;
    const margin = 56;
    const tableY = margin;
    const headerHeight = 58;
    const rowHeight = 64;
    const axisHeight = 38;
    const tableHeight = headerHeight + rows.length * rowHeight + axisHeight;
    const height = tableY + tableHeight + 84;
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);

    const roundedRect = (
      x: number,
      y: number,
      rectWidth: number,
      rectHeight: number,
      radius: number,
    ) => {
      const safeRadius = Math.min(radius, rectWidth / 2, rectHeight / 2);
      context.beginPath();
      context.moveTo(x + safeRadius, y);
      context.lineTo(x + rectWidth - safeRadius, y);
      context.quadraticCurveTo(
        x + rectWidth,
        y,
        x + rectWidth,
        y + safeRadius,
      );
      context.lineTo(x + rectWidth, y + rectHeight - safeRadius);
      context.quadraticCurveTo(
        x + rectWidth,
        y + rectHeight,
        x + rectWidth - safeRadius,
        y + rectHeight,
      );
      context.lineTo(x + safeRadius, y + rectHeight);
      context.quadraticCurveTo(
        x,
        y + rectHeight,
        x,
        y + rectHeight - safeRadius,
      );
      context.lineTo(x, y + safeRadius);
      context.quadraticCurveTo(x, y, x + safeRadius, y);
      context.closePath();
    };

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    const tableX = margin;
    const tableWidth = width - margin * 2;
    roundedRect(tableX, tableY, tableWidth, tableHeight, 18);
    context.fillStyle = "#ffffff";
    context.fill();
    context.strokeStyle = "#dbe4ee";
    context.lineWidth = 1.5;
    context.stroke();

    const algorithmX = tableX + 26;
    const plotStart = tableX + 370;
    const plotEnd = tableX + 1110;
    const medianX = tableX + 1150;
    const runsX = tableX + 1355;
    context.fillStyle = "#f8fafc";
    roundedRect(tableX + 1, tableY + 1, tableWidth - 2, headerHeight, 17);
    context.fill();
    context.fillStyle = "#475569";
    context.font = `700 14px ${WEBSITE_FONT_FAMILY}`;
    const headerBaseline = tableY + 35;
    context.fillText("Algorithm", algorithmX, headerBaseline);
    context.fillText(
      "Repeat-run correlation (ρ)",
      plotStart,
      headerBaseline,
    );
    context.fillText("Median ρ", medianX, headerBaseline);
    context.fillText("Bootstrap runs", runsX, headerBaseline);

    rows.forEach((row, index) => {
      const rowTop = tableY + headerHeight + index * rowHeight;
      const centerY = rowTop + rowHeight / 2;
      context.strokeStyle = "#e8eef5";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(tableX, rowTop);
      context.lineTo(tableX + tableWidth, rowTop);
      context.stroke();

      context.fillStyle = "#0f172a";
      context.font = `700 17px ${WEBSITE_FONT_FAMILY}`;
      context.fillText(row.algorithmId, algorithmX, centerY + 6);

      context.strokeStyle = "#dbe4ee";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(plotStart, centerY);
      context.lineTo(plotEnd, centerY);
      context.stroke();
      [plotStart, (plotStart + plotEnd) / 2, plotEnd].forEach((x) => {
        context.beginPath();
        context.moveTo(x, centerY - 8);
        context.lineTo(x, centerY + 8);
        context.stroke();
      });

      if (row.medianRho !== null) {
        const medianPosition =
          plotStart + (plotEnd - plotStart) * (plotPosition(row.medianRho) / 100);
        if (row.madRho !== null) {
          const deviationStart =
            plotStart +
            (plotEnd - plotStart) *
              (plotPosition(row.medianRho - row.madRho) / 100);
          const deviationEnd =
            plotStart +
            (plotEnd - plotStart) *
              (plotPosition(row.medianRho + row.madRho) / 100);
          context.strokeStyle = "#8fc4d8";
          context.lineWidth = 6;
          context.lineCap = "round";
          context.beginPath();
          context.moveTo(deviationStart, centerY);
          context.lineTo(Math.max(deviationStart + 2, deviationEnd), centerY);
          context.stroke();
          context.lineCap = "butt";
        }
        context.beginPath();
        context.arc(medianPosition, centerY, 8, 0, Math.PI * 2);
        context.fillStyle = "#087ead";
        context.fill();
        context.strokeStyle = "#ffffff";
        context.lineWidth = 3;
        context.stroke();
      }

      context.fillStyle = "#0f172a";
      context.font = `800 18px ${WEBSITE_FONT_FAMILY}`;
      context.fillText(
        row.medianRho === null ? "—" : row.medianRho.toFixed(3),
        medianX,
        centerY + 6,
      );
      context.fillStyle = "#475569";
      context.font = `600 15px ${WEBSITE_FONT_FAMILY}`;
      context.fillText(
        row.runCount ? plural(row.runCount, "run") : "—",
        runsX,
        centerY + 5,
      );
    });

    const axisTop = tableY + headerHeight + rows.length * rowHeight;
    context.strokeStyle = "#dbe4ee";
    context.beginPath();
    context.moveTo(tableX, axisTop);
    context.lineTo(tableX + tableWidth, axisTop);
    context.stroke();
    context.fillStyle = "#94a3b8";
    context.font = `500 13px ${WEBSITE_FONT_FAMILY}`;
    context.textAlign = "left";
    context.fillText(plotMin.toFixed(2), plotStart, axisTop + 24);
    context.textAlign = "center";
    context.fillText(
      plotMidpoint.toFixed(2),
      (plotStart + plotEnd) / 2,
      axisTop + 24,
    );
    context.textAlign = "right";
    context.fillText("1.00", plotEnd, axisTop + 24);
    context.textAlign = "left";

    const legendY = axisTop + 68;
    context.strokeStyle = "#8fc4d8";
    context.lineWidth = 6;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(tableX, legendY - 4);
    context.lineTo(tableX + 46, legendY - 4);
    context.stroke();
    context.lineCap = "butt";
    context.fillStyle = "#475569";
    context.font = `600 13px ${WEBSITE_FONT_FAMILY}`;
    context.fillText("Mean absolute deviation", tableX + 58, legendY);

    context.beginPath();
    context.arc(tableX + 277, legendY - 4, 7, 0, Math.PI * 2);
    context.fillStyle = "#087ead";
    context.fill();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 2.5;
    context.stroke();
    context.fillStyle = "#475569";
    context.fillText("Median correlation", tableX + 293, legendY);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "repeat-run-stability.png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  return (
    <>
      <Panel
        title="Repeat-run stability"
        titleAction={
          <button
            type="button"
            onClick={() => setIsHelpOpen(true)}
            aria-label="How to read repeat-run stability"
            aria-haspopup="dialog"
            aria-controls="repeat-run-stability-help-title"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-extrabold leading-none text-slate-500 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
          >
            ?
          </button>
        }
        description={stabilityDescription}
        aside={
          <DownloadMenu
            ariaLabel="Download repeat-run stability"
            items={[
              {
                label: "Table image",
                format: "PNG",
                description: "Presentation-ready view of the current table.",
                onSelect: handleDownloadPng,
              },
              {
                label: "Complete table",
                format: "CSV",
                description: "Includes every run-level Spearman value.",
                onSelect: handleDownloadCsv,
              },
            ]}
          />
        }
      >
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="grn-table-header-grid hidden grid-cols-[minmax(8rem,0.7fr)_minmax(16rem,1.8fr)_8rem_9rem] items-center gap-4 border-b border-slate-200 px-4 py-2.5 md:grid">
            <span>Algorithm</span>
            <span>
              Median pairwise Spearman <span className="normal-case">ρ</span>
            </span>
            <span />
            <span>Bootstrap runs</span>
          </div>
          <div className="divide-y divide-slate-100">
          {rows.map((row) => {
          const rhoPosition =
            row.medianRho === null ? null : plotPosition(row.medianRho);
          const deviationStart =
            row.medianRho === null || row.madRho === null
              ? null
              : plotPosition(row.medianRho - row.madRho);
          const deviationEnd =
            row.medianRho === null || row.madRho === null
              ? null
              : plotPosition(row.medianRho + row.madRho);
          // Answers the stop rule explained in the help modal, which the
          // plotted median cannot answer on its own.
          const stopOutcome = row.stoppedEarly
            ? { label: "stopped early", tone: "text-slate-400" }
            : row.earlyStoppingEnabled
              ? { label: "ran to cap", tone: "text-amber-600" }
              : row.isGenuineBootstrap
                ? { label: "fixed plan", tone: "text-slate-400" }
                : null;
          return (
              <div
                key={row.algorithmId}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 bg-white px-4 py-2.5 text-left md:grid-cols-[minmax(8rem,0.7fr)_minmax(16rem,1.8fr)_8rem_9rem] md:gap-4"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                  {row.algorithmId}
                </span>
                <span className="relative hidden h-5 md:block">
                  <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200" />
                  <span className="absolute left-0 top-1/2 h-2.5 w-px -translate-y-1/2 bg-slate-200" />
                  <span className="absolute left-1/2 top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-slate-200" />
                  <span className="absolute right-0 top-1/2 h-2.5 w-px -translate-y-1/2 bg-slate-200" />
                  {deviationStart !== null && deviationEnd !== null ? (
                    <span
                      className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#8fc4d8]"
                      style={{
                        left: `${deviationStart}%`,
                        width: `${Math.max(0.5, deviationEnd - deviationStart)}%`,
                      }}
                      title="Mean absolute deviation"
                    />
                  ) : null}
                  {rhoPosition !== null ? (
                    <span
                      className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#087ead] shadow-sm"
                      style={{ left: `${rhoPosition}%` }}
                    />
                  ) : null}
                </span>
                <span className="whitespace-nowrap text-sm font-extrabold tabular-nums text-slate-900">
                  {row.medianRho === null
                    ? "—"
                    : row.medianRho.toFixed(3)}
                </span>
                <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-slate-600">
                  {row.runCount || "—"}
                  {stopOutcome ? (
                    <span className={`ml-1.5 font-medium ${stopOutcome.tone}`}>
                      · {stopOutcome.label}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
          </div>
          <div className="hidden grid-cols-[minmax(8rem,0.7fr)_minmax(16rem,1.8fr)_8rem_9rem] items-center gap-4 border-t border-slate-200 bg-slate-50/50 px-4 py-2 md:grid">
            <span />
            <span className="relative block h-3 text-[10px] font-medium text-slate-400">
              <span className="absolute left-0 tabular-nums">
                {plotMin.toFixed(2)}
              </span>
              <span className="absolute left-1/2 -translate-x-1/2 tabular-nums">
                {plotMidpoint.toFixed(2)}
              </span>
              <span className="absolute right-0 tabular-nums">1.00</span>
            </span>
            <span />
            <span />
          </div>
        </div>
      </Panel>
      {isHelpOpen && typeof document !== "undefined" ? (
        <RepeatRunStabilityHelpModal
          uniformRule={uniformRule}
          onClose={() => setIsHelpOpen(false)}
        />
      ) : null}
    </>
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
  const [isHelpOpen, setIsHelpOpen] = useState(false);
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
  // Ranks arrive as midranks, so a four-way tie for positions 1-4 reads as
  // "2.5" and the table looks like it starts at 2.5. Recover the tie block from
  // the group size and show it as a range instead.
  const rankGroupSizes = useMemo(() => {
    const counts = new Map<number, number>();
    for (const edge of rows) {
      counts.set(edge.rank, (counts.get(edge.rank) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  const formatRank = (rank: number) => {
    const size = rankGroupSizes.get(rank) ?? 1;
    const start = Math.round(rank - (size - 1) / 2);
    const end = Math.round(rank + (size - 1) / 2);
    return start === end ? `${start}` : `${start}–${end}`;
  };

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
      titleAction={
        <button
          type="button"
          onClick={() => setIsHelpOpen(true)}
          aria-label={`How to read the ${title.toLowerCase()}`}
          aria-haspopup="dialog"
          aria-controls="consensus-edge-explorer-help-title"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-extrabold leading-none text-slate-500 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
        >
          ?
        </button>
      }
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
          <DownloadMenu
            ariaLabel={`Download ${title.toLowerCase()}`}
            items={[
              {
                label: "Complete edge table",
                format: "CSV",
                description: "Exports all matching rows, not only this page.",
                onSelect: handleExport,
              },
            ]}
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
                  <col className="w-[5rem]" />
                  <col className={comparesMethods ? "w-[28%]" : "w-[45%]"} />
                  {comparesMethods ? <col className="w-[10%]" /> : null}
                  <col className={comparesMethods ? "w-[10%]" : "w-[13%]"} />
                  {comparesMethods ? <col className="w-[10%]" /> : null}
                  <col className="w-[14%]" />
                  <col className="w-[17%]" />
                  <col className="w-[5%]" />
                </colgroup>
                <thead className="grn-table-header sticky top-0 z-10 shadow-[0_1px_0_0_#e2e8f0]">
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
                    // The arrow always shows the plurality orientation, and
                    // directionConfidence is |net vote| / denominator — a margin,
                    // so a low value means the reporting methods are split, not
                    // that the reverse wins. Coverage separates "split" from
                    // "no method reported a direction at all".
                    const directionCoveragePercent = Math.round(
                      edge.directionCoverage * 100,
                    );
                    const directionUnsupported =
                      directionConfidencePercent === null ||
                      edge.directionCoverage < 0.5;
                    const directionSplit =
                      !directionUnsupported &&
                      directionConfidencePercent !== null &&
                      directionConfidencePercent < 50;
                    const directionUncertain =
                      !directionUnsupported &&
                      directionConfidencePercent !== null &&
                      directionConfidencePercent >= 50 &&
                      directionConfidencePercent < 80;
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
                          <td className="whitespace-nowrap px-4 py-3 text-center text-xs font-bold tabular-nums text-slate-400">
                            {formatRank(edge.rank)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className="font-extrabold text-slate-900"
                              title={
                                directionSplit
                                  ? `Direction unresolved: methods reporting direction are close to evenly split (${directionConfidencePercent}% margin)`
                                  : directionUnsupported
                                    ? `Only ${directionCoveragePercent}% of the supporting evidence comes from direction-aware methods`
                                    : undefined
                              }
                            >
                              {edge.source}
                              <span
                                className={`px-2 ${
                                  directionSplit
                                    ? "text-amber-600"
                                    : directionUnsupported || directionUncertain
                                      ? "text-slate-400"
                                      : "text-[#087ead]"
                                }`}
                              >
                                {directionUnsupported || directionSplit ? "⇢" : "→"}
                              </span>
                              {edge.target}
                            </span>
                          </td>
                          {comparesMethods ? (
                            <td className="px-4 py-3 text-center text-xs font-bold tabular-nums text-slate-600">
                              {edge.score.toFixed(3)}
                            </td>
                          ) : null}
                          <td className="px-4 py-3 text-center text-xs font-bold tabular-nums text-slate-700">
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
                          <td className="px-4 py-3 text-center text-xs font-bold tabular-nums text-slate-700">
                            {directionUnsupported ? (
                              <span
                                className="font-medium text-slate-400"
                                title={`Only ${directionCoveragePercent}% of the supporting evidence comes from direction-aware methods`}
                              >
                                no direction data
                              </span>
                            ) : directionSplit ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-700"
                                title="Direction unresolved: the methods reporting direction are close to evenly split"
                              >
                                <svg
                                  viewBox="0 0 16 16"
                                  className="h-3 w-3 shrink-0"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="M8 2.5 15 14H1L8 2.5Z"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="M8 6.5v3.2"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                  />
                                  <circle cx="8" cy="11.6" r="0.7" fill="currentColor" />
                                </svg>
                                {directionConfidencePercent}%
                              </span>
                            ) : (
                              `${directionConfidencePercent}%`
                            )}
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
      {isHelpOpen && typeof document !== "undefined" ? (
        <NetworkHelpModal onClose={() => setIsHelpOpen(false)} />
      ) : null}
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
  const [isAgreementHelpOpen, setIsAgreementHelpOpen] = useState(false);
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

  // Every off-diagonal pair, computed once: seriation and rendering both need
  // the whole matrix, and recomputing per cell would be O(n^2) set operations.
  const similarityMatrix = useMemo(() => {
    const values = new Map<string, number>();
    const compute = (firstId: string, secondId: string) => {
      const first = rankedKeys.get(firstId) ?? [];
      const second = rankedKeys.get(secondId) ?? [];
      if (metric === "rbo") return rankBiasedOverlap(first, second);
      if (metric === "spearman") return spearmanSimilarity(first, second);
      return jaccardSimilarity(first, second);
    };
    for (let i = 0; i < eligibleAlgorithmIds.length; i += 1) {
      for (let j = i + 1; j < eligibleAlgorithmIds.length; j += 1) {
        values.set(
          `${eligibleAlgorithmIds[i]}|${eligibleAlgorithmIds[j]}`,
          compute(eligibleAlgorithmIds[i], eligibleAlgorithmIds[j]),
        );
      }
    }
    return values;
  }, [eligibleAlgorithmIds, metric, rankedKeys]);

  const pairSimilarity = useCallback(
    (firstId: string, secondId: string) =>
      firstId === secondId
        ? 1
        : (similarityMatrix.get(`${firstId}|${secondId}`) ??
          similarityMatrix.get(`${secondId}|${firstId}`) ??
          0),
    [similarityMatrix],
  );

  const orderedAlgorithmIds = useMemo(
    () => seriateBySimilarity(eligibleAlgorithmIds, pairSimilarity),
    [eligibleAlgorithmIds, pairSimilarity],
  );
  const [showAllAgreementRows, setShowAllAgreementRows] = useState(false);
  const shouldCollapseAgreementRows =
    orderedAlgorithmIds.length > METHOD_AGREEMENT_ROW_LIMIT;
  const visibleAgreementRowIds = shouldCollapseAgreementRows && !showAllAgreementRows
    ? orderedAlgorithmIds.slice(0, METHOD_AGREEMENT_ROW_LIMIT)
    : orderedAlgorithmIds;

  // Colour is scaled to the off-diagonal values actually present. The diagonal
  // is structurally 1 for every method, so including it would push every real
  // value into a narrow, indistinguishable band of the ramp.
  const agreementDomain = useMemo(() => {
    const values = [...similarityMatrix.values()];
    if (!values.length) return { min: 0, max: 1, span: 1 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;
    return { min, max, span: span > 1e-6 ? span : 0 };
  }, [similarityMatrix]);

  const agreementFill = (value: number) => {
    const ratio =
      agreementDomain.span === 0
        ? 0.5
        : (value - agreementDomain.min) / agreementDomain.span;
    // Capped at 0.85 so the darkest cell still clears 5:1 against slate-900 text.
    return `rgba(8, 126, 173, ${0.12 + Math.max(0, Math.min(1, ratio)) * 0.73})`;
  };

  const handleDownloadAgreementPng = () => {
    if (!orderedAlgorithmIds.length) return;

    const width = 1600;
    const margin = 56;
    const tableY = margin;
    const labelWidth = 220;
    const headerHeight = 64;
    const rowHeight = 64;
    const cellGap = 6;
    const tableWidth = width - margin * 2;
    const cellWidth = (tableWidth - labelWidth) / orderedAlgorithmIds.length;
    const tableHeight = headerHeight + orderedAlgorithmIds.length * rowHeight;
    const height = tableY + tableHeight + 92;
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);

    const roundedRect = (
      x: number,
      y: number,
      rectWidth: number,
      rectHeight: number,
      radius: number,
    ) => {
      const safeRadius = Math.min(radius, rectWidth / 2, rectHeight / 2);
      context.beginPath();
      context.moveTo(x + safeRadius, y);
      context.lineTo(x + rectWidth - safeRadius, y);
      context.quadraticCurveTo(
        x + rectWidth,
        y,
        x + rectWidth,
        y + safeRadius,
      );
      context.lineTo(x + rectWidth, y + rectHeight - safeRadius);
      context.quadraticCurveTo(
        x + rectWidth,
        y + rectHeight,
        x + rectWidth - safeRadius,
        y + rectHeight,
      );
      context.lineTo(x + safeRadius, y + rectHeight);
      context.quadraticCurveTo(
        x,
        y + rectHeight,
        x,
        y + rectHeight - safeRadius,
      );
      context.lineTo(x, y + safeRadius);
      context.quadraticCurveTo(x, y, x + safeRadius, y);
      context.closePath();
    };

    const fitLabel = (label: string, maximumWidth: number) => {
      if (context.measureText(label).width <= maximumWidth) return label;
      let fitted = label;
      while (
        fitted.length > 1 &&
        context.measureText(`${fitted}…`).width > maximumWidth
      ) {
        fitted = fitted.slice(0, -1);
      }
      return `${fitted}…`;
    };

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.textBaseline = "middle";

    context.fillStyle = "#f8fafc";
    roundedRect(
      margin + cellGap / 2,
      tableY + cellGap / 2,
      labelWidth - cellGap,
      headerHeight - cellGap,
      10,
    );
    context.fill();
    context.fillStyle = "#475569";
    context.font = `700 14px ${WEBSITE_FONT_FAMILY}`;
    context.textAlign = "left";
    context.fillText("Algorithm", margin + 18, tableY + headerHeight / 2);

    orderedAlgorithmIds.forEach((algorithmId, columnIndex) => {
      const cellX = margin + labelWidth + columnIndex * cellWidth;
      context.fillStyle = "#f8fafc";
      roundedRect(
        cellX + cellGap / 2,
        tableY + cellGap / 2,
        cellWidth - cellGap,
        headerHeight - cellGap,
        10,
      );
      context.fill();
      context.fillStyle = "#475569";
      context.font = `700 13px ${WEBSITE_FONT_FAMILY}`;
      context.textAlign = "center";
      context.fillText(
        fitLabel(algorithmId, cellWidth - 20),
        cellX + cellWidth / 2,
        tableY + headerHeight / 2,
      );
    });

    orderedAlgorithmIds.forEach((rowId, rowIndex) => {
      const rowTop = tableY + headerHeight + rowIndex * rowHeight;
      context.fillStyle = "#475569";
      context.font = `700 14px ${WEBSITE_FONT_FAMILY}`;
      context.textAlign = "left";
      context.fillText(
        fitLabel(rowId, labelWidth - 30),
        margin + 18,
        rowTop + rowHeight / 2,
      );

      orderedAlgorithmIds.forEach((columnId, columnIndex) => {
        if (columnIndex > rowIndex) return;
        const cellX = margin + labelWidth + columnIndex * cellWidth;
        const boxX = cellX + cellGap / 2;
        const boxY = rowTop + cellGap / 2;
        const boxWidth = cellWidth - cellGap;
        const boxHeight = rowHeight - cellGap;

        context.fillStyle =
          rowId === columnId
            ? "#f1f5f9"
            : agreementFill(pairSimilarity(rowId, columnId));
        roundedRect(boxX, boxY, boxWidth, boxHeight, 10);
        context.fill();

        if (rowId !== columnId) {
          context.fillStyle = "#0f172a";
          context.font = `800 14px ${WEBSITE_FONT_FAMILY}`;
          context.textAlign = "center";
          context.fillText(
            pairSimilarity(rowId, columnId).toFixed(3),
            cellX + cellWidth / 2,
            rowTop + rowHeight / 2,
          );
        }
      });
    });

    const footerY = tableY + tableHeight + 48;
    context.fillStyle = "#64748b";
    context.font = `600 13px ${WEBSITE_FONT_FAMILY}`;
    context.textAlign = "left";
    context.fillText(
      `Top ${topK.toLocaleString()} · ${AGREEMENT_METRIC_SHORT_LABELS[metric]} · ${COMPARISON_MODE_LABELS[mode]}`,
      margin,
      footerY,
    );

    const legendRight = margin + tableWidth;
    const gradientWidth = 180;
    const gradientEnd = legendRight - 38;
    const gradientStart = gradientEnd - gradientWidth;
    context.font = `600 12px ${WEBSITE_FONT_FAMILY}`;
    context.fillStyle = "#64748b";
    context.textAlign = "right";
    context.fillText(
      agreementDomain.min.toFixed(2),
      gradientStart - 12,
      footerY,
    );
    const gradient = context.createLinearGradient(
      gradientStart,
      footerY,
      gradientEnd,
      footerY,
    );
    gradient.addColorStop(0, "rgba(8, 126, 173, 0.12)");
    gradient.addColorStop(1, "rgba(8, 126, 173, 0.85)");
    context.fillStyle = gradient;
    roundedRect(gradientStart, footerY - 5, gradientWidth, 10, 5);
    context.fill();
    context.fillStyle = "#64748b";
    context.textAlign = "left";
    context.fillText(
      agreementDomain.max.toFixed(2),
      gradientEnd + 12,
      footerY,
    );

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `method-agreement-${metric}-${mode}-top-${topK}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, "image/png");
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
        titleAction={
          <button
            type="button"
            onClick={() => setIsAgreementHelpOpen(true)}
            aria-label="How to read method agreement"
            aria-haspopup="dialog"
            aria-controls="method-agreement-help-title"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-extrabold leading-none text-slate-500 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
          >
            ?
          </button>
        }
        description="Compare top-ranked networks across methods; select a cell for details."
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <ComparisonSettingsMenu
              topK={topK}
              metric={metric}
              mode={mode}
              onTopKChange={setTopK}
              onMetricChange={setMetric}
              onModeChange={setMode}
            />
            <DownloadMenu
              ariaLabel="Download method-agreement matrix"
              items={[
                {
                  label: "Matrix image",
                  format: "PNG",
                  description: "Current matrix, settings, and color scale.",
                  onSelect: handleDownloadAgreementPng,
                },
                {
                  label: "Complete matrix",
                  format: "CSV",
                  description: "Current methods, metric, mode, and top-edge limit.",
                  onSelect: () =>
                    downloadCsv(`method-agreement-${metric}-${mode}-top-${topK}.csv`, [
                      ["algorithm", ...orderedAlgorithmIds],
                      ...orderedAlgorithmIds.map((rowId) => [
                        rowId,
                        ...orderedAlgorithmIds.map((columnId) =>
                          rowId === columnId
                            ? 1
                            : pairSimilarity(rowId, columnId).toFixed(6),
                        ),
                      ]),
                    ]),
                },
              ]}
            />
          </div>
        }
      >
        {eligibleAlgorithmIds.length >= 2 ? (
          <>
            <div className="overflow-x-auto">
              <table
                className="w-full border-separate border-spacing-1.5"
                style={{
                  minWidth: `${METHOD_AGREEMENT_LABEL_WIDTH + orderedAlgorithmIds.length * METHOD_AGREEMENT_COLUMN_WIDTH}px`,
                  tableLayout: "fixed",
                }}
              >
                <thead className="grn-table-header">
                  <tr>
                    <th
                      className="sticky left-0 z-30 rounded-l-lg bg-slate-50 px-3 py-2.5"
                      style={{
                        width: METHOD_AGREEMENT_LABEL_WIDTH,
                      }}
                    />
                    {orderedAlgorithmIds.map((algorithmId) => (
                      <th
                        key={algorithmId}
                        className="truncate px-3 py-2.5 text-center"
                        style={{ width: METHOD_AGREEMENT_COLUMN_WIDTH }}
                        title={algorithmId}
                      >
                        {algorithmId}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleAgreementRowIds.map((rowId) => {
                    const rowIndex = orderedAlgorithmIds.indexOf(rowId);
                    return (
                    <tr key={rowId}>
                      <th
                        className="sticky left-0 z-20 truncate bg-white pr-3 text-left text-xs font-bold text-slate-600"
                        style={{
                          width: METHOD_AGREEMENT_LABEL_WIDTH,
                        }}
                        title={rowId}
                      >
                        {rowId}
                      </th>
                      {orderedAlgorithmIds.map((columnId, columnIndex) => {
                        // Symmetric, so the upper half is redundant rather than
                        // missing: leave it empty instead of marking it "—".
                        if (columnIndex > rowIndex) {
                          return (
                            <td
                              key={columnId}
                              className="h-12"
                              style={{ width: METHOD_AGREEMENT_COLUMN_WIDTH }}
                            />
                          );
                        }
                        // The diagonal is 1 by construction; show it as the
                        // matrix's spine, not as a result.
                        if (rowId === columnId) {
                          return (
                            <td
                              key={columnId}
                              style={{ width: METHOD_AGREEMENT_COLUMN_WIDTH }}
                            >
                              <div
                                className="h-12 w-full rounded-lg bg-slate-100"
                                title={`${rowId} compared with itself`}
                              />
                            </td>
                          );
                        }
                        const value = pairSimilarity(rowId, columnId);
                        const isSelected =
                          selectedPair?.[0] === columnId &&
                          selectedPair?.[1] === rowId;
                        return (
                          <td
                            key={columnId}
                            style={{ width: METHOD_AGREEMENT_COLUMN_WIDTH }}
                          >
                            <button
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => {
                                if (isSelected) {
                                  setRequestedPair(null);
                                  return;
                                }
                                setPairDetailGroup("shared");
                                setRequestedPair([columnId, rowId]);
                              }}
                              className={`h-12 w-full rounded-lg text-center text-xs font-extrabold text-slate-900 transition ${
                                isSelected
                                  ? "ring-2 ring-[#087ead] ring-offset-2"
                                  : "ring-offset-2 hover:ring-2 hover:ring-[#087ead]/40"
                              }`}
                              style={{ backgroundColor: agreementFill(value) }}
                              title={`${rowId} vs ${columnId}: ${value.toFixed(3)}`}
                            >
                              {value.toFixed(3)}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              {shouldCollapseAgreementRows ? (
                <button
                  type="button"
                  onClick={() => setShowAllAgreementRows((visible) => !visible)}
                  aria-expanded={showAllAgreementRows}
                  className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#087ead] transition hover:text-[#06688f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
                >
                  {showAllAgreementRows
                    ? "Show fewer rows"
                    : `Show all rows (${orderedAlgorithmIds.length})`}
                  <span aria-hidden="true" className="text-sm leading-none">
                    {showAllAgreementRows ? "▴" : "▾"}
                  </span>
                </button>
              ) : (
                <span />
              )}
              {/* Scaled to the values present, so the shading is readable. */}
              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                <span className="tabular-nums">
                  {agreementDomain.min.toFixed(2)}
                </span>
                <span
                  className="h-2.5 w-28 rounded-full"
                  style={{
                    background:
                      "linear-gradient(90deg, rgba(8,126,173,0.12), rgba(8,126,173,0.85))",
                  }}
                  aria-hidden="true"
                />
                <span className="tabular-nums">
                  {agreementDomain.max.toFixed(2)}
                </span>
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
                    <DownloadMenu
                      label="Download"
                      ariaLabel="Download algorithm pair comparison"
                      items={[
                        {
                          label: "Pair comparison",
                          format: "CSV",
                          onSelect: () =>
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
                            ]),
                        },
                      ]}
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
      {isAgreementHelpOpen && typeof document !== "undefined" ? (
        <MethodAgreementHelpModal
          onClose={() => setIsAgreementHelpOpen(false)}
        />
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
      algorithmMetaMap={algorithmMetaMap}
      algorithmResults={algorithmResults}
      activeAlgorithmIds={activeAlgorithmIds}
      selectedResultScopeId={selectedResultScopeId}
      tasks={tasks}
    />
  );
}
