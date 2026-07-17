"use client";

import { useId, useState, type ReactNode } from "react";

type AnalysisSetupSectionProps = {
  summary: string;
  children: ReactNode;
};

export default function AnalysisSetupSection({
  summary,
  children,
}: AnalysisSetupSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const contentId = useId();

  return (
    <section className="mt-5 overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white text-slate-900 shadow-[0_8px_24px_rgba(15,23,42,0.035)]">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className="group flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-[#f7fbff] focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#1b75a6]/10 sm:px-6"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold tracking-tight text-slate-950">
            Analysis setup
          </span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            Methods, input data, preprocessing, and files
          </span>
        </span>

        <span className="hidden max-w-[24rem] items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500 sm:inline-flex">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#20b779]" />
          <span className="truncate">{summary}</span>
        </span>

        <span
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition group-hover:bg-white group-hover:text-[#1b75a6] ${
            isOpen ? "rotate-180 bg-slate-50 text-[#1b75a6]" : ""
          }`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
            <path d="m3.5 6 4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {isOpen ? (
        <div id={contentId}>
          <div className="divide-y divide-slate-200 border-t border-slate-200 bg-white px-5 sm:px-6">
            {children}
          </div>
        </div>
      ) : null}
    </section>
  );
}
