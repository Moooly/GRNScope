const projects = [
  {
    id: "project-1",
    name: "Gonadal Sex Determination",
    description: "Single-cell RNA-seq dataset for GRN inference.",
    createdAt: "2026-04-03 10:24",
    datasetCount: 2,
    jobCount: 3,
  },
  {
    id: "project-2",
    name: "Stem Cell Differentiation",
    description: "Trajectory-aware analysis with optional pseudotime input.",
    createdAt: "2026-04-01 14:10",
    datasetCount: 1,
    jobCount: 1,
  },
  {
    id: "project-3",
    name: "Immune Response Pilot",
    description: "Consensus comparison across multiple GRN algorithms.",
    createdAt: "2026-03-29 09:42",
    datasetCount: 3,
    jobCount: 4,
  },
];

export default function ProjectsPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto max-w-7xl px-6 py-10 lg:px-10">

        <div className="flex items-end justify-between gap-6">
          <div>
            <h2 className="text-2xl font-semibold text-white">
              Project History
            </h2>
          </div>

          <button
            type="button"
            className="rounded-2xl bg-teal-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
          >
            Create New Project
          </button>
        </div>

        <div className="mt-8 grid gap-6">
          {projects.map((project) => (
            <div
              key={project.id}
              className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 transition hover:border-teal-300/20 hover:bg-white/[0.05]"
            >
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-2xl font-semibold text-white">
                      {project.name}
                    </h3>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                      Created {project.createdAt}
                    </span>
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
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="rounded-2xl border border-white/15 px-4 py-2 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
                  >
                    View detail
                  </button>

                  <button
                    type="button"
                    className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-200 transition hover:border-rose-400/35 hover:bg-rose-400/15"
                  >
                    Delete project
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}