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
  void overallStatus;

  return (
    <header className="border-b border-[#213f54]/35 pb-6">
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-[#1b75a6]">
        Project detail
      </p>
      <h1 className="text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]">
        {projectName}
      </h1>
      <p className="mt-4 max-w-3xl text-base leading-7 text-slate-700">
        {projectDescription}
      </p>
    </header>
  );
}