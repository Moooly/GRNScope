"use client";

type AlgorithmTask = {
  algorithm_id: string;
  status: string;
  error_message?: string | null;
  progress_percent?: number | null;
  progress_label?: string | null;
};

type AlgorithmMeta = {
  name?: string;
};

type AlgorithmErrorTask = {
  algorithmId: string;
  errorMessage: string;
};

type AlgorithmCardsSectionProps = {
  tasks: AlgorithmTask[];
  algorithmMetaMap: Map<string, AlgorithmMeta>;
  projectId?: string;
  apiBase: string;
  onOpenDownload: (label: string, href: string, filename: string) => void;
  onOpenAlgorithmError: (task: AlgorithmErrorTask) => void;
};

/**
 * Compact summary of every algorithm that participated in this project's job.
 * Lives at the bottom of the project page now — the live progress for any
 * still-running algorithms is surfaced separately by JobProgressBanner near
 * the top, so this section only needs to expose terminal state + actions.
 */
export default function AlgorithmCardsSection({
  tasks,
  algorithmMetaMap,
  projectId,
  apiBase,
  onOpenDownload,
  onOpenAlgorithmError,
}: AlgorithmCardsSectionProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white/95 p-6 text-slate-900 shadow-sm">
      <h2 className="text-xl font-bold text-slate-950">Algorithms used</h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tasks.map((task) => {
          const meta = algorithmMetaMap.get(task.algorithm_id);
          const name = meta?.name ?? task.algorithm_id;
          const isCompleted = task.status === "Completed";
          const isFailed = task.status === "Failed";
          const isPending = !isCompleted && !isFailed;

          return (
            <div
              key={task.algorithm_id}
              className={`flex flex-col rounded-2xl border px-4 py-3.5 transition ${
                isFailed
                  ? "border-rose-200 bg-rose-50/40"
                  : isCompleted
                    ? "border-slate-200 bg-white"
                    : "border-slate-200 bg-slate-50/60"
              }`}
            >
              <div className="flex items-center gap-2">
                <StatusGlyph status={task.status} />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950">
                  {name}
                </p>
              </div>

              <div className="mt-3">
                {isCompleted && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!projectId) return;
                      onOpenDownload(
                        `${name} raw result`,
                        `${apiBase}/projects/${projectId}/download/result/${task.algorithm_id}`,
                        `${task.algorithm_id}-raw-ranked-edges.csv`
                      );
                    }}
                    className="w-full rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                  >
                    Download result
                  </button>
                )}

                {isFailed && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenAlgorithmError({
                        algorithmId: task.algorithm_id,
                        errorMessage:
                          task.error_message?.replace(/\/Users\/[^ ]+/g, "server log file") ||
                          "This algorithm failed. The server did not return a detailed message.",
                      })
                    }
                    className="w-full rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
                  >
                    View error
                  </button>
                )}

                {isPending && (
                  <p className="text-center text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
                    {task.status}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusGlyph({ status }: { status: string }) {
  if (status === "Completed") {
    return (
      <span
        aria-label="Completed"
        title="Completed"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#20b779]/15 text-[#178a62]"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3">
          <path
            d="M3.4 8.1 6.5 11.2 12.8 4.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  if (status === "Failed") {
    return (
      <span
        aria-label="Failed"
        title="Failed"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-[10px] font-bold text-rose-600"
      >
        !
      </span>
    );
  }

  return (
    <span
      aria-label={status}
      title={status}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
    </span>
  );
}
