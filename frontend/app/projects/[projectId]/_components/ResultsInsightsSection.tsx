"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
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
import type { TimingEdge } from "./TrajectoryFigures";
import TrajectoryInsights, {
  type TrajectoryData,
} from "./TrajectoryInsights";
import DownloadMenu from "./DownloadMenu";
import { AgreementDetailPanel, AgreementHeatmap, EulerDiagram, RegulatorHeatmap, UpSetPlot, agreementHeatmapLayout, clusterMethods, formatRank, rankRegulators, regulatorLabelWidth, regulatorPlotTop, upsetPlotTop } from "./AgreementFigures";
import { downloadSvg as downloadSvgFile, downloadSvgPng } from "../_lib/downloads";
import { median as scoreMedian } from "../_lib/resultScores";

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
  return scoreMedian(values) ?? 0;
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
          <p className="mt-1 text-sm leading-6 text-slate-600">
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
  uniformRule: { stopRho: number; stopStreak: number; minRuns: number; stopComparison: string } | null;
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
                0.96, this is the first passing comparison; sampling continues.
              </li>
              <li className="rounded-lg border border-slate-200 bg-white p-3">
                <span className="block font-bold text-slate-800">Run 3 check</span>
                Compare the Run 1–3 aggregate with the Run 1–2 aggregate.
                If ρ = 0.97, this is the second consecutive pass and sampling stops.
              </li>
            </ol>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              New automatic analyses start checking after Run 2 and can stop
              after Run 3 when two consecutive comparisons have ρ &gt; 0.95.
              A failed check resets the passing streak. Sampling continues
              up to 50 runs. Archived analyses retain their recorded rules.
            </p>
          </section>

          <section className="mt-5 rounded-xl border border-[#cfe5ee] bg-[#f2f9fc] p-4">
            <h4 className="font-extrabold text-slate-900">Confidence-run strategy</h4>
            <p className="mt-2">
              We construct the network from 2 to 50 bootstrap replicates. Each replicate draws the same
              number of cells as the original dataset, with replacement, and
              reruns the algorithm. Evidence is the mean per-target rank evidence across runs, with missing edges scored zero. Edge confidence is its recovery frequency
              when its normalized per-target evidence reaches the configured
              threshold τ across these replicates. Automatic runs may stop
              early; fixed runs always use the selected count.
            </p>
            <p className="mt-2">
              {uniformRule ? (
                <>
                  These saved results require at least {uniformRule.minRuns} bootstrap runs.
                  Stopping requires the correlation between successive
                  aggregate edge-confidence rankings to satisfy ρ {uniformRule.stopComparison}{" "}
                  <strong className="tabular-nums text-slate-800">
                    {uniformRule.stopRho.toFixed(2)}
                  </strong>{" "}
                  for{" "}
                  <strong className="tabular-nums text-slate-800">
                    {uniformRule.stopStreak}
                  </strong>{" "}
                  qualifying {uniformRule.stopStreak === 1 ? "check" : "consecutive checks"}.
                  Otherwise, the run continues to its cap.
                </>
              ) : (
                <>
                  New analyses compare cumulative edge-confidence rankings
                  from Run 2 onward and stop after two consecutive comparisons
                  with ρ &gt; 0.95, no earlier than Run 3. Stored
                  results in this table retain their recorded minimum run counts,
                  thresholds and required checks.
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
type AgreementDisplay = "matrix" | "overlap";
type PairDetailGroup = "shared" | "first" | "second";

type SetIntersection = {
  key: string;
  members: string[];
  edges: string[];
};

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

const SET_INTERSECTION_SEPARATOR = "\u0000";
const UPSET_INTERSECTION_LIMIT = 10;

function setIntersectionKey(members: string[]) {
  return members.join(SET_INTERSECTION_SEPARATOR);
}

function buildSetIntersections(
  algorithmIds: string[],
  rankedKeys: Map<string, string[]>,
) {
  const sets = new Map(
    algorithmIds.map((algorithmId) => [
      algorithmId,
      new Set(rankedKeys.get(algorithmId) ?? []),
    ]),
  );
  const allEdges = new Set(
    algorithmIds.flatMap((algorithmId) => rankedKeys.get(algorithmId) ?? []),
  );
  const groups = new Map<string, SetIntersection>();

  allEdges.forEach((edge) => {
    const members = algorithmIds.filter((algorithmId) =>
      sets.get(algorithmId)?.has(edge),
    );
    const key = setIntersectionKey(members);
    const existing = groups.get(key);
    if (existing) {
      existing.edges.push(edge);
    } else {
      groups.set(key, { key, members, edges: [edge] });
    }
  });

  return [...groups.values()].sort(
    (first, second) =>
      second.edges.length - first.edges.length ||
      second.members.length - first.members.length ||
      first.members.join(" ").localeCompare(second.members.join(" ")),
  );
}

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
            <h4 className="font-extrabold text-slate-900">How to read the views</h4>
            <p className="mt-2">
              In Matrix, each row and column is an algorithm. Select a scored cell to
              inspect shared and method-specific edges. The matrix is symmetric:
              mirrored cells show the same comparison. The diagonal shows perfect
              self-agreement (1.00).
            </p>
            <p className="mt-2">
              Darker blue means higher agreement. The scale beside the matrix
              shows the displayed range. Jaccard and RBO use 0 to 1. Negative
              Spearman correlations extend the lower end of the scale.
              Methods are ordered alphabetically.
            </p>
            <p className="mt-2">
              The overlap view changes automatically with the comparison: Venn
              is used for two or three methods, and UpSet is used for four or
              more. Venn labels and UpSet bars report exact edge counts, so an
              edge belongs to only one displayed intersection.
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
  showMetric = true,
  onTopKChange,
  onMetricChange,
  onModeChange,
}: {
  topK: number;
  metric: AgreementMetric;
  mode: ComparisonMode;
  showMetric?: boolean;
  onTopKChange: (value: number) => void;
  onMetricChange: (value: AgreementMetric) => void;
  onModeChange: (value: ComparisonMode) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const isDefault =
    topK === 100 && metric === "jaccard" && mode === "topology";
  const settingsSummary = [
    `Top ${topK.toLocaleString()}`,
    ...(showMetric ? [AGREEMENT_METRIC_LABELS[metric]] : []),
    COMPARISON_MODE_LABELS[mode],
  ].join(" · ");

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
          Top {topK.toLocaleString()} ·{" "}
          {showMetric ? `${AGREEMENT_METRIC_SHORT_LABELS[metric]} · ` : ""}
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
            {showMetric ? (
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
            ) : null}
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

/**
 * Beeswarm layout (as in ggbeeswarm): points stay on the centre line and only
 * step sideways, alternating right and left, when they would overlap a point
 * already placed. Deterministic, so points never move between renders.
 */
function beeswarmOffsets(ys: number[], radius: number, maxOffset: number) {
  const gap = radius * 2 + 0.4;
  const order = ys.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const placed: Array<{ x: number; y: number }> = [];
  const offsets = new Array<number>(ys.length).fill(0);
  order.forEach(({ value, index }) => {
    const free = (x: number) => placed.every((p) => (p.x - x) ** 2 + (p.y - value) ** 2 >= gap * gap);
    let chosen = 0;
    for (let step = 0; step * gap <= maxOffset; step += 1) {
      const candidates = step === 0 ? [0] : [step * gap, -step * gap];
      const hit = candidates.find(free);
      if (hit !== undefined) {
        chosen = hit;
        break;
      }
      chosen = step % 2 ? step * gap : -step * gap;
    }
    chosen = Math.max(-maxOffset, Math.min(maxOffset, chosen));
    placed.push({ x: chosen, y: value });
    offsets[index] = chosen;
  });
  return offsets;
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

/**
 * The rows ranked before the method's top-K cut-off, grouped by comparison
 * key (a reverse edge ranked after the cut-off is not part of the network).
 */
function topRowsByKey(rows: AggregatedEdge[], mode: ComparisonMode, topK: number) {
  const byKey = new Map<string, AggregatedEdge[]>();
  const sorted = [...rows].sort((a, b) => a.rank - b.rank || b.confidence - a.confidence);
  for (const edge of sorted) {
    const key = comparisonKey(edge, mode);
    const list = byKey.get(key);
    if (list) list.push(edge);
    else if (byKey.size < topK) byKey.set(key, [edge]);
    else break;
  }
  return byKey;
}

const SIGN_SYMBOL: Record<number, string> = { 1: "+", [-1]: "−", 0: "·" };

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

type RunPair = { first: string; second: string; rho: number };

/** Top-K cut-offs for edge-level reproducibility. Kept small on purpose:
 * beyond ~the number of edges each run selects, every algorithm's recovery
 * falls together and the comparison stops meaning anything. */
const TOP_EDGE_CUTOFFS = [10, 25, 50];

/** Mean bootstrap recovery (share of runs that select the edge) of an
 * algorithm's top-K edges by rank. Shows whether the edges people actually
 * read are reproducible, which the whole-ranking ρ can understate. */
function topEdgeRecovery(edges: { rank?: number; score: number; confidence?: number }[]) {
  const ranked = edges
    .filter((edge) => typeof edge.confidence === "number" && Number.isFinite(edge.confidence))
    .slice()
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.score - a.score);
  return TOP_EDGE_CUTOFFS.map((k) => ({
    k,
    value: ranked.length >= k
      ? ranked.slice(0, k).reduce((sum, edge) => sum + (edge.confidence as number), 0) / k
      : null,
  }));
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
  const runPairs: RunPair[] = [];
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
        runPairs.push({ first: runIds[firstIndex], second: runIds[secondIndex], rho: value });
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
    pairRhos: values,
    runPairs,
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

/** Tukey box-plot statistics (quartiles by linear interpolation). */
function boxStats(values: number[]) {
  const v = values.slice().sort((a, b) => a - b);
  const q = (p: number) => {
    const i = (v.length - 1) * p;
    const lo = Math.floor(i);
    return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (i - lo);
  };
  const q1 = q(0.25), med = q(0.5), q3 = q(0.75), fence = 1.5 * (q3 - q1);
  return {
    q1, med, q3,
    lo: v.find((x) => x >= q1 - fence) ?? v[0],
    hi: [...v].reverse().find((x) => x <= q3 + fence) ?? v[v.length - 1],
  };
}

type StabilityPlotRow = {
  algorithmId: string;
  pairRhos: number[];
  runPairs: RunPair[];
  runAgreement: { runId: string; rho: number | null }[];
  topRecovery: { k: number; value: number | null }[];
  medianRho: number | null;
  runCount: number;
  stoppedEarly: boolean;
  earlyStoppingEnabled: boolean;
};

/** Repeat-run stability: a journal-style box plot (one box per algorithm,
 * sorted by median; every pairwise ρ between two runs as a grey point; open
 * boxes, black median). It fills the panel width at a fixed text size; each
 * algorithm name carries its run count and how the runs ended underneath.
 * The SVG is also the PNG download. */
const StabilityBoxPlot = forwardRef<SVGSVGElement, { rows: StabilityPlotRow[] }>(
  function StabilityBoxPlot({ rows }, ref) {
    const [hovered, setHovered] = useState<string | null>(null);
    const [boxWidth, setBoxWidth] = useState(0);
    const observed = useRef<ResizeObserver | null>(null);
    const measure = useCallback((node: HTMLDivElement | null) => {
      observed.current?.disconnect();
      if (!node) return;
      setBoxWidth(node.clientWidth);
      observed.current = new ResizeObserver(([entry]) => setBoxWidth(Math.round(entry.contentRect.width)));
      observed.current.observe(node);
    }, []);
    const plotted = rows.filter((row) => row.pairRhos.length > 0 || row.medianRho !== null);
    if (!plotted.length) {
      return <p className="py-6 text-sm text-slate-500">No repeat-run correlations are available for these results.</p>;
    }
    const font = "Arial, Helvetica, sans-serif";
    const INK = "#000", GREY = "#9aa3ab", HIGHLIGHT = "#087ead";
    const left = 64, right = 16, top = 30, plotH = 300;
    // One SVG unit = one screen pixel, so text stays the same size at any width.
    // Fixed column width, as in a journal figure: wide enough for a horizontal
    // algorithm name, independent of how wide the panel is. Very narrow panels
    // fall back to rotated labels in tighter columns.
    const slot = Math.max(56, Math.min(96, ((boxWidth || 900) - left - right) / plotted.length));
    const horizontal = slot >= 92;
    const labelH = horizontal ? 46 : 96;
    const width = left + plotted.length * slot + right;
    const labelBase = top + plotH + 4;
    const height = labelBase + labelH;
    const summaries = plotted.map((row) => {
      const values = row.pairRhos.length ? row.pairRhos : [row.medianRho as number];
      return {
        row,
        values,
        stats: boxStats(values),
        min: Math.min(...values),
        max: Math.max(...values),
        outcome: row.stoppedEarly ? "stopped early" : row.earlyStoppingEnabled ? "ran to cap" : "fixed plan",
      };
    });
    const lowest = Math.min(...summaries.map((item) => item.min));
    const step = 1 - lowest > 0.3 ? 0.1 : 0.05;
    let yMin = Math.floor((lowest - step * 0.4) / step) * step;
    // Correlations are bounded: only go below zero when a value actually is.
    if (lowest >= 0) yMin = Math.max(0, yMin);
    yMin = Math.max(-1, yMin);
    const yMax = 1;
    const y = (value: number) => top + ((yMax - value) / (yMax - yMin)) * plotH;
    const ticks: number[] = [];
    for (let t = Math.ceil(yMin / step - 1e-9) * step; t <= yMax + 1e-9; t += step) ticks.push(Number(t.toFixed(2)) || 0);
    const axisY = top + plotH + 4;
    return (
      <div ref={measure} className="min-w-0 overflow-x-auto" onMouseLeave={() => setHovered(null)}>
          <svg
            ref={ref}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Box plot of pairwise Spearman correlation between repeat runs per algorithm"
            width={width}
            height={height}
            style={{ display: "block", margin: "0 auto" }}
            fontFamily={font}
          >
            <rect x="0" y="0" width={width} height={height} fill="#ffffff" />
            <text x="4" y="16" fontSize="11.5" fill="#4b5560">Whole-ranking agreement between runs</text>
            {ticks.map((t) => (
              <line key={`grid-${t}`} x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke="#e9edf0" strokeWidth="0.8" />
            ))}
            <line x1={left} x2={left} y1={top} y2={axisY} stroke={INK} strokeWidth="0.8" />
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left - 4} x2={left} y1={y(t)} y2={y(t)} stroke={INK} strokeWidth="0.8" />
                <text x={left - 7} y={y(t)} fontSize="11" textAnchor="end" dominantBaseline="middle" fill={INK}>{t.toFixed(step < 0.1 ? 2 : 1)}</text>
              </g>
            ))}
            <text transform={`translate(16 ${top + plotH / 2}) rotate(-90)`} fontSize="12.5" textAnchor="middle" fill={INK}>Pairwise Spearman ρ between runs</text>
            <line x1={left} x2={width - right} y1={axisY} y2={axisY} stroke={INK} strokeWidth="0.8" />
            {summaries.map(({ row, values, stats, min, max, outcome }, index) => {
              const cx = left + slot * (index + 0.5);
              const half = Math.min(slot * 0.28, 22);
              // Many run pairs: smaller, lighter points so the box stays readable.
              const dense = values.length > 40;
              const on = hovered === row.algorithmId;
              const ink = on ? HIGHLIGHT : INK;
              return (
                <g key={row.algorithmId} onMouseEnter={() => setHovered(row.algorithmId)} data-hl={on ? "" : undefined}>
                  <title>{`${row.algorithmId}\nmedian ρ ${stats.med.toFixed(3)} · IQR ${stats.q1.toFixed(3)}–${stats.q3.toFixed(3)}\nrange ${min.toFixed(3)}–${max.toFixed(3)}\n${row.runCount} runs · ${values.length} run pairs · ${outcome}`}</title>
                  <rect x={cx - slot / 2} y={top} width={slot} height={plotH} fill={on ? HIGHLIGHT : "transparent"} fillOpacity={on ? 0.05 : 0} data-hl-bg="" />
                  <rect x={cx - half} y={y(stats.q3)} width={half * 2} height={Math.max(0.5, y(stats.q1) - y(stats.q3))} fill="#eef1f4" />
                  {(() => {
                    const radius = dense ? 1.4 : 2.1;
                    const ys = values.map((value) => y(value));
                    const offsets = beeswarmOffsets(ys, radius, half * 1.15);
                    return ys.map((cy, i) => (
                      <circle key={i} cx={cx + offsets[i]} cy={cy} r={radius} fill={GREY} fillOpacity={dense ? 0.55 : 1} />
                    ));
                  })()}
                  <line x1={cx} x2={cx} y1={y(stats.hi)} y2={y(stats.q3)} stroke={ink} strokeWidth="0.8" />
                  <line x1={cx} x2={cx} y1={y(stats.q1)} y2={y(stats.lo)} stroke={ink} strokeWidth="0.8" />
                  <line x1={cx - half * 0.45} x2={cx + half * 0.45} y1={y(stats.hi)} y2={y(stats.hi)} stroke={ink} strokeWidth="0.8" />
                  <line x1={cx - half * 0.45} x2={cx + half * 0.45} y1={y(stats.lo)} y2={y(stats.lo)} stroke={ink} strokeWidth="0.8" />
                  <rect x={cx - half} y={y(stats.q3)} width={half * 2} height={Math.max(0.5, y(stats.q1) - y(stats.q3))} fill="none" stroke={ink} strokeWidth={on ? 1.4 : 0.9} />
                  <line x1={cx - half} x2={cx + half} y1={y(stats.med)} y2={y(stats.med)} stroke={ink} strokeWidth="2.4" />
                  <line x1={cx} x2={cx} y1={axisY} y2={axisY + 4} stroke={INK} strokeWidth="0.8" />
                  {horizontal ? (
                    <>
                      <text x={cx} y={labelBase + 16} fontSize="11.5" textAnchor="middle" fill={ink} data-name="">{row.algorithmId}</text>
                      <text x={cx} y={labelBase + 31} fontSize="10" textAnchor="middle" fill="#6b7580">
                        {row.runCount ? `${row.runCount} runs` : ""}
                        {outcome === "ran to cap" && <tspan fill="#b45309">{" · ran to cap"}</tspan>}
                      </text>
                    </>
                  ) : (
                    <text transform={`translate(${cx + 4} ${labelBase + 10}) rotate(-45)`} fontSize="11.5" textAnchor="end" fill={ink} data-name="">
                      {row.algorithmId}
                      <tspan fill="#8a949c" fontSize="10">{row.runCount ? ` · ${row.runCount} runs` : ""}</tspan>
                      {outcome === "ran to cap" && <tspan fill="#b45309" fontSize="10">{" · ran to cap"}</tspan>}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
      </div>
    );
  },
);

/** Per-algorithm repeat-run stability for the selected result scope, sorted
 * by median ρ (highest first). Shared by the Comparison stability panel and
 * the Benchmark stability-vs-accuracy scatter. */
export function buildStabilityRows(
  algorithmResults: Record<string, AlgorithmStoredResult>,
  activeAlgorithmIds: string[],
  selectedResultScopeId: string,
) {
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
    const repeatPairRhos: number[] = [];
    const repeatRunPairs: RunPair[] = [];
    for (const pair of repeat?.pairs ?? []) {
      const firstRun = String(pair.first_run ?? "").trim();
      const secondRun = String(pair.second_run ?? "").trim();
      const rho = numericValue(pair.rho);
      if (!firstRun || !secondRun || rho === null) continue;
      repeatPairRhos.push(rho);
      repeatRunPairs.push({ first: firstRun, second: secondRun, rho });
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
    const stopComparison = (earlyStopping?.stop_comparison ?? summary?.stop_comparison) === "gt" ? ">" : "≥";
    const minRuns =
      numericValue(earlyStopping?.min_runs) ?? numericValue(summary?.min_runs) ?? 2;
    const earlyStoppingEnabled =
      earlyStopping?.enabled === true ||
      summary?.early_stopping_enabled === true;

    // Every pairwise ρ between two runs: the points of the box plot.
    const pairRhos = repeatPairRhos.length
      ? repeatPairRhos
      : (fallback?.pairRhos ?? []);
    return {
      algorithmId,
      runAgreement,
      pairRhos,
      topRecovery: topEdgeRecovery(selected?.edges ?? []),
      runPairs: repeatRunPairs.length ? repeatRunPairs : (fallback?.runPairs ?? []),
      runCount,
      usableRunCount,
      medianRho,
      madRho,
      stopRho,
      stopStreak,
      stopComparison,
      minRuns,
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
}


type MethodOutputSortKey = "rank" | "source" | "target" | "score" | "confidence" | "direction" | "sign" | "signStability";
const METHOD_OUTPUT_PAGE_SIZE = 20;
const METHOD_OUTPUT_COLUMNS: Array<[MethodOutputSortKey, string]> = [
  ["rank", "Rank"],
  ["source", "Regulator"],
  ["target", "Target"],
  ["score", "Evidence"],
  ["confidence", "Confidence"],
  ["direction", "Direction confidence"],
  ["sign", "Sign"],
  ["signStability", "Sign confidence"],
];

/** One method's ranked edges with all of its confidence runs combined, in the
 * format of the earlier Edge Analysis Table: header band, two-line cells,
 * coloured sign and First / Previous / Next / Last paging. */
function MethodOutputPanel({
  algorithmResults,
  algorithmMetaMap,
  activeAlgorithmIds,
  selectedResultScopeId,
}: {
  algorithmResults: Record<string, AlgorithmStoredResult>;
  algorithmMetaMap: Map<string, AlgorithmCatalogItem>;
  activeAlgorithmIds: string[];
  selectedResultScopeId: string;
}) {
  const [methodId, setMethodId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<MethodOutputSortKey>("rank");
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(1);

  const edgesOf = (algorithmId: string) =>
    selectedResultForScope(algorithmResults[algorithmId], selectedResultScopeId)?.edges ?? [];
  const available = activeAlgorithmIds.filter((algorithmId) => edgesOf(algorithmId).length > 0);
  if (!available.length) return null;
  const current = methodId && available.includes(methodId) ? methodId : available[0];
  const runsOf = (algorithmId: string) =>
    edgesOf(algorithmId).reduce((most, edge) => Math.max(most, Number(edge.run_count) || 0), 0);

  const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  // Direction confidence for one method, as in the consensus: how much the
  // evidence for regulator → target outweighs the reverse, |f − r| ÷ (f + r).
  // A method that reports no direction has none. Sign confidence is the share
  // of signed recovering runs that agree with the displayed sign.
  const meta = algorithmMetaMap.get(current);
  const directed = meta?.directed ?? true;
  const signed = meta?.signed ?? true;
  const evidenceByPair = new Map(edgesOf(current).map((edge) => [`${edge.source}|${edge.target}`, finite(edge.score) ?? 0]));
  const rows = edgesOf(current).map((edge, index) => {
    // A method that reports no sign has none, whatever its raw scores look like.
    const positive = signed ? finite(edge.positive_selected_runs) ?? 0 : 0;
    const negative = signed ? finite(edge.negative_selected_runs) ?? 0 : 0;
    const forward = finite(edge.score) ?? 0;
    const reverse = evidenceByPair.get(`${edge.target}|${edge.source}`) ?? 0;
    return {
      directionConfidence: directed && forward + reverse > 0 ? Math.abs(forward - reverse) / (forward + reverse) : null,
      rank: finite(edge.rank) ?? index + 1,
      source: edge.source,
      target: edge.target,
      score: finite(edge.score) ?? 0,
      raw: finite(edge.mean_raw_score) ?? finite(edge.full_data_raw_score),
      mean: finite(edge.bootstrap_mean_evidence),
      low: finite(edge.evidence_ci_lower),
      high: finite(edge.evidence_ci_upper),
      confidence: finite(edge.confidence),
      selected: finite(edge.selected_runs),
      runs: finite(edge.run_count),
      positive,
      negative,
      sign: positive > negative ? 1 : negative > positive ? -1 : 0,
      signConfidence: signed ? finite(edge.bootstrap_sign_confidence) : null,
      fullRank: finite(edge.full_data_rank),
    };
  });
  type Row = (typeof rows)[number];
  const sortValue = (row: Row): number | string =>
    sortKey === "source" ? row.source
      : sortKey === "target" ? row.target
        : sortKey === "score" ? row.score
            : sortKey === "confidence" ? row.confidence ?? -1
              : sortKey === "direction" ? row.directionConfidence ?? -1
                : sortKey === "signStability" ? row.signConfidence ?? -1
              : sortKey === "sign" ? row.positive - row.negative
                  : row.rank;
  const needle = query.trim().toLowerCase();
  const sorted = rows
    .filter((row) => !needle || row.source.toLowerCase().includes(needle) || row.target.toLowerCase().includes(needle))
    .sort((first, second) => {
      const a = sortValue(first);
      const b = sortValue(second);
      const order = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
      return (ascending ? order : -order) || first.rank - second.rank;
    });
  const totalPages = Math.max(1, Math.ceil(sorted.length / METHOD_OUTPUT_PAGE_SIZE));
  const shownPage = Math.min(page, totalPages);
  const displayed = sorted.slice((shownPage - 1) * METHOD_OUTPUT_PAGE_SIZE, shownPage * METHOD_OUTPUT_PAGE_SIZE);

  const percent = (value: number | null) => (value === null ? "-" : `${Math.round(value * 100)}%`);
  const blank = (value: number | null) => (value === null ? "" : value);
  const handleDownload = () =>
    downloadCsv(`method-output-${current}.csv`, [
      ["rank", "regulator", "target", "evidence", "raw_score", "mean_evidence_across_runs", "ci95_low", "ci95_high", "confidence", "runs_recovered", "runs", "direction_confidence", "runs_positive", "runs_negative", "sign_confidence", "legacy_full_data_rank"],
      ...sorted.map((row) => [
        row.rank, row.source, row.target, row.score, blank(row.raw), blank(row.mean), blank(row.low), blank(row.high),
        blank(row.confidence), blank(row.selected), blank(row.runs), blank(row.directionConfidence), row.positive, row.negative, blank(row.signConfidence), blank(row.fullRank),
      ]),
    ]);
  const pageButton = "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-45";
  const subLine = "mt-1 text-xs tabular-nums text-slate-400";

  return (
    <Panel
      title="Method output"
      description="One method's ranked edges, with all of its confidence runs combined. Evidence is the mean 0–1 rank score across bootstrap runs; confidence and sign confidence summarize recovery and sign consistency; direction confidence compares an edge with its reverse."
      aside={
        <button
          type="button"
          onClick={handleDownload}
          aria-label={`Download ${current} output as CSV`}
          title={`Download ${current} output as CSV`}
          className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
        >
          Download
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          Method
          <select
            value={current}
            onChange={(event) => { setMethodId(event.target.value); setPage(1); }}
            className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700"
          >
            {available.map((algorithmId) => {
              const runs = runsOf(algorithmId);
              return (
                <option key={algorithmId} value={algorithmId}>
                  {algorithmId}{runs > 0 ? ` · ${runs} ${runs === 1 ? "run" : "runs"}` : ""}
                </option>
              );
            })}
          </select>
        </label>
        <input
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(1); }}
          placeholder="Search genes"
          aria-label="Search genes in the method output"
          className="h-10 w-56 max-w-full rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 sm:ml-auto"
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                {METHOD_OUTPUT_COLUMNS.map(([key, label]) => (
                  <th key={key} className="whitespace-nowrap px-4 py-3 align-middle font-medium">
                    <button
                      type="button"
                      onClick={() => {
                        setPage(1);
                        if (sortKey === key) setAscending((value) => !value);
                        else { setSortKey(key); setAscending(true); }
                      }}
                      className="group inline-flex items-center gap-2 text-left transition hover:text-[#1b75a6]"
                    >
                      <span className="block font-bold text-slate-800 group-hover:text-[#1b75a6]">{label}</span>
                      {sortKey === key && <span className="text-[#1b75a6]">{ascending ? "↑" : "↓"}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {displayed.length > 0 ? (
                displayed.map((row) => (
                  <tr key={`${row.source}|${row.target}`} className="align-top">
                    <td className="px-4 py-3 font-medium tabular-nums text-slate-600">{row.rank}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-bold text-slate-950">{row.source}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-bold text-slate-950">{row.target}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-slate-700">{row.score.toFixed(3)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      <div className="font-medium tabular-nums text-slate-700">{percent(row.confidence)}</div>
                      <div className={subLine}>{row.selected === null || row.runs === null ? "-" : `${row.selected} of ${row.runs} runs`}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-slate-700">{percent(row.directionConfidence)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      <div className={`font-medium ${row.sign === 1 ? "text-[#0072B2]" : row.sign === -1 ? "text-[#D55E00]" : "text-slate-700"}`}>
                        {row.sign === 1 ? "positive" : row.sign === -1 ? "negative" : row.positive > 0 ? "mixed" : "unknown"}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-slate-700">{percent(row.signConfidence)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={METHOD_OUTPUT_COLUMNS.length}>
                    No edges match this search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <p>
          Page {shownPage.toLocaleString()} of {totalPages.toLocaleString()} · {sorted.length.toLocaleString()} matching rows
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPage(1)} disabled={shownPage === 1} className={pageButton}>First</button>
          <button type="button" onClick={() => setPage(Math.max(1, shownPage - 1))} disabled={shownPage === 1} className={pageButton}>Previous</button>
          <button type="button" onClick={() => setPage(Math.min(totalPages, shownPage + 1))} disabled={shownPage === totalPages} className={pageButton}>Next</button>
          <button type="button" onClick={() => setPage(totalPages)} disabled={shownPage === totalPages} className={pageButton}>Last</button>
        </div>
      </div>
    </Panel>
  );
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

  const rows = useMemo(
    () => buildStabilityRows(algorithmResults, activeAlgorithmIds, selectedResultScopeId),
    [activeAlgorithmIds, algorithmResults, selectedResultScopeId],
  );

  const uniformRule =
    rows.length > 0 &&
    rows.every(
      (r) =>
        r.stopRho === rows[0].stopRho && r.stopStreak === rows[0].stopStreak && r.minRuns === rows[0].minRuns && r.stopComparison === rows[0].stopComparison,
    )
      ? { stopRho: rows[0].stopRho, stopStreak: rows[0].stopStreak, minRuns: rows[0].minRuns, stopComparison: rows[0].stopComparison }
      : null;
  const stabilityDescription =
    "Each point is the rank correlation between two bootstrap runs over the whole edge ranking." +
    (rows.some((row) => row.earlyStoppingEnabled)
      ? " Runs stopped once the ranking met the stability rule, except where marked “ran to cap”."
      : "");
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
        ...TOP_EDGE_CUTOFFS.map((k) => `top_${k}_edge_mean_recovery`),
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
        ...row.topRecovery.map((cell) => (cell.value === null ? "" : cell.value)),
        ...Array.from({ length: maximumRunCount }, (_, index) => {
          const rho = row.runAgreement[index]?.rho;
          return rho === null || rho === undefined ? "" : rho;
        }),
      ]),
    ]);
  };

  const figureRef = useRef<SVGSVGElement | null>(null);
  const handleDownloadPng = () => {
    const svg = figureRef.current;
    if (!svg) return;
    const box = svg.viewBox.baseVal;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(box.width));
    clone.setAttribute("height", String(box.height));
    clone.querySelectorAll("title").forEach((node) => node.remove());
    // The figure is the plain plot: drop hover/selection highlighting.
    clone.querySelectorAll("[data-hl-bg]").forEach((node) => node.setAttribute("fill-opacity", "0"));
    clone.querySelectorAll("[data-hl] line, [data-hl] rect:not([data-hl-bg]):not([data-cell])").forEach((node) => {
      node.setAttribute("stroke", "#000");
      node.setAttribute("stroke-width", node.getAttribute("stroke-width") === "1.4" ? "0.8" : node.getAttribute("stroke-width") ?? "0.8");
    });
    clone.querySelectorAll("[data-hl] text[data-name]").forEach((node) => node.setAttribute("fill", "#000"));
    const source = new XMLSerializer().serializeToString(clone);
    const image = new Image();
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
    image.onload = () => {
      const scale = 4; // ~300 dpi at a single-column print width
      const canvas = document.createElement("canvas");
      canvas.width = box.width * scale;
      canvas.height = box.height * scale;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const href = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = href;
        link.download = "repeat-run-stability.png";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(href);
      }, "image/png");
    };
    image.src = url;
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
                label: "Figure",
                format: "PNG",
                description: "Publication-style box plot of every run pair.",
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
        <StabilityBoxPlot ref={figureRef} rows={rows} />
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

function AgreementView({
  algorithmEdgeRows,
  algorithmMetaMap,
  algorithmResults,
  activeAlgorithmIds,
  selectedResultScopeId,
}: {
  algorithmEdgeRows: Record<string, AggregatedEdge[]>;
  algorithmMetaMap: Map<string, AlgorithmCatalogItem>;
  algorithmResults: Record<string, AlgorithmStoredResult>;
  activeAlgorithmIds: string[];
  selectedResultScopeId: string;
}) {
  const [topK, setTopK] = useState(100);
  const [metric, setMetric] = useState<AgreementMetric>("jaccard");
  const [mode, setMode] = useState<ComparisonMode>("topology");
  const [agreementDisplay, setAgreementDisplay] =
    useState<AgreementDisplay>("matrix");
  const [isAgreementHelpOpen, setIsAgreementHelpOpen] = useState(false);
  const [upsetVisibleCount, setUpSetVisibleCount] = useState(
    UPSET_INTERSECTION_LIMIT,
  );
  const [requestedPair, setRequestedPair] = useState<[string, string] | null>(null);
  const [pairDetailGroup, setPairDetailGroup] =
    useState<PairDetailGroup>("shared");

  // CellOracle's prior-constrained candidates are not directly comparable to
  // the de novo methods in the agreement and overlap figures.
  const comparisonAlgorithmIds = useMemo(
    () => activeAlgorithmIds.filter((id) => id.toUpperCase() !== "CELLORACLE"),
    [activeAlgorithmIds],
  );
  const eligibleAlgorithmIds = useMemo(
    () =>
      comparisonAlgorithmIds.filter((algorithmId) => {
        const metadata = algorithmMetaMap.get(algorithmId);
        if (mode === "direction") return metadata?.directed ?? true;
        if (mode === "sign") return metadata?.signed ?? false;
        return true;
      }),
    [comparisonAlgorithmIds, algorithmMetaMap, mode],
  );
  const omittedAlgorithmIds = comparisonAlgorithmIds.filter(
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
  const setIntersections = useMemo(
    () => buildSetIntersections(eligibleAlgorithmIds, rankedKeys),
    [eligibleAlgorithmIds, rankedKeys],
  );
  const overlapLabel = eligibleAlgorithmIds.length <= 3 ? "Venn" : "UpSet";

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

  // Clustering orders the overlap and regulator views. The matrix uses alphabetical labels.
  const agreementTree = useMemo(
    () => clusterMethods(eligibleAlgorithmIds, pairSimilarity),
    [eligibleAlgorithmIds, pairSimilarity],
  );
  // Methods that contribute fewer edges than the others: their agreement is
  // low partly because of their size, so the figure says so in one sentence.
  const shortMethodNote = useMemo(() => {
    const counts = eligibleAlgorithmIds.map((id) => ({ id, n: rankedKeys.get(id)?.length ?? 0 }));
    const most = Math.max(0, ...counts.map((item) => item.n));
    const short = counts.filter((item) => item.n < most);
    // Only worth a sentence when it is the exception, not the rule.
    if (!short.length || short.length > counts.length / 2) return "";
    const edges = (n: number) => `${n.toLocaleString()} edge${n === 1 ? "" : "s"}`;
    const ceiling = (n: number) => (n / most).toFixed(2).replace(/^0\./, ".");
    if (short.length === 1) {
      const { id, n } = short[0];
      return metric === "jaccard"
        ? `${id} has only ${edges(n)}, so its agreement with other methods cannot exceed ${ceiling(n)}.`
        : `${id} has only ${edges(n)}, so its low agreement with other methods partly reflects its size.`;
    }
    const list = short.map((item) => `${item.id} (${item.n.toLocaleString()})`).join(", ");
    return `Some methods have fewer than ${edges(most)}, so their low agreement partly reflects their size: ${list}.`;
  }, [eligibleAlgorithmIds, rankedKeys, metric]);

  const orderedAlgorithmIds = useMemo(
    () => agreementTree?.members ?? eligibleAlgorithmIds,
    [agreementTree, eligibleAlgorithmIds],
  );
  const matrixAlgorithmIds = useMemo(
    () => [...eligibleAlgorithmIds].sort((a, b) => a.localeCompare(b)),
    [eligibleAlgorithmIds],
  );
  const heatmapLayout = agreementHeatmapLayout(matrixAlgorithmIds);
  const heatmapSvgRef = useRef<SVGSVGElement | null>(null);
  const overlapSvgRef = useRef<SVGSVGElement | null>(null);
  const [showAgreementValues, setShowAgreementValues] = useState(true);
  const [upsetByDegree, setUpsetByDegree] = useState(false);
  const [selectedIntersectionKey, setSelectedIntersectionKey] = useState<string | null>(null);
  // The detail panel is never empty: it starts on the most similar pair and on
  // the largest intersection shared by two or more methods.
  const selectedIntersection =
    setIntersections.find((item) => item.key === selectedIntersectionKey) ??
    setIntersections[0] ??
    null;
  const rankLookup = useMemo(
    () =>
      new Map(
        [...rankedKeys].map(([id, keys]) => [id, new Map(keys.map((key, index) => [key, index + 1]))]),
      ),
    [rankedKeys],
  );
  // The edges of the selected group, beside the UpSet plot or the Venn diagram.
  const intersectionPanel = (plotTop: number) =>
    selectedIntersection ? (
                          <AgreementDetailPanel
                            eyebrow={selectedIntersectionKey ? "Selected group" : "Selected · largest group"}
                            plotTop={plotTop}
                            selectionKey={selectedIntersection.key}
                            title={
                              selectedIntersection.members.length === 1
                                ? `${selectedIntersection.members[0]} only`
                                : selectedIntersection.members.length === eligibleAlgorithmIds.length
                                  ? `All ${eligibleAlgorithmIds.length} methods`
                                  : selectedIntersection.members.length > eligibleAlgorithmIds.length / 2
                                    ? `All except ${eligibleAlgorithmIds.filter((id) => !selectedIntersection.members.includes(id)).join(", ")}`
                                    : selectedIntersection.members.join(" · ")
                            }
                            subtitle={`Edges picked by exactly ${selectedIntersection.members.length === 1 ? "this method" : `these ${selectedIntersection.members.length} methods`}, top ${topK.toLocaleString()}`}
                            stats={[
                              { label: "Edges", value: selectedIntersection.edges.length.toLocaleString() },
                              { label: "Methods", value: `${selectedIntersection.members.length} of ${eligibleAlgorithmIds.length}` },
                              {
                                label: "Of all edges",
                                value: `${Math.round((selectedIntersection.edges.length / Math.max(1, setIntersections.reduce((sum, item) => sum + item.edges.length, 0))) * 100)}%`,
                              },
                            ]}
                            groups={[
                              {
                                key: "edges",
                                label: "Edges",
                                rows: selectedIntersection.edges
                                  .map((edge) => {
                                    const ranks = selectedIntersection.members.map((id) => rankLookup.get(id)?.get(edge) ?? null);
                                    const known = ranks.filter((rank): rank is number => rank !== null);
                                    return { edge, ranks: [known.length ? Math.round(median(known)) : null, known.length ? Math.min(...known) : null] };
                                  })
                                  .sort((first, second) => (first.ranks[0] ?? Infinity) - (second.ranks[0] ?? Infinity)),
                              },
                            ]}
                            activeGroup="edges"
                            onGroupChange={() => undefined}
                            rankHeaders={["Median", "Best"]}
                            onReset={selectedIntersectionKey ? () => setSelectedIntersectionKey(null) : undefined}
                            resetLabel="Back to largest"
                            onDownload={() =>
                              downloadCsv(`intersection-${selectedIntersection.members.join("-")}-top-${topK}.csv`, [
                                ["edge", ...selectedIntersection.members.map((id) => `rank_${id}`)],
                                ...selectedIntersection.edges.map((edge) => [
                                  edge,
                                  ...selectedIntersection.members.map((id) => rankLookup.get(id)?.get(edge) ?? ""),
                                ]),
                              ])
                            }
                          />
                        ) : null;
  const handleDownloadOverlap = (format: "svg" | "png") => {
    const svg = overlapSvgRef.current;
    if (!svg) return;
    const filename = `method-overlap-${overlapLabel.toLowerCase()}-${mode}-top-${topK}.${format}`;
    if (format === "svg") downloadSvgFile(svg, filename);
    else void downloadSvgPng(svg, filename, 3);
  };
  const handleDownloadAgreementPng = () => {
    const svg = heatmapSvgRef.current;
    if (!svg) return;
    void downloadSvgPng(svg, `method-agreement-${metric}-${mode}-top-${topK}.png`, 3);
  };

  // Default selection: the first off-diagonal cell (first two methods in the
  // heatmap order), at the top-left corner where the eye starts reading.
  const defaultPair = useMemo<[string, string] | null>(
    () => (matrixAlgorithmIds.length >= 2 ? [matrixAlgorithmIds[0], matrixAlgorithmIds[1]] : null),
    [matrixAlgorithmIds],
  );
  const isDefaultPair = !(
    requestedPair &&
    eligibleAlgorithmIds.includes(requestedPair[0]) &&
    eligibleAlgorithmIds.includes(requestedPair[1])
  );
  const selectedPair = useMemo(
    () => (isDefaultPair ? defaultPair : requestedPair),
    [isDefaultPair, defaultPair, requestedPair],
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

  // Sign and direction agreement for the selected pair, from each method's own
  // top-K rows: a shared edge "agrees in sign" when both methods give it the
  // same nonzero sign; a gene pair "agrees in direction" when both directed
  // methods link it with the same orientation(s).
  const pairEvidence = useMemo(() => {
    if (!pairDetails) return null;
    const { firstId, secondId } = pairDetails;
    const first = topRowsByKey(algorithmEdgeRows[firstId] ?? [], mode, topK);
    const second = topRowsByKey(algorithmEdgeRows[secondId] ?? [], mode, topK);
    const signIn = (rows: Map<string, AggregatedEdge[]>, key: string) => rows.get(key)?.[0]?.sign ?? 0;
    const hasSigns = (rows: Map<string, AggregatedEdge[]>) => [...rows.values()].some((list) => list.some((edge) => edge.sign !== 0));
    const firstSigned = hasSigns(first);
    const secondSigned = hasSigns(second);
    let signCompared = 0;
    let signSame = 0;
    pairDetails.shared.forEach((key) => {
      const a = signIn(first, key);
      const b = signIn(second, key);
      if (a && b) {
        signCompared += 1;
        if (a === b) signSame += 1;
      }
    });
    const bothDirected = (algorithmMetaMap.get(firstId)?.directed ?? true) && (algorithmMetaMap.get(secondId)?.directed ?? true);
    const orientations = (rows: Map<string, AggregatedEdge[]>) => {
      const byPair = new Map<string, Set<string>>();
      rows.forEach((list) =>
        list.forEach((edge) => {
          if (edge.source === edge.target) return;
          const pair = [edge.source, edge.target].sort().join("\u0000");
          const set = byPair.get(pair) ?? new Set<string>();
          set.add(`${edge.source}\u0000${edge.target}`);
          byPair.set(pair, set);
        }),
      );
      return byPair;
    };
    let directionCompared = 0;
    let directionSame = 0;
    if (bothDirected) {
      const a = orientations(first);
      const b = orientations(second);
      a.forEach((set, pair) => {
        const other = b.get(pair);
        if (!other) return;
        directionCompared += 1;
        if (set.size === other.size && [...set].every((value) => other.has(value))) directionSame += 1;
      });
    }
    return {
      firstSign: (key: string) => signIn(first, key),
      secondSign: (key: string) => signIn(second, key),
      showSigns: firstSigned || secondSigned,
      bothSigned: firstSigned && secondSigned,
      signCompared,
      signSame,
      bothDirected,
      directionCompared,
      directionSame,
    };
  }, [algorithmEdgeRows, algorithmMetaMap, mode, pairDetails, topK]);

  // Key regulators: genes ranked by out-degree (directed) or degree
  // (undirected) in each method's top-K edges, columns in heatmap order.
  const regulatorRows = useMemo(
    () =>
      rankRegulators(
        orderedAlgorithmIds,
        (id) => algorithmEdgeRows[id] ?? [],
        (id) => algorithmMetaMap.get(id)?.directed ?? true,
        topK,
      ),
    [algorithmEdgeRows, algorithmMetaMap, orderedAlgorithmIds, topK],
  );
  const regulatorDirected = orderedAlgorithmIds.map((id) => algorithmMetaMap.get(id)?.directed ?? true);
  // Both cell grids start at the same x position; the agreement SVG keeps its
  // wider label gutter so method names and exported figures remain unclipped.
  const matrixAlignmentOffset = regulatorLabelWidth(regulatorRows) - heatmapLayout.left;
  const [requestedGene, setRequestedGene] = useState<string | null>(null);
  const selectedRegulator =
    regulatorRows.find((row) => row.gene === requestedGene) ?? regulatorRows[0] ?? null;
  const isDefaultRegulator = !regulatorRows.some((row) => row.gene === requestedGene);
  const regulatorSvgRef = useRef<SVGSVGElement | null>(null);
  const regulatorCsvRows = () => [
    ["gene", ...orderedAlgorithmIds.map((id) => `rank_${id}`), ...orderedAlgorithmIds.map((id) => `links_${id}`), "median_rank"],
    ...regulatorRows.map((row) => [
      row.gene,
      ...row.ranks.map((rank) => rank ?? ""),
      ...row.links,
      formatRank(row.median),
    ]),
  ];
  const handleDownloadRegulators = (format: "svg" | "png") => {
    const svg = regulatorSvgRef.current;
    if (!svg) return;
    const filename = `key-regulators-top-${topK}.${format}`;
    if (format === "svg") downloadSvgFile(svg, filename);
    else void downloadSvgPng(svg, filename, 3);
  };
  const percent = (value: number, total: number) => `${Math.round((value / total) * 100)}%`;

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
      {comparisonAlgorithmIds.length >= 2 ? (
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
        description="Compare pairwise agreement and exact overlap among top-ranked networks."
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <ComparisonSettingsMenu
              topK={topK}
              metric={metric}
              mode={mode}
              showMetric={agreementDisplay === "matrix"}
              onTopKChange={setTopK}
              onMetricChange={setMetric}
              onModeChange={setMode}
            />
            <DownloadMenu
              ariaLabel={`Download method-agreement ${agreementDisplay}`}
              items={
                agreementDisplay === "matrix"
                  ? [
                      {
                        label: "Agreement matrix",
                        format: "PNG",
                        description: "Symmetric agreement matrix, at print resolution.",
                        onSelect: handleDownloadAgreementPng,
                      },
                      {
                        label: "Complete matrix",
                        format: "CSV",
                        description:
                          "Current methods, metric, mode, and top-edge limit.",
                        onSelect: () =>
                          downloadCsv(
                            `method-agreement-${metric}-${mode}-top-${topK}.csv`,
                            [
                              ["algorithm", ...matrixAlgorithmIds],
                              ...matrixAlgorithmIds.map((rowId) => [
                                rowId,
                                ...matrixAlgorithmIds.map((columnId) =>
                                  rowId === columnId
                                    ? 1
                                    : pairSimilarity(rowId, columnId).toFixed(6),
                                ),
                              ]),
                            ],
                          ),
                      },
                    ]
                  : [
                      {
                        label: `${overlapLabel} figure`,
                        format: "PNG",
                        description: "The figure as shown, at print resolution.",
                        onSelect: () => handleDownloadOverlap("png"),
                      },
                      {
                        label: `${overlapLabel} figure`,
                        format: "SVG",
                        description: "Editable vector version.",
                        onSelect: () => handleDownloadOverlap("svg"),
                      },
                      {
                        label: "Intersection data",
                        format: "CSV",
                        description:
                          "Exact method combinations and their top-ranked edges.",
                        onSelect: () =>
                          downloadCsv(
                            `method-overlap-${mode}-top-${topK}.csv`,
                            [
                              ["intersection", "method_count", "edge_count", "edge"],
                              ...setIntersections.flatMap((intersection) =>
                                intersection.edges.map((edge) => [
                                  intersection.members.join(" + "),
                                  intersection.members.length,
                                  intersection.edges.length,
                                  edge,
                                ]),
                              ),
                            ],
                          ),
                      },
                    ]
              }
            />
          </div>
        }
      >
        {eligibleAlgorithmIds.length >= 2 ? (
          <>
            <div className="mb-5 flex items-end justify-between gap-4 border-b border-slate-200">
              <div
                className="flex items-center gap-6"
                role="tablist"
                aria-label="Method agreement view"
              >
                {(
                  [
                    { value: "matrix", label: "Matrix" },
                    { value: "overlap", label: overlapLabel },
                  ] as Array<{ value: AgreementDisplay; label: string }>
                ).map((option) => {
                  const isActive = agreementDisplay === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls="method-agreement-view"
                      title={
                        option.value === "overlap"
                          ? "Venn is used for two or three methods; UpSet is used for four or more."
                          : undefined
                      }
                      onClick={() => setAgreementDisplay(option.value)}
                      className={`relative -mb-px min-h-10 border-b-2 px-0.5 pb-2 text-sm font-bold transition focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30 ${
                        isActive
                          ? "border-[#087ead] text-[#087ead]"
                          : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="hidden pb-2 text-xs font-semibold text-slate-400 sm:block">
                {plural(eligibleAlgorithmIds.length, "method")}
              </p>
            </div>
            <div id="method-agreement-view" role="tabpanel">
            {agreementDisplay === "matrix" ? (
              <>
            <div
              className="grid w-full gap-6 xl:grid-cols-[minmax(0,var(--agreement-figure-width))_minmax(340px,1fr)] xl:items-stretch"
              style={{
                ["--agreement-figure-width" as string]: `${heatmapLayout.width + matrixAlignmentOffset}px`,
                maxWidth: heatmapLayout.width + matrixAlignmentOffset + 444,
              }}
            >
              <div className="min-w-0">
            {shortMethodNote ? (
              <p className="mb-3 inline-block border-l-[3px] border-[#fd8d3c] bg-[#fff7ef] px-3 py-1.5 text-[12.5px] text-slate-800">
                {shortMethodNote}
              </p>
            ) : null}
            <div className="overflow-x-auto pb-1" style={{ marginLeft: matrixAlignmentOffset }}>
              {matrixAlgorithmIds.length > 0 ? (
                <AgreementHeatmap
                  svgRef={heatmapSvgRef}
                  methods={matrixAlgorithmIds}
                  similarity={pairSimilarity}
                  sizeOf={(id) => rankedKeys.get(id)?.length ?? 0}
                  topK={topK}
                  metricLabel={AGREEMENT_METRIC_SHORT_LABELS[metric]}
                  showValues={showAgreementValues}
                  selectedPair={selectedPair}
                  onSelectPair={(pair) => {
                    if (pair) setPairDetailGroup("shared");
                    setRequestedPair(pair);
                  }}
                />
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">
              <p>
                Select a cell to compare methods. Mirrored cells show the same score.
              </p>
              <label className="inline-flex items-center gap-2 font-semibold text-slate-600">
                <input
                  id="agreement-show-values"
                  type="checkbox"
                  checked={showAgreementValues}
                  onChange={(event) => setShowAgreementValues(event.target.checked)}
                  className="accent-[#087ead]"
                />
                Show values
              </label>
            </div>
              </div>
              {pairDetails ? (
                <AgreementDetailPanel
                  eyebrow="Selected pair"
                  fitToFigure
                  selectionKey={pairDetails.firstId + "|" + pairDetails.secondId}
                  title={`${pairDetails.firstId} × ${pairDetails.secondId}`}
                  subtitle={`Top ${topK.toLocaleString()} edges · ${COMPARISON_MODE_LABELS[mode]}`}
                  stats={[
                    { label: AGREEMENT_METRIC_SHORT_LABELS[metric], value: (selectedPairScore ?? 0).toFixed(2) },
                    { label: "Shared", value: pairDetails.shared.length.toLocaleString() },
                    { label: "Distinct", value: (pairDetails.shared.length + pairDetails.firstOnly.length + pairDetails.secondOnly.length).toLocaleString() },
                  ]}
                  proportion={[
                    { label: `${pairDetails.firstId} only`, count: pairDetails.firstOnly.length, tone: "left" },
                    { label: "Shared", count: pairDetails.shared.length, tone: "core" },
                    { label: `${pairDetails.secondId} only`, count: pairDetails.secondOnly.length, tone: "right" },
                  ]}
                  secondaryStats={
                    pairEvidence
                      ? [
                          {
                            label: "Same sign",
                            value: pairEvidence.signCompared ? percent(pairEvidence.signSame, pairEvidence.signCompared) : "–",
                            note: pairEvidence.signCompared
                              ? `${pairEvidence.signSame} of ${pairEvidence.signCompared} shared edges with a sign`
                              : pairEvidence.bothSigned
                                ? "No shared edge with a sign"
                                : "Not applicable: unsigned method",
                          },
                          {
                            label: "Same direction",
                            value: pairEvidence.directionCompared ? percent(pairEvidence.directionSame, pairEvidence.directionCompared) : "–",
                            note: !pairEvidence.bothDirected
                              ? "Not applicable: undirected method"
                              : pairEvidence.directionCompared
                                ? `${pairEvidence.directionSame} of ${pairEvidence.directionCompared} gene pairs linked by both`
                                : "No gene pair linked by both",
                          },
                        ]
                      : undefined
                  }
                  extraHeader={pairEvidence?.showSigns ? "Sign" : undefined}
                  groups={[
                    { key: "shared", label: "Shared", rows: pairDetails.shared },
                    { key: "first", label: `${pairDetails.firstId} only`, rows: pairDetails.firstOnly },
                    { key: "second", label: `${pairDetails.secondId} only`, rows: pairDetails.secondOnly },
                  ].map((group) => ({
                    ...group,
                    rows: group.rows.map((edge) => ({
                      edge,
                      ranks: [rankLookup.get(pairDetails.firstId)?.get(edge) ?? null, rankLookup.get(pairDetails.secondId)?.get(edge) ?? null],
                      extra: pairEvidence?.showSigns
                        ? (() => {
                            const a = pairEvidence.firstSign(edge);
                            const b = pairEvidence.secondSign(edge);
                            return {
                              text: `${SIGN_SYMBOL[a]} / ${SIGN_SYMBOL[b]}`,
                              warn: !!a && !!b && a !== b,
                              title: `${pairDetails.firstId}: ${a > 0 ? "activation" : a < 0 ? "repression" : "no sign"} · ${pairDetails.secondId}: ${b > 0 ? "activation" : b < 0 ? "repression" : "no sign"}`,
                            };
                          })()
                        : undefined,
                    })),
                  }))}
                  activeGroup={pairDetailGroup}
                  onGroupChange={(key) => setPairDetailGroup(key as PairDetailGroup)}
                  rankHeaders={[pairDetails.firstId, pairDetails.secondId]}
                  onReset={isDefaultPair ? undefined : () => setRequestedPair(null)}
                  resetLabel="Reset"
                  onDownload={() =>
                    downloadCsv(`pair-${pairDetails.firstId}-${pairDetails.secondId}-top-${topK}.csv`, [
                      ["group", "edge", `rank_${pairDetails.firstId}`, `rank_${pairDetails.secondId}`, `sign_${pairDetails.firstId}`, `sign_${pairDetails.secondId}`],
                      ...[
                        ["shared", pairDetails.shared],
                        [`${pairDetails.firstId}_only`, pairDetails.firstOnly],
                        [`${pairDetails.secondId}_only`, pairDetails.secondOnly],
                      ].flatMap(([group, edges]) =>
                        (edges as string[]).map((edge) => [
                          group as string,
                          edge,
                          rankLookup.get(pairDetails.firstId)?.get(edge) ?? "",
                          rankLookup.get(pairDetails.secondId)?.get(edge) ?? "",
                          pairEvidence?.firstSign(edge) ?? 0,
                          pairEvidence?.secondSign(edge) ?? 0,
                        ]),
                      ),
                    ])
                  }
                />
              ) : null}
            </div>
            {omittedAlgorithmIds.length ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                Not included in this mode: {omittedAlgorithmIds.join(", ")}.{" "}
                {mode === "sign"
                  ? "These methods do not report edge signs."
                  : "These methods do not report direction."}
              </p>
            ) : null}
              </>
            ) : (
              <section
                role="tabpanel"
                aria-label={`${overlapLabel} overlap view`}
              >
                {setIntersections.length ? (
                  eligibleAlgorithmIds.length <= 3 ? (
                    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
                      <div className="min-w-0">
                        <EulerDiagram
                          svgRef={overlapSvgRef}
                          methods={eligibleAlgorithmIds}
                          intersections={setIntersections}
                          selectedKey={selectedIntersection?.key ?? null}
                          onSelect={setSelectedIntersectionKey}
                        />
                        <p className="mt-2 text-center text-xs text-slate-500">
                          Circle and overlap areas are proportional to edge counts; each region shows its count and share of all edges in the diagram. Selected region in blue. Click any region to see its edges.
                        </p>
                      </div>
                      {intersectionPanel(0)}
                    </div>
                  ) : (
                    <div>
                      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-600">
                        <span>Order bars by</span>
                        <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Order intersections by">
                          {([false, true] as const).map((degree) => (
                            <button
                              key={String(degree)}
                              type="button"
                              aria-pressed={upsetByDegree === degree}
                              onClick={() => setUpsetByDegree(degree)}
                              className={`rounded-md px-2.5 py-1 transition ${upsetByDegree === degree ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                            >
                              {degree ? "number of methods" : "size"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
                        <div className="min-w-0">
                      <div className="overflow-x-auto">
                        <UpSetPlot
                          svgRef={overlapSvgRef}
                          methodOrder={orderedAlgorithmIds}
                          intersections={setIntersections}
                          visibleCount={upsetVisibleCount}
                          byDegree={upsetByDegree}
                          selectedKey={selectedIntersection?.key ?? null}
                          onSelect={setSelectedIntersectionKey}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs leading-5 text-slate-500">
                        <p>Selected group in blue. Click any bar to see its edges.</p>
                        {setIntersections.length > UPSET_INTERSECTION_LIMIT ? (
                          <button
                            type="button"
                            onClick={() =>
                              setUpSetVisibleCount(
                                upsetVisibleCount >= setIntersections.length
                                  ? UPSET_INTERSECTION_LIMIT
                                  : Math.min(setIntersections.length, upsetVisibleCount + 10),
                              )
                            }
                            className="font-bold text-[#087ead] transition hover:text-[#06688f]"
                          >
                            {upsetVisibleCount >= setIntersections.length
                              ? `Show top ${UPSET_INTERSECTION_LIMIT}`
                              : `Show ${Math.min(10, setIntersections.length - upsetVisibleCount)} more`}
                          </button>
                        ) : null}
                      </div>
                        </div>
                        {intersectionPanel(upsetPlotTop(upsetByDegree))}
                      </div>
                    </div>
                  )
                ) : (
                  <EmptyState
                    title="No top-ranked edges to compare"
                    detail="Choose a different edge identity mode or include results with ranked edges."
                  />
                )}
                {omittedAlgorithmIds.length ? (
                  <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    Not included in this mode: {omittedAlgorithmIds.join(", ")}.{" "}
                    {mode === "sign"
                      ? "These methods do not report edge signs."
                      : "These methods do not report direction."}
                  </p>
                ) : null}
              </section>
            )}
            </div>
          </>
        ) : (
          <EmptyState
            title={`Not enough ${mode === "sign" ? "signed" : "directed"} methods`}
            detail="Choose another comparison mode or select more compatible algorithms."
          />
        )}
      </Panel>
      ) : null}
      {comparisonAlgorithmIds.length >= 2 && orderedAlgorithmIds.length >= 2 && regulatorRows.length ? (
        <Panel
          title="Key regulators across methods"
          description={`Each cell is a gene's rank as a regulator in one method's top ${topK.toLocaleString()} edges (1 = most targets). Methods often agree more on which regulators matter than on single edges.`}
          aside={
            <DownloadMenu
              ariaLabel="Download key regulators"
              items={[
                { label: "Regulator figure", format: "PNG", description: "The figure as shown, at print resolution.", onSelect: () => handleDownloadRegulators("png") },
                { label: "Regulator figure", format: "SVG", description: "Editable vector version.", onSelect: () => handleDownloadRegulators("svg") },
                {
                  label: "Regulator ranks",
                  format: "CSV",
                  description: "Rank and edge count per method for the genes shown.",
                  onSelect: () => downloadCsv(`key-regulators-top-${topK}.csv`, regulatorCsvRows()),
                },
              ]}
            />
          }
        >
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
            <div className="min-w-0">
              <div className="overflow-x-auto">
                <RegulatorHeatmap
                  svgRef={regulatorSvgRef}
                  methods={orderedAlgorithmIds}
                  directed={regulatorDirected}
                  rows={regulatorRows}
                  topK={topK}
                  selectedGene={selectedRegulator?.gene ?? null}
                  onSelect={setRequestedGene}
                />
              </div>
              <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">
                Darker = ranked higher; blank = no edge in that method&apos;s top {topK.toLocaleString()}. Directed methods rank genes by
                targets, undirected ones{regulatorDirected.some((value) => !value) ? ` (${orderedAlgorithmIds.filter((_, index) => !regulatorDirected[index]).join(", ")})` : ""} by
                all connections. Rows sorted by median rank; columns grouped by method similarity. Top-edge limit is set in Method agreement.
              </p>
            </div>
            {selectedRegulator ? (
              <AgreementDetailPanel
                eyebrow={isDefaultRegulator ? "Selected · top regulator" : "Selected regulator"}
                plotTop={regulatorPlotTop(orderedAlgorithmIds)}
                selectionKey={selectedRegulator.gene}
                title={selectedRegulator.gene}
                subtitle={`Top ${topK.toLocaleString()} edges per method`}
                stats={[
                  { label: "Median rank", value: formatRank(selectedRegulator.median) },
                  { label: "Ranked by", value: `${selectedRegulator.rankedBy} of ${orderedAlgorithmIds.length}` },
                  {
                    label: "Best rank",
                    value: String(Math.min(...selectedRegulator.ranks.map((rank) => rank ?? Infinity))).replace("Infinity", "–"),
                  },
                ]}
                groups={[
                  {
                    key: "methods",
                    label: "Methods",
                    rows: orderedAlgorithmIds
                      .map((id, index) => ({ edge: id, ranks: [selectedRegulator.ranks[index], selectedRegulator.links[index] || null] }))
                      .sort((first, second) => (first.ranks[0] ?? Infinity) - (second.ranks[0] ?? Infinity)),
                  },
                ]}
                activeGroup="methods"
                onGroupChange={() => undefined}
                firstHeader="Method"
                monoFirst={false}
                rankHeaders={["Rank", "Targets"]}
                footnote="For methods without direction, targets = connected genes"
                onReset={isDefaultRegulator ? undefined : () => setRequestedGene(null)}
                resetLabel="Back to top"
                onDownload={() =>
                  downloadCsv(`regulator-${selectedRegulator.gene}-top-${topK}.csv`, [
                    ["method", "directed", "rank", "targets"],
                    ...orderedAlgorithmIds.map((id, index) => [
                      id,
                      regulatorDirected[index] ? "yes" : "no",
                      selectedRegulator.ranks[index] ?? "",
                      selectedRegulator.links[index],
                    ]),
                  ])
                }
              />
            ) : null}
          </div>
        </Panel>
      ) : null}
      {isAgreementHelpOpen && typeof document !== "undefined" ? (
        <MethodAgreementHelpModal
          onClose={() => setIsAgreementHelpOpen(false)}
        />
      ) : null}
      <MethodOutputPanel
        algorithmResults={algorithmResults}
        algorithmMetaMap={algorithmMetaMap}
        activeAlgorithmIds={activeAlgorithmIds}
        selectedResultScopeId={selectedResultScopeId}
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
  selectedResultScopeId,
  tasks,
  visualizationContext,
  isContextLoading,
  onTrajectoryGenesChange,
}: ResultsInsightsSectionProps) {
  // Candidate regulator → target edges for the Trajectory tab: directed edges
  // in the top 100 of each directed method, ranked by how many methods agree.
  const timingEdges = useMemo<TimingEdge[]>(() => {
    const directed = activeAlgorithmIds.filter((id) => algorithmMetaMap.get(id)?.directed ?? true);
    const tally = new Map<string, { source: string; target: string; support: number; rankSum: number; signSum: number }>();
    directed.forEach((id) => {
      const seen = new Set<string>();
      [...(algorithmEdgeRows[id] ?? [])]
        .sort((a, b) => a.rank - b.rank || b.confidence - a.confidence)
        .some((edge) => {
          if (edge.source === edge.target) return false;
          const key = `${edge.source}\u0000${edge.target}`;
          if (seen.has(key)) return false;
          seen.add(key);
          const entry = tally.get(key) ?? { source: edge.source, target: edge.target, support: 0, rankSum: 0, signSum: 0 };
          entry.support += 1;
          entry.rankSum += seen.size;
          entry.signSum += edge.sign;
          tally.set(key, entry);
          return seen.size >= 100;
        });
    });
    return [...tally.values()]
      .sort((a, b) => b.support - a.support || a.rankSum / a.support - b.rankSum / b.support)
      .slice(0, 60)
      .map((entry) => ({
        source: entry.source,
        target: entry.target,
        support: entry.support,
        methods: directed.length,
        sign: entry.signSum > 0 ? 1 : entry.signSum < 0 ? -1 : 0,
      }));
  }, [activeAlgorithmIds, algorithmEdgeRows, algorithmMetaMap]);

  if (view === "agreement") {
    return (
      <AgreementView
        algorithmEdgeRows={algorithmEdgeRows}
        algorithmMetaMap={algorithmMetaMap}
        algorithmResults={algorithmResults}
        activeAlgorithmIds={activeAlgorithmIds}
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
        edges={timingEdges}
      />
    );
  }
  return (
    <BenchmarkWithStability
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

/** Benchmark tab with the repeat-run stability it plots against accuracy. */
function BenchmarkWithStability(props: Omit<ComponentProps<typeof BenchmarkInsights>, "stability">) {
  const { algorithmResults, activeAlgorithmIds, selectedResultScopeId } = props;
  const stability = useMemo(
    () =>
      buildStabilityRows(algorithmResults, activeAlgorithmIds, selectedResultScopeId).map((row) => ({
        algorithmId: row.algorithmId,
        medianRho: row.medianRho,
        runCount: row.runCount,
      })),
    [algorithmResults, activeAlgorithmIds, selectedResultScopeId],
  );
  return <BenchmarkInsights {...props} stability={stability} />;
}
