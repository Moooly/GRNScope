"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CreateProjectModal from "./CreateProjectModal";
import type { GeneSelectionStage } from "./CreateProjectModal";
import type { AlgorithmParameter, ProjectAlgorithm } from "../page";
import type { Project } from "../_types/project";
import { getApiBase } from "../../_lib/apiConfig";
import { apiFetch } from "../../_lib/clientIdentity";
import {
  registerPendingProjectUpload,
  startPendingProjectUpload,
} from "../_lib/pendingProjectUpload";
import {
  inspectExpressionMatrix,
  type ExpressionMatrixFormat,
  type ExpressionMatrixOption,
  type ExpressionMatrixInspection,
  type MatrixStateDetection,
} from "../_lib/matrixStateDetection";

type BackendAlgorithmEntry = {
  id: string;
  name: string;
  description: string;
  long_description: string;
  category: string;
  year: string;
  journal: string;
  publication_title: string;
  publication_url: string;
  source_url: string | null;
  docker_image: string;
  runner: string;
  directed: boolean;
  signed: boolean;
  requires_pseudotime: boolean;
  supports_expression_matrix: boolean;
  active: boolean;
  recommended: boolean;
  strengths: string[];
  limitations: string[];
  recommended_use_cases: string[];
  parameters: AlgorithmParameter[];
};

const MAX_PREPROCESSED_GENES = 8000;
const RANKED_EDGES_HARD_MAX = 100;
const DEFAULT_MAX_EDGES_PER_TARGET = "20";
const DEFAULT_CONFIDENCE_RUN_MODE = "automatic" as const;
const DEFAULT_CONFIDENCE_RUNS = "15";
const CONFIDENCE_RUN_MIN = 3;
const CONFIDENCE_RUN_MAX = 50;
const SINCERITIES_DEFAULT_MAX_GENES = 500;
const SINCERITIES_SAFE_CELL_FRACTION = 0.75;
const SCRIBE_DEFAULT_MAX_GENES = 300;
const SINGE_DEFAULT_MAX_GENES = 500;
const GRISLI_DEFAULT_MAX_GENES = 500;
const GRNVBEM_DEFAULT_MAX_GENES = 500;
const CELLORACLE_INTERNAL_BASE_GRN = "auto";

type CreateProjectResponsePayload = {
  ok?: boolean;
  project_id?: string;
  job_id?: string;
  errors?: string[];
};

type SpeciesInferencePayload = {
  ok?: boolean;
  inference?: {
    species?: string;
  } | null;
};

type H5ADInspectionPayload = {
  ok?: boolean;
  errors?: string[];
  selected_matrix?: string;
  gene_count?: number;
  cell_count?: number;
  gene_names?: string[];
  detection?: MatrixStateDetection;
  matrices?: Array<{
    key: string;
    label: string;
    gene_count: number;
    cell_count: number;
    gene_names: string[];
    detection: MatrixStateDetection;
    default?: boolean;
  }>;
};

async function readCreateProjectResponse(response: Response) {
  const responseText = await response.text();
  if (!responseText.trim()) return null;

  try {
    return JSON.parse(responseText) as CreateProjectResponsePayload;
  } catch {
    return null;
  }
}

function getDockerVersion(dockerImage: string) {
  const parts = dockerImage.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : dockerImage;
}

function mapBackendAlgorithm(algorithm: BackendAlgorithmEntry): ProjectAlgorithm {
  return {
    id: algorithm.id,
    name: algorithm.name,
    tagline: algorithm.description,
    category: algorithm.category,
    requiresPseudotime: algorithm.requires_pseudotime,
    directed: algorithm.directed,
    signed: algorithm.signed,
    publication: algorithm.publication_title,
    year: algorithm.year,
    journal: algorithm.journal,
    dockerVersion: getDockerVersion(algorithm.docker_image),
    paperUrl: algorithm.publication_url,
    sourceUrl: algorithm.source_url,
    strengths: algorithm.strengths,
    limitations: algorithm.limitations,
    recommendedUseCases: algorithm.recommended_use_cases,
    detail: algorithm.long_description,
    recommended: algorithm.recommended,
    runner: algorithm.runner,
    parameters: algorithm.parameters ?? [],
  };
}

interface CreateProjectFlowProps {
  /** Whether the modal is currently open. */
  open: boolean;
  /** Called when the user dismisses or cancels the modal. */
  onClose: () => void;
  /**
   * Called after a project is successfully created on the backend. Receives a
   * Project object suitable for adding to a history list. The flow will close
   * the modal automatically before invoking this callback.
   */
  onProjectCreated?: (project: Project) => void;
  initialValues?: CreateProjectPrefill;
}

export type CreateProjectPrefill = {
  projectName?: string;
  // Retained for compatibility with existing rerun prefills; the creation UI
  // intentionally no longer exposes a description field.
  projectDescription?: string;
  matrixState?: string;
  datasetSpecies?: string;
  enabledGeneSelectionStages?: GeneSelectionStage[];
  detectionThreshold?: string;
  hvgGeneCount?: string;
  includeAllTFs?: boolean;
  geneOrderingSource?: "calculate" | "upload";
  trajectoryPValue?: string;
  trajectoryBonferroni?: boolean;
  includeSignificantTFs?: boolean;
  maxEdgesPerTarget?: string;
  confidenceRunMode?: "automatic" | "fixed";
  confidenceBootstrapRuns?: string;
  selectedIds?: string[];
  algorithmParameters?: Record<string, Record<string, unknown>>;
  ensembleEnabled?: boolean;
  cellOracleSpecies?: string;
};

/**
 * Self-contained state machine for the "create project" modal flow. Owns
 * every piece of state and every side effect needed between the user clicking
 * a "Start an analysis" button and the project being created on the backend.
 *
 * Both the workspace page (`/projects`) and the landing page (`/`) render this
 * component so that the modal behaves identically regardless of where the user
 * triggered it from.
 */
