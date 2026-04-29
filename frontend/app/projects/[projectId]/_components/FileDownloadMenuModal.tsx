

"use client";

type FileDownloadMenuModalProps = {
  open: boolean;
  projectId?: string;
  apiBase: string;
  expressionFilename?: string | null;
  pseudotimeFilename?: string | null;
  hasPseudotime?: boolean | null;
  activeAlgorithmIds: string[];
  confidenceThreshold: number;
  consensusThreshold: number;
  onClose: () => void;
  onOpenDownload: (label: string, href: string, filename: string) => void;
};

export default function FileDownloadMenuModal({
  open,
  projectId,
  apiBase,
  expressionFilename,
  pseudotimeFilename,
  hasPseudotime,
  activeAlgorithmIds,
  confidenceThreshold,
  consensusThreshold,
  onClose,
  onOpenDownload,
}: FileDownloadMenuModalProps) {
  if (!open) return null;

  const expressionFileLabel = expressionFilename || "ExpressionData.csv";
  const pseudotimeFileLabel = pseudotimeFilename || "PseudoTime.csv";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 px-6 py-10 backdrop-blur-sm animate-modal-overlay"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 animate-modal-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
              Project downloads
            </p>
            <h3 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
              Choose a file to download
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Download the input files or the current analysis metadata.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3">
          <button
            type="button"
            onClick={() => {
              if (!projectId) return;
              onClose();
              onOpenDownload(
                "Expression matrix",
                `${apiBase}/projects/${projectId}/download/expression`,
                expressionFileLabel
              );
            }}
            className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-5 py-4 text-left transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc]"
          >
            <p className="text-sm font-bold text-slate-950">Expression matrix</p>
            <p className="mt-1 text-sm text-slate-600">{expressionFileLabel}</p>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!projectId || !hasPseudotime) return;
              onClose();
              onOpenDownload(
                "Pseudotime file",
                `${apiBase}/projects/${projectId}/download/pseudotime`,
                pseudotimeFileLabel
              );
            }}
            className={`rounded-[1.25rem] border border-slate-200 bg-slate-50 px-5 py-4 text-left transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] ${
              hasPseudotime ? "" : "pointer-events-none opacity-50"
            }`}
          >
            <p className="text-sm font-bold text-slate-950">Pseudotime file</p>
            <p className="mt-1 text-sm text-slate-600">
              {hasPseudotime ? pseudotimeFileLabel : "Not provided"}
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!projectId) return;

              const selectedView =
                activeAlgorithmIds.length >= 2
                  ? "consensus"
                  : activeAlgorithmIds[0] ?? "consensus";

              const query = new URLSearchParams({
                selected_view: selectedView,
                confidence_threshold: String(confidenceThreshold),
                consensus_threshold: String(consensusThreshold),
                selected_algorithms: activeAlgorithmIds.join(","),
              });

              onClose();
              onOpenDownload(
                "Analysis metadata",
                `${apiBase}/projects/${projectId}/download/metadata?${query.toString()}`,
                `${projectId ?? "project"}-analysis-metadata.json`
              );
            }}
            className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-5 py-4 text-left transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc]"
          >
            <p className="text-sm font-bold text-slate-950">Analysis metadata</p>
            <p className="mt-1 text-sm text-slate-600">
              JSON summary of dataset, preprocessing, algorithms, and current export settings.
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}