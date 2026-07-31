"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Core } from "cytoscape";
import ProjectHeader from "./_components/ProjectHeader";
import ResultsControlsSection from "./_components/ResultsControlsSection";
import NetworkVisualizationSection from "./_components/NetworkVisualizationSection";
import AlgorithmErrorPopover from "./_components/AlgorithmErrorPopover";
import ConfirmDownloadModal from "./_components/ConfirmDownloadModal";
import FileDownloadMenuModal from "./_components/FileDownloadMenuModal";
import ResultsGuideModal from "./_components/ResultsGuideModal";
import AlgorithmCardsSection from "./_components/AlgorithmCardsSection";
import DatasetPreprocessingSection, {
  type MethodGeneAdjustment,
} from "./_components/DatasetPreprocessingSection";
import JobProgressBanner from "./_components/JobProgressBanner";
import DatasetValidationStatus from "./_components/DatasetValidationStatus";
import DatasetValidationIssuesSection from "./_components/DatasetValidationIssuesSection";
import ResultsHubSection from "./_components/ResultsHubSection";
import ResultsHubViewSelector, {
  type ResultsHubView,
} from "./_components/ResultsHubViewSelector";
import ResultsInsightsSection, {
  type VisualizationContext,
} from "./_components/ResultsInsightsSection";
import PerturbationAnalysisSection from "./_components/PerturbationAnalysisSection";
import AnalysisSetupSection from "./_components/AnalysisSetupSection";
import StopProjectModal from "../_components/StopProjectModal";
import useProjectDetailData from "./_hooks/useProjectDetailData";
import { clearCachedResults } from "./_lib/resultsCache";
import { API_BASE } from "../../_lib/apiConfig";
import { apiFetch } from "../../_lib/clientIdentity";
import { startPendingProjectUpload } from "../_lib/pendingProjectUpload";

import {
  type AggregatedEdge,
  type AlgorithmResultEdge,
  type AlgorithmStoredResult,
  type MetadataManifest,
  type NodeInfo,
  type ProjectJob,
  type ProjectManifest,
} from "./_lib/types";
import { clamp } from "./_lib/utils";

const CONFIDENCE_STABILITY_TOP_K = 10;
const MODAL_ANIMATION_MS = 480;
// Number of strongest edges to reveal when a project detail page first opens.
const INITIAL_VISIBLE_EDGE_TARGET = 10;
// Shown for algorithm failures that aren't user-actionable (most are internal).
const GENERAL_ALGORITHM_FAILURE_MESSAGE =
  "This algorithm couldn't finish. This is usually a temporary processing issue on our side, not a problem with your data. Try running it again, and contact us if it keeps failing.";
const CELLORACLE_SPECIES_ERROR_TYPE = "celloracle_species_mismatch";

function isCellOracleSpeciesMismatch(
  algorithmId: string,
  errorMessage: string,
) {
  if (algorithmId.toUpperCase() !== "CELLORACLE") return false;
  const normalized = errorMessage.toLowerCase();
  const identifiesBaseNetwork =
    normalized.includes("base grn") ||
    normalized.includes("base regulatory network") ||
    normalized.includes("tf info");
  const identifiesDatasetMismatch =
    normalized.includes("no overlap") &&
    (normalized.includes("scrna-seq") ||
      normalized.includes("transcription factor") ||
      normalized.includes("species"));
  return identifiesBaseNetwork && identifiesDatasetMismatch;
}

const ALGORITHM_GENE_LIMIT_DEFAULTS: Record<string, number> = {
  PIDC: 500,
  PPCOR: 500,
  SINCERITIES: 500,
  SCRIBE: 300,
  SINGE: 500,
  GRISLI: 500,
  GRNVBEM: 500,
};
const ALGORITHM_GENE_ADJUSTMENT_REASONS: Record<string, string> = {
  PIDC: "Keeps triplet calculations practical.",
  PPCOR: "Keeps partial-correlation statistics valid and practical.",
  SINCERITIES: "Keeps partial-correlation calculations stable.",
  SCRIBE: "Keeps pairwise information calculations practical.",
  SINGE: "Keeps lagged calculations practical.",
  GRISLI: "Keeps velocity and stability calculations practical.",
  GRNVBEM: "Keeps dense Bayesian calculations practical.",
};

type GeneCoordinateInfo = {
  chromosome?: string | null;
  start?: number | null;
  end?: number | null;
  strand?: string | null;
  gene_type?: string | null;
  gene_id?: string | null;
};

const edgeKeyFor = (source: string, target: string) => `${source}|||${target}`;

function median(values: number[]) {
  if (values.length === 0) return null;
  const sortedValues = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sortedValues.length / 2);

  return sortedValues.length % 2 === 0
    ? (sortedValues[midpoint - 1] + sortedValues[midpoint]) / 2
    : sortedValues[midpoint];
}

function edgesForScope(
  result: AlgorithmStoredResult | undefined,
  scopeId: string
): AlgorithmResultEdge[] {
  if (!result) return [];
  if (result.scopes?.[scopeId]?.status === "Completed") {
    return result.scopes[scopeId]?.top_edges ?? [];
  }
  if (scopeId === "global") {
    return result.top_edges ?? [];
  }
  return [];
}

function numericEdgeScore(edge: AlgorithmResultEdge) {
  const rawScore = Number(edge.score ?? edge.weight ?? edge.edge_weight ?? 0);
  return Number.isFinite(rawScore) ? rawScore : 0;
}

function numericEvidenceScore(edge: AlgorithmResultEdge, fallback: number) {
  const normalizedScore = Number(edge.normalized_score);
  if (Number.isFinite(normalizedScore)) return clamp(normalizedScore, 0, 1);

  const meanPercentile = numericMeanPercentile(edge);
  if (meanPercentile !== null) return meanPercentile;

  const score = Number(edge.score);
  if (Number.isFinite(score) && score >= 0 && score <= 1) return score;

  const confidence = numericEdgeConfidence(edge);
  if (confidence !== null) return confidence;

  return fallback;
}

function numericConfidenceScore(edge: AlgorithmResultEdge, fallbackPercentile: number) {
  const confidence = numericEdgeConfidence(edge);
  if (confidence !== null) return confidence;

  const stability = numericStability(edge);
  const meanPercentile = numericMeanPercentile(edge) ?? fallbackPercentile;

  if (stability !== null) {
    return clamp(stability * meanPercentile, 0, 1);
  }

  return meanPercentile;
}

function numericSignedEdgeScore(edge: AlgorithmResultEdge) {
  const signedScore = Number(
    edge.mean_raw_score ?? edge.weight ?? edge.edge_weight ?? edge.score ?? 0
  );
  return Number.isFinite(signedScore) ? signedScore : 0;
}

function numericEdgeConfidence(edge: AlgorithmResultEdge) {
  const confidence = Number(edge.confidence);
  return Number.isFinite(confidence) ? clamp(confidence, 0, 1) : null;
}

function numericMeanPercentile(edge: AlgorithmResultEdge) {
  const meanPercentile = Number(edge.mean_percentile ?? edge.meanPercentile);
  return Number.isFinite(meanPercentile) ? clamp(meanPercentile, 0, 1) : null;
}

function numericStability(edge: AlgorithmResultEdge) {
  const stability = Number(edge.stability);
  return Number.isFinite(stability) ? clamp(stability, 0, 1) : null;
}

function numericOptionalProbability(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const probability = Number(value);
  return Number.isFinite(probability) ? clamp(probability, 0, 1) : null;
}

function signOf(value: number): -1 | 0 | 1 {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function assignAverageRanks<T extends { rank: number }>(
  sortedRows: T[],
  hasSameRank: (first: T, second: T) => boolean
) {
  const rows = [...sortedRows];
  let index = 0;

  while (index < rows.length) {
    let tieEnd = index + 1;
    while (tieEnd < rows.length && hasSameRank(rows[index], rows[tieEnd])) {
      tieEnd += 1;
    }

    const rank = ((index + 1) + tieEnd) / 2;
    for (let rankIndex = index; rankIndex < tieEnd; rankIndex += 1) {
      rows[rankIndex] = { ...rows[rankIndex], rank };
    }
    index = tieEnd;
  }

  return rows;
}

const CIRCOS_EXPORT_STYLE_PROPERTIES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
];

function getSvgExportSize(svgElement: SVGSVGElement) {
  const viewBox = svgElement.getAttribute("viewBox");
  const viewBoxValues = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map((value) => Number.parseFloat(value));

  const viewBoxWidth =
    viewBoxValues && viewBoxValues.length === 4 && Number.isFinite(viewBoxValues[2])
      ? viewBoxValues[2]
      : 0;
  const viewBoxHeight =
    viewBoxValues && viewBoxValues.length === 4 && Number.isFinite(viewBoxValues[3])
      ? viewBoxValues[3]
      : 0;

  const fallbackWidth = svgElement.viewBox.baseVal.width || svgElement.clientWidth || 780;
  const fallbackHeight = svgElement.viewBox.baseVal.height || svgElement.clientHeight || 780;
  const width = viewBoxWidth > 0 ? viewBoxWidth : fallbackWidth;
  const height = viewBoxHeight > 0 ? viewBoxHeight : fallbackHeight;

  return {
    width,
    height,
    viewBox: viewBox ?? `0 0 ${width} ${height}`,
  };
}

