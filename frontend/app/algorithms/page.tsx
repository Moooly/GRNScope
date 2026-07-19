"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  type AlgorithmEntry,
  fetchActiveAlgorithms,
} from "./_lib/catalog";

type BinaryFilter = "any" | "yes" | "no";

const PSEUDOTIME_OPTIONS = [
  { value: "any", label: "Any pseudotime" },
  { value: "yes", label: "Requires pseudotime" },
  { value: "no", label: "No pseudotime" },
] satisfies Array<{ value: BinaryFilter; label: string }>;

const DIRECTION_OPTIONS = [
  { value: "any", label: "Any direction" },
  { value: "yes", label: "Directed" },
  { value: "no", label: "Undirected" },
] satisfies Array<{ value: BinaryFilter; label: string }>;

const SIGN_OPTIONS = [
  { value: "any", label: "Any sign" },
  { value: "yes", label: "Signed" },
  { value: "no", label: "Unsigned" },
] satisfies Array<{ value: BinaryFilter; label: string }>;

const ALGORITHM_DISPLAY_NAMES: Record<string, string> = {
  CELLORACLE: "CellOracle",
  GRNBOOST2: "GRNBoost2",
  PEARSON: "Pearson",
  SCSGL: "scSGL",
};

function matchesBoolean(value: boolean, filter: BinaryFilter) {
  if (filter === "any") return true;
  return filter === "yes" ? value : !value;
}

export default function AlgorithmsPage() {
  const [algorithms, setAlgorithms] = useState<AlgorithmEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pseudotimeFilter, setPseudotimeFilter] = useState<BinaryFilter>("any");
  const [directionFilter, setDirectionFilter] = useState<BinaryFilter>("any");
  const [signFilter, setSignFilter] = useState<BinaryFilter>("any");

  useEffect(() => {
    const controller = new AbortController();

    fetchActiveAlgorithms(controller.signal)
      .then(setAlgorithms)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load algorithms.");
        setAlgorithms([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, []);

  const filteredAlgorithms = useMemo(() => {
    return algorithms.filter(
      (algorithm) =>
        matchesBoolean(algorithm.requiresPseudotime, pseudotimeFilter) &&
        matchesBoolean(algorithm.directed, directionFilter) &&
        matchesBoolean(algorithm.signed, signFilter),
    );
  }, [algorithms, directionFilter, pseudotimeFilter, signFilter]);

  const hasActiveFilters =
    pseudotimeFilter !== "any" ||
    directionFilter !== "any" ||
    signFilter !== "any";
  const clearFilters = () => {
    setPseudotimeFilter("any");
    setDirectionFilter("any");
    setSignFilter("any");
  };

  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="mx-auto max-w-[1160px] px-5 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-10 lg:pb-20 lg:pt-12">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-[2.5rem]">
            Explore algorithms
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Compare methods by their data requirements and network output.
          </p>
        </div>

        {loadError ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {loadError}
          </div>
        ) : null}

        {!loadError ? (
          <>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <FilterPill
                  value={pseudotimeFilter}
                  options={PSEUDOTIME_OPTIONS}
                  onChange={setPseudotimeFilter}
                  ariaLabel="Pseudotime filter"
                />
                <FilterPill
                  value={directionFilter}
                  options={DIRECTION_OPTIONS}
                  onChange={setDirectionFilter}
                  ariaLabel="Direction filter"
                />
                <FilterPill
                  value={signFilter}
                  options={SIGN_OPTIONS}
                  onChange={setSignFilter}
                  ariaLabel="Sign filter"
                />
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="ml-1 text-xs font-semibold text-slate-500 transition hover:text-[#1b75a6]"
                  >
                    Reset
                  </button>
                ) : null}
              </div>
              <p className="text-xs font-medium text-slate-500" aria-live="polite" aria-atomic="true">
                {isLoading
                  ? "Loading…"
                  : `${filteredAlgorithms.length} ${filteredAlgorithms.length === 1 ? "algorithm" : "algorithms"}`}
              </p>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.035)]">
              <div className="hidden grid-cols-[minmax(0,1fr)_8.75rem_7.25rem_6.25rem_1.5rem] gap-x-4 border-b border-slate-100 px-5 py-3 text-[11px] font-semibold text-slate-400 md:grid">
                <span>Algorithm</span>
                <span>Pseudotime</span>
                <span>Direction</span>
                <span>Sign</span>
                <span className="sr-only">Details</span>
              </div>
              <div aria-label={isLoading ? "Loading algorithms" : "Algorithm comparison"}>
                {isLoading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <AlgorithmRowLoading key={index} />
                    ))
                  : filteredAlgorithms.length > 0
                    ? filteredAlgorithms.map((algorithm) => (
                        <AlgorithmRow key={algorithm.id} algorithm={algorithm} />
                      ))
                    : (
                        <div className="px-6 py-12 text-center">
                          <h2 className="text-base font-bold text-slate-950">No algorithms match</h2>
                          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
                            Adjust or reset the property filters.
                          </p>
                          <button
                            type="button"
                            onClick={clearFilters}
                            className="mt-4 inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                          >
                            Reset filters
                          </button>
                        </div>
                      )}
              </div>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}

