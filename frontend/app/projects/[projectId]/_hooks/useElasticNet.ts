"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE } from "../../../_lib/apiConfig";
import { apiFetch } from "../../../_lib/clientIdentity";
import type { NetworkEdge } from "../_components/networkGraphTypes";
import { attachElasticCoefficients, elasticNetPairs, elasticPairKey, type ElasticNetCoefficient } from "../_lib/elasticNet";

type Result = { key: string; rows?: ElasticNetCoefficient[]; error?: string };

/** Candidate edges precede display thresholds, so filtering cannot refit beta. */
export function useElasticNet(projectId: string | undefined, scopeId: string, candidates: NetworkEdge[]) {
  const pairsJson = useMemo(() => JSON.stringify(elasticNetPairs(candidates)), [candidates]);
  const requestKey = JSON.stringify([projectId, scopeId, pairsJson]);
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!projectId || pairsJson === "[]") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/elastic-net`, {
            method: "POST", signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope_id: scopeId, pairs: JSON.parse(pairsJson) }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "Could not calculate Elastic Net coefficients.");
          if (!controller.signal.aborted) setResult({ key: requestKey, rows: payload.coefficients });
        } catch (error) {
          if (!controller.signal.aborted) setResult({ key: requestKey, error: error instanceof Error ? error.message : "Elastic Net is unavailable." });
        }
      })();
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [projectId, scopeId, pairsJson, requestKey, attempt]);
  const current = result?.key === requestKey ? result : null;
  const coefficients = useMemo(() => new Map((current?.rows ?? []).map(row => [elasticPairKey(row.source, row.target), row])), [current?.rows]);
  const enrich = useCallback(<E extends NetworkEdge>(edges: E[]): E[] => attachElasticCoefficients(edges, coefficients), [coefficients]);
  return {
    enrich, loading: Boolean(projectId && pairsJson !== "[]" && !current),
    error: current?.error ?? "", ready: Boolean(current?.rows),
    retry: () => { setResult(null); setAttempt(value => value + 1); },
  };
}
