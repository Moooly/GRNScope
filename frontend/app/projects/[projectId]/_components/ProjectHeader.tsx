import Link from "next/link";

type ProjectHeaderProps = {
  projectName: string;
  projectDescription: string;
  overallStatus?: string | null;
};

export default function ProjectHeader({
  projectName,
  projectDescription,
  overallStatus,
}: ProjectHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Link
          href="/projects"
          className="inline-flex rounded-2xl border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/5"
        >
          Back to projects
        </Link>
        <h1 className="mt-5 text-3xl font-semibold text-white">{projectName}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
          {projectDescription}
        </p>
      </div>

      {overallStatus && (
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200">
          {overallStatus}
        </span>
      )}
    </div>
  );
}