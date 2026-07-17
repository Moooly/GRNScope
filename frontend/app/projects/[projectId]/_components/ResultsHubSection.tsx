

"use client";

import type { ReactNode } from "react";

type ResultsHubSectionProps = {
  children: ReactNode;
};

export default function ResultsHubSection({
  children,
}: ResultsHubSectionProps) {
  return (
    <div className="mt-6 text-slate-900">
      <div className="min-w-0 space-y-5">{children}</div>
    </div>
  );
}
