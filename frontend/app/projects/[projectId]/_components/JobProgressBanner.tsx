"use client";

type JobTask = {
  algorithm_id: string;
  status: string;
  progress_percent?: number | null;
  progress_label?: string | null;
};

type AlgorithmMeta = {
  name?: string;
};

type JobProgressBannerProps = {
  tasks: JobTask[];
  algorithmMetaMap: Map<string, AlgorithmMeta>;
};

/**
 * Top-of-page progress strip shown while a job has Queued or Running tasks.
 * Hides itself entirely once every task has reached a terminal state
 * (Completed, Failed, or anything else non-Queued/non-Running).
 */
export default function JobProgressBanner({
  tasks,
  algorithmMetaMap,
}: JobProgressBannerProps) {
  if (tasks.length === 0) return null;

  const queued = tasks.filter((task) => task.status === "Queued");
  const running = tasks.filter((task) => task.status === "Running");
  const completed = tasks.filter((task) => task.status === "Completed");
  const failed = tasks.filter((task) => task.status === "Failed");

  const hasActiveWork = queued.length > 0 || running.length > 0;
  if (!hasActiveWork) return null;

  const total = tasks.length;
  const finished = completed.length + failed.length;

  // Overall percent blends finished tasks with the partial progress of any
  // currently-running tasks. Each finished task = 1 unit, each running task
  // contributes its progress_percent / 100.
  const runningProgress = running.reduce((sum, task) => {
    const pct = clampPercent(task.progress_percent);
    return sum + pct / 100;
  }, 0);
  const overall = total === 0 ? 0 : Math.round(((finished + runningProgress) / total) * 100);

  return (
    <section className="mt-8 rounded-[1.5rem] border border-[#1b75a6]/20 bg-[#f7fbff] p-6 text-slate-900 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-[#1b75a6]"
          />
          <h2 className="text-lg font-bold text-slate-950">Analysis running</h2>
        </div>
        <div className="text-sm font-semibold tabular-nums text-slate-700">
          {finished} / {total} complete
          <span className="ml-2 text-slate-400">·</span>
          <span className="ml-2 text-[#1b75a6]">{overall}%</span>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#1b75a6]/10">
        <div
          className="h-full rounded-full bg-[#1b75a6] transition-[width] duration-500 ease-out"
          style={{ width: `${overall}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <StatusChip color="teal" count={completed.length} label="completed" />
        <StatusChip color="blue" count={running.length} label="running" />
        <StatusChip color="amber" count={queued.length} label="queued" />
        {failed.length > 0 && (
          <StatusChip color="rose" count={failed.length} label="failed" />
        )}
      </div>

      {running.length > 0 && (
        <div className="mt-5 space-y-3">
          {running.map((task) => {
            const meta = algorithmMetaMap.get(task.algorithm_id);
            const pct = clampPercent(task.progress_percent);
            const label =
              typeof task.progress_label === "string" && task.progress_label.trim().length > 0
                ? task.progress_label
                : "Running";
            return (
              <div key={task.algorithm_id} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-semibold text-slate-900">
                    {meta?.name ?? task.algorithm_id}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">
                    {pct}% · {label}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#1b75a6]/10">
                  <div
                    className="h-full rounded-full bg-[#1b75a6]/70 transition-[width] duration-300 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {queued.length > 0 && (
        <p className="mt-4 text-xs leading-5 text-slate-500">
          <span className="font-semibold text-slate-700">Queued:</span>{" "}
          {queued
            .map((task) => algorithmMetaMap.get(task.algorithm_id)?.name ?? task.algorithm_id)
            .join(", ")}
        </p>
      )}
    </section>
  );
}

function clampPercent(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function StatusChip({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: "teal" | "blue" | "amber" | "rose";
}) {
  const tone = {
    teal: "border-[#20b779]/20 bg-[#e8f7f1] text-[#178a62]",
    blue: "border-[#1b75a6]/20 bg-[#f2f9fc] text-[#155f87]",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-600",
  }[color];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${tone}`}
    >
      <span className="tabular-nums">{count}</span>
      <span className="text-[11px] uppercase tracking-[0.12em] opacity-80">{label}</span>
    </span>
  );
}
