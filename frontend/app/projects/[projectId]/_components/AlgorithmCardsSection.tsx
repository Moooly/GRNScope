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
  onOpenAlgorithmError: (task: AlgorithmErrorTask) => void;
  onStopAlgorithm: (task: { algorithmId: string; algorithmName: string }) => void;
  onRerunAlgorithm: (task: { algorithmId: string; algorithmName: string }) => void;
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
  onOpenAlgorithmError,
  onStopAlgorithm,
  onRerunAlgorithm,
}: AlgorithmCardsSectionProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white p-5 text-slate-900 shadow-sm">
      <h2 className="text-xl font-bold tracking-tight text-slate-950">Algorithms Executed</h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {tasks.map((task) => {
          const meta = algorithmMetaMap.get(task.algorithm_id);
          const name = meta?.name ?? task.algorithm_id;
          const isCompleted = task.status === "Completed";
          const isFailed = task.status === "Failed";
          const isStopped = task.status === "Stopped";
          const canStop = task.status === "Running" || task.status === "Queued";

          return (
            <div
              key={task.algorithm_id}
              className={`group flex min-h-[3.5rem] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition duration-150 ${
                isFailed
                  ? "border-rose-200 bg-rose-50/50"
                  : isCompleted
                    ? "border-[#1b75a6]/25 bg-[#f7fbff]"
                    : "border-slate-200 bg-white hover:border-[#1b75a6]/20 hover:bg-[#f7fbff]"
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <StatusGlyph
                  status={task.status}
                  onClick={
                    isFailed
                      ? () =>
                          onOpenAlgorithmError({
                            algorithmId: task.algorithm_id,
                            errorMessage:
                              task.error_message?.replace(/\/Users\/[^ ]+/g, "server log file") ||
                              "This algorithm failed. The server did not return a detailed message.",
                          })
                      : canStop
                        ? () =>
                            onStopAlgorithm({
                              algorithmId: task.algorithm_id,
                              algorithmName: name,
                            })
                        : isStopped
                          ? () =>
                              onRerunAlgorithm({
                                algorithmId: task.algorithm_id,
                                algorithmName: name,
                              })
                      : undefined
                  }
                />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950" title={name}>
                  {name}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusGlyph({ status, onClick }: { status: string; onClick?: () => void }) {
  if (status === "Completed") {
    return (
      <span
        aria-label="Completed"
        title="Completed"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#20b779]/25 bg-[#20b779]/10 text-[#178a62]"
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
      <button
        type="button"
        aria-label="View algorithm error"
        title="View error"
        onClick={onClick}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-[10px] font-bold text-rose-600 transition hover:bg-rose-100 hover:text-rose-700"
      >
        !
      </button>
    );
  }

  if (status === "Stopped") {
    return (
      <button
        type="button"
        aria-label="Run algorithm again"
        title="Run again"
        onClick={onClick}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
          <path
            d="M12.6 5.1A5 5 0 1 0 13 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M12.7 2.7v2.7h-2.7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        aria-label="Stop algorithm"
        title="Stop algorithm"
        onClick={onClick}
        className="group/stop relative inline-flex h-6 w-6 shrink-0 items-center justify-center text-[#1b75a6] transition hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 focus-visible:ring-offset-2"
      >
        <span className="absolute h-5 w-5 animate-spin rounded-full border-2 border-current/20 border-t-current" />
        <span className="h-1.5 w-1.5 rounded-[2px] bg-current transition group-hover/stop:scale-110" />
      </button>
    );
  }

  return (
    <span
      aria-label={status}
      title={status}
      className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-slate-400"
    />
  );
}
