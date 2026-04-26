"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CreateProjectModal from "./_components/CreateProjectModal";
import ProjectCard from "./_components/ProjectCard";
import { algorithms, recommendedIds } from "./_data/algorithms";
import { Project, ProjectJob } from "./_types/project";
import DeleteProjectModal from "./_components/DeleteProjectModal";
import EmptyProjectHistory from "./_components/EmptyProjectHistory";

type CreateStep = "upload" | "preprocessing" | "algorithms" | "review";

export default function ProjectsPage() {

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

  const router = useRouter();

  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [isCreateClosing, setIsCreateClosing] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep>("upload");

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
  const [ensembleEnabled, setEnsembleEnabled] = useState(true);

  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projectHistory, setProjectHistory] = useState<Project[]>([]);
  const [projectPendingDelete, setProjectPendingDelete] =
    useState<Project | null>(null);
  const [isDeleteModalClosing, setIsDeleteModalClosing] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);

  const datasetSummary = {
    dimensions:
      geneCount !== null && cellCount !== null
        ? `${geneCount.toLocaleString()} genes × ${cellCount.toLocaleString()} cells`
        : "Matrix size pending upload validation",
    hasPseudotime: Boolean(pseudotimeFile),
    preprocessingSummary: [
      `Top variable genes retained: ${topVariableGenes || "2000"}`,
      `Transcription factor override: ${includeAllTFs ? "enabled" : "disabled"}`,
      `Library-size normalization: ${normalizeEnabled ? "enabled" : "disabled"}`,
      `log₂(x + 1) transformation: ${logTransformEnabled ? "enabled" : "disabled"}`,
    ],
  };

  useEffect(() => {
    let isCancelled = false;

    const loadProjectHistory = async () => {
      try {
        const response = await fetch(`${API_BASE}/projects`);

        if (!response.ok) {
          setProjectHistory([]);
          return;
        }

        const data = await response.json();

        if (isCancelled) {
          return;
        }

        if (data.ok && Array.isArray(data.projects)) {
          setProjectHistory(data.projects as Project[]);
        } else {
          setProjectHistory([]);
        }
      } catch {
        if (!isCancelled) {
          setProjectHistory([]);
        }
      }
    };

    loadProjectHistory();

    return () => {
      isCancelled = true;
    };
  }, []);

  const activeProjectIds = useMemo(
    () =>
      projectHistory
        .filter((project) => {
          const latestJob = project.latestJob;
          if (!latestJob) {
            return false;
          }

          const overallStatus = latestJob.overall_status;
          const hasActiveTasks = latestJob.tasks?.some(
            (task) => task.status === "Queued" || task.status === "Running"
          );

          return (
            overallStatus === "Queued" ||
            overallStatus === "Running" ||
            Boolean(hasActiveTasks)
          );
        })
        .map((project) => project.id),
    [projectHistory]
  );


  useEffect(() => {
    if (activeProjectIds.length === 0) {
      return;
    }

    let isCancelled = false;

    const updateProjectStatuses = async () => {
      try {
        const responses = await Promise.all(
          activeProjectIds.map(async (projectId) => {
            try {
              const response = await fetch(
                `${API_BASE}//projects/${projectId}`
              );

              if (!response.ok) {
                return null;
              }

              const data = await response.json();
              return {
                projectId,
                latestJob: (data.latest_job ?? null) as ProjectJob | null,
              };
            } catch {
              return null;
            }
          })
        );

        if (isCancelled) {
          return;
        }

        const latestJobMap = new Map(
          responses
            .filter(
              (item): item is { projectId: string; latestJob: ProjectJob | null } =>
                item !== null
            )
            .map((item) => [item.projectId, item.latestJob])
        );

        setProjectHistory((currentProjects) =>
          currentProjects.map((project) => {
            if (!latestJobMap.has(project.id)) {
              return project;
            }

            return {
              ...project,
              latestJob: latestJobMap.get(project.id) ?? null,
            };
          })
        );
      } catch {
        return;
      }
    };

    updateProjectStatuses();
    const intervalId = window.setInterval(updateProjectStatuses, 5000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeProjectIds]);

  const compatibleAlgorithms = useMemo(
    () =>
      algorithms.filter(
        (algorithm) =>
          !algorithm.requiresPseudotime || datasetSummary.hasPseudotime
      ),
    [datasetSummary.hasPseudotime]
  );

  const selectedAlgorithms = useMemo(
    () => algorithms.filter((algorithm) => selectedIds.includes(algorithm.id)),
    [selectedIds]
  );

  const estimatedTotalRuntime = useMemo(() => {
    if (selectedAlgorithms.length === 0) {
      return "No algorithms selected";
    }

    const longestRuntime = Math.max(
      ...selectedAlgorithms.map((algorithm) => algorithm.runtimeMinutes)
    );

    return `~ ${longestRuntime} minutes`;
  }, [selectedAlgorithms]);

  const openCreateModal = () => {
    setErrors([]);
    setCreateStep("upload");
    setTopVariableGenes("2000");
    setIncludeAllTFs(true);
    setNormalizeEnabled(true);
    setLogTransformEnabled(true);
    setTempUploadId("");
    setGeneCount(null);
    setCellCount(null);
    setIsUploadingTempDataset(false);
    setSelectedIds([]);
    setEnsembleEnabled(true);
    setProjectName("");
    setProjectDescription("");
    setExpressionFile(null);
    setPseudotimeFile(null);
    setExpressionFileName("");
    setPseudotimeFileName("");
    setIsCreateClosing(false);
    setIsCreateVisible(true);
  };

  const closeCreateModal = () => {
    setIsCreateClosing(true);
    window.setTimeout(() => {
      setIsCreateVisible(false);
      setIsCreateClosing(false);
      setCreateStep("upload");
      setErrors([]);
    }, 280);
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

  const validateUploadStep = () => {
    const newErrors: string[] = [];
    const maxFileSize = 500 * 1024 * 1024;

    if (!projectName.trim()) {
      newErrors.push("Project name is required.");
    }

    if (!expressionFile) {
      newErrors.push("Expression matrix CSV is required.");
    } else {
      if (!expressionFile.name.toLowerCase().endsWith(".csv")) {
        newErrors.push("Expression matrix must be a CSV file.");
      }

      if (expressionFile.size > maxFileSize) {
        newErrors.push("Expression matrix file size must be 500 MB or smaller.");
      }
    }

    if (pseudotimeFile) {
      if (!pseudotimeFile.name.toLowerCase().endsWith(".csv")) {
        newErrors.push("Pseudotime file must be a CSV file.");
      }

      if (pseudotimeFile.size > maxFileSize) {
        newErrors.push("Pseudotime file size must be 500 MB or smaller.");
      }
    }

    return newErrors;
  };

  const handleUploadStepNext = async () => {
    const newErrors = validateUploadStep();

    if (newErrors.length > 0) {
      setErrors(newErrors);
      return;
    }

    if (!expressionFile) {
      setErrors(["Expression matrix CSV is required."]);
      return;
    }

    try {
      setErrors([]);
      setIsUploadingTempDataset(true);

      const formData = new FormData();
      formData.append("expression_matrix", expressionFile);

      if (pseudotimeFile) {
        formData.append("pseudotime", pseudotimeFile);
      }

      const response = await fetch(
        `${API_BASE}/uploads/temp-dataset`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!data.ok) {
        setErrors(data.errors || ["Temporary dataset upload failed."]);
        return;
      }

      setTempUploadId(data.temp_upload_id || "");
      setGeneCount(data.gene_count ?? null);
      setCellCount(data.cell_count ?? null);
      setTopVariableGenes(
        data.gene_count !== null && data.gene_count !== undefined
          ? String(data.gene_count)
          : ""
      );
      setCreateStep("preprocessing");
    } catch {
      setErrors(["Could not connect to the server for temporary upload."]);
    } finally {
      setIsUploadingTempDataset(false);
    }
  };

  const handlePreprocessingStepNext = () => {
    const newErrors: string[] = [];
    const parsedTopGenes = Number(topVariableGenes);

    if (!topVariableGenes.trim()) {
      newErrors.push("Top variable genes is required.");
    } else if (!Number.isInteger(parsedTopGenes) || parsedTopGenes <= 0) {
      newErrors.push("Top variable genes must be a positive integer.");
    } else if (geneCount !== null && parsedTopGenes > geneCount) {
      newErrors.push("Top variable genes cannot be larger than the uploaded gene count.");
    }

    if (newErrors.length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors([]);
    setCreateStep("algorithms");
  };

  const toggleAlgorithm = (algorithmId: string, disabled: boolean) => {
    if (disabled) return;

    setSelectedIds((current) => {
      if (current.includes(algorithmId)) {
        const updated = current.filter((id) => id !== algorithmId);
        if (updated.length < 2) {
          setEnsembleEnabled(false);
        }
        return updated;
      }

      const updated = [...current, algorithmId];
      if (updated.length >= 2) {
        setEnsembleEnabled(true);
      }
      return updated;
    });
  };

  const handleRecommended = () => {
    const compatibleRecommended = recommendedIds.filter((id) =>
      compatibleAlgorithms.some((algorithm) => algorithm.id === id)
    );
    setSelectedIds(compatibleRecommended);
    setEnsembleEnabled(compatibleRecommended.length >= 2);
  };

  const handleSelectAll = () => {
    const allCompatibleIds = compatibleAlgorithms.map((algorithm) => algorithm.id);
    setSelectedIds(allCompatibleIds);
    setEnsembleEnabled(allCompatibleIds.length >= 2);
  };

  const handleAlgorithmsStepNext = () => {
    if (selectedAlgorithms.length === 0) {
      setErrors(["Select at least one algorithm to continue."]);
      return;
    }

    setErrors([]);
    setCreateStep("review");
  };

  const handleCreateProject = async () => {
    try {
      setIsSubmitting(true);
      setErrors([]);

      const uploadErrors = validateUploadStep();
      if (uploadErrors.length > 0) {
        setErrors(uploadErrors);
        setCreateStep("upload");
        return;
      }

      if (!tempUploadId) {
        setErrors([
          "Temporary upload is missing. Please return to the upload step and upload the dataset again.",
        ]);
        setCreateStep("upload");
        return;
      }

      const formData = new FormData();
      formData.append("temp_upload_id", tempUploadId);
      formData.append("project_name", projectName);
      formData.append("project_description", projectDescription);
      formData.append("top_variable_genes", topVariableGenes);
      formData.append("include_all_tfs", JSON.stringify(includeAllTFs));
      formData.append("normalize_enabled", JSON.stringify(normalizeEnabled));
      formData.append("log_transform_enabled", JSON.stringify(logTransformEnabled));
      formData.append("selected_algorithms", JSON.stringify(selectedIds));
      formData.append("ensemble_enabled", JSON.stringify(ensembleEnabled));

      const response = await fetch(
        `${API_BASE}/projects/create-from-temp`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!data.ok) {
        setErrors(data.errors || ["Project creation failed."]);
        setCreateStep("upload");
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
        datasetCount: 1,
        jobCount: 1,
        latestJob: {
          job_id: data.job_id || "pending",
          overall_status: "Queued",
          ensemble_enabled: ensembleEnabled,
          tasks: selectedIds.map((algorithmId) => ({
            algorithm_id: algorithmId,
            status: "Queued",
            elapsed_seconds: 0,
            error_message: null,
          })),
        },
      };
      setProjectHistory((currentProjects) => [createdProject, ...currentProjects]);

      closeCreateModal();
      router.push("/projects");
    } catch {
      setErrors(["Could not connect to the server."]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteProject = (project: Project) => {
    setIsDeleteModalClosing(false);
    setProjectPendingDelete(project);
  };

  const handleConfirmDeleteProject = async () => {
    if (!projectPendingDelete) {
      return;
    }

    try {
      setIsDeletingProject(true);

      const response = await fetch(
        `${API_BASE}/projects/${projectPendingDelete.id}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        setErrors(["Failed to delete the project."]);
        return;
      }

      const targetProjectId = projectPendingDelete.id;
      setDeletingProjectId(targetProjectId);
      setIsDeleteModalClosing(true);

      window.setTimeout(() => {
        setProjectPendingDelete(null);
        setIsDeleteModalClosing(false);
      }, 280);

      window.setTimeout(() => {
        setProjectHistory((currentProjects) =>
          currentProjects.filter((item) => item.id !== targetProjectId)
        );
        setDeletingProjectId(null);
      }, 300);
    } catch {
      setErrors(["Could not connect to the server."]);
    } finally {
      setIsDeletingProject(false);
    }
  };

  const handleCancelDeleteProject = () => {
    if (isDeletingProject || !projectPendingDelete) {
      return;
    }

    setIsDeleteModalClosing(true);
    window.setTimeout(() => {
      setProjectPendingDelete(null);
      setIsDeleteModalClosing(false);
    }, 280);
  };

  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="relative overflow-hidden bg-[#f4f6f8]">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/90 to-transparent" />
        <div className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-cyan-100/60 blur-3xl" />
        <div className="absolute -right-24 top-16 h-72 w-72 rounded-full bg-teal-100/60 blur-3xl" />

        <div className="relative mx-auto max-w-[1180px] px-6 py-16 lg:px-10 lg:py-20">
          <div className="flex flex-col gap-6 border-b border-[#213f54]/35 pb-8 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.28em] text-[#1b75a6]">
                Workspace
              </p>
              <h1 className="mt-4 text-5xl font-bold tracking-tight text-slate-950 sm:text-6xl lg:text-[4.15rem] lg:leading-[1.02]">
                My Projects
              </h1>
              <p className="mt-5 max-w-2xl text-[1.05rem] leading-8 text-slate-700">
                Create projects, upload expression matrices, run GRN inference algorithms,
                and return to completed analysis results from one workspace.
              </p>
            </div>

            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex w-fit cursor-pointer items-center justify-center rounded-full bg-[#1b75a6] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#1b75a6]/20 transition hover:bg-[#155f87]"
            >
              Create New Project
            </button>
          </div>

          <CreateProjectModal
            isCreateVisible={isCreateVisible}
            isCreateClosing={isCreateClosing}
            createStep={createStep}
            projectName={projectName}
            projectDescription={projectDescription}
            expressionFileName={expressionFileName}
            pseudotimeFileName={pseudotimeFileName}
            geneCount={geneCount}
            cellCount={cellCount}
            isUploadingTempDataset={isUploadingTempDataset}
            topVariableGenes={topVariableGenes}
            includeAllTFs={includeAllTFs}
            normalizeEnabled={normalizeEnabled}
            logTransformEnabled={logTransformEnabled}
            selectedIds={selectedIds}
            compatibleAlgorithms={compatibleAlgorithms}
            selectedAlgorithms={selectedAlgorithms}
            estimatedTotalRuntime={estimatedTotalRuntime}
            ensembleEnabled={ensembleEnabled}
            datasetSummary={datasetSummary}
            errors={errors}
            isSubmitting={isSubmitting}
            algorithms={algorithms}
            onClose={closeCreateModal}
            onBackToUpload={() => setCreateStep("upload")}
            onBackToPreprocessing={() => setCreateStep("preprocessing")}
            onBackToAlgorithms={() => setCreateStep("algorithms")}
            onUploadNext={handleUploadStepNext}
            onPreprocessingNext={handlePreprocessingStepNext}
            onAlgorithmsNext={handleAlgorithmsStepNext}
            onCreateProject={handleCreateProject}
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

          <DeleteProjectModal
            project={projectPendingDelete}
            isDeleting={isDeletingProject}
            isClosing={isDeleteModalClosing}
            onCancel={handleCancelDeleteProject}
            onConfirm={handleConfirmDeleteProject}
          />
          {projectHistory.length > 0 ? (
            <div className="mt-8 grid gap-5">
              {projectHistory.map((project) => (
                <div
                  key={project.id}
                  className="origin-top overflow-hidden"
                  style={{
                    opacity: deletingProjectId === project.id ? 0 : 1,
                    transform:
                      deletingProjectId === project.id
                        ? "translateY(12px) scale(0.95)"
                        : "translateY(0px) scale(1)",
                    transition: "opacity 280ms ease-out, transform 280ms ease-out",
                    pointerEvents:
                      deletingProjectId === project.id ? "none" : "auto",
                  }}
                >
                  <ProjectCard
                    project={project}
                    onDelete={handleDeleteProject}
                  />
                </div>
              ))}
            </div>
          ) : (
            <EmptyProjectHistory />
          )}
        </div>
      </section>
    </main>
  );
}