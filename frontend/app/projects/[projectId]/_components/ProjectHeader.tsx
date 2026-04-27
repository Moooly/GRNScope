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
    <header className="border-b border-[#213f54]/35 pb-8">
      <p className="mb-4 text-sm font-bold uppercase tracking-[0.28em] text-[#1b75a6]">
        Project detail
      </p>
      <h1 className="text-5xl font-bold tracking-tight text-slate-950 sm:text-6xl lg:text-[4.15rem] lg:leading-[1.02]">
        {projectName}
      </h1>
      <p className="mt-5 max-w-3xl text-[1.05rem] leading-8 text-slate-700">
        {projectDescription}
      </p>
    </header>
  );
}