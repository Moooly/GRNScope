"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AlgorithmCatalogItem,
  AlgorithmStoredResult,
  MetadataManifest,
  ProjectJob,
  ProjectManifest,
} from "../_lib/types";
import { API_BASE } from "../../../_lib/apiConfig";
import { apiFetch } from "../../../_lib/clientIdentity";
import {
  getCachedResults,
  setCachedResults,
} from "../_lib/resultsCache";

const POLL_INTERVAL_MS = 5000;
// Phase-1 (fast first paint) loads only the strongest edges per algorithm; the
// full untrimmed set is fetched in the background right after.
const FIRST_PAINT_EDGE_LIMIT = 800;

type BackendAlgorithmEntry = {
  id: string;
  name: string;
  description: string;
  long_description: string;
  category: string;
  year: string;
  journal: string;
  publication_title: string;
  publication_url: string;
  source_url: string | null;
  docker_image: string;
  runner: string;
  directed: boolean;
  signed: boolean;
  requires_pseudotime: boolean;
  supports_expression_matrix: boolean;
  active: boolean;
  recommended: boolean;
  strengths: string[];
  limitations: string[];
  recommended_use_cases: string[];
  parameters: {
    name: string;
    label?: string;
    description?: string;
    default?: unknown;
    required?: boolean;
    value_type?: string;
    options?: unknown[];
  }[];
};

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

type CompletedResultRow = {
  algorithm_id?: string;
  status?: string;
};

async function loadCompletedAlgorithmResults(
  projectId: string,
  currentResults: Record<string, AlgorithmStoredResult> = {},
  options: {
    onProgress?: (results: Record<string, AlgorithmStoredResult>) => void;
    signal?: AbortSignal;
    limit?: number;
  } = {}
) {
  const limitQuery =
    options.limit && options.limit > 0 ? `?limit=${options.limit}` : "";
  const resultsResponse = await apiFetch(`${API_BASE}/projects/${projectId}/results`, {
    signal: options.signal,
  });

  if (!resultsResponse.ok) return currentResults;

  const resultsData = await resultsResponse.json();
  const resultRows = Array.isArray(resultsData.results)
    ? (resultsData.results as CompletedResultRow[])
    : [];
  const completedRows = resultRows.filter(
    (item): item is { algorithm_id: string; status: string } =>
      Boolean(item.algorithm_id) && item.status === "Completed"
  );
  const completedIds = new Set(completedRows.map((item) => item.algorithm_id));
  const next: Record<string, AlgorithmStoredResult> = {};

  Object.entries(currentResults).forEach(([algorithmId, result]) => {
    if (completedIds.has(algorithmId)) {
      next[algorithmId] = result;
    }
  });

  options.onProgress?.({ ...next });

  const missingRows = completedRows.filter((item) => !next[item.algorithm_id]);
  const payloads = await Promise.all(
    missingRows.map(async (item) => {
      try {
        const response = await apiFetch(
          `${API_BASE}/projects/${projectId}/results/${item.algorithm_id}${limitQuery}`,
          { signal: options.signal },
        );

        if (!response.ok) return null;

        const data = await response.json();
        const result = data.result as AlgorithmStoredResult;
        const algorithmId = result?.algorithm_id || item.algorithm_id;

        if (result && algorithmId) {
          next[algorithmId] = {
            ...result,
            algorithm_id: algorithmId,
          };
          options.onProgress?.({ ...next });
        }

        return result;
      } catch {
        return null;
      }
    })
  );

  payloads.forEach((result, index) => {
    const fallbackAlgorithmId = missingRows[index]?.algorithm_id;
    const algorithmId = result?.algorithm_id || fallbackAlgorithmId;

    if (result && algorithmId) {
      next[algorithmId] = {
        ...result,
        algorithm_id: algorithmId,
      };
    }
  });

  return next;
}

type UseProjectDetailDataArgs = {
  projectId?: string;
  isDemoRoute: boolean;
};

