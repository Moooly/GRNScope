

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
  const selectedView =
    activeAlgorithmIds.length >= 2
      ? "consensus"
      : activeAlgorithmIds[0] ?? "consensus";
  const metadataQuery = new URLSearchParams({
    selected_view: selectedView,
    confidence_threshold: String(confidenceThreshold),
    consensus_threshold: String(consensusThreshold),
    selected_algorithms: activeAlgorithmIds.join(","),
  });
  const files = [
    {
      label: "Expression matrix",
      description: expressionFileLabel,
      type: "CSV",
      disabled: !projectId,
      href: projectId ? `${apiBase}/projects/${projectId}/download/expression` : "",
      filename: expressionFileLabel,
    },
    {
      label: "Pseudotime file",
      description: hasPseudotime ? pseudotimeFileLabel : "Not provided for this project",
      type: "CSV",
      disabled: !projectId || !hasPseudotime,
      href: projectId ? `${apiBase}/projects/${projectId}/download/pseudotime` : "",
      filename: pseudotimeFileLabel,
    },
    {
      label: "Analysis metadata",
      description: "Dataset, preprocessing, algorithms, and current export settings.",
      type: "JSON",
      disabled: !projectId,
      href: projectId
        ? `${apiBase}/projects/${projectId}/download/metadata?${metadataQuery.toString()}`
        : "",
      filename: `${projectId ?? "project"}-analysis-metadata.json`,
    },
  ];

  return (
    <div
      className="absolute bottom-[calc(100%+0.75rem)] right-0 z-40 w-[min(28rem,calc(100vw-3rem))] text-slate-900"
      role="dialog"
      aria-modal="false"
      aria-labelledby="project-download-title"
    >
      <span
        aria-hidden="true"
        className="absolute -bottom-1.5 right-8 z-20 h-3 w-3 rotate-45 border-b border-r border-slate-200 bg-white"
      />
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/20">
        <div className="px-4 pb-3 pt-4">
          <h3 id="project-download-title" className="text-sm font-bold text-slate-950">
            Download project files
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Choose an input file or analysis metadata.
          </p>
        </div>

        <div className="border-t border-slate-100 p-2">
          {files.map((file) => (
            <button
              key={file.label}
              type="button"
              disabled={file.disabled}
              onClick={() => {
                if (file.disabled) return;
                onClose();
                onOpenDownload(file.label, file.href, file.filename);
              }}
              className="group flex w-full items-center justify-between gap-4 rounded-xl px-3 py-3 text-left transition hover:bg-[#f2f9fc] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
            >
              <div>
                <p className="text-sm font-bold text-slate-950 group-hover:text-[#1b75a6] group-disabled:text-slate-500">
                  {file.label}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">{file.description}</p>
              </div>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                {file.type}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
