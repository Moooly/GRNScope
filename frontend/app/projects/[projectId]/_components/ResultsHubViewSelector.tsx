"use client";

import { useEffect, useRef, useState } from "react";

type ResultsHubView = "network" | "perturbation";

type ResultsHubViewSelectorProps = {
  view: ResultsHubView;
  onChange: (view: ResultsHubView) => void;
  cellOracleReady: boolean;
  cellOracleStatus?: string | null;
};

function SelectionCheck({ visible }: { visible: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center transition-opacity ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      aria-hidden="true"
    >
      <span className="h-3.5 w-2 rotate-45 border-b-[3px] border-r-[3px] border-slate-700" />
    </span>
  );
}

export default function ResultsHubViewSelector({
  view,
  onChange,
  cellOracleReady,
  cellOracleStatus,
}: ResultsHubViewSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const chooseView = (nextView: ResultsHubView) => {
    onChange(nextView);
    setIsOpen(false);
  };

  const perturbationDescription = cellOracleReady
    ? "Simulate gene knockouts and predicted cell-state shifts. Available only with a completed CellOracle result."
    : cellOracleStatus
      ? `Available only when the CellOracle result is complete. Current status: ${cellOracleStatus}.`
      : "Available only when a completed CellOracle result is available.";

  return (
    <div ref={selectorRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="group inline-flex max-w-full items-center gap-3 rounded-lg py-1 text-left transition focus:outline-none focus:ring-4 focus:ring-[#087ead]/10"
      >
        <span className="truncate text-xl font-bold text-slate-950 transition group-hover:text-[#087ead]">
          {view === "network" ? "Results" : "Perturbation"}
        </span>
        <span
          className={`h-2.5 w-2.5 shrink-0 border-b-2 border-r-2 border-slate-500 transition group-hover:border-[#087ead] ${
            isOpen ? "-rotate-[135deg] translate-y-0.5" : "rotate-45 -translate-y-0.5"
          }`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Choose results view"
          className="absolute left-0 top-full z-[70] mt-2 w-[min(23rem,calc(100vw-4rem))] rounded-[1.5rem] border border-slate-200 bg-white p-2.5 shadow-[0_22px_55px_-22px_rgba(15,23,42,0.4)]"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={view === "network"}
            onClick={() => chooseView("network")}
            className="flex w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-slate-950">Results</span>
              <span className="mt-0.5 block text-sm leading-5 text-slate-500">
                Explore inferred networks, ensemble evidence, and gene relationships.
              </span>
            </span>
            <SelectionCheck visible={view === "network"} />
          </button>

          <button
            type="button"
            role="menuitemradio"
            aria-checked={view === "perturbation"}
            aria-disabled={!cellOracleReady}
            disabled={!cellOracleReady}
            onClick={() => chooseView("perturbation")}
            className="flex w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none disabled:cursor-not-allowed disabled:bg-transparent"
          >
            <span className="min-w-0 flex-1">
              <span
                className={`block text-base font-semibold ${cellOracleReady ? "text-slate-950" : "text-slate-400"}`}
              >
                Perturbation
              </span>
              <span
                className={`mt-0.5 block text-sm leading-5 ${cellOracleReady ? "text-slate-500" : "text-slate-400"}`}
              >
                {perturbationDescription}
              </span>
            </span>
            <SelectionCheck visible={view === "perturbation"} />
          </button>
        </div>
      )}
    </div>
  );
}
