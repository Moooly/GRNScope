"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CreateProjectFlow, {
  type CreateProjectPrefill,
} from "./_components/CreateProjectFlow";
import ProjectCard from "./_components/ProjectCard";
import { Project, ProjectJob } from "./_types/project";
import DeleteProjectModal from "./_components/DeleteProjectModal";
import RenameProjectModal from "./_components/RenameProjectModal";
import { API_BASE } from "../_lib/apiConfig";
import { apiFetch } from "../_lib/clientIdentity";
import {
  loadProjectHistory as fetchProjectHistory,
  readCachedProjectHistory,
  writeCachedProjectHistory,
} from "./_lib/projectHistoryCache";

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

function readPrefillBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

function ProjectsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<CreateProjectPrefill>();
  const [projectHistory, setProjectHistory] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
    let isCancelled = false;
    const sourceProjectId = searchParams.get("source");

    const openCreateFlow = async () => {
      let nextPrefill: CreateProjectPrefill | undefined;
      if (sourceProjectId) {
        try {
          const response = await apiFetch(`${API_BASE}/projects/${sourceProjectId}`);
          if (response.ok) {
            const data = await response.json();
            const source = data.project ?? {};
            const sourceName = String(source.project_name ?? "Untitled project").trim();
            nextPrefill = {
              projectName: sourceName.toLowerCase().endsWith("(corrected)")
                ? sourceName
                : `${sourceName} (corrected)`,
              projectDescription: String(source.project_description ?? ""),
              topVariableGenes: String(source.top_variable_genes ?? ""),
              includeAllTFs: readPrefillBoolean(source.include_all_tfs, true),
              normalizeEnabled: readPrefillBoolean(source.normalize_enabled, true),
              logTransformEnabled: readPrefillBoolean(source.log_transform_enabled, true),
              maxEdgesPerTarget: String(source.ranked_edges_per_target_limit ?? "20"),
              selectedIds: Array.isArray(source.selected_algorithms)
                ? source.selected_algorithms.map(String)
                : [],
              algorithmParameters: source.algorithm_parameters ?? {},
              ensembleEnabled: readPrefillBoolean(source.ensemble_enabled, true),
              cellOracleSpecies: String(source.celloracle?.species ?? "human"),
            };
          }
        } catch {
          nextPrefill = undefined;
        }
      }

      if (isCancelled) return;
      setCreatePrefill(nextPrefill);
      setIsCreateOpen(true);
      router.replace("/projects", { scroll: false });
    };

    void openCreateFlow();
    return () => {
      isCancelled = true;
    };
  }, [searchParams, router]);

  const openBlankCreateFlow = () => {
    setCreatePrefill(undefined);
    setIsCreateOpen(true);
  };

  useEffect(() => {
    let isCancelled = false;
    const cachedProjects = readCachedProjectHistory();
    if (cachedProjects) {
      setProjectHistory(cachedProjects);
      setIsLoading(false);
    }

    const loadProjectHistory = async () => {
      try {
        const projects = await fetchProjectHistory();
        if (!isCancelled) setProjectHistory(projects);
      } catch {
        // Keep showing the last successful list when a background refresh fails.
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

  const handleProjectCreated = (project: Project) => {
    setProjectHistory((currentProjects) => {
      const nextProjects = [project, ...currentProjects];
      writeCachedProjectHistory(nextProjects);
      return nextProjects;
    });
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
        setProjectHistory((currentProjects) => {
          const nextProjects = currentProjects.filter(
            (item) => item.id !== targetProjectId,
          );
          writeCachedProjectHistory(nextProjects);
          return nextProjects;
        });
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

  const showEmptyLibrary = !isLoading && visibleProjectHistory.length === 0;

  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="mx-auto max-w-[1260px] px-6 pb-16 pt-10 lg:px-10 lg:pb-20 lg:pt-14">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Your projects
            </h1>
          </div>
          <button
            type="button"
            onClick={openBlankCreateFlow}
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-[#1b75a6] px-5 text-sm font-bold text-white transition hover:bg-[#155f87]"
          >
            + New project
          </button>
        </div>

        {isLoading ? (
          <ProjectsLoadingSkeleton />
        ) : showEmptyLibrary ? (
          <EmptyProjectsLibrary onCreate={openBlankCreateFlow} />
        ) : (
          <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(17.25rem,1fr))] gap-4">
            {visibleProjectHistory.map((project) => (
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
                  variant="library"
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
          initialValues={createPrefill}
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

function ProjectsLoadingSkeleton() {
  return (
    <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(17.25rem,1fr))] gap-4">
      {[0, 1, 2].map((idx) => (
        <div
          key={idx}
          className="h-[9.75rem] animate-pulse rounded-[1.1rem] border border-slate-200 bg-white p-4"
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
