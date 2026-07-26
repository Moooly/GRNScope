"use client";

export type ResultsHubView =
  | "network"
  | "regulators"
  | "agreement"
  | "trajectory"
  | "benchmark"
  | "diagnostics"
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
  | { kind: "not-selected"; reason: string; tone: "muted" | "warn" | "danger" }
  | { kind: "running"; reason: string; tone: "muted" | "warn" | "danger" }
  | { kind: "failed"; reason: string; tone: "muted" | "warn" | "danger" }
  | { kind: "unavailable"; reason?: string; tone?: "muted" | "warn" | "danger" };

function getPerturbationAvailability(
  cellOracleReady: boolean,
  cellOracleStatus?: string | null,
): PerturbationAvailability {
  if (cellOracleReady) return { kind: "ready" };
  if (!cellOracleStatus) {
    return { kind: "not-selected", reason: "Requires CellOracle", tone: "muted" };
  }
  const normalized = cellOracleStatus.toLowerCase();
  if (normalized === "running" || normalized === "queued") {
    return { kind: "running", reason: "CellOracle running…", tone: "muted" };
  }
  if (normalized === "failed" || normalized === "stopped") {
    return { kind: "failed", reason: "CellOracle failed", tone: "danger" };
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

  const reasonToneClass = (() => {
    if (!("tone" in availability) || !availability.tone) return "";
    if (availability.tone === "danger") return "text-rose-500";
    if (availability.tone === "warn") return "text-amber-600";
    return "text-slate-400";
  })();

  const perturbationAriaLabel = (() => {
    if (availability.kind === "ready") return undefined;
    if ("reason" in availability && availability.reason) {
      return `Perturbation — ${availability.reason}`;
    }
    return "Perturbation — not available";
  })();

  const views: Array<{ id: ResultsHubView; label: string }> = [
    { id: "network", label: "Network" },
    { id: "regulators", label: "Regulators" },
    { id: "agreement", label: "Agreement" },
    ...(hasTrajectory ? [{ id: "trajectory" as const, label: "Trajectory" }] : []),
    ...(hasGroundTruth ? [{ id: "benchmark" as const, label: "Benchmark" }] : []),
    { id: "diagnostics", label: "Diagnostics" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2" role="group" aria-label="Results view">
      {views.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={view === item.id}
          onClick={() => onChange(item.id)}
          className={`relative pb-3 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 ${
            view === item.id
              ? "text-[#087ead] after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:rounded-full after:bg-[#087ead]"
              : "text-slate-500 hover:text-slate-900"
          }`}
        >
          {item.label}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={view === "perturbation"}
        aria-label={perturbationAriaLabel}
        disabled={isPerturbationDisabled}
        onClick={() => onChange("perturbation")}
        className={`relative inline-flex items-center pb-3 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-[#087ead]/10 disabled:cursor-not-allowed disabled:text-slate-300 ${
          view === "perturbation"
            ? "text-[#087ead] after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:rounded-full after:bg-[#087ead]"
            : "text-slate-500 hover:text-slate-900 disabled:hover:text-slate-300"
        }`}
      >
        <span>Perturbation</span>
        {"reason" in availability && availability.reason ? (
          <span
            aria-hidden="true"
            className={`ml-2 inline-flex items-center gap-1 text-[11px] font-medium ${reasonToneClass}`}
          >
            <span className="text-slate-300">·</span>
            {availability.kind === "running" ? (
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            ) : null}
            {availability.reason}
          </span>
        ) : null}
      </button>
    </div>
  );
}
