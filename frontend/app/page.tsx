"use client";

import { useState } from "react";
import CreateProjectModal from "./projects/_components/CreateProjectModal";

export default function HomePage() {
  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [expressionFile, setExpressionFile] = useState<File | null>(null);
  const [expressionFileName, setExpressionFileName] = useState("");
  const [pseudotimeFile, setPseudotimeFile] = useState<File | null>(null);
  const [pseudotimeFileName, setPseudotimeFileName] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const handleStartProject = () => {
    setErrors([]);
    setProjectName("");
    setProjectDescription("");
    setExpressionFile(null);
    setExpressionFileName("");
    setPseudotimeFile(null);
    setPseudotimeFileName("");
    setIsCreateVisible(true);
  };

  const handleCloseCreateModal = () => {
    setIsCreateVisible(false);
  };

  const handleUploadNext = () => {
    const nextErrors: string[] = [];

    if (!projectName.trim()) {
      nextErrors.push("Project name is required.");
    }

    if (!expressionFile) {
      nextErrors.push("Expression matrix is required.");
    }

    setErrors(nextErrors);
  };
  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="relative overflow-hidden bg-[#f4f6f8]">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/90 to-transparent" />
        <div className="absolute -left-24 top-28 h-72 w-72 rounded-full bg-cyan-100/60 blur-3xl" />
        <div className="absolute -right-24 top-20 h-72 w-72 rounded-full bg-teal-100/60 blur-3xl" />

        <div className="relative mx-auto max-w-[1180px] px-6 pb-20 pt-20 lg:px-10 lg:pb-24 lg:pt-24">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_0.5fr] lg:items-start">
            <div className="max-w-none">
              <p className="mb-4 text-sm font-bold uppercase tracking-[0.28em] text-[#1b75a6]">
                Gene regulatory network analysis
              </p>

              <h1 className="text-5xl font-bold tracking-tight text-slate-950 sm:text-6xl lg:text-[4.15rem] lg:leading-[1.02]">
                GRNScope
              </h1>

              <div className="mt-6 max-w-none space-y-5 text-[1.05rem] leading-8 text-slate-700 lg:max-w-[78rem]">
                <p>
                  GRNScope analyzes gene regulatory networks from single-cell
                  RNA-seq expression data and turns expression matrices into
                  predicted regulatory relationships between genes.
                </p>
                <p>
                  It runs multiple inference algorithms, compares ranked edges,
                  builds consensus networks, and provides interactive views,
                  edge tables, overlap analysis, and export tools.
                </p>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white bg-white/80 p-6 shadow-sm backdrop-blur">
              <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
                Direct start
              </p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">
                Start a new GRN analysis
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Upload an expression matrix to start a GRN analysis directly.
              </p>

              <button
                type="button"
                onClick={handleStartProject}
                className="mt-7 inline-flex w-full cursor-pointer items-center justify-center rounded-full bg-[#213f54] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#172d3c]"
              >
                Upload expression matrix to start
              </button>

            </div>
          </div>
        </div>
      </section>
      <CreateProjectModal
        isCreateVisible={isCreateVisible}
        isCreateClosing={false}
        createStep="upload"
        projectName={projectName}
        projectDescription={projectDescription}
        expressionFileName={expressionFileName}
        pseudotimeFileName={pseudotimeFileName}
        geneCount={null}
        cellCount={null}
        isUploadingTempDataset={false}
        topVariableGenes="2000"
        includeAllTFs={true}
        normalizeEnabled={true}
        logTransformEnabled={true}
        selectedIds={[]}
        compatibleAlgorithms={[]}
        selectedAlgorithms={[]}
        estimatedTotalRuntime=""
        ensembleEnabled={true}
        datasetSummary={{
          dimensions: "Not available yet",
          hasPseudotime: Boolean(pseudotimeFile),
          preprocessingSummary: [],
        }}
        errors={errors}
        isSubmitting={false}
        algorithms={[]}
        isLoadingAlgorithms={false}
        algorithmLoadError={null}
        onClose={handleCloseCreateModal}
        onBackToUpload={() => undefined}
        onBackToPreprocessing={() => undefined}
        onBackToAlgorithms={() => undefined}
        onUploadNext={handleUploadNext}
        onPreprocessingNext={() => undefined}
        onAlgorithmsNext={() => undefined}
        onCreateProject={() => undefined}
        onRecommended={() => undefined}
        onSelectAll={() => undefined}
        onToggleAlgorithm={() => undefined}
        setProjectName={setProjectName}
        setProjectDescription={setProjectDescription}
        setExpressionFile={setExpressionFile}
        setExpressionFileName={setExpressionFileName}
        setPseudotimeFile={setPseudotimeFile}
        setPseudotimeFileName={setPseudotimeFileName}
        setTopVariableGenes={() => undefined}
        setIncludeAllTFs={() => undefined}
        setNormalizeEnabled={() => undefined}
        setLogTransformEnabled={() => undefined}
        clearExpressionFile={() => {
          setExpressionFile(null);
          setExpressionFileName("");
        }}
        clearPseudotimeFile={() => {
          setPseudotimeFile(null);
          setPseudotimeFileName("");
        }}
        setEnsembleEnabled={() => undefined}
      />
    </main>
  );
}