"use client";

type ResultsHubView = "network" | "perturbation";

type ResultsHubViewSelectorProps = {
  view: ResultsHubView;
  onChange: (view: ResultsHubView) => void;
  cellOracleReady: boolean;
  cellOracleStatus?: string | null;
};

export default function ResultsHubViewSelector({
  view,
  onChange,
  cellOracleReady,
  cellOracleStatus,
}: ResultsHubViewSelectorProps) {
  const perturbationDescription = cellOracleReady
    ? "Simulate gene knockouts and predicted cell-state shifts. Available only with a completed CellOracle result."
    : cellOracleStatus
      ? `Available only when the CellOracle result is complete. Current status: ${cellOracleStatus}.`
      : "Available only when a completed CellOracle result is available.";

  return (
    <div className="flex items-center gap-7" role="group" aria-label="Results view">
      <button
        type="button"
        aria-pressed={view === "network"}
        onClick={() => onChange("network")}
        className={`relative pb-3 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 ${
          view === "network"
            ? "text-[#087ead] after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:rounded-full after:bg-[#087ead]"
            : "text-slate-500 hover:text-slate-900"
        }`}
      >
        Network
      </button>
      <button
        type="button"
        aria-pressed={view === "perturbation"}
        disabled={!cellOracleReady}
        title={perturbationDescription}
        onClick={() => onChange("perturbation")}
        className={`relative pb-3 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 disabled:cursor-not-allowed disabled:text-slate-300 ${
          view === "perturbation"
            ? "text-[#087ead] after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:rounded-full after:bg-[#087ead]"
            : "text-slate-500 hover:text-slate-900 disabled:hover:text-slate-300"
        }`}
      >
        Perturbation
      </button>
    </div>
  );
}
