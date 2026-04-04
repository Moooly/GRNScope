"use client";

import { useMemo, useState } from "react";
import CreateProjectModal from "./_components/CreateProjectModal";
import ProjectCard from "./_components/ProjectCard";
import { algorithms, recommendedIds } from "./_data/algorithms";
import { projects } from "./_data/projects";

type CreateStep = "upload" | "algorithms" | "review";

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

  const [selectedIds, setSelectedIds] = useState<string[]>(recommendedIds);
  const [ensembleEnabled, setEnsembleEnabled] = useState(true);

  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmittedBanner, setShowSubmittedBanner] = useState(false);

  const datasetSummary = {
    dimensions: "2,000 genes × 12,400 cells",
    hasPseudotime: Boolean(pseudotimeFile),
    preprocessingSummary: [
      "Top variable genes retained: 2,000",
      "Transcription factor override: enabled",
      "Library-size normalization: enabled",
      "log₂(x + 1) transformation: enabled",
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
      setShowSubmittedBanner(false);
    }, 280);
  };

  const clearExpressionFile = () => {
    setExpressionFile(null);
    setExpressionFileName("");
  };

  const clearPseudotimeFile = () => {
    setPseudotimeFile(null);
    setPseudotimeFileName("");
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

  const handleUploadStepNext = () => {
    const newErrors = validateUploadStep();

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

      if (!expressionFile) {
        setErrors(["Expression matrix CSV is required."]);
        setCreateStep("upload");
        return;
      }

      const formData = new FormData();
      formData.append("project_name", projectName);
      formData.append("project_description", projectDescription);
      formData.append("expression_matrix", expressionFile);
      formData.append("selected_algorithms", JSON.stringify(selectedIds));
      formData.append("ensemble_enabled", JSON.stringify(ensembleEnabled));

      if (pseudotimeFile) {
        formData.append("pseudotime", pseudotimeFile);
      }

      const response = await fetch(
        "http://127.0.0.1:8000/api/projects/create-with-dataset",
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
          onBackToAlgorithms={() => setCreateStep("algorithms")}
          onUploadNext={handleUploadStepNext}
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