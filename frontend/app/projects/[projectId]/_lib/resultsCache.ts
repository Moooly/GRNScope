import type { AlgorithmStoredResult } from "./types";

/**
 * In-memory cache of fully-loaded algorithm results, so navigating back into a
 * project you already opened this session is instant instead of re-fetching and
 * re-parsing every edge list.
 *
 * Lifetime = the current tab's app session: it survives in-app navigation and
 * is cleared on a full page reload (module re-evaluation) or tab close — so it
 * can never serve edges that are stale across sessions. Keyed by projectId + the
 * latest jobId, and explicitly cleared on any rerun/stop mutation.
 */
const cache = new Map<string, Record<string, AlgorithmStoredResult>>();

function cacheKey(projectId: string, jobId: string | null | undefined) {
  return `${projectId}::${jobId ?? "no-job"}`;
}

export function getCachedResults(
  projectId: string,
  jobId: string | null | undefined,
): Record<string, AlgorithmStoredResult> | undefined {
  return cache.get(cacheKey(projectId, jobId));
}

export function setCachedResults(
  projectId: string,
  jobId: string | null | undefined,
  results: Record<string, AlgorithmStoredResult>,
): void {
  cache.set(cacheKey(projectId, jobId), results);
}

/** Drop every cached entry for a project (any jobId) — call after a mutation. */
export function clearCachedResults(projectId: string): void {
  const prefix = `${projectId}::`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
