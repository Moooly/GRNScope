"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AlgorithmCatalogItem,
  AlgorithmStoredResult,
  MetadataManifest,
  ProjectJob,
  ProjectManifest,
} from "../_lib/types";
import { startPolling } from "../../../_lib/polling";
import { loadCompletedAlgorithmResults, COMPLETED_RESULTS_ERROR_MESSAGE } from "../_lib/loadResults";
import { API_BASE } from "../../../_lib/apiConfig";
import type { BackendAlgorithmEntry } from "../../../_lib/apiContracts";
import { apiFetch } from "../../../_lib/clientIdentity";
import {
  getCachedResults,
  setCachedResults,
} from "../_lib/resultsCache";

const POLL_INTERVAL_MS = 5000;
// Phase-1 (fast first paint) loads only the strongest edges per algorithm; the
// full untrimmed set is fetched in the background right after.
const FIRST_PAINT_EDGE_LIMIT = 800;

function getDockerVersion(dockerImage: string) {
  const parts = dockerImage.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : dockerImage;
}

function mapBackendAlgorithm(algorithm: BackendAlgorithmEntry): AlgorithmCatalogItem {
  return {
    id: algorithm.id,
    name: algorithm.name,
    description: algorithm.description,
    category: algorithm.category,
    requiresPseudotime: algorithm.requires_pseudotime,
    directed: algorithm.directed,
    signed: algorithm.signed,
    publication: algorithm.publication_title,
    year: algorithm.year,
    journal: algorithm.journal,
    dockerVersion: getDockerVersion(algorithm.docker_image),
    paperUrl: algorithm.publication_url,
  };
}

type UseProjectDetailDataArgs = {
  projectId?: string;
  isDemoRoute: boolean;
};

export type PseudotimeEstimationState = {
  status?: string;
  error_message?: string | null;
  is_estimated?: boolean;
  has_pseudotime?: boolean;
  lineage_count?: number | null;
} | null;

