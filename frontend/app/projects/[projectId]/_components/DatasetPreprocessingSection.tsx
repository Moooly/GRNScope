"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { API_BASE } from "../../../_lib/apiConfig";
import { apiFetch } from "../../../_lib/clientIdentity";
import type {
  GeneSelectionStageResult,
  PreprocessingConfig,
  PreprocessingResult,
} from "../_lib/types";
import { RESULT_SECTION_HEADING_CLASS } from "./sectionStyles";

export type MethodGeneAdjustment = {
  algorithmId: string;
  algorithmName: string;
  inputGeneCount?: number;
  retainedGeneCount?: number;
  effectiveGeneLimit: number;
  reason: string;
  recorded: boolean;
  geneAuditAvailable: boolean;
};

type DatasetPreprocessingSectionProps = {
  projectId: string;
  inputGeneCount?: number | null;
  cellCount?: number | null;
  finalGeneCount?: number | null;
  matrixTreatmentLabel: string;
  preprocessing?: PreprocessingConfig;
  preprocessingResult?: PreprocessingResult | null;
  methodAdjustments: MethodGeneAdjustment[];
  onOpenDownloadMenu: () => void;
  onCloseDownloadMenu: () => void;
  isDownloadMenuOpen: boolean;
  downloadMenu: ReactNode;
  divided?: boolean;
  compact?: boolean;
};

type GeneAuditTarget = {
  title: string;
  detail: string;
  stage?: string;
  algorithmId?: string;
};

type GeneAuditPayload = {
  input_gene_count?: number;
  retained_gene_count?: number;
  removed_gene_count?: number;
  retained_gene_names: string[];
  removed_gene_names: string[];
};

const STAGE_LABELS: Record<string, string> = {
  detection: "Detection threshold",
  trajectory: "Trajectory-aware",
  variance: "Variable genes",
};

const GENE_LIST_RENDER_LIMIT = 200;
const MODAL_TRANSITION_MS = 480;

function formatCount(value?: number | null) {
  return typeof value === "number" ? value.toLocaleString() : "—";
}

