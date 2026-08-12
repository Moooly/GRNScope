import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DragEvent, ReactNode } from "react";
import type { ProjectAlgorithm } from "../page";
import AlgorithmStep from "./AlgorithmStep";
import FileNameDisplay, { formatFileNameForDisplay } from "./FileNameDisplay";

const EMPTY_ALGORITHM_PARAMETER_VALUES: Record<string, unknown> = {};

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

const DATASET_SPECIES_OPTIONS = [
  ...CELLORACLE_SPECIES_OPTIONS,
  { value: "other", label: "Other / Not listed" },
];

const MATRIX_STATE_OPTIONS = [
  { value: "raw", label: "Raw counts" },
  { value: "normalized", label: "Normalized" },
  { value: "log_normalized", label: "Log-normalized" },
] as const;

const CUSTOM_TF_LIST_SAMPLE = `gene_symbol,reference_gene_id
TP53,ENSG00000141510
MYC,ENSG00000136997
`;

type CellOracleHelpTopic = "base-grn" | "cluster-labels";
type CellOracleBaseGrnSource = "built-in" | "upload";
type AdvancedSection = "genes" | "inputs" | "algorithms" | "results";
export type GeneSelectionStage = "detection" | "trajectory" | "variance";

interface DatasetSummary {
  dimensions: string;
  hasPseudotime: boolean;
  hasClusterLabels?: boolean;
  hasGroundTruth: boolean;
  preprocessingSummary: string[];
}

