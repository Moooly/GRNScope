"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "./_lib/clientIdentity";
import CreateProjectFlow from "./projects/_components/CreateProjectFlow";
import { formatProjectCreatedAt } from "./projects/_lib/time";
import { Project, ProjectJob } from "./projects/_types/project";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

export default function HomePage() {
  const [projectHistory, setProjectHistory] = useState<Project[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const metadataRequestIds = useRef<Set<string>>(new Set());
  const router = useRouter();

  const visibleProjectHistory = useMemo(
    () => projectHistory.filter((project) => project.id !== "demo"),
    [projectHistory],
  );

  useEffect(() => {
    let isCancelled = false;

    const loadProjectHistory = async () => {
      try {
        const response = await apiFetch(`${API_BASE}/projects`);
        if (!response.ok) {
          if (!isCancelled) setProjectHistory([]);
          return;
        }

        const data = await response.json();
        if (isCancelled) return;

        if (data.ok && Array.isArray(data.projects)) {
          setProjectHistory(data.projects as Project[]);
        } else {
          setProjectHistory([]);
        }
      } catch {
        if (!isCancelled) setProjectHistory([]);
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
              (item): item is { projectId: string; latestJob: ProjectJob | null } =>
                item !== null,
            )
            .map((item) => [item.projectId, item.latestJob]),
        );

        setProjectHistory((currentProjects) =>
          currentProjects.map((project) => {
            if (!latestJobMap.has(project.id)) return project;
            return {
              ...project,
              latestJob: latestJobMap.get(project.id) ?? null,
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
            if (!response.ok) return null;
            const data = await response.json();
            const metadata = data.metadata ?? {};
            return {
              projectId,
              geneCount: toOptionalNumber(metadata.gene_count),
              cellCount: toOptionalNumber(metadata.cell_count),
            };
          } catch {
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

  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="relative overflow-hidden bg-[#f4f6f8]">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/90 to-transparent" />
        <div className="absolute -left-24 top-28 h-72 w-72 rounded-full bg-cyan-100/60 blur-3xl" />
        <div className="absolute -right-24 top-20 h-72 w-72 rounded-full bg-teal-100/60 blur-3xl" />

        <div className="relative mx-auto max-w-[1180px] px-6 pb-10 pt-16 lg:px-10 lg:pb-12 lg:pt-18">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_0.55fr] lg:items-center">
            <div className="max-w-none">
              <p className="mb-4 text-sm font-bold uppercase tracking-[0.28em] text-[#1b75a6]">
                Gene regulatory network analysis
              </p>

              <h1 className="text-5xl font-bold tracking-tight text-slate-950 sm:text-6xl lg:text-[4.15rem] lg:leading-[1.02]">
                GRNScope
              </h1>

              <div className="mt-6 max-w-4xl text-[1.05rem] leading-8 text-slate-700">
                <p>
                  GRNScope turns single-cell RNA-seq expression matrices into predicted gene regulatory networks. It runs multiple inference algorithms, compares ranked edges, and provides interactive results for network inspection and export.
                </p>
              </div>
            </div>

            <Link
              href="/projects/demo"
              className="group flex w-full flex-col rounded-[1.75rem] border border-slate-200 bg-[#f7fbff] p-6 text-left transition hover:-translate-y-0.5 hover:border-[#1b75a6]/30 hover:shadow-md"
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
                  Demo project
                </p>
                <h3 className="mt-3 text-xl font-bold tracking-tight text-slate-950">
                  Explore a completed GRN result
                </h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Open the prepared example to inspect the network, edge table, method overlap, and export tools.
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
        <div className="mx-auto max-w-[1180px] px-6 py-10 lg:px-10 lg:py-12">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/projects"
              className="group inline-flex items-center gap-1.5 text-2xl font-bold tracking-tight text-slate-950 transition hover:text-slate-800"
            >
              My projects
              <svg
                aria-hidden="true"
                viewBox="0 0 16 28"
                className="mt-0.5 h-5 w-3 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-500"
                fill="none"
              >
                <path
                  d="M2.5 3.5 12.5 14 2.5 24.5"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="inline-flex h-10 items-center justify-center rounded-full bg-[#1b75a6] px-5 text-sm font-bold text-white shadow-sm shadow-[#1b75a6]/20 transition hover:bg-[#155f87]"
              >
                Create new project
              </button>
            </div>
          </div>

          {visibleProjectHistory.length > 0 ? (
            <div className="group/history relative mt-5">
              <div className="flex snap-x items-start gap-4 overflow-x-auto pb-4">
                {visibleProjectHistory.map((project) => (
                  <HomeProjectCard key={project.id} project={project} />
                ))}
              </div>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-0 hidden w-24 items-center justify-end bg-gradient-to-l from-[#f7fbff] via-[#f7fbff]/85 to-transparent opacity-0 transition-opacity duration-200 group-hover/history:flex group-hover/history:opacity-100 lg:flex"
              >
                <span className="mr-1 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
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

      <CreateProjectFlow
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onProjectCreated={handleProjectCreated}
      />
    </main>
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
      className="group flex h-[9.75rem] w-[17.5rem] shrink-0 snap-start flex-col rounded-[1.1rem] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[#1b75a6]/25 hover:shadow-lg hover:shadow-slate-200/70"
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
