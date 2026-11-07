"use client";

import type { MouseEvent } from "react";
import { formatAlgorithmRuntime, runtimeLabel, runtimeTitle } from "../_lib/runtime";
import { RESULT_SECTION_HEADING_CLASS } from "./sectionStyles";

type AlgorithmTask = {
  algorithm_id: string;
  status: string;
  elapsed_seconds?: number | null;
  error_message?: string | null;
  error_type?: string | null;
  progress_percent?: number | null;
  progress_label?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  latest_attempt_status?: string | null;
  latest_attempt_error_message?: string | null;
};

type AlgorithmMeta = {
  name?: string;
};

type AlgorithmErrorTask = {
  algorithmId: string;
  errorMessage: string;
  errorType?: string | null;
};

type AlgorithmCardsSectionProps = {
  tasks: AlgorithmTask[];
  algorithmMetaMap: Map<string, AlgorithmMeta>;
  onOpenAlgorithmError: (task: AlgorithmErrorTask, anchorElement: HTMLElement) => void;
  onStopAlgorithm: (task: { algorithmId: string; algorithmName: string }) => void;
  onRerunAlgorithm: (task: { algorithmId: string; algorithmName: string }) => void;
  compact?: boolean;
};

export default function AlgorithmCardsSection({
  tasks,
  algorithmMetaMap,
  onOpenAlgorithmError,
  onStopAlgorithm,
  onRerunAlgorithm,
  compact = false,
}: AlgorithmCardsSectionProps) {
  if (tasks.length === 0) return null;
  const nameOf = (task: AlgorithmTask) =>
    algorithmMetaMap.get(task.algorithm_id)?.name ?? task.algorithm_id;
  const sorted = [...tasks].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const hasWarning = (task: AlgorithmTask) =>
    task.status === "Completed" && task.latest_attempt_status === "Failed";
  const issues = sorted.filter((task) => task.status === "Failed" || hasWarning(task));
  const completed = sorted.filter((task) => task.status === "Completed" && !hasWarning(task));
  const remaining = sorted.filter((task) => task.status !== "Failed" && task.status !== "Completed");

  function renderTask(task: AlgorithmTask) {
    const name = nameOf(task);
    const warning = hasWarning(task);
    const failed = task.status === "Failed";
    const canStop = task.status === "Running" || task.status === "Queued";
    const actionTask = { algorithmId: task.algorithm_id, algorithmName: name };
    const elapsed = task.status === "Completed" || (failed && task.elapsed_seconds != null)
      ? formatAlgorithmRuntime(task.elapsed_seconds)
      : runtimeLabel(task.status, task.elapsed_seconds, task.progress_label);
    const duration = (
      <span
        className="ml-auto text-right text-xs font-medium tabular-nums text-slate-500"
        title={runtimeTitle({
          status: task.status,
          elapsedSeconds: task.elapsed_seconds,
          progressLabel: task.progress_label,
          startedAt: task.started_at,
          completedAt: task.completed_at,
        })}
      >
        {elapsed}
      </span>
    );

    if (failed || warning) {
      const message = warning ? task.latest_attempt_error_message : task.error_message;
      const showDetails = (event: MouseEvent<HTMLButtonElement>) =>
        onOpenAlgorithmError({
          algorithmId: task.algorithm_id,
          errorType: warning ? "rerun" : task.error_type,
          errorMessage: message?.replace(/\/Users\/[^ ]+/g, "server log file") ||
            (task.error_type === "matrix_validation"
              ? "GRNScope found a problem in the uploaded matrix while preparing the project."
              : "This algorithm failed. The server did not return a detailed message."),
        }, event.currentTarget);

      return (
        <li key={task.algorithm_id} className={`rounded-r-lg border-l-2 px-3 py-2.5 ${warning ? "border-amber-400 bg-amber-50/60" : "border-rose-300 bg-rose-50/60"}`}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold text-slate-900">{name}</span>
            <span className={warning ? "text-xs text-amber-800" : "text-xs text-rose-700"}>
              {warning ? "Last attempt failed · Previous result retained" : "Failed"}
            </span>
            {duration}
          </div>
          <button type="button" onClick={showDetails} className="mt-1 rounded-sm py-1 text-xs font-semibold text-slate-600 hover:text-[#1b75a6] hover:underline">
            {warning ? "Warning details" : "Error details"}
          </button>
        </li>
      );
    }

    return (
      <li key={task.algorithm_id} className="flex min-w-0 items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
        {task.status !== "Completed" && (
          <StatusGlyph
            status={task.status}
            onClick={canStop ? () => onStopAlgorithm(actionTask) :
              task.status === "Stopped" ? () => onRerunAlgorithm(actionTask) : undefined}
          />
        )}
        <span className="min-w-0 truncate font-medium text-slate-800" title={name}>{name}</span>
        {duration}
      </li>
    );
  }

  const listClass = "mt-3 grid gap-2 text-sm [grid-template-columns:repeat(auto-fill,minmax(min(100%,13rem),1fr))]";
  return (
    <section className={compact ? "py-5 text-slate-900" : "text-slate-900"}>
      <h2 className={compact ? "text-lg font-bold tracking-tight text-slate-950" : RESULT_SECTION_HEADING_CLASS}>
        Algorithms and runtime
      </h2>
      {issues.length > 0 && <ul className="mt-3 space-y-2 text-sm">{issues.map(renderTask)}</ul>}
      {remaining.length > 0 && <ul className={listClass}>{remaining.map(renderTask)}</ul>}
      {completed.length > 0 && (
        <>
          {completed.length < tasks.length && (
            <h3 className="mt-4 text-xs font-semibold text-slate-500">Completed methods</h3>
          )}
          <ul className={listClass}>{completed.map(renderTask)}</ul>
        </>
      )}
    </section>
  );
}

function StatusGlyph({
  status,
  onClick,
}: {
  status: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  if (status === "Stopped") {
    return (
      <button
        type="button"
        aria-label="Run algorithm again"
        title="Run again"
        onClick={onClick}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
          <path
            d="M12.6 5.1A5 5 0 1 0 13 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M12.7 2.7v2.7h-2.7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  }

  if (status === "NotStarted") {
    return (
      <span
        aria-label="Not started"
        title="Not started"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
      </span>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        aria-label="Stop algorithm"
        title="Stop algorithm"
        onClick={onClick}
        className="group/stop relative inline-flex h-6 w-6 shrink-0 items-center justify-center text-[#1b75a6] transition hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 focus-visible:ring-offset-2"
      >
        <span className="absolute h-5 w-5 animate-spin rounded-full border-2 border-current/20 border-t-current" />
        <span className="h-1.5 w-1.5 rounded-[2px] bg-current transition group-hover/stop:scale-110" />
      </button>
    );
  }

  return (
    <span
      aria-label={status}
      title={status}
      className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-slate-400"
    />
  );
}
