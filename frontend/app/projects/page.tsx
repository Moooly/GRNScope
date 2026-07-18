"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CreateProjectFlow from "./_components/CreateProjectFlow";
import ProjectCard, { getProjectStatusKey } from "./_components/ProjectCard";
import { Project, ProjectJob } from "./_types/project";
import DeleteProjectModal from "./_components/DeleteProjectModal";
import RenameProjectModal from "./_components/RenameProjectModal";
import { API_BASE } from "../_lib/apiConfig";
import { apiFetch } from "../_lib/clientIdentity";

export type AlgorithmParameter = {
  name: string;
  label?: string;
  description?: string;
  default?: unknown;
  required?: boolean;
  value_type?: string;
  options?: unknown[];
  minimum?: number;
  maximum?: number;
  exclusive_minimum?: number;
  exclusive_maximum?: number;
  step?: number;
  advanced?: boolean;
};

export type ProjectAlgorithm = {
  id: string;
  name: string;
  tagline: string;
  category: string;
  requiresPseudotime: boolean;
  directed: boolean;
  signed: boolean;
  publication: string;
  year: string;
  journal: string;
  dockerVersion: string;
  paperUrl: string;
  sourceUrl: string | null;
  strengths: string[];
  limitations: string[];
  recommendedUseCases: string[];
  detail: string;
  recommended: boolean;
  runner: string;
  parameters: AlgorithmParameter[];
};

type StatusFilter = "all" | "running" | "completed" | "failed";
type SortMode = "newest" | "oldest" | "name";

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
];

function matchesStatusFilter(project: Project, filter: StatusFilter) {
  if (filter === "all") return true;
  const key = getProjectStatusKey(project);
  if (filter === "running") return key === "running";
  if (filter === "completed") return key === "completed" || key === "partial";
  if (filter === "failed") return key === "failed" || key === "partial";
  return true;
}

function ProjectsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [projectHistory, setProjectHistory] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  const [projectPendingDelete, setProjectPendingDelete] = useState<Project | null>(null);
  const [isDeleteModalClosing, setIsDeleteModalClosing] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [projectPendingRename, setProjectPendingRename] = useState<Project | null>(null);
  const [isRenameModalClosing, setIsRenameModalClosing] = useState(false);
  const [isRenamingProject, setIsRenamingProject] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const visibleProjectHistory = useMemo(
    () => projectHistory.filter((project) => project.id !== "demo"),
    [projectHistory],
  );

  useEffect(() => {
    if (searchParams.get("create") !== "1") return;
    setIsCreateOpen(true);
    router.replace("/projects", { scroll: false });
  }, [searchParams, router]);

  useEffect(() => {
    let isCancelled = false;
    const loadProjectHistory = async () => {
      setIsLoading(true);
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
      } finally {
        if (!isCancelled) setIsLoading(false);
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
          const overallStatus = latestJob.overall_status;
          const hasActiveTasks = latestJob.tasks?.some(
            (task) => task.status === "Queued" || task.status === "Running",
          );
          return (
            overallStatus === "Queued" ||
            overallStatus === "Running" ||
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
              } => item !== null,
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

  const statusCounts = useMemo(() => {
    const counts = { total: visibleProjectHistory.length, running: 0, completed: 0, failed: 0 };
    for (const project of visibleProjectHistory) {
      const key = getProjectStatusKey(project);
      if (key === "running") counts.running += 1;
      if (key === "completed" || key === "partial") counts.completed += 1;
      if (key === "failed" || key === "partial") counts.failed += 1;
    }
    return counts;
  }, [visibleProjectHistory]);

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = visibleProjectHistory.filter((project) => {
      if (!matchesStatusFilter(project, statusFilter)) return false;
      if (query && !project.name.toLowerCase().includes(query)) return false;
      return true;
    });
    return filtered.sort((left, right) => {
      if (sortMode === "name") return left.name.localeCompare(right.name);
      const leftTime = Number(left.createdAtTimestamp ?? 0) || 0;
      const rightTime = Number(right.createdAtTimestamp ?? 0) || 0;
      return sortMode === "oldest" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [visibleProjectHistory, searchQuery, statusFilter, sortMode]);

  const handleProjectCreated = (project: Project) => {
    setProjectHistory((currentProjects) => [project, ...currentProjects]);
    router.push(`/projects/${project.id}`);
  };

  // --- Delete flow ---
  const handleAskDeleteProject = (project: Project) => {
    setDeleteError(null);
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
    try {
      setIsDeletingProject(true);
      const response = await apiFetch(
        `${API_BASE}/projects/${projectPendingDelete.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setDeleteError("Failed to delete the project.");
        return;
      }
      const targetProjectId = projectPendingDelete.id;
      setDeletingProjectId(targetProjectId);
      setIsDeleteModalClosing(true);
      window.setTimeout(() => {
        setProjectPendingDelete(null);
        setIsDeleteModalClosing(false);
      }, 280);
      window.setTimeout(() => {
        setProjectHistory((currentProjects) =>
          currentProjects.filter((item) => item.id !== targetProjectId),
        );
        setDeletingProjectId(null);
      }, 300);
    } catch {
      setDeleteError("Could not connect to the server.");
    } finally {
      setIsDeletingProject(false);
    }
  };

  // --- Rename flow ---
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
      setProjectHistory((currentProjects) =>
        currentProjects.map((item) =>
          item.id === targetProjectId ? { ...item, name: newName } : item,
        ),
      );
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

  const hasSearchOrFilter = searchQuery.trim().length > 0 || statusFilter !== "all";
  const showEmptyLibrary = !isLoading && visibleProjectHistory.length === 0;
  const showNoMatches =
    !isLoading && visibleProjectHistory.length > 0 && filteredProjects.length === 0;

  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="mx-auto max-w-[1180px] px-6 pb-16 pt-10 lg:px-10 lg:pb-20 lg:pt-14">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="min-w-0 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Your projects
          </h1>

          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
            <label className="relative">
              <span className="sr-only">Search projects</span>
              <svg
                viewBox="0 0 20 20"
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="m13.2 13.2 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search projects"
                className="h-10 w-full min-w-[14rem] rounded-full border border-slate-200 bg-white pl-10 pr-4 text-sm font-semibold text-slate-800 outline-none transition placeholder:font-normal placeholder:text-slate-400 hover:border-slate-300 focus:border-[#1b75a6] focus:ring-4 focus:ring-[#1b75a6]/10"
              />
            </label>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex h-10 items-center justify-center rounded-full bg-[#1b75a6] px-5 text-sm font-bold text-white transition hover:bg-[#155f87]"
            >
              + New project
            </button>
          </div>
        </div>

        {!isLoading && visibleProjectHistory.length > 0 ? (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {STATUS_FILTERS.map((filter) => {
                const isActive = statusFilter === filter.id;
                const count =
                  filter.id === "all"
                    ? statusCounts.total
                    : filter.id === "running"
                      ? statusCounts.running
                      : filter.id === "completed"
                        ? statusCounts.completed
                        : statusCounts.failed;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setStatusFilter(filter.id)}
                    aria-pressed={isActive}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition ${
                      isActive
                        ? "border-[#1b75a6] bg-[#1b75a6] text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                    }`}
                  >
                    {filter.label}
                    <span
                      className={`text-[11px] tabular-nums ${
                        isActive ? "text-white/70" : "text-slate-400"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <label className="relative">
              <span className="sr-only">Sort by</span>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="inline-flex h-9 cursor-pointer appearance-none items-center rounded-full border border-slate-200 bg-white pl-3.5 pr-9 text-xs font-bold text-slate-600 outline-none transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] focus:border-[#1b75a6] focus:ring-4 focus:ring-[#1b75a6]/10"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name (A–Z)</option>
              </select>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
              >
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
                  <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </label>
          </div>
        ) : null}

        {isLoading ? (
          <ProjectsLoadingSkeleton />
        ) : showEmptyLibrary ? (
          <EmptyProjectsLibrary onCreate={() => setIsCreateOpen(true)} />
        ) : showNoMatches ? (
          <NoMatchingProjects
            hasFilter={hasSearchOrFilter}
            onReset={() => {
              setSearchQuery("");
              setStatusFilter("all");
            }}
          />
        ) : (
          <div className="mt-6 grid grid-cols-[repeat(auto-fill,17.5rem)] gap-4">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                className="origin-top overflow-visible"
                style={{
                  opacity: deletingProjectId === project.id ? 0 : 1,
                  transform:
                    deletingProjectId === project.id
                      ? "translateY(12px) scale(0.95)"
                      : "translateY(0px) scale(1)",
                  transition: "opacity 280ms ease-out, transform 280ms ease-out",
                  pointerEvents: deletingProjectId === project.id ? "none" : "auto",
                }}
              >
                <ProjectCard
                  project={project}
                  onRename={handleAskRenameProject}
                  onDelete={handleAskDeleteProject}
                />
              </div>
            ))}
          </div>
        )}

        {deleteError ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {deleteError}
          </div>
        ) : null}

        <CreateProjectFlow
          open={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onProjectCreated={handleProjectCreated}
        />

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
      </section>
    </main>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#f7fbff]" />}>
      <ProjectsPageContent />
    </Suspense>
  );
}

function EmptyProjectsLibrary({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-8 rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <h2 className="text-lg font-bold text-slate-950">No projects yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
        Create your first project to upload an expression matrix and run GRN inference algorithms.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-[#1b75a6] px-5 text-sm font-bold text-white transition hover:bg-[#155f87]"
      >
        + New project
      </button>
    </div>
  );
}

function NoMatchingProjects({
  hasFilter,
  onReset,
}: {
  hasFilter: boolean;
  onReset: () => void;
}) {
  return (
    <div className="mt-8 rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <h2 className="text-base font-bold text-slate-950">No projects match</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
        Try a different search or filter.
      </p>
      {hasFilter ? (
        <button
          type="button"
          onClick={onReset}
          className="mt-4 inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

function ProjectsLoadingSkeleton() {
  return (
    <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((idx) => (
        <div
          key={idx}
          className="h-[10rem] animate-pulse rounded-[1.1rem] border border-slate-200 bg-white p-4"
        >
          <div className="h-4 w-32 rounded-full bg-slate-100" />
          <div className="mt-3 h-3 w-24 rounded-full bg-slate-100" />
          <div className="mt-8 h-3 w-full rounded-full bg-slate-100" />
        </div>
      ))}
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
