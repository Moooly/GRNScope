export default function HomePage() {
  const features = [
    {
      title: "Multi-algorithm GRN inference",
      description:
        "Run multiple published gene regulatory network algorithms on single-cell RNA-seq datasets in one workflow.",
    },
    {
      title: "Consensus network analysis",
      description:
        "Compare algorithm outputs and build higher-confidence consensus edges from shared predictions.",
    },
    {
      title: "Interactive network exploration",
      description:
        "Inspect nodes, edges, rankings, and filtered sub-networks through an intuitive visual workspace.",
    },
    {
      title: "Reproducible execution",
      description:
        "Track preprocessing choices, selected methods, and generated outputs for each analysis job.",
    },
  ];

  const steps = [
    {
      number: "01",
      title: "Upload Dataset",
      description:
        "Upload a gene expression matrix and optional pseudotime file for downstream analysis.",
    },
    {
      number: "02",
      title: "Select Algorithms",
      description:
        "Choose one or more supported GRN inference methods and configure preprocessing options.",
    },
    {
      number: "03",
      title: "Explore Results",
      description:
        "Review ranked edges, compare methods, and explore the inferred network visually.",
    },
  ];

  const stats = [
    { label: "Supported algorithms", value: "12+" },
    { label: "Analysis modes", value: "Individual + Consensus" },
    { label: "Execution style", value: "Asynchronous" },
  ];

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(20,184,166,0.18),transparent_28%)]" />
        <div className="relative mx-auto flex max-w-7xl flex-col gap-16 px-6 py-8 lg:px-10">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-400/20 text-lg font-semibold text-teal-300 ring-1 ring-teal-300/30">
                G
              </div>
              <div>
                <p className="text-lg font-semibold tracking-tight">GRNScope</p>
                <p className="text-sm text-slate-400">
                  Gene regulatory network analysis platform
                </p>
              </div>
            </div>

            <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
              <a href="#workflow" className="transition hover:text-white">
                Workflow
              </a>
              <a href="#features" className="transition hover:text-white">
                Features
              </a>
              <a href="#stats" className="transition hover:text-white">
                Platform
              </a>
              <a
                href="/login"
                className="rounded-xl border border-white/15 px-4 py-2 transition hover:border-white/30 hover:bg-white/5"
              >
                Log in
              </a>
            </nav>
          </header>

          <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="max-w-3xl">
              <div className="mb-6 inline-flex items-center rounded-full border border-teal-300/20 bg-teal-300/10 px-4 py-2 text-sm text-teal-200">
                Multi-algorithm GRN inference for single-cell RNA-seq
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                Infer, compare, and explore gene regulatory networks in one
                place.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                GRNScope helps researchers upload datasets, run published GRN
                inference algorithms, compare their outputs, and inspect
                consensus networks through an interactive web interface.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href="/register"
                  className="rounded-2xl bg-teal-400 px-6 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
                >
                  Get started
                </a>
                <a
                  href="#workflow"
                  className="rounded-2xl border border-white/15 px-6 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
                >
                  View workflow
                </a>
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-2xl shadow-cyan-950/30 backdrop-blur">
              <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/90 p-5">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="text-sm text-slate-400">Example workspace</p>
                    <h2 className="mt-1 text-xl font-semibold">
                      Consensus Network
                    </h2>
                  </div>
                  <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs text-emerald-300">
                    3 methods selected
                  </span>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-slate-800/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      Dataset
                    </p>
                    <p className="mt-2 text-sm font-medium text-white">
                      Gonadal sex determination
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      2,000 filtered genes · 12,400 cells
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-800/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      Job status
                    </p>
                    <p className="mt-2 text-sm font-medium text-white">
                      Partially completed
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      PIDC, GENIE3, GRNBoost2 finished
                    </p>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-slate-800/70 p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-sm font-medium text-white">
                      Top consensus edges
                    </p>
                    <span className="text-xs text-slate-400">
                      Threshold ≥ 2
                    </span>
                  </div>
                  <div className="space-y-3">
                    {[
                      ["SOX9", "AMH", "0.94"],
                      ["WT1", "SOX9", "0.91"],
                      ["NR5A1", "AMH", "0.87"],
                    ].map(([source, target, score]) => (
                      <div
                        key={`${source}-${target}`}
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl bg-slate-900/80 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">
                            {source}{" "}
                            <span className="text-slate-500">→</span> {target}
                          </p>
                        </div>
                        <span className="rounded-full bg-teal-400/10 px-3 py-1 text-xs text-teal-200">
                          score {score}
                        </span>
                        <span className="h-2 w-16 rounded-full bg-slate-700">
                          <span
                            className="block h-2 rounded-full bg-teal-400"
                            style={{ width: `${Number(score) * 100}%` }}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="stats"
        className="border-b border-white/10 bg-slate-900/80"
      >
        <div className="mx-auto grid max-w-7xl gap-6 px-6 py-8 sm:grid-cols-3 lg:px-10">
          {stats.map((item) => (
            <div
              key={item.label}
              className="rounded-3xl border border-white/10 bg-white/[0.03] p-6"
            >
              <p className="text-3xl font-semibold text-white">{item.value}</p>
              <p className="mt-2 text-sm text-slate-400">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        id="workflow"
        className="mx-auto max-w-7xl px-6 py-20 lg:px-10"
      >
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-teal-300">
            Workflow
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            A simple three-step path from expression matrix to network insight.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            The platform is designed to keep the analysis flow clear: upload
            data, select methods, and inspect results without losing track of
            preprocessing and algorithm choices.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.number}
              className="rounded-[2rem] border border-white/10 bg-slate-900 p-8"
            >
              <p className="text-sm font-medium text-teal-300">
                {step.number}
              </p>
              <h3 className="mt-5 text-2xl font-semibold text-white">
                {step.title}
              </h3>
              <p className="mt-4 leading-7 text-slate-300">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="border-t border-white/10 bg-slate-900/70">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-teal-300">
              Features
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Built for comparison, reproducibility, and exploration.
            </h2>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-8"
              >
                <h3 className="text-xl font-semibold text-white">
                  {feature.title}
                </h3>
                <p className="mt-4 leading-7 text-slate-300">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <div className="rounded-[2rem] border border-teal-300/15 bg-gradient-to-br from-teal-400/10 via-slate-900 to-cyan-400/10 p-8 sm:p-10 lg:p-12">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Start building your first GRN analysis workspace.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              Create an account, upload a dataset, and begin comparing
              algorithm outputs in one organized platform.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-4">
            <a
              href="/register"
              className="rounded-2xl bg-teal-400 px-6 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
            >
              Create account
            </a>
            <a
              href="/algorithms"
              className="rounded-2xl border border-white/15 px-6 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
            >
              Browse algorithms
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}