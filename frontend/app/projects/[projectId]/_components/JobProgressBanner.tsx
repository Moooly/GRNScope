"use client";

import { useEffect, useState } from "react";

type JobTask = {
  algorithm_id: string;
  status: string;
  progress_percent?: number | null;
  progress_label?: string | null;
};

type AlgorithmMeta = {
  name?: string;
};

type JobProgressBannerProps = {
  tasks: JobTask[];
  algorithmMetaMap: Map<string, AlgorithmMeta>;
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
  notificationEmail = null,
  onSaveNotificationEmail,
}: JobProgressBannerProps) {
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState(notificationEmail ?? "");
  const [emailMessage, setEmailMessage] = useState("");
  const [isSavingEmail, setIsSavingEmail] = useState(false);

  useEffect(() => {
    if (!isEditingEmail) {
      setEmailDraft(notificationEmail ?? "");
    }
  }, [isEditingEmail, notificationEmail]);

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
    queued.length > 0 ? `${queued.length} queued` : null,
    stopped.length > 0 ? `${stopped.length} stopped` : null,
    failed.length > 0 ? `${failed.length} failed` : null,
  ].filter(Boolean);

  const hasNotificationEmail = Boolean(notificationEmail);

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
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white px-5 py-5 text-slate-900 shadow-sm sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[#1b75a6]"
            />
            <h2 className="text-lg font-bold text-slate-950">Analysis running</h2>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {statusSummary.join(" · ")}
          </p>
        </div>

        {onSaveNotificationEmail && (
          <div className="w-full lg:flex lg:max-w-[42rem] lg:flex-1 lg:justify-end">
            {!isEditingEmail ? (
              <button
                type="button"
                onClick={() => {
                  setEmailMessage("");
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

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[#1b75a6] transition-[width] duration-500 ease-out"
          style={{ width: `${overall}%` }}
        />
      </div>
    </section>
  );
}

function clampPercent(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}
