import { API_BASE } from "../../../_lib/apiConfig";
import { apiFetch } from "../../../_lib/clientIdentity";
import type { AlgorithmStoredResult } from "./types";

export const COMPLETED_RESULTS_ERROR_MESSAGE =
  "We couldn't load the saved algorithm results. Please try again.";
const resultRevisions = new WeakMap<AlgorithmStoredResult, string>();

type CompletedResultRow = {
  algorithm_id?: string;
  status?: string;
  completed_at?: string | null;
  completed_at_timestamp?: number | null;
  started_at?: string | null;
  result_path?: string | null;
};

export async function loadCompletedAlgorithmResults(
  projectId: string,
  currentResults: Record<string, AlgorithmStoredResult> = {},
  options: {
    onProgress?: (results: Record<string, AlgorithmStoredResult>) => void;
    signal?: AbortSignal;
    limit?: number;
    coordinateSpecies?: string | null;
  } = {}
) {
  const limitQuery =
    options.limit && options.limit > 0 ? `?limit=${options.limit}` : "";
  const resultsResponse = await apiFetch(`${API_BASE}/projects/${projectId}/results`, {
    signal: options.signal,
  });

  if (!resultsResponse.ok) {
    throw new Error(COMPLETED_RESULTS_ERROR_MESSAGE);
  }

  const resultsData = await resultsResponse.json();
  const resultRows = Array.isArray(resultsData.results)
    ? (resultsData.results as CompletedResultRow[])
    : [];
  const completedRows = resultRows.filter(
    (item): item is { algorithm_id: string; status: string } =>
      Boolean(item.algorithm_id) && item.status === "Completed"
  );
  const revisions = new Map(completedRows.map((item) => [item.algorithm_id,
    JSON.stringify([resultsData.job_id, item]),
  ]));
  const next: Record<string, AlgorithmStoredResult> = {};

  Object.entries(currentResults).forEach(([algorithmId, result]) => {
    const sameSpecies = options.coordinateSpecies === undefined ||
      (result.genome_reference?.species ?? null) === options.coordinateSpecies;
    if (sameSpecies && resultRevisions.get(result) === revisions.get(algorithmId) && revisions.has(algorithmId)) {
      next[algorithmId] = result;
    }
  });


  const missingRows = completedRows.filter((item) => !next[item.algorithm_id]);
  const payloads = await Promise.all(
    missingRows.map(async (item) => {
      const response = await apiFetch(
        `${API_BASE}/projects/${projectId}/results/${item.algorithm_id}${limitQuery}`,
        { signal: options.signal },
      );

      if (!response.ok) {
        throw new Error(COMPLETED_RESULTS_ERROR_MESSAGE);
      }

      const data = await response.json();
      const result = data.result as AlgorithmStoredResult;
      const algorithmId = result?.algorithm_id || item.algorithm_id;

      if (!result || !algorithmId) {
        throw new Error(COMPLETED_RESULTS_ERROR_MESSAGE);
      }

      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const normalized = { ...result, algorithm_id: algorithmId };
      // A first-paint preview must never count as a complete cached result.
      if (!options.limit) resultRevisions.set(normalized, revisions.get(item.algorithm_id)!);
      return normalized;
    })
  );

  payloads.forEach((result, index) => {
    const fallbackAlgorithmId = missingRows[index]?.algorithm_id;
    const algorithmId = result?.algorithm_id || fallbackAlgorithmId;

    if (result && algorithmId) {
      next[algorithmId] = result;
    }
  });

  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const unchanged = Object.keys(next).length === Object.keys(currentResults).length &&
    Object.entries(next).every(([id, result]) => currentResults[id] === result);
  const results = unchanged ? currentResults : next;
  options.onProgress?.(results);
  return results;
}
