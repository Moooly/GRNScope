import type { ProjectAlgorithm } from "../page";
import AlgorithmCard from "./AlgorithmCard";

interface DatasetSummary {
  hasPseudotime: boolean;
  hasGroundTruth?: boolean;
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
  const getUnavailableReason = (algorithm: ProjectAlgorithm) => {
    if (algorithm.id === "SCSGL" && !datasetSummary.hasGroundTruth) {
      return "Requires a ground-truth network file named GroundTruthNetwork.csv.";
    }
    if (algorithm.requiresPseudotime && !datasetSummary.hasPseudotime) {
      return "Requires a pseudotime file named PseudoTime.csv.";
    }
    return "";
  };

  const availableAlgorithms = algorithms.filter((algorithm) => !getUnavailableReason(algorithm));
  const unavailableAlgorithms = algorithms.filter((algorithm) => Boolean(getUnavailableReason(algorithm)));
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
                Algorithm selection
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
                Select GRN inference methods
              </h2>
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

          {isLoadingAlgorithms ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 9 }).map((_, index) => (
                <div
                  key={index}
                  className="relative min-h-[10rem] overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white p-5 shadow-sm before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.4s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent"
                >
                  <div className="h-5 w-28 rounded-full bg-slate-200" />
                  <div className="mt-4 h-4 w-full rounded-full bg-slate-100" />
                  <div className="mt-2 h-4 w-3/4 rounded-full bg-slate-100" />
                  <div className="mt-6 h-10 rounded-2xl bg-slate-100" />
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 space-y-8">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">
                    Available methods
                  </h3>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-500">
                    {availableAlgorithms.length}
                  </span>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {availableAlgorithms.map((algorithm) => (
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

              {unavailableAlgorithms.length > 0 ? (
                <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 p-5">
                  <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">
                        Unavailable methods
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        These methods need extra input files before they can run. Go back to the upload step and provide the required file to enable them.
                      </p>
                    </div>
                    <span className="w-fit rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-500">
                      {unavailableAlgorithms.length}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                    {unavailableAlgorithms.map((algorithm) => (
                      <div key={algorithm.id} className="space-y-3">
                        <AlgorithmCard
                          algorithm={algorithm}
                          checked={false}
                          disabled={true}
                          onToggle={() => onToggleAlgorithm(algorithm.id, true)}
                        />
                        <div className="rounded-[1rem] border border-slate-200 bg-white px-4 py-3">
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                            Reason
                          </p>
                          <p className="mt-1 text-sm font-medium leading-5 text-slate-700">
                            {getUnavailableReason(algorithm)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}