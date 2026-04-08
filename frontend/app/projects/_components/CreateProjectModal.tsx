import { useLayoutEffect, useRef } from "react";
import { Algorithm } from "../_types/algorithm";
import AlgorithmStep from "./AlgorithmStep";
import ReviewStep from "./ReviewStep";
import UploadStep from "./UploadStep";

type CreateStep = "upload" | "preprocessing" | "algorithms" | "review";

interface DatasetSummary {
  dimensions: string;
  hasPseudotime: boolean;
  preprocessingSummary: string[];
}

interface CreateProjectModalProps {
  isCreateVisible: boolean;
  isCreateClosing: boolean;
  createStep: CreateStep;
  projectName: string;
  projectDescription: string;
  expressionFileName: string;
  pseudotimeFileName: string;
  geneCount: number | null;
  cellCount: number | null;
  isUploadingTempDataset: boolean;
  topVariableGenes: string;
  includeAllTFs: boolean;
  normalizeEnabled: boolean;
  logTransformEnabled: boolean;
  selectedIds: string[];
  compatibleAlgorithms: Algorithm[];
  selectedAlgorithms: Algorithm[];
  estimatedTotalRuntime: string;
  ensembleEnabled: boolean;
  datasetSummary: DatasetSummary;
  errors: string[];
  isSubmitting: boolean;
  algorithms: Algorithm[];
  onClose: () => void;
  onBackToUpload: () => void;
  onBackToPreprocessing: () => void;
  onBackToAlgorithms: () => void;
  onUploadNext: () => void;
  onPreprocessingNext: () => void;
  onAlgorithmsNext: () => void;
  onCreateProject: () => void;
  onRecommended: () => void;
  onSelectAll: () => void;
  onToggleAlgorithm: (algorithmId: string, disabled: boolean) => void;
  setProjectName: (value: string) => void;
  setProjectDescription: (value: string) => void;
  setExpressionFile: (file: File | null) => void;
  setExpressionFileName: (value: string) => void;
  setPseudotimeFile: (file: File | null) => void;
  setPseudotimeFileName: (value: string) => void;
  setTopVariableGenes: (value: string) => void;
  setIncludeAllTFs: (value: boolean) => void;
  setNormalizeEnabled: (value: boolean) => void;
  setLogTransformEnabled: (value: boolean) => void;
  clearExpressionFile: () => void;
  clearPseudotimeFile: () => void;
  setEnsembleEnabled: (value: boolean | ((current: boolean) => boolean)) => void;
}

