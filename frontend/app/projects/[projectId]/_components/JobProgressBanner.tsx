"use client";

import { useState } from "react";
type JobTask = {
  algorithm_id: string;
  status: string;
  elapsed_seconds?: number | null;
  progress_percent?: number | null;
  progress_label?: string | null;
  estimated_remaining_seconds?: number | null;
  estimated_remaining_min_seconds?: number | null;
  estimated_remaining_max_seconds?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
};

type JobProgressBannerProps = {
  tasks: JobTask[];
  algorithmMetaMap?: Map<string, { name: string }>;
  notificationEmail?: string | null;
  onSaveNotificationEmail?: (email: string) => Promise<boolean>;
  onStopProject?: () => void;
};

/**
 * Compact status shown inside the Analysis bar.
 */
export default function JobProgressBanner({
  tasks,
  algorithmMetaMap,
  notificationEmail = null,
  onSaveNotificationEmail,
  onStopProject,
}: JobProgressBannerProps) {
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState(notificationEmail ?? "");
  const [emailMessage, setEmailMessage] = useState("");
  const [isSavingEmail, setIsSavingEmail] = useState(false);

  if (tasks.length === 0) return null;

  const queued = tasks.filter((task) => task.status === "Queued");
  const running = tasks.filter((task) => task.status === "Running");
  const stopping = tasks.filter((task) => task.status === "Stopping");
  const completed = tasks.filter((task) => task.status === "Completed");
  const failed = tasks.filter((task) => task.status === "Failed");
  const stopped = tasks.filter((task) => task.status === "Stopped");

  const hasActiveWork = queued.length > 0 || running.length > 0 || stopping.length > 0;
  const total = tasks.length;
  const finished = completed.length + failed.length + stopped.length;
  const hasStarted = tasks.some((task) => task.status !== "NotStarted");

  if (!hasActiveWork) {
    const hasIssues = failed.length > 0 || stopped.length > 0;
    const statusTitle = !hasStarted
      ? "Ready"
      : hasIssues
        ? "Completed with issues"
        : "Complete";

    return (
      <div
        className="order-3 ml-auto flex min-w-0 items-center justify-end gap-2.5 px-5 py-3 sm:px-6 lg:order-none lg:py-2"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            hasIssues ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"
          }`}
        >
          {hasIssues ? (
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
              <path d="M8 4.4v4.1m0 2.5v.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.35" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
              <path d="m4.2 8.2 2.4 2.4 5.2-5.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <p className="truncate text-sm font-bold text-slate-800">{statusTitle}</p>
      </div>
    );
  }

  const isWaitingForUpload =
    running.length === 0 &&
    stopping.length === 0 &&
    queued.length > 0 &&
    queued.every(
      (task) => task.progress_label?.trim().toLowerCase() === "waiting for dataset upload",
    );

  // Overall percent blends finished tasks with the partial progress of any
  // currently-running tasks. Each finished task = 1 unit, each running task
  // contributes its progress_percent / 100.
  const runningProgress = running.reduce((sum, task) => {
    const pct = clampPercent(task.progress_percent);
    return sum + pct / 100;
  }, 0);
  const overall = total === 0 ? 0 : Math.round(((finished + runningProgress) / total) * 100);

  const completionSummary = [
    total > 1 ? `${completed.length} of ${total} methods complete` : null,
    failed.length > 0 ? `${failed.length} failed` : null,
    stopped.length > 0 ? `${stopped.length} stopped` : null,
  ].filter(Boolean);

  const hasNotificationEmail = Boolean(notificationEmail);
  const getAlgorithmName = (algorithmId: string) =>
    algorithmMetaMap?.get(algorithmId)?.name ?? algorithmId;
  const runningItems = running.map((task) => {
    const algorithmName = getAlgorithmName(task.algorithm_id);
    const rawMinimumRemainingSeconds = task.estimated_remaining_min_seconds;
    const rawMaximumRemainingSeconds = task.estimated_remaining_max_seconds;
    const minimumRemainingSeconds = Number(rawMinimumRemainingSeconds);
    const maximumRemainingSeconds = Number(rawMaximumRemainingSeconds);
    const hasRemainingRange =
      rawMinimumRemainingSeconds != null &&
      rawMaximumRemainingSeconds != null &&
      Number.isFinite(minimumRemainingSeconds) &&
      Number.isFinite(maximumRemainingSeconds) &&
      minimumRemainingSeconds >= 0 &&
      maximumRemainingSeconds >= minimumRemainingSeconds;

    if (hasRemainingRange && maximumRemainingSeconds > 0) {
      return {
        name: algorithmName,
        detail: `Estimated time remaining: ${formatRemainingRange(
          minimumRemainingSeconds,
          maximumRemainingSeconds,
        )}`,
        remainingSeconds: maximumRemainingSeconds,
      };
    }

    if (hasRemainingRange && maximumRemainingSeconds === 0) {
      return {
        name: algorithmName,
        detail: "Finishing up",
        remainingSeconds: 0,
      };
    }

    return {
      name: algorithmName,
      detail: "Estimating time remaining",
      remainingSeconds: null,
    };
  });
  const primaryRunningItem = runningItems[0];
  const activeWorkSummary = primaryRunningItem
    ? `Running ${primaryRunningItem.name}${
        runningItems.length > 1 ? ` + ${runningItems.length - 1} more` : ""
      }`
    : isWaitingForUpload
      ? "Waiting for dataset upload"
      : stopping.length > 0
        ? `${stopping.length} ${stopping.length === 1 ? "method" : "methods"} stopping`
        : `${queued.length} ${queued.length === 1 ? "method" : "methods"} waiting`;
  const timingSummary =
    primaryRunningItem?.detail === "Estimating time remaining"
      ? null
      : primaryRunningItem?.detail ?? null;
  const waitingSummary =
    running.length > 0 && queued.length > 0
      ? `${queued.length} ${queued.length === 1 ? "method" : "methods"} waiting`
      : null;

  const saveNotificationEmail = async () => {
    if (!onSaveNotificationEmail || isSavingEmail) return;

    const trimmedEmail = emailDraft.trim();
    if (!trimmedEmail) {
      setEmailMessage("Enter an email address first.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailMessage("Enter a valid email address.");
      return;
    }

    setIsSavingEmail(true);
    setEmailMessage("");

    const ok = await onSaveNotificationEmail(trimmedEmail);
    setIsSavingEmail(false);

    if (!ok) {
      setEmailMessage("Could not save email. Please try again.");
      return;
    }

    setEmailMessage("Saved.");
    setIsEditingEmail(false);
  };

  return (
    <div
      className="order-3 ml-auto flex min-w-0 flex-1 items-center justify-end gap-3 px-5 py-3 sm:px-6 lg:order-none lg:py-2"
      aria-live="polite"
    >
      {!isEditingEmail ? (
        <>
          <span aria-hidden="true" className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#eef7fb]">
            <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-[#1b75a6]/25" />
            <span className="h-2 w-2 rounded-full bg-[#1b75a6]" />
          </span>
          <p className="mr-2 min-w-0 truncate text-sm font-semibold text-slate-700 sm:mr-5">
            <span className="font-bold text-slate-900">{activeWorkSummary}</span>
              <span className="hidden">
                {completionSummary.length > 0 ? (
                  <>
                    <span className="text-slate-300"> · </span>
                    <span>{completionSummary.join(" · ")}</span>
                  </>
                ) : null}
                {timingSummary ? ` · ${timingSummary}` : ""}
                {waitingSummary ? ` · ${waitingSummary}` : ""}
              </span>
          </p>

          {/* <span className="hidden shrink-0 rounded-full bg-[#eef7fb] px-2.5 py-1 text-xs font-bold tabular-nums text-[#1b75a6] sm:inline-flex">
            {overall}%
          </span> */}

          {onSaveNotificationEmail ? (
            <button
              type="button"
              onClick={() => {
                setEmailMessage("");
                setEmailDraft(notificationEmail ?? "");
                setIsEditingEmail(true);
              }}
              aria-label={
                hasNotificationEmail
                  ? `Completion email set to ${notificationEmail}`
                  : "Email me when analysis is done"
              }
              title={
                hasNotificationEmail
                  ? `Completion email: ${notificationEmail}`
                  : "Email me when done"
              }
              className={`relative inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full border px-3 text-xs font-bold transition ${
                hasNotificationEmail
                  ? "border-[#1b75a6]/25 bg-[#eaf5fb] text-[#1b75a6]"
                  : "border-slate-200 bg-white text-slate-500 hover:border-[#1b75a6]/30 hover:text-[#1b75a6]"
              }`}
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
                <path d="M3.5 5.5h13v9h-13z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="m4.2 6.2 5.8 4.2 5.8-4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="hidden sm:inline">{hasNotificationEmail ? "Email set" : "Notify me"}</span>
              {hasNotificationEmail ? (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#20b779]" />
              ) : null}
            </button>
          ) : null}

          {onStopProject ? (
            <button
              type="button"
              onClick={onStopProject}
              aria-label="Stop project"
              title="Stop all running algorithms"
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-700 transition hover:border-amber-300 hover:bg-amber-100"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                <rect x="4.5" y="4.5" width="7" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <span className="hidden sm:inline">Stop</span>
            </button>
          ) : null}
        </>
      ) : (
        <form
          className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveNotificationEmail();
          }}
        >
          <input
            type="email"
            value={emailDraft}
            onChange={(event) => setEmailDraft(event.target.value)}
            placeholder="Email when finished"
            aria-label="Completion notification email"
            className="grnscope-email-input h-9 min-w-[12rem] flex-1 rounded-full border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
          />
          <button
            type="submit"
            disabled={isSavingEmail}
            className="inline-flex h-9 items-center justify-center rounded-full bg-[#1b75a6] px-3.5 text-xs font-bold text-white transition hover:bg-[#155f87] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingEmail ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsEditingEmail(false);
              setEmailDraft(notificationEmail ?? "");
              setEmailMessage("");
            }}
            aria-label="Cancel email notification editing"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
              <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          {emailMessage ? (
            <p className="w-full text-right text-xs font-semibold text-rose-600">
              {emailMessage}
            </p>
          ) : null}
        </form>
      )}

      <div
        className="absolute inset-x-0 bottom-0 h-[3px] bg-[#e7f0f5]"
        role="progressbar"
        aria-label="Overall analysis progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={overall}
      >
        <div
          className="h-full rounded-r-full bg-[#1b75a6] transition-[width] duration-500 ease-out"
          style={{ width: `${overall}%` }}
        />
      </div>
    </div>
  );
}

function clampPercent(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function formatRemainingRange(minimumSeconds: number, maximumSeconds: number): string {
  const minimumMinutes = Math.max(1, Math.ceil(minimumSeconds / 60));
  const maximumMinutes = Math.max(minimumMinutes, Math.ceil(maximumSeconds / 60));
  if (minimumMinutes === maximumMinutes) {
    return `about ${maximumMinutes} ${maximumMinutes === 1 ? "minute" : "minutes"}`;
  }
  return `${minimumMinutes}–${maximumMinutes} minutes`;
}
