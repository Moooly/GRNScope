"use client";

import { useId, useState, type ReactNode } from "react";

type AnalysisSetupSectionProps = {
  title?: string;
  status?: ReactNode;
  autoExpand?: boolean;
  downloadMenu: ReactNode;
  children: ReactNode;
};

export default function AnalysisSetupSection({
  title = "Analysis details",
  status,
  autoExpand = false,
  downloadMenu,
  children,
}: AnalysisSetupSectionProps) {
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const contentId = useId();
  const isOpen = openOverride ?? autoExpand;
  const toggleOpen = () => setOpenOverride(!isOpen);

  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-[0_6px_18px_rgba(15,23,42,0.025)]">
      <div className="group/analysis-bar relative flex min-h-[64px] flex-wrap items-center gap-x-4 transition hover:bg-slate-50/60">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={isOpen}
          aria-controls={contentId}
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${title.toLowerCase()}`}
          className="absolute inset-0 z-0 cursor-pointer rounded-2xl focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#1b75a6]/10"
        >
          <span className="sr-only">
            {`${isOpen ? "Collapse" : "Expand"} ${title.toLowerCase()}`}
          </span>
        </button>

        <div className="pointer-events-none relative z-10 flex min-w-fit items-center self-stretch gap-2 px-5 py-3.5 text-left sm:px-6">
          <span className="flex items-center gap-2.5 text-[0.95rem] font-bold tracking-tight text-slate-950">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#eef7fb] text-[#1b75a6]" aria-hidden="true">
              <svg viewBox="0 0 18 18" className="h-4 w-4" fill="none">
                <path d="M4 13.5V9m5 4.5v-9m5 9V7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            {title}
          </span>
          <svg
            viewBox="0 0 16 16"
            className={`h-3.5 w-3.5 text-slate-400 transition group-hover/analysis-bar:text-[#1b75a6] ${
              isOpen ? "rotate-180 text-[#1b75a6]" : ""
            }`}
            fill="none"
            aria-hidden="true"
          >
            <path d="m3.5 6 4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {/* Let status-area clicks reach the header toggle. Keep this wrapper
            unpositioned so the progress track anchors to the full header. */}
        <div className="pointer-events-none z-10 ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 px-4 py-2 sm:flex-1 sm:px-5">
          <div className="contents [&>*]:!order-none [&>*]:!m-0 [&>*]:!p-0 [&_button]:pointer-events-auto">
            {status}
          </div>
          <div className="pointer-events-auto border-l border-slate-200 pl-3">
            {downloadMenu}
          </div>
        </div>
      </div>

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
