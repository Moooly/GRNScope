"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();

  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [isCreateClosing, setIsCreateClosing] = useState(false);
  const [createStep, setCreateStep] = useState<"upload" | "algorithms">(
    "upload"
  );

  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");

  const [expressionFile, setExpressionFile] = useState<File | null>(null);
  const [pseudotimeFile, setPseudotimeFile] = useState<File | null>(null);

  const [expressionFileName, setExpressionFileName] = useState("");
  const [pseudotimeFileName, setPseudotimeFileName] = useState("");

  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openCreateModal = () => {
    setErrors([]);
    setCreateStep("upload");
    setIsCreateClosing(false);
    setIsCreateVisible(true);
  };

  const closeCreateModal = () => {
    setIsCreateClosing(true);
    window.setTimeout(() => {
      setIsCreateVisible(false);
      setIsCreateClosing(false);
      setCreateStep("upload");
      setErrors([]);
    }, 280);
  };

  const clearExpressionFile = () => {
    setExpressionFile(null);
    setExpressionFileName("");
  };

  const clearPseudotimeFile = () => {
    setPseudotimeFile(null);
    setPseudotimeFileName("");
  };

  const handleUploadStepNext = () => {
    const newErrors: string[] = [];

    if (!projectName.trim()) {
      newErrors.push("Project name is required.");
    }

    if (!expressionFile) {
      newErrors.push("Expression matrix CSV is required.");
    }

    if (newErrors.length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors([]);
    setCreateStep("algorithms");
  };

  const handleCreateProject = async () => {
    try {
      setIsSubmitting(true);
      setErrors([]);

      if (!expressionFile) {
        setErrors(["Expression matrix CSV is required."]);
        return;
      }

      const formData = new FormData();
      formData.append("project_name", projectName);
      formData.append("project_description", projectDescription);
      formData.append("expression_matrix", expressionFile);

      if (pseudotimeFile) {
        formData.append("pseudotime", pseudotimeFile);
      }

      const response = await fetch(
        "http://127.0.0.1:8000/api/projects/create-with-dataset",
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!data.ok) {
        setErrors(data.errors || ["Project creation failed."]);
        setCreateStep("upload");
        return;
      }

      closeCreateModal();
      router.push(`/projects/${data.project_id}/algorithms`);
    } catch {
      setErrors(["Could not connect to the server."]);
      setCreateStep("upload");
    } finally {
      setIsSubmitting(false);
    }
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
            className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-6 py-10 backdrop-blur-sm ${
              isCreateClosing
                ? "animate-modal-overlay-out"
                : "animate-modal-overlay"
            }`}
            onClick={closeCreateModal}
          >
            <div
              className={`max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] border border-white/10 bg-slate-900 p-6 shadow-2xl shadow-cyan-950/20 lg:p-8 ${
                isCreateClosing
                  ? "animate-modal-panel-out"
                  : "animate-modal-panel"
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-6 border-b border-white/10 pb-5">
                <div>
                  <h2 className="mt-3 text-3xl font-semibold text-white">
                    Create New Project
                  </h2>
                </div>
              </div>

              <form
                className="mt-8 space-y-8"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (createStep === "upload") {
                    handleUploadStepNext();
                  } else {
                    handleCreateProject();
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      createStep === "upload"
                        ? "bg-teal-300/10 text-teal-200"
                        : "bg-white/[0.04] text-slate-400"
                    }`}
                  >
                    1. Upload
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      createStep === "algorithms"
                        ? "bg-teal-300/10 text-teal-200"
                        : "bg-white/[0.04] text-slate-400"
                    }`}
                  >
                    2. Algorithms
                  </span>
                </div>

                {createStep === "upload" && (
                  <>
                    <div className="grid gap-6 lg:grid-cols-2">
                      <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-xl font-semibold text-white">
                              Project name
                            </h3>
                          </div>
                          <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-200">
                            Required
                          </span>
                        </div>

                        <div className="mt-6">
                          <input
                            id="projectName"
                            type="text"
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                            placeholder="Enter project name"
                            className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300/40"
                          />
                        </div>
                      </div>

                      <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-xl font-semibold text-white">
                              Description
                            </h3>
                          </div>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                            Optional
                          </span>
                        </div>

                        <div className="mt-6">
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
                    </div>

                    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                      <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-xl font-semibold text-white">
                              Expression matrix upload
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-slate-400">
                              Upload a CSV file where rows are genes, columns are
                              cells, the first row contains cell identifiers, the
                              first column contains gene names, the interior
                              values are numeric expression counts, and the
                              maximum file size is 500 MB.
                            </p>
                          </div>
                          <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-200">
                            Required
                          </span>
                        </div>

                        <div className="mt-6">
                          <label className="relative flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-white/15 bg-slate-950/60 px-6 py-10 text-center transition hover:border-teal-300/30 hover:bg-slate-950/80">
                            <input
                              type="file"
                              accept=".csv"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0] ?? null;
                                setExpressionFile(file);
                                setExpressionFileName(file?.name ?? "");
                              }}
                            />
                            {expressionFileName && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  clearExpressionFile();
                                }}
                                className="absolute right-4 top-4 rounded-xl border border-white/15 px-3 py-2 text-xs font-medium text-white transition hover:border-white/30 hover:bg-white/5"
                              >
                                Remove
                              </button>
                            )}
                            <span className="text-base font-medium text-white">
                              {expressionFileName ||
                                "Choose expression matrix CSV"}
                            </span>
                          </label>
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
                                Single-column CSV with one floating-point value
                                per cell in the same order as the expression
                                matrix columns.
                              </p>
                            </div>
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                              Optional
                            </span>
                          </div>

                          <div className="mt-6">
                            <label className="relative flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-white/15 bg-slate-950/60 px-5 py-8 text-center transition hover:border-teal-300/30 hover:bg-slate-950/80">
                              <input
                                type="file"
                                accept=".csv"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0] ?? null;
                                  setPseudotimeFile(file);
                                  setPseudotimeFileName(file?.name ?? "");
                                }}
                              />
                              {pseudotimeFileName && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    clearPseudotimeFile();
                                  }}
                                  className="absolute right-4 top-4 rounded-xl border border-white/15 px-3 py-2 text-xs font-medium text-white transition hover:border-white/30 hover:bg-white/5"
                                >
                                  Remove
                                </button>
                              )}
                              <span className="text-sm font-medium text-white">
                                {pseudotimeFileName || "Choose pseudotime CSV"}
                              </span>
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {createStep === "algorithms" && (
                  <div className="space-y-6">
                    <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
                      <h3 className="text-xl font-semibold text-white">
                        Algorithm selection
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-400">
                        Your uploaded files are still kept only in the browser at
                        this step. They will be sent to the backend only after
                        you confirm project creation.
                      </p>

                      <div className="mt-6 grid gap-4 md:grid-cols-2">
                        {["GENIE3", "GRNBoost2", "PIDC", "SINGE"].map(
                          (algorithm) => (
                            <label
                              key={algorithm}
                              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 text-sm text-slate-200"
                            >
                              <input type="checkbox" className="h-4 w-4" />
                              <span>{algorithm}</span>
                            </label>
                          )
                        )}
                      </div>
                    </div>

                    <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 text-sm leading-6 text-slate-400">
                      <p className="font-medium text-white">Project summary</p>
                      <p className="mt-3">
                        <span className="text-slate-300">Project name:</span>{" "}
                        {projectName || "-"}
                      </p>
                      <p className="mt-1">
                        <span className="text-slate-300">
                          Expression matrix:
                        </span>{" "}
                        {expressionFileName || "-"}
                      </p>
                      <p className="mt-1">
                        <span className="text-slate-300">Pseudotime:</span>{" "}
                        {pseudotimeFileName || "Not provided"}
                      </p>
                    </div>
                  </div>
                )}

                {errors.length > 0 && (
                  <div className="rounded-[2rem] border border-rose-300/20 bg-rose-300/10 p-5">
                    <p className="text-sm font-medium text-rose-200">
                      Please fix the following issues:
                    </p>
                    <ul className="mt-3 space-y-2 text-sm text-slate-200">
                      {errors.map((error, index) => (
                        <li key={index}>• {error}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 pt-6">
                  <button
                    type="button"
                    onClick={
                      createStep === "upload"
                        ? closeCreateModal
                        : () => setCreateStep("upload")
                    }
                    className="cursor-pointer rounded-2xl border border-white/15 px-5 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
                  >
                    {createStep === "upload" ? "Cancel" : "Back"}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="cursor-pointer rounded-2xl bg-teal-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting
                      ? "Creating..."
                      : createStep === "upload"
                        ? "Next"
                        : "Create project"}
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