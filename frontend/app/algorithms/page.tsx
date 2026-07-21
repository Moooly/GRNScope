"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  type AlgorithmEntry,
  type AlgorithmSpeedTier,
  fetchActiveAlgorithms,
  getAlgorithmSpeed,
} from "./_lib/catalog";

type BinaryFilter = "any" | "yes" | "no";
type SortKey = "recommended" | "name" | "speed";

const PSEUDOTIME_FACET = [
  { value: "any", label: "Any" },
  { value: "yes", label: "Required" },
  { value: "no", label: "Not required" },
] satisfies Array<{ value: BinaryFilter; label: string }>;

const DIRECTION_FACET = [
  { value: "any", label: "Any" },
  { value: "yes", label: "Directed" },
  { value: "no", label: "Undirected" },
] satisfies Array<{ value: BinaryFilter; label: string }>;

const SIGN_FACET = [
  { value: "any", label: "Any" },
  { value: "yes", label: "Signed" },
  { value: "no", label: "Unsigned" },
] satisfies Array<{ value: BinaryFilter; label: string }>;

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "recommended", label: "Recommended first" },
  { value: "name", label: "Name (A–Z)" },
  { value: "speed", label: "Fastest first" },
];
const SORT_LABELS: Record<SortKey, string> = {
  recommended: "Recommended first",
  name: "Name (A–Z)",
  speed: "Fastest first",
};

const GRID_TEMPLATE =
  "md:grid-cols-[minmax(0,1fr)_8.5rem_7rem_6rem_6.5rem_1.5rem]";

const ALGORITHM_DISPLAY_NAMES: Record<string, string> = {
  CELLORACLE: "CellOracle",
  GRNBOOST2: "GRNBoost2",
  PEARSON: "Pearson",
  SCSGL: "scSGL",
};

const SPEED_TONE: Record<AlgorithmSpeedTier, string> = {
  fast: "bg-emerald-50 text-emerald-700",
  moderate: "bg-amber-50 text-amber-700",
  slow: "bg-rose-50 text-rose-700",
};

function displayNameFor(algorithm: AlgorithmEntry) {
  return ALGORITHM_DISPLAY_NAMES[algorithm.id] ?? algorithm.name;
}

function matchesBoolean(value: boolean, filter: BinaryFilter) {
  if (filter === "any") return true;
  return filter === "yes" ? value : !value;
}

