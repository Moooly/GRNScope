import { useEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import type { ProjectAlgorithm } from "../page";
import AlgorithmDetailModal from "./AlgorithmDetailModal";
import AlgorithmStep from "./AlgorithmStep";
import {
  CELLORACLE_BASE_GRN_OPTIONS,
  CELLORACLE_SPECIES_OPTIONS,
} from "./cellOracleOptions";
import FileNameDisplay, { formatFileNameForDisplay } from "./FileNameDisplay";

const MAX_PREPROCESSED_GENES = 8000;

function formatSpeciesLabel(species: string) {
  return species
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatBaseGrnLabel(option: string) {
  if (option === "auto") return "Auto";
  if (option === "mouse_scATAC_atlas") return "Mouse scATAC atlas";
  return "Promoter base GRN";
}

interface DatasetSummary {
  dimensions: string;
  hasPseudotime: boolean;
  hasClusterLabels?: boolean;
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
  clusterLabelsFileName: string;
  geneCount: number | null;
  cellCount: number | null;
  isUploadingTempDataset: boolean;
  tempUploadId: string;
  topVariableGenes: string;
  includeAllTFs: boolean;
  normalizeEnabled: boolean;
  logTransformEnabled: boolean;
  cellOracleSpecies: string;
  cellOracleBaseGrn: string;
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
  setClusterLabelsFile: (file: File | null) => void;
  setClusterLabelsFileName: (value: string) => void;
  setTopVariableGenes: (value: string) => void;
  setIncludeAllTFs: (value: boolean) => void;
  setNormalizeEnabled: (value: boolean) => void;
  setLogTransformEnabled: (value: boolean) => void;
  setCellOracleSpecies: (value: string) => void;
  setCellOracleBaseGrn: (value: string) => void;
  clearExpressionFile: () => void;
  clearPseudotimeFile: () => void;
  clearClusterLabelsFile: () => void;
  setEnsembleEnabled: (value: boolean | ((current: boolean) => boolean)) => void;
}

export default function CreateProjectModal({
  isCreateVisible,
  isCreateClosing,
  projectName,
  projectDescription,
  expressionFileName,
  pseudotimeFileName,
  clusterLabelsFileName,
  geneCount,
  cellCount,
  isUploadingTempDataset,
  tempUploadId,
  topVariableGenes,
  includeAllTFs,
  normalizeEnabled,
  logTransformEnabled,
  cellOracleSpecies,
  cellOracleBaseGrn,
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
  setClusterLabelsFile,
  setClusterLabelsFileName,
  setTopVariableGenes,
  setIncludeAllTFs,
  setNormalizeEnabled,
  setLogTransformEnabled,
  setCellOracleSpecies,
  setCellOracleBaseGrn,
  clearExpressionFile,
  clearPseudotimeFile,
  clearClusterLabelsFile,
  setEnsembleEnabled,
}: CreateProjectModalProps) {
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSelectedDatasetRef = useRef<string | null>(null);
  const [isOutsideClosing, setIsOutsideClosing] = useState(false);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(true);
  const [isPreprocessingHelpOpen, setIsPreprocessingHelpOpen] = useState(false);
  const [isPreprocessingHelpClosing, setIsPreprocessingHelpClosing] = useState(false);
  const [algorithmDetailToShow, setAlgorithmDetailToShow] = useState<ProjectAlgorithm | null>(null);
  const [isAlgorithmDetailClosing, setIsAlgorithmDetailClosing] = useState(false);
  const algorithmDetailCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isModalClosing = isCreateClosing || isOutsideClosing;
  const hasExpressionFile = Boolean(expressionFileName);
  const compactExpressionFileName = formatFileNameForDisplay(expressionFileName, 38);
  const datasetReady = hasExpressionFile && tempUploadId.length > 0 && !isUploadingTempDataset;
  const maxTopVariableGenes =
    geneCount === null ? MAX_PREPROCESSED_GENES : Math.min(geneCount, MAX_PREPROCESSED_GENES);
  const cellOracleSelected = selectedIds.includes("CELLORACLE");
  const cellOracleBaseOptions = CELLORACLE_BASE_GRN_OPTIONS.filter(
    (option) => option !== "mouse_scATAC_atlas" || cellOracleSpecies === "mouse",
  );
  const cellOracleBaseValue = cellOracleBaseOptions.includes(
    cellOracleBaseGrn as (typeof CELLORACLE_BASE_GRN_OPTIONS)[number],
  )
    ? cellOracleBaseGrn
    : "auto";

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

  const selectPseudotimeFile = (file: File | null) => {
    setPseudotimeFile(file);
    setPseudotimeFileName(file?.name ?? "");
  };

  const handlePseudotimeDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0] ?? null;
    selectPseudotimeFile(file);
  };

  const selectClusterLabelsFile = (file: File | null) => {
    setClusterLabelsFile(file);
    setClusterLabelsFileName(file?.name ?? "");
  };

  const handleClusterLabelsDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0] ?? null;
    selectClusterLabelsFile(file);
  };

  useEffect(() => {
    if (isCreateVisible) {
      /* eslint-disable react-hooks/set-state-in-effect -- reset modal-local state on open */
      setIsOutsideClosing(false);
      setIsCustomizeOpen(true);
      setIsPreprocessingHelpOpen(false);
      setIsPreprocessingHelpClosing(false);
      setAlgorithmDetailToShow(null);
      setIsAlgorithmDetailClosing(false);
      /* eslint-enable react-hooks/set-state-in-effect */
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

    if (datasetSummary.hasClusterLabels) {
      settings.push("global and per-cluster scopes");
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
        className={`max-h-[calc(100vh-5rem)] w-full max-w-6xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-xl shadow-slate-900/15 lg:p-8 ${
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

        <div className="mt-6 space-y-5">
          <section className="rounded-[1.5rem] border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1b75a6]">
                  Inputs
                </p>
                <h3 className="mt-1 text-lg font-bold text-slate-950">
                  Dataset and CellOracle setup
                </h3>
              </div>
              {geneCount !== null && cellCount !== null && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                  {geneCount.toLocaleString()} genes x {cellCount.toLocaleString()} cells
                </span>
              )}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              <InputFileCard
                title="Expression matrix CSV"
                description="Rows = genes, columns = cells. First column = gene names."
                badge="Required"
                fileName={expressionFileName}
                placeholder="Drop expression matrix CSV here"
                onDrop={handleExpressionDrop}
                onSelect={selectExpressionFile}
                onClear={clearExpressionFile}
              >
                {hasExpressionFile && (
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {isUploadingTempDataset ? (
                      <span className="inline-flex items-center gap-2 font-bold text-slate-600">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-[#1b75a6]" />
                        Validating dataset
                      </span>
                    ) : datasetReady ? (
                      <span className="inline-flex min-w-0 max-w-full items-center gap-2 font-bold text-[#178a62]">
                        <span className="h-2 w-2 rounded-full bg-[#20b779]" />
                        <span className="min-w-0 max-w-full truncate" title={expressionFileName}>
                          {compactExpressionFileName}
                        </span>
                      </span>
                    ) : (
                      <span
                        className="min-w-0 max-w-full truncate font-bold text-slate-600"
                        title={expressionFileName}
                      >
                        {compactExpressionFileName}
                      </span>
                    )}
                  </div>
                )}
              </InputFileCard>

              <InputFileCard
                title="Pseudotime CSV"
                description="Cell IDs in the first column, trajectory values in the next columns."
                badge="Optional"
                fileName={pseudotimeFileName}
                placeholder="Drop pseudotime CSV here"
                onDrop={handlePseudotimeDrop}
                onSelect={selectPseudotimeFile}
                onClear={clearPseudotimeFile}
              />

              <InputFileCard
                title="Cluster labels CSV"
                description="Two columns: cell_id and cluster."
                badge="Optional"
                fileName={clusterLabelsFileName}
                placeholder="Drop cluster labels CSV here"
                onDrop={handleClusterLabelsDrop}
                onSelect={selectClusterLabelsFile}
                onClear={clearClusterLabelsFile}
              />

              <div className="flex h-full flex-col rounded-[1.25rem] border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-base font-bold text-slate-950">
                      CellOracle prior
                    </h4>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      Species and base GRN for CellOracle runs.
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-[0.12em] ${
                      cellOracleSelected
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-slate-50 text-slate-500"
                    }`}
                  >
                    {cellOracleSelected ? "Selected" : "Ready"}
                  </span>
                </div>

                <div className="mt-4 grid flex-1 content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <label className="block">
                    <span className="text-sm font-bold text-slate-950">Species</span>
                    <select
                      value={cellOracleSpecies}
                      onChange={(event) => {
                        const nextSpecies = event.target.value;
                        setCellOracleSpecies(nextSpecies);
                        if (
                          nextSpecies !== "mouse" &&
                          cellOracleBaseGrn === "mouse_scATAC_atlas"
                        ) {
                          setCellOracleBaseGrn("auto");
                        }
                      }}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
                    >
                      {CELLORACLE_SPECIES_OPTIONS.map((species) => (
                        <option key={species} value={species}>
                          {formatSpeciesLabel(species)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-sm font-bold text-slate-950">Base GRN</span>
                    <select
                      value={cellOracleBaseValue}
                      onChange={(event) => setCellOracleBaseGrn(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
                    >
                      {cellOracleBaseOptions.map((option) => (
                        <option key={option} value={option}>
                          {formatBaseGrnLabel(option)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1b75a6]">
                  Customize analysis
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
                {isCustomizeOpen ? "Hide customize" : "Show customize"}
              </button>
            </div>

            {isCustomizeOpen && (
              <div className="mt-5 space-y-5 border-t border-slate-100 pt-5">
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                      Project name
                    </span>
                    <input
                      id="projectName"
                      type="text"
                      value={projectName}
                      onChange={(event) => setProjectName(event.target.value)}
                      placeholder={
                        expressionFileName
                          ? expressionFileName.replace(/\.[^/.]+$/, "")
                          : "Project name"
                      }
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                      Description
                    </span>
                    <input
                      type="text"
                      value={projectDescription}
                      onChange={(event) => setProjectDescription(event.target.value)}
                      placeholder="Optional note"
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
                    />
                  </label>
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

                <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
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

                  <div className="mt-4 grid items-center gap-4 lg:grid-cols-[1.4fr_0.9fr_0.9fr_0.9fr]">
                    <div className="flex items-center gap-3">
                      <span className="whitespace-nowrap text-sm font-bold text-slate-950">
                        Gene filtering
                      </span>
                      <input
                        type="number"
                        min="1"
                        max={maxTopVariableGenes}
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
                          if (parsedValue > maxTopVariableGenes) {
                            setTopVariableGenes(String(maxTopVariableGenes));
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
            )}
          </section>

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

function InputFileCard({
  title,
  description,
  badge,
  fileName,
  placeholder,
  onDrop,
  onSelect,
  onClear,
  children,
}: {
  title: string;
  description: string;
  badge: "Required" | "Optional";
  fileName: string;
  placeholder: string;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onSelect: (file: File | null) => void;
  onClear: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-[1.25rem] border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-bold text-slate-950">{title}</h4>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-[0.12em] ${
                badge === "Required"
                  ? "border-[#1b75a6]/20 bg-[#f2f9fc] text-[#1b75a6]"
                  : "border-slate-200 bg-slate-50 text-slate-500"
              }`}
            >
              {badge}
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
        </div>
        {fileName && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          >
            Remove
          </button>
        )}
      </div>

      <label
        className="relative mt-4 flex min-h-24 flex-1 cursor-pointer flex-col items-center justify-center rounded-[1rem] border border-dashed border-[#1b75a6]/30 bg-[#f7fbff] px-4 py-5 text-center transition hover:border-[#1b75a6]/50 hover:bg-[#f2f9fc]"
        onDragEnter={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            onSelect(file);
          }}
        />
        <FileNameDisplay fileName={fileName} placeholder={placeholder} />
        <span className="mt-2 text-sm text-slate-500">
          {fileName ? "Click to replace" : "or click to browse"}
        </span>
      </label>

      {children ? <div className="mt-3 text-sm">{children}</div> : null}
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
