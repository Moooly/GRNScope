import { Algorithm } from "../_types/algorithm";
import AlgorithmCard from "./AlgorithmCard";

interface DatasetSummary {
  hasPseudotime: boolean;
}

interface AlgorithmStepProps {
  algorithms: Algorithm[];
  selectedIds: string[];
  compatibleAlgorithms: Algorithm[];
  datasetSummary: DatasetSummary;
  ensembleEnabled: boolean;
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
  setEnsembleEnabled,
  onToggleAlgorithm,
  onRecommended,
  onSelectAll,
}: AlgorithmStepProps) {
  return (
    <div className="grid gap-8 xl:grid-cols-[1.35fr_0.65fr]">
      <section className="space-y-8">
        <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-white">Algorithm cards</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Cards are grouped by pseudotime requirement and include directory-style metadata, a checkbox, and an estimated runtime badge.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onRecommended}
                className="cursor-pointer rounded-2xl border border-white/15 px-4 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
              >
                Recommended preset
              </button>
              <button
                type="button"
                onClick={onSelectAll}
                className="cursor-pointer rounded-2xl bg-teal-400 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
              >
                Select all compatible
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-white">
              Methods that do not require pseudotime
            </h2>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
              Always compatible
            </span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {algorithms
              .filter((algorithm) => !algorithm.requiresPseudotime)
              .map((algorithm) => (
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

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-white">
              Methods that require pseudotime
            </h2>
            <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs text-amber-200">
              {datasetSummary.hasPseudotime
                ? "Available"
                : "Unavailable for current dataset"}
            </span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {algorithms
              .filter((algorithm) => algorithm.requiresPseudotime)
              .map((algorithm) => {
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

      <aside className="space-y-6">
        <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-2xl font-semibold text-white">Ensemble analysis</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Enable consensus analysis to compute an aggregated network alongside each selected algorithm output. This toggle defaults to on when two or more algorithms are selected.
          </p>

          <div className="mt-5 flex items-center justify-between rounded-[1.5rem] border border-white/10 bg-slate-950/60 px-4 py-4">
            <div>
              <p className="text-sm font-medium text-white">Consensus network</p>
              <p className="mt-1 text-xs text-slate-400">
                Aggregates predictions from all selected methods.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEnsembleEnabled((current) => !current)}
              disabled={selectedIds.length < 2}
              className={`relative h-7 w-14 rounded-full transition ${
                selectedIds.length < 2
                  ? "cursor-not-allowed bg-white/10"
                  : ensembleEnabled
                    ? "cursor-pointer bg-teal-400"
                    : "cursor-pointer bg-white/20"
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-slate-950 transition ${
                  ensembleEnabled ? "left-8" : "left-1"
                }`}
              />
            </button>
          </div>

          <p className="mt-3 text-xs text-slate-400">
            {selectedIds.length < 2
              ? "Select at least two algorithms to enable consensus analysis."
              : "Consensus analysis is available for the current selection."}
          </p>

          <p className="mt-5 text-xs text-slate-400">
            Compatible methods available: {compatibleAlgorithms.length}
          </p>
        </div>
      </aside>
    </div>
  );
}