export default function useProjectDetailData({ projectId, isDemoRoute }: UseProjectDetailDataArgs) {
  const [project, setProject] = useState<ProjectManifest | null>(null);
  const [metadata, setMetadata] = useState<MetadataManifest | null>(null);
  const [latestJob, setLatestJob] = useState<ProjectJob | null>(null);
  const [algorithmResults, setAlgorithmResults] = useState<Record<string, AlgorithmStoredResult>>({});
  const [algorithmCatalog, setAlgorithmCatalog] = useState<AlgorithmCatalogItem[]>([]);
  const [isLoadingCompletedResults, setIsLoadingCompletedResults] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [error, setError] = useState("");
  const algorithmResultsRef = useRef<Record<string, AlgorithmStoredResult>>({});

  const reload = useCallback(() => setReloadNonce((value) => value + 1), []);

  useEffect(() => {
    algorithmResultsRef.current = algorithmResults;
  }, [algorithmResults]);

  const hasActiveTasks = useMemo(() => {
    return (latestJob?.tasks ?? []).some(
      (task) =>
        task.status === "Queued" ||
        task.status === "Running" ||
        task.status === "Stopping"
    );
  }, [latestJob]);

  const refreshProjectData = useCallback(async () => {
    if (!projectId) return;

    try {
      const projectResponse = await apiFetch(`${API_BASE}/projects/${projectId}`);

      if (projectResponse.ok) {
        const projectData = await projectResponse.json();
        setProject((projectData.project ?? null) as ProjectManifest | null);
        setLatestJob((projectData.latest_job ?? null) as ProjectJob | null);
      }

      const metadataResponse = await apiFetch(`${API_BASE}/projects/${projectId}/metadata`);
      if (metadataResponse.ok) {
        const metadataData = await metadataResponse.json();
        setMetadata((metadataData.metadata ?? null) as MetadataManifest | null);
      }

      setIsLoadingCompletedResults(true);
      try {
        const nextResults = await loadCompletedAlgorithmResults(
          projectId,
          algorithmResultsRef.current,
          { onProgress: setAlgorithmResults }
        );
        setAlgorithmResults(nextResults);
      } finally {
        setIsLoadingCompletedResults(false);
      }
    } catch {
      return;
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    const loadAlgorithmCatalog = async () => {
      try {
        const response = await fetch(`${API_BASE}/algorithms`, {
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) return;

        const data = (await response.json()) as BackendAlgorithmEntry[];

        if (!cancelled) {
          setAlgorithmCatalog(
            data
              .filter((algorithm) => algorithm.active)
              .map(mapBackendAlgorithm)
          );
        }
      } catch {
        if (!cancelled) setAlgorithmCatalog([]);
      }
    };

    loadAlgorithmCatalog();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    const controller = new AbortController();

    const delay = (ms: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    const loadMetadata = async () => {
      try {
        const metadataResponse = await apiFetch(`${API_BASE}/projects/${projectId}/metadata`, {
          signal: controller.signal,
        });
        if (!cancelled && metadataResponse.ok) {
          const metadataData = await metadataResponse.json();
          setMetadata((metadataData.metadata ?? null) as MetadataManifest | null);
        }
      } catch {
        if (!cancelled) setMetadata(null);
      }
    };

    const load = async () => {
      setError("");
      setIsLoadingProject(true);
      setIsLoadingCompletedResults(true);

      // Metadata doesn't depend on the project fetch — load it in parallel.
      const metadataPromise = loadMetadata();

      // The project manifest is read by the API while other requests may still
      // be rewriting it. Retry a few times so a transient failure (or a torn
      // read that slips through) self-heals instead of blanking the page.
      let projectLoaded = false;
      let fetchedLatestJob: ProjectJob | null = null;
      for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
        try {
          const projectResponse = await apiFetch(`${API_BASE}/projects/${projectId}`, {
            signal: controller.signal,
          });

          if (projectResponse.ok) {
            const projectData = await projectResponse.json();
            if (cancelled) return;
            fetchedLatestJob = (projectData.latest_job ?? null) as ProjectJob | null;
            setProject((projectData.project ?? null) as ProjectManifest | null);
            setLatestJob(fetchedLatestJob);
            projectLoaded = true;
            break;
          }

          // A genuine 404 means the project is gone — retrying won't help.
          if (projectResponse.status === 404) break;
        } catch {
          if (cancelled || controller.signal.aborted) return;
        }

        if (attempt < 2) await delay(500);
      }

      if (cancelled) return;

      if (!projectLoaded) {
        setProject(null);
        setLatestJob(null);
        setIsLoadingProject(false);
        setIsLoadingCompletedResults(false);
        setError(
          isDemoRoute
            ? "Demo project data could not be loaded from the backend. Please make sure the backend is running and /api/projects/demo is available."
            : "We couldn't load this project. It may still be finishing up, or the connection dropped. Please try again."
        );
        await metadataPromise.catch(() => {});
        return;
      }

      setIsLoadingProject(false);

      const jobId = fetchedLatestJob?.job_id ?? null;
      const projectHasActiveTasks = (fetchedLatestJob?.tasks ?? []).some(
        (task) =>
          task.status === "Queued" ||
          task.status === "Running" ||
          task.status === "Stopping"
      );

      // A project we've already fully loaded this session (and that isn't still
      // running) is served straight from cache — instant, no network for edges.
      if (!projectHasActiveTasks) {
        const cached = getCachedResults(projectId, jobId);
        if (cached) {
          setAlgorithmResults(cached);
          setIsLoadingCompletedResults(false);
          await metadataPromise;
          return;
        }
      }

      // Phase 1 — load only the strongest edges per algorithm so the network and
      // table paint quickly. The initial view only needs the top handful.
      try {
        const lightResults = await loadCompletedAlgorithmResults(projectId, {}, {
          signal: controller.signal,
          limit: FIRST_PAINT_EDGE_LIMIT,
          onProgress: (results) => {
            if (!cancelled) setAlgorithmResults(results);
          },
        });
        if (!cancelled) setAlgorithmResults(lightResults);
      } catch {
        if (!cancelled) setAlgorithmResults({});
      } finally {
        if (!cancelled) setIsLoadingCompletedResults(false);
      }

      // Phase 2 — fetch the full, untrimmed edge lists in the background (no
      // progress callback, so the visible network doesn't flicker while it
      // rebuilds), then swap them in and cache them for instant re-opens.
      if (!cancelled) {
        loadCompletedAlgorithmResults(projectId, {}, { signal: controller.signal })
          .then((fullResults) => {
            if (cancelled) return;
            setAlgorithmResults(fullResults);
            if (!projectHasActiveTasks) {
              setCachedResults(projectId, jobId, fullResults);
            }
          })
          .catch(() => {});
      }

      await metadataPromise;
    };

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isDemoRoute, projectId, reloadNonce]);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const projectResponse = await apiFetch(`${API_BASE}/projects/${projectId}`, {
          signal: controller.signal,
        });

        if (projectResponse.ok) {
          const projectData = await projectResponse.json();

          if (!cancelled) {
            setProject((projectData.project ?? null) as ProjectManifest | null);
            setLatestJob((projectData.latest_job ?? null) as ProjectJob | null);
          }
        }

        const metadataResponse = await apiFetch(`${API_BASE}/projects/${projectId}/metadata`, {
          signal: controller.signal,
        });
        if (metadataResponse.ok) {
          const metadataData = await metadataResponse.json();

          if (!cancelled) {
            setMetadata((metadataData.metadata ?? null) as MetadataManifest | null);
          }
        }

        if (!cancelled) setIsLoadingCompletedResults(true);
        try {
          const nextResults = await loadCompletedAlgorithmResults(
            projectId,
            algorithmResultsRef.current,
            {
              signal: controller.signal,
              onProgress: (results) => {
                if (!cancelled) setAlgorithmResults(results);
              },
            }
          );
          if (!cancelled) setAlgorithmResults(nextResults);
        } finally {
          if (!cancelled) setIsLoadingCompletedResults(false);
        }
      } catch {
        return;
      }
    };

    const interval = window.setInterval(() => {
      if (hasActiveTasks && projectId !== "demo") {
        poll();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [hasActiveTasks, projectId]);

  return {
    project,
    metadata,
    latestJob,
    algorithmResults,
    algorithmCatalog,
    isLoadingCompletedResults,
    isLoadingProject,
    error,
    reload,
    refreshProjectData,
    setLatestJob,
  };
}
