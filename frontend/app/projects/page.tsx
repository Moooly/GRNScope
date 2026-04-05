"use client";

import { useMemo, useState } from "react";
import CreateProjectModal from "./_components/CreateProjectModal";
import ProjectCard from "./_components/ProjectCard";
import { algorithms, recommendedIds } from "./_data/algorithms";
import { projects } from "./_data/projects";

type CreateStep = "upload" | "preprocessing" | "algorithms" | "review";

export default function ProjectsPage() {
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

  const [selectedIds, setSelectedIds] = useState<string[]>(recommendedIds);
  const [ensembleEnabled, setEnsembleEnabled] = useState(true);

  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmittedBanner, setShowSubmittedBanner] = useState(false);

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

    return `~${longestRuntime} min (parallel execution estimate)`;
  }, [selectedAlgorithms]);

  const openCreateModal = () => {
    setErrors([]);
    setShowSubmittedBanner(false);
    setCreateStep("upload");
    setTopVariableGenes("2000");
    setIncludeAllTFs(true);
    setNormalizeEnabled(true);
    setLogTransformEnabled(true);
    setTempUploadId("");
    setGeneCount(null);
    setCellCount(null);
    setIsUploadingTempDataset(false);
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
        "http://127.0.0.1:8000/api/uploads/temp-dataset",
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
        "http://127.0.0.1:8000/api/projects/create-from-temp",
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

      setShowSubmittedBanner(true);
      closeCreateModal();
    } catch {
      setErrors(["Could not connect to the server."]);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
        <div className="flex items-end justify-between gap-6">
          <div>
            <h2 className="text-2xl font-semibold text-white">
              Project History
            </h2>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="cursor-pointer rounded-2xl bg-teal-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
          >
            Create New Project
          </button>
        </div>

        {showSubmittedBanner && (
          <div className="mt-6 rounded-[2rem] border border-emerald-300/20 bg-emerald-300/10 p-5 text-sm leading-6 text-emerald-100">
            Job submitted. You may navigate away while analysis runs asynchronously. Results will become available as individual algorithms complete.
          </div>
        )}

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

        <div className="mt-8 grid gap-6">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      </section>
    </main>
  );
}