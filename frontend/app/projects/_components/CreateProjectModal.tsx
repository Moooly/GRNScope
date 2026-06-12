import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { ProjectAlgorithm } from "../page";
import AlgorithmDetailModal from "./AlgorithmDetailModal";
import AlgorithmStep from "./AlgorithmStep";
import UploadStep from "./UploadStep";

interface DatasetSummary {
  dimensions: string;
  hasPseudotime: boolean;
  hasGroundTruth: boolean;
  preprocessingSummary: string[];
}

interface CreateProjectModalProps {
  isCreateVisible: boolean;
  isCreateClosing: boolean;
  projectName: string;
  projectDescription: string;
  expressionFileName: string;
  pseudotimeFileName: string;
  geneCount: number | null;
  cellCount: number | null;
  isUploadingTempDataset: boolean;
  tempUploadId: string;
  topVariableGenes: string;
  includeAllTFs: boolean;
  normalizeEnabled: boolean;
  logTransformEnabled: boolean;
  selectedIds: string[];
  compatibleAlgorithms: ProjectAlgorithm[];
  selectedAlgorithms: ProjectAlgorithm[];
  ensembleEnabled: boolean;
  datasetSummary: DatasetSummary;
  errors: string[];
  isSubmitting: boolean;
  algorithms: ProjectAlgorithm[];
  isLoadingAlgorithms: boolean;
  algorithmLoadError: string | null;
  onClose: () => void;
  onStartAnalysis: () => void;
  onRecommended: () => void;
  onSelectAll: () => void;
  onToggleAlgorithm: (algorithmId: string, disabled: boolean) => void;
  setProjectName: (value: string) => void;
  setProjectDescription: (value: string) => void;
  setExpressionFile: (file: File | null) => void;
  setExpressionFileName: (value: string) => void;
  setPseudotimeFile: (file: File | null) => void;
  setPseudotimeFileName: (value: string) => void;
  setTopVariableGenes: (value: string) => void;
  setIncludeAllTFs: (value: boolean) => void;
  setNormalizeEnabled: (value: boolean) => void;
  setLogTransformEnabled: (value: boolean) => void;
  clearExpressionFile: () => void;
  clearPseudotimeFile: () => void;
  setEnsembleEnabled: (value: boolean | ((current: boolean) => boolean)) => void;
}

