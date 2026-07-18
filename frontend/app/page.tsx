"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "./_lib/apiConfig";
import { apiFetch } from "./_lib/clientIdentity";
import ProjectCard from "./projects/_components/ProjectCard";
import DeleteProjectModal from "./projects/_components/DeleteProjectModal";
import RenameProjectModal from "./projects/_components/RenameProjectModal";
import {
  loadProjectHistory as fetchProjectHistory,
  readCachedProjectHistory,
  writeCachedProjectHistory,
} from "./projects/_lib/projectHistoryCache";
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

  const [projectPendingDelete, setProjectPendingDelete] = useState<Project | null>(null);
  const [isDeleteModalClosing, setIsDeleteModalClosing] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  const [projectPendingRename, setProjectPendingRename] = useState<Project | null>(null);
  const [isRenameModalClosing, setIsRenameModalClosing] = useState(false);
  const [isRenamingProject, setIsRenamingProject] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const visibleProjectHistory = useMemo(
    () => projectHistory.filter((project) => project.id !== "demo"),
    [projectHistory],
  );

  useEffect(() => {
    let isCancelled = false;
    const cachedProjects = readCachedProjectHistory();
    if (cachedProjects) {
      setProjectHistory(cachedProjects);
      setIsProjectHistoryLoading(false);
    }

    const loadProjectHistory = async () => {
      try {
        const projects = await fetchProjectHistory();
        if (!isCancelled) setProjectHistory(projects);
      } catch {
        // Keep showing the last successful list when a background refresh fails.
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
    setProjectHistory((currentProjects) => {
      const nextProjects = [project, ...currentProjects];
      writeCachedProjectHistory(nextProjects);
      return nextProjects;
    });
    router.push(`/projects/${project.id}`);
  };

  const handleAskDeleteProject = (project: Project) => {
    setIsDeleteModalClosing(false);
    setProjectPendingDelete(project);
  };

  const handleCancelDeleteProject = () => {
    if (isDeletingProject || !projectPendingDelete) return;
    setIsDeleteModalClosing(true);
    window.setTimeout(() => {
      setProjectPendingDelete(null);
      setIsDeleteModalClosing(false);
    }, 280);
  };

  const handleConfirmDeleteProject = async () => {
    if (!projectPendingDelete) return;
    const targetProjectId = projectPendingDelete.id;
    try {
      setIsDeletingProject(true);
      const response = await apiFetch(
        `${API_BASE}/projects/${targetProjectId}`,
        { method: "DELETE" },
      );
      if (!response.ok) return;
      setIsDeleteModalClosing(true);
      window.setTimeout(() => {
        setProjectPendingDelete(null);
        setIsDeleteModalClosing(false);
      }, 280);
      window.setTimeout(() => {
        setProjectHistory((currentProjects) => {
          const nextProjects = currentProjects.filter(
            (item) => item.id !== targetProjectId,
          );
          writeCachedProjectHistory(nextProjects);
          return nextProjects;
        });
      }, 300);
    } finally {
      setIsDeletingProject(false);
    }
  };

  const handleAskRenameProject = (project: Project) => {
    setRenameError(null);
    setIsRenameModalClosing(false);
    setProjectPendingRename(project);
  };

  const handleCancelRenameProject = () => {
    if (isRenamingProject || !projectPendingRename) return;
    setIsRenameModalClosing(true);
    window.setTimeout(() => {
      setProjectPendingRename(null);
      setIsRenameModalClosing(false);
    }, 280);
  };

  const handleConfirmRenameProject = async (newName: string) => {
    if (!projectPendingRename) return;
    const targetProjectId = projectPendingRename.id;
    try {
      setIsRenamingProject(true);
      setRenameError(null);
      const response = await apiFetch(
        `${API_BASE}/projects/${targetProjectId}/name`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_name: newName }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setRenameError(payload.detail || "Failed to rename the project.");
        return;
      }
      setProjectHistory((currentProjects) => {
        const nextProjects = currentProjects.map((item) =>
          item.id === targetProjectId ? { ...item, name: newName } : item,
        );
        writeCachedProjectHistory(nextProjects);
        return nextProjects;
      });
      setIsRenameModalClosing(true);
      window.setTimeout(() => {
        setProjectPendingRename(null);
        setIsRenameModalClosing(false);
      }, 280);
    } catch {
      setRenameError("Could not connect to the server.");
    } finally {
      setIsRenamingProject(false);
    }
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
      <section className="relative bg-[#f7fbff]">
        <div className="relative mx-auto max-w-[1180px] px-6 pb-6 pt-12 lg:px-10 lg:pb-8 lg:pt-14">
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
            </div>

            <Link
              href="/projects/demo"
              className="group flex w-full flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-[#1b75a6]/30 hover:shadow-[0_18px_40px_rgba(15,23,42,0.10)]"
            >
              <div className="border-b border-slate-100 bg-gradient-to-br from-[#f2f9fc] to-[#e9f6f3] px-5 pb-1 pt-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#1b75a6]">
                  Try the demo
                </p>
                <svg viewBox="0 0 300 140" className="mt-1 w-full" fill="none" aria-hidden="true">
                  <defs>
                    <marker id="demoNetArrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
                      <path d="M0 0 L10 5 L0 10 z" fill="#94a3b8" />
                    </marker>
                  </defs>
                  <line x1="72.9" y1="46.6" x2="142.1" y2="39.4" stroke="#cbd5e1" strokeWidth="1.6" markerEnd="url(#demoNetArrow)" />
                  <line x1="69.8" y1="56.5" x2="110.2" y2="91.5" stroke="#cbd5e1" strokeWidth="1.6" markerEnd="url(#demoNetArrow)" />
                  <line x1="166.2" y1="44.7" x2="213.8" y2="73.3" stroke="#cbd5e1" strokeWidth="1.6" markerEnd="url(#demoNetArrow)" />
                  <line x1="132.8" y1="97.6" x2="212.2" y2="82.4" stroke="#cbd5e1" strokeWidth="1.6" markerEnd="url(#demoNetArrow)" />
                  <line x1="107.9" y1="104.8" x2="87.1" y2="113.2" stroke="#cbd5e1" strokeWidth="1.6" markerEnd="url(#demoNetArrow)" />
                  <path d="M60 36 L72 48 L60 60 L48 48 Z" fill="#24384a" />
                  <path d="M120 88 L132 100 L120 112 L108 100 Z" fill="#24384a" />
                  <circle cx="155" cy="38" r="10" fill="#24384a" />
                  <circle cx="225" cy="80" r="10" fill="#0f8f7a" />
                  <circle cx="75" cy="118" r="10" fill="#24384a" />
                </svg>
              </div>
              <div className="flex items-center justify-between gap-3 px-5 py-3.5">
                <span className="text-sm font-medium text-slate-600 transition group-hover:text-[#1b75a6]">
                  See a completed analysis
                </span>
                <span aria-hidden="true" className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[#1b75a6]">
                  <svg viewBox="0 0 16 28" className="h-4 w-2.5" fill="none">
                    <path
                      d="M2.5 3.5 12.5 14 2.5 24.5"
                      stroke="currentColor"
                      strokeWidth="2.75"
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
        <div className="mx-auto max-w-[1180px] px-6 pb-8 pt-4 lg:px-10 lg:pb-10 lg:pt-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-bold tracking-tight text-slate-950">
              <Link
                href="/projects"
                className="group inline-flex items-center gap-2.5 transition hover:text-[#1b75a6]"
              >
                Recent projects
                <span
                  aria-hidden="true"
                  className="inline-flex text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[#1b75a6]"
                >
                  <svg viewBox="0 0 16 28" className="h-4 w-2.5" fill="none">
                    <path
                      d="M2.5 3.5 12.5 14 2.5 24.5"
                      stroke="currentColor"
                      strokeWidth="2.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </Link>
            </h2>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-[#1b75a6] px-4 text-sm font-bold text-white transition hover:bg-[#155f87] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1b75a6]/15"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span className="hidden sm:inline">New project</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>

          {isProjectHistoryLoading ? (
            <HomeProjectHistoryLoading />
          ) : visibleProjectHistory.length > 0 ? (
            <div className="group/history relative mt-5">
              <div
                ref={projectHistoryRowRef}
                className="flex snap-x items-start gap-4 overflow-x-auto px-1 pb-8 pt-2"
              >
                {visibleProjectHistory.map((project) => (
                  <div key={project.id} className="w-[17.5rem] shrink-0 snap-start">
                    <ProjectCard
                      project={project}
                      onRename={handleAskRenameProject}
                      onDelete={handleAskDeleteProject}
                    />
                  </div>
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

      <DeleteProjectModal
        project={projectPendingDelete}
        isDeleting={isDeletingProject}
        isClosing={isDeleteModalClosing}
        onCancel={handleCancelDeleteProject}
        onConfirm={handleConfirmDeleteProject}
      />

      <RenameProjectModal
        project={projectPendingRename}
        isSaving={isRenamingProject}
        isClosing={isRenameModalClosing}
        error={renameError}
        onCancel={handleCancelRenameProject}
        onConfirm={handleConfirmRenameProject}
      />
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

function toOptionalNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readOptionalDimension(source: Record<string, unknown>, type: "gene" | "cell") {
  const camelKey = type === "gene" ? "geneCount" : "cellCount";
  const snakeKey = type === "gene" ? "gene_count" : "cell_count";
  return toOptionalNumber(source[camelKey] ?? source[snakeKey]);
}
