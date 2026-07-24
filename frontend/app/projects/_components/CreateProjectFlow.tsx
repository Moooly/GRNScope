"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CreateProjectModal from "./CreateProjectModal";
import type { AlgorithmParameter, ProjectAlgorithm } from "../page";
import type { Project } from "../_types/project";
import { getApiBase } from "../../_lib/apiConfig";
import { apiFetch } from "../../_lib/clientIdentity";
import {
  registerPendingProjectUpload,
} from "../_lib/pendingProjectUpload";

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

const DEFAULT_TOP_VARIABLE_GENES = "all";
const ALL_GENES_VALUE = "all";
const MAX_PREPROCESSED_GENES = 8000;
const RANKED_EDGES_HARD_MAX = 100;
const DEFAULT_MAX_EDGES_PER_TARGET = "20";
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
  topVariableGenes?: string;
  includeAllTFs?: boolean;
  normalizeEnabled?: boolean;
  logTransformEnabled?: boolean;
  maxEdgesPerTarget?: string;
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
  const [estimatePseudotime, setEstimatePseudotime] = useState(false);
  const [clusterLabelsFile, setClusterLabelsFile] = useState<File | null>(null);
  const [expressionFileName, setExpressionFileName] = useState("");
  const [pseudotimeFileName, setPseudotimeFileName] = useState("");
  const [clusterLabelsFileName, setClusterLabelsFileName] = useState("");

  // Matrix contents are intentionally not parsed in the creation modal.
  // Validation and dimension discovery happen after navigation on the detail page.
  const geneCount: number | null = null;
  const cellCount: number | null = null;

  const [topVariableGenes, setTopVariableGenes] = useState(DEFAULT_TOP_VARIABLE_GENES);
  const [includeAllTFs, setIncludeAllTFs] = useState(true);
  const [matrixState, setMatrixState] = useState("");
  const [datasetSpecies, setDatasetSpecies] = useState("");
  const [detectionThreshold, setDetectionThreshold] = useState("10");
  const [geneSelectionMethod, setGeneSelectionMethod] = useState<
    "none" | "hvg" | "trajectory"
  >("none");
  const [hvgGeneCount, setHvgGeneCount] = useState("500");
  const [geneOrderingSource, setGeneOrderingSource] = useState<"calculate" | "upload">(
    "calculate",
  );
  const [geneOrderingFile, setGeneOrderingFile] = useState<File | null>(null);
  const [geneOrderingFileName, setGeneOrderingFileName] = useState("");
  const [trajectoryPValue, setTrajectoryPValue] = useState("0.01");
  const [trajectoryBonferroni, setTrajectoryBonferroni] = useState(true);
  const [trajectoryGeneCount, setTrajectoryGeneCount] = useState("500");
  const [includeSignificantTFs, setIncludeSignificantTFs] = useState(true);
  const [maxEdgesPerTarget, setMaxEdgesPerTarget] = useState(DEFAULT_MAX_EDGES_PER_TARGET);
  const [cellOracleSpecies, setCellOracleSpecies] = useState("human");
  const [hasCellOracleSettingsConfigured, setHasCellOracleSettingsConfigured] = useState(false);
  const normalizeEnabled = matrixState === "raw";
  const logTransformEnabled = matrixState === "raw" || matrixState === "normalized";

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
    setEstimatePseudotime(false);
    setClusterLabelsFile(null);
    setExpressionFileName("");
    setPseudotimeFileName("");
    setClusterLabelsFileName("");
    setTopVariableGenes(initialValues?.topVariableGenes ?? DEFAULT_TOP_VARIABLE_GENES);
    setIncludeAllTFs(initialValues?.includeAllTFs ?? true);
    setMatrixState("");
    setDatasetSpecies("");
    setDetectionThreshold("10");
    setGeneSelectionMethod("none");
    setHvgGeneCount("500");
    setGeneOrderingSource("calculate");
    setGeneOrderingFile(null);
    setGeneOrderingFileName("");
    setTrajectoryPValue("0.01");
    setTrajectoryBonferroni(true);
    setTrajectoryGeneCount("500");
    setIncludeSignificantTFs(true);
    setMaxEdgesPerTarget(initialValues?.maxEdgesPerTarget ?? DEFAULT_MAX_EDGES_PER_TARGET);
    setCellOracleSpecies(initialValues?.cellOracleSpecies ?? "human");
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

  // Load the algorithm catalog once when the component mounts.
  useEffect(() => {
    let isCancelled = false;

    const loadAlgorithms = async () => {
      try {
        setIsLoadingAlgorithms(true);
        setAlgorithmLoadError(null);

        const response = await fetch(`${API_BASE}/algorithms`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`Failed to load algorithms: ${response.status}`);
        }
        const data = (await response.json()) as BackendAlgorithmEntry[];
        if (isCancelled) return;
        setAlgorithms(
          data
            .filter((algorithm) => algorithm.active)
            .map(mapBackendAlgorithm),
        );
      } catch (error) {
        if (!isCancelled) {
          setAlgorithmLoadError(
            error instanceof Error ? error.message : "Failed to load algorithms.",
          );
          setAlgorithms([]);
        }
      } finally {
        if (!isCancelled) setIsLoadingAlgorithms(false);
      }
    };

    void loadAlgorithms();
    return () => {
      isCancelled = true;
    };
  }, [API_BASE]);

  // Effective gene count after the gene-filtering setting (used to bound the
  // "Max edges per target" input: max = min(effectiveGenes, 100)).
  const effectiveGeneCount = useMemo(() => {
    if (geneCount === null) return null;
    const trimmed = topVariableGenes.trim().toLowerCase();
    if (!trimmed || trimmed === ALL_GENES_VALUE) {
      return Math.min(geneCount, MAX_PREPROCESSED_GENES);
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return Math.min(geneCount, MAX_PREPROCESSED_GENES);
    }
    return Math.min(parsed, geneCount, MAX_PREPROCESSED_GENES);
  }, [geneCount, topVariableGenes]);

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
      hasGroundTruth: false,
      preprocessingSummary: [
        `Matrix values: ${matrixState || "not selected"}`,
        `Dataset species: ${datasetSpecies || "not selected"}`,
        `Detection threshold: ${detectionThreshold}%`,
        `Additional selection: ${geneSelectionMethod}`,
        `Transcription factor override: ${includeAllTFs ? "enabled" : "disabled"}`,
      ],
    }),
    [
      pseudotimeFile,
      estimatePseudotime,
      clusterLabelsFile,
      matrixState,
      datasetSpecies,
      detectionThreshold,
      geneSelectionMethod,
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
    const baseName = expressionFileName.replace(/\.csv$/i, "").trim();
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

  const createPendingProject = async (safeSelectedIds: string[]) => {
    const formData = new FormData();
    formData.append("project_name", projectName);
    const legacyGeneLimit =
      geneSelectionMethod === "hvg"
        ? hvgGeneCount
        : geneSelectionMethod === "trajectory"
          ? trajectoryGeneCount
          : "all";
    formData.append("top_variable_genes", legacyGeneLimit);
    formData.append("include_all_tfs", JSON.stringify(includeAllTFs));
    formData.append("normalize_enabled", JSON.stringify(normalizeEnabled));
    formData.append("log_transform_enabled", JSON.stringify(logTransformEnabled));
    formData.append("matrix_state", matrixState);
    formData.append("dataset_species", datasetSpecies);
    formData.append("detection_threshold_percent", detectionThreshold);
    formData.append("gene_selection_method", geneSelectionMethod);
    formData.append("hvg_gene_count", hvgGeneCount);
    formData.append("gene_ordering_source", geneOrderingSource);
    formData.append("gene_ordering_filename", geneOrderingFileName);
    formData.append("trajectory_p_value", trajectoryPValue);
    formData.append("trajectory_bonferroni", JSON.stringify(trajectoryBonferroni));
    formData.append("trajectory_gene_count", trajectoryGeneCount);
    formData.append("include_significant_tfs", JSON.stringify(includeSignificantTFs));
    formData.append("ranked_edges_per_target", maxEdgesPerTarget.trim());
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
    formData.append("pseudotime_filename", pseudotimeFileName);
    formData.append("cluster_labels_filename", clusterLabelsFileName);
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
      validationErrors.push("Upload an expression matrix CSV to continue.");
    } else {
      if (!expressionFile.name.toLowerCase().endsWith(".csv")) {
        validationErrors.push("Expression matrix must be a CSV file.");
      }
      if (expressionFile.size > maxFileSize) {
        validationErrors.push("Expression matrix file size must be 500 MB or smaller.");
      }
    }
    if (!matrixState) {
      validationErrors.push("Select the current state of the matrix values.");
    }
    if (!datasetSpecies) {
      validationErrors.push("Select the species represented by the matrix.");
    }
    if (pseudotimeFile) {
      if (!pseudotimeFile.name.toLowerCase().endsWith(".csv")) {
        validationErrors.push("Pseudotime file must be a CSV file.");
      }
      if (pseudotimeFile.size > maxFileSize) {
        validationErrors.push("Pseudotime file size must be 500 MB or smaller.");
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
    if (geneSelectionMethod === "hvg") {
      const parsedHvgGenes = Number(hvgGeneCount);
      if (!Number.isInteger(parsedHvgGenes) || parsedHvgGenes <= 0) {
        validationErrors.push("Highly variable gene count must be a positive integer.");
      }
    }
    if (geneSelectionMethod === "trajectory") {
      if (geneOrderingSource === "upload" && !geneOrderingFile) {
        validationErrors.push("Upload a GeneOrdering CSV or choose Calculate for me.");
      }
      const parsedPValue = Number(trajectoryPValue);
      if (!Number.isFinite(parsedPValue) || parsedPValue <= 0 || parsedPValue > 1) {
        validationErrors.push("Trajectory p-value threshold must be greater than 0 and at most 1.");
      }
      const parsedTrajectoryGenes = Number(trajectoryGeneCount);
      if (!Number.isInteger(parsedTrajectoryGenes) || parsedTrajectoryGenes <= 0) {
        validationErrors.push("Trajectory gene count must be a positive integer.");
      }
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
        throw new Error("Upload an expression matrix CSV to continue.");
      }

      // Register the dataset files, then navigate immediately. The detail page
      // starts the upload in the background (the pending-upload store lives on
      // window, so it survives navigation) and surfaces validation errors once
      // it finishes — so "Start analysis" no longer blocks on the upload.
      registerPendingProjectUpload(data.project_id, {
        expressionFile,
        pseudotimeFile,
        clusterLabelsFile,
      });

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
      pseudotimeFileName={pseudotimeFileName}
      clusterLabelsFileName={clusterLabelsFileName}
      matrixState={matrixState}
      datasetSpecies={datasetSpecies}
      detectionThreshold={detectionThreshold}
      geneSelectionMethod={geneSelectionMethod}
      hvgGeneCount={hvgGeneCount}
      geneOrderingSource={geneOrderingSource}
      geneOrderingFileName={geneOrderingFileName}
      trajectoryPValue={trajectoryPValue}
      trajectoryBonferroni={trajectoryBonferroni}
      trajectoryGeneCount={trajectoryGeneCount}
      includeSignificantTFs={includeSignificantTFs}
      includeAllTFs={includeAllTFs}
      maxEdgesPerTarget={maxEdgesPerTarget}
      maxEdgesLimit={maxEdgesLimit}
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
      onClose={onClose}
      onStartAnalysis={handleStartAnalysis}
      onSelectAll={handleSelectAll}
      onToggleAlgorithm={toggleAlgorithm}
      setProjectName={setProjectName}
      setMatrixState={setMatrixState}
      setDatasetSpecies={setDatasetSpecies}
      setDetectionThreshold={setDetectionThreshold}
      setGeneSelectionMethod={setGeneSelectionMethod}
      setHvgGeneCount={setHvgGeneCount}
      setGeneOrderingSource={setGeneOrderingSource}
      setGeneOrderingFile={setGeneOrderingFile}
      setGeneOrderingFileName={setGeneOrderingFileName}
      setTrajectoryPValue={setTrajectoryPValue}
      setTrajectoryBonferroni={setTrajectoryBonferroni}
      setTrajectoryGeneCount={setTrajectoryGeneCount}
      setIncludeSignificantTFs={setIncludeSignificantTFs}
      estimatePseudotime={estimatePseudotime}
      onToggleEstimatePseudotime={handleToggleEstimatePseudotime}
      setExpressionFile={setExpressionFile}
      setExpressionFileName={setExpressionFileName}
      setPseudotimeFile={handleSetPseudotimeFile}
      setPseudotimeFileName={setPseudotimeFileName}
      setClusterLabelsFile={setClusterLabelsFile}
      setClusterLabelsFileName={setClusterLabelsFileName}
      setIncludeAllTFs={setIncludeAllTFs}
      setMaxEdgesPerTarget={setMaxEdgesPerTarget}
      setCellOracleSpecies={setCellOracleSpecies}
      setHasCellOracleSettingsConfigured={setHasCellOracleSettingsConfigured}
      clearPseudotimeFile={clearPseudotimeFile}
      clearClusterLabelsFile={clearClusterLabelsFile}
    />
  );
}
