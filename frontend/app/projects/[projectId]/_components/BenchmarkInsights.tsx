"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
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
  normalizeReferenceSign,
  type BenchmarkCurvePoint,
  type ReferenceSign,
} from "../_lib/benchmark";
import { downloadSvg, downloadSvgPng } from "../_lib/downloads";
import DownloadMenu from "./DownloadMenu";

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
};
// Okabe-Ito, extended to eight — the same set the trajectory charts use. The
// previous palette paired #087ead with #0891b2 and pink/orange/green, which are
// hard to separate under the common colour-vision deficiencies. That matters
// here because overlapping PR curves are told apart by hue alone.
const PALETTE = [
  "#0072b2",
  "#d55e00",
  "#009e73",
  "#cc79a7",
  "#e69f00",
  "#56b4e9",
  "#5d3a9b",
  "#7a4900",
];

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
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
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
            <h4 className="font-extrabold text-slate-900">Reading and downloading the table</h4>
            <p className="mt-2">
              Click a metric header to sort descending. Ratio columns show the multiple of
              their baseline in large type and the raw metric underneath; AUROC shows its
              distance from 0.500. The CSV download preserves the raw metrics, ratios,
              selected-edge counts, directionality, runtime, and evaluation-universe counts
              for every displayed method in the current result scope.
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
              Understanding curve performance
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
            aria-label="Close curve performance help"
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
              Hover a curve or select a method in the shared legend to highlight it in
              both plots. PNG and SVG downloads restore every method to full visibility
              and include a color-keyed metric legend. The PR export preserves the chosen
              recall range; the CSV contains every plotted point for both curve types.
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
                  predictions by descending absolute full-data weight, and keeps exactly
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
                  segment width is its share of the bar. Hover a segment for the exact
                  count and percentage. The PNG includes category definitions, the
                  top-K/tie rule, and counts inside segments that are wide enough. The CSV
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

type BenchmarkSortKey =
  | "auprcRatio"
  | "earlyPrecisionRatio"
  | "auroc"
  | "activationEpr"
  | "inhibitionEpr";

/** Header that explains its metric and both shows and controls the table sort. */
function SortableMetricHeader({
  children,
  sortKey,
  activeSort,
  onSort,
}: {
  children: ReactNode;
  sortKey: BenchmarkSortKey;
  activeSort: BenchmarkSortKey;
  onSort: (key: BenchmarkSortKey) => void;
}) {
  const isActive = activeSort === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`group/sort inline-flex items-center gap-1.5 whitespace-nowrap text-left uppercase transition ${
        isActive ? "text-slate-900" : "hover:text-slate-700"
      }`}
      title={`Sort by ${typeof children === "string" ? children : "this metric"}`}
    >
      <span>{children}</span>
      <svg
        viewBox="0 0 16 16"
        className={`h-3 w-3 shrink-0 transition ${
          isActive
            ? "text-[#087ead]"
            : "text-slate-300 group-hover/sort:text-slate-400"
        }`}
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M8 3.5v9M4.5 9l3.5 3.5L11.5 9"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
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
  // Confidence-enabled results combine bootstrap evidence with the unmodified
  // full-data run. BEELINE's motif evaluator receives that full-data ranked
  // network, so reconstruct it before applying BEELINE's absolute-score top-k.
  const hasFullDataMarkers = edges.some(
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
          edge.full_data_raw_score ??
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
  };
}

