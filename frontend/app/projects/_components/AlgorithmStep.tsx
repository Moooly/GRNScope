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
    <div className="space-y-8">
      <section className="space-y-8">

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold text-white">
              Methods that do not require pseudotime
            </h2>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onRecommended}
                className="cursor-pointer rounded-xl border border-white/15 px-3 py-2 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
              >
                Recommended preset
              </button>
              <button
                type="button"
                onClick={onSelectAll}
                className="cursor-pointer rounded-xl bg-teal-400 px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
              >
                Select all compatible
              </button>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
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
                : "Unavailable methods, pseudotime file is required"}
            </span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {algorithms
              .filter((algorithm) => algorithm.requiresPseudotime)
              .map((algorithm) => {
                const disabled = !datasetSummary.hasPseudotime;
                return (
                  <AlgorithmCard
                    key={algorithm.id}
                    algorithm={{ ...algorithm, description: disabled ? "" : algorithm.description }}
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
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold text-white">Ensemble analysis</h2>
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

          <p className="mt-2 text-sm leading-6 text-slate-400">
            Enable consensus analysis to compute an aggregated network alongside each selected algorithm output. It's available when two or more algorithms are selected.
          </p>


        </div>
      </aside>
    </div>
  );
}