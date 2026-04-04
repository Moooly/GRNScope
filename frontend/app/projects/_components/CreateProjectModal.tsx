import { Algorithm } from "../_types/algorithm";
import AlgorithmStep from "./AlgorithmStep";
import ReviewStep from "./ReviewStep";
import UploadStep from "./UploadStep";

type CreateStep = "upload" | "algorithms" | "review";

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
  onBackToAlgorithms: () => void;
  onUploadNext: () => void;
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
  onBackToAlgorithms,
  onUploadNext,
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
  clearExpressionFile,
  clearPseudotimeFile,
  setEnsembleEnabled,
}: CreateProjectModalProps) {
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
        className={`max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-[2rem] border border-white/10 bg-slate-900 p-6 shadow-2xl shadow-cyan-950/20 lg:p-8 ${
          isCreateClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6 border-b border-white/10 pb-5">
          <div>
            <h2 className="mt-3 text-3xl font-semibold text-white">
              Create New Project
            </h2>
          </div>
        </div>

        <div className="mt-8 flex items-center gap-3">
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
              createStep === "algorithms"
                ? "bg-teal-300/10 text-teal-200"
                : "bg-white/[0.04] text-slate-400"
            }`}
          >
            2. Algorithms
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              createStep === "review"
                ? "bg-teal-300/10 text-teal-200"
                : "bg-white/[0.04] text-slate-400"
            }`}
          >
            3. Review
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
                  : createStep === "algorithms"
                    ? onBackToUpload
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
  );
}