import Link from "next/link";

export default function HomePage() {
  const features = [
    {
      title: "Docker-based reproducibility",
      description:
        "Every algorithm runs inside a versioned, isolated container so analyses remain reproducible and easier to manage.",
    },
    {
      title: "Ensemble and individual method views",
      description:
        "Users can compare algorithm outputs side by side and compute consensus networks from shared predictions.",
    },
    {
      title: "Pseudotime integration",
      description:
        "The platform supports optional trajectory-aware analysis through pseudotime input and planned Slingshot-based workflows.",
    },
    {
      title: "Interactive network visualization",
      description:
        "Explore inferred networks through an interactive graph view with node inspection, edge ranking, and sub-network analysis.",
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

  const recentMethods = [
    {
      name: "GRNBoost2",
      publicationDate: "2019",
      category: "Machine Learning",
    },
    {
      name: "PIDC",
      publicationDate: "2017",
      category: "Information Theory",
    },
    {
      name: "SINGE",
      publicationDate: "2019",
      category: "Granger Causality",
    },
    {
      name: "SCRIBE",
      publicationDate: "2018",
      category: "Information Theory",
    },
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
                <p className="text-lg font-semibold tracking-tight">GRN Scope</p>
                <p className="text-sm text-slate-400">
                  Gene regulatory network analysis platform
                </p>
              </div>
            </div>

            <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
              <Link
                href="/login"
                className="rounded-xl border border-white/15 px-4 py-2 transition hover:border-white/30 hover:bg-white/5"
              >
                Log in
              </Link>
            </nav>
          </header>

          <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="max-w-3xl">
              <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                Infer, compare, and explore gene regulatory networks in one
                place.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                GRN Scope enables researchers to infer gene regulatory networks from single-cell RNA-seq data using multiple algorithms and to explore consensus results through an interactive interface
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link
                  href="/register"
                  className="rounded-2xl bg-teal-400 px-6 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
                >
                  Get started
                </Link>
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

      <section className="border-t border-white/10 bg-slate-950/90">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="flex items-end justify-between gap-6">
            <div className="max-w-3xl">
              <p className="text-sm font-medium uppercase tracking-[0.22em] text-teal-300">
                Recently added methods
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                New algorithms added to the platform
              </h2>
            </div>

            <Link
              href="/algorithms"
              className="inline-flex shrink-0 rounded-2xl border border-white/15 px-5 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
            >
              Browse all algorithms
            </Link>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-4">
            {recentMethods.map((method) => (
              <div
                key={method.name}
                className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 transition hover:border-teal-300/20 hover:bg-white/[0.05]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-teal-300">
                      Recently added
                    </p>
                    <h3 className="mt-3 text-xl font-semibold text-white">
                      {method.name}
                    </h3>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                    {method.publicationDate}
                  </span>
                </div>

                <div className="mt-6">
                  <span className="inline-flex rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-200">
                    {method.category}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}