function FilterPill({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: BinaryFilter;
  options: Array<{ value: BinaryFilter; label: string }>;
  onChange: (value: BinaryFilter) => void;
  ariaLabel: string;
}) {
  const isActive = value !== "any";
  return (
    <label className="relative">
      <span className="sr-only">{ariaLabel}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as BinaryFilter)}
        aria-label={ariaLabel}
        className={`inline-flex h-9 cursor-pointer appearance-none items-center rounded-full pl-3.5 pr-9 text-xs font-bold outline-none transition focus:ring-4 focus:ring-[#1b75a6]/15 ${
          isActive
            ? "bg-[#e7f2f7] text-[#1b75a6] hover:bg-[#d8e9f3]"
            : "bg-slate-100 text-slate-600 hover:bg-[#e7f2f7] hover:text-[#1b75a6]"
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 ${
          isActive ? "text-[#1b75a6]" : "text-slate-400"
        }`}
      >
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
          <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </label>
  );
}

function AlgorithmRow({ algorithm }: { algorithm: AlgorithmEntry }) {
  const displayName = ALGORITHM_DISPLAY_NAMES[algorithm.id] ?? algorithm.name;

  return (
    <Link
      href={`/algorithms/${encodeURIComponent(algorithm.id)}`}
      aria-label={`View ${displayName} algorithm details`}
      className="group grid min-h-[5.25rem] grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-x-4 border-b border-slate-200 px-4 py-4 text-left transition last:border-b-0 hover:bg-[#f8fcfe] focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#1b75a6]/15 md:grid-cols-[minmax(0,1fr)_8.75rem_7.25rem_6.25rem_1.5rem] md:px-5"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[15px] font-bold leading-5 tracking-[-0.015em] text-slate-950 transition group-hover:text-[#155f87]">
            {displayName}
          </h3>
          {algorithm.recommended ? (
            <span className="shrink-0 rounded-full bg-[#e5f5f2] px-2 py-0.5 text-[10px] font-bold text-[#23796f]">
              Recommended
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-xs leading-5 text-slate-600" title={algorithm.tagline}>
          {algorithm.category}
        </p>
      </div>
      <dl className="col-span-2 mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 md:contents">
        <AlgorithmProperty
          label="Pseudotime"
          value={algorithm.requiresPseudotime ? "Required" : "Not required"}
        />
        <AlgorithmProperty
          label="Direction"
          value={algorithm.directed ? "Directed" : "Undirected"}
        />
        <AlgorithmProperty label="Sign" value={algorithm.signed ? "Signed" : "Unsigned"} />
      </dl>
      <svg
        viewBox="0 0 20 20"
        className="col-start-2 row-start-1 h-5 w-5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#1b75a6] md:col-start-5"
        fill="none"
        aria-hidden="true"
      >
        <path d="m7.5 5 5 5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

function AlgorithmProperty({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 md:block">
      <dt className="mb-1.5 truncate text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400 md:sr-only">
        {label}
      </dt>
      <dd>
        <span className="inline-flex max-w-full items-center rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 sm:text-[11px]">
          <span className="truncate">{value}</span>
        </span>
      </dd>
    </div>
  );
}

function AlgorithmRowLoading() {
  return (
    <div className="grid min-h-[5.25rem] animate-pulse grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-4 border-b border-slate-200 px-4 py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_8.75rem_7.25rem_6.25rem_1.5rem] md:px-5">
      <div className="min-w-0">
        <div className="h-4 w-28 rounded-full bg-slate-200" />
        <div className="mt-2 h-3 w-36 rounded-full bg-slate-100" />
      </div>
      <div className="col-span-2 grid grid-cols-3 gap-2 md:contents">
        <div className="h-6 w-20 rounded-md bg-slate-100" />
        <div className="h-6 w-16 rounded-md bg-slate-100" />
        <div className="h-6 w-14 rounded-md bg-slate-100" />
      </div>
      <div className="hidden h-5 w-5 rounded-full bg-slate-100 md:block" />
    </div>
  );
}
