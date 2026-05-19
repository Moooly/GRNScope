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
}: JobProgressBannerProps) {
  if (tasks.length === 0) return null;

  const queued = tasks.filter((task) => task.status === "Queued");
  const running = tasks.filter((task) => task.status === "Running");
  const stopping = tasks.filter((task) => task.status === "Stopping");
  const completed = tasks.filter((task) => task.status === "Completed");
  const failed = tasks.filter((task) => task.status === "Failed");
  const stopped = tasks.filter((task) => task.status === "Stopped");

  const hasActiveWork = queued.length > 0 || running.length > 0 || stopping.length > 0;
  if (!hasActiveWork) return null;

  const total = tasks.length;
  const finished = completed.length + failed.length + stopped.length;

  // Overall percent blends finished tasks with the partial progress of any
  // currently-running tasks. Each finished task = 1 unit, each running task
  // contributes its progress_percent / 100.
  const runningProgress = running.reduce((sum, task) => {
    const pct = clampPercent(task.progress_percent);
    return sum + pct / 100;
  }, 0);
  const overall = total === 0 ? 0 : Math.round(((finished + runningProgress) / total) * 100);

  const statusSummary = [
    `${completed.length} completed`,
    `${running.length} running`,
    stopping.length > 0 ? `${stopping.length} stopping` : null,
    queued.length > 0 ? `${queued.length} queued` : null,
    stopped.length > 0 ? `${stopped.length} stopped` : null,
    failed.length > 0 ? `${failed.length} failed` : null,
  ].filter(Boolean);

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[#1b75a6]"
          />
          <h2 className="text-lg font-bold text-slate-950">Analysis running</h2>
        </div>
        <p className="mt-1 text-sm font-semibold text-slate-500">
          {statusSummary.join(" · ")}
        </p>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[#1b75a6] transition-[width] duration-500 ease-out"
          style={{ width: `${overall}%` }}
        />
      </div>
    </section>
  );
}

function clampPercent(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}
