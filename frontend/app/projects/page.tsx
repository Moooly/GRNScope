"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CreateProjectFlow from "./_components/CreateProjectFlow";
import ProjectCard from "./_components/ProjectCard";
import { Project, ProjectJob } from "./_types/project";
import DeleteProjectModal from "./_components/DeleteProjectModal";
import EmptyProjectHistory from "./_components/EmptyProjectHistory";

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
};

function ProjectsPageContent() {
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

  const router = useRouter();
  const searchParams = useSearchParams();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [projectHistory, setProjectHistory] = useState<Project[]>([]);
  const [projectPendingDelete, setProjectPendingDelete] = useState<Project | null>(null);
  const [isDeleteModalClosing, setIsDeleteModalClosing] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<string[]>([]);

  const visibleProjectHistory = useMemo(
    () => projectHistory.filter((project) => project.id !== "demo"),
    [projectHistory],
  );

  // Open the create modal automatically when arriving with ?create=1.
  useEffect(() => {
    if (searchParams.get("create") !== "1") return;
    setIsCreateOpen(true);
    router.replace("/projects", { scroll: false });
  }, [searchParams, router]);

  useEffect(() => {
    let isCancelled = false;

    const loadProjectHistory = async () => {
      try {
        const response = await fetch(`${API_BASE}/projects`);
        if (!response.ok) {
          setProjectHistory([]);
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
  }, [API_BASE]);

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
              const response = await fetch(`${API_BASE}/projects/${projectId}`);
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
  }, [activeProjectIds, API_BASE]);

  const handleDeleteProject = (project: Project) => {
    setIsDeleteModalClosing(false);
    setProjectPendingDelete(project);
  };

  const handleConfirmDeleteProject = async () => {
    if (!projectPendingDelete) return;

    try {
      setIsDeletingProject(true);
      const response = await fetch(
        `${API_BASE}/projects/${projectPendingDelete.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setDeleteErrors(["Failed to delete the project."]);
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
      setDeleteErrors(["Could not connect to the server."]);
    } finally {
      setIsDeletingProject(false);
    }
  };

  const handleCancelDeleteProject = () => {
    if (isDeletingProject || !projectPendingDelete) return;
    setIsDeleteModalClosing(true);
    window.setTimeout(() => {
      setProjectPendingDelete(null);
      setIsDeleteModalClosing(false);
    }, 280);
  };

  const handleProjectCreated = (project: Project) => {
    setProjectHistory((currentProjects) => [project, ...currentProjects]);
    router.push("/projects");
  };

  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="relative overflow-hidden bg-[#f4f6f8]">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/90 to-transparent" />
        <div className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-cyan-100/60 blur-3xl" />
        <div className="absolute -right-24 top-16 h-72 w-72 rounded-full bg-teal-100/60 blur-3xl" />

        <div className="relative mx-auto max-w-[1180px] px-6 py-16 lg:px-10 lg:py-20">
          <div className="flex flex-col gap-6 border-b border-[#213f54]/35 pb-8 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.28em] text-[#1b75a6]">
                Workspace
              </p>
              <h1 className="mt-4 text-5xl font-bold tracking-tight text-slate-950 sm:text-6xl lg:text-[4.15rem] lg:leading-[1.02]">
                My Projects
              </h1>
              <p className="mt-5 max-w-2xl text-[1.05rem] leading-8 text-slate-700">
                Create projects, upload expression matrices, run GRN inference algorithms,
                and return to completed analysis results from one workspace.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex w-fit cursor-pointer items-center justify-center rounded-full bg-[#1b75a6] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#1b75a6]/20 transition hover:bg-[#155f87]"
            >
              Create New Project
            </button>
          </div>

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

          {deleteErrors.length > 0 && (
            <div className="mt-6 rounded-[1.5rem] border border-rose-200 bg-rose-50 p-5">
              <ul className="space-y-2 text-sm text-rose-700">
                {deleteErrors.map((error, index) => (
                  <li key={index}>• {error}</li>
                ))}
              </ul>
            </div>
          )}

          {visibleProjectHistory.length > 0 ? (
            <div className="mt-8 grid gap-5">
              {visibleProjectHistory.map((project) => (
                <div
                  key={project.id}
                  className="origin-top overflow-hidden"
                  style={{
                    opacity: deletingProjectId === project.id ? 0 : 1,
                    transform:
                      deletingProjectId === project.id
                        ? "translateY(12px) scale(0.95)"
                        : "translateY(0px) scale(1)",
                    transition: "opacity 280ms ease-out, transform 280ms ease-out",
                    pointerEvents:
                      deletingProjectId === project.id ? "none" : "auto",
                  }}
                >
                  <ProjectCard project={project} onDelete={handleDeleteProject} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyProjectHistory />
          )}
        </div>
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
