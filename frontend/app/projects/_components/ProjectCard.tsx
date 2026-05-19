import { Project } from "../_types/project";
import Link from "next/link";
import { formatProjectCreatedAt } from "../_lib/time";

interface ProjectCardProps {
  project: Project;
  onDelete: (project: Project) => void;
}

export default function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const latestJob = project.latestJob;
  const createdAtLabel = formatProjectCreatedAt(
    project.createdAtTimestamp,
    project.createdAt
  );

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

  const statusClass =
    projectStatus === "Completed"
      ? "bg-[#e8f7f1] text-[#178a62] ring-[#20b779]/20"
      : projectStatus === "Failed"
        ? "bg-rose-50 text-rose-600 ring-rose-200"
        : projectStatus === "Running"
          ? "bg-sky-50 text-sky-700 ring-sky-200"
          : projectStatus === "Queued"
            ? "bg-amber-50 text-amber-700 ring-amber-200"
            : projectStatus === "Partially Completed"
              ? "bg-violet-50 text-violet-700 ring-violet-200"
              : "bg-slate-50 text-slate-600 ring-slate-200";

  return (
    <article className="group rounded-2xl border border-slate-200 bg-white px-5 py-4 text-slate-900 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-[#1b75a6]/25 hover:shadow-lg hover:shadow-slate-200/70">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid min-w-0 gap-2">
          <h3 className="truncate text-xl font-bold tracking-tight text-slate-950">
            {project.name}
          </h3>

          <div className="flex flex-wrap items-center gap-2.5">
            {projectStatus && (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${statusClass}`}
              >
                {projectStatus}
              </span>
            )}
            <span className="text-xs font-semibold text-slate-500">
              Created {createdAtLabel}
            </span>
          </div>
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
            className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}
