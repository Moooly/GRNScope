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

const DEFAULT_TOP_VARIABLE_GENES = "";
const ALL_GENES_VALUE = "all";
const MAX_PREPROCESSED_GENES = 8000;
const RANKED_EDGES_HARD_MAX = 100;
const DEFAULT_MAX_EDGES_PER_TARGET = "20";
const CELLORACLE_INTERNAL_BASE_GRN = "auto";

function formatTopVariableGenes(value: string) {
  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === ALL_GENES_VALUE) return "All genes retained";
  return value || "Gene count pending";
}

function inferGeneCountFromFileName(fileName: string) {
  const match = fileName.match(/(?:^|[_\-\s])(?:top)?(\d+)[_\-\s]*genes?(?:[_\-\s.]|$)/i);
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function countCsvColumns(line: string) {
  let columns = 1;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === "\"") {
      if (inQuotes && nextCharacter === "\"") {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === "," && !inQuotes) {
      columns += 1;
    }
  }

  return columns;
}

async function readExpressionMatrixDimensions(file: File) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let headerLine: string | null = null;
  let nonEmptyLineCount = 0;

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === "") return;
    nonEmptyLineCount += 1;
    headerLine ??= line;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let lineEnd = buffer.indexOf("\n");
      while (lineEnd !== -1) {
        processLine(buffer.slice(0, lineEnd));
        buffer = buffer.slice(lineEnd + 1);
        lineEnd = buffer.indexOf("\n");
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) {
      processLine(buffer);
    }
  } finally {
    reader.releaseLock();
  }

  if (!headerLine) {
    throw new Error("Expression matrix is empty.");
  }

  return {
    geneCount: Math.max(0, nonEmptyLineCount - 1),
    cellCount: Math.max(0, countCsvColumns(headerLine) - 1),
  };
}

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
  const [projectDescription, setProjectDescription] = useState("");

  const [expressionFile, setExpressionFile] = useState<File | null>(null);
  const [pseudotimeFile, setPseudotimeFile] = useState<File | null>(null);
  const [clusterLabelsFile, setClusterLabelsFile] = useState<File | null>(null);
  const [expressionFileName, setExpressionFileName] = useState("");
  const [pseudotimeFileName, setPseudotimeFileName] = useState("");
  const [clusterLabelsFileName, setClusterLabelsFileName] = useState("");

  const [geneCount, setGeneCount] = useState<number | null>(null);
  const [cellCount, setCellCount] = useState<number | null>(null);

  const [topVariableGenes, setTopVariableGenes] = useState(DEFAULT_TOP_VARIABLE_GENES);
  const [includeAllTFs, setIncludeAllTFs] = useState(true);
  const [normalizeEnabled, setNormalizeEnabled] = useState(true);
  const [logTransformEnabled, setLogTransformEnabled] = useState(true);
  const [maxEdgesPerTarget, setMaxEdgesPerTarget] = useState(DEFAULT_MAX_EDGES_PER_TARGET);
  const [cellOracleSpecies, setCellOracleSpecies] = useState("human");
  const [hasCellOracleSettingsConfigured, setHasCellOracleSettingsConfigured] = useState(false);

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
    setProjectDescription(initialValues?.projectDescription ?? "");
    setExpressionFile(null);
    setPseudotimeFile(null);
    setClusterLabelsFile(null);
    setExpressionFileName("");
    setPseudotimeFileName("");
    setClusterLabelsFileName("");
    setGeneCount(null);
    setCellCount(null);
    setTopVariableGenes(initialValues?.topVariableGenes ?? DEFAULT_TOP_VARIABLE_GENES);
    setIncludeAllTFs(initialValues?.includeAllTFs ?? true);
    setNormalizeEnabled(initialValues?.normalizeEnabled ?? true);
    setLogTransformEnabled(initialValues?.logTransformEnabled ?? true);
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
      dimensions:
        geneCount !== null && cellCount !== null
          ? `${geneCount.toLocaleString()} genes × ${cellCount.toLocaleString()} cells`
          : "Matrix size pending upload validation",
      hasPseudotime: Boolean(pseudotimeFile),
      hasClusterLabels: Boolean(clusterLabelsFile),
      hasCellOracleSettingsConfigured,
      hasGroundTruth: false,
      preprocessingSummary: [
        `Gene filtering: ${formatTopVariableGenes(topVariableGenes)}`,
        `Transcription factor override: ${includeAllTFs ? "enabled" : "disabled"}`,
        `Library-size normalization: ${normalizeEnabled ? "enabled" : "disabled"}`,
        `log₂(x + 1) transformation: ${logTransformEnabled ? "enabled" : "disabled"}`,
      ],
    }),
    [
      geneCount,
      cellCount,
      pseudotimeFile,
      clusterLabelsFile,
      topVariableGenes,
      includeAllTFs,
      normalizeEnabled,
      logTransformEnabled,
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
    if (!expressionFileName) return;
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

  // Selecting files should stay local and instant. Server work starts only after
  // the user clicks Start analysis.
  useEffect(() => {
    if (!expressionFile) {
      setGeneCount(null);
      setCellCount(null);
      setTopVariableGenes(initialValues?.topVariableGenes ?? DEFAULT_TOP_VARIABLE_GENES);
      return;
    }

    let isCancelled = false;
    const inferredGeneCount = inferGeneCountFromFileName(expressionFile.name);
    setGeneCount(null);
    setCellCount(null);
    setTopVariableGenes(inferredGeneCount ? String(inferredGeneCount) : DEFAULT_TOP_VARIABLE_GENES);

    const readDimensions = async () => {
      try {
        const dimensions = await readExpressionMatrixDimensions(expressionFile);
        if (isCancelled) return;
        setGeneCount(dimensions.geneCount);
        setCellCount(dimensions.cellCount);
        if (dimensions.geneCount > 0) {
          setTopVariableGenes(String(dimensions.geneCount));
        }
      } catch (error) {
        if (isCancelled) return;
        setGeneCount(null);
        setCellCount(null);
        setTopVariableGenes(DEFAULT_TOP_VARIABLE_GENES);
        console.error("Could not read expression matrix dimensions:", error);
      }
    };

    void readDimensions();

    return () => {
      isCancelled = true;
    };
  }, [expressionFile, initialValues?.topVariableGenes]);

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

  const clearClusterLabelsFile = () => {
    setClusterLabelsFile(null);
    setClusterLabelsFileName("");
  };

  const createPendingProject = async (safeSelectedIds: string[]) => {
    const formData = new FormData();
    formData.append("project_name", projectName);
    formData.append("project_description", projectDescription);
    formData.append("top_variable_genes", topVariableGenes);
    formData.append("include_all_tfs", JSON.stringify(includeAllTFs));
    formData.append("normalize_enabled", JSON.stringify(normalizeEnabled));
    formData.append("log_transform_enabled", JSON.stringify(logTransformEnabled));
    formData.append("ranked_edges_per_target", maxEdgesPerTarget.trim());
    formData.append("selected_algorithms", JSON.stringify(safeSelectedIds));
    // Only submit overrides for algorithms that are actually selected.
    const selectedParameterOverrides: Record<string, Record<string, unknown>> = {};
    for (const algorithmId of safeSelectedIds) {
      const overrides = algorithmParameters[algorithmId];
      if (overrides && Object.keys(overrides).length > 0) {
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

    const trimmedTopGenes = topVariableGenes.trim();
    const useAllGenes = trimmedTopGenes.toLowerCase() === ALL_GENES_VALUE;
    const parsedTopGenes = Number(trimmedTopGenes);
    if (
      !useAllGenes &&
      (
        !trimmedTopGenes ||
        !Number.isInteger(parsedTopGenes) ||
        parsedTopGenes <= 0
      )
    ) {
      validationErrors.push("Gene filtering must be \"all\" or a positive integer.");
    } else if (!useAllGenes && geneCount !== null && parsedTopGenes > geneCount) {
      validationErrors.push("Gene filtering cannot be larger than the uploaded gene count.");
    } else if (!useAllGenes && parsedTopGenes > MAX_PREPROCESSED_GENES) {
      validationErrors.push(
        `Gene filtering cannot be larger than ${MAX_PREPROCESSED_GENES.toLocaleString()} when using a numeric cutoff.`,
      );
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
        description:
          projectDescription || "Single-cell RNA-seq dataset for GRN inference.",
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
      projectDescription={projectDescription}
      expressionFileName={expressionFileName}
      pseudotimeFileName={pseudotimeFileName}
      clusterLabelsFileName={clusterLabelsFileName}
      geneCount={geneCount}
      cellCount={cellCount}
      topVariableGenes={topVariableGenes}
      includeAllTFs={includeAllTFs}
      normalizeEnabled={normalizeEnabled}
      logTransformEnabled={logTransformEnabled}
      maxEdgesPerTarget={maxEdgesPerTarget}
      maxEdgesLimit={maxEdgesLimit}
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
      setProjectDescription={setProjectDescription}
      setExpressionFile={setExpressionFile}
      setExpressionFileName={setExpressionFileName}
      setPseudotimeFile={setPseudotimeFile}
      setPseudotimeFileName={setPseudotimeFileName}
      setClusterLabelsFile={setClusterLabelsFile}
      setClusterLabelsFileName={setClusterLabelsFileName}
      setTopVariableGenes={setTopVariableGenes}
      setIncludeAllTFs={setIncludeAllTFs}
      setNormalizeEnabled={setNormalizeEnabled}
      setLogTransformEnabled={setLogTransformEnabled}
      setMaxEdgesPerTarget={setMaxEdgesPerTarget}
      setCellOracleSpecies={setCellOracleSpecies}
      setHasCellOracleSettingsConfigured={setHasCellOracleSettingsConfigured}
      clearPseudotimeFile={clearPseudotimeFile}
      clearClusterLabelsFile={clearClusterLabelsFile}
    />
  );
}
