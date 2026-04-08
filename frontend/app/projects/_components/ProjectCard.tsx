import { Project } from "../_types/project";
import Link from "next/link";

interface ProjectCardProps {
  project: Project;
  onDelete: (project: Project) => void;
}

export default function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const latestJob = project.latestJob;

  const tasks = latestJob?.tasks ?? [];

  const projectStatus = (() => {
    if (!latestJob) return null;

    if (tasks.some((task) => task.status === "Running")) {
      return "Running";
    }

    if (tasks.some((task) => task.status === "Queued")) {
      return "Queued";
    }

    const hasCompleted = tasks.some((task) => task.status === "Completed");
    const hasFailed = tasks.some((task) => task.status === "Failed");

    if (hasCompleted && hasFailed) {
      return "Partially Completed";
    }

    if (hasCompleted) {
      return "Completed";
    }

    if (hasFailed) {
      return "Failed";
    }

    return latestJob.overall_status || null;
  })();

  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 transition hover:border-teal-300/20 hover:bg-white/[0.05]">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-2xl font-semibold text-white">{project.name}</h3>
            {projectStatus && (
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  projectStatus === "Completed"
                    ? "border border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
                    : projectStatus === "Failed"
                      ? "border border-rose-300/20 bg-rose-300/10 text-rose-200"
                      : projectStatus === "Running"
                        ? "border border-sky-300/20 bg-sky-300/10 text-sky-200"
                        : projectStatus === "Queued"
                          ? "border border-amber-300/20 bg-amber-300/10 text-amber-200"
                          : projectStatus === "Partially Completed"
                            ? "border border-violet-300/20 bg-violet-300/10 text-violet-200"
                            : "border border-white/10 bg-white/[0.04] text-slate-300"
                }`}
              >
                {projectStatus}
              </span>
            )}
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
              Created {project.createdAt}
            </span>
          </div>

          <p className="mt-4 text-sm leading-7 text-slate-400">
            {project.description}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-200">
              {project.datasetCount} {project.datasetCount === 1 ? "dataset" : "datasets"}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
              {project.jobCount} analysis {project.jobCount === 1 ? "job" : "jobs"}
            </span>
          </div>
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