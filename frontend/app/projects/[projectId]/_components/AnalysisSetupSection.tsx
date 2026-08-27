"use client";

import { useId, useState, type ReactNode } from "react";

type AnalysisSetupSectionProps = {
  status?: ReactNode;
  autoExpand?: boolean;
  onDownloadRunManifests?: () => void;
  runManifestDownloadDisabled?: boolean;
  children: ReactNode;
};

export default function AnalysisSetupSection({
  status,
  autoExpand = false,
  onDownloadRunManifests,
  runManifestDownloadDisabled = false,
  children,
}: AnalysisSetupSectionProps) {
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const contentId = useId();
  const isOpen = openOverride ?? autoExpand;
  const toggleOpen = () => setOpenOverride(!isOpen);

  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-[0_6px_18px_rgba(15,23,42,0.025)]">
      <div className="group/analysis-bar relative flex min-h-[64px] flex-wrap items-center gap-x-4 transition hover:bg-slate-50/60">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={isOpen}
          aria-controls={contentId}
          aria-label={isOpen ? "Collapse analysis details" : "Expand analysis details"}
          className="absolute inset-0 z-0 cursor-pointer rounded-2xl focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#1b75a6]/10"
        >
          <span className="sr-only">
            {isOpen ? "Collapse analysis details" : "Expand analysis details"}
          </span>
        </button>

        <div className="pointer-events-none relative z-10 flex min-w-fit items-center self-stretch gap-2 px-5 py-3.5 text-left sm:px-6">
          <span className="flex items-center gap-2.5 text-[0.95rem] font-bold tracking-tight text-slate-950">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#eef7fb] text-[#1b75a6]" aria-hidden="true">
              <svg viewBox="0 0 18 18" className="h-4 w-4" fill="none">
                <path d="M4 13.5V9m5 4.5v-9m5 9V7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            Analysis details
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

        {onDownloadRunManifests ? (
          <div className="relative z-10 order-3 ml-auto flex min-w-0 flex-1 items-center justify-end self-stretch lg:order-none">
            <div className="contents [&>*]:!order-none [&>*]:!ml-0 [&>*]:!px-0 [&>*]:pointer-events-none [&_button]:pointer-events-auto [&_form]:pointer-events-auto [&_input]:pointer-events-auto [&_select]:pointer-events-auto [&_textarea]:pointer-events-auto">
              {status}
            </div>

            <span className="mx-4 h-6 w-px shrink-0 bg-slate-200" aria-hidden="true" />

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDownloadRunManifests();
              }}
              disabled={runManifestDownloadDisabled}
              aria-label="Download analysis package"
              title={
                runManifestDownloadDisabled
                  ? "The analysis package is available after an algorithm run finishes"
                  : "Download analysis package"
              }
              className="relative z-20 mr-5 inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-2 text-sm font-bold text-slate-600 transition hover:bg-[#eef7fb] hover:text-[#1b75a6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1b75a6]/25 sm:mr-6 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
            >
              <svg viewBox="0 0 18 18" className="h-4 w-4" fill="none" aria-hidden="true">
                <path
                  d="M9 2.75v8m0 0L6.25 8M9 10.75 11.75 8M3.5 14.75h11"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Download
            </button>
          </div>
        ) : (
          <div className="contents [&>*]:z-10 [&>*]:pointer-events-none [&_button]:pointer-events-auto [&_form]:pointer-events-auto [&_input]:pointer-events-auto [&_select]:pointer-events-auto [&_textarea]:pointer-events-auto">
            {status}
          </div>
        )}
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
