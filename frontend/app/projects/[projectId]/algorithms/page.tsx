interface PageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function AlgorithmSelectionPage({ params }: PageProps) {
  const { projectId } = await params;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white lg:px-10">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm font-medium uppercase tracking-[0.22em] text-teal-300">
          Algorithm selection
        </p>
        <h1 className="mt-3 text-4xl font-semibold text-white">
          Choose algorithms for project {projectId}
        </h1>
        <p className="mt-4 text-slate-400">
          This is the next step after successful file validation.
        </p>

        <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
          <p className="text-lg font-medium text-white">
            Algorithm UI goes here next.
          </p>
        </div>
      </div>
    </main>
  );
}