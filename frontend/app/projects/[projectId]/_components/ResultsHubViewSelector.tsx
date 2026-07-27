"use client";

export type ResultsHubView =
  | "network"
  | "agreement"
  | "trajectory"
  | "benchmark"
  | "perturbation";

type ResultsHubViewSelectorProps = {
  view: ResultsHubView;
  onChange: (view: ResultsHubView) => void;
  cellOracleReady: boolean;
  cellOracleStatus?: string | null;
  hasTrajectory?: boolean;
  hasGroundTruth?: boolean;
};

type PerturbationAvailability =
  | { kind: "ready" }
  | { kind: "not-selected" }
  | { kind: "running" }
  | { kind: "failed" }
  | { kind: "unavailable" };

function getPerturbationAvailability(
  cellOracleReady: boolean,
  cellOracleStatus?: string | null,
): PerturbationAvailability {
  if (cellOracleReady) return { kind: "ready" };
  if (!cellOracleStatus) return { kind: "not-selected" };
  const normalized = cellOracleStatus.toLowerCase();
  if (normalized === "running" || normalized === "queued") {
    return { kind: "running" };
  }
  if (normalized === "failed" || normalized === "stopped") {
    return { kind: "failed" };
  }
  return { kind: "unavailable" };
}

export default function ResultsHubViewSelector({
  view,
  onChange,
  cellOracleReady,
  cellOracleStatus,
  hasTrajectory = false,
  hasGroundTruth = false,
}: ResultsHubViewSelectorProps) {
  const availability = getPerturbationAvailability(cellOracleReady, cellOracleStatus);
  const isPerturbationDisabled = availability.kind !== "ready";

  const perturbationUnavailableDetail =
    availability.kind === "running"
      ? "CellOracle is still running. This analysis will become available when it finishes."
      : availability.kind === "failed"
        ? "CellOracle did not finish successfully. Rerun CellOracle to enable perturbation analysis."
        : "Select and run CellOracle for this project to enable perturbation analysis.";

  const views: Array<{
    id: ResultsHubView;
    label: string;
    available: boolean;
    unavailableTitle?: string;
    unavailableDetail?: string;
  }> = [
    { id: "network", label: "Network", available: true },
    { id: "agreement", label: "Comparison", available: true },
    {
      id: "trajectory",
      label: "Trajectory",
      available: hasTrajectory,
      unavailableTitle: "Pseudotime data required",
      unavailableDetail:
        "Upload a pseudotime CSV or enable Slingshot estimation when creating the project.",
    },
    {
      id: "benchmark",
      label: "Benchmark",
      available: hasGroundTruth,
      unavailableTitle: "Reference network required",
      unavailableDetail:
        "Include a ground-truth or reference edge list in the project inputs.",
    },
  ];

  return (
    <div
      className="flex flex-wrap items-end gap-x-6 gap-y-3"
      role="tablist"
      aria-label="Result views"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {views.map((item) => {
          const hintId = `${item.id}-availability-hint`;
          return (
            <div key={item.id} className="group relative">
              <button
                type="button"
                role="tab"
                aria-selected={view === item.id}
                aria-disabled={!item.available}
                aria-describedby={!item.available ? hintId : undefined}
                onClick={() => {
                  if (item.available) onChange(item.id);
                }}
                className={`relative inline-flex items-center gap-1.5 pb-3 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 ${
                  view === item.id
                    ? "text-[#087ead] after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:rounded-full after:bg-[#087ead]"
                    : item.available
                      ? "text-slate-500 hover:text-slate-900"
                      : "cursor-help text-slate-400"
                }`}
              >
                <span>{item.label}</span>
                {!item.available ? (
                  <span
                    aria-hidden="true"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-extrabold leading-none text-slate-400"
                  >
                    i
                  </span>
                ) : null}
              </button>
              {!item.available ? (
                <div
                  id={hintId}
                  role="tooltip"
                  className="pointer-events-none invisible absolute left-0 top-full z-[60] mt-2 w-64 max-w-[calc(100vw-3rem)] translate-y-1 rounded-xl border border-slate-200 bg-white p-3 opacity-0 shadow-[0_16px_38px_rgba(15,23,42,0.14)] transition group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
                >
                  <p className="text-xs font-extrabold text-slate-900">
                    {item.unavailableTitle}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {item.unavailableDetail}
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex items-start gap-6">
        <span
          className="mt-0.5 hidden h-4 w-px bg-slate-200 sm:block"
          aria-hidden="true"
        />
        <div className="group relative">
          <button
            type="button"
            role="tab"
            aria-selected={view === "perturbation"}
            aria-disabled={isPerturbationDisabled}
            aria-describedby={
              isPerturbationDisabled ? "perturbation-availability-hint" : undefined
            }
            onClick={() => {
              if (!isPerturbationDisabled) onChange("perturbation");
            }}
            className={`relative inline-flex items-center gap-1.5 pb-3 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 ${
              view === "perturbation"
                ? "text-[#087ead] after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:rounded-full after:bg-[#087ead]"
                : isPerturbationDisabled
                  ? "cursor-help text-slate-400"
                  : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <span>Perturbation</span>
            {isPerturbationDisabled ? (
              <span
                aria-hidden="true"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-extrabold leading-none text-slate-400"
              >
                i
              </span>
            ) : null}
          </button>
          {isPerturbationDisabled ? (
            <div
              id="perturbation-availability-hint"
              role="tooltip"
              className="pointer-events-none invisible absolute right-0 top-full z-[60] mt-2 w-64 max-w-[calc(100vw-3rem)] translate-y-1 rounded-xl border border-slate-200 bg-white p-3 opacity-0 shadow-[0_16px_38px_rgba(15,23,42,0.14)] transition group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
            >
              <p className="text-xs font-extrabold text-slate-900">
                Perturbation analysis unavailable
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {perturbationUnavailableDetail}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
