

"use client";

type DatasetPreprocessingSectionProps = {
  expressionMatrixLabel: string;
  topVariableGenesLabel: string | number;
  tfOverrideLabel: string;
  normalizationLabel: string;
  logTransformLabel: string;
  onOpenHelp: () => void;
  onOpenDownloadMenu: () => void;
};

export default function DatasetPreprocessingSection({
  expressionMatrixLabel,
  topVariableGenesLabel,
  tfOverrideLabel,
  normalizationLabel,
  logTransformLabel,
  onOpenHelp,
  onOpenDownloadMenu,
}: DatasetPreprocessingSectionProps) {
  return (
    <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white/95 p-6 text-slate-900 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-950">Dataset and preprocessing</h2>
            <button
              type="button"
              onClick={onOpenHelp}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] text-xs font-bold text-[#1b75a6] transition hover:border-[#1b75a6]/35 hover:bg-[#e8f5fb]"
              aria-label="Open dataset and preprocessing guide"
              title="Open dataset and preprocessing guide"
            >
              ?
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenDownloadMenu}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
        >
          Download files
        </button>
      </div>

      <div className="mt-6">
        <div className="grid gap-3 xl:grid-cols-5">
          <div className="rounded-[1.25rem] border border-slate-200 bg-white px-5 py-4">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-slate-400">
              Matrix size
            </p>
            <p className="mt-2 text-sm font-bold text-slate-800">
              {expressionMatrixLabel}
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-white px-5 py-4">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-slate-400">
              Gene filtering
            </p>
            <p className="mt-2 text-sm font-bold text-slate-800">
              {topVariableGenesLabel}
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-white px-5 py-4">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-slate-400">
              TF override
            </p>
            <p className="mt-2 text-sm font-bold text-slate-800">
              {tfOverrideLabel}
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-white px-5 py-4">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-slate-400">
              Normalization
            </p>
            <p className="mt-2 text-sm font-bold text-slate-800">
              {normalizationLabel}
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-white px-5 py-4">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-slate-400">
              log₂(x + 1)
            </p>
            <p className="mt-2 text-sm font-bold text-slate-800">
              {logTransformLabel}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}