export default function CreateProjectModal({
  isCreateVisible,
  isCreateClosing,
  projectName,
  projectDescription,
  expressionFileName,
  pseudotimeFileName,
  geneCount,
  cellCount,
  isUploadingTempDataset,
  tempUploadId,
  topVariableGenes,
  includeAllTFs,
  normalizeEnabled,
  logTransformEnabled,
  selectedIds,
  compatibleAlgorithms,
  selectedAlgorithms,
  ensembleEnabled,
  datasetSummary,
  errors,
  isSubmitting,
  algorithms,
  isLoadingAlgorithms,
  algorithmLoadError,
  onClose,
  onStartAnalysis,
  onRecommended,
  onSelectAll,
  onToggleAlgorithm,
  setProjectName,
  setProjectDescription,
  setExpressionFile,
  setExpressionFileName,
  setPseudotimeFile,
  setPseudotimeFileName,
  setTopVariableGenes,
  setIncludeAllTFs,
  setNormalizeEnabled,
  setLogTransformEnabled,
  clearExpressionFile,
  clearPseudotimeFile,
  setEnsembleEnabled,
}: CreateProjectModalProps) {
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSelectedDatasetRef = useRef<string | null>(null);
  const [isOutsideClosing, setIsOutsideClosing] = useState(false);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [isPreprocessingHelpOpen, setIsPreprocessingHelpOpen] = useState(false);
  const [isPreprocessingHelpClosing, setIsPreprocessingHelpClosing] = useState(false);
  const [algorithmDetailToShow, setAlgorithmDetailToShow] = useState<ProjectAlgorithm | null>(null);
  const [isAlgorithmDetailClosing, setIsAlgorithmDetailClosing] = useState(false);
  const algorithmDetailCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isModalClosing = isCreateClosing || isOutsideClosing;
  const hasExpressionFile = Boolean(expressionFileName);
  const datasetReady = hasExpressionFile && tempUploadId.length > 0 && !isUploadingTempDataset;

  const selectExpressionFile = (file: File | null) => {
    setExpressionFile(file);
    setExpressionFileName(file?.name ?? "");
  };

  const handleExpressionDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0] ?? null;
    selectExpressionFile(file);
  };

  useEffect(() => {
    if (isCreateVisible) {
      setIsOutsideClosing(false);
      setIsCustomizeOpen(false);
      setIsPreprocessingHelpOpen(false);
      setIsPreprocessingHelpClosing(false);
      setAlgorithmDetailToShow(null);
      setIsAlgorithmDetailClosing(false);
      autoSelectedDatasetRef.current = null;
    }
  }, [isCreateVisible]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
      if (algorithmDetailCloseTimeoutRef.current) {
        clearTimeout(algorithmDetailCloseTimeoutRef.current);
      }
    };
  }, []);

  const handleShowAlgorithmDetails = (algorithm: ProjectAlgorithm) => {
    if (algorithmDetailCloseTimeoutRef.current) {
      clearTimeout(algorithmDetailCloseTimeoutRef.current);
      algorithmDetailCloseTimeoutRef.current = null;
    }
    setIsAlgorithmDetailClosing(false);
    setAlgorithmDetailToShow(algorithm);
  };

  const handleCloseAlgorithmDetails = () => {
    if (!algorithmDetailToShow || isAlgorithmDetailClosing) return;
    setIsAlgorithmDetailClosing(true);
    algorithmDetailCloseTimeoutRef.current = setTimeout(() => {
      setAlgorithmDetailToShow(null);
      setIsAlgorithmDetailClosing(false);
    }, 280);
  };

  useEffect(() => {
    if (!datasetReady || isLoadingAlgorithms || compatibleAlgorithms.length === 0) {
      return;
    }

    const autoSelectKey = `${tempUploadId}:${datasetSummary.hasPseudotime ? "time" : "no-time"}`;

    if (autoSelectedDatasetRef.current === autoSelectKey) {
      return;
    }

    autoSelectedDatasetRef.current = autoSelectKey;
    onSelectAll();
  }, [
    compatibleAlgorithms.length,
    datasetReady,
    datasetSummary.hasPseudotime,
    isLoadingAlgorithms,
    onSelectAll,
    tempUploadId,
  ]);

  const handleOutsideClose = () => {
    if (isModalClosing) return;

    setIsOutsideClosing(true);

    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }

    closeTimeoutRef.current = setTimeout(() => {
      setIsOutsideClosing(false);
      onClose();
    }, 480);
  };

  const handlePreprocessingHelpClose = () => {
    if (isPreprocessingHelpClosing) return;

    setIsPreprocessingHelpClosing(true);

    window.setTimeout(() => {
      setIsPreprocessingHelpOpen(false);
      setIsPreprocessingHelpClosing(false);
    }, 480);
  };

  if (!isCreateVisible) {
    return null;
  }

  const startDisabled =
    isSubmitting ||
    isUploadingTempDataset ||
    !hasExpressionFile ||
    selectedAlgorithms.length === 0 ||
    isLoadingAlgorithms;

  const willRunSummary = (() => {
    if (!hasExpressionFile) return "Upload an expression matrix to begin.";
    if (isUploadingTempDataset) return "Validating dataset…";
    if (!datasetReady) return "Waiting for the dataset to validate…";
    if (selectedAlgorithms.length === 0) return "No algorithms selected — open Customize to choose at least one.";

    const algoLabel =
      selectedAlgorithms.length === 1
        ? `1 algorithm (${selectedAlgorithms[0].name})`
        : `${selectedAlgorithms.length} algorithms`;

    const settings: string[] = [];

    if (topVariableGenes && Number(topVariableGenes) > 0) {
      settings.push(`top ${Number(topVariableGenes).toLocaleString()} variable genes`);
    }

    if (includeAllTFs) {
      settings.push("known TFs included");
    }

    if (normalizeEnabled) {
      settings.push("normalization enabled");
    }

    if (logTransformEnabled) {
      settings.push("log transform enabled");
    }

    // Removed ensembleEnabled block

    const settingsLabel = settings.length > 0 ? ` with ${settings.join(", ")}` : "";

    return `Will run ${algoLabel}${settingsLabel}.`;
  })();

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/45 px-4 py-10 backdrop-blur-sm sm:px-6 lg:py-14 ${
        isModalClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      onClick={
        isPreprocessingHelpOpen || algorithmDetailToShow
          ? undefined
          : handleOutsideClose
      }
    >
      <div
        className={`max-h-[calc(100vh-5rem)] w-full max-w-4xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 lg:p-8 ${
          isModalClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#1b75a6]">
              Workspace setup
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
              Start an analysis
            </h2>
          </div>
        </div>

        <div className="mt-6 space-y-6">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-950">Expression matrix</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    CSV with rows = genes, columns = cells. First row = cell IDs, first
                    column = gene names. Max 500 MB.
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <label
                  className="relative flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-[#1b75a6]/30 bg-[#f7fbff] px-6 py-10 text-center transition hover:border-[#1b75a6]/50 hover:bg-[#f2f9fc]"
                  onDragEnter={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onDrop={handleExpressionDrop}
                >
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      selectExpressionFile(file);
                    }}
                  />
                  <span className="text-base font-bold text-slate-950">
                    {expressionFileName || "Drop expression matrix CSV here"}
                  </span>
                  <span className="mt-2 text-sm text-slate-500">
                    {expressionFileName ? "Click to replace" : "or click to browse"}
                  </span>
                </label>
              </div>

              {hasExpressionFile && (
                <div className="mt-4 flex flex-wrap items-center gap-3 px-1 text-sm">
                  {isUploadingTempDataset ? (
                    <span className="inline-flex items-center gap-2 font-medium text-slate-600">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-[#1b75a6]" />
                      Validating dataset…
                    </span>
                  ) : datasetReady ? (
                    <>
                      <span className="inline-flex items-center gap-2 font-bold text-[#178a62]">
                        <span className="h-2 w-2 rounded-full bg-[#20b779]" />
                        {expressionFileName}
                      </span>
                      {geneCount !== null && cellCount !== null && (
                        <span className="font-medium text-slate-700">
                          {geneCount.toLocaleString()} genes ×{" "}
                          {cellCount.toLocaleString()} cells
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="font-medium text-slate-600">{expressionFileName}</span>
                  )}
                </div>
              )}
            </div>

            <UploadStep
              pseudotimeFileName={pseudotimeFileName}
              setPseudotimeFile={setPseudotimeFile}
              setPseudotimeFileName={setPseudotimeFileName}
            />
          </div>


          {datasetReady && (
            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                    Plan summary
                  </p>
                  <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                    {willRunSummary}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCustomizeOpen((prev) => !prev)}
                  className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                  aria-expanded={isCustomizeOpen}
                >
                  {isCustomizeOpen ? "Hide customize ▴" : "Customize ▾"}
                </button>
              </div>
            </div>
          )}

          {datasetReady && isCustomizeOpen && (
            <div className="space-y-6 rounded-[1.5rem] border border-slate-200 bg-slate-50/40 p-5">
              <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                <label
                  htmlFor="projectName"
                  className="block text-xs font-bold uppercase tracking-[0.18em] text-black"
                >
                  Project name
                </label>
                <input
                  id="projectName"
                  type="text"
                  value={
                    projectName === expressionFileName.replace(/\.[^/.]+$/, "")
                      ? ""
                      : projectName || ""
                  }
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder={
                    expressionFileName
                      ? expressionFileName.replace(/\.[^/.]+$/, "")
                      : "Auto-filled from uploaded expression matrix"
                  }
                  className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
                />
              </div>


              <AlgorithmStep
                algorithms={algorithms}
                selectedIds={selectedIds}
                compatibleAlgorithms={compatibleAlgorithms}
                datasetSummary={datasetSummary}
                ensembleEnabled={ensembleEnabled}
                isLoadingAlgorithms={isLoadingAlgorithms}
                algorithmLoadError={algorithmLoadError}
                setEnsembleEnabled={setEnsembleEnabled}
                onToggleAlgorithm={onToggleAlgorithm}
                onRecommended={onRecommended}
                onSelectAll={onSelectAll}
                onShowAlgorithmDetails={handleShowAlgorithmDetails}
              />

              <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-black">
                      Preprocessing
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPreprocessingHelpClosing(false);
                        setIsPreprocessingHelpOpen(true);
                      }}
                      className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-[#1b75a6]/25 bg-[#f2f9fc] text-xs font-bold text-[#1b75a6] transition hover:bg-[#e8f5fb]"
                      aria-label="Preprocessing help"
                    >
                      ?
                    </button>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="grid items-center gap-6 lg:grid-cols-[1.55fr_0.9fr_0.9fr_0.9fr]">
                    <div className="flex items-center gap-3">
                      <span className="whitespace-nowrap text-sm font-bold text-slate-950">
                        Gene filtering
                      </span>
                      <input
                        type="number"
                        min="1"
                        max={geneCount ?? undefined}
                        step="1"
                        value={topVariableGenes}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          if (nextValue === "") {
                            setTopVariableGenes("");
                            return;
                          }
                          const parsedValue = Number(nextValue);
                          if (Number.isNaN(parsedValue)) return;
                          if (geneCount !== null && parsedValue > geneCount) {
                            setTopVariableGenes(String(geneCount));
                            return;
                          }
                          setTopVariableGenes(nextValue);
                        }}
                        className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 [appearance:textfield] focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>

                    <PreprocessingToggle
                      label="Known TFs"
                      enabled={includeAllTFs}
                      onToggle={() => setIncludeAllTFs(!includeAllTFs)}
                    />
                    <PreprocessingToggle
                      label="Normalization"
                      enabled={normalizeEnabled}
                      onToggle={() => setNormalizeEnabled(!normalizeEnabled)}
                    />
                    <PreprocessingToggle
                      label="Log transform"
                      enabled={logTransformEnabled}
                      onToggle={() => setLogTransformEnabled(!logTransformEnabled)}
                    />
                  </div>

                </div>
              </div>

            </div>
          )}

          {errors.length > 0 && (
            <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-5">
              <p className="text-sm font-bold text-rose-700">
                Please fix the following:
              </p>
              <ul className="mt-3 space-y-2 text-sm text-rose-700">
                {errors.map((error, index) => (
                  <li key={index}>• {error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={onStartAnalysis}
              disabled={startDisabled}
              className="cursor-pointer rounded-full bg-[#1b75a6] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#155f87] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting
                ? "Starting…"
                : isUploadingTempDataset
                  ? "Validating…"
                  : "Start analysis →"}
            </button>
          </div>
        </div>
      </div>

      {isPreprocessingHelpOpen && (
        <div
          className={`fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm ${
            isPreprocessingHelpClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className={`w-full max-w-lg rounded-[1.75rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 ${
              isPreprocessingHelpClosing ? "animate-modal-panel-out" : "animate-modal-panel"
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-black">
                  Preprocessing
                </p>
                <h3 className="mt-3 text-xl font-bold text-slate-950">
                  What these settings mean
                </h3>
              </div>
              <button
                type="button"
                onClick={handlePreprocessingHelpClose}
                aria-label="Close preprocessing help"
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-lg font-bold text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
              >
                ×
              </button>
            </div>

            <div className="mt-5 space-y-4 text-sm leading-6 text-slate-600">
              <p>
                These settings control how the uploaded expression matrix is prepared before running the selected GRN inference algorithms.
              </p>
              <div className="space-y-3">
                <p>
                  <span className="font-bold text-slate-950">Gene filtering:</span> keeps the selected number of variable genes for analysis.
                </p>
                <p>
                  <span className="font-bold text-slate-950">Known TFs:</span> keeps known transcription factors even if they are outside the variable-gene cutoff.
                </p>
                <p>
                  <span className="font-bold text-slate-950">Normalization:</span> adjusts expression values to reduce sequencing-depth differences between cells.
                </p>
                <p>
                  <span className="font-bold text-slate-950">Log transform:</span> compresses large expression values after normalization using a log transform.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <AlgorithmDetailModal
        algorithm={algorithmDetailToShow}
        isClosing={isAlgorithmDetailClosing}
        onClose={handleCloseAlgorithmDetails}
      />
    </div>
  );
}

function PreprocessingToggle({
  label,
  enabled,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      className="flex cursor-pointer items-center gap-3 text-left"
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
          enabled
            ? "border-[#1b75a6] bg-[#1b75a6]"
            : "border-slate-300 bg-white"
        }`}
      >
        {enabled && (
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="h-3.5 w-3.5"
          >
            <path
              d="M3.4 8.1 6.5 11.2 12.8 4.8"
              fill="none"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="text-sm font-bold text-slate-950">{label}</span>
    </button>
  );
}