// A small, editable "detected fact" chip. Shows the auto-detected value quietly
// and opens a popover to change it; when nothing is set yet it becomes an accent
// prompt so the user knows to confirm it. Used for species and matrix values so
// both stay lightweight but correctable — the "upload and go" path.
function EditableChip({
  value,
  options,
  onChange,
  unsetLabel,
  ariaLabel,
  detecting = false,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  unsetLabel: string;
  ariaLabel: string;
  detecting?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Position the menu in a portal (document.body) so it escapes the matrix
  // card's overflow-hidden and the scroll container — otherwise it gets clipped.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setMenuPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    };
    place();
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (detecting) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-400">
        <span className="h-2 w-2 animate-pulse rounded-full bg-slate-300" aria-hidden="true" />
        {unsetLabel === "Confirm values" ? "Inspecting…" : "Detecting…"}
      </span>
    );
  }

  const current = options.find((option) => option.value === value);

  return (
    <span className="inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold transition ${
          current
            ? "border-slate-200 bg-white text-slate-700 hover:border-[#1b75a6]/40 hover:text-[#155f87]"
            : "border-[#1b75a6]/50 bg-[#eef7fc] text-[#1b75a6] hover:bg-[#e2f1fa]"
        }`}
      >
        {current ? current.label : unsetLabel}
        <span aria-hidden="true" className="text-[0.6em] opacity-70">
          ▼
        </span>
      </button>
      {open && menuPos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={{
                position: "fixed",
                top: menuPos.top,
                left: menuPos.left,
                minWidth: Math.max(menuPos.width, 176),
                zIndex: 200,
              }}
              className="max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-left shadow-xl shadow-slate-950/10"
            >
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm font-medium transition ${
                    option.value === value
                      ? "bg-[#eef7fc] text-[#155f87]"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

interface CreateProjectModalProps {
  isCreateVisible: boolean;
  isCreateClosing: boolean;
  projectName: string;
  expressionFileName: string;
  expressionMatrixDimensions: string | null;
  pseudotimeFileName: string;
  groundTruthFileName: string;
  clusterLabelsFileName: string;
  matrixState: string;
  setMatrixState: (value: string) => void;
  isMatrixStateDetecting: boolean;
  datasetSpecies: string;
  isSpeciesDetecting: boolean;
  customTfListFileName: string;
  detectionThreshold: string;
  enabledGeneSelectionStages: GeneSelectionStage[];
  hvgGeneCount: string;
  geneOrderingSource: "calculate" | "upload";
  geneOrderingFileName: string;
  trajectoryPValue: string;
  trajectoryBonferroni: boolean;
  includeSignificantTFs: boolean;
  includeAllTFs: boolean;
  maxEdgesPerTarget: string;
  maxEdgesLimit: number;
  confidenceRunMode: "automatic" | "fixed";
  confidenceBootstrapRuns: string;
  confidenceRunMin: number;
  confidenceRunMax: number;
  pidcDefaultMaxGenes: number;
  sinceritiesDefaultMaxGenes: number;
  scribeDefaultMaxGenes: number;
  singeDefaultMaxGenes: number;
  grnvbemDefaultMaxGenes: number;
  grisliDefaultMaxGenes: number;
  cellOracleSpecies: string;
  hasCellOracleSettingsConfigured: boolean;
  estimatePseudotime: boolean;
  onToggleEstimatePseudotime: (value: boolean) => void;
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
  onRetryAlgorithms: () => void;
  onClose: () => void;
  onStartAnalysis: () => void;
  onSelectAll: () => void;
  onToggleAlgorithm: (algorithmId: string, disabled: boolean) => void;
  setProjectName: (value: string) => void;
  setDatasetSpecies: (value: string) => void;
  setCustomTfListFile: (file: File | null) => void;
  setCustomTfListFileName: (value: string) => void;
  setDetectionThreshold: (value: string) => void;
  setEnabledGeneSelectionStages: (value: GeneSelectionStage[]) => void;
  setHvgGeneCount: (value: string) => void;
  setGeneOrderingSource: (value: "calculate" | "upload") => void;
  setGeneOrderingFile: (file: File | null) => void;
  setGeneOrderingFileName: (value: string) => void;
  setTrajectoryPValue: (value: string) => void;
  setTrajectoryBonferroni: (value: boolean) => void;
  setIncludeSignificantTFs: (value: boolean) => void;
  setExpressionFile: (file: File | null) => void;
  setExpressionFileName: (value: string) => void;
  setPseudotimeFile: (file: File | null) => void;
  setPseudotimeFileName: (value: string) => void;
  setGroundTruthFile: (file: File | null) => void;
  setGroundTruthFileName: (value: string) => void;
  setClusterLabelsFile: (file: File | null) => void;
  setClusterLabelsFileName: (value: string) => void;
  setIncludeAllTFs: (value: boolean) => void;
  setMaxEdgesPerTarget: (value: string) => void;
  setConfidenceRunMode: (value: "automatic" | "fixed") => void;
  setConfidenceBootstrapRuns: (value: string) => void;
  setHasCellOracleSettingsConfigured: (value: boolean) => void;
  clearPseudotimeFile: () => void;
  clearGroundTruthFile: () => void;
  clearClusterLabelsFile: () => void;
}

export default function CreateProjectModal({
  isCreateVisible,
  isCreateClosing,
  projectName,
  expressionFileName,
  expressionMatrixDimensions,
  pseudotimeFileName,
  groundTruthFileName,
  clusterLabelsFileName,
  matrixState,
  setMatrixState,
  isMatrixStateDetecting,
  datasetSpecies,
  isSpeciesDetecting,
  customTfListFileName,
  detectionThreshold,
  enabledGeneSelectionStages,
  hvgGeneCount,
  geneOrderingSource,
  geneOrderingFileName,
  trajectoryPValue,
  trajectoryBonferroni,
  includeSignificantTFs,
  includeAllTFs,
  maxEdgesPerTarget,
  maxEdgesLimit,
  confidenceRunMode,
  confidenceBootstrapRuns,
  confidenceRunMin,
  confidenceRunMax,
  pidcDefaultMaxGenes,
  sinceritiesDefaultMaxGenes,
  scribeDefaultMaxGenes,
  singeDefaultMaxGenes,
  grnvbemDefaultMaxGenes,
  grisliDefaultMaxGenes,
  cellOracleSpecies,
  hasCellOracleSettingsConfigured,
  estimatePseudotime,
  onToggleEstimatePseudotime,
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
  onRetryAlgorithms,
  onClose,
  onStartAnalysis,
  onSelectAll,
  onToggleAlgorithm,
  setProjectName,
  setDatasetSpecies,
  setCustomTfListFile,
  setCustomTfListFileName,
  setDetectionThreshold,
  setEnabledGeneSelectionStages,
  setHvgGeneCount,
  setGeneOrderingSource,
  setGeneOrderingFile,
  setGeneOrderingFileName,
  setTrajectoryPValue,
  setTrajectoryBonferroni,
  setIncludeSignificantTFs,
  setExpressionFile,
  setExpressionFileName,
  setPseudotimeFile,
  setPseudotimeFileName,
  setGroundTruthFile,
  setGroundTruthFileName,
  setClusterLabelsFile,
  setClusterLabelsFileName,
  setIncludeAllTFs,
  setMaxEdgesPerTarget,
  setConfidenceRunMode,
  setConfidenceBootstrapRuns,
  setHasCellOracleSettingsConfigured,
  clearPseudotimeFile,
  clearGroundTruthFile,
  clearClusterLabelsFile,
}: CreateProjectModalProps) {
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSelectedDatasetRef = useRef<string | null>(null);
  const [isOutsideClosing, setIsOutsideClosing] = useState(false);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [isCustomTfHelpOpen, setIsCustomTfHelpOpen] = useState(false);
  const [openAdvancedSection, setOpenAdvancedSection] =
    useState<AdvancedSection | null>(null);
  const [cellOracleBaseGrnSource, setCellOracleBaseGrnSource] =
    useState<CellOracleBaseGrnSource>("built-in");
  const [cellOracleHelpTopic, setCellOracleHelpTopic] = useState<CellOracleHelpTopic | null>(null);
  const [isCellOracleHelpClosing, setIsCellOracleHelpClosing] = useState(false);
  const [expandedAlgorithmId, setExpandedAlgorithmId] = useState<string | null>(null);
  const [isConfidenceStrategyOpen, setIsConfidenceStrategyOpen] = useState(false);
  const getAlgorithmContextualDefaults = useCallback(
    (algorithmId: string): Record<string, unknown> => {
      if (algorithmId === "PIDC") return { maxGenes: pidcDefaultMaxGenes };
      if (algorithmId === "SINCERITIES") return { maxGenes: sinceritiesDefaultMaxGenes };
      if (algorithmId === "SCRIBE") return { maxGenes: scribeDefaultMaxGenes };
      if (algorithmId === "SINGE") return { maxGenes: singeDefaultMaxGenes };
      if (algorithmId === "GRNVBEM") return { maxGenes: grnvbemDefaultMaxGenes };
      if (algorithmId === "GRISLI") return { maxGenes: grisliDefaultMaxGenes };
      return EMPTY_ALGORITHM_PARAMETER_VALUES;
    },
    [
      pidcDefaultMaxGenes,
      sinceritiesDefaultMaxGenes,
      scribeDefaultMaxGenes,
      singeDefaultMaxGenes,
      grnvbemDefaultMaxGenes,
      grisliDefaultMaxGenes,
    ],
  );
  const isModalClosing = isCreateClosing || isOutsideClosing;
  const hasExpressionFile = Boolean(expressionFileName);

  const selectExpressionFile = (file: File | null) => {
    if (!file && expressionFileName) {
      const previousBaseName = expressionFileName.replace(/\.csv$/i, "").trim();
      if (projectName.trim() === previousBaseName) {
        setProjectName("");
      }
      setIsCustomizeOpen(false);
      setOpenAdvancedSection(null);
    }
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

  const selectGroundTruthFile = (file: File | null) => {
    setGroundTruthFile(file);
    setGroundTruthFileName(file?.name ?? "");
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
      setIsCustomTfHelpOpen(false);
      setOpenAdvancedSection(null);
      setCellOracleBaseGrnSource("built-in");
      setCellOracleHelpTopic(null);
      setIsCellOracleHelpClosing(false);
      setExpandedAlgorithmId(null);
      setIsConfidenceStrategyOpen(false);
      setEnabledGeneSelectionStages(["detection"]);
      /* eslint-enable react-hooks/set-state-in-effect */
      autoSelectedDatasetRef.current = null;
    }
  }, [isCreateVisible, setEnabledGeneSelectionStages]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const handleToggleAlgorithmExpanded = useCallback((algorithmId: string) => {
    setExpandedAlgorithmId((current) => (current === algorithmId ? null : algorithmId));
  }, []);

  useEffect(() => {
    if (expandedAlgorithmId && !selectedIds.includes(expandedAlgorithmId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- collapse when the expanded algorithm is deselected
      setExpandedAlgorithmId(null);
    }
  }, [expandedAlgorithmId, selectedIds]);

  useEffect(() => {
    if (!hasExpressionFile || isLoadingAlgorithms || compatibleAlgorithms.length === 0) {
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
    hasExpressionFile,
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

  if (!isCreateVisible) {
    return null;
  }

  const startDisabled =
    isSubmitting ||
    !hasExpressionFile ||
    isMatrixStateDetecting ||
    !matrixState ||
    !datasetSpecies ||
    selectedAlgorithms.length === 0 ||
    isLoadingAlgorithms;

  const startHint = !hasExpressionFile
    ? "Upload an expression matrix to continue."
    : isMatrixStateDetecting
      ? "Inspecting the expression matrix…"
      : !matrixState
        ? "This matrix could not be prepared automatically."
        : !datasetSpecies
          ? "Select a species to continue."
          : isLoadingAlgorithms
            ? "Loading compatible algorithms…"
            : selectedAlgorithms.length === 0
              ? "Select at least one algorithm to continue."
              : null;

  const willRunSummary = (() => {
    if (!hasExpressionFile) {
      return "Upload a matrix to configure";
    }
    const selectionLabels = [
      enabledGeneSelectionStages.includes("detection")
        ? `Detection ≥${detectionThreshold || "—"}%`
        : null,
      enabledGeneSelectionStages.includes("trajectory")
        ? "trajectory-aware"
        : null,
      enabledGeneSelectionStages.includes("variance")
        ? `top ${hvgGeneCount || "—"} by variance`
        : null,
    ].filter((label): label is string => label !== null);
    const algorithmLabel =
      selectedAlgorithms.length === 1
        ? "1 algorithm"
        : `${selectedAlgorithms.length} algorithms`;
    return `${selectionLabels.length ? selectionLabels.join(" → ") : "No gene filtering"} • ${algorithmLabel}`;
  })();

  const cellOracleSpeciesLabel =
    CELLORACLE_SPECIES_OPTIONS.find((species) => species.value === cellOracleSpecies)?.label ??
    cellOracleSpecies;
  const cellOracleConfigLabel = hasCellOracleSettingsConfigured
    ? `${cellOracleBaseGrnSource === "built-in" ? `Built-in: ${cellOracleSpeciesLabel}` : "Custom GRN"}${
        clusterLabelsFileName ? " + labels" : ""
      }`
    : "";
  const geneSelectionSummary = [
    enabledGeneSelectionStages.includes("detection")
      ? `Detection ≥${detectionThreshold || "—"}%`
      : null,
    enabledGeneSelectionStages.includes("trajectory")
      ? "Trajectory-aware"
      : null,
    enabledGeneSelectionStages.includes("variance")
      ? `Top ${hvgGeneCount || "—"} by variance`
      : null,
  ]
    .filter((label): label is string => label !== null)
    .join(" · ") || "No gene filtering";
  const optionalInputsSummary = [
    pseudotimeFileName
      ? "Pseudotime uploaded"
      : estimatePseudotime
        ? "Pseudotime will be estimated"
        : "No pseudotime",
    groundTruthFileName ? "Ground truth uploaded" : "No ground truth",
    hasCellOracleSettingsConfigured
      ? "CellOracle configured"
      : "CellOracle not configured",
  ].join(" · ");
  const unavailableAlgorithmCount = Math.max(
    0,
    algorithms.length - compatibleAlgorithms.length,
  );
  const algorithmSectionSummary = `${selectedAlgorithms.length} selected · ${unavailableAlgorithmCount} unavailable`;
  const resultSettingsSummary =
    confidenceRunMode === "fixed"
      ? `${maxEdgesPerTarget || "—"} edges per target · ${confidenceBootstrapRuns || "—"} confidence runs`
      : `${maxEdgesPerTarget || "—"} edges per target · Automatic confidence`;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-10 backdrop-blur-sm sm:px-6 lg:py-14 ${
        isModalClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      onClick={cellOracleHelpTopic ? undefined : handleOutsideClose}
    >
      <div
        data-create-project-modal
        className={`relative flex max-h-[calc(100vh-5rem)] w-full max-w-[48rem] flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 transition-[height] duration-300 ease-out lg:p-8 ${
          isModalClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6">
          <h2 className="text-2xl font-bold tracking-tight text-slate-950">
            Start an analysis
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 -mt-2 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-lg leading-none text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close create analysis dialog"
          >
            ×
          </button>
        </div>

        <div className="mt-5 min-h-0 flex-1 scroll-pb-6 space-y-5 overflow-y-auto pb-2 pr-4 [scrollbar-gutter:stable]">
          <div>
            {expressionFileName ? (
              <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60">
                <div className="flex min-h-28 items-center justify-between gap-5 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1b75a6]">
                      Expression matrix
                    </p>
                    <p
                      className="mt-1 truncate text-sm font-semibold text-slate-800"
                      title={expressionFileName}
                    >
                      {formatFileNameForDisplay(expressionFileName, 42)}
                    </p>
                    {/* Keep detected facts compact and editable. Species gets a
                        lightweight required cue until the user confirms it. */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs font-medium text-slate-500">
                      {expressionMatrixDimensions !== null ? (
                        <>
                          <span className="font-semibold text-slate-600">
                            {expressionMatrixDimensions}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                        </>
                      ) : null}
                      <span className="relative inline-flex">
                        {!datasetSpecies && !isSpeciesDetecting ? (
                          <span
                            aria-hidden="true"
                            className="absolute -right-0.5 -top-0.5 z-10 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-slate-50"
                          />
                        ) : null}
                        <EditableChip
                          value={datasetSpecies}
                          options={DATASET_SPECIES_OPTIONS}
                          onChange={setDatasetSpecies}
                          unsetLabel="Choose species"
                          ariaLabel="Dataset species, required"
                          detecting={isSpeciesDetecting && !datasetSpecies}
                        />
                      </span>
                      <EditableChip
                        value={matrixState}
                        options={MATRIX_STATE_OPTIONS}
                        onChange={setMatrixState}
                        unsetLabel="Confirm values"
                        ariaLabel="Matrix values"
                        detecting={isMatrixStateDetecting && !matrixState}
                      />
                    </div>
                    {!datasetSpecies && !isSpeciesDetecting ? (
                      <p className="mt-2 text-[11px] font-medium leading-4 text-[#1b75a6]">
                        <span>
                          <span className="font-semibold">Choose a species</span>{" "}
                          to continue to analysis
                        </span>
                      </p>
                    ) : (
                      <p className="mt-2 text-[11px] leading-4 text-slate-400">
                        Auto-detected from your matrix — click a chip to change.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <label className="cursor-pointer text-sm font-semibold text-[#1b75a6] transition hover:text-[#155f87]">
                      Replace
                      <input
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          selectExpressionFile(file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => selectExpressionFile(null)}
                      className="cursor-pointer text-sm font-medium text-slate-500 transition hover:text-rose-600"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {datasetSpecies === "other" ? (
                  <div className="border-t border-slate-200 bg-white/70 px-6 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-800">
                            TF list
                          </p>
                          <CellOracleHelpButton
                            label="Transcription factor list CSV format"
                            onClick={() =>
                              setIsCustomTfHelpOpen((current) => !current)
                            }
                            expanded={isCustomTfHelpOpen}
                            controls="custom-tf-list-format"
                          />
                        </div>
                        {customTfListFileName ? (
                          <p
                            className="mt-1 max-w-[28rem] truncate text-xs font-medium text-slate-500"
                            title={customTfListFileName}
                          >
                            {formatFileNameForDisplay(customTfListFileName, 52)}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {customTfListFileName ? (
                          <button
                            type="button"
                            onClick={() => {
                              setCustomTfListFile(null);
                              setCustomTfListFileName("");
                            }}
                            className="text-xs font-semibold text-slate-500 transition hover:text-slate-800"
                          >
                            Remove
                          </button>
                        ) : null}
                        <label className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-[#1b75a6] transition hover:border-[#1b75a6]/35 hover:bg-[#f6fbfe]">
                          {customTfListFileName ? "Replace" : "Choose CSV"}
                          <input
                            type="file"
                            accept=".csv,text/csv"
                            className="sr-only"
                            onChange={(event) => {
                              const file = event.target.files?.[0] ?? null;
                              setCustomTfListFile(file);
                              setCustomTfListFileName(file?.name ?? "");
                              event.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    </div>
                    {isCustomTfHelpOpen ? (
                      <div
                        id="custom-tf-list-format"
                        className="mt-3 rounded-xl border border-[#1b75a6]/15 bg-[#f7fbfd] px-3.5 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <p className="max-w-md text-xs leading-5 text-slate-600">
                            Use one TF per row.{" "}
                            <code className="font-semibold">gene_symbol</code>{" "}
                            is required;{" "}
                            <code className="font-semibold">
                              reference_gene_id
                            </code>{" "}
                            is optional.
                          </p>
                          <a
                            href={`data:text/csv;charset=utf-8,${encodeURIComponent(
                              CUSTOM_TF_LIST_SAMPLE,
                            )}`}
                            download="custom_tf_list_example.csv"
                            className="shrink-0 text-xs font-semibold text-[#1b75a6] transition hover:text-[#145b82]"
                          >
                            Download sample
                          </a>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <label
                className="relative flex min-h-40 min-w-0 cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-[#1b75a6]/30 bg-[#f7fbff] px-6 py-6 text-center transition hover:border-[#1b75a6]/50 hover:bg-[#f2f9fc]"
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
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#e6f2fa] text-[#1b75a6]">
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                    <path
                      d="M12 15V4m0 0 4 4m-4-4-4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div>
                  <FileNameDisplay
                    fileName=""
                    placeholder="Drop expression matrix CSV here"
                  />
                  <span className="mt-1.5 block text-xs text-slate-500">
                    or click to browse
                    <span className="mx-2 text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-400">
                      Rows = genes; columns = cells
                    </span>
                  </span>
                </div>
              </label>
            )}
          </div>

          {/* Only after upload — it is auto-filled from that file, so there is
              nothing to name before one exists. */}
          {expressionFileName ? (
            <label className="block">
              <span className="text-sm font-semibold text-slate-800">
                Analysis name
              </span>
              <input
                id="projectName"
                type="text"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Auto-filled from uploaded expression matrix"
                className="mt-1.5 w-full border-0 border-b border-slate-200 bg-transparent px-0 py-2.5 text-sm font-medium text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-[#1b75a6]"
              />
            </label>
          ) : null}

          <div className="pt-5">
            <div
              className={`flex flex-wrap items-center justify-between gap-4 rounded-xl px-4 py-3 ${
                hasExpressionFile ? "bg-slate-50/80" : "bg-slate-50/55"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1b75a6]">
                  Advanced settings
                </p>
                <p className="mt-1 text-sm font-medium leading-5 text-slate-600">
                  {willRunSummary}
                </p>
              </div>
              <button
                type="button"
                disabled={!hasExpressionFile}
                onClick={() => {
                  if (isCustomizeOpen) setOpenAdvancedSection(null);
                  setIsCustomizeOpen((prev) => !prev);
                }}
                className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:border-slate-200"
                aria-expanded={isCustomizeOpen}
              >
                {isCustomizeOpen ? "Hide advanced ▴" : "Show advanced ▾"}
              </button>
            </div>
          </div>

          {isCustomizeOpen && (
            <div className="rounded-[1.25rem] border border-slate-200 bg-white">
              <AdvancedAccordionSection
                title="Gene selection"
                summary={geneSelectionSummary}
                open={openAdvancedSection === "genes"}
                onToggle={() =>
                  setOpenAdvancedSection((current) =>
                    current === "genes" ? null : "genes",
                  )
                }
              >
                <GeneSelectionPanel
                  detectionThreshold={detectionThreshold}
                  enabledStages={enabledGeneSelectionStages}
                  hvgGeneCount={hvgGeneCount}
                  includeAllTFs={includeAllTFs}
                  geneOrderingSource={geneOrderingSource}
                  geneOrderingFileName={geneOrderingFileName}
                  trajectoryPValue={trajectoryPValue}
                  trajectoryBonferroni={trajectoryBonferroni}
                  includeSignificantTFs={includeSignificantTFs}
                  onDetectionThresholdChange={setDetectionThreshold}
                  onEnabledStagesChange={setEnabledGeneSelectionStages}
                  onHvgGeneCountChange={setHvgGeneCount}
                  onIncludeAllTFsChange={setIncludeAllTFs}
                  onGeneOrderingSourceChange={setGeneOrderingSource}
                  onGeneOrderingFileChange={(file) => {
                    setGeneOrderingFile(file);
                    setGeneOrderingFileName(file?.name ?? "");
                  }}
                  onTrajectoryPValueChange={setTrajectoryPValue}
                  onTrajectoryBonferroniChange={setTrajectoryBonferroni}
                  onIncludeSignificantTFsChange={setIncludeSignificantTFs}
                />
              </AdvancedAccordionSection>

              <AdvancedAccordionSection
                title="Optional biological inputs"
                summary={optionalInputsSummary}
                open={openAdvancedSection === "inputs"}
                onToggle={() =>
                  setOpenAdvancedSection((current) =>
                    current === "inputs" ? null : "inputs",
                  )
                }
              >
                <OptionalInputsPanel
                  pseudotimeFileName={pseudotimeFileName}
                  groundTruthFileName={groundTruthFileName}
                  cellOracleConfigLabel={cellOracleConfigLabel}
                  cellOracleBaseGrnSource={cellOracleBaseGrnSource}
                  cellOracleSpecies={cellOracleSpecies}
                  clusterLabelsFileName={clusterLabelsFileName}
                  estimatePseudotime={estimatePseudotime}
                  onToggleEstimatePseudotime={onToggleEstimatePseudotime}
                  onSelectPseudotime={selectPseudotimeFile}
                  onClearPseudotime={clearPseudotimeFile}
                  onSelectGroundTruth={selectGroundTruthFile}
                  onClearGroundTruth={clearGroundTruthFile}
                  onActivateCellOracle={() => {
                    if (cellOracleBaseGrnSource === "built-in") {
                      setHasCellOracleSettingsConfigured(true);
                    }
                  }}
                  onCellOracleBaseGrnSourceChange={(value) => {
                    setCellOracleBaseGrnSource(value);
                    setHasCellOracleSettingsConfigured(value === "built-in");
                  }}
                  onSelectClusterLabels={(file) => {
                    if (file && cellOracleBaseGrnSource === "built-in") {
                      setHasCellOracleSettingsConfigured(true);
                    }
                    selectClusterLabelsFile(file);
                  }}
                  onClearClusterLabels={clearClusterLabelsFile}
                  onShowCellOracleHelp={handleOpenCellOracleHelp}
                />
              </AdvancedAccordionSection>

              <AdvancedAccordionSection
                title="Algorithms"
                summary={algorithmSectionSummary}
                open={openAdvancedSection === "algorithms"}
                onToggle={() =>
                  setOpenAdvancedSection((current) =>
                    current === "algorithms" ? null : "algorithms",
                  )
                }
              >
                <AlgorithmStep
                  algorithms={algorithms}
                  selectedIds={selectedIds}
                  datasetSummary={datasetSummary}
                  isLoadingAlgorithms={isLoadingAlgorithms}
                  algorithmLoadError={algorithmLoadError}
                  onRetryAlgorithms={onRetryAlgorithms}
                  onToggleAlgorithm={onToggleAlgorithm}
                  expandedAlgorithmId={expandedAlgorithmId}
                  onToggleAlgorithmExpanded={handleToggleAlgorithmExpanded}
                  algorithmParameters={algorithmParameters}
                  onApplyAlgorithmParameters={onApplyAlgorithmParameters}
                  getContextualDefaults={getAlgorithmContextualDefaults}
                  customizedIds={Object.keys(algorithmParameters)}
                />
              </AdvancedAccordionSection>

              <AdvancedAccordionSection
                title="Result settings"
                summary={resultSettingsSummary}
                open={openAdvancedSection === "results"}
                onToggle={() =>
                  setOpenAdvancedSection((current) =>
                    current === "results" ? null : "results",
                  )
                }
              >
                <div className="-mx-1">
                  <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          Maximum edges per target
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          Keep only the strongest regulators for each target gene.
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-2">
                        <CompactNumberField
                          value={maxEdgesPerTarget}
                          onChange={(nextValue) => {
                            if (nextValue === "") {
                              setMaxEdgesPerTarget("");
                              return;
                            }
                            const parsedValue = Number(nextValue);
                            if (!Number.isInteger(parsedValue) || parsedValue < 1) return;
                            setMaxEdgesPerTarget(
                              String(Math.min(parsedValue, maxEdgesLimit)),
                            );
                          }}
                          onBlur={() => {
                            const parsed = Number(maxEdgesPerTarget.trim());
                            if (!Number.isInteger(parsed) || parsed < 1) {
                              setMaxEdgesPerTarget(String(Math.min(20, maxEdgesLimit)));
                            }
                          }}
                          min={1}
                          max={maxEdgesLimit}
                          step={1}
                          ariaLabel="Max edges per target"
                        />
                        <span className="text-xs font-medium text-slate-500">
                          edges
                        </span>
                      </span>
                    </div>
                    <section className="relative bg-white">
                      <div className="relative z-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4">
                        <button
                          type="button"
                          onClick={() =>
                            setIsConfidenceStrategyOpen((current) => !current)
                          }
                          aria-expanded={isConfidenceStrategyOpen}
                          aria-controls="confidence-run-strategy-details"
                          className="min-w-0 cursor-pointer text-left"
                        >
                          <span className="block text-sm font-semibold text-slate-900">
                            Confidence run strategy
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-slate-500">
                            Choose how many runs are used to estimate edge confidence.
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setIsConfidenceStrategyOpen((current) => !current)
                          }
                          aria-expanded={isConfidenceStrategyOpen}
                          aria-controls="confidence-run-strategy-details"
                          className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-right transition hover:bg-slate-50"
                        >
                          <span className="hidden text-xs font-semibold text-[#1b75a6] sm:block">
                            {confidenceRunMode === "fixed"
                              ? `${confidenceBootstrapRuns || "—"} runs`
                              : "Automatic"}
                          </span>
                          <span className="text-slate-400" aria-hidden="true">
                            <DisclosureChevron open={isConfidenceStrategyOpen} />
                          </span>
                        </button>
                      </div>

                      {isConfidenceStrategyOpen ? (
                        <div
                          id="confidence-run-strategy-details"
                          className="relative z-10 border-t border-slate-100 bg-slate-50/55 px-4 py-4 pl-[3.25rem]"
                        >
                          <div
                            role="radiogroup"
                            aria-label="Confidence run strategy"
                            className="flex flex-wrap items-center gap-x-7 gap-y-3"
                          >
                            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                              <input
                                type="radio"
                                name="confidence-run-mode"
                                checked={confidenceRunMode === "automatic"}
                                onChange={() => setConfidenceRunMode("automatic")}
                                className="h-4 w-4 accent-[#1b75a6]"
                              />
                              Automatic
                            </label>
                            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                              <input
                                type="radio"
                                name="confidence-run-mode"
                                checked={confidenceRunMode === "fixed"}
                                onChange={() => setConfidenceRunMode("fixed")}
                                className="h-4 w-4 accent-[#1b75a6]"
                              />
                              Fixed number
                            </label>
                          </div>

                          <div className="mt-4 grid min-h-[5rem] items-center gap-3 border-t border-slate-200/70 pt-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                            {confidenceRunMode === "automatic" ? (
                              <div>
                                <p className="text-xs leading-5 text-slate-500">
                                  Starts with 3 runs and compares consecutive aggregate rankings using Spearman correlation (ρ).
                                </p>
                                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                                  Stops at ρ ≥ 0.95 for 2 consecutive checks; otherwise continues up to 50 runs.
                                </p>
                              </div>
                            ) : (
                              <div>
                                <p className="text-xs leading-5 text-slate-500">
                                  Run exactly the selected number of confidence runs.
                                </p>
                                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                                  Allowed range: {confidenceRunMin}–{confidenceRunMax} runs.
                                </p>
                              </div>
                            )}

                            {confidenceRunMode === "fixed" ? (
                              <span className="inline-flex items-center gap-2">
                                <CompactNumberField
                                  value={confidenceBootstrapRuns}
                                  onChange={(nextValue) => {
                                    if (nextValue === "") {
                                      setConfidenceBootstrapRuns("");
                                      return;
                                    }
                                    if (!/^\d+$/.test(nextValue)) return;
                                    // Keep intermediate values such as "1" so
                                    // users can type "10" before blur enforces
                                    // the allowed 3–50 range.
                                    setConfidenceBootstrapRuns(nextValue);
                                  }}
                                  onBlur={() => {
                                    const parsed = Number(confidenceBootstrapRuns.trim());
                                    if (
                                      !Number.isInteger(parsed) ||
                                      parsed < confidenceRunMin
                                    ) {
                                      setConfidenceBootstrapRuns(String(confidenceRunMin));
                                    } else if (parsed > confidenceRunMax) {
                                      setConfidenceBootstrapRuns(String(confidenceRunMax));
                                    }
                                  }}
                                  min={confidenceRunMin}
                                  max={confidenceRunMax}
                                  step={1}
                                  ariaLabel="Fixed confidence runs"
                                />
                                <span className="text-xs font-medium text-slate-500">
                                  runs
                                </span>
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </section>
                  </div>
                </div>
              </AdvancedAccordionSection>
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
        </div>

        <div className="-mx-6 -mb-6 mt-5 flex shrink-0 flex-wrap items-center justify-end gap-3 bg-white px-6 py-4 sm:rounded-b-[2rem] lg:-mx-8 lg:-mb-8 lg:px-8">
          {/* Say why Start is unavailable instead of leaving a dead button. */}
          {!isSubmitting && startHint ? (
            <p className="mr-auto text-xs font-medium text-slate-500">
              {startHint}
            </p>
          ) : null}

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

      <CellOracleHelpModal
        topic={cellOracleHelpTopic}
        isClosing={isCellOracleHelpClosing}
        onClose={handleCloseCellOracleHelp}
      />
    </div>
  );
}

function DisclosureChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={`h-4 w-4 transition-transform duration-200 ${
        open ? "rotate-0" : "-rotate-90"
      }`}
      aria-hidden="true"
    >
      <path
        d="m6 8 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AdvancedAccordionSection({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={`relative border-b border-slate-200 bg-white first:rounded-t-[1.2rem] first:[&>button]:rounded-t-[1.2rem] last:rounded-b-[1.2rem] last:border-b-0 ${
        open
          ? "last:[&>div]:rounded-b-[1.2rem]"
          : "last:[&>button]:rounded-b-[1.2rem]"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full cursor-pointer items-center justify-between gap-5 px-5 py-4 text-left transition hover:bg-slate-50/70 ${
          open
            ? "sticky top-0 z-20 bg-white/95 backdrop-blur-sm"
            : "bg-white"
        }`}
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block text-base font-bold text-slate-950">{title}</span>
          <span className="mt-1 block truncate text-[13px] font-medium text-slate-500">
            {summary}
          </span>
        </span>
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xl leading-none text-slate-400 transition ${
            open ? "bg-[#f2f9fc] text-[#1b75a6]" : ""
          }`}
          aria-hidden="true"
        >
          <DisclosureChevron open={open} />
        </span>
      </button>
      {open ? <div className="border-t border-slate-100 px-5 py-5">{children}</div> : null}
    </section>
  );
}

function OptionalInputsPanel({
  pseudotimeFileName,
  groundTruthFileName,
  cellOracleConfigLabel,
  cellOracleBaseGrnSource,
  cellOracleSpecies,
  clusterLabelsFileName,
  estimatePseudotime,
  onToggleEstimatePseudotime,
  onSelectPseudotime,
  onClearPseudotime,
  onSelectGroundTruth,
  onClearGroundTruth,
  onActivateCellOracle,
  onCellOracleBaseGrnSourceChange,
  onSelectClusterLabels,
  onClearClusterLabels,
  onShowCellOracleHelp,
}: {
  pseudotimeFileName: string;
  groundTruthFileName: string;
  cellOracleConfigLabel: string;
  cellOracleBaseGrnSource: CellOracleBaseGrnSource;
  cellOracleSpecies: string;
  clusterLabelsFileName: string;
  estimatePseudotime: boolean;
  onToggleEstimatePseudotime: (value: boolean) => void;
  onSelectPseudotime: (file: File | null) => void;
  onClearPseudotime: () => void;
  onSelectGroundTruth: (file: File | null) => void;
  onClearGroundTruth: () => void;
  onActivateCellOracle: () => void;
  onCellOracleBaseGrnSourceChange: (value: CellOracleBaseGrnSource) => void;
  onSelectClusterLabels: (file: File | null) => void;
  onClearClusterLabels: () => void;
  onShowCellOracleHelp: (topic: CellOracleHelpTopic) => void;
}) {
  return (
    <div className="-mx-1">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <PseudotimeInputRow
          fileName={pseudotimeFileName}
          estimate={estimatePseudotime}
          onSelect={onSelectPseudotime}
          onClear={onClearPseudotime}
          onToggleEstimate={onToggleEstimatePseudotime}
        />

        <GroundTruthInputRow
          fileName={groundTruthFileName}
          onSelect={onSelectGroundTruth}
          onClear={onClearGroundTruth}
        />

        <CellOracleInputRow
          configLabel={cellOracleConfigLabel}
          baseGrnSource={cellOracleBaseGrnSource}
          cellOracleSpecies={cellOracleSpecies}
          clusterLabelsFileName={clusterLabelsFileName}
          onActivate={onActivateCellOracle}
          onBaseGrnSourceChange={onCellOracleBaseGrnSourceChange}
          onSelectClusterLabels={onSelectClusterLabels}
          onClearClusterLabels={onClearClusterLabels}
          onShowHelp={onShowCellOracleHelp}
        />
      </div>
    </div>
  );
}

function GroundTruthInputRow({
  fileName,
  onSelect,
  onClear,
}: {
  fileName: string;
  onSelect: (file: File | null) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const compactFileName = formatFileNameForDisplay(fileName, 28);

  return (
    <section className="border-t border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="grid w-full cursor-pointer gap-3 px-4 py-4 text-left transition hover:bg-slate-50/70 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
        aria-expanded={open}
      >
        <span>
          <span className="block text-sm font-semibold text-slate-900">
            Ground-truth network
          </span>
          <span className="mt-1 block text-sm leading-5 text-slate-500">
            Enables benchmark evaluation of inferred edges.
          </span>
        </span>
        <span className="flex min-w-0 items-center justify-end gap-2">
          <span
            className={`max-w-56 truncate text-xs font-semibold ${
              fileName ? "text-[#1b75a6]" : "text-slate-400"
            }`}
            title={fileName || "Not provided"}
          >
            {fileName ? compactFileName : "Not provided"}
          </span>
          <span
            className={`text-slate-400 transition ${
              open ? "text-[#1b75a6]" : ""
            }`}
            aria-hidden="true"
          >
            <DisclosureChevron open={open} />
          </span>
        </span>
      </button>

      {open ? (
        <div className="border-t border-slate-100 bg-slate-50/55 px-4 py-4 pl-[3.25rem]">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <span>
              <span className="block text-sm font-semibold text-slate-800">
                Reference edges
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                CSV with regulator and target columns. Sign or effect is optional.
              </span>
            </span>
            <label className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-center text-sm font-semibold text-[#1b75a6] transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc]">
              {fileName ? "Replace" : "Choose CSV"}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => {
                  onSelect(event.target.files?.[0] ?? null);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>

          {fileName ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-3">
              <span
                className="min-w-0 truncate text-xs font-semibold text-[#178a62]"
                title={fileName}
              >
                {formatFileNameForDisplay(fileName, 46)}
              </span>
              <button
                type="button"
                onClick={onClear}
                className="text-xs font-semibold text-slate-500 transition hover:text-rose-600"
              >
                Remove
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function CellOracleInputRow({
  configLabel,
  baseGrnSource,
  cellOracleSpecies,
  clusterLabelsFileName,
  onActivate,
  onBaseGrnSourceChange,
  onSelectClusterLabels,
  onClearClusterLabels,
  onShowHelp,
}: {
  configLabel: string;
  baseGrnSource: CellOracleBaseGrnSource;
  cellOracleSpecies: string;
  clusterLabelsFileName: string;
  onActivate: () => void;
  onBaseGrnSourceChange: (value: CellOracleBaseGrnSource) => void;
  onSelectClusterLabels: (file: File | null) => void;
  onClearClusterLabels: () => void;
  onShowHelp: (topic: CellOracleHelpTopic) => void;
}) {
  const [open, setOpen] = useState(false);
  const clusterLabelsInputRef = useRef<HTMLInputElement | null>(null);
  const isBuiltInGrn = baseGrnSource === "built-in";

  return (
    <section className="border-t border-slate-200">
      <button
        type="button"
        onClick={() => {
          if (!open) {
            onActivate();
          }
          setOpen((current) => !current);
        }}
        className="grid w-full cursor-pointer gap-3 px-4 py-4 text-left transition hover:bg-slate-50/70 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
        aria-expanded={open}
      >
        <span>
          <span className="block text-sm font-semibold text-slate-900">
            CellOracle inputs
          </span>
          <span className="mt-1 block text-sm leading-5 text-slate-500">
            Species, prior-network, and cell-grouping settings.
          </span>
        </span>
        <span className="flex min-w-0 items-center justify-end gap-2">
          <span
            className={`max-w-56 truncate text-xs font-semibold ${
              configLabel ? "text-[#1b75a6]" : "text-slate-400"
            }`}
            title={configLabel || "Not configured"}
          >
            {configLabel || "Not configured"}
          </span>
          <span
            className={`text-slate-400 transition ${
              open ? "text-[#1b75a6]" : ""
            }`}
            aria-hidden="true"
          >
            <DisclosureChevron open={open} />
          </span>
        </span>
      </button>

      {open ? (
        <div className="border-t border-slate-100 bg-slate-50/55 px-4 py-4 pl-[3.25rem]">
          <div className="inline-flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-800">
              Base GRN source
            </p>
            <CellOracleHelpButton
              label="Base GRN CSV format"
              onClick={() => onShowHelp("base-grn")}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-7 gap-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="radio"
                name="celloracle-base-grn-source"
                checked={isBuiltInGrn}
                onChange={() => onBaseGrnSourceChange("built-in")}
                className="h-4 w-4 accent-[#1b75a6]"
              />
              Built-in GRN
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="radio"
                name="celloracle-base-grn-source"
                checked={!isBuiltInGrn}
                onChange={() => onBaseGrnSourceChange("upload")}
                className="h-4 w-4 accent-[#1b75a6]"
              />
              Upload GRN
            </label>
          </div>

          {isBuiltInGrn ? (
            <label className="mt-4 grid gap-2 border-t border-slate-200/70 pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,0.85fr)] sm:items-center sm:gap-5">
              <span>
                <span className="block text-sm font-semibold text-slate-800">
                  CellOracle species
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  Inherited from the dataset species selected above.
                </span>
              </span>
              <span className="flex items-center border-b border-slate-200 py-2 transition focus-within:border-[#1b75a6]">
                <select
                  value={cellOracleSpecies}
                  disabled
                  aria-label="CellOracle species inherited from dataset"
                  className="w-full appearance-none bg-transparent pr-7 text-sm font-medium text-slate-500 outline-none disabled:cursor-not-allowed"
                >
                  {CELLORACLE_SPECIES_OPTIONS.map((species) => (
                    <option key={species.value} value={species.value}>
                      {species.label}
                    </option>
                  ))}
                </select>
                <span
                  className="-ml-5 text-sm text-slate-400"
                  aria-hidden="true"
                >
                  ▾
                </span>
              </span>
            </label>
          ) : (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-4">
              <span className="text-xs font-medium text-slate-400">
                Custom base GRN upload is not available yet.
              </span>
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-400"
              >
                Coming soon
              </button>
            </div>
          )}

          <div className="mt-4 border-t border-slate-200/70 pt-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div>
                <div className="inline-flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800">
                    Cell grouping
                  </p>
                  <CellOracleHelpButton
                    label="Cluster labels CSV format"
                    onClick={() => onShowHelp("cluster-labels")}
                  />
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Optional labels for cluster-specific networks.
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
                className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#1b75a6] transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc]"
              >
                {clusterLabelsFileName ? "Replace" : "Choose CSV"}
              </button>
            </div>

            {clusterLabelsFileName ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-3">
                <span
                  className="min-w-0 truncate text-xs font-semibold text-[#178a62]"
                  title={clusterLabelsFileName}
                >
                  {formatFileNameForDisplay(clusterLabelsFileName, 46)}
                </span>
                <button
                  type="button"
                  onClick={onClearClusterLabels}
                  className="text-xs font-semibold text-slate-500 transition hover:text-rose-600"
                >
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function GeneSelectionPanel({
  detectionThreshold,
  enabledStages,
  hvgGeneCount,
  includeAllTFs,
  geneOrderingSource,
  geneOrderingFileName,
  trajectoryPValue,
  trajectoryBonferroni,
  includeSignificantTFs,
  onDetectionThresholdChange,
  onEnabledStagesChange,
  onHvgGeneCountChange,
  onIncludeAllTFsChange,
  onGeneOrderingSourceChange,
  onGeneOrderingFileChange,
  onTrajectoryPValueChange,
  onTrajectoryBonferroniChange,
  onIncludeSignificantTFsChange,
}: {
  detectionThreshold: string;
  enabledStages: GeneSelectionStage[];
  hvgGeneCount: string;
  includeAllTFs: boolean;
  geneOrderingSource: "calculate" | "upload";
  geneOrderingFileName: string;
  trajectoryPValue: string;
  trajectoryBonferroni: boolean;
  includeSignificantTFs: boolean;
  onDetectionThresholdChange: (value: string) => void;
  onEnabledStagesChange: (value: GeneSelectionStage[]) => void;
  onHvgGeneCountChange: (value: string) => void;
  onIncludeAllTFsChange: (value: boolean) => void;
  onGeneOrderingSourceChange: (value: "calculate" | "upload") => void;
  onGeneOrderingFileChange: (file: File | null) => void;
  onTrajectoryPValueChange: (value: string) => void;
  onTrajectoryBonferroniChange: (value: boolean) => void;
  onIncludeSignificantTFsChange: (value: boolean) => void;
}) {
  const [expandedStage, setExpandedStage] =
    useState<GeneSelectionStage | null>(null);
  const [isFilteringRulesOpen, setIsFilteringRulesOpen] = useState(false);
  const stageOrder: GeneSelectionStage[] = [
    "detection",
    "trajectory",
    "variance",
  ];

  const toggleStage = (stage: GeneSelectionStage) => {
    const isEnabled = enabledStages.includes(stage);
    const nextStages = isEnabled
      ? enabledStages.filter((item) => item !== stage)
      : stageOrder.filter((item) => item === stage || enabledStages.includes(item));

    onEnabledStagesChange(nextStages);
    setExpandedStage((current) => {
      if (!isEnabled) return stage;
      return current === stage ? null : current;
    });
  };

  return (
    <div className="-mx-1">
      <div className="relative overflow-hidden rounded-xl border border-slate-200">
        <span
          aria-hidden="true"
          className="absolute bottom-12 left-[1.625rem] top-12 w-px bg-slate-200"
        />

        <GeneSelectionStageRow
          number={1}
          title="Detection filtering"
          description="Remove genes detected in too few cells."
          summary={`≥${detectionThreshold || "—"}% of cells`}
          enabled={enabledStages.includes("detection")}
          expanded={expandedStage === "detection"}
          onToggleEnabled={() => toggleStage("detection")}
          onToggleExpanded={() =>
            setExpandedStage((current) =>
              current === "detection" ? null : "detection",
            )
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Detection threshold
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Keep genes detected in at least this percentage of cells.
              </p>
            </div>
            <span className="inline-flex items-center gap-2">
              <CompactNumberField
                value={detectionThreshold}
                onChange={onDetectionThresholdChange}
                min={1}
                max={100}
                step={1}
                ariaLabel="Detection threshold percentage"
              />
              <span className="text-xs font-medium text-slate-500">
                % of cells
              </span>
            </span>
          </div>
        </GeneSelectionStageRow>

        <GeneSelectionStageRow
          number={2}
          title="Trajectory-aware filtering"
          description="Keep genes associated with progression along pseudotime."
          summary={`p ≤ ${trajectoryPValue || "—"}${trajectoryBonferroni ? " · corrected" : ""}`}
          enabled={enabledStages.includes("trajectory")}
          expanded={expandedStage === "trajectory"}
          onToggleEnabled={() => toggleStage("trajectory")}
          onToggleExpanded={() =>
            setExpandedStage((current) =>
              current === "trajectory" ? null : "trajectory",
            )
          }
        >
          <div role="radiogroup" aria-labelledby="gene-ordering-source-label">
            <p
              id="gene-ordering-source-label"
              className="text-sm font-semibold text-slate-800"
            >
              Gene ordering source
            </p>
            <div className="mt-3 flex flex-wrap items-start gap-x-7 gap-y-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="radio"
                  name="gene-ordering-source"
                  value="upload"
                  checked={geneOrderingSource === "upload"}
                  onChange={() => onGeneOrderingSourceChange("upload")}
                  className="h-4 w-4 accent-[#1b75a6]"
                />
                Upload CSV
              </label>
              <label className="flex max-w-md cursor-pointer items-start gap-2 text-slate-700">
                <input
                  type="radio"
                  name="gene-ordering-source"
                  value="calculate"
                  checked={geneOrderingSource === "calculate"}
                  onChange={() => {
                    if (geneOrderingFileName) {
                      onGeneOrderingFileChange(null);
                    }
                    onGeneOrderingSourceChange("calculate");
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#1b75a6]"
                />
                <span>
                  <span className="block text-sm font-medium">
                    Calculate for me
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    No GeneOrdering CSV? We&apos;ll generate it from uploaded
                    pseudotime, or estimate pseudotime with Slingshot first.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {geneOrderingSource === "upload" ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-4">
              <span
                className={`min-w-0 truncate text-xs font-medium ${
                  geneOrderingFileName ? "text-[#178a62]" : "text-slate-400"
                }`}
                title={geneOrderingFileName || "No GeneOrdering CSV selected"}
              >
                {geneOrderingFileName
                  ? formatFileNameForDisplay(geneOrderingFileName, 36)
                  : "No CSV selected"}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-center text-sm font-semibold text-[#1b75a6] transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc]">
                  {geneOrderingFileName ? "Replace" : "Upload"}
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(event) => {
                      onGeneOrderingSourceChange("upload");
                      onGeneOrderingFileChange(event.target.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                {geneOrderingFileName ? (
                  <button
                    type="button"
                    onClick={() => onGeneOrderingFileChange(null)}
                    className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                  >
                    Remove
                  </button>
                ) : null}
              </span>
            </div>
          ) : null}

          <div className="mt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsFilteringRulesOpen((current) => !current)}
              aria-expanded={isFilteringRulesOpen}
              aria-controls="trajectory-filtering-rules"
              className="grid w-full cursor-pointer gap-2 py-3 text-left sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center"
            >
              <span className="text-sm font-semibold text-slate-800">
                Filtering rules
              </span>
              <span className="flex min-w-0 items-center justify-between gap-3">
                <span className="truncate text-xs font-semibold text-slate-500">
                  p ≤ {trajectoryPValue || "—"}
                  {trajectoryBonferroni ? " · Bonferroni" : ""}
                  {enabledStages.includes("variance") && includeSignificantTFs
                    ? " · significant TFs prioritized"
                    : ""}
                </span>
                <span
                  className="shrink-0 text-slate-400"
                  aria-hidden="true"
                >
                  <DisclosureChevron open={isFilteringRulesOpen} />
                </span>
              </span>
            </button>

            {isFilteringRulesOpen ? (
              <div
                id="trajectory-filtering-rules"
                className="ml-2 space-y-4 border-l-2 border-[#1b75a6]/15 bg-white/45 py-4 pl-5 pr-2"
              >
                <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center">
                  <span className="text-xs font-semibold text-slate-600">
                    Significance threshold
                  </span>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
                      <span aria-hidden="true">p ≤</span>
                      <CompactNumberField
                        value={trajectoryPValue}
                        onChange={onTrajectoryPValueChange}
                        min={0}
                        max={1}
                        step={0.001}
                        ariaLabel="P-value threshold"
                      />
                    </span>
                    <PreprocessingToggle
                      label="Apply Bonferroni correction"
                      enabled={trajectoryBonferroni}
                      compact
                      onToggle={() =>
                        onTrajectoryBonferroniChange(!trajectoryBonferroni)
                      }
                    />
                  </div>
                </div>

                {enabledStages.includes("variance") ? (
                  <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center">
                    <span className="text-xs font-semibold text-slate-600">
                      TF priority
                    </span>
                    <PreprocessingToggle
                      label="Prioritize significant TFs within the variable-gene limit"
                      enabled={includeSignificantTFs}
                      compact
                      onToggle={() =>
                        onIncludeSignificantTFsChange(!includeSignificantTFs)
                      }
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </GeneSelectionStageRow>

        <GeneSelectionStageRow
          number={3}
          title="Variable-gene selection"
          description="Rank the remaining genes by variance and keep the top set."
          summary={`Top ${hvgGeneCount || "—"} total${
            includeAllTFs ? " · known TFs prioritized" : ""
          }`}
          enabled={enabledStages.includes("variance")}
          expanded={expandedStage === "variance"}
          last
          onToggleEnabled={() => toggleStage("variance")}
          onToggleExpanded={() =>
            setExpandedStage((current) =>
              current === "variance" ? null : "variance",
            )
          }
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center">
              <span className="text-sm font-semibold text-slate-800">
                Genes to retain
              </span>
              <span className="inline-flex items-center gap-2">
                <CompactNumberField
                  value={hvgGeneCount}
                  onChange={onHvgGeneCountChange}
                  min={1}
                  step={1}
                  ariaLabel="Genes to retain"
                />
                <span className="text-xs font-medium text-slate-500">
                  genes
                </span>
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center">
              <span className="text-sm font-semibold text-slate-800">
                TF retention
              </span>
              <PreprocessingToggle
                label="Prioritize known TFs within this total"
                enabled={includeAllTFs}
                onToggle={() => onIncludeAllTFsChange(!includeAllTFs)}
              />
            </div>
          </div>
        </GeneSelectionStageRow>
      </div>
    </div>
  );
}

function GeneSelectionStageRow({
  number,
  title,
  description,
  summary,
  enabled,
  expanded,
  last = false,
  onToggleEnabled,
  onToggleExpanded,
  children,
}: {
  number: number;
  title: string;
  description: string;
  summary: string;
  enabled: boolean;
  expanded: boolean;
  last?: boolean;
  onToggleEnabled: () => void;
  onToggleExpanded: () => void;
  children: ReactNode;
}) {
  const panelId = `gene-selection-stage-${number}`;

  return (
    <section
      className={`${last ? "" : "border-b border-slate-200"} relative bg-white`}
    >
      <div className="relative z-10 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4">
        <label className="relative flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={enabled}
            onChange={onToggleEnabled}
            className="peer sr-only"
            aria-label={`Enable ${title}`}
          />
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition peer-focus-visible:ring-4 peer-focus-visible:ring-[#1b75a6]/15 ${
              enabled
                ? "border-[#1b75a6] bg-[#1b75a6]"
                : "border-slate-300 bg-white"
            }`}
            aria-hidden="true"
          >
            {enabled ? (
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
            ) : null}
          </span>
        </label>

        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="min-w-0 cursor-pointer text-left"
        >
          <span className="block text-sm font-semibold text-slate-900">
            {title}
          </span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            {description}
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-right transition hover:bg-slate-50"
        >
          <span
            className={`hidden text-xs font-semibold sm:block ${
              enabled ? "text-[#1b75a6]" : "text-slate-400"
            }`}
          >
            {enabled ? summary : "Off"}
          </span>
          <span
            className="text-slate-400"
            aria-hidden="true"
          >
            <DisclosureChevron open={expanded} />
          </span>
        </button>
      </div>

      {expanded ? (
        <div
          id={panelId}
          className="relative z-10 border-t border-slate-100 bg-slate-50/55 px-4 py-4 pl-[3.25rem]"
        >
          <fieldset
            disabled={!enabled}
            className={
              enabled
                ? ""
                : "pointer-events-none opacity-45 grayscale-[20%]"
            }
          >
            {children}
          </fieldset>
        </div>
      ) : null}
    </section>
  );
}

function CompactNumberField({
  value,
  onChange,
  onBlur,
  min,
  max,
  step = 1,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={value}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-sm font-semibold text-slate-900 outline-none transition [appearance:textfield] focus:border-[#1b75a6]/50 focus:ring-4 focus:ring-[#1b75a6]/10 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}

// Kept as a ready replacement for the compact inline CellOracle editor.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CellOracleSettingsModal({
  open,
  isClosing,
  baseGrnSource,
  cellOracleSpecies,
  clusterLabelsFileName,
  onBaseGrnSourceChange,
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
        className={`flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white text-slate-900 shadow-2xl shadow-slate-900/20 ${
          isClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-5 px-6 pb-5 pt-6">
          <div>
            <h3 className="text-2xl font-bold text-slate-950">
              CellOracle inputs
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Configure the prior network and optional cell grouping used by CellOracle.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close CellOracle settings"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-xl font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <div className="overflow-hidden rounded-[1.2rem] border border-slate-200 bg-white">
            <section>
              <div className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <div className="inline-flex items-center gap-2">
                    <h4 className="text-base font-bold text-slate-950">
                      Base GRN
                    </h4>
                    <CellOracleHelpButton
                      label="Base GRN CSV format"
                      onClick={() => onShowHelp("base-grn")}
                    />
                  </div>
                  <p className="mt-1 text-sm leading-5 text-slate-500">
                    Select the TF-target prior used to initialize the network.
                  </p>
                </div>
                <span
                  className={`text-xs font-semibold ${
                    isBuiltInGrn ? "text-[#1b75a6]" : "text-slate-400"
                  }`}
                >
                  {isBuiltInGrn
                    ? `Built-in · ${
                        CELLORACLE_SPECIES_OPTIONS.find(
                          (species) => species.value === cellOracleSpecies,
                        )?.label ?? "Human"
                      }`
                    : "Custom upload"}
                </span>
              </div>

              <div className="border-t border-slate-100 bg-slate-50/55 px-5 py-4 pl-[3.25rem]">
                <p className="text-sm font-semibold text-slate-800">
                  Base GRN source
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-7 gap-y-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="radio"
                      name="celloracle-base-grn-source"
                      checked={isBuiltInGrn}
                      onChange={() => onBaseGrnSourceChange("built-in")}
                      className="h-4 w-4 accent-[#1b75a6]"
                    />
                    Built-in GRN
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="radio"
                      name="celloracle-base-grn-source"
                      checked={!isBuiltInGrn}
                      onChange={() => onBaseGrnSourceChange("upload")}
                      className="h-4 w-4 accent-[#1b75a6]"
                    />
                    Upload GRN
                  </label>
                </div>

                {isBuiltInGrn ? (
                  <label className="mt-4 grid gap-2 border-t border-slate-200/70 pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.9fr)] sm:items-center sm:gap-5">
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">
                        CellOracle species
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        Independent from the dataset species selected above.
                      </span>
                    </span>
                    <span className="flex items-center border-b border-slate-200 py-2 transition focus-within:border-[#1b75a6]">
                      <select
                        value={cellOracleSpecies}
                        disabled
                        aria-label="CellOracle species inherited from dataset"
                        className="w-full appearance-none bg-transparent pr-7 text-sm font-medium text-slate-500 outline-none disabled:cursor-not-allowed"
                      >
                        {CELLORACLE_SPECIES_OPTIONS.map((species) => (
                          <option key={species.value} value={species.value}>
                            {species.label}
                          </option>
                        ))}
                      </select>
                      <span
                        className="-ml-5 text-sm text-slate-400"
                        aria-hidden="true"
                      >
                        ▾
                      </span>
                    </span>
                  </label>
                ) : (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-4">
                    <span className="text-xs font-medium text-slate-400">
                      Custom base GRN upload is not available yet.
                    </span>
                    <button
                      type="button"
                      disabled
                      className="cursor-not-allowed rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-400"
                    >
                      Coming soon
                    </button>
                  </div>
                )}
              </div>
            </section>

            <section className="border-t border-slate-200">
              <div className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <div className="inline-flex items-center gap-2">
                    <h4 className="text-base font-bold text-slate-950">
                      Cell grouping
                    </h4>
                    <CellOracleHelpButton
                      label="Cluster labels CSV format"
                      onClick={() => onShowHelp("cluster-labels")}
                    />
                  </div>
                  <p className="mt-1 text-sm leading-5 text-slate-500">
                    Add cluster labels for cluster-specific networks. Leave
                    empty for one global network.
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
                  className="min-w-32 cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#1b75a6] transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc]"
                >
                  {clusterLabelsFileName ? "Replace" : "Choose CSV"}
                </button>
              </div>

              {clusterLabelsFileName ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/55 px-5 py-4 pl-[3.25rem]">
                  <span
                    className="min-w-0 truncate text-xs font-semibold text-[#178a62]"
                    title={clusterLabelsFileName}
                  >
                    {formatFileNameForDisplay(clusterLabelsFileName, 52)}
                  </span>
                  <button
                    type="button"
                    onClick={onClearClusterLabels}
                    className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        </div>

        <div className="flex shrink-0 justify-end border-t border-slate-100 bg-white px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="min-w-32 cursor-pointer rounded-full bg-[#1b75a6] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#155f87]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function PseudotimeInputRow({
  fileName,
  estimate,
  onSelect,
  onClear,
  onToggleEstimate,
}: {
  fileName: string;
  estimate: boolean;
  onSelect: (file: File | null) => void;
  onClear: () => void;
  onToggleEstimate: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"upload" | "estimate" | null>(() =>
    fileName ? "upload" : estimate ? "estimate" : null,
  );
  const compactFileName = formatFileNameForDisplay(fileName, 28);
  const summary = fileName
    ? compactFileName
    : estimate
      ? "Estimate with Slingshot"
      : "Not provided";

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="grid w-full cursor-pointer gap-3 px-4 py-4 text-left transition hover:bg-slate-50/70 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
        aria-expanded={open}
      >
        <span>
          <span className="block text-sm font-semibold text-slate-900">
            Pseudotime
          </span>
          <span className="mt-1 block text-sm leading-5 text-slate-500">
            Used by trajectory-aware methods.
          </span>
        </span>
        <span className="flex min-w-0 items-center justify-end gap-2">
          <span
            className={`max-w-56 truncate text-xs font-semibold ${
              fileName || estimate ? "text-[#1b75a6]" : "text-slate-400"
            }`}
            title={fileName || summary}
          >
            {summary}
          </span>
          <span
            className={`text-slate-400 transition ${
              open ? "text-[#1b75a6]" : ""
            }`}
            aria-hidden="true"
          >
            <DisclosureChevron open={open} />
          </span>
        </span>
      </button>

      {open ? (
        <div className="border-t border-slate-100 bg-slate-50/55 px-4 py-4 pl-[3.25rem]">
          <p className="text-sm font-semibold text-slate-800">
            Pseudotime source
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-x-7 gap-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="radio"
                name="pseudotime-source"
                checked={source === "upload"}
                onChange={() => {
                  setSource("upload");
                  onToggleEstimate(false);
                }}
                className="h-4 w-4 accent-[#1b75a6]"
              />
              Upload CSV
            </label>
            <label className="flex max-w-md cursor-pointer items-start gap-2 text-slate-700">
              <input
                type="radio"
                name="pseudotime-source"
                checked={source === "estimate"}
                onChange={() => {
                  setSource("estimate");
                  if (fileName) onClear();
                  onToggleEstimate(true);
                }}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#1b75a6]"
              />
              <span>
                <span className="block text-sm font-medium">
                  Estimate with Slingshot
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  No pseudotime? Slingshot will calculate it when this analysis
                  starts.
                </span>
              </span>
            </label>
          </div>

          {source === "upload" ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-4">
              <span
                className={`min-w-0 truncate text-xs font-medium ${
                  fileName ? "text-[#178a62]" : "text-slate-400"
                }`}
                title={fileName || "No pseudotime CSV selected"}
              >
                {fileName ? compactFileName : "No CSV selected"}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-center text-sm font-semibold text-[#1b75a6] transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc]">
                  {fileName ? "Replace" : "Upload"}
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setSource("upload");
                      onToggleEstimate(false);
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
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function CellOracleHelpButton({
  label,
  onClick,
  expanded,
  controls,
}: {
  label: string;
  onClick: () => void;
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
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

function PreprocessingToggle({
  label,
  enabled,
  onToggle,
  compact = false,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  compact?: boolean;
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
      <span
        className={
          compact
            ? "text-xs font-semibold text-slate-700"
            : "text-sm font-bold text-slate-950"
        }
      >
        {label}
      </span>
    </button>
  );
}
