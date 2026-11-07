"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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
  consensusEdges,
  type BeelineRankedEdge,
  normalizeReferenceSign,
  type BenchmarkCurvePoint,
  type ReferenceSign,
} from "../_lib/benchmark";
import { downloadSvg, downloadSvgPng } from "../_lib/downloads";
import DownloadMenu from "./DownloadMenu";
import {
  CurveSmallMultiples,
  DIRECTION_COLORS,
  MotifHeatmap,
  PATH_COLORS,
  StackedBars,
  SummaryHeatmap,
  overallRanks,
  type FigureRow,
} from "./BenchmarkFigures";

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
  activationReferenceCount: number | null;
  inhibitionPrecision: number | null;
  inhibitionEpr: number | null;
  inhibitionSelectedCount: number | null;
  inhibitionReferenceCount: number | null;
  runtimeSeconds: number;
  pr: CurvePoint[];
  roc: CurvePoint[];
  directionAware: boolean;
  motifs: MotifCounts | null;
  pathCounts: PathCounts | null;
  rankedEdges: BeelineRankedEdge[];
  /** Top-K predictions (K = reference size) that link a reference gene pair. */
  directionSign: { examined: number; pairs: number; rightDirection: number; signCompared: number; rightSign: number };
};

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
  titleAction,
  description,
  children,
  aside,
}: {
  title: string;
  titleAction?: ReactNode;
  description?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-extrabold text-slate-950">{title}</h3>
            {titleAction}
          </div>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {description}
            </p>
          ) : null}
        </div>
        {aside}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function BenchmarkFormula({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-slate-900 [&_math]:mx-auto [&_math]:min-w-max [&_math]:text-[1.05rem] sm:[&_math]:text-[1.15rem]">
      {children}
    </div>
  );
}

