import { formatFileNameForDisplay } from "../../_components/FileNameDisplay";

type ProjectHeaderProps = {
  projectName: string;
  projectId?: string | null;
  projectDescription?: string;
  overallStatus?: string | null;
};

export default function ProjectHeader({
  projectName,
  projectId,
  projectDescription,
  overallStatus,
}: ProjectHeaderProps) {
  void overallStatus;
  const displayProjectName = formatFileNameForDisplay(projectName, 44);

  return (
    <header className="border-b border-[#213f54]/35 pb-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#1b75a6]">
          Project detail
        </p>
        {projectId ? (
          <span
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-bold text-slate-600"
            title={`Project ID: ${projectId}`}
          >
            <span className="uppercase tracking-[0.16em] text-slate-400">
              Project ID
            </span>
            <span className="min-w-0 select-all overflow-hidden text-ellipsis whitespace-nowrap font-mono text-slate-800">
              {projectId}
            </span>
          </span>
        ) : null}
      </div>
      <h1
        className="min-w-0 max-w-full text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]"
        title={projectName}
      >
        <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
          {displayProjectName}
        </span>
      </h1>
      {projectDescription ? (
        <p className="mt-4 max-w-3xl text-base leading-7 text-slate-700">
          {projectDescription}
        </p>
      ) : null}
    </header>
  );
}
