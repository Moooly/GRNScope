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

function matchesBoolean(value: boolean, filter: BinaryFilter) {
  if (filter === "any") return true;
  return filter === "yes" ? value : !value;
}

export default function AlgorithmsPage() {
  const [algorithms, setAlgorithms] = useState<AlgorithmEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
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
    const normalizedQuery = query.trim().toLowerCase();
    return algorithms.filter((algorithm) => {
      const matchesSearch =
        normalizedQuery.length === 0 ||
        [algorithm.name, algorithm.category, algorithm.tagline]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return (
        matchesSearch &&
        matchesBoolean(algorithm.requiresPseudotime, pseudotimeFilter) &&
        matchesBoolean(algorithm.directed, directionFilter) &&
        matchesBoolean(algorithm.signed, signFilter)
      );
    });
  }, [algorithms, directionFilter, pseudotimeFilter, query, signFilter]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    pseudotimeFilter !== "any" ||
    directionFilter !== "any" ||
    signFilter !== "any";
  const clearFilters = () => {
    setQuery("");
    setPseudotimeFilter("any");
    setDirectionFilter("any");
    setSignFilter("any");
  };

  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="mx-auto max-w-[1100px] px-6 pb-16 pt-10 lg:px-10 lg:pb-20 lg:pt-14">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Explore algorithms
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Find a method based on its data requirements and network properties.
          </p>
        </div>

        <div className="mt-7 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-sm">
            <span className="sr-only">Search algorithms</span>
            <svg
              viewBox="0 0 20 20"
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="m13.2 13.2 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search algorithms"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm font-medium text-slate-800 outline-none transition placeholder:font-normal placeholder:text-slate-400 hover:border-slate-300 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
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
                className="px-2 text-xs font-medium text-slate-500 transition hover:text-[#1b75a6]"
              >
                Reset
              </button>
            ) : null}
          </div>
        </div>

        {loadError ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {loadError}
          </div>
        ) : null}

        {isLoading ? (
          <div className="mt-8 border-y border-slate-200" aria-label="Loading algorithms">
            {Array.from({ length: 6 }).map((_, index) => (
              <AlgorithmRowLoading key={index} />
            ))}
          </div>
        ) : null}

        {!isLoading && !loadError && filteredAlgorithms.length > 0 ? (
          <div className="mt-8 border-y border-slate-200">
            {filteredAlgorithms.map((algorithm) => (
              <AlgorithmRow key={algorithm.id} algorithm={algorithm} />
            ))}
          </div>
        ) : null}

        {!isLoading && !loadError && filteredAlgorithms.length === 0 ? (
          <div className="mt-8 rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <h2 className="text-base font-bold text-slate-950">No algorithms match</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
              Try a different search or reset the property filters.
            </p>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
              >
                Reset filters
              </button>
            ) : null}
          </div>
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
        className={`inline-flex h-9 cursor-pointer appearance-none items-center rounded-lg border pl-3.5 pr-9 text-xs font-semibold outline-none transition focus:ring-4 focus:ring-[#1b75a6]/10 ${
          isActive
            ? "border-[#1b75a6]/20 bg-[#edf6fa] text-[#1b75a6] hover:bg-[#e3f0f6]"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800"
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
  return (
    <Link
      href={`/algorithms/${encodeURIComponent(algorithm.id)}`}
      className="group grid min-h-[5rem] items-center gap-2 border-b border-slate-200 px-1 py-4 text-left transition last:border-b-0 hover:bg-white/70 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#1b75a6]/10 sm:grid-cols-[minmax(0,1fr)_minmax(26rem,28rem)] sm:gap-8 sm:px-3"
    >
      <div className="min-w-0">
        <h3 className="truncate text-[15px] font-semibold leading-5 tracking-tight text-slate-950 transition group-hover:text-[#155f87]">
          {algorithm.name}
        </h3>
        <p className="mt-1 truncate text-xs font-normal text-slate-500">
          {algorithm.category}
        </p>
      </div>
      <div className="grid w-full grid-cols-[1.35fr_1fr_0.8fr] gap-x-2 text-[11px] font-normal text-slate-500 sm:grid-cols-[minmax(8.5rem,1.35fr)_minmax(6rem,1fr)_minmax(4.5rem,0.8fr)] sm:gap-x-5 sm:text-xs">
        <span>{algorithm.requiresPseudotime ? "Uses pseudotime" : "No pseudotime"}</span>
        <span>{algorithm.directed ? "Directed" : "Undirected"}</span>
        <span>{algorithm.signed ? "Signed" : "Unsigned"}</span>
      </div>
    </Link>
  );
}

function AlgorithmRowLoading() {
  return (
    <div className="flex min-h-[5rem] animate-pulse items-center justify-between gap-6 border-b border-slate-200 px-3 py-4 last:border-b-0">
      <div>
        <div className="h-4 w-28 rounded-full bg-slate-200" />
        <div className="mt-2 h-3 w-36 rounded-full bg-slate-100" />
      </div>
      <div className="h-3 w-52 rounded-full bg-slate-100" />
    </div>
  );
}
