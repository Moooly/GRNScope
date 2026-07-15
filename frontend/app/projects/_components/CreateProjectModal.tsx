import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { ProjectAlgorithm } from "../page";
import AlgorithmSettingsPopover from "./AlgorithmSettingsPopover";
import AlgorithmStep from "./AlgorithmStep";
import FileNameDisplay, { formatFileNameForDisplay } from "./FileNameDisplay";

const MAX_PREPROCESSED_GENES = 8000;

const CELLORACLE_SPECIES_OPTIONS = [
  { value: "human", label: "Human" },
  { value: "mouse", label: "Mouse" },
  { value: "rat", label: "Rat" },
  { value: "pig", label: "Pig" },
  { value: "chicken", label: "Chicken" },
  { value: "zebrafish", label: "Zebrafish" },
  { value: "xenopus_tropicalis", label: "Xenopus tropicalis" },
  { value: "drosophila", label: "Drosophila" },
  { value: "c_elegans", label: "C. elegans" },
  { value: "s_cerevisiae", label: "S. cerevisiae" },
];

const SELECT_CONTROL_CLASS =
  "mt-2 flex items-center rounded-[1rem] border border-slate-200 bg-white px-4 py-2.5 shadow-sm transition focus-within:border-[#1b75a6]/40 focus-within:ring-4 focus-within:ring-[#1b75a6]/10";

const SELECT_INPUT_CLASS =
  "w-full appearance-none bg-transparent pr-7 text-sm font-medium text-slate-800 outline-none";

