import type { ProjectAlgorithm } from "../page";
import AlgorithmCard from "./AlgorithmCard";

interface DatasetSummary {
  hasPseudotime: boolean;
}

interface AlgorithmStepProps {
  algorithms: ProjectAlgorithm[];
  selectedIds: string[];
  compatibleAlgorithms: ProjectAlgorithm[];
  datasetSummary: DatasetSummary;
  ensembleEnabled: boolean;
  isLoadingAlgorithms: boolean;
  algorithmLoadError: string | null;
  setEnsembleEnabled: (value: boolean | ((current: boolean) => boolean)) => void;
  onToggleAlgorithm: (algorithmId: string, disabled: boolean) => void;
  onRecommended: () => void;
  onSelectAll: () => void;
}

export default function AlgorithmStep({
  algorithms,
  selectedIds,
  compatibleAlgorithms,
  datasetSummary,
  ensembleEnabled,
  isLoadingAlgorithms,
  algorithmLoadError,
  setEnsembleEnabled,
  onToggleAlgorithm,
  onRecommended,
  onSelectAll,
}: AlgorithmStepProps) {
  const coreAlgorithms = algorithms.filter((algorithm) => !algorithm.requiresPseudotime);
  const pseudotimeAlgorithms = algorithms.filter((algorithm) => algorithm.requiresPseudotime);

  return (
    <div className="space-y-6">
      <section className="space-y-6">
        {algorithmLoadError ? (
          <div className="rounded-[1.5rem] border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
            {algorithmLoadError}
          </div>
        ) : null}
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
                Core methods
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
                Methods that do not require pseudotime
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                These algorithms can run directly on the expression matrix without a pseudotime file.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onRecommended}
                className="cursor-pointer rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] px-4 py-2 text-sm font-bold text-[#1b75a6] transition hover:border-[#1b75a6]/35 hover:bg-[#e8f5fb]"
              >
                Recommended preset
              </button>
              <button
                type="button"
                onClick={onSelectAll}
                className="cursor-pointer rounded-full bg-[#1b75a6] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#155f87]"
              >
                Select all compatible
              </button>
            </div>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {isLoadingAlgorithms
              ? Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="relative min-h-[10rem] overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-sm before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.4s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent"
                  >
                    <div className="h-5 w-28 rounded-full bg-slate-200" />
                    <div className="mt-4 h-4 w-full rounded-full bg-slate-100" />
                    <div className="mt-2 h-4 w-3/4 rounded-full bg-slate-100" />
                    <div className="mt-6 h-10 rounded-2xl bg-slate-100" />
                  </div>
                ))
              : coreAlgorithms.map((algorithm) => (
                  <AlgorithmCard
                    key={algorithm.id}
                    algorithm={algorithm}
                    checked={selectedIds.includes(algorithm.id)}
                    disabled={false}
                    onToggle={() => onToggleAlgorithm(algorithm.id, false)}
                  />
                ))}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
                Pseudotime-based methods
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
                Methods that require pseudotime
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                These algorithms require ordered cells or a pseudotime file to run.
              </p>
            </div>
            <span
              className={`w-fit rounded-full border px-3 py-1 text-xs font-bold ${
                datasetSummary.hasPseudotime
                  ? "border-[#20b779]/20 bg-[#e8f7f1] text-[#178a62]"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {datasetSummary.hasPseudotime
                ? "Available"
                : "Pseudotime file required"}
            </span>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {isLoadingAlgorithms
              ? Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="relative min-h-[10rem] overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-sm before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.4s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent"
                  >
                    <div className="h-5 w-28 rounded-full bg-slate-200" />
                    <div className="mt-4 h-4 w-full rounded-full bg-slate-100" />
                    <div className="mt-2 h-4 w-3/4 rounded-full bg-slate-100" />
                    <div className="mt-6 h-10 rounded-2xl bg-slate-100" />
                  </div>
                ))
              : pseudotimeAlgorithms.map((algorithm) => {
                  const disabled = !datasetSummary.hasPseudotime;
                  return (
                    <AlgorithmCard
                      key={algorithm.id}
                      algorithm={algorithm}
                      checked={selectedIds.includes(algorithm.id)}
                      disabled={disabled}
                      onToggle={() => onToggleAlgorithm(algorithm.id, disabled)}
                    />
                  );
                })}
          </div>
        </div>
      </section>
    </div>
  );
}