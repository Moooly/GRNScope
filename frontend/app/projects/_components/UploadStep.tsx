interface UploadStepProps {
  projectName: string;
  projectDescription: string;
  expressionFileName: string;
  pseudotimeFileName: string;
  setProjectName: (value: string) => void;
  setProjectDescription: (value: string) => void;
  setExpressionFile: (file: File | null) => void;
  setExpressionFileName: (value: string) => void;
  setPseudotimeFile: (file: File | null) => void;
  setPseudotimeFileName: (value: string) => void;
  clearExpressionFile: () => void;
  clearPseudotimeFile: () => void;
}

export default function UploadStep({
  projectName,
  projectDescription,
  expressionFileName,
  pseudotimeFileName,
  setProjectName,
  setProjectDescription,
  setExpressionFile,
  setExpressionFileName,
  setPseudotimeFile,
  setPseudotimeFileName,
  clearExpressionFile,
  clearPseudotimeFile,
}: UploadStepProps) {
  return (
    <>
      <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.02] px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white">Sample files</h3>
              <span className="text-sm text-slate-400">
                Download example files to test the workflow quickly.
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:shrink-0">
            <a
              href="/samples/sample_expression_matrix.csv"
              download
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/[0.05]"
            >
              Expression CSV
            </a>
            <a
              href="/samples/sample_pseudotime.csv"
              download
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/[0.05]"
            >
              Pseudotime CSV
            </a>
          </div>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold text-white">Project name</h3>
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
              <h3 className="text-xl font-semibold text-white">Description</h3>
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
                Upload a CSV file where rows are genes, columns are cells, the first row contains cell identifiers, the first column contains gene names, the interior values are numeric expression counts, and the maximum file size is 500 MB.
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
                {expressionFileName || "Choose expression matrix CSV"}
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
                  Single-column CSV with one floating-point value per cell in the same order as the expression matrix columns.
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
  );
}