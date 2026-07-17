"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "./_lib/apiConfig";
import { apiFetch } from "./_lib/clientIdentity";
import { formatProjectCreatedAt } from "./projects/_lib/time";
import { Project, ProjectJob } from "./projects/_types/project";

const CreateProjectFlow = dynamic(() => import("./projects/_components/CreateProjectFlow"), {
  ssr: false,
  loading: () => null,
});

export default function HomePage() {
  const [projectHistory, setProjectHistory] = useState<Project[]>([]);
  const [isProjectHistoryLoading, setIsProjectHistoryLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [canScrollProjectHistoryRight, setCanScrollProjectHistoryRight] = useState(false);
  const metadataRequestIds = useRef<Set<string>>(new Set());
  const projectHistoryRowRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  const visibleProjectHistory = useMemo(
    () => projectHistory.filter((project) => project.id !== "demo"),
    [projectHistory],
  );

  useEffect(() => {
    let isCancelled = false;

    const loadProjectHistory = async () => {
      setIsProjectHistoryLoading(true);
      try {
        const response = await apiFetch(`${API_BASE}/projects`);
        if (!response.ok) {
          if (!isCancelled) setProjectHistory([]);
          return;
        }

        const data = await response.json();
        if (isCancelled) return;

        if (data.ok && Array.isArray(data.projects)) {
          setProjectHistory(data.projects.map(normalizeProjectDimensions) as Project[]);
        } else {
          setProjectHistory([]);
        }
      } catch {
        if (!isCancelled) setProjectHistory([]);
      } finally {
        if (!isCancelled) setIsProjectHistoryLoading(false);
      }
    };

    loadProjectHistory();
    return () => {
      isCancelled = true;
    };
  }, []);

  const activeProjectIds = useMemo(
    () =>
      visibleProjectHistory
        .filter((project) => {
          const latestJob = project.latestJob;
          if (!latestJob) return false;
          const hasActiveTasks = latestJob.tasks?.some(
            (task) => task.status === "Queued" || task.status === "Running",
          );
          return (
            latestJob.overall_status === "Queued" ||
            latestJob.overall_status === "Running" ||
            Boolean(hasActiveTasks)
          );
        })
        .map((project) => project.id),
    [visibleProjectHistory],
  );

  useEffect(() => {
    if (activeProjectIds.length === 0) return;

    let isCancelled = false;

    const updateProjectStatuses = async () => {
      try {
        const responses = await Promise.all(
          activeProjectIds.map(async (projectId) => {
            try {
              const response = await apiFetch(`${API_BASE}/projects/${projectId}`);
              if (!response.ok) return null;
              const data = await response.json();
              return {
                projectId,
                geneCount: readOptionalDimension(data.project ?? {}, "gene"),
                cellCount: readOptionalDimension(data.project ?? {}, "cell"),
                latestJob: (data.latest_job ?? null) as ProjectJob | null,
              };
            } catch {
              return null;
            }
          }),
        );

        if (isCancelled) return;

        const latestJobMap = new Map(
          responses
            .filter(
              (item): item is {
                projectId: string;
                geneCount: number | null;
                cellCount: number | null;
                latestJob: ProjectJob | null;
              } =>
                item !== null,
            )
            .map((item) => [item.projectId, item]),
        );

        setProjectHistory((currentProjects) =>
          currentProjects.map((project) => {
            if (!latestJobMap.has(project.id)) return project;
            const projectUpdate = latestJobMap.get(project.id);
            return {
              ...project,
              geneCount: projectUpdate?.geneCount ?? project.geneCount,
              cellCount: projectUpdate?.cellCount ?? project.cellCount,
              latestJob: projectUpdate?.latestJob ?? null,
            };
          }),
        );
      } catch {
        return;
      }
    };

    updateProjectStatuses();
    const intervalId = window.setInterval(updateProjectStatuses, 5000);
    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeProjectIds]);

  const projectsMissingDimensions = useMemo(
    () =>
      visibleProjectHistory
        .filter(
          (project) =>
            project.geneCount === undefined ||
            project.geneCount === null ||
            project.cellCount === undefined ||
            project.cellCount === null,
        )
        .map((project) => project.id),
    [visibleProjectHistory],
  );

  useEffect(() => {
    const projectIds = projectsMissingDimensions.filter(
      (projectId) => !metadataRequestIds.current.has(projectId),
    );
    if (projectIds.length === 0) return;

    let isCancelled = false;
    projectIds.forEach((projectId) => metadataRequestIds.current.add(projectId));

    const loadProjectDimensions = async () => {
      const responses = await Promise.all(
        projectIds.map(async (projectId) => {
          try {
            const response = await apiFetch(`${API_BASE}/projects/${projectId}/metadata`);
            if (!response.ok) {
              metadataRequestIds.current.delete(projectId);
              return null;
            }
            const data = await response.json();
            const metadata = data.metadata ?? {};
            const geneCount = readOptionalDimension(metadata, "gene");
            const cellCount = readOptionalDimension(metadata, "cell");
            if (geneCount === null || cellCount === null) {
              metadataRequestIds.current.delete(projectId);
            }
            return {
              projectId,
              geneCount,
              cellCount,
            };
          } catch {
            metadataRequestIds.current.delete(projectId);
            return null;
          }
        }),
      );

      if (isCancelled) return;

      const dimensionsByProjectId = new Map(
        responses
          .filter(
            (
              item,
            ): item is {
              projectId: string;
              geneCount: number | null;
              cellCount: number | null;
            } => item !== null,
          )
          .map((item) => [item.projectId, item]),
      );

      if (dimensionsByProjectId.size === 0) return;

      setProjectHistory((currentProjects) =>
        currentProjects.map((project) => {
          const dimensions = dimensionsByProjectId.get(project.id);
          if (!dimensions) return project;
          return {
            ...project,
            geneCount: dimensions.geneCount ?? project.geneCount,
            cellCount: dimensions.cellCount ?? project.cellCount,
          };
        }),
      );
    };

    void loadProjectDimensions();
    return () => {
      isCancelled = true;
    };
  }, [projectsMissingDimensions]);

  const handleProjectCreated = (project: Project) => {
    setProjectHistory((currentProjects) => [project, ...currentProjects]);
    router.push(`/projects/${project.id}`);
  };

  useEffect(() => {
    const row = projectHistoryRowRef.current;
    if (!row) {
      const frameId = window.requestAnimationFrame(() => {
        setCanScrollProjectHistoryRight(false);
      });
      return () => window.cancelAnimationFrame(frameId);
    }

    let frameId: number | null = null;
    const scheduleScrollAffordanceUpdate = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updateScrollAffordance();
      });
    };

    const updateScrollAffordance = () => {
      const hasOverflow = row.scrollWidth > row.clientWidth + 1;
      const hasMoreToRight = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
      setCanScrollProjectHistoryRight(hasOverflow && hasMoreToRight);
    };

    scheduleScrollAffordanceUpdate();
    row.addEventListener("scroll", scheduleScrollAffordanceUpdate, { passive: true });
    window.addEventListener("resize", scheduleScrollAffordanceUpdate);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleScrollAffordanceUpdate);
    resizeObserver?.observe(row);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      row.removeEventListener("scroll", scheduleScrollAffordanceUpdate);
      window.removeEventListener("resize", scheduleScrollAffordanceUpdate);
      resizeObserver?.disconnect();
    };
  }, [visibleProjectHistory.length]);

  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="relative overflow-hidden bg-[#f7fbff]">
        <div className="relative mx-auto max-w-[1180px] px-6 pb-8 pt-12 lg:px-10 lg:pb-10 lg:pt-14">
          <div className="grid gap-8 lg:grid-cols-[1fr_0.48fr] lg:items-center lg:gap-12">
            <div className="max-w-none">
              <p className="mb-4 text-sm font-bold uppercase tracking-[0.28em] text-[#1b75a6]">
                Gene regulatory network analysis
              </p>

              <h1 className="text-5xl font-bold tracking-tight text-slate-950 sm:text-6xl lg:text-[3.75rem] lg:leading-[1.02]">
                GRNScope
              </h1>

              <div className="mt-5 max-w-2xl text-[1.05rem] leading-8 text-slate-700">
                <p>
                  Infer, compare, and explore gene regulatory networks from single-cell RNA-seq data. Run multiple algorithms and inspect their predictions in one interactive workspace.
                </p>
              </div>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(true)}
                  className="inline-flex h-11 items-center justify-center rounded-full bg-[#1b75a6] px-6 text-sm font-bold text-white transition hover:bg-[#155f87]"
                >
                  Create new project
                </button>
                <Link
                  href="/algorithms"
                  className="inline-flex h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                >
                  Browse algorithms
                </Link>
              </div>
            </div>

            <Link
              href="/projects/demo"
              className="group flex w-full flex-col rounded-[1.5rem] border border-slate-200 bg-white/60 p-5 text-left transition hover:-translate-y-0.5 hover:border-[#1b75a6]/30 hover:bg-white"
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#1b75a6]">
                  Try the demo
                </p>
                <h3 className="mt-2.5 text-lg font-bold tracking-tight text-slate-950">
                  See a completed analysis
                </h3>
              </div>
              <p className="mt-2.5 text-sm leading-6 text-slate-600">
                Inspect a prepared network, edge table, method overlap, and export workflow.
              </p>
              <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
                <span className="text-sm font-bold text-[#1b75a6]">Open demo</span>
                <span aria-hidden="true" className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[#1b75a6]">
                  <svg viewBox="0 0 16 28" className="h-4 w-2.5" fill="none">
                    <path
                      d="M2.5 3.5 12.5 14 2.5 24.5"
                      stroke="currentColor"
                      strokeWidth="3.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[#f7fbff]">
        <div className="mx-auto max-w-[1180px] px-6 py-8 lg:px-10 lg:py-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold tracking-tight text-slate-950">Recent projects</h2>
              {!isProjectHistoryLoading ? (
                <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-bold text-slate-500">
                  {visibleProjectHistory.length}
                </span>
              ) : null}
            </div>
            <Link
              href="/projects"
              className="group inline-flex items-center gap-2 text-sm font-bold text-slate-600 transition hover:text-[#1b75a6]"
            >
              View all
              <span aria-hidden="true" className="transition group-hover:translate-x-0.5">→</span>
            </Link>
          </div>

          {isProjectHistoryLoading ? (
            <HomeProjectHistoryLoading />
          ) : visibleProjectHistory.length > 0 ? (
            <div className="group/history relative mt-5">
              <div
                ref={projectHistoryRowRef}
                className="flex snap-x items-start gap-4 overflow-x-auto pb-4 pt-1"
              >
                {visibleProjectHistory.map((project) => (
                  <HomeProjectCard key={project.id} project={project} />
                ))}
              </div>
              {canScrollProjectHistoryRight ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 mb-4 flex w-22 items-center justify-end bg-gradient-to-r from-[#f7fbff]/0 via-[#f7fbff]/55 to-[#f7fbff]/95 pr-1 opacity-0 transition-opacity duration-200 group-hover/history:opacity-100 group-focus-within/history:opacity-100"
                >
                  <span className="inline-flex h-10 w-10 translate-x-[-8px] items-center justify-center rounded-full border border-[#1b75a6]/20 bg-white/95 text-[#1b75a6] shadow-[0_10px_22px_rgba(15,23,42,0.10),0_0_0_8px_rgba(247,251,255,0.72)] transition-transform duration-200 group-hover/history:translate-x-0 group-focus-within/history:translate-x-0">
                    <svg viewBox="0 0 16 28" className="h-5 w-3" fill="none">
                      <path
                        d="M2.5 3.5 12.5 14 2.5 24.5"
                        stroke="currentColor"
                        strokeWidth="3.25"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <Link
              href="/projects"
              className="mt-5 block rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-6 py-8 text-slate-600 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc]"
            >
              <p className="text-lg font-bold text-slate-950">No saved projects yet</p>
              <p className="mt-2 text-sm leading-6">
                Open the workspace to create your first analysis project.
              </p>
            </Link>
          )}
        </div>
      </section>

      {isCreateOpen ? (
        <CreateProjectFlow
          open={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onProjectCreated={handleProjectCreated}
        />
      ) : null}
    </main>
  );
}

function HomeProjectHistoryLoading() {
  return (
    <div
      className="mt-5 rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-6 py-8"
      aria-label="Loading project history"
    >
      <div className="h-5 w-44 animate-pulse rounded-full bg-slate-200" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-4 animate-pulse rounded-full bg-slate-100" />
        <div className="h-4 animate-pulse rounded-full bg-slate-100" />
        <div className="hidden h-4 animate-pulse rounded-full bg-slate-100 lg:block" />
      </div>
    </div>
  );
}

function HomeProjectCard({ project }: { project: Project }) {
  const createdAtLabel = formatProjectCreatedAt(
    project.createdAtTimestamp,
    project.createdAt,
  );
  const status = getProjectStatus(project);
  const tasks = project.latestJob?.tasks ?? [];
  const completedCount = tasks.filter((task) => task.status === "Completed").length;
  const algorithmSummary = tasks.length > 0 ? `${completedCount}/${tasks.length}` : "-";
  const geneSummary =
    typeof project.geneCount === "number"
      ? project.geneCount.toLocaleString()
      : "-";
  const cellSummary =
    typeof project.cellCount === "number"
      ? project.cellCount.toLocaleString()
      : "-";

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex h-[9.75rem] w-[17.5rem] shrink-0 snap-start flex-col rounded-[1.1rem] border border-slate-200 bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:border-[#1b75a6]/25 hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold leading-6 tracking-tight text-slate-950">
            {project.name}
          </h3>
          <p className="mt-2 text-xs font-semibold text-slate-500">
            Created {createdAtLabel}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[0.68rem] font-bold ring-1 ${status.className}`}
        >
          {status.label}
        </span>
      </div>

      <div className="mt-auto grid grid-cols-[0.8fr_0.8fr_1.4fr] gap-3 border-t border-slate-100 pt-3">
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-slate-400">
            Genes
          </p>
          <p className="mt-1 text-sm font-bold text-slate-800">{geneSummary}</p>
        </div>
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-slate-400">
            Cells
          </p>
          <p className="mt-1 text-sm font-bold text-slate-800">{cellSummary}</p>
        </div>
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-slate-400">
            Algorithms
          </p>
          <p className="mt-1 text-sm font-bold text-slate-800">{algorithmSummary}</p>
        </div>
      </div>
    </Link>
  );
}

function toOptionalNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readOptionalDimension(source: Record<string, unknown>, type: "gene" | "cell") {
  const camelKey = type === "gene" ? "geneCount" : "cellCount";
  const snakeKey = type === "gene" ? "gene_count" : "cell_count";
  return toOptionalNumber(source[camelKey] ?? source[snakeKey]);
}

function normalizeProjectDimensions(project: Project & Record<string, unknown>): Project {
  return {
    ...project,
    geneCount: project.geneCount ?? readOptionalDimension(project, "gene"),
    cellCount: project.cellCount ?? readOptionalDimension(project, "cell"),
  };
}

function getProjectStatus(project: Project) {
  const latestJob = project.latestJob;
  if (!latestJob) {
    return {
      label: "No run",
      className: "bg-slate-50 text-slate-600 ring-slate-200",
    };
  }

  const tasks = latestJob.tasks ?? [];
  const hasRunning = tasks.some((task) => task.status === "Running");
  const hasQueued = tasks.some((task) => task.status === "Queued");
  const hasCompleted = tasks.some((task) => task.status === "Completed");
  const hasFailed = tasks.some((task) => task.status === "Failed");

  if (hasRunning || hasQueued || latestJob.overall_status === "Running") {
    return {
      label: "Running",
      className: "bg-sky-50 text-sky-700 ring-sky-200",
    };
  }

  if (hasCompleted && hasFailed) {
    return {
      label: "Partially completed",
      className: "bg-violet-50 text-violet-700 ring-violet-200",
    };
  }

  if (hasFailed || latestJob.overall_status === "Failed") {
    return {
      label: "Failed",
      className: "bg-rose-50 text-rose-600 ring-rose-200",
    };
  }

  if (hasCompleted || latestJob.overall_status === "Completed") {
    return {
      label: "Completed",
      className: "bg-[#e8f7f1] text-[#178a62] ring-[#20b779]/20",
    };
  }

  return {
    label: latestJob.overall_status || "Queued",
    className: "bg-amber-50 text-amber-700 ring-amber-200",
  };
}
