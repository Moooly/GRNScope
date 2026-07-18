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
};

/**
 * Compact live status shown inside the Analysis setup bar.
 * Hides itself entirely once every task has reached a terminal state
 * (Completed, Failed, or anything else non-Queued/non-Running).
 */
export default function JobProgressBanner({
  tasks,
  algorithmMetaMap,
  notificationEmail = null,
  onSaveNotificationEmail,
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
  if (!hasActiveWork) return null;

  const total = tasks.length;
  const finished = completed.length + failed.length + stopped.length;
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
    `${completed.length} of ${total} methods complete`,
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
  const runningSummary = primaryRunningItem
    ? `Running ${primaryRunningItem.name}${
        runningItems.length > 1 ? ` + ${runningItems.length - 1} more` : ""
      } · ${primaryRunningItem.detail}`
    : isWaitingForUpload
      ? "Waiting for dataset upload"
      : stopping.length > 0
        ? `${stopping.length} ${stopping.length === 1 ? "method" : "methods"} stopping`
        : `${queued.length} ${queued.length === 1 ? "method" : "methods"} waiting`;
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
      className="order-3 flex w-full min-w-0 items-center gap-3 border-t border-slate-100 px-5 py-3 sm:px-6 lg:order-none lg:w-auto lg:max-w-[42rem] lg:flex-1 lg:border-t-0 lg:px-2 lg:py-0"
      aria-live="polite"
    >
      {!isEditingEmail ? (
        <>
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#1b75a6]"
          />
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-900">
              <span className="shrink-0">
                {isWaitingForUpload ? "Uploading dataset" : "Analysis running"}
              </span>
              <span className="text-slate-300">·</span>
              <span className="truncate font-semibold text-slate-500">
                {completionSummary.join(" · ")}
              </span>
            </p>
            <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">
              <span className="text-slate-600">{runningSummary}</span>
              {waitingSummary ? ` · ${waitingSummary}` : ""}
            </p>
          </div>

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
              className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
                hasNotificationEmail
                  ? "border-[#1b75a6]/25 bg-[#eaf5fb] text-[#1b75a6]"
                  : "border-slate-200 bg-white text-slate-500 hover:border-[#1b75a6]/30 hover:text-[#1b75a6]"
              }`}
            >
              <svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
                <path d="M10 6.2v4.1l2.7 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {hasNotificationEmail ? (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#20b779]" />
              ) : null}
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

      <div className="absolute inset-x-0 bottom-0 h-1 bg-slate-100" aria-hidden="true">
        <div
          className="h-full bg-[#1b75a6] transition-[width] duration-500 ease-out"
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
