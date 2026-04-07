import { Project } from "../_types/project";
import Link from "next/link";

interface ProjectCardProps {
  project: Project;
  onDelete: (project: Project) => void;
}

export default function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const latestJob = project.latestJob;
  const tasks = latestJob?.tasks ?? [];
  const completedCount = tasks.filter((task) => task.status === "Completed").length;
  const runningCount = tasks.filter((task) => task.status === "Running").length;
  const queuedCount = tasks.filter((task) => task.status === "Queued").length;
  const failedCount = tasks.filter((task) => task.status === "Failed").length;

  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 transition hover:border-teal-300/20 hover:bg-white/[0.05]">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-2xl font-semibold text-white">{project.name}</h3>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
              Created {project.createdAt}
            </span>
            {latestJob?.job_id && (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                Job ID {latestJob.job_id}
              </span>
            )}
            {latestJob?.overall_status && (
              <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-200">
                {latestJob.overall_status}
              </span>
            )}
          </div>

          <p className="mt-4 text-sm leading-7 text-slate-400">
            {project.description}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-200">
              {project.datasetCount} datasets
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
              {project.jobCount} analysis jobs
            </span>
          </div>

          {latestJob && tasks.length > 0 && (
            <div className="mt-6 space-y-4 rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">Latest job progress</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Live status refreshes automatically.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-emerald-200">
                    Completed {completedCount}
                  </span>
                  <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-sky-200">
                    Running {runningCount}
                  </span>
                  <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-amber-200">
                    Queued {queuedCount}
                  </span>
                  <span className="rounded-full border border-rose-300/20 bg-rose-300/10 px-3 py-1 text-rose-200">
                    Failed {failedCount}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                {tasks.map((task) => (
                  <div
                    key={`${project.id}-${task.algorithm_id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{task.algorithm_id}</p>
                      {task.error_message && (
                        <p className="mt-1 text-xs text-rose-200">{task.error_message}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-300">
                        {task.status}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-300">
                        {task.elapsed_seconds}s
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/projects/${project.id}`}
            className="rounded-2xl border border-white/15 px-4 py-2 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
          >
            View detail
          </Link>

          <button
            type="button"
            onClick={() => onDelete(project)}
            className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-200 transition hover:border-rose-400/35 hover:bg-rose-400/15"
          >
            Delete project
          </button>
        </div>
      </div>
    </div>
  );
}