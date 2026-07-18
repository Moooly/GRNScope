"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Project } from "../_types/project";
import { formatProjectCreatedAt } from "../_lib/time";

interface ProjectCardProps {
  project: Project;
  onRename?: (project: Project) => void;
  onDelete?: (project: Project) => void;
  variant?: "default" | "home";
}

export default function ProjectCard({
  project,
  onRename,
  onDelete,
  variant = "default",
}: ProjectCardProps) {
  const hasActions = Boolean(onRename || onDelete);
  const isHomeCard = variant === "home";
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  const createdAtLabel = formatProjectCreatedAt(
    project.createdAtTimestamp,
    project.createdAt,
  );
  const status = getProjectStatus(project);
  const tasks = project.latestJob?.tasks ?? [];
  const completedCount = tasks.filter((task) => task.status === "Completed").length;
  const algorithmSummary = tasks.length > 0 ? `${completedCount}/${tasks.length}` : "-";
  const geneSummary =
    typeof project.geneCount === "number" ? project.geneCount.toLocaleString() : "-";
  const cellSummary =
    typeof project.cellCount === "number" ? project.cellCount.toLocaleString() : "-";

  return (
    <article className="group relative flex h-[9.75rem] flex-col rounded-[1.1rem] border border-slate-200 bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:border-[#1b75a6]/25 hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
      <Link
        href={`/projects/${project.id}`}
        aria-label={`Open ${project.name}`}
        className="absolute inset-0 z-10 rounded-[1.1rem] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1b75a6]/20"
      />

      <div className="pointer-events-none relative z-20 flex flex-1 flex-col">
        <div className="flex items-start gap-2">
          <h3 className={`min-w-0 flex-1 truncate leading-6 tracking-tight text-slate-950 ${
            isHomeCard ? "text-base font-semibold" : "text-lg font-bold"
          }`}>
            {project.name}
          </h3>
          {hasActions ? (
            <div ref={menuRef} className="pointer-events-auto relative z-30 shrink-0">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsMenuOpen((current) => !current);
                }}
                aria-haspopup="menu"
                aria-expanded={isMenuOpen}
                aria-label="Project actions"
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1b75a6]/15 ${
                  isMenuOpen
                    ? "bg-slate-100 text-slate-700"
                    : "text-slate-300 hover:bg-slate-100 hover:text-slate-700"
                }`}
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <circle cx="4.5" cy="10" r="1.4" />
                  <circle cx="10" cy="10" r="1.4" />
                  <circle cx="15.5" cy="10" r="1.4" />
                </svg>
              </button>

              {isMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/15"
                >
                  {onRename ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setIsMenuOpen(false);
                        onRename(project);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                    >
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                        <path d="M13.2 3.8 15.5 6.1M4 16h2.4l8.4-8.4-2.4-2.4L4 13.6V16Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Rename
                    </button>
                  ) : null}
                  {onDelete ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setIsMenuOpen(false);
                        onDelete(project);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                    >
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                        <path d="M4.5 6h11m-9 0V4.5A1.5 1.5 0 0 1 8 3h4a1.5 1.5 0 0 1 1.5 1.5V6m-7 0v9.5A1.5 1.5 0 0 0 8 17h4a1.5 1.5 0 0 0 1.5-1.5V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Delete
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </div>
        <p className={`mt-1.5 flex min-w-0 items-center gap-2 truncate text-xs text-slate-500 ${
          isHomeCard ? "font-medium" : "font-semibold"
        }`}>
          <span className={`inline-flex shrink-0 items-center gap-1.5 ${status.textClassName}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName}`} aria-hidden="true" />
            {status.label}
          </span>
          <span className="text-slate-300">·</span>
          <span className="truncate">Created {createdAtLabel}</span>
        </p>

        <div className="mt-auto grid grid-cols-[0.8fr_0.8fr_1.4fr] gap-3 border-t border-slate-100 pt-3">
          <div>
            <p className={`text-[0.65rem] uppercase text-slate-400 ${
              isHomeCard ? "font-semibold tracking-[0.1em]" : "font-bold tracking-[0.12em]"
            }`}>
              Genes
            </p>
            <p className={`mt-1 text-sm text-slate-800 ${isHomeCard ? "font-semibold" : "font-bold"}`}>
              {geneSummary}
            </p>
          </div>
          <div>
            <p className={`text-[0.65rem] uppercase text-slate-400 ${
              isHomeCard ? "font-semibold tracking-[0.1em]" : "font-bold tracking-[0.12em]"
            }`}>
              Cells
            </p>
            <p className={`mt-1 text-sm text-slate-800 ${isHomeCard ? "font-semibold" : "font-bold"}`}>
              {cellSummary}
            </p>
          </div>
          <div>
            <p className={`text-[0.65rem] uppercase text-slate-400 ${
              isHomeCard ? "font-semibold tracking-[0.1em]" : "font-bold tracking-[0.12em]"
            }`}>
              Algorithms
            </p>
            <p className={`mt-1 text-sm text-slate-800 ${isHomeCard ? "font-semibold" : "font-bold"}`}>
              {algorithmSummary}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

export type ProjectStatusKey =
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "attention"
  | "none";

export function getProjectStatusKey(project: Project): ProjectStatusKey {
  const latestJob = project.latestJob;
  if (!latestJob) return "none";
  const tasks = latestJob.tasks ?? [];
  if (latestJob.overall_status === "SetupFailed" || latestJob.setup_error_message) {
    return "attention";
  }
  const hasRunning = tasks.some((task) => task.status === "Running");
  const hasQueued = tasks.some((task) => task.status === "Queued");
  const hasCompleted = tasks.some((task) => task.status === "Completed");
  const hasFailed = tasks.some((task) => task.status === "Failed");
  if (hasRunning || hasQueued || latestJob.overall_status === "Running") return "running";
  if (hasCompleted && hasFailed) return "partial";
  if (hasFailed || latestJob.overall_status === "Failed") return "failed";
  if (hasCompleted || latestJob.overall_status === "Completed") return "completed";
  return "none";
}

function getProjectStatus(project: Project) {
  const latestJob = project.latestJob;
  if (!latestJob) {
    return {
      label: "No run",
      textClassName: "text-slate-500",
      dotClassName: "bg-slate-300",
    };
  }

  const tasks = latestJob.tasks ?? [];
  if (latestJob.overall_status === "SetupFailed" || latestJob.setup_error_message) {
    return {
      label: "Setup issue",
      textClassName: "text-amber-700",
      dotClassName: "bg-amber-500",
    };
  }
  const hasRunning = tasks.some((task) => task.status === "Running");
  const hasQueued = tasks.some((task) => task.status === "Queued");
  const hasCompleted = tasks.some((task) => task.status === "Completed");
  const hasFailed = tasks.some((task) => task.status === "Failed");

  if (hasRunning || hasQueued || latestJob.overall_status === "Running") {
    return {
      label: "Running",
      textClassName: "text-sky-700",
      dotClassName: "bg-sky-500",
    };
  }
  if (hasCompleted && hasFailed) {
    return {
      label: "Partial",
      textClassName: "text-violet-700",
      dotClassName: "bg-violet-500",
    };
  }
  if (hasFailed || latestJob.overall_status === "Failed") {
    return {
      label: "Failed",
      textClassName: "text-rose-600",
      dotClassName: "bg-rose-500",
    };
  }
  if (hasCompleted || latestJob.overall_status === "Completed") {
    return {
      label: "Completed",
      textClassName: "text-[#178a62]",
      dotClassName: "bg-[#20b779]",
    };
  }
  return {
    label: latestJob.overall_status || "Queued",
    textClassName: "text-amber-700",
    dotClassName: "bg-amber-500",
  };
}