export default function CreateProjectModal({
  isCreateVisible,
  isCreateClosing,
  createStep,
  projectName,
  projectDescription,
  expressionFileName,
  pseudotimeFileName,
  geneCount,
  cellCount,
  isUploadingTempDataset,
  topVariableGenes,
  includeAllTFs,
  normalizeEnabled,
  logTransformEnabled,
  selectedIds,
  compatibleAlgorithms,
  selectedAlgorithms,
  estimatedTotalRuntime,
  ensembleEnabled,
  datasetSummary,
  errors,
  isSubmitting,
  algorithms,
  onClose,
  onBackToUpload,
  onBackToPreprocessing,
  onBackToAlgorithms,
  onUploadNext,
  onPreprocessingNext,
  onAlgorithmsNext,
  onCreateProject,
  onRecommended,
  onSelectAll,
  onToggleAlgorithm,
  setProjectName,
  setProjectDescription,
  setExpressionFile,
  setExpressionFileName,
  setPseudotimeFile,
  setPseudotimeFileName,
  setTopVariableGenes,
  setIncludeAllTFs,
  setNormalizeEnabled,
  setLogTransformEnabled,
  clearExpressionFile,
  clearPseudotimeFile,
  setEnsembleEnabled,
}: CreateProjectModalProps) {
  const contentScrollRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!isCreateVisible) return;
    contentScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [createStep, isCreateVisible]);

  if (!isCreateVisible) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-6 py-10 backdrop-blur-sm ${
        isCreateClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-6xl rounded-[2rem] border border-white/10 bg-slate-900 p-6 shadow-2xl shadow-cyan-950/20 lg:p-8 ${
          isCreateClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div ref={contentScrollRef} className="max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-6 border-b border-white/10 pb-5">
          <div>
            <h2 className="mt-3 text-3xl font-semibold text-white">
              Create New Project
            </h2>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              createStep === "upload"
                ? "bg-teal-300/10 text-teal-200"
                : "bg-white/[0.04] text-slate-400"
            }`}
          >
            1. Upload
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              createStep === "preprocessing"
                ? "bg-teal-300/10 text-teal-200"
                : "bg-white/[0.04] text-slate-400"
            }`}
          >
            2. Data preprocessing
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              createStep === "algorithms"
                ? "bg-teal-300/10 text-teal-200"
                : "bg-white/[0.04] text-slate-400"
            }`}
          >
            3. Algorithms
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              createStep === "review"
                ? "bg-teal-300/10 text-teal-200"
                : "bg-white/[0.04] text-slate-400"
            }`}
          >
            4. Review
          </span>
        </div>

        <div className="mt-8 space-y-8">
          {createStep === "upload" && (
            <UploadStep
              projectName={projectName}
              projectDescription={projectDescription}
              expressionFileName={expressionFileName}
              pseudotimeFileName={pseudotimeFileName}
              setProjectName={setProjectName}
              setProjectDescription={setProjectDescription}
              setExpressionFile={setExpressionFile}
              setExpressionFileName={setExpressionFileName}
              setPseudotimeFile={setPseudotimeFile}
              setPseudotimeFileName={setPseudotimeFileName}
              clearExpressionFile={clearExpressionFile}
              clearPseudotimeFile={clearPseudotimeFile}
            />
          )}

          {createStep === "preprocessing" && (
            <div className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-semibold text-white">
                        Gene filtering by variability
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-400">
                        Retain the top most-variable genes for downstream
                        inference.
                      </p>
                    </div>
                    <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-200">
                      Required
                    </span>
                  </div>

                  <div className="mt-6">
                    <label className="mb-2 block text-sm font-medium text-slate-200">
                      Top variable genes
                    </label>
                    <input
                      type="number"
                      min="1"
                      max={geneCount ?? undefined}
                      step="1"
                      value={topVariableGenes}
                      onChange={(e) => {
                        const nextValue = e.target.value;

                        if (nextValue === "") {
                          setTopVariableGenes("");
                          return;
                        }

                        const parsedValue = Number(nextValue);
                        if (Number.isNaN(parsedValue)) {
                          return;
                        }

                        if (geneCount !== null && parsedValue > geneCount) {
                          setTopVariableGenes(String(geneCount));
                          return;
                        }

                        setTopVariableGenes(nextValue);
                      }}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300/40"
                    />
                    <p className="mt-3 text-xs leading-5 text-slate-400">
                      {geneCount !== null
                        ? `This dataset contains ${geneCount.toLocaleString()} genes, so the value cannot be larger than ${geneCount.toLocaleString()}.`
                        : "The maximum value will match the number of genes detected in the uploaded dataset after validation."}
                    </p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-semibold text-white">
                          Transcription factor inclusion override
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-400">
                          Retain all known transcription factors even if they
                          fall outside the top-N variability cutoff.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIncludeAllTFs(!includeAllTFs)}
                        className={`shrink-0 self-start appearance-none border-0 inline-flex h-7 w-14 items-center rounded-full px-1 transition ${
                          includeAllTFs
                            ? "cursor-pointer justify-end bg-teal-400"
                            : "cursor-pointer justify-start bg-white/20"
                        }`}
                      >
                        <span className="h-5 w-5 rounded-full bg-slate-950" />
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-semibold text-white">
                          Normalization
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-400">
                          Apply library-size normalization to correct for
                          sequencing-depth variation across cells.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNormalizeEnabled(!normalizeEnabled)}
                        className={`shrink-0 self-start appearance-none border-0 inline-flex h-7 w-14 items-center rounded-full px-1 transition ${
                          normalizeEnabled
                            ? "cursor-pointer justify-end bg-teal-400"
                            : "cursor-pointer justify-start bg-white/20"
                        }`}
                      >
                        <span className="h-5 w-5 rounded-full bg-slate-950" />
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-semibold text-white">
                          Log-transformation
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-400">
                          Apply a log₂(x + 1) transformation after normalization.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setLogTransformEnabled(!logTransformEnabled)
                        }
                        className={`shrink-0 self-start appearance-none border-0 inline-flex h-7 w-14 items-center rounded-full px-1 transition ${
                          logTransformEnabled
                            ? "cursor-pointer justify-end bg-teal-400"
                            : "cursor-pointer justify-start bg-white/20"
                        }`}
                      >
                        <span className="h-5 w-5 rounded-full bg-slate-950" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {createStep === "preprocessing" && (
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
              <h3 className="text-xl font-semibold text-white">
                Preprocessing summary
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                {geneCount !== null && cellCount !== null
                  ? `Your ${geneCount.toLocaleString()} genes × ${cellCount.toLocaleString()} cells matrix will be filtered to ${topVariableGenes || "0"} genes.`
                  : `Your uploaded matrix will be filtered to ${topVariableGenes || "0"} genes.`}
              </p>
            </div>
          )}

          {createStep === "algorithms" && (
            <AlgorithmStep
              algorithms={algorithms}
              selectedIds={selectedIds}
              compatibleAlgorithms={compatibleAlgorithms}
              datasetSummary={datasetSummary}
              ensembleEnabled={ensembleEnabled}
              setEnsembleEnabled={setEnsembleEnabled}
              onToggleAlgorithm={onToggleAlgorithm}
              onRecommended={onRecommended}
              onSelectAll={onSelectAll}
            />
          )}

          {createStep === "review" && (
            <ReviewStep
              projectName={projectName}
              projectDescription={projectDescription}
              expressionFileName={expressionFileName}
              pseudotimeFileName={pseudotimeFileName}
              datasetSummary={datasetSummary}
              selectedAlgorithms={selectedAlgorithms}
              estimatedTotalRuntime={estimatedTotalRuntime}
            />
          )}

          {errors.length > 0 && (
            <div className="rounded-[2rem] border border-rose-300/20 bg-rose-300/10 p-5">
              <p className="text-sm font-medium text-rose-200">
                Please fix the following issues:
              </p>
              <ul className="mt-3 space-y-2 text-sm text-slate-200">
                {errors.map((error, index) => (
                  <li key={index}>• {error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 pt-6">
            <button
              type="button"
              onClick={
                createStep === "upload"
                  ? onClose
                  : createStep === "preprocessing"
                    ? onBackToUpload
                    : createStep === "algorithms"
                      ? onBackToPreprocessing
                      : onBackToAlgorithms
              }
              className="cursor-pointer rounded-2xl border border-white/15 px-5 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
            >
              {createStep === "upload" ? "Cancel" : "Back"}
            </button>

            {createStep === "upload" && (
              <button
                type="button"
                onClick={onUploadNext}
                disabled={isUploadingTempDataset}
                className="cursor-pointer rounded-2xl bg-teal-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploadingTempDataset ? "Uploading..." : "Next"}
              </button>
            )}

            {createStep === "preprocessing" && (
              <button
                type="button"
                onClick={onPreprocessingNext}
                className="cursor-pointer rounded-2xl bg-teal-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
              >
                Next
              </button>
            )}

            {createStep === "algorithms" && (
              <button
                type="button"
                onClick={onAlgorithmsNext}
                className="cursor-pointer rounded-2xl bg-teal-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
              >
                Next
              </button>
            )}

            {createStep === "review" && (
              <button
                type="button"
                onClick={onCreateProject}
                disabled={isSubmitting}
                className="cursor-pointer rounded-2xl bg-teal-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Creating..." : "Create project"}
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}