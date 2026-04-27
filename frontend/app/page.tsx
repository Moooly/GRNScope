import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="relative overflow-hidden bg-[#f4f6f8]">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/90 to-transparent" />
        <div className="absolute -left-24 top-28 h-72 w-72 rounded-full bg-cyan-100/60 blur-3xl" />
        <div className="absolute -right-24 top-20 h-72 w-72 rounded-full bg-teal-100/60 blur-3xl" />

        <div className="relative mx-auto max-w-[1180px] px-6 pb-20 pt-20 lg:px-10 lg:pb-24 lg:pt-24">
          <div className="grid gap-12 lg:grid-cols-[1fr_0.72fr] lg:items-start">
            <div className="max-w-3xl">
              <p className="mb-4 text-sm font-bold uppercase tracking-[0.28em] text-[#1b75a6]">
                Gene regulatory network analysis
              </p>

              <h1 className="max-w-4xl text-5xl font-bold tracking-tight text-slate-950 sm:text-6xl lg:text-[4.15rem] lg:leading-[1.02]">
                GRNScope
              </h1>

              <div className="mt-6 max-w-3xl space-y-5 text-[1.05rem] leading-8 text-slate-700">
                <p>
                  GRNScope is a web platform for analyzing gene regulatory
                  networks from single-cell RNA-seq expression data. It helps
                  researchers move from an expression matrix to predicted
                  regulatory relationships between genes.
                </p>
                <p>
                  The platform runs multiple inference algorithms, compares their
                  ranked source-target edges, and builds consensus networks so
                  users can inspect which predictions are supported by several
                  methods.
                </p>
              </div>
            </div>

            <div className="rounded-[2rem] border border-white bg-white/90 p-6 shadow-xl shadow-slate-200/70 backdrop-blur">
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">
                  Analysis flow
                </p>
                <span className="rounded-full bg-[#e8f7f1] px-3 py-1 text-xs font-bold text-[#178a62] ring-1 ring-[#20b779]/15">
                  3 steps
                </span>
              </div>

              <div className="mt-6 space-y-4">
                {[
                  ["01", "Upload matrix", "Rows are genes, columns are cells."],
                  ["02", "Run algorithms", "Choose from GENIE3, GRNBoost2, PIDC, PPCOR, and more."],
                  ["03", "Explore results", "Network view, edge table, consensus filters."],
                ].map(([number, title, text]) => (
                  <div
                    key={number}
                    className="group flex gap-4 rounded-[1.25rem] border border-slate-100 bg-slate-50/90 p-4 transition hover:border-cyan-100 hover:bg-white hover:shadow-sm"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#213f54] text-sm font-bold text-white shadow-sm shadow-slate-300/60">
                      {number}
                    </div>
                    <div>
                      <p className="font-bold text-slate-950">{title}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-12 border-t border-[#213f54]/35 pt-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
                  Key features
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
                  What the platform supports
                </h2>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-[1.5rem] border border-slate-200 bg-white/85 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <p className="font-bold text-[#1b75a6]">Multiple algorithms</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Run common GRN inference methods and compare their ranked edge outputs.
                </p>
              </div>
              <div className="rounded-[1.5rem] border border-slate-200 bg-white/85 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <p className="font-bold text-[#1b75a6]">Consensus network</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Keep regulatory edges supported by several methods for higher-confidence exploration.
                </p>
              </div>
              <div className="rounded-[1.5rem] border border-slate-200 bg-white/85 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <p className="font-bold text-[#1b75a6]">Interactive results</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Use network visualization, edge tables, filtering controls, and export tools.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}