export default function CreateProjectFlow({
  open,
  onClose,
  onProjectCreated,
  initialValues,
}: CreateProjectFlowProps) {
  const API_BASE = getApiBase();

  const [isClosing, setIsClosing] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [expressionFile, setExpressionFile] = useState<File | null>(null);
  const [pseudotimeFile, setPseudotimeFile] = useState<File | null>(null);
  const [groundTruthFile, setGroundTruthFile] = useState<File | null>(null);
  const [estimatePseudotime, setEstimatePseudotime] = useState(false);
  const [clusterLabelsFile, setClusterLabelsFile] = useState<File | null>(null);
  const [expressionFileName, setExpressionFileName] = useState("");
  const [expressionMatrixFormat, setExpressionMatrixFormat] =
    useState<ExpressionMatrixFormat>("csv");
  const [expressionMatrixLayer, setExpressionMatrixLayer] = useState("X");
  const [expressionMatrixOptions, setExpressionMatrixOptions] = useState<
    ExpressionMatrixOption[]
  >([]);
  const [expressionMatrixDimensions, setExpressionMatrixDimensions] = useState<
    string | null
  >(null);
  const [geneCount, setGeneCount] = useState<number | null>(null);
  const [cellCount, setCellCount] = useState<number | null>(null);
  const [matrixState, setMatrixState] = useState("");
  const [matrixStateDetection, setMatrixStateDetection] =
    useState<MatrixStateDetection | null>(null);
  const [isMatrixStateDetecting, setIsMatrixStateDetecting] = useState(false);
  const [isExpressionMatrixInspecting, setIsExpressionMatrixInspecting] =
    useState(false);
  const [datasetSpecies, setDatasetSpecies] = useState("");
  const [isSpeciesDetecting, setIsSpeciesDetecting] = useState(false);
  const speciesSelectionSourceRef = useRef<
    "automatic" | "manual" | "prefill" | null
  >(null);
  const [pseudotimeFileName, setPseudotimeFileName] = useState("");
  const [groundTruthFileName, setGroundTruthFileName] = useState("");
  const [clusterLabelsFileName, setClusterLabelsFileName] = useState("");

  useEffect(() => {
    let cancelled = false;

    if (!expressionFile) {
      setExpressionMatrixDimensions(null);
      setExpressionMatrixFormat("csv");
      setExpressionMatrixLayer("X");
      setExpressionMatrixOptions([]);
      setGeneCount(null);
      setCellCount(null);
      setMatrixState("");
      setMatrixStateDetection(null);
      setIsMatrixStateDetecting(false);
      setIsExpressionMatrixInspecting(false);
      setIsSpeciesDetecting(false);
      if (speciesSelectionSourceRef.current === "automatic") {
        speciesSelectionSourceRef.current = null;
        setDatasetSpecies("");
      }
      return;
    }

    const isH5AD = expressionFile.name.toLowerCase().endsWith(".h5ad");
    setExpressionMatrixFormat(isH5AD ? "h5ad" : "csv");
    setExpressionMatrixLayer("X");
    setExpressionMatrixOptions([]);
    setExpressionMatrixDimensions(
      isH5AD ? "Inspecting AnnData…" : "Inspecting matrix…",
    );
    setIsExpressionMatrixInspecting(true);
    setGeneCount(null);
    setCellCount(null);
    setMatrixState("");
    setMatrixStateDetection(null);
    setIsMatrixStateDetecting(true);
    setIsSpeciesDetecting(true);
    if (
      speciesSelectionSourceRef.current === null ||
      speciesSelectionSourceRef.current === "automatic"
    ) {
      speciesSelectionSourceRef.current = null;
      setDatasetSpecies("");
    }
    const inspectUploadedExpression = async (): Promise<ExpressionMatrixInspection> => {
      if (!isH5AD) return inspectExpressionMatrix(expressionFile);

      const formData = new FormData();
      formData.append("expression_matrix", expressionFile);
      const response = await apiFetch(`${API_BASE}/uploads/inspect-expression`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as H5ADInspectionPayload;
      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.errors?.length
            ? payload.errors.join("\n")
            : "AnnData inspection failed.",
        );
      }

      const matrices: ExpressionMatrixOption[] = (payload.matrices ?? []).map(
        (matrix) => ({
          key: matrix.key,
          label: matrix.label,
          geneCount: matrix.gene_count,
          cellCount: matrix.cell_count,
          geneNames: matrix.gene_names,
          detection: matrix.detection,
          default: matrix.default,
        }),
      );
      const selectedKey = payload.selected_matrix ?? matrices[0]?.key ?? "X";
      const selected = matrices.find((matrix) => matrix.key === selectedKey);
      if (!selected) throw new Error("AnnData did not expose a usable expression matrix.");

      return {
        label: `${selected.geneCount.toLocaleString()} genes × ${selected.cellCount.toLocaleString()} cells`,
        format: "h5ad",
        geneCount: selected.geneCount,
        cellCount: selected.cellCount,
        geneNames: selected.geneNames,
        detection: selected.detection,
        selectedMatrix: selected.key,
        matrices,
      };
    };

    void inspectUploadedExpression()
      .then(async (inspection) => {
        if (cancelled) return;

        setExpressionMatrixDimensions(inspection.label);
        setExpressionMatrixFormat(inspection.format ?? "csv");
        setExpressionMatrixLayer(inspection.selectedMatrix ?? "X");
        setExpressionMatrixOptions(inspection.matrices ?? []);
        setGeneCount(inspection.geneCount);
        setCellCount(inspection.cellCount);
        setMatrixStateDetection(inspection.detection);
        // Only auto-apply the detected scaling when we're reasonably sure. A
        // low-confidence guess is left blank so the user must confirm it — a
        // wrong guess here would double-log and silently corrupt the run.
        if (
          inspection.detection.detectedState &&
          inspection.detection.confidence !== "low"
        ) {
          setMatrixState(inspection.detection.detectedState);
        }

        try {
          const response = await apiFetch(`${API_BASE}/uploads/infer-species`, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ gene_names: inspection.geneNames }),
          });
          const payload = (await response.json()) as SpeciesInferencePayload;
          if (
            !cancelled &&
            response.ok &&
            payload.inference?.species &&
            speciesSelectionSourceRef.current !== "manual" &&
            speciesSelectionSourceRef.current !== "prefill"
          ) {
            speciesSelectionSourceRef.current = "automatic";
            setDatasetSpecies(payload.inference.species);
          }
        } catch {
          // Species remains a compact manual selection when inference is
          // unavailable or inconclusive.
        } finally {
          if (!cancelled) setIsSpeciesDetecting(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExpressionMatrixDimensions("Dimensions unavailable");
          setGeneCount(null);
          setCellCount(null);
          setMatrixStateDetection({
            detectedState: null,
            confidence: "low",
            reasons: ["Automatic detection could not inspect this file."],
          });
          setIsSpeciesDetecting(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsMatrixStateDetecting(false);
          setIsExpressionMatrixInspecting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [API_BASE, expressionFile]);

  const handleSelectExpressionMatrixLayer = useCallback(
    (matrixKey: string) => {
      const selected = expressionMatrixOptions.find(
        (matrix) => matrix.key === matrixKey,
      );
      if (!selected) return;

      setExpressionMatrixLayer(selected.key);
      setExpressionMatrixDimensions(
        `${selected.geneCount.toLocaleString()} genes × ${selected.cellCount.toLocaleString()} cells`,
      );
      setGeneCount(selected.geneCount);
      setCellCount(selected.cellCount);
      setMatrixStateDetection(selected.detection);
      setMatrixState(
        selected.detection.detectedState &&
          selected.detection.confidence !== "low"
          ? selected.detection.detectedState
          : "",
      );
    },
    [expressionMatrixOptions],
  );

  const [includeAllTFs, setIncludeAllTFs] = useState(true);
  const [customTfListFile, setCustomTfListFile] = useState<File | null>(null);
  const [customTfListFileName, setCustomTfListFileName] = useState("");
  const [detectionThreshold, setDetectionThreshold] = useState("10");
  const [enabledGeneSelectionStages, setEnabledGeneSelectionStages] = useState<
    GeneSelectionStage[]
  >(["detection"]);
  const [hvgGeneCount, setHvgGeneCount] = useState("500");
  const [geneOrderingSource, setGeneOrderingSource] = useState<"calculate" | "upload">(
    "calculate",
  );
  const [geneOrderingFile, setGeneOrderingFile] = useState<File | null>(null);
  const [geneOrderingFileName, setGeneOrderingFileName] = useState("");
  const [trajectoryPValue, setTrajectoryPValue] = useState("0.01");
  const [trajectoryBonferroni, setTrajectoryBonferroni] = useState(true);
  const [includeSignificantTFs, setIncludeSignificantTFs] = useState(true);
  const [maxEdgesPerTarget, setMaxEdgesPerTarget] = useState(DEFAULT_MAX_EDGES_PER_TARGET);
  const [confidenceRunMode, setConfidenceRunMode] = useState<
    "automatic" | "fixed"
  >(DEFAULT_CONFIDENCE_RUN_MODE);
  const [confidenceBootstrapRuns, setConfidenceBootstrapRuns] =
    useState(DEFAULT_CONFIDENCE_RUNS);
  const [cellOracleSpecies, setCellOracleSpecies] = useState("human");
  const [hasCellOracleSettingsConfigured, setHasCellOracleSettingsConfigured] = useState(false);

  useEffect(() => {
    if (datasetSpecies && datasetSpecies !== "other") {
      setCellOracleSpecies(datasetSpecies);
      setCustomTfListFile(null);
      setCustomTfListFileName("");
    }
  }, [datasetSpecies]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hasUserAdjustedAlgorithms, setHasUserAdjustedAlgorithms] = useState(false);
  // Per-algorithm parameter overrides ({ algorithmId: { paramName: value } }).
  // Only holds values the user changed from the recommended default; an
  // algorithm absent here runs entirely on platform defaults.
  const [algorithmParameters, setAlgorithmParameters] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [ensembleEnabled, setEnsembleEnabled] = useState(true);
  const [algorithms, setAlgorithms] = useState<ProjectAlgorithm[]>([]);
  const [isLoadingAlgorithms, setIsLoadingAlgorithms] = useState(true);
  const [algorithmLoadError, setAlgorithmLoadError] = useState<string | null>(null);

  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const lastAutoProjectNameRef = useRef("");

  // Reset everything whenever the modal transitions from closed → open. This
  // gives the workspace and landing page paths an identical clean-slate start.
  useEffect(() => {
    if (!open) return;
    setIsClosing(false);
    setErrors([]);
    setProjectName(initialValues?.projectName ?? "");
    setExpressionFile(null);
    setPseudotimeFile(null);
    setGroundTruthFile(null);
    setEstimatePseudotime(false);
    setClusterLabelsFile(null);
    setExpressionFileName("");
    setExpressionMatrixFormat("csv");
    setExpressionMatrixLayer("X");
    setExpressionMatrixOptions([]);
    setPseudotimeFileName("");
    setGroundTruthFileName("");
    setClusterLabelsFileName("");
    setIncludeAllTFs(initialValues?.includeAllTFs ?? true);
    setMatrixState("");
    setMatrixStateDetection(null);
    setIsMatrixStateDetecting(false);
    const initialDatasetSpecies = initialValues?.datasetSpecies ?? "";
    setDatasetSpecies(initialDatasetSpecies);
    speciesSelectionSourceRef.current = initialDatasetSpecies ? "prefill" : null;
    setIsSpeciesDetecting(false);
    setCustomTfListFile(null);
    setCustomTfListFileName("");
    setDetectionThreshold(initialValues?.detectionThreshold ?? "10");
    setEnabledGeneSelectionStages(
      initialValues?.enabledGeneSelectionStages ?? ["detection"],
    );
    setHvgGeneCount(initialValues?.hvgGeneCount ?? "500");
    setGeneOrderingSource(initialValues?.geneOrderingSource ?? "calculate");
    setGeneOrderingFile(null);
    setGeneOrderingFileName("");
    setTrajectoryPValue(initialValues?.trajectoryPValue ?? "0.01");
    setTrajectoryBonferroni(initialValues?.trajectoryBonferroni ?? true);
    setIncludeSignificantTFs(initialValues?.includeSignificantTFs ?? true);
    setMaxEdgesPerTarget(initialValues?.maxEdgesPerTarget ?? DEFAULT_MAX_EDGES_PER_TARGET);
    setConfidenceRunMode(
      initialValues?.confidenceRunMode ?? DEFAULT_CONFIDENCE_RUN_MODE,
    );
    setConfidenceBootstrapRuns(
      initialValues?.confidenceBootstrapRuns ?? DEFAULT_CONFIDENCE_RUNS,
    );
    setCellOracleSpecies(
      initialDatasetSpecies && initialDatasetSpecies !== "other"
        ? initialDatasetSpecies
        : initialValues?.cellOracleSpecies ?? "human",
    );
    setHasCellOracleSettingsConfigured(
      Boolean(initialValues?.selectedIds?.includes("CELLORACLE")),
    );
    setSelectedIds(initialValues?.selectedIds ?? []);
    setHasUserAdjustedAlgorithms(Boolean(initialValues?.selectedIds?.length));
    setAlgorithmParameters(initialValues?.algorithmParameters ?? {});
    setEnsembleEnabled(initialValues?.ensembleEnabled ?? true);
    setIsSubmitting(false);
    lastAutoProjectNameRef.current = "";
  }, [initialValues, open]);

  const loadAlgorithms = useCallback(async () => {
    try {
      setIsLoadingAlgorithms(true);
      setAlgorithmLoadError(null);

      const response = await fetch(`${API_BASE}/algorithms`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(
          response.status >= 500
            ? "The analysis service is temporarily unavailable."
            : `Failed to load algorithms (${response.status}).`,
        );
      }
      const data = (await response.json()) as BackendAlgorithmEntry[];
      setAlgorithms(
        data
          .filter((algorithm) => algorithm.active)
          .map(mapBackendAlgorithm),
      );
    } catch (error) {
      setAlgorithmLoadError(
        error instanceof Error ? error.message : "Failed to load algorithms.",
      );
      setAlgorithms([]);
    } finally {
      setIsLoadingAlgorithms(false);
    }
  }, [API_BASE]);

  // Refresh the catalog whenever the creation flow is opened. This lets the
  // modal recover if the backend was still starting during an earlier attempt.
  useEffect(() => {
    if (open) void loadAlgorithms();
  }, [loadAlgorithms, open]);

  // Effective gene count after the gene-filtering setting (used to bound the
  // "Max edges per target" input: max = min(effectiveGenes, 100)).
  const effectiveGeneCount = useMemo(() => {
    if (geneCount === null) return null;
    if (!enabledGeneSelectionStages.includes("variance")) {
      return Math.min(geneCount, MAX_PREPROCESSED_GENES);
    }
    const parsed = Number(hvgGeneCount.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return Math.min(geneCount, MAX_PREPROCESSED_GENES);
    }
    return Math.min(parsed, geneCount, MAX_PREPROCESSED_GENES);
  }, [enabledGeneSelectionStages, geneCount, hvgGeneCount]);

  const maxEdgesLimit = useMemo(
    () =>
      effectiveGeneCount === null
        ? RANKED_EDGES_HARD_MAX
        : Math.max(1, Math.min(effectiveGeneCount, RANKED_EDGES_HARD_MAX)),
    [effectiveGeneCount],
  );
  const pidcDefaultMaxGenes = useMemo(
    () =>
      effectiveGeneCount !== null && effectiveGeneCount >= 3
        ? Math.min(500, effectiveGeneCount)
        : 500,
    [effectiveGeneCount],
  );
  const sinceritiesDefaultMaxGenes = useMemo(() => {
    const cellAwareLimit =
      cellCount !== null
        ? Math.max(2, Math.floor(cellCount * SINCERITIES_SAFE_CELL_FRACTION))
        : SINCERITIES_DEFAULT_MAX_GENES;
    return effectiveGeneCount !== null && effectiveGeneCount >= 2
      ? Math.min(
          SINCERITIES_DEFAULT_MAX_GENES,
          effectiveGeneCount,
          cellAwareLimit,
        )
      : Math.min(SINCERITIES_DEFAULT_MAX_GENES, cellAwareLimit);
  }, [cellCount, effectiveGeneCount]);
  const scribeDefaultMaxGenes = useMemo(
    () =>
      effectiveGeneCount !== null && effectiveGeneCount >= 3
        ? Math.min(SCRIBE_DEFAULT_MAX_GENES, effectiveGeneCount)
        : SCRIBE_DEFAULT_MAX_GENES,
    [effectiveGeneCount],
  );
  const singeDefaultMaxGenes = useMemo(
    () =>
      effectiveGeneCount !== null && effectiveGeneCount >= 3
        ? Math.min(SINGE_DEFAULT_MAX_GENES, effectiveGeneCount)
        : SINGE_DEFAULT_MAX_GENES,
    [effectiveGeneCount],
  );
  const grnvbemDefaultMaxGenes = useMemo(
    () =>
      effectiveGeneCount !== null && effectiveGeneCount >= 3
        ? Math.min(GRNVBEM_DEFAULT_MAX_GENES, effectiveGeneCount)
        : GRNVBEM_DEFAULT_MAX_GENES,
    [effectiveGeneCount],
  );
  const grisliDefaultMaxGenes = useMemo(
    () =>
      effectiveGeneCount !== null && effectiveGeneCount >= 3
        ? Math.min(GRISLI_DEFAULT_MAX_GENES, effectiveGeneCount)
        : GRISLI_DEFAULT_MAX_GENES,
    [effectiveGeneCount],
  );

  // Keep the edge cap within its dynamic max as gene filtering changes; this also
  // lowers the default to the gene count when there are fewer than 20 genes.
  useEffect(() => {
    const parsed = Number(maxEdgesPerTarget);
    if (Number.isInteger(parsed) && parsed > maxEdgesLimit) {
      setMaxEdgesPerTarget(String(maxEdgesLimit));
    }
  }, [maxEdgesLimit, maxEdgesPerTarget]);

  const datasetSummary = useMemo(
    () => ({
      dimensions: "Matrix validation runs after project creation",
      // Trajectory methods are available when the user has (or will have via
      // estimation) a pseudotime.
      hasPseudotime: Boolean(pseudotimeFile) || estimatePseudotime,
      hasClusterLabels: Boolean(clusterLabelsFile),
      hasCellOracleSettingsConfigured,
      hasGroundTruth: Boolean(groundTruthFile),
      preprocessingSummary: [
        `Matrix values: ${matrixState || "not selected"}`,
        `Dataset species: ${datasetSpecies || "not selected"}`,
        `Detection threshold: ${detectionThreshold}%`,
        `Enabled stages: ${enabledGeneSelectionStages.join(", ") || "none"}`,
        `Transcription factor override: ${includeAllTFs ? "enabled" : "disabled"}`,
      ],
    }),
    [
      pseudotimeFile,
      estimatePseudotime,
      clusterLabelsFile,
      groundTruthFile,
      matrixState,
      datasetSpecies,
      detectionThreshold,
      enabledGeneSelectionStages,
      includeAllTFs,
      hasCellOracleSettingsConfigured,
    ],
  );

  const compatibleAlgorithms = useMemo(
    () =>
      algorithms.filter((algorithm) => {
        const hasRequiredPseudotime =
          !algorithm.requiresPseudotime || datasetSummary.hasPseudotime;
        const hasRequiredGroundTruth =
          algorithm.id !== "SCSGL" || datasetSummary.hasGroundTruth;
        const hasRequiredCellOracleInputs =
          algorithm.id !== "CELLORACLE" || datasetSummary.hasCellOracleSettingsConfigured;
        return hasRequiredPseudotime && hasRequiredGroundTruth && hasRequiredCellOracleInputs;
      }),
    [
      algorithms,
      datasetSummary.hasCellOracleSettingsConfigured,
      datasetSummary.hasGroundTruth,
      datasetSummary.hasPseudotime,
    ],
  );

  const selectedAlgorithms = useMemo(
    () => compatibleAlgorithms.filter((algorithm) => selectedIds.includes(algorithm.id)),
    [compatibleAlgorithms, selectedIds],
  );

  // Auto-fill project name from the uploaded filename, but only when the user
  // hasn't typed something custom.
  useEffect(() => {
    if (!expressionFileName) {
      setProjectName((current) => {
        const wasAutoFilled =
          current.trim() !== "" && current.trim() === lastAutoProjectNameRef.current;
        lastAutoProjectNameRef.current = "";
        return wasAutoFilled ? "" : current;
      });
      return;
    }
    const baseName = expressionFileName.replace(/\.(csv|h5ad)$/i, "").trim();
    if (!baseName) return;

    setProjectName((current) => {
      const trimmed = current.trim();
      const isAutoFilled =
        trimmed === "" || trimmed === lastAutoProjectNameRef.current;
      if (!isAutoFilled) return current;
      lastAutoProjectNameRef.current = baseName;
      return baseName;
    });
  }, [expressionFileName]);

  // Auto-select all compatible algorithms by default. Stops syncing once the
  // user manually toggles anything in the algorithm grid.
  useEffect(() => {
    if (hasUserAdjustedAlgorithms) return;
    if (compatibleAlgorithms.length === 0) return;
    const allCompatibleIds = compatibleAlgorithms.map((a) => a.id);
    setSelectedIds(allCompatibleIds);
    setEnsembleEnabled(allCompatibleIds.length >= 2);
  }, [compatibleAlgorithms, hasUserAdjustedAlgorithms]);

  const toggleAlgorithm = (algorithmId: string, disabled: boolean) => {
    if (disabled) return;
    setHasUserAdjustedAlgorithms(true);
    setSelectedIds((current) => {
      if (current.includes(algorithmId)) {
        const updated = current.filter((id) => id !== algorithmId);
        if (updated.length < 2) setEnsembleEnabled(false);
        return updated;
      }
      const updated = [...current, algorithmId];
      if (updated.length >= 2) setEnsembleEnabled(true);
      return updated;
    });
  };

  // Store only non-default parameter overrides for an algorithm. Passing an
  // empty map removes the entry so the algorithm reverts to platform defaults.
  const applyAlgorithmParameters = (
    algorithmId: string,
    overrides: Record<string, unknown>,
  ) => {
    setAlgorithmParameters((current) => {
      const next = { ...current };
      if (Object.keys(overrides).length === 0) {
        delete next[algorithmId];
      } else {
        next[algorithmId] = overrides;
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const allCompatibleIds = compatibleAlgorithms.map((algorithm) => algorithm.id);
    setSelectedIds(allCompatibleIds);
    setEnsembleEnabled(allCompatibleIds.length >= 2);
  };

  const clearPseudotimeFile = () => {
    setPseudotimeFile(null);
    setPseudotimeFileName("");
  };

  const clearGroundTruthFile = () => {
    setGroundTruthFile(null);
    setGroundTruthFileName("");
  };

  // Uploading a pseudotime file and estimating one are mutually exclusive.
  const handleSetPseudotimeFile = (file: File | null) => {
    setPseudotimeFile(file);
    if (file) setEstimatePseudotime(false);
  };

  const handleToggleEstimatePseudotime = (next: boolean) => {
    setEstimatePseudotime(next);
    if (next) {
      setPseudotimeFile(null);
      setPseudotimeFileName("");
    }
  };

  const clearClusterLabelsFile = () => {
    setClusterLabelsFile(null);
    setClusterLabelsFileName("");
  };

  const handleSetDatasetSpecies = (nextSpecies: string) => {
    speciesSelectionSourceRef.current = "manual";
    setDatasetSpecies(nextSpecies);
    if (nextSpecies && nextSpecies !== "other") {
      setCellOracleSpecies(nextSpecies);
    }
    if (nextSpecies !== "other") {
      setCustomTfListFile(null);
      setCustomTfListFileName("");
    }
  };

  const createPendingProject = async (safeSelectedIds: string[]) => {
    const formData = new FormData();
    formData.append("project_name", projectName);
    formData.append("matrix_state", matrixState);
    formData.append(
      "matrix_state_source",
      "automatic",
    );
    formData.append("dataset_species", datasetSpecies);
    formData.append(
      "enabled_gene_selection_stages",
      JSON.stringify(enabledGeneSelectionStages),
    );
    formData.append("detection_threshold_percent", detectionThreshold);
    formData.append("variance_gene_count", hvgGeneCount);
    formData.append("include_known_tfs", JSON.stringify(includeAllTFs));
    formData.append("gene_ordering_source", geneOrderingSource);
    formData.append("gene_ordering_filename", geneOrderingFileName);
    formData.append("trajectory_p_value", trajectoryPValue);
    formData.append("trajectory_bonferroni", JSON.stringify(trajectoryBonferroni));
    formData.append("include_significant_tfs", JSON.stringify(includeSignificantTFs));
    formData.append("ranked_edges_per_target", maxEdgesPerTarget.trim());
    formData.append("confidence_run_mode", confidenceRunMode);
    formData.append(
      "confidence_bootstrap_runs",
      confidenceRunMode === "automatic"
        ? String(CONFIDENCE_RUN_MAX)
        : confidenceBootstrapRuns.trim(),
    );
    formData.append(
      "confidence_evidence_threshold",
      "0.8",
    );
    formData.append("selected_algorithms", JSON.stringify(safeSelectedIds));
    // Only submit overrides for algorithms that are actually selected.
    const selectedParameterOverrides: Record<string, Record<string, unknown>> = {};
    for (const algorithmId of safeSelectedIds) {
      const overrides = { ...(algorithmParameters[algorithmId] ?? {}) };
      if (algorithmId === "PIDC" && overrides.maxGenes === undefined) {
        overrides.maxGenes = pidcDefaultMaxGenes;
      }
      if (algorithmId === "SINCERITIES" && overrides.maxGenes === undefined) {
        overrides.maxGenes = sinceritiesDefaultMaxGenes;
      }
      if (algorithmId === "SCRIBE" && overrides.maxGenes === undefined) {
        overrides.maxGenes = scribeDefaultMaxGenes;
      }
      if (algorithmId === "SINGE" && overrides.maxGenes === undefined) {
        overrides.maxGenes = singeDefaultMaxGenes;
      }
      if (algorithmId === "GRNVBEM" && overrides.maxGenes === undefined) {
        overrides.maxGenes = grnvbemDefaultMaxGenes;
      }
      if (algorithmId === "GRISLI" && overrides.maxGenes === undefined) {
        overrides.maxGenes = grisliDefaultMaxGenes;
      }
      if (Object.keys(overrides).length > 0) {
        selectedParameterOverrides[algorithmId] = overrides;
      }
    }
    formData.append("algorithm_parameters", JSON.stringify(selectedParameterOverrides));
    formData.append("ensemble_enabled", JSON.stringify(ensembleEnabled));
    formData.append("celloracle_species", cellOracleSpecies);
    formData.append("celloracle_base_grn", CELLORACLE_INTERNAL_BASE_GRN);
    formData.append("expression_filename", expressionFileName);
    formData.append("expression_matrix_layer", expressionMatrixLayer);
    formData.append("pseudotime_filename", pseudotimeFileName);
    formData.append("ground_truth_filename", groundTruthFileName);
    formData.append("cluster_labels_filename", clusterLabelsFileName);
    formData.append("custom_tf_list_filename", customTfListFileName);
    formData.append("estimate_pseudotime", JSON.stringify(estimatePseudotime));

    const response = await apiFetch(`${API_BASE}/projects/create-pending`, {
      method: "POST",
      body: formData,
    });
    const data = await readCreateProjectResponse(response);

    if (!response.ok || !data?.ok || !data.project_id || !data.job_id) {
      throw new Error(
        data?.errors?.length ? data.errors.join("\n") : "Project creation failed.",
      );
    }

    return {
      project_id: data.project_id,
      job_id: data.job_id,
    };
  };

  const handleStartAnalysis = async () => {
    const validationErrors: string[] = [];
    const maxFileSize = 500 * 1024 * 1024;
    const compatibleAlgorithmIds = new Set(
      compatibleAlgorithms.map((algorithm) => algorithm.id),
    );
    const selectedCompatibleIds = selectedIds.filter((id) =>
      compatibleAlgorithmIds.has(id),
    );
    const selectedCompatibleAlgorithms = compatibleAlgorithms.filter((algorithm) =>
      selectedCompatibleIds.includes(algorithm.id),
    );

    if (!projectName.trim()) {
      validationErrors.push("Project name is required.");
    }
    if (!expressionFile) {
      validationErrors.push(
        "Upload an expression matrix CSV or AnnData (.h5ad) file to continue.",
      );
    } else {
      const expressionFileNameLower = expressionFile.name.toLowerCase();
      if (
        !expressionFileNameLower.endsWith(".csv") &&
        !expressionFileNameLower.endsWith(".h5ad")
      ) {
        validationErrors.push(
          "Expression matrix must be a CSV or AnnData (.h5ad) file.",
        );
      }
      if (expressionFile.size > maxFileSize) {
        validationErrors.push("Expression matrix file size must be 500 MB or smaller.");
      }
    }
    if (!matrixState) {
      validationErrors.push(
        matrixStateDetection?.reasons[0] ??
          "The expression matrix state could not be detected automatically.",
      );
    }
    if (!datasetSpecies) {
      validationErrors.push("Select the species represented by the matrix.");
    }
    if (selectedIds.includes("CELLORACLE") && datasetSpecies === "other") {
      validationErrors.push(
        "CellOracle requires a supported dataset species for its built-in prior.",
      );
    }
    if (customTfListFile) {
      if (!customTfListFile.name.toLowerCase().endsWith(".csv")) {
        validationErrors.push("Custom TF list must be a CSV file.");
      }
      if (customTfListFile.size > maxFileSize) {
        validationErrors.push("Custom TF list file size must be 500 MB or smaller.");
      }
    }
    if (pseudotimeFile) {
      if (!pseudotimeFile.name.toLowerCase().endsWith(".csv")) {
        validationErrors.push("Pseudotime file must be a CSV file.");
      }
      if (pseudotimeFile.size > maxFileSize) {
        validationErrors.push("Pseudotime file size must be 500 MB or smaller.");
      }
    }
    if (groundTruthFile) {
      if (!groundTruthFile.name.toLowerCase().endsWith(".csv")) {
        validationErrors.push("Ground-truth network must be a CSV file.");
      }
      if (groundTruthFile.size > maxFileSize) {
        validationErrors.push("Ground-truth network file size must be 500 MB or smaller.");
      }
    }
    if (clusterLabelsFile) {
      if (!clusterLabelsFile.name.toLowerCase().endsWith(".csv")) {
        validationErrors.push("Cluster labels file must be a CSV file.");
      }
      if (clusterLabelsFile.size > maxFileSize) {
        validationErrors.push("Cluster labels file size must be 500 MB or smaller.");
      }
    }

    const parsedDetectionThreshold = Number(detectionThreshold);
    if (
      !Number.isFinite(parsedDetectionThreshold) ||
      parsedDetectionThreshold <= 0 ||
      parsedDetectionThreshold > 100
    ) {
      validationErrors.push("Detection threshold must be between 1 and 100 percent.");
    }
    const parsedHvgGenes = Number(hvgGeneCount);
    if (!Number.isInteger(parsedHvgGenes) || parsedHvgGenes <= 0) {
      validationErrors.push("Highly variable gene count must be a positive integer.");
    }
    if (enabledGeneSelectionStages.includes("trajectory")) {
      if (geneOrderingSource === "upload" && !geneOrderingFile) {
        validationErrors.push("Upload a GeneOrdering CSV or choose Calculate for me.");
      }
    }
    const parsedPValue = Number(trajectoryPValue);
    if (!Number.isFinite(parsedPValue) || parsedPValue <= 0 || parsedPValue > 1) {
      validationErrors.push("Trajectory p-value threshold must be greater than 0 and at most 1.");
    }

    const trimmedMaxEdges = maxEdgesPerTarget.trim();
    const parsedMaxEdges = Number(trimmedMaxEdges);
    if (!trimmedMaxEdges || !Number.isInteger(parsedMaxEdges) || parsedMaxEdges < 1) {
      validationErrors.push("Max edges per target must be a positive integer.");
    } else if (parsedMaxEdges > maxEdgesLimit) {
      validationErrors.push(
        `Max edges per target cannot be larger than ${maxEdgesLimit.toLocaleString()}.`,
      );
    }

    if (confidenceRunMode === "fixed") {
      const parsedConfidenceRuns = Number(confidenceBootstrapRuns.trim());
      if (
        !Number.isInteger(parsedConfidenceRuns) ||
        parsedConfidenceRuns < CONFIDENCE_RUN_MIN ||
        parsedConfidenceRuns > CONFIDENCE_RUN_MAX
      ) {
        validationErrors.push(
          `Fixed confidence runs must be between ${CONFIDENCE_RUN_MIN} and ${CONFIDENCE_RUN_MAX}.`,
        );
      }
    }

    if (isLoadingAlgorithms) {
      validationErrors.push("Algorithms are still loading. Please wait a moment and try again.");
    } else if (algorithmLoadError) {
      validationErrors.push(`Could not load algorithms from backend: ${algorithmLoadError}`);
    } else if (selectedCompatibleIds.length === 0) {
      validationErrors.push("Select at least one compatible algorithm to continue.");
    }

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    const safeSelectedIds = selectedCompatibleAlgorithms.map((algorithm) => algorithm.id);

    try {
      setIsSubmitting(true);
      setErrors([]);
      const data = await createPendingProject(safeSelectedIds);
      if (!expressionFile) {
        throw new Error(
          "Upload an expression matrix CSV or AnnData (.h5ad) file to continue.",
        );
      }

      // Start the upload before navigation so there is no route-transition gap
      // in which the browser could lose the in-memory File objects. The detail
      // page adopts this same promise and surfaces any setup failure.
      registerPendingProjectUpload(data.project_id, {
        expressionFile,
        pseudotimeFile,
        groundTruthFile,
        clusterLabelsFile,
        geneOrderingFile:
          enabledGeneSelectionStages.includes("trajectory") &&
          geneOrderingSource === "upload"
            ? geneOrderingFile
            : null,
        customTfListFile:
          datasetSpecies === "other" ? customTfListFile : null,
      });
      const uploadPromise = startPendingProjectUpload(data.project_id, API_BASE);
      if (!uploadPromise) {
        throw new Error("Dataset upload could not be started.");
      }
      void uploadPromise.catch(() => undefined);

      const now = new Date();
      const createdProject: Project = {
        id: data.project_id,
        name: projectName,
        description: "Single-cell RNA-seq dataset for GRN inference.",
        createdAt: now
          .toLocaleString("en-CA", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
          .replace(",", ""),
        createdAtTimestamp: now.getTime() / 1000,
        datasetCount: 1,
        geneCount,
        cellCount,
        jobCount: 1,
        latestJob: {
          job_id: data.job_id,
          overall_status: "Queued",
          ensemble_enabled: ensembleEnabled,
          tasks: safeSelectedIds.map((algorithmId) => ({
            algorithm_id: algorithmId,
            status: "Queued",
            elapsed_seconds: 0,
            error_message: null,
            error_type: null,
            started_at: null,
            started_at_timestamp: null,
            completed_at: null,
            completed_at_timestamp: null,
            progress_percent: 0,
            progress_label: "Waiting for dataset upload",
          })),
        },
      };

      onClose();
      onProjectCreated?.(createdProject);
    } catch (error) {
      setErrors([
        error instanceof Error && error.message
          ? error.message
          : "Could not connect to the server.",
      ]);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <CreateProjectModal
      isCreateVisible={open}
      isCreateClosing={isClosing}
      projectName={projectName}
      expressionFileName={expressionFileName}
      expressionMatrixFormat={expressionMatrixFormat}
      expressionMatrixLayer={expressionMatrixLayer}
      expressionMatrixOptions={expressionMatrixOptions.map((matrix) => ({
        value: matrix.key,
        label: matrix.label,
      }))}
      expressionMatrixDimensions={expressionMatrixDimensions}
      isExpressionMatrixInspecting={isExpressionMatrixInspecting}
      pseudotimeFileName={pseudotimeFileName}
      groundTruthFileName={groundTruthFileName}
      clusterLabelsFileName={clusterLabelsFileName}
      matrixState={matrixState}
      setMatrixState={setMatrixState}
      isMatrixStateDetecting={isMatrixStateDetecting}
      datasetSpecies={datasetSpecies}
      isSpeciesDetecting={isSpeciesDetecting}
      customTfListFileName={customTfListFileName}
      detectionThreshold={detectionThreshold}
      enabledGeneSelectionStages={enabledGeneSelectionStages}
      hvgGeneCount={hvgGeneCount}
      geneOrderingSource={geneOrderingSource}
      geneOrderingFileName={geneOrderingFileName}
      trajectoryPValue={trajectoryPValue}
      trajectoryBonferroni={trajectoryBonferroni}
      includeSignificantTFs={includeSignificantTFs}
      includeAllTFs={includeAllTFs}
      maxEdgesPerTarget={maxEdgesPerTarget}
      maxEdgesLimit={maxEdgesLimit}
      confidenceRunMode={confidenceRunMode}
      confidenceBootstrapRuns={confidenceBootstrapRuns}
      confidenceRunMin={CONFIDENCE_RUN_MIN}
      confidenceRunMax={CONFIDENCE_RUN_MAX}
      pidcDefaultMaxGenes={pidcDefaultMaxGenes}
      sinceritiesDefaultMaxGenes={sinceritiesDefaultMaxGenes}
      scribeDefaultMaxGenes={scribeDefaultMaxGenes}
      singeDefaultMaxGenes={singeDefaultMaxGenes}
      grnvbemDefaultMaxGenes={grnvbemDefaultMaxGenes}
      grisliDefaultMaxGenes={grisliDefaultMaxGenes}
      cellOracleSpecies={cellOracleSpecies}
      hasCellOracleSettingsConfigured={hasCellOracleSettingsConfigured}
      selectedIds={selectedIds}
      algorithmParameters={algorithmParameters}
      onApplyAlgorithmParameters={applyAlgorithmParameters}
      compatibleAlgorithms={compatibleAlgorithms}
      selectedAlgorithms={selectedAlgorithms}
      datasetSummary={datasetSummary}
      errors={errors}
      isSubmitting={isSubmitting}
      algorithms={algorithms}
      isLoadingAlgorithms={isLoadingAlgorithms}
      algorithmLoadError={algorithmLoadError}
      onRetryAlgorithms={loadAlgorithms}
      onClose={onClose}
      onStartAnalysis={handleStartAnalysis}
      onSelectAll={handleSelectAll}
      onToggleAlgorithm={toggleAlgorithm}
      setProjectName={setProjectName}
      setDatasetSpecies={handleSetDatasetSpecies}
      setCustomTfListFile={setCustomTfListFile}
      setCustomTfListFileName={setCustomTfListFileName}
      setDetectionThreshold={setDetectionThreshold}
      setEnabledGeneSelectionStages={setEnabledGeneSelectionStages}
      setHvgGeneCount={setHvgGeneCount}
      setGeneOrderingSource={setGeneOrderingSource}
      setGeneOrderingFile={setGeneOrderingFile}
      setGeneOrderingFileName={setGeneOrderingFileName}
      setTrajectoryPValue={setTrajectoryPValue}
      setTrajectoryBonferroni={setTrajectoryBonferroni}
      setIncludeSignificantTFs={setIncludeSignificantTFs}
      onExpressionMatrixLayerChange={handleSelectExpressionMatrixLayer}
      estimatePseudotime={estimatePseudotime}
      onToggleEstimatePseudotime={handleToggleEstimatePseudotime}
      setExpressionFile={setExpressionFile}
      setExpressionFileName={setExpressionFileName}
      setPseudotimeFile={handleSetPseudotimeFile}
      setPseudotimeFileName={setPseudotimeFileName}
      setGroundTruthFile={setGroundTruthFile}
      setGroundTruthFileName={setGroundTruthFileName}
      setClusterLabelsFile={setClusterLabelsFile}
      setClusterLabelsFileName={setClusterLabelsFileName}
      setIncludeAllTFs={setIncludeAllTFs}
      setMaxEdgesPerTarget={setMaxEdgesPerTarget}
      setConfidenceRunMode={setConfidenceRunMode}
      setConfidenceBootstrapRuns={setConfidenceBootstrapRuns}
      setHasCellOracleSettingsConfigured={setHasCellOracleSettingsConfigured}
      clearPseudotimeFile={clearPseudotimeFile}
      clearGroundTruthFile={clearGroundTruthFile}
      clearClusterLabelsFile={clearClusterLabelsFile}
    />
  );
}
