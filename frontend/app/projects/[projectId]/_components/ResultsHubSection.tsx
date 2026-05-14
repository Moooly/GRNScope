

"use client";

import type { ReactNode } from "react";

type ResultsHubSectionProps = {
  controls: ReactNode;
  children: ReactNode;
};

export default function ResultsHubSection({ controls, children }: ResultsHubSectionProps) {
  return (
    <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white/95 p-6 text-slate-900 shadow-sm">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-slate-950">Results hub</h2>
          {controls}
        </div>

        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </div>
  );
}
