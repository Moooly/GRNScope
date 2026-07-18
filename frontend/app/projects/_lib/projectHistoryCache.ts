import { API_BASE } from "../../_lib/apiConfig";
import { apiFetch, getClientId } from "../../_lib/clientIdentity";
import type { Project } from "../_types/project";

const STORAGE_KEY_PREFIX = "grnscope_project_history";

let memoryClientId: string | null = null;
let memoryProjects: Project[] | null = null;
let inFlightRequest: Promise<Project[]> | null = null;

function storageKey(clientId: string) {
  return `${STORAGE_KEY_PREFIX}:${clientId}`;
}

function toOptionalNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeProject(project: Project & Record<string, unknown>): Project {
  return {
    ...project,
    geneCount:
      project.geneCount ?? toOptionalNumber(project.gene_count),
    cellCount:
      project.cellCount ?? toOptionalNumber(project.cell_count),
  };
}

export function readCachedProjectHistory(): Project[] | null {
  if (typeof window === "undefined") return null;

  const clientId = getClientId();
  if (memoryClientId === clientId && memoryProjects !== null) {
    return memoryProjects;
  }

  try {
    const stored = window.localStorage.getItem(storageKey(clientId));
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return null;

    memoryClientId = clientId;
    memoryProjects = parsed.map(normalizeProject) as Project[];
    return memoryProjects;
  } catch {
    return null;
  }
}

export function writeCachedProjectHistory(projects: Project[]) {
  if (typeof window === "undefined") return;

  const clientId = getClientId();
  memoryClientId = clientId;
  memoryProjects = projects;

  try {
    window.localStorage.setItem(storageKey(clientId), JSON.stringify(projects));
  } catch {
    // The in-memory cache still makes client-side returns to the page instant.
  }
}

export function loadProjectHistory(): Promise<Project[]> {
  if (inFlightRequest) return inFlightRequest;

  inFlightRequest = (async () => {
    const response = await apiFetch(`${API_BASE}/projects`);
    if (!response.ok) {
      throw new Error("Failed to load project history.");
    }

    const data = await response.json();
    if (!data.ok || !Array.isArray(data.projects)) {
      throw new Error("Invalid project history response.");
    }

    const projects = data.projects.map(normalizeProject) as Project[];
    writeCachedProjectHistory(projects);
    return projects;
  })().finally(() => {
    inFlightRequest = null;
  });

  return inFlightRequest;
}