export default function AlgorithmsPage() {
  const [algorithms, setAlgorithms] = useState<AlgorithmEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pseudotimeFilter, setPseudotimeFilter] = useState<BinaryFilter>("any");
  const [directionFilter, setDirectionFilter] = useState<BinaryFilter>("any");
  const [signFilter, setSignFilter] = useState<BinaryFilter>("any");
  const [sortKey, setSortKey] = useState<SortKey>("recommended");

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

  const visibleAlgorithms = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = algorithms.filter((algorithm) => {
      const matchesSearch =
        !query ||
        displayNameFor(algorithm).toLowerCase().includes(query) ||
        algorithm.category.toLowerCase().includes(query) ||
        algorithm.tagline.toLowerCase().includes(query);
      return (
        matchesSearch &&
        matchesBoolean(algorithm.requiresPseudotime, pseudotimeFilter) &&
        matchesBoolean(algorithm.directed, directionFilter) &&
        matchesBoolean(algorithm.signed, signFilter)
      );
    });

    const withIndex = filtered.map((algorithm, index) => ({ algorithm, index }));
    withIndex.sort((a, b) => {
      if (sortKey === "name") {
        return displayNameFor(a.algorithm).localeCompare(
          displayNameFor(b.algorithm),
          undefined,
          { sensitivity: "base" },
        );
      }
      if (sortKey === "speed") {
        const orderDiff =
          getAlgorithmSpeed(a.algorithm).order - getAlgorithmSpeed(b.algorithm).order;
        if (orderDiff !== 0) return orderDiff;
        return a.index - b.index;
      }
      // recommended first, then original catalog order
      const recommendedDiff =
        Number(b.algorithm.recommended) - Number(a.algorithm.recommended);
      if (recommendedDiff !== 0) return recommendedDiff;
      return a.index - b.index;
    });
    return withIndex.map((item) => item.algorithm);
  }, [algorithms, searchQuery, pseudotimeFilter, directionFilter, signFilter, sortKey]);

  const activeFilterCount =
    (pseudotimeFilter !== "any" ? 1 : 0) +
    (directionFilter !== "any" ? 1 : 0) +
    (signFilter !== "any" ? 1 : 0);
  const clearFacets = () => {
    setPseudotimeFilter("any");
    setDirectionFilter("any");
    setSignFilter("any");
  };
  const clearFilters = () => {
    setSearchQuery("");
    clearFacets();
  };

  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="mx-auto max-w-[1160px] px-5 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-10 lg:pb-20 lg:pt-12">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-[2.5rem]">
            Explore algorithms
          </h1>
        </div>

        {loadError ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {loadError}
          </div>
        ) : null}

        {!loadError ? (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <div className="relative min-w-0 flex-1 sm:max-w-sm">
                <svg
                  viewBox="0 0 20 20"
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                  <path d="m13.5 13.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search algorithms"
                  aria-label="Search algorithms by name or methodology"
                  className="h-10 w-full rounded-full border border-slate-200 bg-white pl-10 pr-9 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                      <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                ) : null}
              </div>

              <p
                className="ml-auto shrink-0 text-xs font-medium text-slate-500"
                aria-live="polite"
                aria-atomic="true"
              >
                {isLoading
                  ? "Loading…"
                  : `${visibleAlgorithms.length} ${visibleAlgorithms.length === 1 ? "algorithm" : "algorithms"}`}
              </p>
              <FilterMenu
                pseudotime={pseudotimeFilter}
                direction={directionFilter}
                sign={signFilter}
                onPseudotimeChange={setPseudotimeFilter}
                onDirectionChange={setDirectionFilter}
                onSignChange={setSignFilter}
                activeCount={activeFilterCount}
                onClearAll={clearFacets}
              />
              <SortDropdown value={sortKey} onChange={setSortKey} />
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.035)]">
              <div className={`hidden gap-x-4 border-b border-slate-200 bg-slate-50/70 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 md:grid ${GRID_TEMPLATE}`}>
                <span>Algorithm</span>
                <span className="text-center">Pseudotime</span>
                <span className="text-center">Direction</span>
                <span className="text-center">Sign</span>
                <span className="text-center">Speed</span>
                <span className="sr-only">Details</span>
              </div>
              <div aria-label={isLoading ? "Loading algorithms" : "Algorithm comparison"}>
                {isLoading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <AlgorithmRowLoading key={index} />
                    ))
                  : visibleAlgorithms.length > 0
                    ? visibleAlgorithms.map((algorithm) => (
                        <AlgorithmRow key={algorithm.id} algorithm={algorithm} />
                      ))
                    : (
                        <div className="px-6 py-12 text-center">
                          <h2 className="text-base font-bold text-slate-950">No algorithms match</h2>
                          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
                            Adjust your search or reset the property filters.
                          </p>
                          <button
                            type="button"
                            onClick={clearFilters}
                            className="mt-4 inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                          >
                            Clear filters
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

function SortDropdown({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (value: SortKey) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Sort algorithms"
        className={`inline-flex h-10 items-center gap-2 rounded-full border bg-white px-4 text-sm font-semibold transition ${
          isOpen
            ? "border-[#1b75a6]/40 text-[#1b75a6]"
            : "border-slate-200 text-slate-600 hover:border-[#1b75a6]/30 hover:text-[#1b75a6]"
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="M5 6h10M6.5 10h7M8.5 14h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">Sort:</span> {SORT_LABELS[value]}
        <svg
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          aria-hidden="true"
        >
          <path d="m3.5 6 4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/15"
        >
          {SORT_OPTIONS.map((option) => {
            const isActive = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
                  isActive ? "bg-[#f2f9fc] text-[#1b75a6]" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {option.label}
                {isActive ? (
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                    <path d="m3.5 8.2 3 3 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function FilterMenu({
  pseudotime,
  direction,
  sign,
  onPseudotimeChange,
  onDirectionChange,
  onSignChange,
  activeCount,
  onClearAll,
}: {
  pseudotime: BinaryFilter;
  direction: BinaryFilter;
  sign: BinaryFilter;
  onPseudotimeChange: (value: BinaryFilter) => void;
  onDirectionChange: (value: BinaryFilter) => void;
  onSignChange: (value: BinaryFilter) => void;
  activeCount: number;
  onClearAll: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const showAccent = isOpen || activeCount > 0;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Filter algorithms"
        className={`inline-flex h-10 items-center gap-2 rounded-full border bg-white px-4 text-sm font-semibold transition ${
          showAccent
            ? "border-[#1b75a6]/40 text-[#1b75a6]"
            : "border-slate-200 text-slate-600 hover:border-[#1b75a6]/30 hover:text-[#1b75a6]"
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
          <path
            d="M4 5.5h12l-4.6 5.2v3.6l-2.8 1.4v-5L4 5.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        Filters
        {activeCount > 0 ? (
          <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[#1b75a6] px-1 text-[11px] font-bold text-white">
            {activeCount}
          </span>
        ) : null}
        <svg
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          aria-hidden="true"
        >
          <path d="m3.5 6 4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 w-[19rem] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/15"
        >
          <div className="space-y-4">
            <FacetGroup
              label="Pseudotime"
              value={pseudotime}
              options={PSEUDOTIME_FACET}
              onChange={onPseudotimeChange}
            />
            <FacetGroup
              label="Direction"
              value={direction}
              options={DIRECTION_FACET}
              onChange={onDirectionChange}
            />
            <FacetGroup
              label="Sign"
              value={sign}
              options={SIGN_FACET}
              onChange={onSignChange}
            />
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-xs font-medium text-slate-400">
              {activeCount > 0
                ? `${activeCount} ${activeCount === 1 ? "filter" : "filters"} active`
                : "No filters"}
            </span>
            <button
              type="button"
              onClick={onClearAll}
              disabled={activeCount === 0}
              className="text-xs font-semibold text-slate-500 transition hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Clear all
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FacetGroup({
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
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <div className="mt-1.5 flex w-full rounded-lg bg-slate-100 p-0.5">
        {options.map((option) => {
          const isActive = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={isActive}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                isActive
                  ? "bg-white text-[#1b75a6] shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AlgorithmRow({ algorithm }: { algorithm: AlgorithmEntry }) {
  const displayName = displayNameFor(algorithm);
  const speed = getAlgorithmSpeed(algorithm);

  return (
    <Link
      href={`/algorithms/${encodeURIComponent(algorithm.id)}`}
      aria-label={`View ${displayName} algorithm details`}
      className={`group grid min-h-[5.25rem] grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-x-4 border-b border-slate-200 px-4 py-4 text-left transition last:border-b-0 hover:bg-[#f8fcfe] focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#1b75a6]/15 md:px-5 ${GRID_TEMPLATE}`}
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
      <dl className="col-span-2 mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-4 md:contents">
        <AlgorithmProperty
          label="Pseudotime"
          value={algorithm.requiresPseudotime ? "Required" : "Not required"}
          tone={algorithm.requiresPseudotime ? "warning" : "neutral"}
        />
        <AlgorithmProperty
          label="Direction"
          value={algorithm.directed ? "Directed" : "Undirected"}
          icon={algorithm.directed ? <DirectedIcon /> : <UndirectedIcon />}
        />
        <AlgorithmProperty
          label="Sign"
          value={algorithm.signed ? "Signed" : "Unsigned"}
          icon={algorithm.signed ? <SignedGlyph /> : undefined}
        />
        <AlgorithmProperty
          label="Speed"
          value={speed.label}
          toneClass={SPEED_TONE[speed.tier]}
          title={algorithm.estimatedRuntime}
        />
      </dl>
      <svg
        viewBox="0 0 20 20"
        className="col-start-2 row-start-1 h-5 w-5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#1b75a6] md:col-start-6"
        fill="none"
        aria-hidden="true"
      >
        <path d="m7.5 5 5 5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

type PropertyTone = "neutral" | "warning" | "positive" | "danger";

const TONE_CLASS: Record<PropertyTone, string> = {
  neutral: "bg-slate-100 text-slate-600",
  warning: "bg-amber-50 text-amber-700",
  positive: "bg-emerald-50 text-emerald-700",
  danger: "bg-rose-50 text-rose-700",
};

function AlgorithmProperty({
  label,
  value,
  tone = "neutral",
  toneClass,
  icon,
  title,
}: {
  label: string;
  value: string;
  tone?: PropertyTone;
  toneClass?: string;
  icon?: ReactNode;
  title?: string;
}) {
  return (
    <div className="min-w-0 md:block">
      <dt className="mb-1.5 truncate text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400 md:sr-only">
        {label}
      </dt>
      <dd className="md:text-center">
        <span
          title={title}
          className={`inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold sm:text-[11px] ${
            toneClass ?? TONE_CLASS[tone]
          }`}
        >
          {icon ? <span className="shrink-0" aria-hidden="true">{icon}</span> : null}
          <span className="truncate">{value}</span>
        </span>
      </dd>
    </div>
  );
}

function DirectedIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
      <path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UndirectedIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
      <path d="M4.5 8h7M6.5 5.5 4 8l2.5 2.5M9.5 5.5 12 8l-2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SignedGlyph() {
  return (
    <span className="text-[11px] font-bold leading-none" aria-hidden="true">
      ±
    </span>
  );
}

function AlgorithmRowLoading() {
  return (
    <div className={`grid min-h-[5.25rem] animate-pulse grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-4 border-b border-slate-200 px-4 py-4 last:border-b-0 md:px-5 ${GRID_TEMPLATE}`}>
      <div className="min-w-0">
        <div className="h-4 w-28 rounded-full bg-slate-200" />
        <div className="mt-2 h-3 w-36 rounded-full bg-slate-100" />
      </div>
      <div className="col-span-2 grid grid-cols-2 gap-2 sm:grid-cols-4 md:contents">
        <div className="h-6 w-20 rounded-md bg-slate-100" />
        <div className="h-6 w-16 rounded-md bg-slate-100" />
        <div className="h-6 w-14 rounded-md bg-slate-100" />
        <div className="h-6 w-16 rounded-md bg-slate-100" />
      </div>
      <div className="hidden h-5 w-5 rounded-full bg-slate-100 md:block" />
    </div>
  );
}
