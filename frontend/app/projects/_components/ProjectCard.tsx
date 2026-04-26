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
    <article className="rounded-[1.5rem] border border-slate-200 bg-white/95 p-6 text-slate-900 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-[#1b75a6]/25 hover:bg-white hover:shadow-xl hover:shadow-slate-200/70">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="truncate text-2xl font-bold tracking-tight text-slate-950">
              {project.name}
            </h3>
            {projectStatus && (
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  projectStatus === "Completed"
                    ? "border border-[#20b779]/20 bg-[#e8f7f1] text-[#178a62]"
                    : projectStatus === "Failed"
                      ? "border border-rose-200 bg-rose-50 text-rose-600"
                      : projectStatus === "Running"
                        ? "border border-sky-200 bg-sky-50 text-sky-700"
                        : projectStatus === "Queued"
                          ? "border border-amber-200 bg-amber-50 text-amber-700"
                          : projectStatus === "Partially Completed"
                            ? "border border-violet-200 bg-violet-50 text-violet-700"
                            : "border border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                {projectStatus}
              </span>
            )}
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
              Created {project.createdAt}
            </span>
          </div>

          <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">
            {project.description || "No description"}
          </p>

        </div>

        <div className="flex shrink-0 flex-wrap gap-3 lg:justify-end">
          <Link
            href={`/projects/${project.id}`}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
          >
            View detail
          </Link>

          <button
            type="button"
            onClick={() => onDelete(project)}
            className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-600 transition hover:border-rose-300 hover:bg-rose-100"
          >
            Delete project
          </button>
        </div>
      </div>
    </article>
  );
}