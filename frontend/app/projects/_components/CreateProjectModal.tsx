import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ProjectAlgorithm } from "../page";
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
  compatibleAlgorithms: ProjectAlgorithm[];
  selectedAlgorithms: ProjectAlgorithm[];
  estimatedTotalRuntime: string;
  ensembleEnabled: boolean;
  datasetSummary: DatasetSummary;
  errors: string[];
  isSubmitting: boolean;
  algorithms: ProjectAlgorithm[];
  isLoadingAlgorithms: boolean;
  algorithmLoadError: string | null;
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
  isLoadingAlgorithms,
  algorithmLoadError,
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
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isOutsideClosing, setIsOutsideClosing] = useState(false);
  const isModalClosing = isCreateClosing || isOutsideClosing;

  useLayoutEffect(() => {
    if (!isCreateVisible) return;
    contentScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [createStep, isCreateVisible]);

  useEffect(() => {
    if (isCreateVisible) {
      setIsOutsideClosing(false);
    }
  }, [isCreateVisible]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const handleOutsideClose = () => {
    if (isModalClosing) return;

    setIsOutsideClosing(true);

    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }

    closeTimeoutRef.current = setTimeout(() => {
      setIsOutsideClosing(false);
      onClose();
    }, 480);
  };

  if (!isCreateVisible) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/45 px-4 py-10 backdrop-blur-sm sm:px-6 lg:py-14 ${
        isModalClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      onClick={handleOutsideClose}
    >
      <div
        className={`max-h-[calc(100vh-5rem)] w-full max-w-6xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 lg:p-8 ${
          isModalClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div ref={contentScrollRef}>
        <div className="flex items-start justify-between gap-6 border-b border-[#213f54]/20 pb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#1b75a6]">
              Workspace setup
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
              Create New Project
            </h2>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              createStep === "upload"
                ? "border border-[#1b75a6]/20 bg-[#f2f9fc] text-[#1b75a6]"
                : "border border-slate-200 bg-slate-50 text-slate-500"
            }`}
          >
            1. Upload
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              createStep === "preprocessing"
                ? "border border-[#1b75a6]/20 bg-[#f2f9fc] text-[#1b75a6]"
                : "border border-slate-200 bg-slate-50 text-slate-500"
            }`}
          >
            2. Data preprocessing
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              createStep === "algorithms"
                ? "border border-[#1b75a6]/20 bg-[#f2f9fc] text-[#1b75a6]"
                : "border border-slate-200 bg-slate-50 text-slate-500"
            }`}
          >
            3. Algorithms
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              createStep === "review"
                ? "border border-[#1b75a6]/20 bg-[#f2f9fc] text-[#1b75a6]"
                : "border border-slate-200 bg-slate-50 text-slate-500"
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
                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-bold text-slate-950">
                        Gene filtering by variability
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        Retain the top most-variable genes for downstream
                        inference.
                      </p>
                    </div>
                    <span className="rounded-full border border-[#20b779]/20 bg-[#e8f7f1] px-3 py-1 text-xs font-bold text-[#178a62]">
                      Required
                    </span>
                  </div>

                  <div className="mt-6">
                    <label className="mb-2 block text-sm font-bold text-slate-700">
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
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 [appearance:textfield] focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      {geneCount !== null
                        ? `This dataset contains ${geneCount.toLocaleString()} genes, so the value cannot be larger than ${geneCount.toLocaleString()}.`
                        : "The maximum value will match the number of genes detected in the uploaded dataset after validation."}
                    </p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-bold text-slate-950">
                          Transcription factor inclusion override
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          Retain all known transcription factors even if they
                          fall outside the top-N variability cutoff.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIncludeAllTFs(!includeAllTFs)}
                        className={`shrink-0 self-start appearance-none border-0 inline-flex h-7 w-14 items-center rounded-full px-1 transition ${
                          includeAllTFs
                            ? "cursor-pointer justify-end bg-[#1b75a6]"
                            : "cursor-pointer justify-start bg-slate-300"
                        }`}
                      >
                        <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-bold text-slate-950">
                          Normalization
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          Apply library-size normalization to correct for
                          sequencing-depth variation across cells.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNormalizeEnabled(!normalizeEnabled)}
                        className={`shrink-0 self-start appearance-none border-0 inline-flex h-7 w-14 items-center rounded-full px-1 transition ${
                          normalizeEnabled
                            ? "cursor-pointer justify-end bg-[#1b75a6]"
                            : "cursor-pointer justify-start bg-slate-300"
                        }`}
                      >
                        <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-bold text-slate-950">
                          Log-transformation
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
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
                            ? "cursor-pointer justify-end bg-[#1b75a6]"
                            : "cursor-pointer justify-start bg-slate-300"
                        }`}
                      >
                        <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {createStep === "preprocessing" && (
            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-6">
              <h3 className="text-xl font-bold text-slate-950">
                Preprocessing summary
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">
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
              isLoadingAlgorithms={isLoadingAlgorithms}
              algorithmLoadError={algorithmLoadError}
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
            />
          )}

          {errors.length > 0 && (
            <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-5">
              <p className="text-sm font-bold text-rose-700">
                Please fix the following issues:
              </p>
              <ul className="mt-3 space-y-2 text-sm text-rose-700">
                {errors.map((error, index) => (
                  <li key={index}>• {error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#213f54]/20 pt-6">
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
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
            >
              {createStep === "upload" ? "Cancel" : "Back"}
            </button>

            {createStep === "upload" && (
              <button
                type="button"
                onClick={onUploadNext}
                disabled={isUploadingTempDataset}
                className="cursor-pointer rounded-full bg-[#1b75a6] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#155f87] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploadingTempDataset ? "Uploading..." : "Next"}
              </button>
            )}

            {createStep === "preprocessing" && (
              <button
                type="button"
                onClick={onPreprocessingNext}
                className="cursor-pointer rounded-full bg-[#1b75a6] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#155f87]"
              >
                Next
              </button>
            )}

            {createStep === "algorithms" && (
              <button
                type="button"
                onClick={onAlgorithmsNext}
                className="cursor-pointer rounded-full bg-[#1b75a6] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#155f87]"
              >
                Next
              </button>
            )}

            {createStep === "review" && (
              <button
                type="button"
                onClick={onCreateProject}
                disabled={isSubmitting}
                className="cursor-pointer rounded-full bg-[#1b75a6] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#155f87] disabled:cursor-not-allowed disabled:opacity-60"
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