type CellOracleHelpTopic = "base-grn" | "cluster-labels";
type CellOracleBaseGrnSource = "built-in" | "upload";

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
  topVariableGenes: string;
  includeAllTFs: boolean;
  normalizeEnabled: boolean;
  logTransformEnabled: boolean;
  maxEdgesPerTarget: string;
  maxEdgesLimit: number;
  cellOracleSpecies: string;
  hasCellOracleSettingsConfigured: boolean;
  selectedIds: string[];
  algorithmParameters: Record<string, Record<string, unknown>>;
  onApplyAlgorithmParameters: (
    algorithmId: string,
    overrides: Record<string, unknown>,
  ) => void;
  compatibleAlgorithms: ProjectAlgorithm[];
  selectedAlgorithms: ProjectAlgorithm[];
  datasetSummary: DatasetSummary;
  errors: string[];
  isSubmitting: boolean;
  algorithms: ProjectAlgorithm[];
  isLoadingAlgorithms: boolean;
  algorithmLoadError: string | null;
  onClose: () => void;
  onStartAnalysis: () => void;
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
  setMaxEdgesPerTarget: (value: string) => void;
  setCellOracleSpecies: (value: string) => void;
  setHasCellOracleSettingsConfigured: (value: boolean) => void;
  clearPseudotimeFile: () => void;
  clearClusterLabelsFile: () => void;
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
  topVariableGenes,
  includeAllTFs,
  normalizeEnabled,
  logTransformEnabled,
  maxEdgesPerTarget,
  maxEdgesLimit,
  cellOracleSpecies,
  hasCellOracleSettingsConfigured,
  selectedIds,
  algorithmParameters,
  onApplyAlgorithmParameters,
  compatibleAlgorithms,
  selectedAlgorithms,
  datasetSummary,
  errors,
  isSubmitting,
  algorithms,
  isLoadingAlgorithms,
  algorithmLoadError,
  onClose,
  onStartAnalysis,
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
  setMaxEdgesPerTarget,
  setCellOracleSpecies,
  setHasCellOracleSettingsConfigured,
  clearPseudotimeFile,
  clearClusterLabelsFile,
}: CreateProjectModalProps) {
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSelectedDatasetRef = useRef<string | null>(null);
  const [isOutsideClosing, setIsOutsideClosing] = useState(false);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [isPreprocessingHelpOpen, setIsPreprocessingHelpOpen] = useState(false);
  const [isPreprocessingHelpClosing, setIsPreprocessingHelpClosing] = useState(false);
  const [isCellOracleSettingsOpen, setIsCellOracleSettingsOpen] = useState(false);
  const [isCellOracleSettingsClosing, setIsCellOracleSettingsClosing] = useState(false);
  const [cellOracleBaseGrnSource, setCellOracleBaseGrnSource] =
    useState<CellOracleBaseGrnSource>("built-in");
  const [cellOracleHelpTopic, setCellOracleHelpTopic] = useState<CellOracleHelpTopic | null>(null);
  const [isCellOracleHelpClosing, setIsCellOracleHelpClosing] = useState(false);
  const [algorithmToConfigure, setAlgorithmToConfigure] = useState<ProjectAlgorithm | null>(null);
  const [algorithmConfigureAnchor, setAlgorithmConfigureAnchor] =
    useState<HTMLButtonElement | null>(null);
  const cellOracleSettingsCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isModalClosing = isCreateClosing || isOutsideClosing;
  const hasExpressionFile = Boolean(expressionFileName);
  const compactExpressionFileName = formatFileNameForDisplay(expressionFileName, 38);
  const datasetReady = hasExpressionFile;
  const maxTopVariableGenes =
    geneCount === null ? MAX_PREPROCESSED_GENES : Math.min(geneCount, MAX_PREPROCESSED_GENES);

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

  const selectClusterLabelsFile = (file: File | null) => {
    setClusterLabelsFile(file);
    setClusterLabelsFileName(file?.name ?? "");
  };

  useEffect(() => {
    if (isCreateVisible) {
      /* eslint-disable react-hooks/set-state-in-effect -- reset modal-local state on open */
      setIsOutsideClosing(false);
      setIsCustomizeOpen(false);
      setIsPreprocessingHelpOpen(false);
      setIsPreprocessingHelpClosing(false);
      setIsCellOracleSettingsOpen(false);
      setIsCellOracleSettingsClosing(false);
      setCellOracleBaseGrnSource("built-in");
      setCellOracleHelpTopic(null);
      setIsCellOracleHelpClosing(false);
      setAlgorithmToConfigure(null);
      setAlgorithmConfigureAnchor(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      autoSelectedDatasetRef.current = null;
    }
  }, [isCreateVisible]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
      if (cellOracleSettingsCloseTimeoutRef.current) {
        clearTimeout(cellOracleSettingsCloseTimeoutRef.current);
      }
    };
  }, []);

  const handleConfigureAlgorithm = (
    algorithm: ProjectAlgorithm,
    anchorElement: HTMLButtonElement,
  ) => {
    setAlgorithmToConfigure(algorithm);
    setAlgorithmConfigureAnchor(anchorElement);
  };

  const handleCloseAlgorithmConfigure = useCallback(() => {
    setAlgorithmToConfigure(null);
    setAlgorithmConfigureAnchor(null);
  }, []);

  useEffect(() => {
    if (!datasetReady || isLoadingAlgorithms || compatibleAlgorithms.length === 0) {
      return;
    }

    const autoSelectKey = `${expressionFileName}:${datasetSummary.hasPseudotime ? "time" : "no-time"}`;

    if (autoSelectedDatasetRef.current === autoSelectKey) {
      return;
    }

    autoSelectedDatasetRef.current = autoSelectKey;
    onSelectAll();
  }, [
    compatibleAlgorithms.length,
    datasetReady,
    datasetSummary.hasPseudotime,
    expressionFileName,
    isLoadingAlgorithms,
    onSelectAll,
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

  const handleOpenCellOracleSettings = () => {
    if (cellOracleSettingsCloseTimeoutRef.current) {
      clearTimeout(cellOracleSettingsCloseTimeoutRef.current);
      cellOracleSettingsCloseTimeoutRef.current = null;
    }

    setIsCellOracleSettingsClosing(false);
    setIsCellOracleSettingsOpen(true);
  };

  const handleCloseCellOracleSettings = useCallback(() => {
    if (!isCellOracleSettingsOpen || isCellOracleSettingsClosing) return;

    setHasCellOracleSettingsConfigured(cellOracleBaseGrnSource === "built-in");
    setIsCellOracleSettingsClosing(true);

    if (cellOracleSettingsCloseTimeoutRef.current) {
      clearTimeout(cellOracleSettingsCloseTimeoutRef.current);
    }

    cellOracleSettingsCloseTimeoutRef.current = setTimeout(() => {
      setIsCellOracleSettingsOpen(false);
      setIsCellOracleSettingsClosing(false);
      cellOracleSettingsCloseTimeoutRef.current = null;
    }, 480);
  }, [
    cellOracleBaseGrnSource,
    isCellOracleSettingsClosing,
    isCellOracleSettingsOpen,
    setHasCellOracleSettingsConfigured,
  ]);

  const handleOpenCellOracleHelp = (topic: CellOracleHelpTopic) => {
    setIsCellOracleHelpClosing(false);
    setCellOracleHelpTopic(topic);
  };

  const handleCloseCellOracleHelp = useCallback(() => {
    if (!cellOracleHelpTopic || isCellOracleHelpClosing) return;

    setIsCellOracleHelpClosing(true);

    window.setTimeout(() => {
      setCellOracleHelpTopic(null);
      setIsCellOracleHelpClosing(false);
    }, 480);
  }, [cellOracleHelpTopic, isCellOracleHelpClosing]);

  useEffect(() => {
    if (!cellOracleHelpTopic) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleCloseCellOracleHelp();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cellOracleHelpTopic, handleCloseCellOracleHelp]);

  useEffect(() => {
    if (!isCellOracleSettingsOpen || cellOracleHelpTopic) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleCloseCellOracleSettings();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cellOracleHelpTopic, handleCloseCellOracleSettings, isCellOracleSettingsOpen]);

  if (!isCreateVisible) {
    return null;
  }

  const startDisabled =
    isSubmitting ||
    !hasExpressionFile ||
    selectedAlgorithms.length === 0 ||
    isLoadingAlgorithms;

  const willRunSummary = (() => {
    if (!hasExpressionFile) return "Upload an expression matrix to begin.";
    if (selectedAlgorithms.length === 0) return "No algorithms selected — open Advanced settings to choose at least one.";

    const algoLabel =
      selectedAlgorithms.length === 1
        ? `1 algorithm (${selectedAlgorithms[0].name})`
        : `${selectedAlgorithms.length} algorithms`;

    const settings: string[] = [];

    if (topVariableGenes.trim().toLowerCase() === "all") {
      settings.push("all genes retained");
    } else if (topVariableGenes && Number(topVariableGenes) > 0) {
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
      settings.push("cluster labels included");
    }

    // Removed ensembleEnabled block

    const settingsLabel = settings.length > 0 ? ` with ${settings.join(", ")}` : "";

    return `Will run ${algoLabel}${settingsLabel}.`;
  })();

  const cellOracleSpeciesLabel =
    CELLORACLE_SPECIES_OPTIONS.find((species) => species.value === cellOracleSpecies)?.label ??
    cellOracleSpecies;
  const cellOracleConfigLabel = hasCellOracleSettingsConfigured
    ? `${cellOracleBaseGrnSource === "built-in" ? `Built-in: ${cellOracleSpeciesLabel}` : "Custom GRN"}${
        clusterLabelsFileName ? " + labels" : ""
      }`
    : "";

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/45 px-4 py-10 backdrop-blur-sm sm:px-6 lg:py-14 ${
        isModalClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      onClick={
        isPreprocessingHelpOpen ||
        isCellOracleSettingsOpen ||
        cellOracleHelpTopic ||
        algorithmToConfigure
          ? undefined
          : handleOutsideClose
      }
    >
      <div
        data-create-project-modal
        className={`relative max-h-[calc(100vh-5rem)] w-full max-w-[56rem] overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 lg:p-8 ${
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
          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr] lg:items-stretch">
              <div>
                <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[#178a62]">
                  Required
                </span>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">
                  Expression matrix
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  CSV with rows = genes and columns = cells. This is the only required input before GRNScope can prepare an analysis.
                </p>
              </div>

              <label
                className="relative flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-[#1b75a6]/30 bg-[#f7fbff] px-6 py-10 text-center transition hover:border-[#1b75a6]/50 hover:bg-[#f2f9fc]"
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
                <FileNameDisplay
                  fileName={expressionFileName}
                  placeholder="Drop expression matrix CSV here"
                />
                <span className="mt-2 text-sm text-slate-500">
                  {expressionFileName ? "Click to replace" : "or click to browse"}
                </span>
              </label>
            </div>

            {hasExpressionFile && (
              <div className="mt-4 flex flex-wrap items-center gap-3 px-1 text-sm">
                {datasetReady ? (
                  <>
                    <span className="inline-flex min-w-0 max-w-full items-center gap-2 font-semibold text-[#178a62]">
                      <span className="h-2 w-2 rounded-full bg-[#20b779]" />
                      <span
                        className="min-w-0 max-w-full truncate"
                        title={expressionFileName}
                      >
                        {compactExpressionFileName}
                      </span>
                    </span>
                    {geneCount !== null && cellCount !== null && (
                      <span className="font-medium text-slate-700">
                        {geneCount.toLocaleString()} genes ×{" "}
                        {cellCount.toLocaleString()} cells
                      </span>
                    )}
                  </>
                ) : (
                  <span
                    className="min-w-0 max-w-full truncate font-medium text-slate-600"
                    title={expressionFileName}
                  >
                    {compactExpressionFileName}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1b75a6]">
                  Advanced settings
                </p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                  {willRunSummary}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCustomizeOpen((prev) => !prev)}
                className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                aria-expanded={isCustomizeOpen}
              >
                {isCustomizeOpen ? "Hide advanced ▴" : "Show advanced ▾"}
              </button>
            </div>
          </div>

          {isCustomizeOpen && (
            <div className="space-y-5 rounded-[1.5rem] border border-slate-200 bg-slate-50/40 p-5">
              <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-800">
                      Project name
                    </span>
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
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-800">
                      Description
                    </span>
                    <input
                      type="text"
                      value={projectDescription}
                      onChange={(event) => setProjectDescription(event.target.value)}
                      placeholder="Optional note for this analysis"
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
                    />
                  </label>
                </div>
              </div>

              <OptionalInputsPanel
                pseudotimeFileName={pseudotimeFileName}
                cellOracleConfigLabel={cellOracleConfigLabel}
                onSelectPseudotime={selectPseudotimeFile}
                onClearPseudotime={clearPseudotimeFile}
                onOpenCellOracleSettings={handleOpenCellOracleSettings}
              />

              <AlgorithmStep
                algorithms={algorithms}
                selectedIds={selectedIds}
                datasetSummary={datasetSummary}
                isLoadingAlgorithms={isLoadingAlgorithms}
                algorithmLoadError={algorithmLoadError}
                onToggleAlgorithm={onToggleAlgorithm}
                onConfigureAlgorithm={handleConfigureAlgorithm}
                customizedIds={Object.keys(algorithmParameters)}
              />

              <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-black">
                      Analysis settings
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

                <div className="mt-5 space-y-5">
                  <div className="grid items-center gap-6 sm:grid-cols-2">
                    <div className="flex items-center gap-3">
                      <span className="whitespace-nowrap text-sm font-semibold text-slate-950">
                        Gene filtering
                      </span>
                      <input
                        type="text"
                        value={topVariableGenes}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          if (nextValue === "") {
                            setTopVariableGenes("");
                            return;
                          }
                          if ("all".startsWith(nextValue.toLowerCase())) {
                            setTopVariableGenes(nextValue);
                            return;
                          }
                          const parsedValue = Number(nextValue);
                          if (
                            Number.isNaN(parsedValue) ||
                            !Number.isInteger(parsedValue) ||
                            parsedValue <= 0
                          ) {
                            return;
                          }
                          if (parsedValue > maxTopVariableGenes) {
                            setTopVariableGenes(String(maxTopVariableGenes));
                            return;
                          }
                          setTopVariableGenes(nextValue);
                        }}
                        onBlur={() => {
                          const normalizedValue = topVariableGenes.trim().toLowerCase();
                          if (normalizedValue === "") {
                            if (geneCount !== null && geneCount > 0) {
                              setTopVariableGenes(String(geneCount));
                            }
                            return;
                          }
                          if ("all".startsWith(normalizedValue)) {
                            setTopVariableGenes("all");
                          }
                        }}
                        aria-label="Gene filtering"
                        className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="whitespace-nowrap text-sm font-semibold text-slate-950">
                        Max edges per target
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={maxEdgesPerTarget}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          if (nextValue === "") {
                            setMaxEdgesPerTarget("");
                            return;
                          }
                          const parsedValue = Number(nextValue);
                          if (
                            Number.isNaN(parsedValue) ||
                            !Number.isInteger(parsedValue) ||
                            parsedValue < 1
                          ) {
                            return;
                          }
                          if (parsedValue > maxEdgesLimit) {
                            setMaxEdgesPerTarget(String(maxEdgesLimit));
                            return;
                          }
                          setMaxEdgesPerTarget(nextValue);
                        }}
                        onBlur={() => {
                          const trimmed = maxEdgesPerTarget.trim();
                          const parsed = Number(trimmed);
                          if (!trimmed || Number.isNaN(parsed) || parsed < 1) {
                            setMaxEdgesPerTarget(String(Math.min(20, maxEdgesLimit)));
                          }
                        }}
                        aria-label="Max edges per target"
                        className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
                      />
                    </div>
                  </div>

                  <div className="grid items-center gap-6 border-t border-slate-100 pt-5 sm:grid-cols-3">
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
              {isSubmitting ? "Uploading dataset..." : "Start analysis"}
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
                These settings control how the uploaded expression matrix is prepared for the selected GRN inference algorithms, and how the resulting network is filtered.
              </p>
              <div className="space-y-3">
                <p>
                  <span className="font-bold text-slate-950">Gene filtering:</span> defaults to the uploaded matrix gene count. Enter a smaller number when you want to retain only the most variable genes.
                </p>
                <p>
                  <span className="font-bold text-slate-950">Max edges per target:</span> the number of strongest regulators kept for each target gene in the final ranked network. Higher values give a denser network; the maximum adapts to your gene count (up to 100).
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

      <CellOracleHelpModal
        topic={cellOracleHelpTopic}
        isClosing={isCellOracleHelpClosing}
        onClose={handleCloseCellOracleHelp}
      />

      <CellOracleSettingsModal
        open={isCellOracleSettingsOpen}
        isClosing={isCellOracleSettingsClosing}
        baseGrnSource={cellOracleBaseGrnSource}
        cellOracleSpecies={cellOracleSpecies}
        clusterLabelsFileName={clusterLabelsFileName}
        onBaseGrnSourceChange={(value) => {
          setCellOracleBaseGrnSource(value);
          setHasCellOracleSettingsConfigured(value === "built-in");
        }}
        onSetCellOracleSpecies={(value) => {
          setHasCellOracleSettingsConfigured(true);
          setCellOracleSpecies(value);
        }}
        onSelectClusterLabels={(file) => {
          if (file && cellOracleBaseGrnSource === "built-in") {
            setHasCellOracleSettingsConfigured(true);
          }
          selectClusterLabelsFile(file);
        }}
        onClearClusterLabels={clearClusterLabelsFile}
        onShowHelp={handleOpenCellOracleHelp}
        onClose={handleCloseCellOracleSettings}
      />

      <AlgorithmSettingsPopover
        algorithm={algorithmToConfigure}
        anchorElement={algorithmConfigureAnchor}
        currentOverrides={
          algorithmToConfigure
            ? algorithmParameters[algorithmToConfigure.id] ?? {}
            : {}
        }
        onApply={onApplyAlgorithmParameters}
        onClose={handleCloseAlgorithmConfigure}
      />
    </div>
  );
}

function OptionalInputsPanel({
  pseudotimeFileName,
  cellOracleConfigLabel,
  onSelectPseudotime,
  onClearPseudotime,
  onOpenCellOracleSettings,
}: {
  pseudotimeFileName: string;
  cellOracleConfigLabel: string;
  onSelectPseudotime: (file: File | null) => void;
  onClearPseudotime: () => void;
  onOpenCellOracleSettings: () => void;
}) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">
            Optional inputs
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Add these inputs when you want to make more algorithms available.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <OptionalFileInputRow
          title="Pseudotime CSV"
          description="Used by trajectory-aware methods."
          fileName={pseudotimeFileName}
          uploadLabel={pseudotimeFileName ? "Replace" : "Upload"}
          onSelect={onSelectPseudotime}
          onClear={onClearPseudotime}
        />

        <div className="grid gap-3">
          <div className="grid gap-3 rounded-[1.25rem] border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div>
              <h4 className="text-base font-semibold text-slate-900">
                CellOracle inputs
              </h4>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                These settings apply only to CellOracle.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {cellOracleConfigLabel ? (
                <span
                  className="max-w-56 truncate rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-[#178a62]"
                  title={cellOracleConfigLabel}
                >
                  {cellOracleConfigLabel}
                </span>
              ) : null}
              <button
                type="button"
                onClick={onOpenCellOracleSettings}
                aria-haspopup="dialog"
                className="min-w-36 cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-center text-sm font-semibold text-[#1b75a6] transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc]"
              >
                Configure
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CellOracleSettingsModal({
  open,
  isClosing,
  baseGrnSource,
  cellOracleSpecies,
  clusterLabelsFileName,
  onBaseGrnSourceChange,
  onSetCellOracleSpecies,
  onSelectClusterLabels,
  onClearClusterLabels,
  onShowHelp,
  onClose,
}: {
  open: boolean;
  isClosing: boolean;
  baseGrnSource: CellOracleBaseGrnSource;
  cellOracleSpecies: string;
  clusterLabelsFileName: string;
  onBaseGrnSourceChange: (value: CellOracleBaseGrnSource) => void;
  onSetCellOracleSpecies: (value: string) => void;
  onSelectClusterLabels: (file: File | null) => void;
  onClearClusterLabels: () => void;
  onShowHelp: (topic: CellOracleHelpTopic) => void;
  onClose: () => void;
}) {
  const clusterLabelsInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const isBuiltInGrn = baseGrnSource === "built-in";

  return (
    <div
      className={`fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm ${
        isClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className={`max-h-[82vh] w-full max-w-3xl overflow-y-auto rounded-[1.75rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 ${
          isClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1b75a6]">
              CellOracle configuration
            </p>
            <h3 className="mt-2 text-xl font-bold text-slate-950">
              CellOracle inputs
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Choose a built-in species GRN, or upload your own TF-target prior once custom GRN upload is available.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-36 cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-center text-sm font-semibold text-[#1b75a6] transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc]"
          >
            Done
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
            <div className="inline-flex items-center gap-2">
              <h4 className="text-base font-semibold text-slate-900">
                Base GRN source
              </h4>
              <CellOracleHelpButton
                label="Base GRN CSV format"
                onClick={() => onShowHelp("base-grn")}
              />
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Built-in mode only needs species selection. GRNScope chooses the corresponding pre-built base GRN internally.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => onBaseGrnSourceChange("built-in")}
                className={`rounded-[0.875rem] px-3 py-2.5 text-sm font-semibold transition ${
                  isBuiltInGrn
                    ? "bg-white text-[#1b75a6] shadow-sm"
                    : "text-slate-500 hover:text-[#1b75a6]"
                }`}
                aria-pressed={isBuiltInGrn}
              >
                Built-in GRN
              </button>
              <button
                type="button"
                onClick={() => onBaseGrnSourceChange("upload")}
                className={`rounded-[0.875rem] px-3 py-2.5 text-sm font-semibold transition ${
                  !isBuiltInGrn
                    ? "bg-white text-[#1b75a6] shadow-sm"
                    : "text-slate-500 hover:text-[#1b75a6]"
                }`}
                aria-pressed={!isBuiltInGrn}
              >
                Upload GRN
              </button>
            </div>

            {isBuiltInGrn ? (
              <label className="mt-4 block">
                <span className="text-sm font-semibold text-slate-800">
                  Species
                </span>
                <span className={SELECT_CONTROL_CLASS}>
                  <select
                    value={cellOracleSpecies}
                    onChange={(event) => onSetCellOracleSpecies(event.target.value)}
                    className={SELECT_INPUT_CLASS}
                  >
                    {CELLORACLE_SPECIES_OPTIONS.map((species) => (
                      <option key={species.value} value={species.value}>
                        {species.label}
                      </option>
                    ))}
                  </select>
                  <span className="-ml-5 text-sm text-slate-500" aria-hidden="true">
                    ▾
                  </span>
                </span>
              </label>
            ) : (
              <div
                className="mt-4 flex min-h-28 flex-col items-center justify-center rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-slate-400"
                aria-disabled="true"
              >
                <span className="text-sm font-semibold">
                  Upload base GRN CSV
                </span>
                <span className="mt-1 text-xs">
                  Coming soon
                </span>
              </div>
            )}
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div>
                <div className="inline-flex items-center gap-2">
                  <h4 className="text-base font-semibold text-slate-900">
                    Cell grouping
                  </h4>
                  <CellOracleHelpButton
                    label="Cluster labels CSV format"
                    onClick={() => onShowHelp("cluster-labels")}
                  />
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Add cluster labels for cluster-specific networks. Leave empty for one global network.
                </p>
              </div>
              <input
                ref={clusterLabelsInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  onSelectClusterLabels(file);
                  event.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => clusterLabelsInputRef.current?.click()}
                className="min-w-36 cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#1b75a6] transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc]"
              >
                {clusterLabelsFileName ? "Replace labels" : "Add labels"}
              </button>
            </div>

            {clusterLabelsFileName && (
              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-sky-100 bg-[#f7fbff] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#1b75a6] shadow-sm ring-1 ring-sky-100" aria-hidden="true">
                    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
                      <path d="M5 2.75h6l4 4v10.5H5V2.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                      <path d="M11 2.75v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900" title={clusterLabelsFileName}>
                      {formatFileNameForDisplay(clusterLabelsFileName, 52)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">Cluster labels CSV selected</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClearClusterLabels}
                  className="self-start text-xs font-semibold text-slate-500 transition hover:text-rose-600 sm:self-auto"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OptionalFileInputRow({
  title,
  description,
  fileName,
  uploadLabel,
  onSelect,
  onClear,
}: {
  title: string;
  description: string;
  fileName: string;
  uploadLabel: string;
  onSelect: (file: File | null) => void;
  onClear: () => void;
}) {
  const compactFileName = formatFileNameForDisplay(fileName, 28);

  return (
    <div className="grid gap-3 rounded-[1.25rem] border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div>
        <h4 className="text-base font-semibold text-slate-900">{title}</h4>
        <p className="mt-1 text-sm leading-5 text-slate-600">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {fileName ? (
          <span
            className="max-w-56 truncate rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-[#178a62]"
            title={fileName}
          >
            {compactFileName}
          </span>
        ) : null}
        <label className="min-w-36 cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-center text-sm font-semibold text-[#1b75a6] transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc]">
          {uploadLabel}
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              onSelect(file);
              event.target.value = "";
            }}
          />
        </label>
        {fileName ? (
          <button
            type="button"
            onClick={onClear}
            className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CellOracleHelpButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-[#1b75a6]/25 bg-[#f2f9fc] text-xs font-bold text-[#1b75a6] transition hover:border-[#1b75a6]/40 hover:bg-[#e8f5fb] focus:outline-none focus:ring-4 focus:ring-[#1b75a6]/10"
    >
      ?
    </button>
  );
}

function CellOracleHelpModal({
  topic,
  isClosing,
  onClose,
}: {
  topic: CellOracleHelpTopic | null;
  isClosing: boolean;
  onClose: () => void;
}) {
  if (!topic) return null;

  const isBaseGrn = topic === "base-grn";
  const title = isBaseGrn
    ? "Custom base GRN CSV format"
    : "Cluster labels CSV format";
  const eyebrow = isBaseGrn ? "CellOracle base GRN" : "CellOracle grouping";

  return (
    <div
      className={`fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm ${
        isClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className={`max-h-[76vh] w-full max-w-xl overflow-y-auto rounded-[1.75rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 ${
          isClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1b75a6]">
            {eyebrow}
          </p>
          <h3 className="mt-2 text-xl font-bold text-slate-950">{title}</h3>
        </div>

        {isBaseGrn ? (
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h4 className="text-sm font-bold text-slate-950">What this file means</h4>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                A custom base GRN is a TF-target prior. Each row says that a transcription factor is allowed to regulate a target gene before CellOracle fits the network from expression data.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h4 className="text-sm font-bold text-slate-950">Example CSV</h4>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Use one row per candidate edge. Recommended columns are source and target.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs leading-6 text-slate-700">{`source,target
GATA1,KLF1
TAL1,MYB
SPI1,CEBPA`}</pre>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h4 className="text-sm font-bold text-slate-950">What this file means</h4>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Cluster labels split cells into groups so CellOracle can infer cluster-specific networks. Leave this empty to run one global CellOracle network.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h4 className="text-sm font-bold text-slate-950">Example CSV</h4>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Use one row per cell. Cell IDs must match the expression matrix columns, and every expression-matrix cell should appear exactly once.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs leading-6 text-slate-700">{`cell_id,cluster
AAACCTGAGACT,erythroid
AAACCTGCATGA,myeloid
AAACGGGTCCTA,erythroid`}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AdditionalInputCard({
  title,
  badge,
  fileName,
  placeholder,
  helperText,
  minHeightClassName = "min-h-28",
  compact = false,
  stretchDropZone = false,
  onDrop,
  onSelect,
  onClear,
}: {
  title: string;
  badge?: string;
  fileName: string;
  placeholder: string;
  helperText: string;
  minHeightClassName?: string;
  compact?: boolean;
  stretchDropZone?: boolean;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onSelect: (file: File | null) => void;
  onClear: () => void;
}) {
  const dropZone = (
    <label
      className={`relative flex ${minHeightClassName} ${
        stretchDropZone ? "h-full flex-1" : ""
      } cursor-pointer flex-col items-center justify-center rounded-[1.25rem] border border-dashed border-[#1b75a6]/30 bg-[#f7fbff] px-4 py-4 text-center transition hover:border-[#1b75a6]/50 hover:bg-[#f2f9fc]`}
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
      <span className="mt-1 text-xs text-slate-500">
        {fileName ? "Click to replace" : helperText}
      </span>
    </label>
  );

  if (compact) {
    return (
      <div className="space-y-2">
        {dropZone}
        {fileName ? (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-semibold text-slate-500 transition hover:text-rose-600"
          >
            Remove file
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm ${
        stretchDropZone ? "flex h-full flex-col" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
        {badge ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
            {badge}
          </span>
        ) : null}
      </div>
      <div className={stretchDropZone ? "mt-4 flex flex-1" : "mt-4"}>
        {dropZone}
      </div>
      {fileName ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-3 text-xs font-semibold text-slate-500 transition hover:text-rose-600"
        >
          Remove file
        </button>
      ) : null}
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
