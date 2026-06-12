"use client";

import { useState } from "react";
import { formatAlgorithmRuntime } from "../_lib/runtime";

type JobTask = {
  algorithm_id: string;
  status: string;
  elapsed_seconds?: number | null;
  progress_percent?: number | null;
  progress_label?: string | null;
  estimated_remaining_seconds?: number | null;
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
 * Top-of-page progress strip shown while a job has Queued or Running tasks.
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

  // Overall percent blends finished tasks with the partial progress of any
  // currently-running tasks. Each finished task = 1 unit, each running task
  // contributes its progress_percent / 100.
  const runningProgress = running.reduce((sum, task) => {
    const pct = clampPercent(task.progress_percent);
    return sum + pct / 100;
  }, 0);
  const overall = total === 0 ? 0 : Math.round(((finished + runningProgress) / total) * 100);

  const statusSummary = [
    `${completed.length} completed`,
    `${running.length} running`,
    stopping.length > 0 ? `${stopping.length} stopping` : null,
    queued.length > 0 ? `${queued.length} waiting` : null,
    stopped.length > 0 ? `${stopped.length} stopped` : null,
    failed.length > 0 ? `${failed.length} failed` : null,
  ].filter(Boolean);

  const hasNotificationEmail = Boolean(notificationEmail);
  const getAlgorithmName = (algorithmId: string) =>
    algorithmMetaMap?.get(algorithmId)?.name ?? algorithmId;
  const runningItems = running.slice(0, 2).map((task) => {
    const algorithmName = getAlgorithmName(task.algorithm_id);
    const remainingSeconds = Number(task.estimated_remaining_seconds);

    if (Number.isFinite(remainingSeconds) && remainingSeconds > 0) {
      return {
        name: algorithmName,
        detail: `${formatAlgorithmRuntime(remainingSeconds)} left`,
      };
    }

    if (Number.isFinite(remainingSeconds) && remainingSeconds === 0) {
      return {
        name: algorithmName,
        detail: "finishing up",
      };
    }

    return {
      name: algorithmName,
      detail: "estimating time",
    };
  });
  const hiddenRunningCount = Math.max(0, running.length - runningItems.length);
  if (hiddenRunningCount > 0) {
    runningItems.push({
      name: `${hiddenRunningCount} more`,
      detail: "running",
    });
  }
  const queuedNames = queued.slice(0, 3).map((task) => getAlgorithmName(task.algorithm_id));
  const hiddenQueuedCount = Math.max(0, queued.length - queuedNames.length);
  const queuedMessage =
    queuedNames.length > 0
      ? `Waiting: ${formatNameList(queuedNames)}${
          hiddenQueuedCount > 0 ? `, plus ${hiddenQueuedCount} more` : ""
        }`
      : "";

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
    <section className="mt-8 rounded-[1.25rem] border border-slate-200 bg-white px-5 py-4 text-slate-900 shadow-sm sm:px-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span
              aria-hidden="true"
              className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[#1b75a6]"
            />
            <h2 className="text-lg font-bold text-slate-950">Analysis running</h2>
            <span className="hidden text-slate-300 sm:inline">·</span>
            <p className="text-sm font-semibold text-slate-500">
              {statusSummary.join(" · ")}
            </p>
          </div>
        </div>

        {onSaveNotificationEmail && (
          <div className="w-full lg:flex lg:max-w-[42rem] lg:flex-1 lg:justify-end">
            {!isEditingEmail ? (
              <button
                type="button"
                onClick={() => {
                  setEmailMessage("");
                  setEmailDraft(notificationEmail ?? "");
                  setIsEditingEmail(true);
                }}
                className="inline-flex h-10 max-w-full items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] lg:ml-auto"
              >
                <span className="truncate">
                  {hasNotificationEmail
                    ? `Will email ${notificationEmail}`
                    : "Email me when done"}
                </span>
              </button>
            ) : (
              <form
                className="flex w-full flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveNotificationEmail();
                }}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="email"
                    value={emailDraft}
                    onChange={(event) => setEmailDraft(event.target.value)}
                    placeholder="Email when analysis finishes"
                    className="grnscope-email-input h-10 min-w-0 flex-1 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
                  />
                  <button
                    type="submit"
                    disabled={isSavingEmail}
                    className="inline-flex h-10 min-w-18 items-center justify-center rounded-full bg-[#1b75a6] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#155f87] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSavingEmail ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingEmail(false);
                      setEmailDraft(notificationEmail ?? "");
                      setEmailMessage("");
                    }}
                    className="inline-flex h-10 items-center justify-center rounded-full px-3 text-sm font-bold text-slate-500 transition hover:text-slate-900"
                  >
                    Cancel
                  </button>
                </div>
                {emailMessage && (
                  <p
                    className={`px-2 text-xs font-semibold ${
                      emailMessage === "Saved." ? "text-[#178a62]" : "text-rose-600"
                    }`}
                  >
                    {emailMessage}
                  </p>
                )}
              </form>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[#1b75a6] transition-[width] duration-500 ease-out"
          style={{ width: `${overall}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-600">
        {runningItems.length > 0 ? (
          runningItems.map((item) => (
            <span
              key={item.name}
              className="inline-flex max-w-full items-center gap-2 rounded-full bg-[#f2f9fc] px-3 py-1.5 text-[#1b75a6]"
            >
              <span className="font-bold text-slate-900">{item.name}</span>
              <span className="text-xs font-bold text-slate-500">{item.detail}</span>
            </span>
          ))
        ) : null}
        {queuedMessage ? (
          <span className="inline-flex max-w-full items-center rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">
            {queuedMessage}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function clampPercent(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function formatNameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
