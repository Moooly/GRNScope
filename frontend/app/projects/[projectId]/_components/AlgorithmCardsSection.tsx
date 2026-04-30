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
  category?: string;
  year?: string;
  requiresPseudotime?: boolean;
  directed?: boolean;
  signed?: boolean;
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
  onOpenHelp: () => void;
  onOpenDownload: (label: string, href: string, filename: string) => void;
  onOpenAlgorithmError: (task: AlgorithmErrorTask) => void;
};

export default function AlgorithmCardsSection({
  tasks,
  algorithmMetaMap,
  projectId,
  apiBase,
  onOpenHelp,
  onOpenDownload,
  onOpenAlgorithmError,
}: AlgorithmCardsSectionProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="group mt-8 rounded-[1.5rem] border border-slate-200 bg-white/95 p-6 text-slate-900 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-950">Algorithms used</h2>
            <button
              type="button"
              onClick={onOpenHelp}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] text-xs font-bold text-[#1b75a6] transition hover:border-[#1b75a6]/35 hover:bg-[#e8f5fb]"
              aria-label="Open algorithms guide"
              title="Open algorithms guide"
            >
              ?
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto pb-2">
        <div className="flex min-w-max gap-3 pr-32">
          {tasks.map((task) => {
            const meta = algorithmMetaMap.get(task.algorithm_id);
            const progressPercent = Math.max(
              0,
              Math.min(100, Number(task.progress_percent ?? 0))
            );
            const progressLabel =
              typeof task.progress_label === "string" && task.progress_label.trim().length > 0
                ? task.progress_label
                : task.status;

            return (
              <div
                key={task.algorithm_id}
                className="flex w-[23rem] shrink-0 flex-col rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-2xl font-bold tracking-tight text-slate-950">
                      {meta?.name ?? task.algorithm_id}
                    </p>
                  </div>

                  {task.status === "Completed" ? (
                    <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {meta?.year ?? "Done"}
                    </span>
                  ) : task.status === "Failed" ? (
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
                      className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-2 text-sm font-bold text-rose-600 transition hover:border-rose-300 hover:bg-rose-100"
                      aria-label={`View error for ${task.algorithm_id}`}
                      title="View error"
                    >
                      !
                    </button>
                  ) : task.status === "Running" ? (
                    <span
                      className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center"
                      aria-label={`${progressPercent}% complete for ${task.algorithm_id}`}
                      title={`${progressPercent}% • ${progressLabel}`}
                      style={{
                        background: `conic-gradient(#1b75a6 ${progressPercent * 3.6}deg, rgba(27,117,166,0.14) 0deg)`,
                        borderRadius: "9999px",
                      }}
                    >
                      <span className="absolute inset-[2px] rounded-full bg-white" />
                      <span className="relative text-[9px] font-bold text-[#1b75a6]">
                        {progressPercent}%
                      </span>
                    </span>
                  ) : task.status === "Queued" ? (
                    <span
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-amber-200 bg-amber-50"
                      aria-label={`Queued ${task.algorithm_id}`}
                      title="Queued"
                    >
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="truncate text-sm font-bold text-slate-800">
                    {meta?.category ?? "Algorithm"}
                  </p>
                </div>

                <div className="mt-4 flex flex-nowrap gap-2 text-xs">
                  <span className="whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-medium leading-none text-slate-600">
                    {meta?.requiresPseudotime ? "Pseudotime" : "No pseudotime"}
                  </span>
                  <span className="whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-medium leading-none text-slate-600">
                    {meta?.directed ? "Directed" : "Undirected"}
                  </span>
                  <span className="whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-medium leading-none text-slate-600">
                    {meta?.signed ? "Signed" : "Unsigned"}
                  </span>
                </div>

                {(task.status === "Running" || task.status === "Queued") && (
                  <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                    {progressLabel}
                  </p>
                )}

                {task.status === "Completed" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!projectId) return;
                      onOpenDownload(
                        `${task.algorithm_id} raw result`,
                        `${apiBase}/projects/${projectId}/download/result/${task.algorithm_id}`,
                        `${task.algorithm_id}-raw-ranked-edges.csv`
                      );
                    }}
                    className="mt-5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                  >
                    Download result
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}