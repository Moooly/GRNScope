

"use client";

import type { ReactNode } from "react";

type ResultsHubSectionProps = {
  controls: ReactNode;
  navigation?: ReactNode;
  children: ReactNode;
};

export default function ResultsHubSection({
  controls,
  navigation,
  children,
}: ResultsHubSectionProps) {
  return (
    <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white/95 p-6 text-slate-900">
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h2 className="sr-only">Results hub</h2>
          {navigation}
        </div>
        <div className="sticky top-[calc(var(--grnscope-header-height)+12px)] z-50 w-full self-start lg:w-auto lg:justify-self-end">
          {controls}
        </div>

        <div className="col-span-full min-w-0 space-y-5 pt-3">{children}</div>
      </div>
    </div>
  );
}
