"use client";

import { useState } from "react";
import type { MatrixValidationIssue } from "../_lib/types";

type DatasetValidationIssuesSectionProps = {
  issues: MatrixValidationIssue[];
  fallbackMessage: string;
  heading?: string;
  description?: string;
  fallbackTitle?: string;
  fallbackCode?: string;
};

export default function DatasetValidationIssuesSection({
  issues,
  fallbackMessage,
  heading = "Validation issues",
  description = "Fix these before this project can start an analysis.",
  fallbackTitle = "Matrix validation issue",
  fallbackCode = "matrix_validation",
}: DatasetValidationIssuesSectionProps) {
  const displayedIssues = issues.length > 0
    ? issues
    : [{
        code: fallbackCode,
        severity: "error",
        title: fallbackTitle,
        message: fallbackMessage,
        count: 1,
        locations: [],
      }];

  const [openIssueCodes, setOpenIssueCodes] = useState<string[]>([]);

  const toggleIssue = (code: string) => {
    setOpenIssueCodes((current) =>
      current.includes(code)
        ? current.filter((currentCode) => currentCode !== code)
        : [...current, code],
    );
  };

  return (
    <section className="py-6">
      <div className="min-w-0">
        <h2 className="text-lg font-bold tracking-tight text-slate-950">
          {heading}
        </h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {description}
        </p>
      </div>

      <div className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {displayedIssues.map((issue) => {
          const occurrenceCount = Math.max(1, Number(issue.count) || 1);
          const examples = issue.locations ?? [];
          const isIssueOpen = openIssueCodes.includes(issue.code);
          const detailsId = `validation-issue-${issue.code}`;

          return (
            <article key={issue.code}>
              <button
                type="button"
                onClick={() => toggleIssue(issue.code)}
                aria-expanded={isIssueOpen}
                aria-controls={detailsId}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50/70 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#1b75a6]/10 sm:px-5"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-50 text-[10px] font-bold text-rose-500"
                >
                  !
                </span>
                <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">
                  {issue.title}
                </h3>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-400">
                  {occurrenceCount} {occurrenceCount === 1 ? "location" : "locations"}
                </span>
                <svg
                  viewBox="0 0 16 16"
                  className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${isIssueOpen ? "rotate-180 text-[#1b75a6]" : ""}`}
                  fill="none"
                  aria-hidden="true"
                >
                  <path d="m3.5 6 4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              <div
                id={detailsId}
                aria-hidden={!isIssueOpen}
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                  isIssueOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="border-t border-slate-100 bg-slate-50/70 px-4 pb-4 pt-3 sm:px-5">
                    <p className="text-xs leading-5 text-slate-600">{issue.message}</p>

                    {examples.length > 0 ? (
                      <ul className="mt-3 space-y-1.5">
                        {examples.map((location, index) => (
                          <li
                            key={`${issue.code}-${location.row ?? "row"}-${location.column ?? index}`}
                            className="flex items-center gap-2 text-xs leading-5"
                          >
                            <span aria-hidden="true" className="text-slate-300">•</span>
                            <span className="font-semibold text-slate-800">
                              {location.label || "Affected location"}
                            </span>
                            {location.value && location.value.toLowerCase() !== "blank" ? (
                              <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-500 ring-1 ring-slate-200/70">
                                {location.value}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {occurrenceCount > examples.length && examples.length > 0 ? (
                      <p className="mt-3 text-xs text-slate-400">
                        Showing the first {examples.length} of {occurrenceCount} locations.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