function BenchmarkSummaryHelpModal({
  candidateGeneCount,
  possibleEdges,
  referenceEdgeCount,
  excludedReferenceEdges,
  randomBaseline,
  activationReferenceCount,
  inhibitionReferenceCount,
  signedMetricsAvailable,
  exampleRow,
  onClose,
}: {
  candidateGeneCount: number;
  possibleEdges: number;
  referenceEdgeCount: number;
  excludedReferenceEdges: number;
  randomBaseline: number;
  activationReferenceCount: number | null;
  inhibitionReferenceCount: number | null;
  signedMetricsAvailable: boolean;
  exampleRow: BenchmarkRow;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const exampleTruePositives = Math.round(
    exampleRow.precisionAtK * exampleRow.earlyPrecisionSelectedCount,
  );

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
        aria-labelledby="benchmark-summary-help-title"
        aria-describedby="benchmark-summary-help-summary"
        className="flex max-h-[min(800px,calc(100vh-4rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl animate-modal-panel"
      >
        <header className="flex items-start justify-between gap-5 border-b border-slate-100 px-6 py-5">
          <div>
            <h3
              id="benchmark-summary-help-title"
              className="text-lg font-extrabold tracking-tight text-slate-950"
            >
              Understanding the benchmark summary
            </h3>
            <p
              id="benchmark-summary-help-summary"
              className="mt-1 text-sm leading-5 text-slate-500"
            >
              How predictions are ranked and compared with the uploaded reference.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 transition hover:border-[#087ead]/30 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
            aria-label="Close benchmark summary help"
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5 text-sm leading-6 text-slate-600">
          <section>
            <h4 className="font-extrabold text-slate-900">Current evaluation universe</h4>
            <p className="mt-2">
              The candidate genes are the genes in the usable reference network after
              intersecting it with the analyzed data. With <strong>{candidateGeneCount}</strong>{" "}
              genes, self-interactions are excluded, leaving{" "}
              <strong>{possibleEdges.toLocaleString()}</strong> possible directed
              source → target interactions. Of those, <strong>{referenceEdgeCount}</strong>{" "}
              are labelled as reference interactions.
            </p>
            <BenchmarkFormula>
              <math display="block" aria-label="N equals G times G minus one; random precision pi equals P divided by N">
                <mrow>
                  <mi>N</mi><mo>=</mo><mi>G</mi><mo stretchy="false">(</mo><mi>G</mi><mo>−</mo><mn>1</mn><mo stretchy="false">)</mo>
                  <mspace width="2em" />
                  <mi>π</mi><mo>=</mo><mfrac><mi>P</mi><mi>N</mi></mfrac>
                  <mo>=</mo><mn>{randomBaseline.toFixed(3)}</mn>
                </mrow>
              </math>
            </BenchmarkFormula>
            <p className="mt-2 text-xs text-slate-500">
              <em>G</em> is the candidate-gene count, <em>N</em> the directed candidate
              count, <em>P</em> the usable reference-edge count, and π the precision
              expected from random selection. {excludedReferenceEdges > 0 ? (
                <>
                  <strong>{excludedReferenceEdges}</strong> uploaded reference{" "}
                  {excludedReferenceEdges === 1 ? "row was" : "rows were"} excluded
                  because of a self-interaction or a gene not retained for this analysis.
                </>
              ) : (
                <>No uploaded reference rows were excluded.</>
              )}
            </p>
          </section>

          <section className="mt-5 border-t border-slate-100 pt-5">
            <h4 className="font-extrabold text-slate-900">How predictions are ranked</h4>
            <p className="mt-2">
              For every method, GRNScope keeps one strongest result per directed edge,
              removes self-interactions and genes outside the candidate set, and ranks the
              remaining edges by descending <strong>absolute raw score</strong>. Positive
              and negative scores therefore compete by strength, not sign. Score ties are
              evaluated together rather than broken arbitrarily.
            </p>
            <p className="mt-2">
              Unreported candidates form a zero-score tail. The precision–recall and ROC
              curves extend through that tail to the full candidate universe, so methods
              are evaluated against the same denominator even when they output different
              numbers of nonzero edges.
            </p>
          </section>

          <section className="mt-5 border-t border-slate-100 pt-5">
            <h4 className="font-extrabold text-slate-900">AUPRC and AUROC</h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <strong className="text-slate-800">AUPRC ratio</strong>
                <p className="mt-1 text-xs leading-5">
                  Area under the precision–recall curve divided by random precision.
                  The raw AUPRC is shown below the ratio.
                </p>
                <div className="mt-3 text-center">
                  <math display="block" aria-label="AUPRC ratio equals AUPRC divided by pi">
                    <mrow><msub><mi>R</mi><mtext>AUPRC</mtext></msub><mo>=</mo><mfrac><mtext>AUPRC</mtext><mi>π</mi></mfrac></mrow>
                  </math>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <strong className="text-slate-800">AUROC</strong>
                <p className="mt-1 text-xs leading-5">
                  Area under the true-positive-rate versus false-positive-rate curve.
                  It is an absolute value: 0.500 is random, above 0.500 is better, and
                  below 0.500 is worse.
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Both areas are integrated with trapezoids at each distinct score threshold.
              AUPRC is usually the more informative headline when reference edges are rare.
            </p>
          </section>

          <section className="mt-5 border-t border-slate-100 pt-5">
            <h4 className="font-extrabold text-slate-900">Early precision ratio</h4>
            <p className="mt-2">
              Let <em>K = P</em>, the number of usable reference interactions. GRNScope
              finds the score of the K-th nonzero prediction and selects every prediction
              at or above that score. Ties at the cutoff are all included, so the selected
              count <em>S</em> can be greater than K.
            </p>
            <BenchmarkFormula>
              <math display="block" aria-label="Early precision equals true positives divided by selected predictions; early precision ratio equals early precision divided by pi">
                <mrow>
                  <mtext>EP</mtext><mo>=</mo><mfrac><mtext>TP</mtext><mi>S</mi></mfrac>
                  <mspace width="2em" />
                  <mtext>EPR</mtext><mo>=</mo><mfrac><mtext>EP</mtext><mi>π</mi></mfrac>
                </mrow>
              </math>
            </BenchmarkFormula>
            <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/60 p-4">
              <p className="font-extrabold text-slate-900">Example · {exampleRow.algorithmId}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                The cutoff selects {exampleRow.earlyPrecisionSelectedCount} predictions,
                including {exampleTruePositives} reference edges. EP is therefore{" "}
                {exampleTruePositives}/{exampleRow.earlyPrecisionSelectedCount} ={" "}
                {exampleRow.precisionAtK.toFixed(3)}, and EPR is EP divided by the
                exact π ({randomBaseline.toFixed(6)}) ={" "}
                <strong>{exampleRow.earlyPrecisionRatio.toFixed(3)}×</strong>. A ratio above
                1 means better-than-random early recovery; below 1 means worse.
              </p>
            </div>
          </section>

          <section className="mt-5 border-t border-slate-100 pt-5">
            <h4 className="font-extrabold text-slate-900">Activation and inhibition EPR</h4>
            {signedMetricsAvailable ? (
              <p className="mt-2">
                These repeat the early-precision calculation for the reference&apos;s{" "}
                {activationReferenceCount ?? 0} activating and{" "}
                {inhibitionReferenceCount ?? 0}{" "}inhibitory interactions. For each subset,
                known reference edges of the opposite type are removed from the candidate
                ranking and the subset&apos;s own random baseline is used.
              </p>
            ) : (
              <p className="mt-2">
                These columns are hidden because the uploaded reference does not label
                interactions as activating or inhibitory.
              </p>
            )}
            <p className="mt-2 rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3 text-xs leading-5 text-amber-900">
              These columns measure recovery of signed <strong>reference subsets</strong>.
              They do not test whether a method inferred the correct regulatory sign; the
              method ranking still uses absolute score. An undirected method also gives the
              same score to both orientations, so it cannot favor the correct direction.
            </p>
          </section>

          <section className="mt-5 border-t border-slate-100 pt-5">
            <h4 className="font-extrabold text-slate-900">Reading and downloading the summary</h4>
            <p className="mt-2">
              Methods are ranked by their mean rank over AUPRC ratio, early precision ratio
              and AUROC (the bar on the left). In each column, circle size and shade compare
              the methods: larger and darker is better. Grey dots mark values no better than
              random; n/a means the metric is unavailable for that method or reference. The Consensus row is
              the rank average of all selected methods, as in DREAM5. Hover a circle for the
              exact value. The CSV keeps the raw metrics, ratios, selected-edge counts,
              directionality, stability and runtime.
            </p>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function CurvePerformanceHelpModal({
  randomBaseline,
  onClose,
}: {
  randomBaseline: number;
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
        aria-labelledby="curve-performance-help-title"
        aria-describedby="curve-performance-help-summary"
        className="flex max-h-[min(800px,calc(100vh-4rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl animate-modal-panel"
      >
        <header className="flex items-start justify-between gap-5 border-b border-slate-100 px-6 py-5">
          <div>
            <h3
              id="curve-performance-help-title"
              className="text-lg font-extrabold tracking-tight text-slate-950"
            >
              Understanding the precision-recall and ROC curves
            </h3>
            <p
              id="curve-performance-help-summary"
              className="mt-1 text-sm leading-5 text-slate-500"
            >
              How ranked predictions become precision–recall and ROC curves.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 transition hover:border-[#087ead]/30 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
            aria-label="Close precision-recall and ROC curves help"
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5 text-sm leading-6 text-slate-600">
          <section>
            <h4 className="font-extrabold text-slate-900">One ranking, many thresholds</h4>
            <p className="mt-2">
              Each method&apos;s directed edges are ordered by descending absolute raw
              score. GRNScope lowers the acceptance threshold through that ranking and
              recalculates the confusion matrix at every distinct score. Tied edges enter
              together; unreported candidates form a zero-score tail so every method is
              judged against the same candidate universe.
            </p>
            <BenchmarkFormula>
              <math display="block" aria-label="Recall equals true positives divided by positives; false-positive rate equals false positives divided by negatives; precision equals true positives divided by true positives plus false positives">
                <mrow>
                  <mtext>Recall = TPR</mtext><mo>=</mo><mfrac><mtext>TP</mtext><mi>P</mi></mfrac>
                  <mspace width="1.5em" />
                  <mtext>FPR</mtext><mo>=</mo><mfrac><mtext>FP</mtext><mi>N</mi></mfrac>
                  <mspace width="1.5em" />
                  <mtext>Precision</mtext><mo>=</mo><mfrac><mtext>TP</mtext><mrow><mtext>TP</mtext><mo>+</mo><mtext>FP</mtext></mrow></mfrac>
                </mrow>
              </math>
            </BenchmarkFormula>
            <p className="mt-2 text-xs text-slate-500">
              <em>P</em> and <em>N</em> are the counts of reference-positive and
              reference-negative candidate interactions.
            </p>
          </section>

          <section className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h4 className="font-extrabold text-slate-900">Precision–recall</h4>
              <p className="mt-1 text-xs leading-5">
                Recall measures coverage of the reference; precision measures how many
                accepted predictions are correct. Curves nearer the upper-right are
                better. The dashed horizontal random-precision baseline is currently{" "}
                <strong>{randomBaseline.toFixed(3)}</strong>. AUPRC summarizes the curve.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h4 className="font-extrabold text-slate-900">ROC</h4>
              <p className="mt-1 text-xs leading-5">
                ROC compares recovered reference edges with false alarms across all
                thresholds. Curves nearer the upper-left are better. The diagonal is a
                random classifier; AUROC is 0.500 at chance and 1.000 for a perfect
                ranking.
              </p>
            </div>
          </section>

          <section className="mt-5 border-t border-slate-100 pt-5">
            <h4 className="font-extrabold text-slate-900">Why the two views can disagree</h4>
            <p className="mt-2">
              Regulatory networks are sparse, so reference-negative candidates greatly
              outnumber positives. ROC can therefore look strong while early precision is
              modest. Precision–recall is usually more revealing when the highest-ranked
              edges will be followed up; ROC describes separation across the full ranking.
            </p>
          </section>

          <section className="mt-5 border-t border-slate-100 pt-5">
            <h4 className="font-extrabold text-slate-900">Early recall is only a zoom</h4>
            <p className="mt-2">
              “Early recall (0–0.25)” magnifies the first quarter of recovered reference
              edges. It does not recalculate the ranking or AUPRC. Use it when only a
              limited number of predictions can be tested experimentally.
            </p>
          </section>

          <section className="mt-5 border-t border-slate-100 pt-5">
            <h4 className="font-extrabold text-slate-900">Brief example</h4>
            <div className="mt-2 rounded-xl border border-sky-100 bg-sky-50/60 p-4 text-xs leading-5">
              Suppose the first 10 predictions contain 4 of 20 reference edges and 6
              false positives, while 100 candidates are reference-negative. Precision is
              4/10 = <strong>0.40</strong>, recall is 4/20 = <strong>0.20</strong>, and
              FPR is 6/100 = <strong>0.06</strong>. The same threshold appears at
              (0.20, 0.40) on the PR curve and (0.06, 0.20) on the ROC curve.
            </div>
          </section>

          <section className="mt-5 border-t border-slate-100 pt-5">
            <h4 className="font-extrabold text-slate-900">Interaction and downloads</h4>
            <p className="mt-2">
              Each small panel shows one method in black (the consensus in blue) with every
              other method in light grey behind it, so each curve can be read on its own and
              against the field. Switch between precision–recall and ROC at the top. PNG and
              SVG download the panels as shown; the CSV contains every plotted point for both
              curve types.
            </p>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function AdditionalBenchmarkHelpModal({
  kind,
  referenceEdgeCount,
  referenceMotifs,
  onClose,
}: {
  kind: "motif" | "path";
  referenceEdgeCount: number;
  referenceMotifs: MotifCounts;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const isMotif = kind === "motif";
  const title = isMotif
    ? "Understanding motif count ratios"
    : "Understanding top-prediction paths";
  const summary = isMotif
    ? "How small regulatory patterns are counted and compared with the reference."
    : "How correct and incorrect top-ranked edges are classified using the reference.";

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
        aria-labelledby="additional-benchmark-help-title"
        aria-describedby="additional-benchmark-help-summary"
        className="flex max-h-[min(800px,calc(100vh-4rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl animate-modal-panel"
      >
        <header className="flex items-start justify-between gap-5 border-b border-slate-100 px-6 py-5">
          <div>
            <h3
              id="additional-benchmark-help-title"
              className="text-lg font-extrabold tracking-tight text-slate-950"
            >
              {title}
            </h3>
            <p
              id="additional-benchmark-help-summary"
              className="mt-1 text-sm leading-5 text-slate-500"
            >
              {summary}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 transition hover:border-[#087ead]/30 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
            aria-label={"Close " + (isMotif ? "motif ratio" : "top-prediction path") + " help"}
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5 text-sm leading-6 text-slate-600">
          {isMotif ? (
            <>
              <section>
                <h4 className="font-extrabold text-slate-900">Network used for counting</h4>
                <p className="mt-2">
                  For each method, GRNScope removes self-interactions, ranks directed
                  predictions by descending absolute aggregate weight, and keeps exactly
                  the top <strong>{referenceEdgeCount}</strong> edges—the size of the
                  usable reference network. Motifs are counted in that fixed-size
                  predicted network and in the reference.
                </p>
                <BenchmarkFormula>
                  <math display="block" aria-label="Motif ratio for motif type t equals predicted motif count divided by reference motif count">
                    <mrow>
                      <msub><mi>R</mi><mi>t</mi></msub><mo>=</mo>
                      <mfrac>
                        <msub><mi>M</mi><mrow><mtext>pred</mtext><mo>,</mo><mi>t</mi></mrow></msub>
                        <msub><mi>M</mi><mrow><mtext>ref</mtext><mo>,</mo><mi>t</mi></mrow></msub>
                      </mfrac>
                    </mrow>
                  </math>
                </BenchmarkFormula>
                <p className="mt-2 text-xs text-slate-500">
                  A ratio of 1 matches the reference count, 1.4 means 40% more, and 0.7
                  means 30% fewer. “—” means the reference count is zero, so a finite
                  ratio cannot be calculated.
                </p>
              </section>

              <section className="mt-5 border-t border-slate-100 pt-5">
                <h4 className="font-extrabold text-slate-900">The three structures</h4>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <strong className="text-slate-800">Feedback loop</strong>
                    <p className="mt-1 text-xs">A→B→C→A: a directed three-node cycle.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <strong className="text-slate-800">Feed-forward loop</strong>
                    <p className="mt-1 text-xs">A→B, A→C, B→C: direct and indirect regulation.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <strong className="text-slate-800">Mutual interaction</strong>
                    <p className="mt-1 text-xs">A↔B: both directed orientations are present.</p>
                  </div>
                </div>
              </section>

              <section className="mt-5 border-t border-slate-100 pt-5">
                <h4 className="font-extrabold text-slate-900">Reference denominators</h4>
                <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                  {[
                    ["Feedback", referenceMotifs.feedbackLoops],
                    ["Feed-forward", referenceMotifs.feedForwardLoops],
                    ["Mutual", referenceMotifs.mutualInteractions],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border border-sky-100 bg-sky-50/60 p-3">
                      <p className="text-lg font-extrabold tabular-nums text-slate-900">{value}</p>
                      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mt-5 border-t border-slate-100 pt-5">
                <h4 className="font-extrabold text-slate-900">What the ratio does not show</h4>
                <p className="mt-2">
                  This is a structural count comparison, not motif accuracy or exact
                  overlap. Two networks can have the same ratio while their motifs involve
                  completely different genes and edges. Use it to spot over- or
                  under-production of network patterns, then inspect specific edges
                  separately. The CSV contains the raw predicted counts used in the ratios.
                </p>
              </section>
            </>
          ) : (
            <>
              <section>
                <h4 className="font-extrabold text-slate-900">Which predictions enter a bar</h4>
                <p className="mt-2">
                  Each method&apos;s non-self directed predictions are ranked by descending
                  absolute weight. GRNScope starts with <em>K</em> equal to the{" "}
                  <strong>{referenceEdgeCount}</strong> usable reference edges and includes
                  every prediction tied at the K-th score, so a complete bar can contain
                  more than K edges.
                </p>
                <BenchmarkFormula>
                  <math display="block" aria-label="Selected predictions are edges whose absolute score is at least the K-th score, where K equals the number of reference edges">
                    <mrow>
                      <mi>K</mi><mo>=</mo><msub><mi>N</mi><mtext>ref</mtext></msub>
                      <mspace width="1.5em" />
                      <mi>S</mi><mo>=</mo>
                      <mo stretchy="false">{"{"}</mo>
                      <mi>e</mi><mo>:</mo><mo>|</mo><mi>w</mi><mo stretchy="false">(</mo><mi>e</mi><mo stretchy="false">)</mo><mo>|</mo>
                      <mo>≥</mo><msub><mi>w</mi><mrow><mo stretchy="false">(</mo><mi>K</mi><mo stretchy="false">)</mo></mrow></msub>
                      <mo stretchy="false">{"}"}</mo>
                    </mrow>
                  </math>
                </BenchmarkFormula>
              </section>

              <section className="mt-5 border-t border-slate-100 pt-5">
                <h4 className="font-extrabold text-slate-900">How segments are classified</h4>
                <div className="mt-3 space-y-2 text-xs leading-5">
                  <p><strong className="text-slate-800">Exact reference edge:</strong> the predicted source→target edge is present in the reference.</p>
                  <p><strong className="text-slate-800">Incorrect · 2 or 3 steps:</strong> the edge is absent, but its source reaches its target through the shortest directed reference path of that length.</p>
                  <p><strong className="text-slate-800">Incorrect · 4+ steps:</strong> the shortest directed path contains at least four reference edges.</p>
                  <p><strong className="text-slate-800">Incorrect · no path:</strong> no directed route from predicted source to target exists in the reference.</p>
                </div>
                <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3 text-xs leading-5 text-amber-900">
                  Direction matters. A path from target back to source does not count, and
                  predicted edges are never inserted into the reference graph during the
                  search.
                </p>
              </section>

              <section className="mt-5 border-t border-slate-100 pt-5">
                <h4 className="font-extrabold text-slate-900">Reading and downloading the bars</h4>
                <p className="mt-2">
                  Each bar is normalized to 100% of that method&apos;s selected predictions;
                  segment width is its share of the bar, from exact reference edges (black)
                  to wrong predictions with no reference path (lightest grey). Hover a segment
                  for the exact count and percentage. The CSV
                  preserves every path-length bin separately, including paths of 4, 5, and
                  more than 5 steps.
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

const CONSENSUS_ID = "Consensus";

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
  // Preserve historical full-data evaluation for archived results. New
  // bootstrap-only networks use all observed edges and mean raw scores.
  const bootstrapOnly = edges.some(
    (edge) => edge.network_estimator === "bootstrap_mean_v1",
  );
  const hasFullDataMarkers = !bootstrapOnly && edges.some(
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
          (bootstrapOnly ? edge.bootstrap_mean_raw_score : edge.full_data_raw_score) ??
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
    activationReferenceCount: metrics.activation?.referenceCount ?? null,
    inhibitionPrecision: metrics.inhibition?.precision ?? null,
    inhibitionEpr: metrics.inhibition?.ratio ?? null,
    inhibitionSelectedCount: metrics.inhibition?.selectedCount ?? null,
    inhibitionReferenceCount: metrics.inhibition?.referenceCount ?? null,
    runtimeSeconds,
    pr: metrics.pr,
    roc: metrics.roc,
    directionAware: methodSupportsDirection,
    motifs: motifCounts(motifNetwork),
    pathCounts,
    rankedEdges: metrics.rankedEdges,
    directionSign: directionSignCounts(metrics.rankedEdges, truth, truthSigns),
  };
}

/** Direction and sign of the top-K predictions that touch a reference gene pair. */
function directionSignCounts(
  rankedEdges: BeelineRankedEdge[],
  truth: Set<string>,
  truthSigns: Map<string, ReferenceSign>,
) {
  const top = rankedEdges.filter((edge) => edge.score > 0).slice(0, truth.size);
  let pairs = 0;
  let rightDirection = 0;
  let signCompared = 0;
  let rightSign = 0;
  top.forEach((ranked) => {
    const key = edgeKey(ranked.source, ranked.target);
    const reverse = edgeKey(ranked.target, ranked.source);
    if (!truth.has(key) && !truth.has(reverse)) return;
    pairs += 1;
    if (!truth.has(key)) return;
    rightDirection += 1;
    const edge = ranked.edge as AlgorithmResultEdge;
    const signedRuns = Number(edge.signed_selected_runs ?? 0);
    const referenceSign = truthSigns.get(key) ?? 0;
    if (!signedRuns || !referenceSign) return;
    signCompared += 1;
    const predicted = Number(edge.positive_selected_runs ?? 0) >= Number(edge.negative_selected_runs ?? 0) ? 1 : -1;
    if (predicted === referenceSign) rightSign += 1;
  });
  return { examined: top.length, pairs, rightDirection, signCompared, rightSign };
}





export type StabilityPoint = { algorithmId: string; medianRho: number | null; runCount: number };

export default function BenchmarkInsights({
  groundTruth,
  loading,
  algorithmMetaMap,
  algorithmResults,
  activeAlgorithmIds,
  selectedResultScopeId,
  tasks,
  stability = [],
}: {
  groundTruth: GroundTruthContext | undefined;
  loading: boolean;
  algorithmMetaMap: Map<string, AlgorithmCatalogItem>;
  algorithmResults: Record<string, AlgorithmStoredResult>;
  activeAlgorithmIds: string[];
  selectedResultScopeId: string;
  tasks: ProjectTask[];
  /** Repeat-run stability per algorithm (from the Comparison tab's data). */
  stability?: StabilityPoint[];
}) {
  const [isBenchmarkHelpOpen, setIsBenchmarkHelpOpen] = useState(false);
  const [isCurveHelpOpen, setIsCurveHelpOpen] = useState(false);
  const [additionalBenchmarkHelp, setAdditionalBenchmarkHelp] = useState<
    "motif" | "path" | null
  >(null);
  const benchmark = useMemo(() => {
    const truthEdges = groundTruth?.edges ?? [];
    if (!truthEdges.length) {
      return {
        rows: [] as BenchmarkRow[],
        consensus: null as BenchmarkRow | null,
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
    // Rank-average consensus of every selected method (DREAM5).
    const consensus =
      rows.length >= 2
        ? benchmarkAlgorithm({
            algorithmId: CONSENSUS_ID,
            edges: consensusEdges(rows.map((row) => row.rankedEdges), candidateGenes) as AlgorithmResultEdge[],
            truth,
            truthSigns,
            possibleEdges,
            runtimeSeconds: 0,
            methodSupportsDirection: true,
            candidateGenes,
            motifEdges: consensusEdges(rows.map((row) => row.rankedEdges), candidateGenes) as AlgorithmResultEdge[],
            motifReferenceEdgeCount,
            pathStats: null,
          })
        : null;
    return {
      rows,
      consensus,
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

  const summarySvgRef = useRef<SVGSVGElement | null>(null);
  const curveSvgRef = useRef<SVGSVGElement | null>(null);
  const motifSvgRef = useRef<SVGSVGElement | null>(null);
  const pathSvgRef = useRef<SVGSVGElement | null>(null);
  const directionSvgRef = useRef<SVGSVGElement | null>(null);
  const [curveKind, setCurveKind] = useState<"pr" | "roc">("pr");

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
  const signedMetricsAvailable = rows.some(
    (row) => row.activationEpr !== null || row.inhibitionEpr !== null,
  );
  // Reference sign composition: without it, an inhibition EPR of 0.000x cannot
  // be told apart from "the reference barely contains inhibitory edges".
  const activationReferenceCount =
    rows.find((row) => row.activationReferenceCount !== null)
      ?.activationReferenceCount ?? null;
  const inhibitionReferenceCount =
    rows.find((row) => row.inhibitionReferenceCount !== null)
      ?.inhibitionReferenceCount ?? null;
  const methodRows = rows;
  const consensusRow = benchmark.consensus;
  const stabilityOf = (id: string) => stability.find((item) => item.algorithmId === id)?.medianRho ?? null;
  const toFigureRow = (row: BenchmarkRow, isConsensus = false): FigureRow => ({
    id: row.algorithmId,
    consensus: isConsensus,
    auprcRatio: row.auprcRatio,
    eprRatio: row.earlyPrecisionRatio,
    auroc: row.auroc,
    activation: row.activationEpr,
    inhibition: row.inhibitionEpr,
    stability: isConsensus ? null : stabilityOf(row.algorithmId),
    runtime: isConsensus ? null : row.runtimeSeconds,
    pr: row.pr,
    roc: row.roc,
  });
  const figureRows: FigureRow[] = [
    ...methodRows.map((row) => toFigureRow(row)),
    ...(consensusRow ? [toFigureRow(consensusRow, true)] : []),
  ];
  const ranks = overallRanks(figureRows);
  const topRow =
    [...methodRows].sort((a, b) => (ranks.get(a.algorithmId) ?? 0) - (ranks.get(b.algorithmId) ?? 0))[0] ?? methodRows[0];
  const showStability = figureRows.some((row) => row.stability !== null);
  const byAuprc = [...methodRows].sort((a, b) => b.auprcRatio - a.auprcRatio);
  type FigureKey = "summary" | "curve" | "motif" | "path" | "direction";
  const downloadFigure = async (key: FigureKey, filename: string, format: "svg" | "png") => {
    const refs = {
      summary: summarySvgRef,
      curve: curveSvgRef,
      motif: motifSvgRef,
      path: pathSvgRef,
      direction: directionSvgRef,
    };
    const svg = refs[key].current;
    if (!svg) throw new Error("The figure is not available to download.");
    if (format === "svg") downloadSvg(svg, `${filename}.svg`);
    else await downloadSvgPng(svg, `${filename}.png`, 3);
  };
  const figureItems = (key: FigureKey, filename: string) => [
    { label: "Figure", format: "PNG", description: "At print resolution.", onSelect: () => downloadFigure(key, filename, "png") },
    { label: "Figure", format: "SVG", description: "Editable vector version.", onSelect: () => downloadFigure(key, filename, "svg") },
  ];
  const helpButton = (onClick: () => void, labelText: string, controls: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={labelText}
      aria-haspopup="dialog"
      aria-controls={controls}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-extrabold leading-none text-slate-500 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
    >
      ?
    </button>
  );
  const allRows = consensusRow ? [...methodRows, consensusRow] : methodRows;

  return (
    <div className="space-y-5">
      <Panel
        title="Benchmark summary"
        titleAction={helpButton(() => setIsBenchmarkHelpOpen(true), "How to read the benchmark summary", "benchmark-summary-help-title")}
        description="How well each method recovers the uploaded reference network, ranked; values no better than random are grey."
        aside={
          <DownloadMenu
            ariaLabel="Download benchmark summary"
            items={[
              ...figureItems("summary", "benchmark-summary"),
              {
                label: "Complete benchmark table",
                format: "CSV",
                description: "All displayed and supporting BEELINE metrics.",
                onSelect: () =>
                  downloadCsv("benchmark-summary.csv", [
                    [
                      "algorithm",
                      "directionality",
                      "nonzero_predictions",
                      "evaluated_genes",
                      "possible_directed_interactions",
                      "reference_interactions",
                      "random_precision",
                      "overall_rank",
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
                      "median_stability_rho",
                      "runtime_seconds",
                    ],
                    ...allRows.map((row) => {
                      const isConsensus = row.algorithmId === CONSENSUS_ID;
                      return [
                        row.algorithmId,
                        isConsensus ? "consensus" : algorithmMetaMap.get(row.algorithmId)?.directed === false ? "undirected" : "directed",
                        row.evaluatedEdges,
                        benchmark.candidateGeneCount,
                        benchmark.possibleEdges,
                        benchmark.eligibleReferenceEdges,
                        benchmark.randomBaseline.toFixed(6),
                        (ranks.get(row.algorithmId) ?? 0).toFixed(2),
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
                        isConsensus ? "" : (stabilityOf(row.algorithmId)?.toFixed(3) ?? ""),
                        isConsensus ? "" : row.runtimeSeconds.toFixed(3),
                      ];
                    }),
                  ]),
              },
            ]}
          />
        }
      >
        <p className="flex flex-wrap gap-x-2 gap-y-1 border-y border-slate-100 py-3 text-xs leading-5 text-slate-500">
          <span>
            <strong className="font-bold text-slate-700">{benchmark.candidateGeneCount.toLocaleString()}</strong> genes
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="font-bold text-slate-700">{benchmark.possibleEdges.toLocaleString()}</strong> possible directed interactions
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="font-bold text-slate-700">{benchmark.eligibleReferenceEdges.toLocaleString()}</strong> reference interactions
            {activationReferenceCount !== null || inhibitionReferenceCount !== null
              ? ` (${[
                  activationReferenceCount !== null ? `${activationReferenceCount.toLocaleString()} activating` : null,
                  inhibitionReferenceCount !== null ? `${inhibitionReferenceCount.toLocaleString()} inhibitory` : null,
                ]
                  .filter(Boolean)
                  .join(", ")})`
              : ""}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            random precision <strong className="font-bold text-slate-700">{benchmark.randomBaseline.toFixed(3)}</strong>
          </span>
        </p>
        <div className="mt-4">
          <SummaryHeatmap rows={figureRows} showSigned={signedMetricsAvailable} showStability={showStability} svgRef={summarySvgRef} />
        </div>
      </Panel>
      {isBenchmarkHelpOpen && typeof document !== "undefined" ? (
        <BenchmarkSummaryHelpModal
          candidateGeneCount={benchmark.candidateGeneCount}
          possibleEdges={benchmark.possibleEdges}
          referenceEdgeCount={benchmark.eligibleReferenceEdges}
          excludedReferenceEdges={benchmark.excludedReferenceEdges}
          randomBaseline={benchmark.randomBaseline}
          activationReferenceCount={activationReferenceCount}
          inhibitionReferenceCount={inhibitionReferenceCount}
          signedMetricsAvailable={signedMetricsAvailable}
          exampleRow={topRow}
          onClose={() => setIsBenchmarkHelpOpen(false)}
        />
      ) : null}


      <Panel
        title="Precision-recall and ROC curves"
        titleAction={helpButton(() => setIsCurveHelpOpen(true), "How to read the precision-recall and ROC curves", "curve-performance-help-title")}
        description="One panel per method, in black; the other methods in grey for context; dashed = random."
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold" role="group" aria-label="Curve type">
              {(["pr", "roc"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={curveKind === kind}
                  onClick={() => setCurveKind(kind)}
                  className={`rounded-md px-3 py-1.5 transition ${curveKind === kind ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                >
                  {kind === "pr" ? "Precision–recall" : "ROC"}
                </button>
              ))}
            </div>
            <DownloadMenu
              ariaLabel="Download precision-recall and ROC curves"
              items={[
                ...figureItems("curve", curveKind === "pr" ? "precision-recall-curves" : "roc-curves"),
                {
                  label: "Curve values",
                  format: "CSV",
                  description: "Both curves for every method.",
                  onSelect: () =>
                    downloadCsv("precision-recall-roc-curves.csv", [
                      ["curve", "algorithm", "x", "y"],
                      ...allRows.flatMap((row) => [
                        ...row.pr.map((point) => ["precision-recall", row.algorithmId, point.x, point.y]),
                        ...row.roc.map((point) => ["roc", row.algorithmId, point.x, point.y]),
                      ]),
                    ]),
                },
              ]}
            />
          </div>
        }
      >
        <CurveSmallMultiples rows={figureRows} kind={curveKind} randomBaseline={benchmark.randomBaseline} svgRef={curveSvgRef} />
      </Panel>
      {isCurveHelpOpen && typeof document !== "undefined" ? (
        <CurvePerformanceHelpModal randomBaseline={benchmark.randomBaseline} onClose={() => setIsCurveHelpOpen(false)} />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2 xl:items-stretch">
          <section className="min-w-0 rounded-[1.25rem] border border-slate-200 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-extrabold text-slate-950">Motif counts relative to the reference</h3>
                {helpButton(() => setAdditionalBenchmarkHelp("motif"), "How to read motif counts", "additional-benchmark-help-title")}
              </div>
              <DownloadMenu
                ariaLabel="Download motif counts"
                items={[
                  ...figureItems("motif", "motif-counts"),
                  {
                    label: "Motif count table",
                    format: "CSV",
                    onSelect: () =>
                      downloadCsv("motif-count-ratios.csv", [
                        ["algorithm", "feedback_loops", "feed_forward_loops", "mutual_interactions"],
                        ...allRows.map((row) => [
                          row.algorithmId,
                          row.motifs?.feedbackLoops ?? "",
                          row.motifs?.feedForwardLoops ?? "",
                          row.motifs?.mutualInteractions ?? "",
                        ]),
                      ]),
                  },
                ]}
              />
            </div>
            <div className="mt-3 overflow-x-auto">
              <MotifHeatmap
                svgRef={motifSvgRef}
                rows={byAuprc.map((row) => ({
                  id: row.algorithmId,
                  ratios: (["feedbackLoops", "feedForwardLoops", "mutualInteractions"] as const).map((key) => {
                    const reference = benchmark.referenceMotifs[key];
                    return row.motifs && reference > 0 ? row.motifs[key] / reference : null;
                  }) as [number | null, number | null, number | null],
                }))}
              />
            </div>
          </section>
          <section className="min-w-0 rounded-[1.25rem] border border-slate-200 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="text-lg font-extrabold text-slate-950">Direction and sign of recovered edges</h3>
              <DownloadMenu
                ariaLabel="Download direction and sign"
                items={[
                  ...figureItems("direction", "direction-and-sign"),
                  {
                    label: "Direction and sign table",
                    format: "CSV",
                    onSelect: () =>
                      downloadCsv("direction-and-sign.csv", [
                        ["algorithm", "top_predictions_examined", "predictions_on_reference_pairs", "right_direction", "sign_compared", "right_sign"],
                        ...allRows.map((row) => [
                          row.algorithmId,
                          row.directionSign.examined,
                          row.directionSign.pairs,
                          row.directionSign.rightDirection,
                          row.directionSign.signCompared,
                          row.directionSign.rightSign,
                        ]),
                      ]),
                  },
                ]}
              />
            </div>
            <div className="mt-3 overflow-x-auto">
              <StackedBars
                svgRef={directionSvgRef}
                ariaLabel="Direction and sign of predicted edges on reference gene pairs"
                categories={["Direction ✓ · Sign ✓", "Direction ✓ · Sign ✗", "Direction ✓ · No sign", "Direction ✗", "Not a reference pair"]}
                minTop={68}
                axis={{ max: benchmark.eligibleReferenceEdges, label: `Number of top-ranked predictions (${benchmark.eligibleReferenceEdges} = edges in the reference)` }}
                colors={DIRECTION_COLORS}
                rows={byAuprc.map((row) => {
                  const d = row.directionSign;
                  return {
                    id: row.algorithmId,
                    parts: [d.rightSign, d.signCompared - d.rightSign, d.rightDirection - d.signCompared, d.pairs - d.rightDirection, d.examined - d.pairs],
                    note: `${d.pairs}`,
                  };
                })}
              />
            </div>
          </section>
          </div>
          <section className="rounded-[1.25rem] border border-slate-200 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-extrabold text-slate-950">How the top predictions compare with the reference</h3>
                {helpButton(() => setAdditionalBenchmarkHelp("path"), "How to read top-prediction paths", "additional-benchmark-help-title")}
              </div>
              <DownloadMenu
                ariaLabel="Download top-prediction path context"
                items={[
                  ...figureItems("path", "top-prediction-path-context"),
                  {
                    label: "Path context table",
                    format: "CSV",
                    onSelect: () =>
                      downloadCsv("top-prediction-path-context.csv", [
                        ["algorithm", "exact_reference_edge", "incorrect_2_steps", "incorrect_3_steps", "incorrect_4_steps", "incorrect_5_steps", "incorrect_more_than_5_steps", "incorrect_no_path"],
                        ...rows.map((row) => [
                          row.algorithmId,
                          row.pathCounts?.truePositive ?? "",
                          row.pathCounts?.path2 ?? "",
                          row.pathCounts?.path3 ?? "",
                          row.pathCounts?.path4 ?? "",
                          row.pathCounts?.path5 ?? "",
                          row.pathCounts?.pathMoreThan5 ?? "",
                          row.pathCounts?.noPath ?? "",
                        ]),
                      ]),
                  },
                ]}
              />
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Each method&apos;s {`top ${benchmark.eligibleReferenceEdges} predictions`}: exact reference edges, and for wrong ones the length of the
              shortest reference path between the two genes (short paths are near misses).
            </p>
            <div className="mt-3 overflow-x-auto">
              <StackedBars
                svgRef={pathSvgRef}
                ariaLabel="Top predictions by distance in the reference network"
                categories={["Reference edge", "2 steps apart", "3 steps apart", "4+ steps apart", "No path"]}
                colors={PATH_COLORS}
                rows={byAuprc.map((row) => {
                  const c = row.pathCounts;
                  return {
                    id: row.algorithmId,
                    parts: c ? [c.truePositive, c.path2, c.path3, c.path4 + c.path5 + c.pathMoreThan5, c.noPath] : [],
                    note: c ? `${c.truePositive} exact` : "not available",
                  };
                })}
              />
            </div>
          </section>
      {additionalBenchmarkHelp && typeof document !== "undefined" ? (
        <AdditionalBenchmarkHelpModal
          kind={additionalBenchmarkHelp}
          referenceEdgeCount={additionalBenchmarkHelp === "motif" ? benchmark.motifReferenceEdgeCount : benchmark.eligibleReferenceEdges}
          referenceMotifs={benchmark.referenceMotifs}
          onClose={() => setAdditionalBenchmarkHelp(null)}
        />
      ) : null}
    </div>
  );
}
