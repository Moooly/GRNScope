"use client";

import { useState } from "react";
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
  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [isCreateClosing, setIsCreateClosing] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [expressionFileName, setExpressionFileName] = useState("");
  const [pseudotimeFileName, setPseudotimeFileName] = useState("");

  const openCreateModal = () => {
    setIsCreateClosing(false);
    setIsCreateVisible(true);
  };

  const closeCreateModal = () => {
    setIsCreateClosing(true);
    window.setTimeout(() => {
      setIsCreateVisible(false);
      setIsCreateClosing(false);
    }, 280);
  };

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
            onClick={openCreateModal}
            className="cursor-pointer rounded-2xl bg-teal-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
          >
            Create New Project
          </button>
        </div>

        {isCreateVisible && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-6 py-10 backdrop-blur-sm ${isCreateClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"}`}
          onClick={closeCreateModal}
        >
            <div
              className={`max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] border border-white/10 bg-slate-900 p-6 shadow-2xl shadow-cyan-950/20 lg:p-8 ${isCreateClosing ? "animate-modal-panel-out" : "animate-modal-panel"}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-6 border-b border-white/10 pb-5">
                <div>
                  <h2 className="mt-3 text-3xl font-semibold text-white">
                    Create New Project
                  </h2>
                </div>
              </div>

              <form className="mt-8 space-y-8">
                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <label
                      htmlFor="projectName"
                      className="mb-2 block text-sm font-medium text-slate-200"
                    >
                      Project name
                    </label>
                    <input
                      id="projectName"
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="Enter project name"
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300/40"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="projectDescription"
                      className="mb-2 block text-sm font-medium text-slate-200"
                    >
                      Description (optional)
                    </label>
                    <input
                      id="projectDescription"
                      type="text"
                      value={projectDescription}
                      onChange={(e) => setProjectDescription(e.target.value)}
                      placeholder="Add a short description"
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300/40"
                    />
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-semibold text-white">
                          Expression matrix upload
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-400">
                          Required input. Upload a CSV matrix where rows are genes, columns are cells, the first row contains cell identifiers, the first column contains gene names, and the interior values are numeric expression counts.
                        </p>
                      </div>
                      <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-200">
                        Required
                      </span>
                    </div>

                    <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-white/15 bg-slate-950/60 px-6 py-10 text-center transition hover:border-teal-300/30 hover:bg-slate-950/80">
                      <input
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={(e) =>
                          setExpressionFileName(e.target.files?.[0]?.name ?? "")
                        }
                      />
                      <span className="text-base font-medium text-white">
                        {expressionFileName || "Choose expression matrix CSV"}
                      </span>
                      <span className="mt-2 text-sm text-slate-400">
                        Drag and drop or browse from your computer
                      </span>
                      <span className="mt-4 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                        Maximum file size: 500 MB
                      </span>
                    </label>

                    <div className="mt-5 grid gap-3 text-sm text-slate-400">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                        <p className="font-medium text-white">Validation requirements</p>
                        <ul className="mt-3 space-y-2 leading-6">
                          <li>• File must be a valid CSV.</li>
                          <li>• Header row and first column must be parseable as identifiers.</li>
                          <li>• Interior values must be numeric.</li>
                          <li>• The system should extract gene count, cell count, and gene names.</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-xl font-semibold text-white">
                            Pseudotime upload
                          </h3>
                          <p className="mt-2 text-sm leading-6 text-slate-400">
                            Optional input for methods that require a one-dimensional trajectory over cells.
                          </p>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                          Optional
                        </span>
                      </div>

                      <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-white/15 bg-slate-950/60 px-5 py-8 text-center transition hover:border-teal-300/30 hover:bg-slate-950/80">
                        <input
                          type="file"
                          accept=".csv"
                          className="hidden"
                          onChange={(e) =>
                            setPseudotimeFileName(e.target.files?.[0]?.name ?? "")
                          }
                        />
                        <span className="text-sm font-medium text-white">
                          {pseudotimeFileName || "Choose pseudotime CSV"}
                        </span>
                        <span className="mt-2 text-xs leading-5 text-slate-400">
                          Single-column CSV with one floating-point value per cell in the same order as the expression matrix columns.
                        </span>
                      </label>
                    </div>

                    <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
                      <h3 className="text-lg font-semibold text-white">
                        Sample dataset
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-400">
                        The platform also provides a downloadable sample dataset so new users can explore the workflow without preparing their own data first.
                      </p>
                      <button
                        type="button"
                        className="mt-5 rounded-2xl border border-white/15 px-4 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
                      >
                        Download sample dataset
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-[2rem] border border-amber-300/20 bg-amber-300/10 p-5">
                  <p className="text-sm font-medium text-amber-200">
                    Upload behavior summary
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    After upload, the system should validate the CSV structure, file size, identifiers, numeric interior values, and the matching length of the optional pseudotime file before moving to preprocessing and algorithm selection.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 pt-6">
                  <button
                    type="button"
                    onClick={closeCreateModal}
                    className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-2xl bg-teal-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
                  >
                    Save project and continue
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

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