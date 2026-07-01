"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CreateProjectModal from "./CreateProjectModal";
import type { ProjectAlgorithm } from "../page";
import type { Project } from "../_types/project";
import { getApiBase } from "../../_lib/apiConfig";
import { apiFetch } from "../../_lib/clientIdentity";

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
};

type ApiPayload = Record<string, unknown>;
const DEFAULT_TOP_VARIABLE_GENES = 2000;
const MAX_PREPROCESSED_GENES = 8000;

function isApiPayload(value: unknown): value is ApiPayload {
  return typeof value === "object" && value !== null;
}

function extractApiErrors(payload: ApiPayload | null): string[] {
  if (!payload || !Array.isArray(payload.errors)) return [];
  return payload.errors.filter(
    (error): error is string => typeof error === "string" && error.trim().length > 0,
  );
}

async function readApiPayload(response: Response): Promise<ApiPayload | null> {
  const responseText = await response.text();
  if (!responseText.trim()) return null;

  try {
    const parsed: unknown = JSON.parse(responseText);
    return isApiPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function formatTemporaryUploadError(response: Response, payload: ApiPayload | null) {
  const serverErrors = extractApiErrors(payload);
  if (serverErrors.length > 0) return serverErrors;

  if (response.status === 413) {
    return [
      "Upload was rejected because the request is larger than the server limit. Increase nginx client_max_body_size to 500M, restart nginx, and try again.",
    ];
  }

  if (response.status === 504) {
    return [
      "The server timed out while saving this dataset. Check nginx timeout settings and backend logs, then try again.",
    ];
  }

  if (response.status >= 500) {
    return [
      `Temporary dataset upload failed with HTTP ${response.status}. Check the backend or nginx logs for the detailed error.`,
    ];
  }

  return [`Temporary dataset upload failed with HTTP ${response.status}.`];
}

function getPayloadString(payload: ApiPayload, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function getPayloadNumber(payload: ApiPayload, key: string) {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
}

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
  const [isUploadingTempDataset, setIsUploadingTempDataset] = useState(false);

  const [topVariableGenes, setTopVariableGenes] = useState(String(DEFAULT_TOP_VARIABLE_GENES));
  const [includeAllTFs, setIncludeAllTFs] = useState(true);
  const [normalizeEnabled, setNormalizeEnabled] = useState(true);
  const [logTransformEnabled, setLogTransformEnabled] = useState(true);
  const [cellOracleSpecies, setCellOracleSpecies] = useState("human");
  const [cellOracleBaseGrn, setCellOracleBaseGrn] = useState("auto");
  const [hasCellOracleSettingsConfigured, setHasCellOracleSettingsConfigured] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hasUserAdjustedAlgorithms, setHasUserAdjustedAlgorithms] = useState(false);
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
    setProjectName("");
    setProjectDescription("");
    setExpressionFile(null);
    setPseudotimeFile(null);
    setClusterLabelsFile(null);
    setExpressionFileName("");
    setPseudotimeFileName("");
    setClusterLabelsFileName("");
    setGeneCount(null);
    setCellCount(null);
    setIsUploadingTempDataset(false);
    setTopVariableGenes(String(DEFAULT_TOP_VARIABLE_GENES));
    setIncludeAllTFs(true);
    setNormalizeEnabled(true);
    setLogTransformEnabled(true);
    setCellOracleSpecies("human");
    setCellOracleBaseGrn("auto");
    setHasCellOracleSettingsConfigured(false);
    setSelectedIds([]);
    setHasUserAdjustedAlgorithms(false);
    setEnsembleEnabled(true);
    setIsSubmitting(false);
    lastAutoProjectNameRef.current = "";
  }, [open]);

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
        `Top variable genes retained: ${topVariableGenes || String(DEFAULT_TOP_VARIABLE_GENES)}`,
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

  // Sync top-variable-genes default to a safe cap for every fresh dataset.
  useEffect(() => {
    if (geneCount === null) return;
    setTopVariableGenes(
      String(Math.min(geneCount, DEFAULT_TOP_VARIABLE_GENES, MAX_PREPROCESSED_GENES)),
    );
  }, [geneCount]);

  // Selecting files should stay local and instant. Server work starts only after
  // the user clicks Start analysis.
  useEffect(() => {
    setGeneCount(null);
    setCellCount(null);
  }, [expressionFile, pseudotimeFile, clusterLabelsFile]);

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

  const handleRecommended = () => {
    setHasUserAdjustedAlgorithms(true);
    const compatibleRecommended = compatibleAlgorithms
      .filter((algorithm) => algorithm.recommended)
      .map((algorithm) => algorithm.id);
    setSelectedIds(compatibleRecommended);
    setEnsembleEnabled(compatibleRecommended.length >= 2);
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

  const uploadTempDatasetForStart = async () => {
    if (!expressionFile) {
      throw new Error("Upload an expression matrix CSV to continue.");
    }

    setIsUploadingTempDataset(true);
    setGeneCount(null);
    setCellCount(null);

    try {
      const formData = new FormData();
      formData.append("expression_matrix", expressionFile);
      formData.append("defer_validation", "true");
      if (pseudotimeFile) {
        formData.append("pseudotime", pseudotimeFile);
      }
      if (clusterLabelsFile) {
        formData.append("cluster_labels", clusterLabelsFile);
      }

      const response = await fetch(`${API_BASE}/uploads/temp-dataset`, {
        method: "POST",
        body: formData,
      });
      const data = await readApiPayload(response);

      if (!response.ok) {
        throw new Error(formatTemporaryUploadError(response, data).join("\n"));
      }

      if (!data || data.ok !== true) {
        const serverErrors = extractApiErrors(data);
        throw new Error(
          serverErrors.length ? serverErrors.join("\n") : "Temporary dataset upload failed.",
        );
      }

      const uploadId = getPayloadString(data, "temp_upload_id");
      if (!uploadId) {
        throw new Error("Temporary dataset upload failed: missing upload id.");
      }

      setGeneCount(getPayloadNumber(data, "gene_count"));
      setCellCount(getPayloadNumber(data, "cell_count"));
      return uploadId;
    } finally {
      setIsUploadingTempDataset(false);
    }
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

    const parsedTopGenes = Number(topVariableGenes);
    if (
      !topVariableGenes.trim() ||
      !Number.isInteger(parsedTopGenes) ||
      parsedTopGenes <= 0
    ) {
      validationErrors.push("Top variable genes must be a positive integer.");
    } else if (geneCount !== null && parsedTopGenes > geneCount) {
      validationErrors.push("Top variable genes cannot be larger than the uploaded gene count.");
    } else if (parsedTopGenes > MAX_PREPROCESSED_GENES) {
      validationErrors.push(
        `Top variable genes cannot be larger than ${MAX_PREPROCESSED_GENES.toLocaleString()}.`,
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
      const uploadedTempId = await uploadTempDatasetForStart();

      const formData = new FormData();
      formData.append("temp_upload_id", uploadedTempId);
      formData.append("project_name", projectName);
      formData.append("project_description", projectDescription);
      formData.append("top_variable_genes", topVariableGenes);
      formData.append("include_all_tfs", JSON.stringify(includeAllTFs));
      formData.append("normalize_enabled", JSON.stringify(normalizeEnabled));
      formData.append("log_transform_enabled", JSON.stringify(logTransformEnabled));
      formData.append("selected_algorithms", JSON.stringify(safeSelectedIds));
      formData.append("ensemble_enabled", JSON.stringify(ensembleEnabled));
      formData.append("celloracle_species", cellOracleSpecies);
      formData.append("celloracle_base_grn", cellOracleBaseGrn);

      const response = await apiFetch(`${API_BASE}/projects/create-from-temp`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!data.ok) {
        setErrors(data.errors || ["Project creation failed."]);
        return;
      }

      const now = new Date();
      const createdProject: Project = {
        id: data.project_id || `project-${now.getTime()}`,
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
          job_id: data.job_id || "pending",
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
          })),
        },
      };

      // Close the modal first, then notify the parent.
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
      isUploadingTempDataset={isUploadingTempDataset}
      topVariableGenes={topVariableGenes}
      includeAllTFs={includeAllTFs}
      normalizeEnabled={normalizeEnabled}
      logTransformEnabled={logTransformEnabled}
      cellOracleSpecies={cellOracleSpecies}
      hasCellOracleSettingsConfigured={hasCellOracleSettingsConfigured}
      selectedIds={selectedIds}
      compatibleAlgorithms={compatibleAlgorithms}
      selectedAlgorithms={selectedAlgorithms}
      ensembleEnabled={ensembleEnabled}
      datasetSummary={datasetSummary}
      errors={errors}
      isSubmitting={isSubmitting}
      algorithms={algorithms}
      isLoadingAlgorithms={isLoadingAlgorithms}
      algorithmLoadError={algorithmLoadError}
      onClose={onClose}
      onStartAnalysis={handleStartAnalysis}
      onRecommended={handleRecommended}
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
      setCellOracleSpecies={setCellOracleSpecies}
      setCellOracleBaseGrn={setCellOracleBaseGrn}
      setHasCellOracleSettingsConfigured={setHasCellOracleSettingsConfigured}
      clearPseudotimeFile={clearPseudotimeFile}
      clearClusterLabelsFile={clearClusterLabelsFile}
      setEnsembleEnabled={setEnsembleEnabled}
    />
  );
}
