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
    <div className="space-y-6">
      <div className="rounded-[1.5rem] border border-[#1b75a6]/15 bg-[#f2f9fc] px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#1b75a6]">Sample files</h3>
            <p className="mt-1 text-sm text-slate-600">
              Download example CSV files to test the workflow quickly.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 lg:shrink-0">
            <a
              href="/samples/sample_expression_matrix.csv"
              download
              className="inline-flex items-center justify-center rounded-full border border-[#1b75a6]/20 bg-white px-4 py-2 text-sm font-bold text-[#1b75a6] transition hover:border-[#1b75a6]/35 hover:bg-[#e8f5fb]"
            >
              Expression CSV
            </a>
            <a
              href="/samples/sample_pseudotime.csv"
              download
              className="inline-flex items-center justify-center rounded-full border border-[#1b75a6]/20 bg-white px-4 py-2 text-sm font-bold text-[#1b75a6] transition hover:border-[#1b75a6]/35 hover:bg-[#e8f5fb]"
            >
              Pseudotime CSV
            </a>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <h3 className="text-lg font-bold text-slate-950">Project name</h3>
            <span className="rounded-full border border-[#20b779]/20 bg-[#e8f7f1] px-3 py-1 text-xs font-bold text-[#178a62]">
              Required
            </span>
          </div>

          <div className="mt-5">
            <input
              id="projectName"
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Enter project name"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
            />
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <h3 className="text-lg font-bold text-slate-950">Description</h3>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
              Optional
            </span>
          </div>

          <div className="mt-5">
            <input
              id="projectDescription"
              type="text"
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
              placeholder="Add a short description"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-950">
                Expression matrix upload
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Upload a CSV file where rows are genes and columns are cells.
                The first row should contain cell identifiers, and the first
                column should contain gene names.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-[#20b779]/20 bg-[#e8f7f1] px-3 py-1 text-xs font-bold text-[#178a62]">
              Required
            </span>
          </div>

          <div className="mt-5">
            <label className="relative flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-[#1b75a6]/30 bg-[#f7fbff] px-6 py-10 text-center transition hover:border-[#1b75a6]/50 hover:bg-[#f2f9fc]">
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setExpressionFile(file);
                  setExpressionFileName(file?.name ?? "");
                }}
              />
              {expressionFileName && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    clearExpressionFile();
                  }}
                  className="absolute right-4 top-4 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                >
                  Remove
                </button>
              )}
              <span className="text-base font-bold text-slate-950">
                {expressionFileName || "Choose expression matrix CSV"}
              </span>
              <span className="mt-2 text-sm text-slate-500">
                Maximum file size: 500 MB
              </span>
            </label>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-950">
                Pseudotime upload
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Optional single-column CSV with one floating-point value per cell
                in the same order as the expression matrix columns.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
              Optional
            </span>
          </div>

          <div className="mt-5">
            <label className="relative flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/80 px-5 py-10 text-center transition hover:border-[#1b75a6]/35 hover:bg-[#f7fbff]">
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setPseudotimeFile(file);
                  setPseudotimeFileName(file?.name ?? "");
                }}
              />
              {pseudotimeFileName && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    clearPseudotimeFile();
                  }}
                  className="absolute right-4 top-4 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                >
                  Remove
                </button>
              )}
              <span className="text-sm font-bold text-slate-950">
                {pseudotimeFileName || "Choose pseudotime CSV"}
              </span>
              <span className="mt-2 text-sm text-slate-500">
                Required only by pseudotime-based algorithms
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}