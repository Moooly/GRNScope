import type { MatrixValidationIssue } from "../_lib/types";

type DatasetValidationStatusProps = {
  message: string;
  issues?: MatrixValidationIssue[];
};

export default function DatasetValidationStatus({
  message,
  issues = [],
}: DatasetValidationStatusProps) {
  const issueCount = issues.reduce(
    (total, issue) => total + Math.max(1, Number(issue.count) || 1),
    0,
  );
  const summary = issueCount > 1 ? `${issueCount} affected locations` : message;

  return (
    <div
      className="order-3 ml-auto flex min-w-0 flex-1 items-center justify-end gap-2.5 px-5 py-3 sm:px-6 lg:order-none lg:py-2"
      role="alert"
    >
      <span
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-500"
        aria-hidden="true"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
          <path d="M8 4.4v4.1m0 2.5v.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.35" />
        </svg>
      </span>
      <p className="min-w-0 truncate text-sm font-semibold text-slate-600" title={summary}>
        <span className="font-bold text-slate-900">Matrix needs attention</span>
        <span className="text-slate-300"> · </span>
        {summary}
      </p>
    </div>
  );
}