function LineChart({
  series,
  xLabel,
  yLabel,
  randomBaseline,
  diagonalBaseline = false,
  earlyRegionMax,
  caption,
  showLegend = true,
  focusedSeries: controlledFocus,
  onFocusedSeriesChange,
}: {
  series: Array<{
    name: string;
    points: CurvePoint[];
    summary?: string;
  }>;
  xLabel: string;
  yLabel: string;
  randomBaseline?: number;
  diagonalBaseline?: boolean;
  /** When set, offers a toggle that zooms the x axis to [0, earlyRegionMax]. */
  earlyRegionMax?: number;
  caption?: string;
  /** Off when a shared legend sits outside the chart. */
  showLegend?: boolean;
  /** Controlled so sibling charts can highlight the same method together. */
  focusedSeries?: string | null;
  onFocusedSeriesChange?: (name: string | null) => void;
}) {
  const [uncontrolledFocus, setUncontrolledFocus] = useState<string | null>(null);
  const focusedSeries =
    controlledFocus !== undefined ? controlledFocus : uncontrolledFocus;
  const setFocusedSeries = (name: string | null) => {
    if (onFocusedSeriesChange) onFocusedSeriesChange(name);
    else setUncontrolledFocus(name);
  };
  const [zoomEarly, setZoomEarly] = useState(false);
  const plotClipId = useId().replace(/:/g, "");
  const [hoveredPoint, setHoveredPoint] = useState<{
    series: string;
    point: CurvePoint;
    color: string;
  } | null>(null);
  // Precision and recall are the same kind of quantity on the same range, so
  // the plot area is square: a unit on x covers the same distance as on y.
  // This also puts the ROC "random classifier" diagonal back at a true 45deg.
  const plotSize = 340;
  const left = 56;
  const right = 20;
  const top = 18;
  const bottom = 44;
  const width = plotSize + left + right;
  const height = plotSize + top + bottom;
  const points = series.flatMap((item) => item.points);
  if (!points.length) {
    return (
      <EmptyState
        title="No curve data"
        detail="The selected methods do not contain ranked edges for this scope."
      />
    );
  }
  const xMax =
    zoomEarly && earlyRegionMax !== undefined ? earlyRegionMax : 1;
  const xPosition = (value: number) => left + (value / xMax) * plotSize;
  const yPosition = (value: number) => top + (1 - value) * plotSize;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  // Nice round ticks for whatever x range is showing.
  const xTicks = (() => {
    if (xMax >= 1) return ticks;
    const target = xMax / 5;
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const step =
      [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= target) ??
      target;
    const out: number[] = [];
    for (let value = 0; value <= xMax + 1e-9; value += step) {
      out.push(Number(value.toFixed(4)));
    }
    return out;
  })();
  const xTickDecimals = xMax >= 1 ? 2 : 3;
  const hoveredX = hoveredPoint ? xPosition(hoveredPoint.point.x) : 0;
  const hoveredY = hoveredPoint ? yPosition(hoveredPoint.point.y) : 0;
  const tooltipWidth = 206;
  const tooltipHeight = 52;
  const tooltipX = hoveredPoint
    ? hoveredX + tooltipWidth + 16 > width - right
      ? Math.max(left, hoveredX - tooltipWidth - 12)
      : hoveredX + 12
    : 0;
  const tooltipY = hoveredPoint
    ? hoveredY - tooltipHeight - 12 < top
      ? hoveredY + 12
      : hoveredY - tooltipHeight - 12
    : 0;
  const exportLegendItems = [
    ...series.map((item, index) => ({
      name: item.name,
      summary: item.summary,
      color: PALETTE[index % PALETTE.length],
      dashed: false,
    })),
    ...(randomBaseline !== undefined
      ? [{
          name: "Random precision",
          summary: "Baseline " + randomBaseline.toFixed(3),
          color: "#5fc8bd",
          dashed: true,
        }]
      : []),
    ...(diagonalBaseline
      ? [{
          name: "Random classifier",
          summary: "Chance diagonal",
          color: "#94a3b8",
          dashed: true,
        }]
      : []),
  ];
  const exportLegendColumns = Math.min(2, exportLegendItems.length);
  const exportLegendRows = Math.ceil(
    exportLegendItems.length / Math.max(1, exportLegendColumns),
  );
  const exportLegendExtraHeight = 34 + exportLegendRows * 34;
  const exportLegendColumnWidth =
    (width - left - right) / Math.max(1, exportLegendColumns);

  return (
    <div className="relative">
      {/* Fixed height so a chart with a zoom toggle still aligns with one without. */}
      <div className="mb-2 flex min-h-9 flex-wrap items-center justify-between gap-2">
        {caption ? (
          <p className="text-xs font-bold text-slate-700">{caption}</p>
        ) : (
          <span />
        )}
        {earlyRegionMax !== undefined ? (
          <div
            className="inline-flex overflow-hidden rounded-full border border-slate-200 text-[11px] font-semibold"
            role="group"
            aria-label={`${xLabel} range`}
          >
            {[
              { label: "Full range", value: false },
              {
                label: `Early ${xLabel.toLowerCase()} (0–${earlyRegionMax})`,
                value: true,
              },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={zoomEarly === option.value}
                onClick={() => setZoomEarly(option.value)}
                className={`px-3 py-1.5 transition ${
                  zoomEarly === option.value
                    ? "bg-[#f2f9fc] text-[#087ead]"
                    : "bg-white text-slate-500 hover:text-slate-800"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`${yLabel} by ${xLabel}`}
      >
        {ticks.map((tick) => (
          <g key={`y-${tick}`}>
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
        {xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            <line
              x1={xPosition(tick)}
              x2={xPosition(tick)}
              y1={height - bottom}
              y2={height - bottom + 5}
              stroke="#94a3b8"
            />
            <text
              x={xPosition(tick)}
              y={height - bottom + 19}
              textAnchor="middle"
              fill="#64748b"
              fontSize="11"
              fontWeight="600"
            >
              {Number(tick.toFixed(xTickDecimals))}
            </text>
          </g>
        ))}
        <line x1={left} x2={left} y1={top} y2={height - bottom} stroke="#94a3b8" />
        <line
          x1={left}
          x2={width - right}
          y1={height - bottom}
          y2={height - bottom}
          stroke="#94a3b8"
        />
        {/* Value is shown as a chip above the chart, so the line needs no label. */}
        {randomBaseline !== undefined ? (
          <line
            x1={left}
            x2={width - right}
            y1={yPosition(randomBaseline)}
            y2={yPosition(randomBaseline)}
            stroke="#5fc8bd"
            strokeDasharray="5 5"
          />
        ) : null}
        {diagonalBaseline ? (
          <line
            x1={xPosition(0)}
            x2={xPosition(1)}
            y1={yPosition(0)}
            y2={yPosition(1)}
            stroke="#94a3b8"
            strokeDasharray="5 5"
          />
        ) : null}
        <defs>
          <clipPath id={plotClipId}>
            <rect
              x={left}
              y={top}
              width={width - left - right}
              height={height - top - bottom}
            />
          </clipPath>
        </defs>
        <g clipPath={`url(#${plotClipId})`}>
        {series.map((item, index) => {
          const isDimmed =
            focusedSeries !== null && focusedSeries !== item.name;
          const color = PALETTE[index % PALETTE.length];
          const path = item.points
            .map(
              (point, pointIndex) =>
                `${pointIndex ? "L" : "M"} ${xPosition(point.x)} ${yPosition(point.y)}`,
            )
            .join(" ");
          return (
            <path
              key={item.name}
              data-export-curve
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={focusedSeries === item.name ? "4" : "2.75"}
              opacity={isDimmed ? 0.16 : 1}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="cursor-pointer transition-opacity"
              onPointerEnter={() => setFocusedSeries(item.name)}
              onPointerLeave={() => {
                setFocusedSeries(null);
                setHoveredPoint(null);
              }}
            />
          );
        })}
        {series.flatMap((item, index) => {
          const color = PALETTE[index % PALETTE.length];
          const step = Math.max(1, Math.ceil(item.points.length / 45));
          return item.points
            .filter((_, pointIndex) => pointIndex % step === 0)
            .map((point, pointIndex) => (
              <circle
                key={`${item.name}-${pointIndex}`}
                cx={xPosition(point.x)}
                cy={yPosition(point.y)}
                r="6"
                fill="transparent"
                className="cursor-crosshair"
                onPointerEnter={() => {
                  setFocusedSeries(item.name);
                  setHoveredPoint({ series: item.name, point, color });
                }}
                onPointerLeave={() => setHoveredPoint(null)}
              />
            ));
        })}
        </g>
        {hoveredPoint ? (
          <g data-export-exclude pointerEvents="none">
            <circle
              cx={hoveredX}
              cy={hoveredY}
              r="4"
              fill="white"
              stroke={hoveredPoint.color}
              strokeWidth="2"
            />
            {/* Light card, matching the tooltips on the trajectory charts. */}
            <rect
              x={tooltipX}
              y={tooltipY}
              width={tooltipWidth}
              height={tooltipHeight}
              rx="10"
              fill="white"
              stroke="#e2e8f0"
            />
            <circle
              cx={tooltipX + 16}
              cy={tooltipY + 17}
              r="4"
              fill={hoveredPoint.color}
            />
            <text
              x={tooltipX + 26}
              y={tooltipY + 21}
              fill="#0f172a"
              fontSize="11"
              fontWeight="800"
            >
              {hoveredPoint.series}
            </text>
            <text
              x={tooltipX + 12}
              y={tooltipY + 40}
              fill="#475569"
              fontSize="10.5"
              fontWeight="700"
            >
              {xLabel} {hoveredPoint.point.x.toFixed(3)}
              <tspan fill="#cbd5e1"> · </tspan>
              {yLabel} {hoveredPoint.point.y.toFixed(3)}
            </text>
          </g>
        ) : null}
        <text
          x={(left + width - right) / 2}
          y={height - 8}
          textAnchor="middle"
          fill="#64748b"
          fontSize="12"
          fontWeight="600"
        >
          {xLabel}
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
          {yLabel}
        </text>
        <g
          data-export-only
          data-export-extra-height={exportLegendExtraHeight}
          style={{ display: "none" }}
          aria-label="Chart legend"
        >
          <line
            x1={left}
            x2={width - right}
            y1={height + 8}
            y2={height + 8}
            stroke="#e2e8f0"
          />
          {exportLegendItems.map((item, index) => {
            const column = index % exportLegendColumns;
            const row = Math.floor(index / exportLegendColumns);
            const x = left + column * exportLegendColumnWidth;
            const y = height + 34 + row * 34;
            return (
              <g key={`export-legend-${item.name}`} transform={`translate(${x} ${y})`}>
                <line
                  x1="0"
                  x2="22"
                  y1="-4"
                  y2="-4"
                  stroke={item.color}
                  strokeWidth="3"
                  strokeDasharray={item.dashed ? "5 4" : undefined}
                  strokeLinecap="round"
                />
                <text x="30" y="0" fill="#334155" fontSize="10.5" fontWeight="700">
                  {item.name}
                </text>
                {item.summary ? (
                  <text x="30" y="14" fill="#64748b" fontSize="9.5" fontWeight="600">
                    {item.summary}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      {showLegend ? (
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {series.map((item, index) => (
          <button
            type="button"
            key={item.name}
            onClick={() =>
              setFocusedSeries(focusedSeries === item.name ? null : item.name)
            }
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              focusedSeries === item.name
                ? "border-[#087ead]/30 bg-[#f2f9fc] text-[#087ead]"
                : focusedSeries
                  ? "border-slate-200 text-slate-400"
                  : "border-slate-200 text-slate-600 hover:border-[#087ead]/25"
            }`}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: PALETTE[index % PALETTE.length] }}
            />
            {item.name}
            {item.summary ? (
              <span className="tabular-nums text-slate-400">{item.summary}</span>
            ) : null}
          </button>
        ))}
      </div>
      ) : null}
    </div>
  );
}

function RatioMetric({
  ratio,
  metric,
  rawValue,
}: {
  ratio: number | null;
  metric: string;
  rawValue: number | null;
}) {
  if (ratio === null || !Number.isFinite(ratio)) {
    return (
      <div className="py-1 text-sm font-semibold text-slate-300">
        —
      </div>
    );
  }

  return (
    <div
      title={`${metric} ratio: ${ratio.toFixed(3)}×; ${metric}: ${
        rawValue === null ? "not available" : rawValue.toFixed(3)
      }`}
      className="py-1 tabular-nums"
    >
      <p className="text-base font-extrabold text-slate-800">
        {ratio.toFixed(3)}×
      </p>
      <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
        {metric} {rawValue === null ? "—" : rawValue.toFixed(3)}
      </p>
    </div>
  );
}

function MotifRecovery({
  rows,
  reference,
}: {
  rows: BenchmarkRow[];
  reference: MotifCounts;
}) {
  const motifs = [
    {
      key: "feedbackLoops" as const,
      label: "Feedback loops",
      note: "A→B→C→A",
    },
    {
      key: "feedForwardLoops" as const,
      label: "Feed-forward loops",
      note: "A→B, A→C, B→C",
    },
    {
      key: "mutualInteractions" as const,
      label: "Mutual interactions",
      note: "A↔B",
    },
  ];
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[46rem] table-fixed border-collapse">
          <thead className="grn-table-header">
            <tr className="text-left">
              <th className="w-[22%] border-b border-slate-200 px-4 py-3">
                Algorithm
              </th>
            {motifs.map((motif) => (
                <th
                  key={motif.key}
                  className="border-b border-l border-slate-200 px-4 py-3"
                >
                  <span className="block">
                    {motif.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-slate-400">
                    {motif.note}
                  </span>
                </th>
            ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.algorithmId} className="last:[&>*]:border-b-0">
                <th className="border-b border-slate-100 px-4 py-4 text-left text-sm font-extrabold text-slate-800">
                  {row.algorithmId}
                </th>
                {motifs.map((motif) => {
                  const predicted = row.motifs?.[motif.key] ?? null;
                  const referenceCount = reference[motif.key];
                  const ratio =
                    predicted !== null && referenceCount > 0
                      ? predicted / referenceCount
                      : null;
                  return (
                    <td
                      key={motif.key}
                      className="border-b border-l border-slate-100 px-4 py-4"
                    >
                      <p className="text-base font-extrabold tabular-nums text-slate-800">
                        {ratio === null ? "—" : `${ratio.toFixed(3)}×`}
                      </p>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
    </div>
  );
}

function PathBreakdown({
  rows,
  referenceEdgeCount,
  exportSvgRef,
}: {
  rows: BenchmarkRow[];
  referenceEdgeCount: number;
  exportSvgRef: RefObject<SVGSVGElement | null>;
}) {
  const colors = {
    truePositive: "#087ead",
    path2: "#72c9be",
    path3: "#eab35e",
    path4Plus: "#dc6b5d",
    noPath: "#cbd5e1",
  };
  const [hoveredSegment, setHoveredSegment] = useState<{
    algorithmId: string;
    key: keyof typeof colors;
    label: string;
    value: number;
    percentage: number;
    start: number;
    position: number;
  } | null>(null);
  const labels: Array<{
    key: "path2" | "path3" | "path4Plus" | "noPath";
    label: string;
    value: (counts: PathCounts) => number;
  }> = [
    {
      key: "path2",
      label: "Incorrect · 2 steps",
      value: (counts) => counts.path2,
    },
    {
      key: "path3",
      label: "Incorrect · 3 steps",
      value: (counts) => counts.path3,
    },
    {
      key: "path4Plus",
      label: "Incorrect · 4+ steps",
      value: (counts) =>
        counts.path4 + counts.path5 + counts.pathMoreThan5,
    },
    {
      key: "noPath",
      label: "Incorrect · no path",
      value: (counts) => counts.noPath,
    },
  ];
  const exportWidth = 1100;
  const exportHeaderHeight = 50;
  const exportRowHeight = 42;
  const exportBarX = 210;
  const exportBarWidth = 850;
  const exportBarHeight = 16;
  const exportLegendY = exportHeaderHeight + rows.length * exportRowHeight + 28;
  const exportHeight = exportLegendY + 148;
  const exportClipPrefix = useId().replace(/:/g, "");
  const exportLegendItems = [
    {
      key: "truePositive" as const,
      label: "Exact reference edge",
      detail: "Predicted source→target is present in the reference",
    },
    {
      key: "path2" as const,
      label: "Incorrect · 2 steps",
      detail: "Shortest directed reference path has 2 edges",
    },
    {
      key: "path3" as const,
      label: "Incorrect · 3 steps",
      detail: "Shortest directed reference path has 3 edges",
    },
    {
      key: "path4Plus" as const,
      label: "Incorrect · 4+ steps",
      detail: "Shortest directed reference path has at least 4 edges",
    },
    {
      key: "noPath" as const,
      label: "Incorrect · no path",
      detail: "No directed reference path connects source to target",
    },
  ];
  return (
    <div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <div className="min-w-[40rem]">
          <div className="grn-table-header-grid grid grid-cols-[10rem_1fr] items-center gap-4 border-b border-slate-200 px-4 py-2.5 text-center">
            <span>Algorithm</span>
            <span>Top predictions</span>
          </div>
          {rows.map((row, rowIndex) => {
            const pathCounts = row.pathCounts;
            if (!pathCounts) {
              return (
                <div
                  key={row.algorithmId}
                  className="grid grid-cols-[10rem_1fr] items-center gap-4 border-b border-slate-100 px-4 py-3 text-center last:border-b-0"
                >
                  <span className="truncate text-sm font-extrabold text-slate-800">
                    {row.algorithmId}
                  </span>
                  <span className="text-xs font-semibold text-slate-400">
                    Path statistics unavailable
                  </span>
                </div>
              );
            }
            const falsePositiveTotal = labels.reduce(
              (sum, item) => sum + item.value(pathCounts),
              0,
            );
            const selectedTotal =
              pathCounts.truePositive + falsePositiveTotal;
            const segments: Array<{
              key: keyof typeof colors;
              label: string;
              value: number;
            }> = [
              {
                key: "truePositive",
                label: "Correct reference edge",
                value: pathCounts.truePositive,
              },
              ...labels.map((item) => ({
                key: item.key,
                label: item.label,
                value: item.value(pathCounts),
              })),
            ];
            let accumulatedPercentage = 0;
            const positionedSegments = segments.map((item) => {
              const percentage =
                selectedTotal > 0
                  ? (item.value / selectedTotal) * 100
                  : 0;
              const start = accumulatedPercentage;
              const position =
                accumulatedPercentage + percentage / 2;
              accumulatedPercentage += percentage;
              return {
                ...item,
                percentage,
                start,
                position: Math.max(7, Math.min(93, position)),
              };
            });
            const activeSegment =
              hoveredSegment?.algorithmId === row.algorithmId
                ? hoveredSegment
                : null;
            return (
              <div
                key={row.algorithmId}
                className={`relative grid grid-cols-[10rem_1fr] items-center gap-4 border-b border-slate-100 px-4 py-3 text-center last:border-b-0 ${
                  activeSegment ? "z-20" : "z-0"
                }`}
              >
                <span className="truncate text-sm font-extrabold text-slate-800">
                  {row.algorithmId}
                </span>
                <div className="relative mx-auto h-4 w-full max-w-[64rem]">
                  <div
                    className="flex h-4 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70"
                    aria-label={`${row.algorithmId}: ${pathCounts.truePositive} of ${selectedTotal} predictions exactly match the reference; ${falsePositiveTotal} are incorrect`}
                  >
                    {positionedSegments.map((item) =>
                      item.value > 0 ? (
                        <button
                          type="button"
                          key={item.key}
                          style={{
                            width: `${item.percentage}%`,
                            backgroundColor: colors[item.key],
                          }}
                          aria-label={`${item.label}: ${item.value} predicted edges, ${item.percentage.toFixed(1)}% of selected predictions`}
                          className={`h-full cursor-help transition-opacity duration-75 focus-visible:z-10 focus-visible:outline-none ${
                            activeSegment ? "opacity-60" : ""
                          }`}
                          onPointerEnter={() =>
                            setHoveredSegment({
                              algorithmId: row.algorithmId,
                              key: item.key,
                              label: item.label,
                              value: item.value,
                              percentage: item.percentage,
                              start: item.start,
                              position: item.position,
                            })
                          }
                          onPointerLeave={() => setHoveredSegment(null)}
                          onFocus={() =>
                            setHoveredSegment({
                              algorithmId: row.algorithmId,
                              key: item.key,
                              label: item.label,
                              value: item.value,
                              percentage: item.percentage,
                              start: item.start,
                              position: item.position,
                            })
                          }
                          onBlur={() => setHoveredSegment(null)}
                        />
                      ) : null,
                    )}
                  </div>
                  {activeSegment ? (
                    <div
                      className="pointer-events-none absolute -top-0.5 z-10 h-5 rounded-[0.3rem] ring-2 ring-white shadow-[0_2px_8px_rgba(15,23,42,0.18)]"
                      style={{
                        left: `${activeSegment.start}%`,
                        width: `${activeSegment.percentage}%`,
                        backgroundColor: colors[activeSegment.key],
                      }}
                      aria-hidden="true"
                    />
                  ) : null}
                  {activeSegment ? (
                    <div
                      className={`pointer-events-none absolute z-20 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-left shadow-lg shadow-slate-900/10 ${
                        rowIndex === rows.length - 1
                          ? "bottom-6"
                          : "top-6"
                      }`}
                      style={{ left: `${activeSegment.position}%` }}
                      role="tooltip"
                    >
                      <p className="text-[11px] font-extrabold text-slate-800">
                        {activeSegment.label}
                      </p>
                      <p className="mt-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
                        {activeSegment.value} predicted edges ·{" "}
                        {activeSegment.percentage.toFixed(1)}%
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: colors.truePositive }}
          />
          Exact reference edge
        </span>
        {labels.map((item) => (
          <span
            key={item.key}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: colors[item.key] }}
            />
            {item.label}
          </span>
        ))}
      </div>
      <svg
        ref={exportSvgRef}
        viewBox={"0 0 " + exportWidth + " " + exportHeight}
        className="hidden"
        role="img"
        aria-label="Top predictions classified by exact reference match and shortest directed reference-path length"
      >
        <defs>
          {rows.map((row, index) => (
            <clipPath key={row.algorithmId} id={exportClipPrefix + "-" + index}>
              <rect
                x={exportBarX}
                y={exportHeaderHeight + index * exportRowHeight + 13}
                width={exportBarWidth}
                height={exportBarHeight}
                rx={exportBarHeight / 2}
              />
            </clipPath>
          ))}
        </defs>
        <rect x="0" y="0" width={exportWidth} height={exportHeaderHeight} fill="#f8fafc" />
        <text x="36" y="31" fill="#64748b" fontSize="12" fontWeight="700">
          ALGORITHM
        </text>
        <text
          x={exportBarX + exportBarWidth / 2}
          y="31"
          textAnchor="middle"
          fill="#64748b"
          fontSize="12"
          fontWeight="700"
        >
          TOP PREDICTIONS · SHARE OF SELECTED EDGES
        </text>
        {rows.map((row, index) => {
          const y = exportHeaderHeight + index * exportRowHeight;
          const counts = row.pathCounts;
          const exportSegments = counts
            ? [
                {
                  key: "truePositive" as const,
                  value: counts.truePositive,
                },
                { key: "path2" as const, value: counts.path2 },
                { key: "path3" as const, value: counts.path3 },
                {
                  key: "path4Plus" as const,
                  value:
                    counts.path4 + counts.path5 + counts.pathMoreThan5,
                },
                { key: "noPath" as const, value: counts.noPath },
              ]
            : [];
          const selectedTotal = exportSegments.reduce(
            (sum, segment) => sum + segment.value,
            0,
          );
          let accumulatedWidth = 0;
          const positionedSegments = exportSegments.map((segment) => {
            const width =
              selectedTotal > 0
                ? (segment.value / selectedTotal) * exportBarWidth
                : 0;
            const x = exportBarX + accumulatedWidth;
            accumulatedWidth += width;
            return { ...segment, x, width };
          });
          return (
            <g key={row.algorithmId}>
              <rect
                x="0"
                y={y}
                width={exportWidth}
                height={exportRowHeight}
                fill={index % 2 === 0 ? "#ffffff" : "#fbfdff"}
              />
              <line
                x1="0"
                x2={exportWidth}
                y1={y + exportRowHeight}
                y2={y + exportRowHeight}
                stroke="#e2e8f0"
              />
              <text x="36" y={y + 27} fill="#0f172a" fontSize="13" fontWeight="700">
                {row.algorithmId}
              </text>
              {counts ? (
                <>
                  <rect
                    x={exportBarX}
                    y={y + 13}
                    width={exportBarWidth}
                    height={exportBarHeight}
                    rx={exportBarHeight / 2}
                    fill="#f1f5f9"
                    stroke="#e2e8f0"
                  />
                  <g clipPath={"url(#" + exportClipPrefix + "-" + index + ")"}>
                    {positionedSegments.map((segment) => (
                      <rect
                        key={segment.key}
                        x={segment.x}
                        y={y + 13}
                        width={segment.width}
                        height={exportBarHeight}
                        fill={colors[segment.key]}
                      />
                    ))}
                  </g>
                  {positionedSegments.map((segment) =>
                    segment.value > 0 && segment.width >= 30 ? (
                      <text
                        key={"count-" + segment.key}
                        x={segment.x + segment.width / 2}
                        y={y + 25}
                        textAnchor="middle"
                        fill={
                          segment.key === "truePositive" ||
                          segment.key === "path4Plus"
                            ? "#ffffff"
                            : "#334155"
                        }
                        fontSize="9"
                        fontWeight="700"
                      >
                        {segment.value}
                      </text>
                    ) : null,
                  )}
              </>
              ) : (
                <text
                  x={exportBarX}
                  y={y + 27}
                  fill="#94a3b8"
                  fontSize="11"
                  fontWeight="600"
                >
                  Path statistics unavailable
                </text>
              )}
            </g>
          );
        })}
        <line
          x1="36"
          x2={exportWidth - 36}
          y1={exportLegendY - 14}
          y2={exportLegendY - 14}
          stroke="#e2e8f0"
        />
        {exportLegendItems.map((item, index) => {
          const x = 36 + (index % 3) * 348;
          const y = exportLegendY + Math.floor(index / 3) * 47;
          return (
            <g key={item.key}>
              <circle cx={x + 5} cy={y + 5} r="5" fill={colors[item.key]} />
              <text x={x + 18} y={y + 9} fill="#334155" fontSize="11" fontWeight="700">
                {item.label}
              </text>
              <text x={x + 18} y={y + 25} fill="#64748b" fontSize="9.5" fontWeight="600">
                {item.detail}
              </text>
            </g>
          );
        })}
        <text
          x="36"
          y={exportLegendY + 112}
          fill="#475569"
          fontSize="10"
          fontWeight="700"
        >
          Each bar starts from top K = {referenceEdgeCount} non-self predictions by |weight|;
          all ties at the K-th score are included.
        </text>
        <text
          x="36"
          y={exportLegendY + 130}
          fill="#64748b"
          fontSize="10"
          fontWeight="600"
        >
          Bars show within-method shares. Numbers inside sufficiently wide segments are edge counts.
        </text>
      </svg>
    </div>
  );
}

export default function BenchmarkInsights({
  groundTruth,
  loading,
  algorithmMetaMap,
  algorithmResults,
  activeAlgorithmIds,
  selectedResultScopeId,
  tasks,
}: {
  groundTruth: GroundTruthContext | undefined;
  loading: boolean;
  algorithmMetaMap: Map<string, AlgorithmCatalogItem>;
  algorithmResults: Record<string, AlgorithmStoredResult>;
  activeAlgorithmIds: string[];
  selectedResultScopeId: string;
  tasks: ProjectTask[];
}) {
  const prChartRef = useRef<HTMLDivElement | null>(null);
  const rocChartRef = useRef<HTMLDivElement | null>(null);
  const pathBreakdownExportRef = useRef<SVGSVGElement | null>(null);
  const [benchmarkSort, setBenchmarkSort] =
    useState<BenchmarkSortKey>("auprcRatio");
  const [isBenchmarkHelpOpen, setIsBenchmarkHelpOpen] = useState(false);
  const [isCurveHelpOpen, setIsCurveHelpOpen] = useState(false);
  const [additionalBenchmarkHelp, setAdditionalBenchmarkHelp] = useState<
    "motif" | "path" | null
  >(null);
  // Shared by both curve charts so highlighting a method dims it in each.
  const [curveFocus, setCurveFocus] = useState<string | null>(null);
  const [curveLegendSort, setCurveLegendSort] = useState<"auprc" | "auroc">(
    "auprc",
  );
  const benchmark = useMemo(() => {
    const truthEdges = groundTruth?.edges ?? [];
    if (!truthEdges.length) {
      return {
        rows: [] as BenchmarkRow[],
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
    return {
      rows,
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
  const sortedRows = [...rows].sort((first, second) => {
    const value = (row: BenchmarkRow) => row[benchmarkSort] ?? -Infinity;
    return value(second) - value(first) || second.auprcRatio - first.auprcRatio;
  });
  const signedMetricsAvailable = rows.some(
    (row) => row.activationEpr !== null || row.inhibitionEpr !== null,
  );
  // Colour is taken from each method's position in `rows`, which is what the
  // charts use, so re-sorting the legend can never desync swatch from curve.
  const curveLegendColumns = (() => {
    const entries = rows.map((row, index) => ({
      algorithmId: row.algorithmId,
      auprc: row.auprc,
      auroc: row.auroc,
      color: PALETTE[index % PALETTE.length],
    }));
    entries.sort((first, second) =>
      curveLegendSort === "auroc"
        ? second.auroc - first.auroc
        : second.auprc - first.auprc,
    );
    const columnCount = Math.min(3, Math.max(1, Math.ceil(entries.length / 4)));
    const perColumn = Math.ceil(entries.length / columnCount);
    return Array.from({ length: columnCount }, (_, index) =>
      entries.slice(index * perColumn, (index + 1) * perColumn),
    ).filter((column) => column.length);
  })();
  // Reference sign composition: without it, an inhibition EPR of 0.000x cannot
  // be told apart from "the reference barely contains inhibitory edges".
  const activationReferenceCount =
    rows.find((row) => row.activationReferenceCount !== null)
      ?.activationReferenceCount ?? null;
  const inhibitionReferenceCount =
    rows.find((row) => row.inhibitionReferenceCount !== null)
      ?.inhibitionReferenceCount ?? null;
  const downloadChart = async (
    container: HTMLDivElement | null,
    filename: string,
    format: "svg" | "png",
  ) => {
    const svg = container?.querySelector("svg");
    if (!svg) throw new Error("The chart is not available to download.");
    const exportSvg = svg.cloneNode(true) as SVGSVGElement;
    exportSvg.querySelectorAll("[data-export-exclude]").forEach((node) => {
      node.remove();
    });
    exportSvg.querySelectorAll<SVGPathElement>("[data-export-curve]").forEach((path) => {
      path.setAttribute("opacity", "1");
      path.setAttribute("stroke-width", "2.75");
      path.removeAttribute("data-export-curve");
    });
    if (format === "svg") {
      downloadSvg(exportSvg, `${filename}.svg`);
    } else {
      await downloadSvgPng(exportSvg, `${filename}.png`, 4);
    }
  };
  return (
    <div className="space-y-5">
      <Panel
        title="Benchmark summary"
        titleAction={
          <button
            type="button"
            onClick={() => setIsBenchmarkHelpOpen(true)}
            aria-label="How to read the benchmark summary"
            aria-haspopup="dialog"
            aria-controls="benchmark-summary-help-title"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-extrabold leading-none text-slate-500 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
          >
            ?
          </button>
        }
        description="How well each method recovers the uploaded reference network."
        aside={
          <DownloadMenu
            ariaLabel="Download benchmark summary"
            items={[
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
                      "runtime_seconds",
                    ],
                    ...rows.map((row) => [
                      row.algorithmId,
                      algorithmMetaMap.get(row.algorithmId)?.directed === false
                        ? "undirected"
                        : "directed",
                      row.evaluatedEdges,
                      benchmark.candidateGeneCount,
                      benchmark.possibleEdges,
                      benchmark.eligibleReferenceEdges,
                      benchmark.randomBaseline.toFixed(6),
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
                      row.runtimeSeconds.toFixed(3),
                    ]),
                  ]),
              },
            ]}
          />
        }
      >
        <p className="flex flex-wrap gap-x-2 gap-y-1 border-y border-slate-100 py-3 text-xs leading-5 text-slate-500">
          <span>
            <strong className="font-bold text-slate-700">
              {benchmark.candidateGeneCount.toLocaleString()}
            </strong>{" "}
            genes
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="font-bold text-slate-700">
              {benchmark.possibleEdges.toLocaleString()}
            </strong>{" "}
            possible directed interactions
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="font-bold text-slate-700">
              {benchmark.eligibleReferenceEdges.toLocaleString()}
            </strong>{" "}
            reference interactions
            {activationReferenceCount !== null ||
            inhibitionReferenceCount !== null ? (
              <>
                {" ("}
                {activationReferenceCount !== null
                  ? `${activationReferenceCount.toLocaleString()} activating`
                  : null}
                {activationReferenceCount !== null &&
                inhibitionReferenceCount !== null
                  ? ", "
                  : null}
                {inhibitionReferenceCount !== null
                  ? `${inhibitionReferenceCount.toLocaleString()} inhibitory`
                  : null}
                {")"}
              </>
            ) : null}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            random precision{" "}
            <strong className="font-bold text-slate-700">
              {benchmark.randomBaseline.toFixed(3)}
            </strong>
          </span>
        </p>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
          <div className="overflow-x-auto">
            <table
              className={`w-full table-fixed ${
                signedMetricsAvailable ? "min-w-[65rem]" : "min-w-[43rem]"
              }`}
            >
            <colgroup>
              <col className="w-40" />
              <col className="w-40" />
              <col className="w-56" />
              <col className="w-36" />
              {signedMetricsAvailable ? (
                <>
                  <col className="w-44" />
                  <col className="w-44" />
                </>
              ) : null}
            </colgroup>
            <thead className="grn-table-header sticky top-0 z-10 shadow-[0_1px_0_0_#e2e8f0]">
              <tr>
                <th className="sticky left-0 z-20 bg-slate-50 px-4 py-3 text-left shadow-[1px_0_0_0_#e2e8f0]">
                  Algorithm
                </th>
                <th
                  aria-sort={benchmarkSort === "auprcRatio" ? "descending" : "none"}
                  className="px-4 py-3 text-left"
                >
                  <SortableMetricHeader
                    sortKey="auprcRatio"
                    activeSort={benchmarkSort}
                    onSort={setBenchmarkSort}
                  >
                    AUPRC ratio
                  </SortableMetricHeader>
                </th>
                <th
                  aria-sort={
                    benchmarkSort === "earlyPrecisionRatio" ? "descending" : "none"
                  }
                  className="px-4 py-3 text-left"
                >
                  <SortableMetricHeader
                    sortKey="earlyPrecisionRatio"
                    activeSort={benchmarkSort}
                    onSort={setBenchmarkSort}
                  >
                    Early precision ratio
                  </SortableMetricHeader>
                </th>
                <th
                  aria-sort={benchmarkSort === "auroc" ? "descending" : "none"}
                  className="px-4 py-3 text-left"
                >
                  <SortableMetricHeader
                    sortKey="auroc"
                    activeSort={benchmarkSort}
                    onSort={setBenchmarkSort}
                  >
                    AUROC
                  </SortableMetricHeader>
                </th>
                {signedMetricsAvailable ? (
                  <>
                    <th
                      aria-sort={
                        benchmarkSort === "activationEpr" ? "descending" : "none"
                      }
                      className="px-4 py-3 text-left"
                    >
                      <SortableMetricHeader
                        sortKey="activationEpr"
                        activeSort={benchmarkSort}
                        onSort={setBenchmarkSort}
                      >
                        Activation EPR
                      </SortableMetricHeader>
                    </th>
                    <th
                      aria-sort={
                        benchmarkSort === "inhibitionEpr" ? "descending" : "none"
                      }
                      className="px-4 py-3 text-left"
                    >
                      <SortableMetricHeader
                        sortKey="inhibitionEpr"
                        activeSort={benchmarkSort}
                        onSort={setBenchmarkSort}
                      >
                        Inhibition EPR
                      </SortableMetricHeader>
                    </th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRows.map((row) => (
                <tr
                  key={row.algorithmId}
                  className="group text-sm text-slate-700 transition hover:bg-slate-50/70"
                >
                  <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left shadow-[1px_0_0_0_#f1f5f9] transition group-hover:bg-slate-50">
                    <span className="font-extrabold text-slate-900">
                      {row.algorithmId}
                    </span>
                  </th>
                  <td className="px-4 py-2.5">
                    <RatioMetric
                      ratio={row.auprcRatio}
                      metric="AUPRC"
                      rawValue={row.auprc}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <RatioMetric
                      ratio={row.earlyPrecisionRatio}
                      metric="EP"
                      rawValue={row.precisionAtK}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <div
                      className="py-1 tabular-nums"
                      title={`AUROC: ${row.auroc.toFixed(3)} (chance 0.500)`}
                    >
                      <p className="text-base font-extrabold text-slate-800">
                        {row.auroc.toFixed(3)}
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                        {row.auroc >= 0.5
                          ? `+${(row.auroc - 0.5).toFixed(3)} vs chance`
                          : `${(row.auroc - 0.5).toFixed(3)} vs chance`}
                      </p>
                    </div>
                  </td>
                  {signedMetricsAvailable ? (
                    <>
                      <td className="px-4 py-2.5">
                        <RatioMetric
                          ratio={row.activationEpr}
                          metric="EP"
                          rawValue={row.activationPrecision}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <RatioMetric
                          ratio={row.inhibitionEpr}
                          metric="EP"
                          rawValue={row.inhibitionPrecision}
                        />
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
            </table>
          </div>
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
          exampleRow={sortedRows[0]}
          onClose={() => setIsBenchmarkHelpOpen(false)}
        />
      ) : null}

      {/* Curve charts are square, so pairing them uses the width the square gives up. */}
      <Panel
        title="Curve performance"
        titleAction={
          <button
            type="button"
            onClick={() => setIsCurveHelpOpen(true)}
            aria-label="How to read curve performance"
            aria-haspopup="dialog"
            aria-controls="curve-performance-help-title"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-extrabold leading-none text-slate-500 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
          >
            ?
          </button>
        }
        aside={
          <DownloadMenu
            ariaLabel="Download curve performance"
            items={[
              {
                label: "Precision–recall",
                format: "PNG",
                onSelect: () =>
                  downloadChart(
                    prChartRef.current,
                    "precision-recall-performance",
                    "png",
                  ),
              },
              {
                label: "Precision–recall",
                format: "SVG",
                onSelect: () =>
                  downloadChart(
                    prChartRef.current,
                    "precision-recall-performance",
                    "svg",
                  ),
              },
              {
                label: "ROC",
                format: "PNG",
                onSelect: () =>
                  downloadChart(rocChartRef.current, "roc-curves", "png"),
              },
              {
                label: "ROC",
                format: "SVG",
                onSelect: () =>
                  downloadChart(rocChartRef.current, "roc-curves", "svg"),
              },
              {
                label: "Curve values",
                format: "CSV",
                description: "Both curves for every method.",
                onSelect: () =>
                  downloadCsv("curve-performance.csv", [
                    ["curve", "algorithm", "x", "y"],
                    ...rows.flatMap((row) => [
                      ...row.pr.map((point) => [
                        "precision-recall",
                        row.algorithmId,
                        point.x,
                        point.y,
                      ]),
                      ...row.roc.map((point) => [
                        "roc",
                        row.algorithmId,
                        point.x,
                        point.y,
                      ]),
                    ]),
                  ]),
              },
            ]}
          />
        }
      >
        <div className="grid gap-6 xl:grid-cols-2">
          <div ref={prChartRef}>
            <LineChart
              series={rows.map((row) => ({
                name: row.algorithmId,
                points: row.pr,
                summary: `AUPRC ${row.auprc.toFixed(3)}`,
              }))}
              xLabel="Recall"
              yLabel="Precision"
              randomBaseline={benchmark.randomBaseline}
              earlyRegionMax={0.25}
              caption="Precision–recall"
              showLegend={false}
              focusedSeries={curveFocus}
              onFocusedSeriesChange={setCurveFocus}
            />
          </div>
          <div ref={rocChartRef}>
            <LineChart
              series={rows.map((row) => ({
                name: row.algorithmId,
                points: row.roc,
                summary: `AUROC ${row.auroc.toFixed(3)}`,
              }))}
              xLabel="False-positive rate"
              yLabel="True-positive rate"
              diagonalBaseline
              caption="ROC"
              showLegend={false}
              focusedSeries={curveFocus}
              onFocusedSeriesChange={setCurveFocus}
            />
          </div>
        </div>
        {/*
          One legend for both charts. Laid out as a table rather than chips so
          "AUPRC"/"AUROC" are paid for once in the header instead of repeated on
          every entry, and the values align into scannable columns.
        */}
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            {curveLegendColumns.map((column, columnIndex) => (
              <div key={columnIndex}>
                <div className="flex items-center gap-2 px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                  <span className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                  <span className="flex-1">Method</span>
                  <button
                    type="button"
                    onClick={() => setCurveLegendSort("auprc")}
                    className={`w-12 text-right tabular-nums transition ${
                      curveLegendSort === "auprc"
                        ? "text-[#087ead]"
                        : "hover:text-slate-600"
                    }`}
                  >
                    AUPRC
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurveLegendSort("auroc")}
                    className={`w-12 text-right tabular-nums transition ${
                      curveLegendSort === "auroc"
                        ? "text-[#087ead]"
                        : "hover:text-slate-600"
                    }`}
                  >
                    AUROC
                  </button>
                </div>
                {column.map((entry) => {
                  const isFocused = curveFocus === entry.algorithmId;
                  return (
                    <button
                      key={entry.algorithmId}
                      type="button"
                      aria-pressed={isFocused}
                      onClick={() =>
                        setCurveFocus(isFocused ? null : entry.algorithmId)
                      }
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        isFocused
                          ? "bg-[#f2f9fc] text-[#087ead]"
                          : curveFocus
                            ? "text-slate-400 hover:bg-slate-50"
                            : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="flex-1 truncate text-left">
                        {entry.algorithmId}
                      </span>
                      <span className="w-12 text-right tabular-nums">
                        {entry.auprc.toFixed(3)}
                      </span>
                      <span className="w-12 text-right tabular-nums">
                        {entry.auroc.toFixed(3)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Panel>
      {isCurveHelpOpen && typeof document !== "undefined" ? (
        <CurvePerformanceHelpModal
          randomBaseline={benchmark.randomBaseline}
          onClose={() => setIsCurveHelpOpen(false)}
        />
      ) : null}

      <details className="group rounded-[1.25rem] border border-slate-200 bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div>
            <h3 className="text-base font-extrabold text-slate-950">
              Additional benchmark diagnostics
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Motif counts and top-prediction errors.
            </p>
          </div>
          <span className="text-xl font-light text-slate-400 transition group-open:rotate-45">
            +
          </span>
        </summary>
        <div className="space-y-7 border-t border-slate-100 px-5 py-5 sm:px-6">
          <section>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-extrabold text-slate-900">
                    Motif count ratios
                  </h4>
                  <button
                    type="button"
                    onClick={() => setAdditionalBenchmarkHelp("motif")}
                    aria-label="How to read motif count ratios"
                    aria-haspopup="dialog"
                    aria-controls="additional-benchmark-help-title"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-extrabold leading-none text-slate-500 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
                  >
                    ?
                  </button>
                </div>
              </div>
              <DownloadMenu
                ariaLabel="Download motif count ratios"
                items={[
                  {
                    label: "Motif count table",
                    format: "CSV",
                    onSelect: () =>
                      downloadCsv("motif-count-ratios.csv", [
                        [
                          "algorithm",
                          "feedback_loops",
                          "feed_forward_loops",
                          "mutual_interactions",
                        ],
                        ...rows.map((row) => [
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
            <div className="mt-4">
              <MotifRecovery
                rows={rows}
                reference={benchmark.referenceMotifs}
              />
            </div>
          </section>
          <section className="border-t border-slate-100 pt-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-extrabold text-slate-900">
                    How the top predictions compare with the reference
                  </h4>
                  <button
                    type="button"
                    onClick={() => setAdditionalBenchmarkHelp("path")}
                    aria-label="How to read top-prediction paths"
                    aria-haspopup="dialog"
                    aria-controls="additional-benchmark-help-title"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-extrabold leading-none text-slate-500 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
                  >
                    ?
                  </button>
                </div>
              </div>
              <DownloadMenu
                ariaLabel="Download top-prediction path context"
                items={[
                  {
                    label: "Top-prediction path chart",
                    format: "PNG",
                    description: "Stacked bars with counts and path-category guide.",
                    onSelect: async () => {
                      if (!pathBreakdownExportRef.current) {
                        throw new Error("The path chart is not available to download.");
                      }
                      await downloadSvgPng(
                        pathBreakdownExportRef.current,
                        "top-prediction-path-context.png",
                      );
                    },
                  },
                  {
                    label: "Path context table",
                    format: "CSV",
                    onSelect: () =>
                      downloadCsv("top-prediction-path-context.csv", [
                        [
                          "algorithm",
                          "exact_reference_edge",
                          "incorrect_2_steps",
                          "incorrect_3_steps",
                          "incorrect_4_steps",
                          "incorrect_5_steps",
                          "incorrect_more_than_5_steps",
                          "incorrect_no_path",
                        ],
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
            <div className="mt-4">
              <PathBreakdown
                rows={rows}
                referenceEdgeCount={benchmark.eligibleReferenceEdges}
                exportSvgRef={pathBreakdownExportRef}
              />
            </div>
          </section>
        </div>
      </details>
      {additionalBenchmarkHelp && typeof document !== "undefined" ? (
        <AdditionalBenchmarkHelpModal
          kind={additionalBenchmarkHelp}
          referenceEdgeCount={
            additionalBenchmarkHelp === "motif"
              ? benchmark.motifReferenceEdgeCount
              : benchmark.eligibleReferenceEdges
          }
          referenceMotifs={benchmark.referenceMotifs}
          onClose={() => setAdditionalBenchmarkHelp(null)}
        />
      ) : null}
    </div>
  );
}
