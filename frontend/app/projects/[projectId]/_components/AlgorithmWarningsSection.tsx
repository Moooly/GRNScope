"use client";

import { useState } from "react";

export type AlgorithmWarning = {
  code: string;
  algorithmId: string;
  title: string;
  message: string;
};

type AlgorithmWarningsSectionProps = {
  warnings: AlgorithmWarning[];
};

export default function AlgorithmWarningsSection({
  warnings,
}: AlgorithmWarningsSectionProps) {
  const [openWarningCodes, setOpenWarningCodes] = useState<string[]>([]);

  if (warnings.length === 0) return null;

  const toggleWarning = (code: string) => {
    setOpenWarningCodes((current) =>
      current.includes(code)
        ? current.filter((currentCode) => currentCode !== code)
        : [...current, code],
    );
  };

  return (
    <section className="py-6">
      <div className="min-w-0">
        <h2 className="text-lg font-bold tracking-tight text-slate-950">
          Algorithm warnings
        </h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          These notes explain dataset-specific behavior for selected algorithms.
        </p>
      </div>

      <div className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {warnings.map((warning) => {
          const isWarningOpen = openWarningCodes.includes(warning.code);
          const detailsId = `algorithm-warning-${warning.code}`;

          return (
            <article key={warning.code}>
              <button
                type="button"
                onClick={() => toggleWarning(warning.code)}
                aria-expanded={isWarningOpen}
                aria-controls={detailsId}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50/70 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#1b75a6]/10 sm:px-5"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-50 text-[10px] font-bold text-amber-600"
                >
                  !
                </span>
                <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">
                  {warning.title}
                </h3>
                <span className="shrink-0 text-xs font-semibold text-slate-400">
                  {warning.algorithmId}
                </span>
                <svg
                  viewBox="0 0 16 16"
                  className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${isWarningOpen ? "rotate-180 text-[#1b75a6]" : ""}`}
                  fill="none"
                  aria-hidden="true"
                >
                  <path d="m3.5 6 4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              <div
                id={detailsId}
                aria-hidden={!isWarningOpen}
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                  isWarningOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="border-t border-slate-100 bg-slate-50/70 px-4 pb-4 pt-3 sm:px-5">
                    <p className="text-xs leading-5 text-slate-600">
                      {warning.message}
                    </p>
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
