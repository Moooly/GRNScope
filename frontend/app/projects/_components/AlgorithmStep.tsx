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
  onShowAlgorithmDetails?: (algorithm: ProjectAlgorithm) => void;
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
  onShowAlgorithmDetails,
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
  const availableAlgorithmIds = new Set(availableAlgorithms.map((algorithm) => algorithm.id));
  const unavailableAlgorithms = algorithms.filter((algorithm) => Boolean(getUnavailableReason(algorithm)));
  const unavailableReasonSummary = (() => {
    const needsGroundTruth = unavailableAlgorithms.some(
      (algorithm) => algorithm.id === "SCSGL" && !datasetSummary.hasGroundTruth,
    );
    const needsPseudotime = unavailableAlgorithms.some(
      (algorithm) => algorithm.requiresPseudotime && !datasetSummary.hasPseudotime,
    );

    if (needsPseudotime && needsGroundTruth) {
      return "These methods need a pseudotime file or a ground-truth network file before they can run.";
    }

    if (needsPseudotime) {
      return "These methods need a pseudotime file before they can run.";
    }

    if (needsGroundTruth) {
      return "These methods need a ground-truth network file before they can run.";
    }

    return "These methods need extra input files before they can run.";
  })();
  return (
    <div className="space-y-6">
      <section className="space-y-6">
        {algorithmLoadError ? (
          <div className="rounded-[1.5rem] border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
            {algorithmLoadError}
          </div>
        ) : null}

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-black">
              Algorithm selection
            </p>
          </div>

          {isLoadingAlgorithms ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 py-3.5 before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.4s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent"
                >
                  <div className="h-3.5 w-24 rounded-full bg-slate-200" />
                  <div className="mt-2 h-3 w-32 rounded-full bg-slate-100" />
                  <div className="mt-2 h-3 w-40 rounded-full bg-slate-100" />
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 space-y-8">
              <div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {availableAlgorithms.map((algorithm) => (
                    <AlgorithmCard
                      key={algorithm.id}
                      algorithm={algorithm}
                      checked={availableAlgorithmIds.has(algorithm.id) && selectedIds.includes(algorithm.id)}
                      disabled={false}
                      onToggle={() => onToggleAlgorithm(algorithm.id, false)}
                      onInfoClick={
                        onShowAlgorithmDetails
                          ? () => onShowAlgorithmDetails(algorithm)
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>

              {unavailableAlgorithms.length > 0 ? (
                <div>
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">
                      Unavailable methods
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {unavailableReasonSummary}
                    </p>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {unavailableAlgorithms.map((algorithm) => (
                      <AlgorithmCard
                        key={algorithm.id}
                        algorithm={algorithm}
                        checked={false}
                        disabled={true}
                        onToggle={() => onToggleAlgorithm(algorithm.id, true)}
                        onInfoClick={
                          onShowAlgorithmDetails
                            ? () => onShowAlgorithmDetails(algorithm)
                            : undefined
                        }
                      />
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