export default function useProjectDetailData({ projectId, isDemoRoute }: UseProjectDetailDataArgs) {
  const [project, setProject] = useState<ProjectManifest | null>(null);
  const [metadata, setMetadata] = useState<MetadataManifest | null>(null);
  const [latestJob, setLatestJob] = useState<ProjectJob | null>(null);
  const [pseudotimeEstimation, setPseudotimeEstimation] =
    useState<PseudotimeEstimationState>(null);
  const [algorithmResults, setAlgorithmResults] = useState<Record<string, AlgorithmStoredResult>>({});
  const [algorithmCatalog, setAlgorithmCatalog] = useState<AlgorithmCatalogItem[]>([]);
  const [isLoadingCompletedResults, setIsLoadingCompletedResults] = useState(false);
  const [completedResultsError, setCompletedResultsError] = useState("");
  const [isLoadingProject, setIsLoadingProject] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [error, setError] = useState("");
  const refreshRef = useRef<{ projectId?: string; run: () => Promise<void> } | null>(null);
  const activeTasksRef = useRef(false);
  const reload = useCallback(() => setReloadNonce((value) => value + 1), []);
  const refreshProjectData = useCallback(async () => {
    const refresh = refreshRef.current;
    if (refresh && refresh.projectId === projectId) await refresh.run();
  }, [projectId]);

  // Mutations can update the job immediately; keep polling in step without
  // tearing down a request when its own response marks the last task complete.
  useEffect(() => {
    activeTasksRef.current = (latestJob?.tasks ?? []).some(
      (task) => ["Queued", "Running", "Stopping"].includes(task.status),
    );
  }, [latestJob]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${API_BASE}/algorithms`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as BackendAlgorithmEntry[];
        if (!controller.signal.aborted) {
          setAlgorithmCatalog(data.filter((algorithm) => algorithm.active).map(mapBackendAlgorithm));
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let disposed = false;
    let request: AbortController | null = null;
    let inFlight = false;
    let currentResults: Record<string, AlgorithmStoredResult> = {};
    // Keep stable manifests when a poll contains no change. This also avoids
    // refetching visualization context and rebuilding graphs every five seconds.
    const publishProject = (value: ProjectManifest | null) =>
      setProject((previous) => JSON.stringify(previous) === JSON.stringify(value) ? previous : value);
    const publishMetadata = (value: MetadataManifest | null) =>
      setMetadata((previous) => JSON.stringify(previous) === JSON.stringify(value) ? previous : value);

    const run = async (initial = false) => {
      if (disposed) return;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      inFlight = true;
      const current = () => !disposed && !controller.signal.aborted;
      const commitResults = (results: Record<string, AlgorithmStoredResult>) => {
        if (!current()) return;
        currentResults = results;
        setAlgorithmResults(results);
      };
      setError("");
      setCompletedResultsError("");
      setIsLoadingCompletedResults(true);
      if (initial) {
        setIsLoadingProject(true);
        setProject(null);
        setMetadata(null);
        setLatestJob(null);
        setPseudotimeEstimation(null);
        setAlgorithmResults({});
        activeTasksRef.current = false;
      }
      const metadataPromise = apiFetch(`${API_BASE}/projects/${projectId}/metadata`, {
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json();
        if (current()) publishMetadata(payload.metadata ?? null);
      }).catch(() => {});

      let projectLoaded = false;
      try {
        let response: Response | undefined;
        for (let attempt = 0; attempt < (initial ? 3 : 1); attempt += 1) {
          try {
            response = await apiFetch(`${API_BASE}/projects/${projectId}`, { signal: controller.signal });
            if (response.ok || response.status === 404) break;
          } catch {
            if (!current()) return;
          }
          if (initial && attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
          if (!current()) return;
        }
        if (!response?.ok) throw new Error("We couldn't load this project. Please try again.");
        const payload = await response.json();
        if (!current()) return;
        projectLoaded = true;
        const declaredSpecies = String(payload.project?.preprocessing?.dataset_species ?? payload.project?.dataset_species ?? "").trim().toLowerCase();
        const coordinateSpecies = isDemoRoute ? "human" : ["human", "mouse"].includes(declaredSpecies) ? declaredSpecies : null;
        const job = (payload.latest_job ?? null) as ProjectJob | null;
        const active = (job?.tasks ?? []).some((task) => ["Queued", "Running", "Stopping"].includes(task.status));
        activeTasksRef.current = active;
        publishProject(payload.project ?? null);
        setLatestJob((previous) => JSON.stringify(previous) === JSON.stringify(job) ? previous : job);
        setPseudotimeEstimation(payload.pseudotime_estimation ?? null);
        setIsLoadingProject(false);

        if (initial) {
          const cached = !active ? getCachedResults(projectId, job?.job_id) : undefined;
          if (cached) {
            // Revalidate result revisions below: reruns may retain the job ID,
            // including reruns initiated in another tab.
            commitResults(cached);
          } else {
            try {
              const preview = await loadCompletedAlgorithmResults(projectId, {}, {
                signal: controller.signal, limit: FIRST_PAINT_EDGE_LIMIT, coordinateSpecies,
              });
              commitResults(preview);
            } catch (previewError) {
              if (!current()) throw previewError;
              // A failed preview should still get a chance to load the full files.
            }
          }
          if (!current()) return;
          setIsLoadingCompletedResults(false);
        }
        const fullResults = await loadCompletedAlgorithmResults(projectId, currentResults, {
          signal: controller.signal, coordinateSpecies,
        });
        if (!current()) return;
        commitResults(fullResults);
        if (!active) setCachedResults(projectId, job?.job_id, fullResults);
      } catch (loadError) {
        if (!current()) return;
        if (projectLoaded) setCompletedResultsError(COMPLETED_RESULTS_ERROR_MESSAGE);
        else setError(loadError instanceof Error ? loadError.message : "We couldn't load this project. Please try again.");
      } finally {
        await metadataPromise;
        if (current()) {
          inFlight = false;
          setIsLoadingProject(false);
          setIsLoadingCompletedResults(false);
        }
      }
    };

    refreshRef.current = { projectId, run: () => run() };
    void run(true);
    const stopPolling = startPolling(async () => {
      if (!inFlight && activeTasksRef.current && !isDemoRoute) await run();
    }, POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      request?.abort();
      stopPolling();
      refreshRef.current = null;
    };
  }, [isDemoRoute, projectId, reloadNonce]);

  return {
    project,
    metadata,
    latestJob,
    pseudotimeEstimation,
    algorithmResults,
    algorithmCatalog,
    isLoadingCompletedResults,
    completedResultsError,
    isLoadingProject,
    error,
    reload,
    refreshProjectData,
    setLatestJob,
  };
}
