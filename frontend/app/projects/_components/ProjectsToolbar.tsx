"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type ProjectSortKey = "newest" | "oldest" | "name";

export type ProjectStatusOption = {
  label: string;
  count: number;
};

const SORT_LABELS: Record<ProjectSortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name (A–Z)",
};

const SORT_ORDER: ProjectSortKey[] = ["newest", "oldest", "name"];

interface ProjectsToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusOptions: ProjectStatusOption[];
  activeStatus: string;
  onStatusChange: (label: string) => void;
  totalCount: number;
  sortKey: ProjectSortKey;
  onSortChange: (key: ProjectSortKey) => void;
}

export default function ProjectsToolbar({
  searchQuery,
  onSearchChange,
  statusOptions,
  activeStatus,
  onStatusChange,
  totalCount,
  sortKey,
  onSortChange,
}: ProjectsToolbarProps) {
  const isStatusFiltered = activeStatus !== "all";

  const statusItems: DropdownItem[] = [
    { key: "all", label: "All statuses", count: totalCount },
    ...statusOptions.map((option) => ({
      key: option.label,
      label: option.label,
      count: option.count,
    })),
  ];

  return (
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
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search projects"
          aria-label="Search projects by name"
          className="h-10 w-full rounded-full border border-slate-200 bg-white pl-10 pr-9 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
              <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <FilterDropdown
          ariaLabel="Filter projects by status"
          menuWidthClass="w-52"
          highlighted={isStatusFiltered}
          trigger={
            <>
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
                <path
                  d="M4 5.5h12l-4.6 5.2v3.6l-2.8 1.4v-5L4 5.5Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="hidden sm:inline">Status:</span>{" "}
              {isStatusFiltered ? activeStatus : "All"}
            </>
          }
          items={statusItems}
          activeKey={activeStatus}
          onSelect={onStatusChange}
        />

        <FilterDropdown
          ariaLabel="Sort projects"
          menuWidthClass="w-44"
          trigger={
            <>
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
                <path d="M5 6h10M6.5 10h7M8.5 14h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span className="hidden sm:inline">Sort:</span> {SORT_LABELS[sortKey]}
            </>
          }
          items={SORT_ORDER.map((key) => ({ key, label: SORT_LABELS[key] }))}
          activeKey={sortKey}
          onSelect={(key) => onSortChange(key as ProjectSortKey)}
        />
      </div>
    </div>
  );
}

type DropdownItem = {
  key: string;
  label: string;
  count?: number;
};

function FilterDropdown({
  ariaLabel,
  trigger,
  items,
  activeKey,
  onSelect,
  menuWidthClass,
  highlighted = false,
}: {
  ariaLabel: string;
  trigger: ReactNode;
  items: DropdownItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  menuWidthClass: string;
  highlighted?: boolean;
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

  const showAccent = isOpen || highlighted;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className={`inline-flex h-10 items-center gap-2 rounded-full border bg-white px-4 text-sm font-semibold transition ${
          showAccent
            ? "border-[#1b75a6]/40 text-[#1b75a6]"
            : "border-slate-200 text-slate-600 hover:border-[#1b75a6]/30 hover:text-[#1b75a6]"
        }`}
      >
        {trigger}
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
          className={`absolute right-0 top-full z-40 mt-1.5 ${menuWidthClass} overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/15`}
        >
          {items.map((item) => {
            const isActive = activeKey === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  onSelect(item.key);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
                  isActive ? "bg-[#f2f9fc] text-[#1b75a6]" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {typeof item.count === "number" ? (
                  <span
                    className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[11px] font-bold tabular-nums ${
                      isActive ? "bg-[#1b75a6]/15 text-[#1b75a6]" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {item.count}
                  </span>
                ) : null}
                {isActive ? (
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" aria-hidden="true">
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