function formatStageRule(stage: string, config?: PreprocessingConfig) {
  if (stage === "detection") {
    return `Detected in ≥${config?.detection?.minimum_cell_percent ?? "—"}% of cells`;
  }
  if (stage === "trajectory") {
    return [
      `p ≤ ${config?.trajectory?.p_value_threshold ?? "—"}`,
      config?.trajectory?.bonferroni_correction ? "Bonferroni corrected" : null,
      config?.trajectory?.retain_significant_tfs ? "significant TFs retained" : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (stage === "variance") {
    return [
      `Top ${config?.variance?.gene_count ?? "—"} by variance`,
      config?.variance?.include_known_tfs ? "known TFs retained" : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return "Applied during preprocessing";
}

function stageCounts(result?: GeneSelectionStageResult) {
  if (
    typeof result?.input_gene_count !== "number" ||
    typeof result?.retained_gene_count !== "number"
  ) {
    return "Preparing";
  }
  const removedCount =
    typeof result.removed_gene_count === "number"
      ? result.removed_gene_count
      : Math.max(0, result.input_gene_count - result.retained_gene_count);
  const retainedPercent =
    result.input_gene_count > 0
      ? Math.round((result.retained_gene_count / result.input_gene_count) * 100)
      : 0;
  return `${formatCount(result.input_gene_count)} → ${formatCount(
    result.retained_gene_count,
  )} retained (${retainedPercent}%) · ${formatCount(removedCount)} excluded`;
}

function downloadGeneList(
  target: GeneAuditTarget,
  status: "retained" | "removed",
  geneNames: string[],
) {
  const rows = [
    ["gene", "status"],
    ...geneNames.map((geneName) => [geneName, status]),
  ];
  const csv = rows
    .map((row) =>
      row
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
  const href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  const source = target.algorithmId ?? target.stage ?? "gene-selection";
  anchor.href = href;
  anchor.download = `${source.toLowerCase()}-${status}-genes.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function GeneAuditModal({
  projectId,
  target,
  onClose,
}: {
  projectId: string;
  target: GeneAuditTarget;
  onClose: () => void;
}) {
  const [audit, setAudit] = useState<GeneAuditPayload | null>(null);
  const [activeTab, setActiveTab] = useState<"retained" | "removed">("removed");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const requestClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, MODAL_TRANSITION_MS);
  }, [isClosing, onClose]);

  useEffect(() => {
    const controller = new AbortController();
    const query = target.algorithmId
      ? `algorithm_id=${encodeURIComponent(target.algorithmId)}`
      : `stage=${encodeURIComponent(target.stage ?? "")}`;

    void apiFetch(
      `${API_BASE}/projects/${projectId}/gene-selection-audit?${query}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.detail ?? "Gene-selection details could not be loaded.",
          );
        }
        return response.json();
      })
      .then((payload) => {
        setAudit({
          input_gene_count: payload.input_gene_count,
          retained_gene_count: payload.retained_gene_count,
          removed_gene_count: payload.removed_gene_count,
          retained_gene_names: Array.isArray(payload.retained_gene_names)
            ? payload.retained_gene_names
            : [],
          removed_gene_names: Array.isArray(payload.removed_gene_names)
            ? payload.removed_gene_names
            : [],
        });
      })
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Gene-selection details could not be loaded.",
        );
      });

    return () => controller.abort();
  }, [projectId, target.algorithmId, target.stage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  const activeGenes = useMemo(
    () =>
      activeTab === "retained"
        ? audit?.retained_gene_names ?? []
        : audit?.removed_gene_names ?? [],
    [activeTab, audit],
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const matchingGenes = useMemo(
    () =>
      normalizedSearch
        ? activeGenes.filter((geneName) =>
            geneName.toLocaleLowerCase().includes(normalizedSearch),
          )
        : activeGenes,
    [activeGenes, normalizedSearch],
  );
  const visibleGenes = matchingGenes.slice(0, GENE_LIST_RENDER_LIMIT);

  return (
    <div
      className={`fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/30 px-4 py-8 backdrop-blur-[2px] ${
        isClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="gene-audit-title"
        className={`flex max-h-[min(720px,calc(100vh-4rem))] w-full max-w-3xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl ${
          isClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
      >
        <header className="flex items-start justify-between gap-5 border-b border-slate-100 px-6 py-5">
          <div>
            <h3
              id="gene-audit-title"
              className="text-lg font-bold tracking-tight text-slate-950"
            >
              {target.title}
            </h3>
            <p className="mt-1 text-sm text-slate-500">{target.detail}</p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
            aria-label="Close gene list"
          >
            ×
          </button>
        </header>

        {error ? (
          <p className="m-6 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </p>
        ) : !audit ? (
          <div className="flex min-h-56 items-center justify-center">
            <span
              className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-[#1b75a6]"
              aria-label="Loading gene list"
            />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
              <div className="inline-flex rounded-full bg-slate-100 p-1">
                {(["retained", "removed"] as const).map((tab) => {
                  const count =
                    tab === "retained"
                      ? audit.retained_gene_names.length
                      : audit.removed_gene_names.length;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        setActiveTab(tab);
                        setSearch("");
                      }}
                      className={`rounded-full px-4 py-2 text-sm font-bold capitalize transition ${
                        activeTab === tab
                          ? "bg-white text-[#1b75a6] shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {tab === "removed" ? "Excluded" : "Retained"} ·{" "}
                      {formatCount(count)}
                    </button>
                  );
                })}
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <label className="relative min-w-0 max-w-xs flex-1">
                  <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-slate-400">
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                      <circle
                        cx="8.5"
                        cy="8.5"
                        r="5.25"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                      <path
                        d="m12.4 12.4 4 4"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search genes"
                    className="h-10 w-full rounded-full border border-slate-200 bg-white pl-10 pr-4 text-sm font-semibold text-slate-700 outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    downloadGeneList(target, activeTab, activeGenes)
                  }
                  disabled={activeGenes.length === 0}
                  className="inline-flex h-10 shrink-0 items-center rounded-full border border-slate-200 px-4 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  CSV
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-6 py-5">
              {matchingGenes.length === 0 ? (
                <p className="py-16 text-center text-sm font-semibold text-slate-400">
                  {activeGenes.length === 0
                    ? activeTab === "removed"
                      ? "No genes were excluded."
                      : "No genes were retained."
                    : "No genes match this search."}
                </p>
              ) : (
                <>
                  <ul className="grid gap-x-5 gap-y-2 sm:grid-cols-2 md:grid-cols-3">
                    {visibleGenes.map((geneName) => (
                      <li
                        key={geneName}
                        className="truncate rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700"
                        title={geneName}
                      >
                        {geneName}
                      </li>
                    ))}
                  </ul>
                  {matchingGenes.length > visibleGenes.length ? (
                    <p className="mt-5 text-center text-xs font-semibold text-slate-400">
                      Showing the first {formatCount(visibleGenes.length)} of{" "}
                      {formatCount(matchingGenes.length)} matches. Search to narrow
                      the list or download the complete CSV.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function MethodLimitsModal({
  adjustments,
  sourceGeneCount,
  onInspect,
  onClose,
}: {
  adjustments: MethodGeneAdjustment[];
  sourceGeneCount?: number | null;
  onInspect: (adjustment: MethodGeneAdjustment) => void;
  onClose: () => void;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const inspectAfterCloseRef = useRef<MethodGeneAdjustment | null>(null);

  const requestClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      const adjustment = inspectAfterCloseRef.current;
      onClose();
      if (adjustment) onInspect(adjustment);
    }, MODAL_TRANSITION_MS);
  }, [isClosing, onClose, onInspect]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  return (
    <div
      className={`fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/30 px-4 py-8 backdrop-blur-[2px] ${
        isClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="method-limits-title"
        className={`flex max-h-[min(680px,calc(100vh-4rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl ${
          isClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
      >
        <header className="flex items-start justify-between gap-5 border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[#1b75a6]">
              Runtime optimization
            </p>
            <h3
              id="method-limits-title"
              className="mt-1 text-lg font-bold tracking-tight text-slate-950"
            >
              Method-specific gene filters
            </h3>
            <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500">
              These algorithms use fewer high-variance genes to keep expected
              runtimes within hours.
            </p>
          </div>
          <button
            type="button"
            onClick={() => requestClose()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
            aria-label="Close affected methods"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="grid sm:grid-cols-2">
              {adjustments.map((adjustment) => {
                const canInspect =
                  adjustment.recorded &&
                  adjustment.geneAuditAvailable &&
                  typeof adjustment.inputGeneCount === "number" &&
                  typeof adjustment.retainedGeneCount === "number" &&
                  adjustment.inputGeneCount > adjustment.retainedGeneCount;
                return (
                  <div
                    key={adjustment.algorithmId}
                    className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:[&:nth-child(odd)]:border-r"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-800">
                        {adjustment.algorithmName}
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-slate-500">
                        {adjustment.recorded &&
                        typeof adjustment.retainedGeneCount === "number"
                          ? `Current input · ${formatCount(
                              adjustment.retainedGeneCount,
                            )} genes used`
                          : `Current gene filter · ${formatCount(
                              adjustment.effectiveGeneLimit,
                            )} genes`}
                      </p>
                    </div>
                    {canInspect ? (
                      <button
                        type="button"
                        onClick={() => {
                          inspectAfterCloseRef.current = adjustment;
                          requestClose();
                        }}
                        className="shrink-0 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                      >
                        View genes
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <p className="mt-4 text-xs leading-5 text-slate-500">
            To change the genes used, adjust the{" "}
            <strong className="font-bold text-slate-700">Gene filter</strong>{" "}
            when adding or rerunning that algorithm. Algorithms not shown here
            use all {formatCount(sourceGeneCount)} shared genes.
          </p>
        </div>
      </section>
    </div>
  );
}

export default function DatasetPreprocessingSection({
  projectId,
  inputGeneCount,
  cellCount,
  finalGeneCount,
  matrixTreatmentLabel,
  preprocessing,
  preprocessingResult,
  methodAdjustments,
  onOpenDownloadMenu,
  onCloseDownloadMenu,
  isDownloadMenuOpen,
  downloadMenu,
  divided = true,
  compact = false,
}: DatasetPreprocessingSectionProps) {
  const [methodAdjustmentsOpen, setMethodAdjustmentsOpen] = useState(false);
  const [auditTarget, setAuditTarget] = useState<GeneAuditTarget | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const enabledStages = preprocessing?.enabled_stages ?? [];
  const resultByStage = useMemo(
    () =>
      new Map(
        (preprocessingResult?.gene_selection ?? []).map((result) => [
          result.stage,
          result,
        ]),
      ),
    [preprocessingResult?.gene_selection],
  );
  const methodLimits = methodAdjustments.map(
    (adjustment) => adjustment.effectiveGeneLimit,
  );
  const methodLimitRange =
    methodLimits.length > 0
      ? `${formatCount(Math.min(...methodLimits))}–${formatCount(
          Math.max(...methodLimits),
        )} genes`
      : null;
  const methodSourceGeneCount =
    preprocessingResult?.gene_count ?? finalGeneCount ?? inputGeneCount;
  const hasGeneCounts =
    typeof inputGeneCount === "number" &&
    typeof methodSourceGeneCount === "number";
  const excludedGeneCount = hasGeneCounts
    ? Math.max(0, inputGeneCount - methodSourceGeneCount)
    : null;
  const retainedPercent =
    hasGeneCounts && inputGeneCount > 0
      ? Math.round((methodSourceGeneCount / inputGeneCount) * 100)
      : null;
  const singleStage =
    enabledStages.length === 1 ? enabledStages[0] : undefined;
  const singleStageResult = singleStage
    ? resultByStage.get(singleStage)
    : undefined;
  const canInspectSingleStage =
    singleStageResult?.gene_audit_available === true &&
    typeof singleStageResult.input_gene_count === "number" &&
    typeof singleStageResult.retained_gene_count === "number" &&
    singleStageResult.input_gene_count !== singleStageResult.retained_gene_count;

  useEffect(() => {
    if (!isDownloadMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !downloadMenuRef.current?.contains(target)) {
        onCloseDownloadMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseDownloadMenu();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDownloadMenuOpen, onCloseDownloadMenu]);

  return (
    <>
      <section
        className={
          compact
            ? "py-6 text-slate-900"
            : `${divided ? "border-t border-slate-200 pt-6" : ""} text-slate-900`
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2
              className={
                compact
                  ? "text-lg font-bold tracking-tight text-slate-950"
                  : RESULT_SECTION_HEADING_CLASS
              }
            >
              Data used for analysis
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {formatCount(cellCount)} cells
              <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
              {matrixTreatmentLabel}
            </p>
          </div>
          <div ref={downloadMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={
                isDownloadMenuOpen ? onCloseDownloadMenu : onOpenDownloadMenu
              }
              aria-expanded={isDownloadMenuOpen}
              aria-haspopup="dialog"
              aria-label="Download project files"
              title="Download project files"
              className="inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
            >
              Download
            </button>
            {downloadMenu}
          </div>
        </div>

        <div className="relative mt-4 overflow-hidden rounded-[1.2rem] border border-slate-200 bg-white">
          <div className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950">
                  Genes included
                </h3>
                <p className="mt-1 text-lg font-bold tracking-tight text-slate-950">
                  {hasGeneCounts ? (
                    <>
                      <span className="text-[#1b75a6]">
                        {formatCount(methodSourceGeneCount)}
                      </span>{" "}
                      of {formatCount(inputGeneCount)} genes retained
                    </>
                  ) : (
                    "Preparing gene selection"
                  )}
                </p>
              </div>

              {canInspectSingleStage && singleStage ? (
                <button
                  type="button"
                  onClick={() =>
                    setAuditTarget({
                      title: STAGE_LABELS[singleStage] ?? singleStage,
                      detail: "Genes retained or excluded by this filter.",
                      stage: singleStage,
                    })
                  }
                  className="inline-flex h-8 items-center rounded-full border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                >
                  Review genes
                </button>
              ) : null}
            </div>

            {retainedPercent !== null ? (
              <div className="mt-3 flex items-center gap-3">
                <div
                  className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"
                  role="progressbar"
                  aria-label="Genes retained"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={retainedPercent}
                >
                  <div
                    className="h-full rounded-full bg-[#1b75a6]"
                    style={{ width: `${retainedPercent}%` }}
                  />
                </div>
                <span className="w-9 text-right text-xs font-bold text-[#1b75a6]">
                  {retainedPercent}%
                </span>
              </div>
            ) : null}

            <p className="mt-2 text-xs font-medium leading-5 text-slate-500">
              {singleStage
                ? formatStageRule(singleStage, preprocessing)
                : enabledStages.length > 1
                  ? `${enabledStages.length} project-wide filters applied`
                  : "No project-wide filters applied"}
              {excludedGeneCount !== null ? (
                <>
                  <span className="mx-2 text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  {formatCount(excludedGeneCount)}{" "}
                  {excludedGeneCount === 1 ? "gene excluded" : "genes excluded"}
                </>
              ) : null}
            </p>
          </div>

          {enabledStages.length > 1 ? (
            <details className="group border-t border-slate-100">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50 hover:text-[#1b75a6]">
                View {enabledStages.length} filter steps
                <span
                  className="text-base text-slate-400 transition group-open:rotate-180"
                  aria-hidden="true"
                >
                  ⌄
                </span>
              </summary>
              <ol className="border-t border-slate-100">
                {enabledStages.map((stage, index) => {
                  const result = resultByStage.get(stage);
                  const changed =
                    typeof result?.input_gene_count === "number" &&
                    typeof result?.retained_gene_count === "number" &&
                    result.input_gene_count !== result.retained_gene_count;
                  const canInspect =
                    changed && result?.gene_audit_available === true;
                  return (
                    <li
                      key={stage}
                      className="grid gap-2 border-b border-slate-100 px-5 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
                    >
                      <p className="text-xs font-semibold text-slate-600">
                        <span className="mr-2 font-bold text-slate-800">
                          {index + 1}. {STAGE_LABELS[stage] ?? stage}
                        </span>
                        {formatStageRule(stage, preprocessing)}
                      </p>
                      <p className="text-xs font-bold text-slate-500">
                        {stageCounts(result)}
                      </p>
                      {canInspect ? (
                        <button
                          type="button"
                          onClick={() =>
                            setAuditTarget({
                              title: STAGE_LABELS[stage] ?? stage,
                              detail:
                                "Genes retained or excluded at this filter step.",
                              stage,
                            })
                          }
                          className="w-fit rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                        >
                          Review genes
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </details>
          ) : null}

          {methodAdjustments.length > 0 ? (
            <div className="flex flex-col gap-3 border-t border-[#1b75a6]/10 bg-[#f7fbfd] px-5 py-3.5 sm:flex-row sm:items-center">
              <span className="inline-flex h-6 w-fit shrink-0 items-center rounded-full border border-[#1b75a6]/15 bg-white px-2 text-[9px] font-bold uppercase tracking-[0.08em] text-[#1b75a6]">
                Runtime
              </span>
              <p className="min-w-0 flex-1 text-xs leading-5 text-slate-600">
                <strong className="font-bold text-slate-800">
                  {methodAdjustments.length}{" "}
                  {methodAdjustments.length === 1 ? "method uses" : "methods use"}{" "}
                  {methodLimitRange ?? "fewer genes"}
                </strong>{" "}
                to finish within hours. Other methods use all{" "}
                {formatCount(methodSourceGeneCount)} genes.
              </p>
              <button
                type="button"
                onClick={() => setMethodAdjustmentsOpen(true)}
                aria-expanded={methodAdjustmentsOpen}
                aria-haspopup="dialog"
                className="inline-flex h-8 w-fit shrink-0 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
              >
                View methods
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {methodAdjustmentsOpen
        ? createPortal(
            <MethodLimitsModal
              adjustments={methodAdjustments}
              sourceGeneCount={methodSourceGeneCount}
              onInspect={(adjustment) =>
                setAuditTarget({
                  title: `${adjustment.algorithmName} gene set`,
                  detail:
                    "Highest-variance genes retained automatically for this algorithm.",
                  algorithmId: adjustment.algorithmId,
                })
              }
              onClose={() => setMethodAdjustmentsOpen(false)}
            />,
            document.body,
          )
        : null}

      {auditTarget ? (
        <GeneAuditModal
          projectId={projectId}
          target={auditTarget}
          onClose={() => setAuditTarget(null)}
        />
      ) : null}
    </>
  );
}
