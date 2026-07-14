import type { ProjectAlgorithm } from "../page";
import AlgorithmCard from "./AlgorithmCard";

interface DatasetSummary {
  hasPseudotime: boolean;
  hasCellOracleSettingsConfigured?: boolean;
  hasGroundTruth?: boolean;
}

interface AlgorithmStepProps {
  algorithms: ProjectAlgorithm[];
  selectedIds: string[];
  datasetSummary: DatasetSummary;
  isLoadingAlgorithms: boolean;
  algorithmLoadError: string | null;
  onToggleAlgorithm: (algorithmId: string, disabled: boolean) => void;
  onConfigureAlgorithm?: (algorithm: ProjectAlgorithm) => void;
  customizedIds?: string[];
}

export default function AlgorithmStep({
  algorithms,
  selectedIds,
  datasetSummary,
  isLoadingAlgorithms,
  algorithmLoadError,
  onToggleAlgorithm,
  onConfigureAlgorithm,
  customizedIds,
}: AlgorithmStepProps) {
  const getUnavailableReason = (algorithm: ProjectAlgorithm) => {
    if (algorithm.id === "SCSGL" && !datasetSummary.hasGroundTruth) {
      return "Requires a ground-truth network file named GroundTruthNetwork.csv.";
    }
    if (algorithm.requiresPseudotime && !datasetSummary.hasPseudotime) {
      return "Requires a pseudotime file named PseudoTime.csv.";
    }
    if (algorithm.id === "CELLORACLE" && !datasetSummary.hasCellOracleSettingsConfigured) {
      return "Requires CellOracle species selection.";
    }
    return "";
  };

  const availableAlgorithms = algorithms.filter((algorithm) => !getUnavailableReason(algorithm));
  const availableAlgorithmIds = new Set(availableAlgorithms.map((algorithm) => algorithm.id));
  const unavailablePseudotimeAlgorithms = algorithms.filter(
    (algorithm) =>
      Boolean(getUnavailableReason(algorithm)) &&
      algorithm.requiresPseudotime &&
      !datasetSummary.hasPseudotime,
  );
  const unavailableGroundTruthAlgorithms = algorithms.filter(
    (algorithm) =>
      Boolean(getUnavailableReason(algorithm)) &&
      algorithm.id === "SCSGL" &&
      !datasetSummary.hasGroundTruth,
  );
  const unavailableCellOracleAlgorithms = algorithms.filter(
    (algorithm) => Boolean(getUnavailableReason(algorithm)) && algorithm.id === "CELLORACLE",
  );
  const hasUnavailableAlgorithms =
    unavailablePseudotimeAlgorithms.length > 0 ||
    unavailableGroundTruthAlgorithms.length > 0 ||
    unavailableCellOracleAlgorithms.length > 0;

  const renderUnavailableGroup = (
    title: string,
    unavailableGroupAlgorithms: ProjectAlgorithm[],
  ) => {
    if (unavailableGroupAlgorithms.length === 0) return null;

    return (
      <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/60 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
          {title}
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))]">
          {unavailableGroupAlgorithms.map((algorithm) => (
            <AlgorithmCard
              key={algorithm.id}
              algorithm={algorithm}
              checked={false}
              disabled={true}
              onToggle={() => onToggleAlgorithm(algorithm.id, true)}
            />
          ))}
        </div>
      </div>
    );
  };

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
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))]">
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))]">
                  {availableAlgorithms.map((algorithm) => (
                    <AlgorithmCard
                      key={algorithm.id}
                      algorithm={algorithm}
                      checked={availableAlgorithmIds.has(algorithm.id) && selectedIds.includes(algorithm.id)}
                      disabled={false}
                      onToggle={() => onToggleAlgorithm(algorithm.id, false)}
                      onConfigure={
                        onConfigureAlgorithm
                          ? () => onConfigureAlgorithm(algorithm)
                          : undefined
                      }
                      isCustomized={customizedIds?.includes(algorithm.id)}
                    />
                  ))}
                </div>
              </div>

              {hasUnavailableAlgorithms ? (
                <div>
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">
                      Unavailable methods
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      These methods need one more input or setup step before they can run.
                    </p>
                  </div>

                  <div className="mt-4 space-y-4">
                    {renderUnavailableGroup("Need pseudotime CSV", unavailablePseudotimeAlgorithms)}
                    {renderUnavailableGroup("Need CellOracle setup", unavailableCellOracleAlgorithms)}
                    {renderUnavailableGroup("Need ground-truth network", unavailableGroundTruthAlgorithms)}
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
