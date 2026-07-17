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
      <section className="border-b border-slate-200 bg-gradient-to-br from-white via-[#f7fbff] to-[#edf9f7]">
        <div className="mx-auto max-w-[1180px] px-6 py-10 lg:px-10 lg:py-12">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#1b75a6]">
            Algorithms directory
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
            Explore algorithms
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            Find and compare the gene regulatory network inference methods available in GRNScope.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-6 pb-12 lg:px-10">
        <div className="sticky top-[var(--grnscope-header-height)] z-30 -mx-2 border-b border-slate-200/80 bg-[#f7fbff]/95 px-2 py-5 backdrop-blur-lg">
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-4">
              <div className="flex items-baseline gap-3">
                <h2 className="text-xl font-bold tracking-tight text-slate-950">All algorithms</h2>
                {!isLoading && !loadError ? (
                  <span className="text-sm font-medium text-slate-400">
                    {filteredAlgorithms.length} {filteredAlgorithms.length === 1 ? "method" : "methods"}
                  </span>
                ) : null}
              </div>
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-sm font-semibold text-slate-500 transition hover:text-[#1b75a6]"
                >
                  Reset filters
                </button>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(17rem,1fr)_repeat(3,12rem)]">
              <label className="relative block md:col-span-2 xl:col-span-1">
                <span className="sr-only">Search algorithms</span>
                <svg
                  viewBox="0 0 20 20"
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.7" />
                  <path d="m12.3 12.3 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name or methodology"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#1b75a6]/45 focus:ring-4 focus:ring-[#1b75a6]/10"
                />
              </label>

              <FilterSelect
                label="Pseudotime"
                value={pseudotimeFilter}
                options={PSEUDOTIME_OPTIONS}
                onChange={setPseudotimeFilter}
              />
              <FilterSelect
                label="Direction"
                value={directionFilter}
                options={DIRECTION_OPTIONS}
                onChange={setDirectionFilter}
              />
              <FilterSelect
                label="Sign"
                value={signFilter}
                options={SIGN_OPTIONS}
                onChange={setSignFilter}
              />
            </div>
          </div>
        </div>

        <div className="pt-6">
          {loadError ? (
            <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-medium text-rose-700">
              {loadError}
            </div>
          ) : null}

          {isLoading ? (
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3" aria-label="Loading algorithms">
              {Array.from({ length: 6 }).map((_, index) => (
                <AlgorithmCardLoading key={index} />
              ))}
            </div>
          ) : null}

          {!isLoading && !loadError && filteredAlgorithms.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {filteredAlgorithms.map((algorithm) => (
                <AlgorithmCard key={algorithm.id} algorithm={algorithm} />
              ))}
            </div>
          ) : null}

          {!isLoading && !loadError && filteredAlgorithms.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
              <h3 className="text-lg font-bold text-slate-950">No matching algorithms</h3>
              <p className="mt-2 text-sm text-slate-500">Try a different search term or reset the property filters.</p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-5 inline-flex h-10 items-center rounded-full border border-[#1b75a6]/25 bg-[#f2f9fc] px-4 text-sm font-bold text-[#1b75a6] transition hover:bg-[#e8f5fb]"
              >
                Reset filters
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: BinaryFilter;
  options: Array<{ value: BinaryFilter; label: string }>;
  onChange: (value: BinaryFilter) => void;
}) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as BinaryFilter)}
        aria-label={label}
        className={`h-11 w-full appearance-none rounded-xl border bg-white px-4 pr-10 text-sm font-semibold outline-none transition hover:border-slate-300 focus:ring-4 focus:ring-[#1b75a6]/10 ${
          value === "any"
            ? "border-slate-200 text-slate-600 focus:border-[#1b75a6]/45"
            : "border-[#1b75a6]/30 bg-[#f2f9fc] text-[#1b75a6] focus:border-[#1b75a6]/50"
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        fill="none"
        aria-hidden="true"
      >
        <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}

function AlgorithmCard({ algorithm }: { algorithm: AlgorithmEntry }) {
  return (
    <Link
      href={`/algorithms/${encodeURIComponent(algorithm.id)}`}
      className="group flex min-h-[15rem] flex-col rounded-[1.35rem] border border-slate-200 bg-white p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-[#1b75a6]/30 hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1b75a6]/15"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-xl font-bold tracking-tight text-slate-950">{algorithm.name}</h3>
            {algorithm.recommended ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-emerald-700">
                Recommended
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs font-semibold leading-5 text-[#1b75a6]">{algorithm.category}</p>
        </div>
        <span className="mt-1 shrink-0 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
          {algorithm.year}
        </span>
      </div>

      <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{algorithm.tagline}</p>

      <div className="mt-auto pt-5">
        <div className="flex flex-wrap gap-1.5">
          <PropertyTag>{algorithm.requiresPseudotime ? "Uses pseudotime" : "No pseudotime"}</PropertyTag>
          <PropertyTag>{algorithm.directed ? "Directed" : "Undirected"}</PropertyTag>
          <PropertyTag>{algorithm.signed ? "Signed" : "Unsigned"}</PropertyTag>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-semibold text-slate-500 transition group-hover:text-[#1b75a6]">
          <span>View details</span>
          <span aria-hidden="true" className="transition group-hover:translate-x-0.5">›</span>
        </div>
      </div>
    </Link>
  );
}

function PropertyTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
      {children}
    </span>
  );
}

function AlgorithmCardLoading() {
  return (
    <div className="min-h-[15rem] animate-pulse rounded-[1.35rem] border border-slate-200 bg-white p-5">
      <div className="h-6 w-32 rounded-full bg-slate-200" />
      <div className="mt-3 h-4 w-40 rounded-full bg-slate-100" />
      <div className="mt-5 h-4 w-full rounded-full bg-slate-100" />
      <div className="mt-2 h-4 w-3/4 rounded-full bg-slate-100" />
      <div className="mt-12 flex gap-2">
        <div className="h-6 w-24 rounded-full bg-slate-100" />
        <div className="h-6 w-20 rounded-full bg-slate-100" />
      </div>
    </div>
  );
}
