

"use client";

import type { ReactNode } from "react";

type ResultsHubSectionProps = {
  controls: ReactNode;
  children: ReactNode;
};

export default function ResultsHubSection({ controls, children }: ResultsHubSectionProps) {
  return (
    <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white/95 p-6 text-slate-900 shadow-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-4">
        <h2 className="text-xl font-bold text-slate-950">Results hub</h2>
        <div className="sticky top-[calc(var(--grnscope-header-height)+12px)] z-50 justify-self-end self-start">
          {controls}
        </div>

        <div className="col-span-full min-w-0 space-y-5">{children}</div>
      </div>
    </div>
  );
}