function inlineSvgComputedStyles(sourceSvg: SVGSVGElement, clonedSvg: SVGSVGElement) {
  const sourceElements = [
    sourceSvg,
    ...Array.from(sourceSvg.querySelectorAll<SVGElement>("*")),
  ];
  const clonedElements = [
    clonedSvg,
    ...Array.from(clonedSvg.querySelectorAll<SVGElement>("*")),
  ];

  sourceElements.forEach((sourceElement, index) => {
    const clonedElement = clonedElements[index];
    if (!clonedElement) return;

    const computedStyle = window.getComputedStyle(sourceElement);
    const inlineStyle = CIRCOS_EXPORT_STYLE_PROPERTIES
      .map((property) => {
        const value = computedStyle.getPropertyValue(property);
        return value ? `${property}:${value}` : "";
      })
      .filter(Boolean)
      .join(";");

    if (inlineStyle) {
      clonedElement.setAttribute("style", inlineStyle);
    }
    clonedElement.removeAttribute("class");
  });
}

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const routeProjectId = Array.isArray(params?.projectId) ? params.projectId[0] : params?.projectId;
  const projectId = routeProjectId === "sample" ? "demo" : routeProjectId;
  const isDemoRoute = projectId === "demo" || routeProjectId === "sample";

  const {
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
  } = useProjectDetailData({ projectId, isDemoRoute });
  const [selectedAlgorithmIds, setSelectedAlgorithmIds] = useState<string[]>([]);
  const [selectedResultScopeId, setSelectedResultScopeId] = useState("global");
  const [evidenceThreshold, setEvidenceThreshold] = useState(0.8);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.8);
  const [directionConfidenceThreshold, setDirectionConfidenceThreshold] = useState(0);
  const [signConfidenceThreshold, setSignConfidenceThreshold] = useState(0);
  const [consensusThreshold, setConsensusThreshold] = useState(1);
  const [hasTouchedConsensusThreshold, setHasTouchedConsensusThreshold] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [edgeDisplayLimit, setEdgeDisplayLimit] = useState(20);
  const [networkLayout, setNetworkLayout] = useState<"force" | "hierarchical" | "concentric" | "circular" | "circos">("force");
  const [selectedGene, setSelectedGene] = useState<string | null>(null);
  const [perturbationEntryGene, setPerturbationEntryGene] = useState<string | null>(null);
  const [perturbationGenes, setPerturbationGenes] = useState<string[]>([]);
  const [isolatedGene, setIsolatedGene] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [pendingDownload, setPendingDownload] = useState<{ label: string; href: string; filename: string } | null>(null);
  const [isDownloadModalClosing, setIsDownloadModalClosing] = useState(false);
  const [isFileDownloadMenuOpen, setIsFileDownloadMenuOpen] = useState(false);
  const [isResultsGuideOpen, setIsResultsGuideOpen] = useState(false);
  const [activeAlgorithmError, setActiveAlgorithmError] = useState<{
    task: {
      algorithmId: string;
      errorMessage: string;
      errorType?: string | null;
    };
    anchorElement: HTMLElement;
  } | null>(null);
  const [pendingAlgorithmAction, setPendingAlgorithmAction] = useState<{
    type: "stop" | "rerun";
    algorithmId: string;
    algorithmName: string;
  } | null>(null);
  const [isAlgorithmActionSubmitting, setIsAlgorithmActionSubmitting] = useState(false);
  const [isAlgorithmActionModalClosing, setIsAlgorithmActionModalClosing] = useState(false);
  const [algorithmActionError, setAlgorithmActionError] = useState("");
  const [isStopProjectModalOpen, setIsStopProjectModalOpen] = useState(false);
  const [isStopProjectModalClosing, setIsStopProjectModalClosing] = useState(false);
  const [isStoppingProject, setIsStoppingProject] = useState(false);
  const [stopProjectError, setStopProjectError] = useState("");
  const [resultsHubView, setResultsHubView] = useState<ResultsHubView>("network");
  const [visualizationContext, setVisualizationContext] =
    useState<VisualizationContext | null>(null);
  const [isVisualizationContextLoading, setIsVisualizationContextLoading] = useState(false);
  const [trajectoryRequestedGenes, setTrajectoryRequestedGenes] = useState<string[]>([]);

  const seededProjectIdRef = useRef<string | null>(null);
  const networkGraphRef = useRef<Core | null>(null);
  const hasAppliedDemoDefaultsRef = useRef(false);
  const algorithmActionCloseTimeoutRef = useRef<number | null>(null);

  const demoProjectFlag = project as (ProjectManifest & { is_demo?: boolean; read_only?: boolean }) | null;
  const demoMetadataFlag = metadata as (MetadataManifest & { is_demo?: boolean; read_only?: boolean }) | null;
  const isDemoProject = isDemoRoute || demoProjectFlag?.is_demo === true || demoMetadataFlag?.is_demo === true;

  useEffect(() => {
    if (!projectId || (!project && !metadata)) {
      setVisualizationContext(null);
      return;
    }
    const controller = new AbortController();
    setIsVisualizationContextLoading(true);
    const query = trajectoryRequestedGenes.length
      ? `?genes=${encodeURIComponent(trajectoryRequestedGenes.join(","))}`
      : "";
    void apiFetch(`${API_BASE}/projects/${projectId}/visualization-context${query}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Visualization context is unavailable.");
        return response.json() as Promise<VisualizationContext>;
      })
      .then((payload) => {
        if (!controller.signal.aborted) setVisualizationContext(payload);
      })
      .catch(() => {
        if (!controller.signal.aborted) setVisualizationContext(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsVisualizationContextLoading(false);
      });
    return () => controller.abort();
  }, [metadata, project, projectId, trajectoryRequestedGenes]);

  useEffect(() => {
    return () => {
      if (algorithmActionCloseTimeoutRef.current) {
        window.clearTimeout(algorithmActionCloseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!projectId || isDemoRoute) return;

    const uploadPromise = startPendingProjectUpload(projectId, API_BASE);
    if (!uploadPromise) return;

    void uploadPromise
      .catch(() => {
        return undefined;
      })
      .finally(() => {
        void refreshProjectData();
      });
  }, [isDemoRoute, projectId, refreshProjectData]);

  const matrixTreatmentLabel = isDemoProject
    ? "Already log-normalized"
    : metadata?.preprocessing?.matrix_state === "raw"
      ? "Normalized · ln(x + 1)"
      : metadata?.preprocessing?.matrix_state === "normalized"
        ? "ln(x + 1)"
        : metadata?.preprocessing?.matrix_state === "log_normalized"
          ? "Already log-normalized"
          : "Pending";

  const rawJobTasks = useMemo(() => latestJob?.tasks ?? [], [latestJob]);
  const legacyMatrixValidationTask = useMemo(
    () => rawJobTasks.find((task) => task.error_type === "matrix_validation") ?? null,
    [rawJobTasks],
  );
  const matrixValidationError =
    project?.dataset_validation_error ??
    metadata?.dataset_validation_error ??
    (latestJob?.setup_error_type === "matrix_validation"
      ? latestJob.setup_error_message
      : null) ??
    legacyMatrixValidationTask?.error_message ??
    null;
  const setupErrorType =
    latestJob?.setup_error_type ??
    project?.setup_error_type ??
    metadata?.setup_error_type ??
    null;
  const setupErrorMessage =
    latestJob?.setup_error_message ??
    project?.setup_error_message ??
    metadata?.setup_error_message ??
    null;
  const projectSetupError = matrixValidationError ?? setupErrorMessage;
  const isMatrixSetupError =
    Boolean(matrixValidationError) || setupErrorType === "matrix_validation";
  const matrixValidationIssues = useMemo(
    () =>
      project?.dataset_validation_issues ??
      metadata?.dataset_validation_issues ??
      latestJob?.setup_validation_issues ??
      [],
    [latestJob?.setup_validation_issues, metadata?.dataset_validation_issues, project?.dataset_validation_issues],
  );
  const allJobTasks = useMemo(
    () =>
      projectSetupError
        ? rawJobTasks.map((task) => ({
            ...task,
            status: "NotStarted",
            elapsed_seconds: 0,
            error_message: null,
            error_type: null,
            progress_percent: 0,
            progress_label: "Not started",
          }))
        : rawJobTasks,
    [projectSetupError, rawJobTasks],
  );
  const cellOracleTask = useMemo(
    () => allJobTasks.find((task) => task.algorithm_id.toUpperCase() === "CELLORACLE") ?? null,
    [allJobTasks]
  );
  const cellOracleReady = cellOracleTask?.status === "Completed" && !isDemoProject;

  useEffect(() => {
    if (!cellOracleReady || !projectId) {
      setPerturbationGenes([]);
      return;
    }
    const controller = new AbortController();
    void apiFetch(`${API_BASE}/projects/${projectId}/perturbations`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return [];
        const payload = await response.json();
        return Array.isArray(payload?.perturbations?.eligible_genes)
          ? payload.perturbations.eligible_genes as string[]
          : [];
      })
      .then((genes) => {
        if (!controller.signal.aborted) setPerturbationGenes(genes);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPerturbationGenes([]);
      });
    return () => controller.abort();
  }, [cellOracleReady, projectId]);

  useEffect(() => {
    if (!cellOracleReady && resultsHubView === "perturbation") {
      setResultsHubView("network");
    }
  }, [cellOracleReady, resultsHubView]);

  const completedTasks = useMemo(
    () => allJobTasks.filter((task) => task.status === "Completed"),
    [allJobTasks]
  );

  const completedAlgorithmIds = useMemo(
    () => completedTasks.map((task) => task.algorithm_id),
    [completedTasks]
  );

  const loadedCompletedAlgorithmCount = useMemo(() => {
    return completedAlgorithmIds.filter((algorithmId) => Boolean(algorithmResults[algorithmId]))
      .length;
  }, [algorithmResults, completedAlgorithmIds]);

  const isPreparingFinishedResults =
    completedAlgorithmIds.length > 0 &&
    loadedCompletedAlgorithmCount < completedAlgorithmIds.length &&
    isLoadingCompletedResults;


  // When new algorithms finish, merge them into the user's current selection
  // instead of wiping it. The demo project is read-only and already completed,
  // so always select all completed demo algorithms by default.
  const previousCompletedIdsRef = useRef<string[]>([]);
  useEffect(() => {
    if (projectId === "demo" || routeProjectId === "sample") {
      setSelectedAlgorithmIds(completedAlgorithmIds);
      previousCompletedIdsRef.current = completedAlgorithmIds;
      return;
    }

    const previous = previousCompletedIdsRef.current;
    const newlyCompleted = completedAlgorithmIds.filter(
      (id) => !previous.includes(id)
    );

    setSelectedAlgorithmIds((current) => {
      // First completion: select all
      if (previous.length === 0) {
        return completedAlgorithmIds;
      }
      if (newlyCompleted.length === 0) {
        // Drop any selections for algorithms that are no longer completed
        return current.filter((id) => completedAlgorithmIds.includes(id));
      }
      const merged = [...current];
      for (const id of newlyCompleted) {
        if (!merged.includes(id)) merged.push(id);
      }
      return merged.filter((id) => completedAlgorithmIds.includes(id));
    });

    previousCompletedIdsRef.current = completedAlgorithmIds;
  }, [completedAlgorithmIds, projectId, routeProjectId]);

  const activeAlgorithmIds = useMemo(() => {
    return selectedAlgorithmIds.filter((id) => completedAlgorithmIds.includes(id));
  }, [completedAlgorithmIds, selectedAlgorithmIds]);

  const availableResultScopes = useMemo(() => {
    const scopeById = new Map<
      string,
      { id: string; label: string; type: string; cellCount?: number; skipped?: boolean }
    >();
    scopeById.set("global", { id: "global", label: "Global", type: "global" });

    completedAlgorithmIds.forEach((algorithmId) => {
      const result = algorithmResults[algorithmId];
      const scopes = result?.scopes;
      if (!scopes) return;

      Object.entries(scopes).forEach(([scopeId, scope]) => {
        const existing = scopeById.get(scopeId);
        scopeById.set(scopeId, {
          id: scopeId,
          label: scope.scope_label || existing?.label || scopeId,
          type: scope.scope_type || existing?.type || "cluster",
          cellCount: scope.cell_count ?? existing?.cellCount,
          skipped: existing?.skipped ?? scope.status === "Skipped",
        });
      });
    });

    return Array.from(scopeById.values()).sort((a, b) => {
      if (a.id === "global") return -1;
      if (b.id === "global") return 1;
      return a.label.localeCompare(b.label);
    });
  }, [algorithmResults, completedAlgorithmIds]);

  useEffect(() => {
    if (availableResultScopes.some((scope) => scope.id === selectedResultScopeId)) {
      return;
    }
    setSelectedResultScopeId("global");
  }, [availableResultScopes, selectedResultScopeId]);

  useEffect(() => {
    if (!isDemoProject || hasAppliedDemoDefaultsRef.current) return;
    if (activeAlgorithmIds.length < 7) return;

    setEvidenceThreshold(0.8);
    setConfidenceThreshold(0.8);
    setConsensusThreshold(7);
    setHasTouchedConsensusThreshold(true);
    hasAppliedDemoDefaultsRef.current = true;
  }, [isDemoProject, activeAlgorithmIds.length]);

  const algorithmMetaMap = useMemo(
    () => new Map(algorithmCatalog.map((item) => [item.id, item])),
    [algorithmCatalog]
  );

  const methodGeneAdjustments = useMemo<MethodGeneAdjustment[]>(() => {
    const projectWideGeneCount =
      metadata?.preprocessing_result?.gene_count ?? metadata?.gene_count;
    const cellCount =
      metadata?.preprocessing_result?.cell_count ?? metadata?.cell_count;
    if (typeof projectWideGeneCount !== "number") return [];

    return allJobTasks.flatMap<MethodGeneAdjustment>((task) => {
      const algorithmId = task.algorithm_id.toUpperCase();
      const defaultLimit = ALGORITHM_GENE_LIMIT_DEFAULTS[algorithmId];
      if (!defaultLimit) return [];

      const recordedSummary =
        algorithmResults[task.algorithm_id]?.algorithm_preprocessing ??
        algorithmResults[algorithmId]?.algorithm_preprocessing;
      if (recordedSummary && recordedSummary.applied === false) return [];

      if (
        recordedSummary?.applied === true &&
        typeof recordedSummary.effective_gene_limit === "number"
      ) {
        return [
          {
            algorithmId,
            algorithmName: algorithmMetaMap.get(task.algorithm_id)?.name ?? algorithmId,
            inputGeneCount: recordedSummary.input_gene_count,
            retainedGeneCount: recordedSummary.retained_gene_count,
            effectiveGeneLimit: recordedSummary.effective_gene_limit,
            reason: ALGORITHM_GENE_ADJUSTMENT_REASONS[algorithmId],
            recorded: true,
            geneAuditAvailable:
              recordedSummary.gene_audit_available === true,
          },
        ];
      }

      const configuredValue =
        project?.algorithm_parameters?.[algorithmId]?.maxGenes ??
        project?.resolved_algorithm_parameters?.[algorithmId]?.maxGenes ??
        metadata?.algorithm_parameters?.[algorithmId]?.maxGenes ??
        metadata?.resolved_algorithm_parameters?.[algorithmId]?.maxGenes ??
        defaultLimit;
      const parsedLimit = Number(configuredValue);
      const configuredLimit =
        Number.isFinite(parsedLimit) && parsedLimit > 0
          ? Math.floor(parsedLimit)
          : defaultLimit;
      const estimatedEffectiveLimit =
        (algorithmId === "PPCOR" || algorithmId === "SINCERITIES") &&
        typeof cellCount === "number"
          ? Math.min(
              configuredLimit,
              Math.max(
                algorithmId === "PPCOR" ? 3 : 2,
                Math.round(cellCount * 0.8) - 1
              )
            )
          : configuredLimit;
      if (projectWideGeneCount <= estimatedEffectiveLimit) return [];

      return [
        {
          algorithmId,
          algorithmName: algorithmMetaMap.get(task.algorithm_id)?.name ?? algorithmId,
          inputGeneCount: projectWideGeneCount,
          retainedGeneCount: estimatedEffectiveLimit,
          effectiveGeneLimit: estimatedEffectiveLimit,
          reason: ALGORITHM_GENE_ADJUSTMENT_REASONS[algorithmId],
          recorded: false,
          geneAuditAvailable: false,
        },
      ];
    });
  }, [
    algorithmMetaMap,
    algorithmResults,
    allJobTasks,
    metadata,
    project,
  ]);

  const stableTFGeneIds = useMemo(() => {
    const metadataWithTFs = metadata as
      | (MetadataManifest & {
          known_tf_genes?: string[];
          known_tf_gene_names?: string[];
        })
      | null;

    const metadataTFList =
      (Array.isArray(metadataWithTFs?.known_tf_genes) ? metadataWithTFs.known_tf_genes : null) ??
      (Array.isArray(metadataWithTFs?.known_tf_gene_names)
        ? metadataWithTFs.known_tf_gene_names
        : null);

    if (!metadataTFList || metadataTFList.length === 0) {
      return new Set<string>();
    }

    return new Set(
      metadataTFList
        .map((gene) => String(gene).trim().toUpperCase())
        .filter((gene) => gene.length > 0)
    );
  }, [metadata]);

  const observedResultGenes = useMemo(() => {
    const allGenes = new Set<string>();
    const sourceGenes = new Set<string>();

    completedAlgorithmIds.forEach((algorithmId) => {
      edgesForScope(algorithmResults[algorithmId], selectedResultScopeId).forEach((edge) => {
        const source = String(edge.source ?? "").trim();
        const target = String(edge.target ?? "").trim();

        if (source) {
          allGenes.add(source);
          sourceGenes.add(source);
        }
        if (target) allGenes.add(target);
      });
    });

    return {
      allGenes: [...allGenes].sort(),
      sourceGenes: [...sourceGenes].sort(),
    };
  }, [algorithmResults, completedAlgorithmIds, selectedResultScopeId]);

  const candidateRegulatorIds = useMemo(() => {
    const observedByUpper = new Map(
      observedResultGenes.allGenes.map((gene) => [gene.toUpperCase(), gene])
    );
    const knownTFsInResults = [...stableTFGeneIds]
      .map((gene) => observedByUpper.get(gene))
      .filter((gene): gene is string => Boolean(gene));

    return (knownTFsInResults.length > 0
      ? knownTFsInResults
      : observedResultGenes.sourceGenes
    ).sort();
  }, [observedResultGenes, stableTFGeneIds]);

  const candidateTargetIds = useMemo(
    () => observedResultGenes.allGenes,
    [observedResultGenes]
  );

  const visualTFGeneIds = useMemo(() => {
    if (stableTFGeneIds.size > 0) return stableTFGeneIds;
    return new Set(candidateRegulatorIds.map((gene) => gene.toUpperCase()));
  }, [candidateRegulatorIds, stableTFGeneIds]);

  const standardizedAlgorithmEdgeRows = useMemo(() => {
    const next: Record<string, AggregatedEdge[]> = {};
    const candidateRegulatorSet = new Set(candidateRegulatorIds);
    const candidateTargetSet = new Set(candidateTargetIds);
    const regulatorCount = Math.max(candidateRegulatorIds.length, 1);

    completedAlgorithmIds.forEach((algorithmId) => {
      const algorithmMeta = algorithmMetaMap.get(algorithmId);
      const isDirected = algorithmMeta?.directed ?? true;
      const isSigned = algorithmMeta?.signed ?? false;
      const storedResult = algorithmResults[algorithmId];
      const confidenceSummary =
        selectedResultScopeId === "global"
          ? storedResult?.confidence_summary
          : storedResult?.scopes?.[selectedResultScopeId]?.confidence_summary;
      const bootstrapVerified =
        confidenceSummary?.resampling_scheme ===
          "cell_bootstrap_with_replacement_v1" &&
        confidenceSummary?.sampling_with_replacement === true;
      const bootstrapRunCount = Number(confidenceSummary?.bootstrap_runs);
      const scoreByEdge = new Map<
        string,
        {
          source: string;
          target: string;
          rawScore: number;
          signedScore: number;
          edge: AlgorithmResultEdge;
        }
      >();

      const addCandidateScore = (
        source: string,
        target: string,
        rawScore: number,
        signedScore: number,
        edge: AlgorithmResultEdge
      ) => {
        if (source === target) return;
        if (!candidateRegulatorSet.has(source) || !candidateTargetSet.has(target)) {
          return;
        }

        const key = edgeKeyFor(source, target);
        const current = scoreByEdge.get(key);

        if (!current || Math.abs(rawScore) > Math.abs(current.rawScore)) {
          scoreByEdge.set(key, { source, target, rawScore, signedScore, edge });
        }
      };

      edgesForScope(algorithmResults[algorithmId], selectedResultScopeId).forEach((edge) => {
        const source = String(edge.source ?? "").trim();
        const target = String(edge.target ?? "").trim();
        const rawScore = numericEdgeScore(edge);
        const signedScore = numericSignedEdgeScore(edge);

        if (!source || !target) return;

        addCandidateScore(source, target, rawScore, signedScore, edge);

        if (!isDirected) {
          addCandidateScore(target, source, rawScore, signedScore, edge);
        }
      });

      const entriesByTarget = new Map<
        string,
        {
          source: string;
          target: string;
          rawScore: number;
          signedScore: number;
          edge: AlgorithmResultEdge;
        }[]
      >();

      scoreByEdge.forEach((entry) => {
        const entries = entriesByTarget.get(entry.target) ?? [];
        entries.push(entry);
        entriesByTarget.set(entry.target, entries);
      });

      const rows: AggregatedEdge[] = [];

      entriesByTarget.forEach((entries) => {
        const sortedEntries = entries.sort((a, b) => {
          const scoreDelta = Math.abs(b.rawScore) - Math.abs(a.rawScore);
          if (scoreDelta !== 0) return scoreDelta;
          return a.source.localeCompare(b.source);
        });

        let index = 0;
        while (index < sortedEntries.length) {
          const weight = Math.abs(sortedEntries[index].rawScore);
          let tieEnd = index + 1;
          while (
            tieEnd < sortedEntries.length &&
            Math.abs(sortedEntries[tieEnd].rawScore) === weight
          ) {
            tieEnd += 1;
          }

          const rank = ((index + 1) + tieEnd) / 2;

          for (const entry of sortedEntries.slice(index, tieEnd)) {
            // Per-target percentile rank from the confidence-score pipeline:
            // pctl_ij = 1 - (rank_ij - 1) / (|T| - 1)
            // A value near 1 means this regulator is highly ranked for this target.
            const percentile =
              regulatorCount <= 1
                ? 1
                : clamp(1 - (rank - 1) / (regulatorCount - 1), 0, 1);
            const backendMeanPercentile = numericMeanPercentile(entry.edge);
            const backendStability = numericStability(entry.edge);
            const backendConfidence = numericEdgeConfidence(entry.edge);
            const evidence = numericEvidenceScore(entry.edge, percentile);
            const confidence = numericConfidenceScore(entry.edge, percentile);
            const meanPercentile = backendMeanPercentile ?? percentile;
            const stability = backendStability ?? (rank <= CONFIDENCE_STABILITY_TOP_K ? 1 : 0);
            const signVote = isSigned ? signOf(entry.signedScore) : 0;
            const bootstrapSignConfidence = numericOptionalProbability(
              entry.edge.bootstrap_sign_confidence,
            );
            const bootstrapSignCoverage = numericOptionalProbability(
              entry.edge.bootstrap_sign_coverage,
            );
            const bootstrapPositiveProbability = numericOptionalProbability(
              entry.edge.bootstrap_positive_probability,
            );
            const bootstrapNegativeProbability = numericOptionalProbability(
              entry.edge.bootstrap_negative_probability,
            );
            const bootstrapSignReference =
              entry.edge.bootstrap_sign_reference === "full_data" ||
              entry.edge.bootstrap_sign_reference === "bootstrap_mean"
                ? entry.edge.bootstrap_sign_reference
                : null;
            const hasVerifiedSignDistribution =
              bootstrapVerified &&
              bootstrapSignCoverage !== null &&
              bootstrapPositiveProbability !== null &&
              bootstrapNegativeProbability !== null;
            const direction =
              isDirected || !candidateRegulatorSet.has(entry.target) ? 1 : 0;
            const supportingAlgorithms =
              (backendStability !== null
                ? backendStability > 0
                : evidence >= 0.5 || rank <= CONFIDENCE_STABILITY_TOP_K)
                ? [algorithmId]
                : [];

            rows.push({
              key: `${algorithmId}-${entry.source}-${entry.target}`,
              source: entry.source,
              target: entry.target,
              score: evidence,
              confidence,
              bootstrapVerified,
              bootstrapSelectedRuns: Number.isFinite(
                Number(entry.edge.selected_runs),
              )
                ? Number(entry.edge.selected_runs)
                : undefined,
              bootstrapRunCount: Number.isFinite(bootstrapRunCount)
                ? bootstrapRunCount
                : undefined,
              evidenceCiLower: Number.isFinite(
                Number(entry.edge.evidence_ci_lower),
              )
                ? Number(entry.edge.evidence_ci_lower)
                : null,
              evidenceCiUpper: Number.isFinite(
                Number(entry.edge.evidence_ci_upper),
              )
                ? Number(entry.edge.evidence_ci_upper)
                : null,
              bootstrapSignConfidence,
              bootstrapSignCoverage,
              bootstrapPositiveProbability,
              bootstrapNegativeProbability,
              bootstrapSignedSelectedRuns:
                entry.edge.signed_selected_runs === null ||
                entry.edge.signed_selected_runs === undefined
                  ? undefined
                  : Number(entry.edge.signed_selected_runs),
              bootstrapSignAgreeingRuns:
                entry.edge.sign_agreeing_runs === null ||
                entry.edge.sign_agreeing_runs === undefined
                  ? undefined
                  : Number(entry.edge.sign_agreeing_runs),
              bootstrapSignReference,
              stability,
              meanPercentile,
              count: supportingAlgorithms.length,
              rank,
              supportingAlgorithms,
              perAlgorithmScores: {
                [algorithmId]: evidence,
              },
              perAlgorithmConfidences:
                backendConfidence === null
                  ? {}
                  : {
                      [algorithmId]: backendConfidence,
                    },
              perAlgorithmRawScores: {
                [algorithmId]: entry.signedScore,
              },
              perAlgorithmSigns: {
                [algorithmId]: signVote,
              },
              direction,
              directionConfidence: direction === 1 ? 1 : null,
              directionCoverage: isDirected ? 1 : 0,
              sign: signVote,
              signConfidence:
                isSigned &&
                signVote !== 0 &&
                hasVerifiedSignDistribution &&
                bootstrapSignReference !== null
                  ? bootstrapSignConfidence
                  : null,
              signCoverage:
                isSigned && hasVerifiedSignDistribution
                  ? bootstrapSignCoverage
                  : 0,
            });
          }

          index = tieEnd;
        }
      });

      next[algorithmId] = rows.sort(
        (a, b) => b.confidence - a.confidence || b.score - a.score
      );
    });

    return next;
  }, [
    algorithmMetaMap,
    algorithmResults,
    candidateRegulatorIds,
    candidateTargetIds,
    completedAlgorithmIds,
    selectedResultScopeId,
  ]);

  const algorithmEdgeRows = useMemo(() => {
    const next: Record<string, AggregatedEdge[]> = {};

    const meetsConfidenceFilters = (edge: AggregatedEdge) => {
      const meetsDirectionConfidence =
        directionConfidenceThreshold <= 0 ||
        (edge.directionConfidence !== null &&
          edge.directionConfidence >= directionConfidenceThreshold);
      const meetsSignConfidence =
        signConfidenceThreshold <= 0 ||
        (edge.signConfidence !== null && edge.signConfidence >= signConfidenceThreshold);

      return (
        edge.score >= evidenceThreshold &&
        edge.confidence >= confidenceThreshold &&
        meetsDirectionConfidence &&
        meetsSignConfidence
      );
    };

    completedAlgorithmIds.forEach((algorithmId) => {
      next[algorithmId] = (standardizedAlgorithmEdgeRows[algorithmId] ?? [])
        .filter(meetsConfidenceFilters);
    });

    return next;
  }, [
    completedAlgorithmIds,
    evidenceThreshold,
    confidenceThreshold,
    directionConfidenceThreshold,
    signConfidenceThreshold,
    standardizedAlgorithmEdgeRows,
  ]);

  const displayAlgorithmEdgeRows = useMemo(() => {
    const next: Record<string, AggregatedEdge[]> = {};
    const candidateRegulatorSet = new Set(candidateRegulatorIds);

    const getPairOrientation = (source: string, target: string) => {
      const sourceIsRegulator = candidateRegulatorSet.has(source);
      const targetIsRegulator = candidateRegulatorSet.has(target);

      if (sourceIsRegulator && !targetIsRegulator) {
        return { source, target };
      }

      if (targetIsRegulator && !sourceIsRegulator) {
        return { source: target, target: source };
      }

      return source.localeCompare(target) <= 0
        ? { source, target }
        : { source: target, target: source };
    };

    const isStrongerDisplayEdge = (
      candidate: AggregatedEdge,
      current: AggregatedEdge
    ) => {
      if (candidate.confidence !== current.confidence) {
        return candidate.confidence > current.confidence;
      }
      if (candidate.score !== current.score) {
        return candidate.score > current.score;
      }
      return candidate.rank < current.rank;
    };

    completedAlgorithmIds.forEach((algorithmId) => {
      const rows = algorithmEdgeRows[algorithmId] ?? [];
      const algorithmMeta = algorithmMetaMap.get(algorithmId);

      if (algorithmMeta?.directed ?? true) {
        next[algorithmId] = rows;
        return;
      }

      const rowByPair = new Map<string, AggregatedEdge>();

      rows.forEach((edge) => {
        const pair = getPairOrientation(edge.source, edge.target);
        const pairKey = edgeKeyFor(pair.source, pair.target);
        const displayEdge: AggregatedEdge = {
          ...edge,
          key: `${algorithmId}-${pair.source}-${pair.target}`,
          source: pair.source,
          target: pair.target,
          direction: 0,
          directionConfidence: null,
          directionCoverage: 0,
        };
        const current = rowByPair.get(pairKey);

        if (!current || isStrongerDisplayEdge(displayEdge, current)) {
          rowByPair.set(pairKey, displayEdge);
        }
      });

      next[algorithmId] = Array.from(rowByPair.values())
        .sort((a, b) => b.confidence - a.confidence || b.score - a.score);
    });

    return next;
  }, [
    algorithmEdgeRows,
    algorithmMetaMap,
    candidateRegulatorIds,
    completedAlgorithmIds,
  ]);

  const consensusCandidateRows = useMemo(() => {
    if (activeAlgorithmIds.length < 2) return [];

    const sumAlpha = Math.max(activeAlgorithmIds.length, 1);
    const candidateRegulatorSet = new Set(candidateRegulatorIds);
    const rowsByAlgorithm = new Map<string, Map<string, AggregatedEdge>>();

    activeAlgorithmIds.forEach((algorithmId) => {
      rowsByAlgorithm.set(
        algorithmId,
        new Map(
          (standardizedAlgorithmEdgeRows[algorithmId] ?? []).map((edge) => [
            edgeKeyFor(edge.source, edge.target),
            edge,
          ])
        )
      );
    });

    const getPairOrientation = (source: string, target: string) => {
      const sourceIsRegulator = candidateRegulatorSet.has(source);
      const targetIsRegulator = candidateRegulatorSet.has(target);

      if (sourceIsRegulator && !targetIsRegulator) {
        return { source, target };
      }

      if (targetIsRegulator && !sourceIsRegulator) {
        return { source: target, target: source };
      }

      return source.localeCompare(target) <= 0
        ? { source, target }
        : { source: target, target: source };
    };

    const getPairKey = (source: string, target: string) => {
      const pair = getPairOrientation(source, target);
      return edgeKeyFor(pair.source, pair.target);
    };

    type MethodEvidence = {
      evidence: number;
      directionVote: -1 | 0 | 1;
      signVote: -1 | 0 | 1;
      bootstrapPositiveProbability: number | null;
      bootstrapSignCoverage: number | null;
      rawScore: number | undefined;
      bootstrapConfidence: number | null;
      bootstrapVerified: boolean;
      bootstrapSelectedRuns?: number;
      bootstrapRunCount?: number;
      evidenceCiLower?: number | null;
      evidenceCiUpper?: number | null;
      isSupported: boolean;
    };

    type ConsensusAccumulator = {
      source: string;
      target: string;
      totalEvidence: number;
      directionVote: number;
      directionDenominator: number;
      directionCoverageEvidence: number;
      fullDataSignVote: number;
      bootstrapPositiveEvidence: number;
      bootstrapSignEvidence: number;
      supportingAlgorithms: string[];
      perAlgorithmScores: Record<string, number>;
      perAlgorithmConfidences: Record<string, number>;
      perAlgorithmRawScores: Record<string, number>;
      perAlgorithmSigns: Record<string, -1 | 0 | 1>;
      perAlgorithmBootstrapVerified: Record<string, boolean>;
      perAlgorithmBootstrapSelectedRuns: Record<string, number>;
      perAlgorithmBootstrapRunCounts: Record<string, number>;
      perAlgorithmEvidenceCiLower: Record<string, number>;
      perAlgorithmEvidenceCiUpper: Record<string, number>;
      perAlgorithmBootstrapPositiveProbability: Record<string, number>;
      perAlgorithmBootstrapSignCoverage: Record<string, number>;
      perAlgorithmBootstrapSignedSelectedRuns: Record<string, number>;
      perAlgorithmBootstrapSignAgreeingRuns: Record<string, number>;
      perAlgorithmBootstrapSignReferences: Record<
        string,
        "full_data" | "bootstrap_mean"
      >;
    };

    const buckets = new Map<string, ConsensusAccumulator>();

    const allPairKeys = new Set<string>();

    activeAlgorithmIds.forEach((algorithmId) => {
      (standardizedAlgorithmEdgeRows[algorithmId] ?? []).forEach((edge) => {
        allPairKeys.add(getPairKey(edge.source, edge.target));
      });
    });

    allPairKeys.forEach((pairKey) => {
      const [baseSource, baseTarget] = pairKey.split("|||");
      if (!baseSource || !baseTarget) return;

      const accumulator: ConsensusAccumulator = {
        source: baseSource,
        target: baseTarget,
        totalEvidence: 0,
        directionVote: 0,
        directionDenominator: 0,
        directionCoverageEvidence: 0,
        fullDataSignVote: 0,
        bootstrapPositiveEvidence: 0,
        bootstrapSignEvidence: 0,
        supportingAlgorithms: [],
        perAlgorithmScores: {},
        perAlgorithmConfidences: {},
        perAlgorithmRawScores: {},
        perAlgorithmSigns: {},
        perAlgorithmBootstrapVerified: {},
        perAlgorithmBootstrapSelectedRuns: {},
        perAlgorithmBootstrapRunCounts: {},
        perAlgorithmEvidenceCiLower: {},
        perAlgorithmEvidenceCiUpper: {},
        perAlgorithmBootstrapPositiveProbability: {},
        perAlgorithmBootstrapSignCoverage: {},
        perAlgorithmBootstrapSignedSelectedRuns: {},
        perAlgorithmBootstrapSignAgreeingRuns: {},
        perAlgorithmBootstrapSignReferences: {},
      };

      activeAlgorithmIds.forEach((algorithmId) => {
        const algorithmMeta = algorithmMetaMap.get(algorithmId);
        const isDirected = algorithmMeta?.directed ?? true;
        const isSigned = algorithmMeta?.signed ?? false;
        const rowsForAlgorithm = rowsByAlgorithm.get(algorithmId);
        const forward = rowsForAlgorithm?.get(edgeKeyFor(baseSource, baseTarget));
        const reverse = rowsForAlgorithm?.get(edgeKeyFor(baseTarget, baseSource));

        const forwardEvidence =
          forward?.perAlgorithmScores[algorithmId] ?? forward?.confidence ?? 0;
        const reverseEvidence =
          reverse?.perAlgorithmScores[algorithmId] ?? reverse?.confidence ?? 0;
        const directionEvidence = forwardEvidence + reverseEvidence;

        let methodEvidence: MethodEvidence | null = null;

        if (forwardEvidence > 0 || reverseEvidence > 0) {
          if (forwardEvidence >= reverseEvidence) {
            methodEvidence = {
              evidence: forwardEvidence,
              directionVote:
                isDirected && forwardEvidence !== reverseEvidence ? 1 : 0,
              signVote: isSigned
                ? forward?.perAlgorithmSigns?.[algorithmId] ?? 0
                : 0,
              bootstrapPositiveProbability:
                forward?.bootstrapPositiveProbability ?? null,
              bootstrapSignCoverage:
                forward?.bootstrapSignCoverage ?? null,
              rawScore: forward?.perAlgorithmRawScores?.[algorithmId],
              bootstrapConfidence:
                forward?.perAlgorithmConfidences?.[algorithmId] ?? null,
              bootstrapVerified: forward?.bootstrapVerified === true,
              bootstrapSelectedRuns: forward?.bootstrapSelectedRuns,
              bootstrapRunCount: forward?.bootstrapRunCount,
              evidenceCiLower: forward?.evidenceCiLower,
              evidenceCiUpper: forward?.evidenceCiUpper,
              isSupported: forward?.supportingAlgorithms.includes(algorithmId) ?? false,
            };
          } else {
            methodEvidence = {
              evidence: reverseEvidence,
              directionVote: isDirected ? -1 : 0,
              signVote: isSigned
                ? reverse?.perAlgorithmSigns?.[algorithmId] ?? 0
                : 0,
              bootstrapPositiveProbability:
                reverse?.bootstrapPositiveProbability ?? null,
              bootstrapSignCoverage:
                reverse?.bootstrapSignCoverage ?? null,
              rawScore: reverse?.perAlgorithmRawScores?.[algorithmId],
              bootstrapConfidence:
                reverse?.perAlgorithmConfidences?.[algorithmId] ?? null,
              bootstrapVerified: reverse?.bootstrapVerified === true,
              bootstrapSelectedRuns: reverse?.bootstrapSelectedRuns,
              bootstrapRunCount: reverse?.bootstrapRunCount,
              evidenceCiLower: reverse?.evidenceCiLower,
              evidenceCiUpper: reverse?.evidenceCiUpper,
              isSupported: reverse?.supportingAlgorithms.includes(algorithmId) ?? false,
            };
          }
        }

        if (!methodEvidence) {
          accumulator.perAlgorithmScores[algorithmId] = 0;
          accumulator.perAlgorithmSigns[algorithmId] = 0;
          return;
        }

        accumulator.totalEvidence += methodEvidence.evidence;
        accumulator.perAlgorithmScores[algorithmId] = methodEvidence.evidence;
        accumulator.perAlgorithmSigns[algorithmId] = methodEvidence.signVote;
        accumulator.perAlgorithmBootstrapVerified[algorithmId] =
          methodEvidence.bootstrapVerified;
        if (methodEvidence.bootstrapSelectedRuns !== undefined) {
          accumulator.perAlgorithmBootstrapSelectedRuns[algorithmId] =
            methodEvidence.bootstrapSelectedRuns;
        }
        if (methodEvidence.bootstrapRunCount !== undefined) {
          accumulator.perAlgorithmBootstrapRunCounts[algorithmId] =
            methodEvidence.bootstrapRunCount;
        }
        if (methodEvidence.evidenceCiLower !== null &&
            methodEvidence.evidenceCiLower !== undefined) {
          accumulator.perAlgorithmEvidenceCiLower[algorithmId] =
            methodEvidence.evidenceCiLower;
        }
        if (methodEvidence.evidenceCiUpper !== null &&
            methodEvidence.evidenceCiUpper !== undefined) {
          accumulator.perAlgorithmEvidenceCiUpper[algorithmId] =
            methodEvidence.evidenceCiUpper;
        }
        const chosenEdge =
          forwardEvidence >= reverseEvidence ? forward : reverse;
        if (methodEvidence.bootstrapPositiveProbability !== null) {
          accumulator.perAlgorithmBootstrapPositiveProbability[algorithmId] =
            methodEvidence.bootstrapPositiveProbability;
        }
        if (methodEvidence.bootstrapSignCoverage !== null) {
          accumulator.perAlgorithmBootstrapSignCoverage[algorithmId] =
            methodEvidence.bootstrapSignCoverage;
        }
        if (chosenEdge?.bootstrapSignedSelectedRuns !== undefined) {
          accumulator.perAlgorithmBootstrapSignedSelectedRuns[algorithmId] =
            chosenEdge.bootstrapSignedSelectedRuns;
        }
        if (chosenEdge?.bootstrapSignAgreeingRuns !== undefined) {
          accumulator.perAlgorithmBootstrapSignAgreeingRuns[algorithmId] =
            chosenEdge.bootstrapSignAgreeingRuns;
        }
        if (chosenEdge?.bootstrapSignReference) {
          accumulator.perAlgorithmBootstrapSignReferences[algorithmId] =
            chosenEdge.bootstrapSignReference;
        }

        if (methodEvidence.bootstrapConfidence !== null) {
          accumulator.perAlgorithmConfidences[algorithmId] =
            methodEvidence.bootstrapConfidence;
        }

        if (methodEvidence.rawScore !== undefined) {
          accumulator.perAlgorithmRawScores[algorithmId] = methodEvidence.rawScore;
        }

        if (methodEvidence.isSupported) {
          accumulator.supportingAlgorithms.push(algorithmId);
        }

        if (isDirected && directionEvidence > 0) {
          accumulator.directionVote += forwardEvidence - reverseEvidence;
          accumulator.directionDenominator += directionEvidence;
          accumulator.directionCoverageEvidence += methodEvidence.evidence;
        }

        if (isSigned && methodEvidence.signVote !== 0) {
          accumulator.fullDataSignVote +=
            methodEvidence.evidence * methodEvidence.signVote;
        }

        if (
          isSigned &&
          methodEvidence.bootstrapVerified &&
          methodEvidence.bootstrapPositiveProbability !== null &&
          methodEvidence.bootstrapSignCoverage !== null
        ) {
          const signedEvidence =
            methodEvidence.evidence * methodEvidence.bootstrapSignCoverage;
          accumulator.bootstrapPositiveEvidence +=
            signedEvidence * methodEvidence.bootstrapPositiveProbability;
          accumulator.bootstrapSignEvidence += signedEvidence;
        }
      });

      buckets.set(pairKey, accumulator);
    });

    const sortedRows = Array.from(buckets.entries())
      .map(([key, edge]) => {
        const edgeEvidence = clamp(edge.totalEvidence / sumAlpha, 0, 1);
        const bootstrapConfidence =
          median(
            edge.supportingAlgorithms.flatMap((algorithmId) => {
              const value = edge.perAlgorithmConfidences[algorithmId];
              return Number.isFinite(value) ? [value] : [];
            })
          ) ?? 0;
        const singleSupportingAlgorithm =
          edge.supportingAlgorithms.length === 1
            ? edge.supportingAlgorithms[0]
            : null;
        const bootstrapVerified =
          edge.supportingAlgorithms.length > 0 &&
          edge.supportingAlgorithms.every(
            (algorithmId) =>
              edge.perAlgorithmBootstrapVerified[algorithmId] === true,
          );
        const direction = signOf(edge.directionVote);
        const directionConfidence =
          edge.directionDenominator > 0
            ? clamp(Math.abs(edge.directionVote) / edge.directionDenominator, 0, 1)
            : null;
        const directionCoverage =
          edge.totalEvidence > 0 ? edge.directionCoverageEvidence / edge.totalEvidence : 0;
        const sign = signOf(edge.fullDataSignVote);
        const bootstrapPositiveProbability =
          edge.bootstrapSignEvidence > 0
            ? clamp(
                edge.bootstrapPositiveEvidence / edge.bootstrapSignEvidence,
                0,
                1,
              )
            : null;
        const signConfidence =
          sign !== 0 && bootstrapPositiveProbability !== null
            ? sign > 0
              ? bootstrapPositiveProbability
              : 1 - bootstrapPositiveProbability
            : null;
        const signCoverage =
          edge.totalEvidence > 0
            ? clamp(edge.bootstrapSignEvidence / edge.totalEvidence, 0, 1)
            : 0;
        const displaySource = direction === -1 ? edge.target : edge.source;
        const displayTarget = direction === -1 ? edge.source : edge.target;

        activeAlgorithmIds.forEach((algorithmId) => {
          if (edge.perAlgorithmScores[algorithmId] === undefined) {
            edge.perAlgorithmScores[algorithmId] = 0;
          }
        });

        return {
          key,
          source: displaySource,
          target: displayTarget,
          score: edgeEvidence,
          confidence: clamp(bootstrapConfidence, 0, 1),
          bootstrapVerified,
          bootstrapSelectedRuns: singleSupportingAlgorithm
            ? edge.perAlgorithmBootstrapSelectedRuns[singleSupportingAlgorithm]
            : undefined,
          bootstrapRunCount: singleSupportingAlgorithm
            ? edge.perAlgorithmBootstrapRunCounts[singleSupportingAlgorithm]
            : undefined,
          evidenceCiLower: singleSupportingAlgorithm
            ? edge.perAlgorithmEvidenceCiLower[singleSupportingAlgorithm] ?? null
            : null,
          evidenceCiUpper: singleSupportingAlgorithm
            ? edge.perAlgorithmEvidenceCiUpper[singleSupportingAlgorithm] ?? null
            : null,
          bootstrapSignConfidence: signConfidence,
          bootstrapSignCoverage: signCoverage,
          bootstrapPositiveProbability,
          bootstrapNegativeProbability:
            bootstrapPositiveProbability === null
              ? null
              : 1 - bootstrapPositiveProbability,
          bootstrapSignedSelectedRuns: singleSupportingAlgorithm
            ? edge.perAlgorithmBootstrapSignedSelectedRuns[
                singleSupportingAlgorithm
              ]
            : undefined,
          bootstrapSignAgreeingRuns: singleSupportingAlgorithm
            ? edge.perAlgorithmBootstrapSignAgreeingRuns[
                singleSupportingAlgorithm
              ]
            : undefined,
          bootstrapSignReference: singleSupportingAlgorithm
            ? edge.perAlgorithmBootstrapSignReferences[
                singleSupportingAlgorithm
              ] ?? null
            : null,
          count: edge.supportingAlgorithms.length,
          rank: 0,
          supportingAlgorithms: [...edge.supportingAlgorithms].sort(),
          perAlgorithmScores: edge.perAlgorithmScores,
          perAlgorithmConfidences: edge.perAlgorithmConfidences,
          perAlgorithmRawScores: edge.perAlgorithmRawScores,
          perAlgorithmSigns: edge.perAlgorithmSigns,
          direction: direction === 0 ? 0 : 1,
          directionConfidence,
          directionCoverage,
          sign,
          signConfidence,
          signCoverage,
        } satisfies AggregatedEdge;
      })
      .filter((edge) => edge.score > 0 || edge.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence || b.score - a.score);

    return assignAverageRanks(
      sortedRows,
      (first, second) =>
        first.confidence === second.confidence && first.score === second.score
    );
  }, [
    activeAlgorithmIds,
    algorithmMetaMap,
    candidateRegulatorIds,
    standardizedAlgorithmEdgeRows,
  ]);

  const consensusRows = useMemo(() => {
    return consensusCandidateRows.filter(
      (edge) =>
        edge.confidence >= confidenceThreshold &&
        edge.score >= evidenceThreshold &&
        edge.count >= consensusThreshold &&
        (directionConfidenceThreshold <= 0 ||
          (edge.directionConfidence !== null &&
            edge.directionConfidence >= directionConfidenceThreshold)) &&
        (signConfidenceThreshold <= 0 ||
          (edge.signConfidence !== null &&
            edge.signConfidence >= signConfidenceThreshold))
    );
  }, [
    consensusCandidateRows,
    evidenceThreshold,
    confidenceThreshold,
    consensusThreshold,
    directionConfidenceThreshold,
    signConfidenceThreshold,
  ]);

  const uncappedActiveEdges = useMemo(() => {
    if (activeAlgorithmIds.length >= 2) return consensusRows;
    if (activeAlgorithmIds.length === 1) {
      return displayAlgorithmEdgeRows[activeAlgorithmIds[0]] ?? [];
    }
    return [];
  }, [activeAlgorithmIds, consensusRows, displayAlgorithmEdgeRows]);

  const activeEdges = uncappedActiveEdges;

  // First-open safety net: seed the result filters from each project's own edge
  // distribution so the network and table always reveal a small, legible set of
  // the strongest edges (~INITIAL_VISIBLE_EDGE_TARGET) instead of a blank canvas.
  // Runs once per project, before the user touches any filter; afterwards their
  // adjustments are respected even when they filter everything out. Demo projects
  // keep their own curated defaults.
  useEffect(() => {
    if (isDemoProject || !projectId) return;
    if (seededProjectIdRef.current === projectId) return;
    if (activeAlgorithmIds.length === 0) return;

    const isConsensusView = activeAlgorithmIds.length >= 2;
    const candidatePool = isConsensusView
      ? consensusCandidateRows
      : standardizedAlgorithmEdgeRows[activeAlgorithmIds[0]] ?? [];

    // Wait until this project's edges have actually loaded before seeding.
    if (candidatePool.length === 0) return;

    const sortedByEvidence = candidatePool
      .filter((edge) => Number.isFinite(edge.score))
      .sort((a, b) => b.score - a.score);
    if (sortedByEvidence.length === 0) return;

    const targetIndex =
      Math.min(INITIAL_VISIBLE_EDGE_TARGET, sortedByEvidence.length) - 1;
    const seedEvidenceThreshold = sortedByEvidence[targetIndex].score;

    // Evidence alone drives the initial count; relax the other axes so they
    // don't undercut the target. The panel then honestly reflects what is shown.
    setEvidenceThreshold(seedEvidenceThreshold);
    setConfidenceThreshold(0);
    setDirectionConfidenceThreshold(0);
    setSignConfidenceThreshold(0);
    setConsensusThreshold(1);
    seededProjectIdRef.current = projectId;
  }, [
    isDemoProject,
    projectId,
    activeAlgorithmIds,
    consensusCandidateRows,
    standardizedAlgorithmEdgeRows,
  ]);

  const geneCoordinateMap = useMemo(() => {
    const coordinates = new Map<string, GeneCoordinateInfo>();

    activeAlgorithmIds.forEach((algorithmId) => {
      const resultCoordinates = algorithmResults[algorithmId]?.gene_coordinates ?? {};

      Object.entries(resultCoordinates).forEach(([geneName, coordinate]) => {
        if (!coordinates.has(geneName)) {
          coordinates.set(geneName, coordinate);
        }
      });
    });

    return coordinates;
  }, [activeAlgorithmIds, algorithmResults]);

  const filteredNetworkEdges = useMemo(() => {
    const query = tableSearch.trim().toLowerCase();

    return activeEdges.filter((edge) => {
      const matchesSearch =
        !query ||
        edge.source.toLowerCase().includes(query) ||
        edge.target.toLowerCase().includes(query);

      const matchesIsolation =
        !isolatedGene || edge.source === isolatedGene || edge.target === isolatedGene;

      return matchesSearch && matchesIsolation;
    });
  }, [activeEdges, isolatedGene, tableSearch]);

  const networkNodes = useMemo(() => {
    const nodes = new Map<string, NodeInfo>();

    activeEdges.forEach((edge) => {
      if (!nodes.has(edge.source)) {
        const coordinate = geneCoordinateMap.get(edge.source) ?? null;

        nodes.set(edge.source, {
          id: edge.source,
          inDegree: 0,
          outDegree: 0,
          degree: 0,
          isTF: visualTFGeneIds.has(edge.source.toUpperCase()),
          topRegulators: [],
          topTargets: [],
          chromosome: coordinate?.chromosome ?? null,
          start: coordinate?.start ?? null,
          end: coordinate?.end ?? null,
          strand: coordinate?.strand ?? null,
          gene_type: coordinate?.gene_type ?? null,
          gene_id: coordinate?.gene_id ?? null,
        });
      }

      if (!nodes.has(edge.target)) {
        const coordinate = geneCoordinateMap.get(edge.target) ?? null;

        nodes.set(edge.target, {
          id: edge.target,
          inDegree: 0,
          outDegree: 0,
          degree: 0,
          isTF: visualTFGeneIds.has(edge.target.toUpperCase()),
          topRegulators: [],
          topTargets: [],
          chromosome: coordinate?.chromosome ?? null,
          start: coordinate?.start ?? null,
          end: coordinate?.end ?? null,
          strand: coordinate?.strand ?? null,
          gene_type: coordinate?.gene_type ?? null,
          gene_id: coordinate?.gene_id ?? null,
        });
      }

      const source = nodes.get(edge.source)!;
      const target = nodes.get(edge.target)!;

      source.isTF = visualTFGeneIds.has(edge.source.toUpperCase());
      target.isTF = visualTFGeneIds.has(edge.target.toUpperCase());

      source.outDegree += 1;
      source.degree += 1;
      target.inDegree += 1;
      target.degree += 1;

      if (!source.topTargets.includes(edge.target)) source.topTargets.push(edge.target);
      if (!target.topRegulators.includes(edge.source)) target.topRegulators.push(edge.source);
    });

    const visibleNodeIds = new Set<string>();

    filteredNetworkEdges.forEach((edge) => {
      visibleNodeIds.add(edge.source);
      visibleNodeIds.add(edge.target);
    });

    return Array.from(nodes.values())
      .filter((node) => visibleNodeIds.has(node.id))
      .sort((a, b) => b.degree - a.degree);
  }, [activeEdges, filteredNetworkEdges, geneCoordinateMap, visualTFGeneIds]);

  const selectedNode = useMemo(
    () => networkNodes.find((node) => node.id === selectedGene) ?? null,
    [networkNodes, selectedGene]
  );

  const resultsAvailabilityNotice = useMemo(() => {
    if (isPreparingFinishedResults) {
      return null;
    }

    if (completedResultsError && loadedCompletedAlgorithmCount === 0) {
      return {
        title: "Saved results couldn't be loaded",
        description: completedResultsError,
        canRetry: true,
      };
    }

    if (completedAlgorithmIds.length === 0) {
      return {
        title: "No completed algorithm results yet",
        description:
          "The network and comparison tools will appear after the first algorithm finishes successfully.",
        canRetry: false,
      };
    }

    if (activeAlgorithmIds.length === 0) {
      return {
        title: "No algorithms selected",
        description:
          "Select at least one completed algorithm to explore its network and ranked edges.",
        canRetry: false,
      };
    }

    return null;
  }, [
    activeAlgorithmIds.length,
    completedAlgorithmIds.length,
    completedResultsError,
    isPreparingFinishedResults,
    loadedCompletedAlgorithmCount,
  ]);

  const openDownloadModal = (label: string, href: string, filename: string) => {
    setIsDownloadModalClosing(false);
    setPendingDownload({ label, href, filename });
  };

  const closeDownloadModal = () => {
    if (!pendingDownload) return;

    setIsDownloadModalClosing(true);

    window.setTimeout(() => {
      setPendingDownload(null);
      setIsDownloadModalClosing(false);
    }, 280);
  };

  const requestAlgorithmAction = (
    type: "stop" | "rerun",
    task: { algorithmId: string; algorithmName: string }
  ) => {
    if (!latestJob || !projectId || isDemoProject) return;
    if (algorithmActionCloseTimeoutRef.current) {
      window.clearTimeout(algorithmActionCloseTimeoutRef.current);
      algorithmActionCloseTimeoutRef.current = null;
    }

    setIsAlgorithmActionModalClosing(false);
    setAlgorithmActionError("");
    setPendingAlgorithmAction({
      type,
      algorithmId: task.algorithmId,
      algorithmName: task.algorithmName,
    });
  };

  const finishAlgorithmActionModal = () => {
    setIsAlgorithmActionModalClosing(true);
    algorithmActionCloseTimeoutRef.current = window.setTimeout(() => {
      setPendingAlgorithmAction(null);
      setIsAlgorithmActionModalClosing(false);
      algorithmActionCloseTimeoutRef.current = null;
    }, MODAL_ANIMATION_MS);
  };

  const closeAlgorithmActionModal = () => {
    if (isAlgorithmActionSubmitting || isAlgorithmActionModalClosing) return;
    finishAlgorithmActionModal();
  };

  const confirmAlgorithmAction = async () => {
    if (!pendingAlgorithmAction || !latestJob || !projectId) return;

    const jobId = latestJob.job_id;
    const { algorithmId, type } = pendingAlgorithmAction;

    setIsAlgorithmActionSubmitting(true);
    setAlgorithmActionError("");
    let succeeded = false;

    try {
      const response = await apiFetch(
        `${API_BASE}/projects/${projectId}/jobs/${jobId}/tasks/${algorithmId}/${type === "stop" ? "stop" : "rerun"}`,
        { method: "POST" }
      );

      const payload = await response.json().catch(() => null) as {
        detail?: string;
        latest_job?: ProjectJob;
      } | null;
      if (!response.ok) {
        throw new Error(
          payload?.detail || `The server returned HTTP ${response.status}.`,
        );
      }

      // A stop/rerun changes this project's results, so drop any cached edges
      // for it — the next visit must reload fresh.
      if (projectId) clearCachedResults(projectId);
      // Apply the optimistic state the endpoint returns (e.g. "Stopping")
      // right away, then reconcile with a full refresh in the background so
      // the modal can close without waiting on the heavier fetch.
      if (payload?.latest_job) {
        setLatestJob(payload.latest_job);
      }
      void refreshProjectData();
      succeeded = true;
    } catch (actionError) {
      setAlgorithmActionError(
        actionError instanceof Error && actionError.message
          ? actionError.message
          : "The algorithm action failed. Please try again.",
      );
    } finally {
      setIsAlgorithmActionSubmitting(false);
      if (succeeded) finishAlgorithmActionModal();
    }
  };

  const closeStopProjectModal = () => {
    if (isStoppingProject) return;
    setIsStopProjectModalClosing(true);
    window.setTimeout(() => {
      setIsStopProjectModalOpen(false);
      setIsStopProjectModalClosing(false);
    }, 280);
  };

  const confirmStopProject = async () => {
    if (!projectId || isDemoProject) return;
    setIsStoppingProject(true);
    setStopProjectError("");
    let succeeded = false;
    try {
      const response = await apiFetch(`${API_BASE}/projects/${projectId}/stop`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null) as {
        detail?: string;
        latest_job?: ProjectJob;
      } | null;
      if (!response.ok) {
        throw new Error(
          payload?.detail || `The server returned HTTP ${response.status}.`,
        );
      }

      if (projectId) clearCachedResults(projectId);
      if (payload?.latest_job) {
        setLatestJob(payload.latest_job);
      }
      void refreshProjectData();
      succeeded = true;
    } catch (stopError) {
      setStopProjectError(
        stopError instanceof Error && stopError.message
          ? stopError.message
          : "The project could not be stopped. Please try again.",
      );
    } finally {
      setIsStoppingProject(false);
      if (succeeded) {
        setIsStopProjectModalClosing(true);
        window.setTimeout(() => {
          setIsStopProjectModalOpen(false);
          setIsStopProjectModalClosing(false);
        }, 280);
      }
    }
  };

  const stopRunningCount = allJobTasks.filter(
    (task) => task.status === "Running" || task.status === "Stopping",
  ).length;
  const stopQueuedCount = allJobTasks.filter(
    (task) => task.status === "Queued",
  ).length;

  const handleSaveNotificationEmail = useCallback(
    async (email: string) => {
      if (!projectId || isDemoProject) return false;

      try {
        const response = await apiFetch(
          `${API_BASE}/projects/${projectId}/notification-email`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ notification_email: email }),
          }
        );

        if (!response.ok) return false;

        const data = await response.json();
        if (data.latest_job) {
          setLatestJob(data.latest_job);
        }
        await refreshProjectData();
        return true;
      } catch {
        return false;
      }
    },
    [isDemoProject, projectId, refreshProjectData, setLatestJob]
  );



  const handleExportCircosPng = useCallback(
    async (svgElement: SVGSVGElement) => {
      const activeViewLabel =
        activeAlgorithmIds.length >= 2 ? "consensus" : activeAlgorithmIds[0] ?? "network";
      const isolatedLabel = isolatedGene ? `isolated-${isolatedGene}` : "full-view";
      const baseFilename = `${projectId ?? "project"}-${activeViewLabel}-circos-${isolatedLabel}-filtered`;
      const { width, height, viewBox } = getSvgExportSize(svgElement);
      const clonedSvg = svgElement.cloneNode(true) as SVGSVGElement;

      inlineSvgComputedStyles(svgElement, clonedSvg);

      clonedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clonedSvg.setAttribute("width", String(width));
      clonedSvg.setAttribute("height", String(height));
      clonedSvg.setAttribute("viewBox", viewBox);

      const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      background.setAttribute("x", "0");
      background.setAttribute("y", "0");
      background.setAttribute("width", String(width));
      background.setAttribute("height", String(height));
      background.setAttribute("fill", "#ffffff");
      clonedSvg.insertBefore(background, clonedSvg.firstChild);

      const serializedSvg = new XMLSerializer().serializeToString(clonedSvg);
      const svgBlob = new Blob([serializedSvg], {
        type: "image/svg+xml;charset=utf-8",
      });
      const objectUrl = URL.createObjectURL(svgBlob);

      try {
        const image = new Image();
        const imageLoad = new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("Could not render Circos SVG export."));
        });

        image.src = objectUrl;
        await imageLoad;

        const scale = 3;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));

        const context = canvas.getContext("2d");
        if (!context) return;

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        const link = document.createElement("a");
        link.href = canvas.toDataURL("image/png");
        link.download = `${baseFilename}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    },
    [activeAlgorithmIds, isolatedGene, projectId]
  );

  const handleExportNetwork = useCallback(
    (format: "png" | "svg") => {
      const cy = networkGraphRef.current;
      if (!cy) return;

      const activeViewLabel =
        activeAlgorithmIds.length >= 2 ? "consensus" : activeAlgorithmIds[0] ?? "network";
      const isolatedLabel = isolatedGene ? `isolated-${isolatedGene}` : "full-view";
      const baseFilename = `${projectId ?? "project"}-${activeViewLabel}-${networkLayout}-${isolatedLabel}`;

      if (format === "png") {
        const pngDataUrl = cy.png({
          full: false,
          scale: 3,
          bg: "#eef4fb",
        });

        const link = document.createElement("a");
        link.href = pngDataUrl;
        link.download = `${baseFilename}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      const rawSvgMarkup = cy.svg({
        full: false,
        scale: 1,
        bg: "#eef4fb",
      });

      const parser = new DOMParser();
      const svgDocument = parser.parseFromString(rawSvgMarkup, "image/svg+xml");
      const svgElement = svgDocument.documentElement;

      const widthAttr = svgElement.getAttribute("width");
      const heightAttr = svgElement.getAttribute("height");
      const fallbackWidth = Math.max(1, Math.round(cy.width()));
      const fallbackHeight = Math.max(1, Math.round(cy.height()));
      const numericWidth = widthAttr ? Number.parseFloat(widthAttr) : fallbackWidth;
      const numericHeight = heightAttr ? Number.parseFloat(heightAttr) : fallbackHeight;
      const safeWidth =
        Number.isFinite(numericWidth) && numericWidth > 0 ? numericWidth : fallbackWidth;
      const safeHeight =
        Number.isFinite(numericHeight) && numericHeight > 0 ? numericHeight : fallbackHeight;

      if (!svgElement.getAttribute("viewBox")) {
        svgElement.setAttribute("viewBox", `0 0 ${safeWidth} ${safeHeight}`);
      }

      svgElement.setAttribute("width", "100%");
      svgElement.setAttribute("height", "100%");
      svgElement.setAttribute("preserveAspectRatio", "xMidYMid meet");

      const serializedSvg = new XMLSerializer().serializeToString(svgDocument);
      const blob = new Blob([serializedSvg], {
        type: "image/svg+xml;charset=utf-8",
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = `${baseFilename}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    },
    [activeAlgorithmIds, isolatedGene, networkLayout, projectId]
  );

useEffect(() => {
  const maxConsensusValue = Math.max(activeAlgorithmIds.length, 1);
  const defaultConsensusValue = Math.max(1, Math.floor(maxConsensusValue / 2));

  setConsensusThreshold((current) => {
    // Non-demo projects get their initial consensus value from the edge-seeding
    // effect above; here we only keep it in range as the algorithm set changes.
    if (!isDemoProject) {
      return clamp(current, 1, maxConsensusValue);
    }

    if (hasAppliedDemoDefaultsRef.current) {
      return clamp(current, 1, maxConsensusValue);
    }

    if (!hasTouchedConsensusThreshold) {
      return defaultConsensusValue;
    }

    return clamp(current, 1, maxConsensusValue);
  });
}, [activeAlgorithmIds, hasTouchedConsensusThreshold, isDemoProject]);

  useEffect(() => {
    if (!selectedGene) return;

    if (!networkNodes.some((node) => node.id === selectedGene)) {
      setSelectedGene(null);
    }
  }, [networkNodes, selectedGene]);

  const handleOpenPerturbation = useCallback((gene: string) => {
    setPerturbationEntryGene(gene);
    setResultsHubView("perturbation");
  }, []);

  const renderResultsControls = () => (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
      <label className="relative block w-full sm:w-[220px] lg:w-[240px]">
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-slate-400" aria-hidden="true">
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
            <circle cx="8.5" cy="8.5" r="5.25" stroke="currentColor" strokeWidth="1.8" />
            <path d="m12.4 12.4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <input
          value={tableSearch}
          onChange={(event) => setTableSearch(event.target.value)}
          placeholder="Search genes"
          aria-label="Search genes"
          className="h-10 w-full min-w-0 rounded-full border border-slate-200 bg-white pl-11 pr-5 text-sm font-semibold text-slate-700 outline-none transition placeholder:font-medium placeholder:text-slate-400 hover:border-[#1b75a6]/30 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
        />
      </label>
      <ResultsControlsSection
        compact
        projectId={projectId}
        completedAlgorithmIds={completedAlgorithmIds}
        algorithmCatalog={algorithmCatalog}
        selectedAlgorithmIds={selectedAlgorithmIds}
        onChangeSelectedAlgorithmIds={(value) => {
          setSelectedAlgorithmIds(value);
          setSelectedGene(null);
          setSelectedEdgeKey(null);
          setIsolatedGene(null);
        }}
        resultScopes={availableResultScopes}
        selectedResultScopeId={selectedResultScopeId}
        onChangeSelectedResultScopeId={(value) => {
          setSelectedResultScopeId(value);
          setSelectedGene(null);
          setSelectedEdgeKey(null);
          setIsolatedGene(null);
        }}
        evidenceThreshold={evidenceThreshold}
        onChangeEvidenceThreshold={(value) => {
          setEvidenceThreshold(value);
        }}
        confidenceThreshold={confidenceThreshold}
        onChangeConfidenceThreshold={(value) => {
          setConfidenceThreshold(value);
        }}
        directionConfidenceThreshold={directionConfidenceThreshold}
        onChangeDirectionConfidenceThreshold={(value) => {
          setDirectionConfidenceThreshold(value);
        }}
        signConfidenceThreshold={signConfidenceThreshold}
        onChangeSignConfidenceThreshold={(value) => {
          setSignConfidenceThreshold(value);
        }}
        consensusThreshold={consensusThreshold}
        maxConsensusThreshold={Math.max(activeAlgorithmIds.length, 1)}
        onChangeConsensusThreshold={(value) => {
          setHasTouchedConsensusThreshold(true);
          setConsensusThreshold(value);
        }}
        isConsensusView={activeAlgorithmIds.length >= 2}
        edgeDisplayLimit={edgeDisplayLimit}
        onChangeEdgeDisplayLimit={setEdgeDisplayLimit}
        filteredEdgeCount={filteredNetworkEdges.length}
        isGuideOpen={isResultsGuideOpen}
        onOpenGuide={() => setIsResultsGuideOpen(true)}
      />
    </div>
  );


  if (error) {
    return (
      <main className="min-h-screen bg-[#f7fbff] text-slate-900">
        <section className="mx-auto max-w-[1180px] px-6 py-10 lg:px-10">
          <Link
            href="/projects"
            className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
          >
            Back to projects
          </Link>
          <div className="mt-8 rounded-[1.5rem] border border-rose-200 bg-rose-50 p-6 shadow-sm">
            <p className="text-rose-700">{error}</p>
            {!isDemoProject ? (
              <button
                type="button"
                onClick={reload}
                className="mt-4 inline-flex h-10 items-center rounded-full bg-[#1b75a6] px-5 text-sm font-bold text-white transition hover:bg-[#155f87]"
              >
                Try again
              </button>
            ) : null}
          </div>
        </section>
      </main>
    );
  }

  if (isLoadingProject && !project) {
    return (
      <main className="min-h-screen bg-[#f7fbff] text-slate-900">
        <section className="mx-auto flex max-w-[1180px] flex-col items-center justify-center px-6 py-32 lg:px-10">
          <span
            className="h-9 w-9 animate-spin rounded-full border-[3px] border-slate-200 border-t-[#1b75a6]"
            aria-hidden="true"
          />
          <p className="mt-4 text-sm font-semibold text-slate-500">Loading project…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="relative overflow-x-clip overflow-y-visible bg-[#f7fbff]">
        <div className="relative mx-auto max-w-[1180px] px-6 py-10 lg:px-10">
          <ProjectHeader
            projectName={project?.project_name?.trim() || (isDemoProject ? "Demo Project" : "Untitled project")}
            projectId={projectId}
            projectContext={(
              <AnalysisSetupSection
                status={(
                  projectSetupError ? (
                    <DatasetValidationStatus
                      message={projectSetupError}
                      issues={isMatrixSetupError ? matrixValidationIssues : []}
                      title={
                        isMatrixSetupError
                          ? "Matrix needs attention"
                          : "Setup needs attention"
                      }
                    />
                  ) : (
                    <JobProgressBanner
                      tasks={allJobTasks}
                      algorithmMetaMap={algorithmMetaMap}
                      notificationEmail={project?.notification_email ?? null}
                      onSaveNotificationEmail={
                        isDemoProject ? undefined : handleSaveNotificationEmail
                      }
                      onStopProject={
                        isDemoProject
                          ? undefined
                          : () => {
                              setStopProjectError("");
                              setIsStopProjectModalClosing(false);
                              setIsStopProjectModalOpen(true);
                            }
                      }
                      estimationStatus={pseudotimeEstimation}
                    />
                  )
                )}
              >
                {projectSetupError ? (
                  <DatasetValidationIssuesSection
                    issues={isMatrixSetupError ? matrixValidationIssues : []}
                    fallbackMessage={projectSetupError}
                    heading={
                      isMatrixSetupError ? "Validation issues" : "Setup issue"
                    }
                    description={
                      isMatrixSetupError
                        ? "Fix these before this project can start an analysis."
                        : "GRNScope could not finish preparing this project."
                    }
                    fallbackTitle={
                      isMatrixSetupError
                        ? "Matrix validation issue"
                        : "Project setup failed"
                    }
                    fallbackCode={setupErrorType ?? "project_setup"}
                  />
                ) : null}

                <AlgorithmCardsSection
                  tasks={allJobTasks}
                  algorithmMetaMap={algorithmMetaMap}
                  onOpenAlgorithmError={(task, anchorElement) => {
                    // Almost every algorithm failure is an internal/backend issue the
                    // user can't act on, so show a general message. The one exception
                    // is CellOracle's species/base-GRN mismatch, which the user can
                    // fix. (Dataset/matrix problems surface in the dataset-validation
                    // section, not here.)
                    let displayMessage = GENERAL_ALGORITHM_FAILURE_MESSAGE;
                    let displayErrorType = task.errorType;

                    if (
                      isCellOracleSpeciesMismatch(
                        task.algorithmId,
                        task.errorMessage ?? "",
                      )
                    ) {
                      const selectedSpecies = String(project?.celloracle?.species ?? "human");
                      const selectedSpeciesLabel = selectedSpecies
                        .replaceAll("_", " ")
                        .replace(/\b\w/g, (character) => character.toUpperCase());
                      displayMessage = `CellOracle found no transcription factors shared by this dataset and the ${selectedSpeciesLabel} base regulatory network. Confirm that ${selectedSpeciesLabel} is the correct species and that the matrix uses ${selectedSpeciesLabel} gene identifiers.`;
                      displayErrorType = CELLORACLE_SPECIES_ERROR_TYPE;
                    }

                    setActiveAlgorithmError({
                      task: {
                        ...task,
                        errorMessage: displayMessage,
                        errorType: displayErrorType,
                      },
                      anchorElement,
                    });
                  }}
                  onStopAlgorithm={(task) => requestAlgorithmAction("stop", task)}
                  onRerunAlgorithm={(task) => requestAlgorithmAction("rerun", task)}
                  compact
                />

                <DatasetPreprocessingSection
                  projectId={projectId}
                  inputGeneCount={metadata?.gene_count}
                  cellCount={metadata?.cell_count}
                  finalGeneCount={metadata?.preprocessing_result?.gene_count}
                  matrixTreatmentLabel={matrixTreatmentLabel}
                  preprocessing={metadata?.preprocessing}
                  preprocessingStatus={
                    metadata?.preprocessing_status ??
                    project?.preprocessing_status
                  }
                  preprocessingResult={metadata?.preprocessing_result}
                  methodAdjustments={methodGeneAdjustments}
                  onOpenDownloadMenu={() => {
                    if (!projectId) return;
                    setIsFileDownloadMenuOpen(true);
                  }}
                  onCloseDownloadMenu={() => setIsFileDownloadMenuOpen(false)}
                  isDownloadMenuOpen={isFileDownloadMenuOpen}
                  divided={allJobTasks.length > 0}
                  compact
                  downloadMenu={(
                    <FileDownloadMenuModal
                      open={isFileDownloadMenuOpen}
                      projectId={projectId}
                      apiBase={API_BASE}
                      expressionFilename={metadata?.expression_filename || project?.expression_filename}
                      pseudotimeFilename={metadata?.pseudotime_filename || project?.pseudotime_filename}
                      hasPseudotime={metadata?.has_pseudotime}
                      activeAlgorithmIds={activeAlgorithmIds}
                      selectedResultScopeId={selectedResultScopeId}
                      evidenceThreshold={evidenceThreshold}
                      confidenceThreshold={confidenceThreshold}
                      directionConfidenceThreshold={directionConfidenceThreshold}
                      signConfidenceThreshold={signConfidenceThreshold}
                      consensusThreshold={consensusThreshold}
                      edgeDisplayLimit={edgeDisplayLimit}
                      onClose={() => setIsFileDownloadMenuOpen(false)}
                      onOpenDownload={openDownloadModal}
                    />
                  )}
                />
              </AnalysisSetupSection>
            )}
            viewSelector={(
              <ResultsHubViewSelector
                view={resultsHubView}
                onChange={setResultsHubView}
                cellOracleReady={cellOracleReady}
                cellOracleStatus={cellOracleTask?.status}
                hasTrajectory={
                  metadata?.has_pseudotime === true ||
                  visualizationContext?.trajectory?.available === true
                }
                hasGroundTruth={
                  metadata?.has_ground_truth === true ||
                  visualizationContext?.ground_truth?.available === true
                }
              />
            )}
          />

          <ResultsHubSection>
                {resultsHubView === "perturbation" && projectId ? (
                  <PerturbationAnalysisSection
                    projectId={projectId}
                    cellOracleStatus={cellOracleTask?.status}
                    initialGene={perturbationEntryGene}
                  />
                ) : (
                  <>
                {isPreparingFinishedResults && (
                  <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-[#1b75a6]"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-950">
                          Preparing finished results
                        </p>
                        <p className="mt-1 text-sm leading-6 text-slate-600">
                          Loading saved edge files and building the visualizations. No action is needed.
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-slate-500">
                        {loadedCompletedAlgorithmCount}/{completedAlgorithmIds.length} loaded
                      </span>
                    </div>
                  </div>
                )}

                {completedResultsError &&
                loadedCompletedAlgorithmCount > 0 &&
                !isPreparingFinishedResults ? (
                  <div
                    className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5"
                    role="alert"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-amber-900">
                          Some saved results could not be loaded
                        </p>
                        <p className="mt-1 text-sm leading-6 text-amber-800">
                          {completedResultsError}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={reload}
                        className="inline-flex h-9 items-center rounded-full border border-amber-300 bg-white px-4 text-xs font-bold text-amber-800 transition hover:bg-amber-100"
                      >
                        Try again
                      </button>
                    </div>
                  </div>
                ) : null}

                {isPreparingFinishedResults ? null : resultsAvailabilityNotice ? (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
                    <p className="text-lg font-bold text-slate-950">{resultsAvailabilityNotice.title}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {resultsAvailabilityNotice.description}
                    </p>
                    {resultsAvailabilityNotice.canRetry ? (
                      <button
                        type="button"
                        onClick={reload}
                        className="mt-5 inline-flex h-10 items-center rounded-full bg-[#1b75a6] px-5 text-sm font-bold text-white transition hover:bg-[#155f87]"
                      >
                        Try again
                      </button>
                    ) : null}
                  </div>
                  ) : resultsHubView !== "network" && resultsHubView !== "perturbation" ? (
                    <ResultsInsightsSection
                      view={resultsHubView}
                      algorithmEdgeRows={standardizedAlgorithmEdgeRows}
                      algorithmMetaMap={algorithmMetaMap}
                      algorithmResults={algorithmResults}
                      activeAlgorithmIds={activeAlgorithmIds}
                      edgeExplorerRows={
                        activeAlgorithmIds.length >= 2
                          ? consensusCandidateRows
                          : activeAlgorithmIds.length === 1
                            ? standardizedAlgorithmEdgeRows[activeAlgorithmIds[0]] ?? []
                            : []
                      }
                      selectedResultScopeId={selectedResultScopeId}
                      tasks={allJobTasks}
                      visualizationContext={visualizationContext}
                      isContextLoading={isVisualizationContextLoading}
                      onTrajectoryGenesChange={setTrajectoryRequestedGenes}
                    />
                  ) : (
                  <div className="rounded-[1.25rem] border border-slate-200 bg-white p-5 sm:p-6">
                    <div className="space-y-6">
                      <NetworkVisualizationSection
                      networkLayout={networkLayout}
                      setNetworkLayout={setNetworkLayout}
                      onExportNetwork={handleExportNetwork}
                      onExportCircosPng={handleExportCircosPng}
                      onGraphReady={(cy) => {
                        networkGraphRef.current = cy;
                      }}
                      networkNodes={networkNodes}
                      filteredNetworkEdges={filteredNetworkEdges}
                      selectedGene={selectedGene}
                      selectedEdgeKey={selectedEdgeKey}
                      setSelectedGene={setSelectedGene}
                      setSelectedEdgeKey={setSelectedEdgeKey}
                      selectedNode={selectedNode}
                      isolatedGene={isolatedGene}
                      setIsolatedGene={setIsolatedGene}
                      edgeDisplayLimit={edgeDisplayLimit}
                      cellOracleReady={cellOracleReady}
                      perturbationGenes={perturbationGenes}
                      onOpenPerturbation={handleOpenPerturbation}
                      resultsControls={renderResultsControls()}
                      />
                    </div>
                  </div>
                )}
                  </>
                )}
          </ResultsHubSection>

          <ResultsGuideModal
            open={isResultsGuideOpen}
            onClose={() => setIsResultsGuideOpen(false)}
          />
          <ConfirmDownloadModal
            pendingDownload={pendingDownload}
            isClosing={isDownloadModalClosing}
            onClose={closeDownloadModal}
          />

          <AlgorithmErrorPopover
            task={activeAlgorithmError?.task ?? null}
            anchorElement={activeAlgorithmError?.anchorElement ?? null}
            onClose={() => setActiveAlgorithmError(null)}
          />

          {pendingAlgorithmAction && (
            <div
              className={`fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/45 px-6 py-10 backdrop-blur-sm ${
                isAlgorithmActionModalClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
              }`}
              onClick={closeAlgorithmActionModal}
            >
              <div
                className={`w-full max-w-md rounded-[1.75rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 ${
                  isAlgorithmActionModalClosing ? "animate-modal-panel-out" : "animate-modal-panel"
                }`}
                onClick={(event) => event.stopPropagation()}
              >
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#1b75a6]">
                  {pendingAlgorithmAction.type === "stop" ? "Stop algorithm" : "Run again"}
                </p>
                <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">
                  {pendingAlgorithmAction.type === "stop"
                    ? `Stop ${pendingAlgorithmAction.algorithmName}?`
                    : `Run ${pendingAlgorithmAction.algorithmName} again?`}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {pendingAlgorithmAction.type === "stop"
                    ? "This will terminate the current run. Partial results will not be used."
                    : "This will start a fresh run using the same project input files."}
                </p>

                {algorithmActionError ? (
                  <p
                    className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
                    role="alert"
                  >
                    {algorithmActionError}
                  </p>
                ) : null}

                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeAlgorithmActionModal}
                    disabled={isAlgorithmActionSubmitting || isAlgorithmActionModalClosing}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmAlgorithmAction}
                    disabled={isAlgorithmActionSubmitting || isAlgorithmActionModalClosing}
                    className={`rounded-full px-4 py-2 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      pendingAlgorithmAction.type === "stop"
                        ? "bg-rose-600 hover:bg-rose-700"
                        : "bg-[#1b75a6] hover:bg-[#155f87]"
                    }`}
                  >
                    {isAlgorithmActionSubmitting
                      ? "Working..."
                      : pendingAlgorithmAction.type === "stop"
                        ? "Stop"
                        : "Run again"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {isStopProjectModalOpen ? (
            <StopProjectModal
              projectName={
                project?.project_name?.trim() || (isDemoProject ? "Demo Project" : "Untitled project")
              }
              runningCount={stopRunningCount}
              queuedCount={stopQueuedCount}
              isStopping={isStoppingProject}
              isClosing={isStopProjectModalClosing}
              error={stopProjectError}
              onCancel={closeStopProjectModal}
              onConfirm={confirmStopProject}
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}
