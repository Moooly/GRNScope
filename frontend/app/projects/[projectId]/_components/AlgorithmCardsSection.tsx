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
}: AlgorithmCardsSectionProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white p-5 text-slate-900 shadow-sm">
      <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-black">Algorithms used</h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {tasks.map((task) => {
          const meta = algorithmMetaMap.get(task.algorithm_id);
          const name = meta?.name ?? task.algorithm_id;
          const isCompleted = task.status === "Completed";
          const isFailed = task.status === "Failed";
          const isPending = !isCompleted && !isFailed;

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
                      : undefined
                  }
                />
                <p className="min-w-0 flex-1 whitespace-nowrap text-sm font-semibold text-slate-950">
                  {name}
                </p>
                {isPending ? (
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    {task.status}
                  </span>
                ) : null}
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

  return (
    <span
      aria-label={status}
      title={status}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
    </span>
  );
}
