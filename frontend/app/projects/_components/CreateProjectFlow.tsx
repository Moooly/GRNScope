"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CreateProjectModal from "./CreateProjectModal";
import type { ProjectAlgorithm } from "../page";
import type { Project } from "../_types/project";
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

function getApiRoot(apiBase: string) {
  return apiBase.replace(/\/api\/?$/, "");
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
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";
  const API_ROOT = getApiRoot(API_BASE);

  const [isClosing, setIsClosing] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");

  const [expressionFile, setExpressionFile] = useState<File | null>(null);
  const [pseudotimeFile, setPseudotimeFile] = useState<File | null>(null);
  const [expressionFileName, setExpressionFileName] = useState("");
  const [pseudotimeFileName, setPseudotimeFileName] = useState("");

  const [tempUploadId, setTempUploadId] = useState("");
  const [geneCount, setGeneCount] = useState<number | null>(null);
  const [cellCount, setCellCount] = useState<number | null>(null);
  const [isUploadingTempDataset, setIsUploadingTempDataset] = useState(false);

  const [topVariableGenes, setTopVariableGenes] = useState("2000");
  const [includeAllTFs, setIncludeAllTFs] = useState(true);
  const [normalizeEnabled, setNormalizeEnabled] = useState(true);
  const [logTransformEnabled, setLogTransformEnabled] = useState(true);

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
    setExpressionFileName("");
    setPseudotimeFileName("");
    setTempUploadId("");
    setGeneCount(null);
    setCellCount(null);
    setIsUploadingTempDataset(false);
    setTopVariableGenes("2000");
    setIncludeAllTFs(true);
    setNormalizeEnabled(true);
    setLogTransformEnabled(true);
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

        const response = await fetch(`${API_ROOT}/algorithms`, {
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
  }, [API_ROOT]);

  const datasetSummary = useMemo(
    () => ({
      dimensions:
        geneCount !== null && cellCount !== null
          ? `${geneCount.toLocaleString()} genes × ${cellCount.toLocaleString()} cells`
          : "Matrix size pending upload validation",
      hasPseudotime: Boolean(pseudotimeFile),
      hasGroundTruth: false,
      preprocessingSummary: [
        `Top variable genes retained: ${topVariableGenes || "2000"}`,
        `Transcription factor override: ${includeAllTFs ? "enabled" : "disabled"}`,
        `Library-size normalization: ${normalizeEnabled ? "enabled" : "disabled"}`,
        `log₂(x + 1) transformation: ${logTransformEnabled ? "enabled" : "disabled"}`,
      ],
    }),
    [
      geneCount,
      cellCount,
      pseudotimeFile,
      topVariableGenes,
      includeAllTFs,
      normalizeEnabled,
      logTransformEnabled,
    ],
  );

  const compatibleAlgorithms = useMemo(
    () =>
      algorithms.filter((algorithm) => {
        const hasRequiredPseudotime =
          !algorithm.requiresPseudotime || datasetSummary.hasPseudotime;
        const hasRequiredGroundTruth =
          algorithm.id !== "SCSGL" || datasetSummary.hasGroundTruth;
        return hasRequiredPseudotime && hasRequiredGroundTruth;
      }),
    [algorithms, datasetSummary.hasGroundTruth, datasetSummary.hasPseudotime],
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

  // Sync top-variable-genes default to the gene count of every fresh dataset.
  useEffect(() => {
    if (geneCount === null) return;
    setTopVariableGenes(String(geneCount));
  }, [geneCount]);

  // Auto-upload to /uploads/temp-dataset whenever the chosen files change.
  useEffect(() => {
    if (!expressionFile) {
      setTempUploadId("");
      setGeneCount(null);
      setCellCount(null);
      return;
    }

    const maxFileSize = 500 * 1024 * 1024;
    if (!expressionFile.name.toLowerCase().endsWith(".csv")) {
      setErrors(["Expression matrix must be a CSV file."]);
      return;
    }
    if (expressionFile.size > maxFileSize) {
      setErrors(["Expression matrix file size must be 500 MB or smaller."]);
      return;
    }
    if (
      pseudotimeFile &&
      !pseudotimeFile.name.toLowerCase().endsWith(".csv")
    ) {
      setErrors(["Pseudotime file must be a CSV file."]);
      return;
    }
    if (pseudotimeFile && pseudotimeFile.size > maxFileSize) {
      setErrors(["Pseudotime file size must be 500 MB or smaller."]);
      return;
    }

    let isCancelled = false;
    const controller = new AbortController();

    const uploadTempDataset = async () => {
      try {
        setIsUploadingTempDataset(true);
        setErrors([]);

        const formData = new FormData();
        formData.append("expression_matrix", expressionFile);
        if (pseudotimeFile) {
          formData.append("pseudotime", pseudotimeFile);
        }

        const response = await fetch(`${API_BASE}/uploads/temp-dataset`, {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        const data = await response.json();
        if (isCancelled) return;

        if (!data.ok) {
          setErrors(data.errors || ["Temporary dataset upload failed."]);
          return;
        }

        setTempUploadId(data.temp_upload_id || "");
        setGeneCount(data.gene_count ?? null);
        setCellCount(data.cell_count ?? null);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        if (!isCancelled) {
          setErrors(["Could not connect to the server for temporary upload."]);
        }
      } finally {
        if (!isCancelled) setIsUploadingTempDataset(false);
      }
    };

    void uploadTempDataset();
    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [expressionFile, pseudotimeFile, API_BASE]);

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
    setHasUserAdjustedAlgorithms(true);
    const allCompatibleIds = compatibleAlgorithms.map((algorithm) => algorithm.id);
    setSelectedIds(allCompatibleIds);
    setEnsembleEnabled(allCompatibleIds.length >= 2);
  };

  const clearExpressionFile = () => {
    setExpressionFile(null);
    setExpressionFileName("");
    setTempUploadId("");
    setGeneCount(null);
    setCellCount(null);
  };

  const clearPseudotimeFile = () => {
    setPseudotimeFile(null);
    setPseudotimeFileName("");
    setTempUploadId("");
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

    const parsedTopGenes = Number(topVariableGenes);
    if (
      !topVariableGenes.trim() ||
      !Number.isInteger(parsedTopGenes) ||
      parsedTopGenes <= 0
    ) {
      validationErrors.push("Top variable genes must be a positive integer.");
    } else if (geneCount !== null && parsedTopGenes > geneCount) {
      validationErrors.push("Top variable genes cannot be larger than the uploaded gene count.");
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

    if (!tempUploadId) {
      setErrors([
        "Dataset is still being validated. Wait for the upload to finish, then try again.",
      ]);
      return;
    }

    const safeSelectedIds = selectedCompatibleAlgorithms.map((algorithm) => algorithm.id);

    try {
      setIsSubmitting(true);
      setErrors([]);

      const formData = new FormData();
      formData.append("temp_upload_id", tempUploadId);
      formData.append("project_name", projectName);
      formData.append("project_description", projectDescription);
      formData.append("top_variable_genes", topVariableGenes);
      formData.append("include_all_tfs", JSON.stringify(includeAllTFs));
      formData.append("normalize_enabled", JSON.stringify(normalizeEnabled));
      formData.append("log_transform_enabled", JSON.stringify(logTransformEnabled));
      formData.append("selected_algorithms", JSON.stringify(safeSelectedIds));
      formData.append("ensemble_enabled", JSON.stringify(ensembleEnabled));

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
    } catch {
      setErrors(["Could not connect to the server."]);
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
      geneCount={geneCount}
      cellCount={cellCount}
      isUploadingTempDataset={isUploadingTempDataset}
      tempUploadId={tempUploadId}
      topVariableGenes={topVariableGenes}
      includeAllTFs={includeAllTFs}
      normalizeEnabled={normalizeEnabled}
      logTransformEnabled={logTransformEnabled}
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
      setTopVariableGenes={setTopVariableGenes}
      setIncludeAllTFs={setIncludeAllTFs}
      setNormalizeEnabled={setNormalizeEnabled}
      setLogTransformEnabled={setLogTransformEnabled}
      clearExpressionFile={clearExpressionFile}
      clearPseudotimeFile={clearPseudotimeFile}
      setEnsembleEnabled={setEnsembleEnabled}
    />
  );
}
