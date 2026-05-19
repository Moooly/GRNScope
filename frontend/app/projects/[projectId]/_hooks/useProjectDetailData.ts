"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AlgorithmCatalogItem,
  AlgorithmStoredResult,
  MetadataManifest,
  ProjectJob,
  ProjectManifest,
} from "../_lib/types";
import { apiFetch } from "../../../_lib/clientIdentity";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";
const API_ROOT = API_BASE.replace(/\/api\/?$/, "");
const POLL_INTERVAL_MS = 5000;

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
  estimated_runtime: string;
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

async function loadCompletedAlgorithmResults(projectId: string) {
  const resultsResponse = await apiFetch(`${API_BASE}/projects/${projectId}/results`);

  if (!resultsResponse.ok) return {};

  const resultsData = await resultsResponse.json();
  const resultRows = Array.isArray(resultsData.results)
    ? (resultsData.results as CompletedResultRow[])
    : [];
  const completedRows = resultRows.filter(
    (item): item is { algorithm_id: string; status: string } =>
      Boolean(item.algorithm_id) && item.status === "Completed"
  );

  const payloads = await Promise.all(
    completedRows.map(async (item) => {
      try {
        const response = await apiFetch(
          `${API_BASE}/projects/${projectId}/results/${item.algorithm_id}`
        );

        if (!response.ok) return null;

        const data = await response.json();
        return data.result as AlgorithmStoredResult;
      } catch {
        return null;
      }
    })
  );

  const next: Record<string, AlgorithmStoredResult> = {};

  payloads.forEach((result, index) => {
    const fallbackAlgorithmId = completedRows[index]?.algorithm_id;
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
  const [error, setError] = useState("");

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

      const nextResults = await loadCompletedAlgorithmResults(projectId);
      setAlgorithmResults(nextResults);
    } catch {
      return;
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    const loadAlgorithmCatalog = async () => {
      try {
        const response = await fetch(`${API_ROOT}/algorithms`, {
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

    const load = async () => {
      setError("");

      try {
        const projectResponse = await apiFetch(`${API_BASE}/projects/${projectId}`);

        if (!projectResponse.ok) {
          if (!cancelled) {
            setProject(null);
            setLatestJob(null);

            if (isDemoRoute) {
              setError(
                "Demo project data could not be loaded from the backend. Please make sure the backend is running and /api/projects/demo is available."
              );
            }
          }
          return;
        }

        const projectData = await projectResponse.json();
        if (cancelled) return;

        setProject((projectData.project ?? null) as ProjectManifest | null);
        setLatestJob((projectData.latest_job ?? null) as ProjectJob | null);
      } catch {
        if (!cancelled) {
          setProject(null);
          setLatestJob(null);
        }
      }

      try {
        const metadataResponse = await apiFetch(`${API_BASE}/projects/${projectId}/metadata`);

        if (!cancelled && metadataResponse.ok) {
          const metadataData = await metadataResponse.json();
          setMetadata((metadataData.metadata ?? null) as MetadataManifest | null);
        }
      } catch {
        if (!cancelled) setMetadata(null);
      }

      try {
        const nextResults = await loadCompletedAlgorithmResults(projectId);
        if (!cancelled) setAlgorithmResults(nextResults);
      } catch {
        if (!cancelled) setAlgorithmResults({});
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [isDemoRoute, projectId]);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const projectResponse = await apiFetch(`${API_BASE}/projects/${projectId}`);

        if (projectResponse.ok) {
          const projectData = await projectResponse.json();

          if (!cancelled) {
            setProject((projectData.project ?? null) as ProjectManifest | null);
            setLatestJob((projectData.latest_job ?? null) as ProjectJob | null);
          }
        }

        const nextResults = await loadCompletedAlgorithmResults(projectId);
        if (!cancelled) setAlgorithmResults(nextResults);
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
      window.clearInterval(interval);
    };
  }, [hasActiveTasks, projectId]);

  return {
    project,
    metadata,
    latestJob,
    algorithmResults,
    algorithmCatalog,
    error,
    refreshProjectData,
    setLatestJob,
  };
}
