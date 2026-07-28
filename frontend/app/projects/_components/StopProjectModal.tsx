interface StopProjectModalProps {
  projectName: string | null;
  runningCount: number;
  queuedCount: number;
  isStopping: boolean;
  isClosing: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function StopProjectModal({
  projectName,
  runningCount,
  queuedCount,
  isStopping,
  isClosing,
  error = "",
  onCancel,
  onConfirm,
}: StopProjectModalProps) {
  if (!projectName) return null;

  const parts: string[] = [];
  if (runningCount > 0) {
    parts.push(`${runningCount} ${runningCount === 1 ? "running algorithm" : "running algorithms"}`);
  }
  if (queuedCount > 0) {
    parts.push(`${queuedCount} ${queuedCount === 1 ? "queued algorithm" : "queued algorithms"}`);
  }
  const summary = parts.length > 0
    ? parts.join(" and ")
    : "any in-flight work";

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-6 py-10 backdrop-blur-sm ${
        isClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
    >
      <div
        className={`w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 ${
          isClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
      >
        <p className="text-sm font-bold uppercase tracking-[0.22em] text-amber-600">
          Stop project
        </p>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          This will stop {summary} for this project. Partial results are kept and each algorithm can be re-run later.
        </p>

        <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
          <p className="min-w-0 max-w-full break-words font-bold leading-5 text-slate-900 [overflow-wrap:anywhere]">
            {projectName}
          </p>
        </div>

        {error ? (
          <p
            className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-3 border-t border-[#213f54]/15 pt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isStopping}
            className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Keep running
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isStopping}
            className="rounded-full border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-bold text-amber-700 transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isStopping ? "Stopping..." : "Stop project"}
          </button>
        </div>
      </div>
    </div>
  );
}
