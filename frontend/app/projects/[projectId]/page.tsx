"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Core } from "cytoscape";
import ProjectHeader from "./_components/ProjectHeader";
import ResultsSummarySection from "./_components/ResultsSummarySection";
import ResultsControlsSection from "./_components/ResultsControlsSection";
import EdgeAnalysisTableSection from "./_components/EdgeAnalysisTableSection";
import NetworkVisualizationSection from "./_components/NetworkVisualizationSection";
import AlgorithmErrorPopover from "./_components/AlgorithmErrorPopover";
import ConfirmDownloadModal from "./_components/ConfirmDownloadModal";
import DatasetHelpModal from "./_components/DatasetHelpModal";
import FileDownloadMenuModal from "./_components/FileDownloadMenuModal";
import ResultsGuideModal from "./_components/ResultsGuideModal";
import AlgorithmCardsSection from "./_components/AlgorithmCardsSection";
import DatasetPreprocessingSection from "./_components/DatasetPreprocessingSection";
import JobProgressBanner from "./_components/JobProgressBanner";
import DatasetValidationStatus from "./_components/DatasetValidationStatus";
import DatasetValidationIssuesSection from "./_components/DatasetValidationIssuesSection";
import AlgorithmWarningPopover, {
  type AlgorithmWarning,
} from "./_components/AlgorithmWarningPopover";
import ResultsHubSection from "./_components/ResultsHubSection";
import ResultsHubViewSelector from "./_components/ResultsHubViewSelector";
import PerturbationAnalysisSection from "./_components/PerturbationAnalysisSection";
import AnalysisSetupSection from "./_components/AnalysisSetupSection";
import useProjectDetailData from "./_hooks/useProjectDetailData";
import { API_BASE } from "../../_lib/apiConfig";
import { apiFetch } from "../../_lib/clientIdentity";
import { startPendingProjectUpload } from "../_lib/pendingProjectUpload";

import {
  type AggregatedEdge,
  type AlgorithmResultEdge,
  type AlgorithmStoredResult,
  type MetadataManifest,
  type NodeInfo,
  type OverlapEntry,
  type ProjectManifest,
} from "./_lib/types";
import { boolText, clamp } from "./_lib/utils";

const CONFIDENCE_STABILITY_TOP_K = 10;
const MODAL_ANIMATION_MS = 480;

type GeneCoordinateInfo = {
  chromosome?: string | null;
  start?: number | null;
  end?: number | null;
  strand?: string | null;
  gene_type?: string | null;
  gene_id?: string | null;
};

const edgeKeyFor = (source: string, target: string) => `${source}|||${target}`;

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
    algorithmResults,
    algorithmCatalog,
    isLoadingCompletedResults,
    error,
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
  const [visibleAlgorithmColumns, setVisibleAlgorithmColumns] = useState<string[]>([]);
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const [tableSortKey, setTableSortKey] = useState<"rank" | "source" | "target" | "score" | "count">("rank");
  const [tableSortDirection, setTableSortDirection] = useState<"asc" | "desc">("asc");
  const [pendingDownload, setPendingDownload] = useState<{ label: string; href: string; filename: string } | null>(null);
  const [isDownloadModalClosing, setIsDownloadModalClosing] = useState(false);
  const [isFileDownloadMenuOpen, setIsFileDownloadMenuOpen] = useState(false);
  const [isDatasetHelpOpen, setIsDatasetHelpOpen] = useState(false);
  const [isResultsGuideOpen, setIsResultsGuideOpen] = useState(false);
  const [activeAlgorithmError, setActiveAlgorithmError] = useState<{
    task: {
      algorithmId: string;
      errorMessage: string;
      errorType?: string | null;
    };
    anchorElement: HTMLElement;
  } | null>(null);
  const [activeAlgorithmWarnings, setActiveAlgorithmWarnings] = useState<{
    warnings: AlgorithmWarning[];
    anchorElement: HTMLElement;
  } | null>(null);
  const [pendingAlgorithmAction, setPendingAlgorithmAction] = useState<{
    type: "stop" | "rerun";
    algorithmId: string;
    algorithmName: string;
  } | null>(null);
  const [isAlgorithmActionSubmitting, setIsAlgorithmActionSubmitting] = useState(false);
  const [isAlgorithmActionModalClosing, setIsAlgorithmActionModalClosing] = useState(false);
  const [resultsHubView, setResultsHubView] = useState<"network" | "perturbation">("network");

  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const networkGraphRef = useRef<Core | null>(null);
  const hasAppliedDemoDefaultsRef = useRef(false);
  const algorithmActionCloseTimeoutRef = useRef<number | null>(null);

  const demoProjectFlag = project as (ProjectManifest & { is_demo?: boolean; read_only?: boolean }) | null;
  const demoMetadataFlag = metadata as (MetadataManifest & { is_demo?: boolean; read_only?: boolean }) | null;
  const isDemoProject = isDemoRoute || demoProjectFlag?.is_demo === true || demoMetadataFlag?.is_demo === true;

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

  const expressionMatrixLabel =
    metadata?.gene_count && metadata?.cell_count
      ? `${metadata.gene_count.toLocaleString()} genes × ${metadata.cell_count.toLocaleString()} cells`
      : isDemoProject
        ? "19 genes × 2,000 cells"
        : "Pending";
  const topVariableGenesLabel = isDemoProject
    ? "All 19 genes retained"
    : metadata?.preprocessing?.top_variable_genes?.trim().toLowerCase() === "all"
      ? "All genes retained"
      : metadata?.preprocessing?.top_variable_genes || "-";
  const tfOverrideLabel = isDemoProject
    ? "Enabled"
    : boolText(metadata?.preprocessing?.include_all_tfs);
  const normalizationLabel = isDemoProject
    ? "Enabled"
    : boolText(metadata?.preprocessing?.normalize_enabled);
  const logTransformLabel = isDemoProject
    ? "Enabled"
    : boolText(metadata?.preprocessing?.log_transform_enabled);


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
      matrixValidationError
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
    [matrixValidationError, rawJobTasks],
  );
  const algorithmWarnings = useMemo<AlgorithmWarning[]>(() => {
    const selectedAlgorithmIds = new Set(
      [
        ...(project?.selected_algorithms ?? []),
        ...(metadata?.selected_algorithms ?? []),
        ...rawJobTasks.map((task) => task.algorithm_id),
      ].map((algorithmId) => String(algorithmId).toUpperCase()),
    );
    const warnings: AlgorithmWarning[] = [];

    if (selectedAlgorithmIds.has("CELLORACLE")) {
      const selectedSpecies = String(project?.celloracle?.species ?? "human");
      const selectedSpeciesLabel = selectedSpecies
        .replaceAll("_", " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
      const inferredSpecies = metadata?.species_inference;
      if (
        inferredSpecies?.species &&
        inferredSpecies.species !== selectedSpecies
      ) {
        warnings.push({
          code: "celloracle-species-mismatch",
          algorithmId: "CELLORACLE",
          title: "CellOracle species does not match the dataset",
          message: `This dataset appears to use ${inferredSpecies.label} gene IDs, but CellOracle is set to ${selectedSpeciesLabel}. Change CellOracle species to ${inferredSpecies.label} or deselect CellOracle.`,
        });
      } else {
        const cellOracleFailure = rawJobTasks.find(
          (task) =>
            task.algorithm_id.toUpperCase() === "CELLORACLE" &&
            task.status === "Failed",
        );
        const failureMessage = cellOracleFailure?.error_message?.toLowerCase() ?? "";
        if (
          failureMessage.includes("overlap") ||
          failureMessage.includes("transcription factor") ||
          failureMessage.includes("base grn")
        ) {
          warnings.push({
            code: "celloracle-prior-overlap",
            algorithmId: "CELLORACLE",
            title: "CellOracle could not match this dataset",
            message: `CellOracle could not find transcription factors shared by this dataset and the ${selectedSpeciesLabel} base regulatory network. Check that the matrix uses ${selectedSpeciesLabel} gene identifiers, or deselect CellOracle.`,
          });
        }
      }
    }

    const uploadedGeneCount = metadata?.gene_count;
    const uploadedCellCount = metadata?.cell_count;
    if (selectedAlgorithmIds.has("PIDC")) {
      const configuredPidcMaxGenes =
        project?.algorithm_parameters?.PIDC?.maxGenes ??
        project?.resolved_algorithm_parameters?.PIDC?.maxGenes ??
        metadata?.algorithm_parameters?.PIDC?.maxGenes ??
        metadata?.resolved_algorithm_parameters?.PIDC?.maxGenes ??
        500;
      const parsedPidcMaxGenes = Number(configuredPidcMaxGenes);
      const pidcMaxGenes =
        Number.isFinite(parsedPidcMaxGenes) && parsedPidcMaxGenes > 0
          ? Math.floor(parsedPidcMaxGenes)
          : 500;
      const effectivePidcGeneCount =
        typeof uploadedGeneCount === "number"
          ? Math.min(uploadedGeneCount, pidcMaxGenes)
          : pidcMaxGenes;

      warnings.push({
        code: "pidc-gene-filtering",
        algorithmId: "PIDC",
        title: "PIDC applies its own gene filtering",
        message: `PIDC will analyze at most ${effectivePidcGeneCount.toLocaleString()} highest-variance genes after the project-wide gene filter. PIDC evaluates gene triplets, so increasing this value can cause a very large increase in runtime and memory use.`,
      });
    }

    if (selectedAlgorithmIds.has("SINGE")) {
      const configuredSingeMaxGenes =
        project?.algorithm_parameters?.SINGE?.maxGenes ??
        project?.resolved_algorithm_parameters?.SINGE?.maxGenes ??
        metadata?.algorithm_parameters?.SINGE?.maxGenes ??
        metadata?.resolved_algorithm_parameters?.SINGE?.maxGenes ??
        500;
      const parsedSingeMaxGenes = Number(configuredSingeMaxGenes);
      const singeMaxGenes =
        Number.isFinite(parsedSingeMaxGenes) && parsedSingeMaxGenes > 0
          ? Math.floor(parsedSingeMaxGenes)
          : 500;
      const effectiveSingeGeneCount =
        typeof uploadedGeneCount === "number"
          ? Math.min(uploadedGeneCount, singeMaxGenes)
          : singeMaxGenes;

      warnings.push({
        code: "singe-gene-filtering",
        algorithmId: "SINGE",
        title: "SINGE uses a runtime-focused gene set",
        message: `SINGE is currently configured to use ${effectiveSingeGeneCount.toLocaleString()} highest-variance genes after the project-wide gene filter because its lagged regulator-target calculations become much slower as gene count increases. You can change this value in SINGE's parameter settings.`,
      });
    }

    if (selectedAlgorithmIds.has("SCRIBE")) {
      const configuredScribeMaxGenes =
        project?.algorithm_parameters?.SCRIBE?.maxGenes ??
        project?.resolved_algorithm_parameters?.SCRIBE?.maxGenes ??
        metadata?.algorithm_parameters?.SCRIBE?.maxGenes ??
        metadata?.resolved_algorithm_parameters?.SCRIBE?.maxGenes ??
        300;
      const parsedScribeMaxGenes = Number(configuredScribeMaxGenes);
      const scribeMaxGenes =
        Number.isFinite(parsedScribeMaxGenes) && parsedScribeMaxGenes > 0
          ? Math.floor(parsedScribeMaxGenes)
          : 300;
      const effectiveScribeGeneCount =
        typeof uploadedGeneCount === "number"
          ? Math.min(uploadedGeneCount, scribeMaxGenes)
          : scribeMaxGenes;

      warnings.push({
        code: "scribe-gene-filtering",
        algorithmId: "SCRIBE",
        title: "SCRIBE uses a runtime-focused gene set",
        message: `SCRIBE is currently configured to use ${effectiveScribeGeneCount.toLocaleString()} highest-variance genes after the project-wide gene filter because its directed-information calculation compares every gene pair and becomes very slow on larger matrices. You can change this value in SCRIBE's parameter settings.`,
      });
    }

    if (
      selectedAlgorithmIds.has("SINCERITIES") &&
      typeof uploadedGeneCount === "number" &&
      typeof uploadedCellCount === "number" &&
      uploadedGeneCount > uploadedCellCount
    ) {
      warnings.push({
        code: "sincerities-genes-exceed-cells",
        algorithmId: "SINCERITIES",
        title: "SINCERITIES has more genes than cells",
        message: `This matrix contains ${uploadedGeneCount.toLocaleString()} genes and ${uploadedCellCount.toLocaleString()} cells. SINCERITIES derives edge signs from an all-gene partial-correlation matrix, which can become singular when genes outnumber cells. GRNScope will apply SINCERITIES's separate highest-variance gene filter before analysis to keep this calculation stable.`,
      });
    }

    return warnings;
  }, [metadata, project, rawJobTasks]);
  const warningsByAlgorithm = useMemo(() => {
    const grouped = new Map<string, AlgorithmWarning[]>();
    for (const warning of algorithmWarnings) {
      const key = warning.algorithmId.toUpperCase();
      const existing = grouped.get(key);
      if (existing) existing.push(warning);
      else grouped.set(key, [warning]);
    }
    return grouped;
  }, [algorithmWarnings]);
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
  }, [completedAlgorithmIds]);

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
            const evidence = numericEvidenceScore(entry.edge, percentile);
            const confidence = numericConfidenceScore(entry.edge, percentile);
            const meanPercentile = backendMeanPercentile ?? percentile;
            const stability = backendStability ?? (rank <= CONFIDENCE_STABILITY_TOP_K ? 1 : 0);
            const signVote = isSigned ? signOf(entry.signedScore) : 0;
            const direction =
              isDirected || !candidateRegulatorSet.has(entry.target) ? 1 : 0;
            const supportingAlgorithms =
              evidence >= 0.5 || rank <= CONFIDENCE_STABILITY_TOP_K
                ? [algorithmId]
                : [];

            rows.push({
              key: `${algorithmId}-${entry.source}-${entry.target}`,
              source: entry.source,
              target: entry.target,
              score: evidence,
              confidence,
              stability,
              meanPercentile,
              count: supportingAlgorithms.length,
              rank,
              supportingAlgorithms,
              perAlgorithmScores: {
                [algorithmId]: evidence,
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
              signConfidence: signVote === 0 ? null : 1,
              signCoverage: isSigned && signVote !== 0 ? 1 : 0,
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
      rawScore: number | undefined;
      isSupported: boolean;
    };

    type ConsensusAccumulator = {
      source: string;
      target: string;
      totalEvidence: number;
      directionVote: number;
      directionDenominator: number;
      directionCoverageEvidence: number;
      signVote: number;
      signDenominator: number;
      supportingAlgorithms: string[];
      perAlgorithmScores: Record<string, number>;
      perAlgorithmRawScores: Record<string, number>;
      perAlgorithmSigns: Record<string, -1 | 0 | 1>;
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
        signVote: 0,
        signDenominator: 0,
        supportingAlgorithms: [],
        perAlgorithmScores: {},
        perAlgorithmRawScores: {},
        perAlgorithmSigns: {},
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
              rawScore: forward?.perAlgorithmRawScores?.[algorithmId],
              isSupported: forward?.supportingAlgorithms.includes(algorithmId) ?? false,
            };
          } else {
            methodEvidence = {
              evidence: reverseEvidence,
              directionVote: isDirected ? -1 : 0,
              signVote: isSigned
                ? reverse?.perAlgorithmSigns?.[algorithmId] ?? 0
                : 0,
              rawScore: reverse?.perAlgorithmRawScores?.[algorithmId],
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
          accumulator.signVote += methodEvidence.evidence * methodEvidence.signVote;
          accumulator.signDenominator += methodEvidence.evidence;
        }
      });

      buckets.set(pairKey, accumulator);
    });

    const sortedRows = Array.from(buckets.entries())
      .map(([key, edge]) => {
        const edgeEvidence = clamp(edge.totalEvidence / sumAlpha, 0, 1);
        const stability = edge.supportingAlgorithms.length / sumAlpha;
        const direction = signOf(edge.directionVote);
        const directionConfidence =
          edge.directionDenominator > 0
            ? clamp(Math.abs(edge.directionVote) / edge.directionDenominator, 0, 1)
            : null;
        const directionCoverage =
          edge.totalEvidence > 0 ? edge.directionCoverageEvidence / edge.totalEvidence : 0;
        const sign = signOf(edge.signVote);
        const signConfidence =
          edge.signDenominator > 0
            ? clamp(Math.abs(edge.signVote) / edge.signDenominator, 0, 1)
            : null;
        const signCoverage =
          edge.totalEvidence > 0 ? edge.signDenominator / edge.totalEvidence : 0;
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
          confidence: clamp(stability * edgeEvidence, 0, 1),
          stability,
          count: edge.supportingAlgorithms.length,
          rank: 0,
          supportingAlgorithms: [...edge.supportingAlgorithms].sort(),
          perAlgorithmScores: edge.perAlgorithmScores,
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

  const perAlgorithmEdgeCounts = useMemo(() => {
    return activeAlgorithmIds.map((algorithmId) => ({
      algorithmId,
      count: displayAlgorithmEdgeRows[algorithmId]?.length ?? 0,
    }));
  }, [activeAlgorithmIds, displayAlgorithmEdgeRows]);

  const maxAlgorithmEdgeCount = useMemo(() => {
    return Math.max(...perAlgorithmEdgeCounts.map((item) => item.count), 1);
  }, [perAlgorithmEdgeCounts]);

  const overlapEntries = useMemo<OverlapEntry[]>(() => {
    if (activeAlgorithmIds.length < 2) return [];

    const edgeMembership = new Map<string, string[]>();

    activeAlgorithmIds.forEach((algorithmId) => {
      (displayAlgorithmEdgeRows[algorithmId] ?? []).forEach((edge) => {
        const key = `${edge.source}|||${edge.target}`;
        const current = edgeMembership.get(key) ?? [];
        if (!current.includes(algorithmId)) current.push(algorithmId);
        edgeMembership.set(key, current);
      });
    });

    const buckets = new Map<string, OverlapEntry>();

    edgeMembership.forEach((methods) => {
      const sortedMethods = [...methods].sort();
      const key = sortedMethods.join(" + ");
      const current = buckets.get(key);

      if (current) {
        current.count += 1;
      } else {
        buckets.set(key, {
          key,
          methods: sortedMethods,
          count: 1,
        });
      }
    });

    return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  }, [activeAlgorithmIds, displayAlgorithmEdgeRows]);

  const maxOverlapCount = useMemo(() => {
    return Math.max(...overlapEntries.map((entry) => entry.count), 1);
  }, [overlapEntries]);


  const resultsAvailabilityNotice = useMemo(() => {
    if (isPreparingFinishedResults) {
      return null;
    }

    if (completedAlgorithmIds.length === 0) {
      return {
        title: "No completed algorithm results yet",
        description:
          "The network visualization, overlap summary, and edge analysis table will appear after the first algorithm finishes successfully.",
      };
    }

    if (activeAlgorithmIds.length === 0) {
      return {
        title: "No algorithms selected",
        description:
          "Select at least one completed algorithm to view the network, edge table, and overlap summary.",
      };
    }

    return null;
  }, [
    activeAlgorithmIds.length,
    completedAlgorithmIds.length,
    isPreparingFinishedResults,
  ]);

  const safeEdgeDisplayLimit = useMemo(() => {
    if (filteredNetworkEdges.length === 0) return 0;

    const requestedLimit =
      Number.isFinite(edgeDisplayLimit) && edgeDisplayLimit >= 0
        ? Math.floor(edgeDisplayLimit)
        : 0;

    return Math.min(filteredNetworkEdges.length, requestedLimit);
  }, [edgeDisplayLimit, filteredNetworkEdges.length]);

  const visibleTableRows = useMemo(() => {
    return filteredNetworkEdges.slice(0, safeEdgeDisplayLimit);
  }, [filteredNetworkEdges, safeEdgeDisplayLimit]);

  const sortedTableRows = useMemo(() => {
    const rows = [...visibleTableRows];

    rows.sort((a, b) => {
      let value = 0;

      if (tableSortKey === "rank") value = a.rank - b.rank;
      if (tableSortKey === "source") value = a.source.localeCompare(b.source);
      if (tableSortKey === "target") value = a.target.localeCompare(b.target);
      if (tableSortKey === "score") value = a.score - b.score;
      if (tableSortKey === "count") value = a.count - b.count;

      return tableSortDirection === "asc" ? value : -value;
    });

    return rows;
  }, [visibleTableRows, tableSortDirection, tableSortKey]);

  const TABLE_PAGE_SIZE = 25;

  const totalTablePages = useMemo(() => {
    return Math.max(1, Math.ceil(sortedTableRows.length / TABLE_PAGE_SIZE));
  }, [sortedTableRows.length]);

  const displayedTableRows = useMemo(() => {
    const start = (tablePage - 1) * TABLE_PAGE_SIZE;
    return sortedTableRows.slice(start, start + TABLE_PAGE_SIZE);
  }, [sortedTableRows, tablePage]);

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

    setIsAlgorithmActionSubmitting(true);

    try {
      const response = await apiFetch(
        `${API_BASE}/projects/${projectId}/jobs/${latestJob.job_id}/tasks/${pendingAlgorithmAction.algorithmId}/${pendingAlgorithmAction.type === "stop" ? "stop" : "rerun"}`,
        { method: "POST" }
      );

      if (response.ok) {
        const payload = await response.json();
        if (payload.latest_job) {
          setLatestJob(payload.latest_job);
        }
        await refreshProjectData();
      }

      finishAlgorithmActionModal();
    } finally {
      setIsAlgorithmActionSubmitting(false);
    }
  };

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

  const handleExportEdgeList = useCallback(() => {
    const escapeCsvValue = (value: string | number | null) => {
      const stringValue = String(value);

      if (/[",\n]/.test(stringValue)) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }

      return stringValue;
    };

    const selectedView =
      activeAlgorithmIds.length >= 2 ? "consensus" : activeAlgorithmIds[0] ?? "consensus";

    const headerColumns = [
      selectedView === "consensus" ? "Consensus Rank" : "Rank",
      "Source Gene",
      "Target Gene",
      selectedView === "consensus" ? "Consensus Evidence" : "Regulation Evidence",
      "Inferred Confidence",
      "Direction",
      "Sign",
      "Supporting Algorithms",
      "Supporting Method Count",
    ];

    const lines = [
      headerColumns.join(","),
      ...sortedTableRows.map((edge) => {
        const row = [
          edge.rank,
          edge.source,
          edge.target,
          edge.score.toFixed(3),
          edge.confidence.toFixed(3),
          edge.direction === 1 ? "source_to_target" : edge.direction === -1 ? "reverse" : "unknown",
          edge.sign === 1 ? "positive" : edge.sign === -1 ? "negative" : "unknown",
          edge.supportingAlgorithms.join("; "),
          edge.count,
        ];

        return row.map(escapeCsvValue).join(",");
      }),
    ];

    const csvContent = lines.join("\n");
    const searchLabel =
      tableSearch.trim().length > 0
        ? `-search-${tableSearch.trim().replace(/\s+/g, "-")}`
        : "";
    const filename = `${projectId ?? "project"}-${selectedView}-edge-list${searchLabel}.csv`;

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }, [activeAlgorithmIds, projectId, sortedTableRows, tableSearch]);

useEffect(() => {
  setVisibleAlgorithmColumns(activeAlgorithmIds);

  const maxConsensusValue = Math.max(activeAlgorithmIds.length, 1);
  const defaultConsensusValue = Math.max(1, Math.floor(maxConsensusValue / 2));

  setConsensusThreshold((current) => {
    if (isDemoProject && hasAppliedDemoDefaultsRef.current) {
      return clamp(current, 1, maxConsensusValue);
    }

    if (!hasTouchedConsensusThreshold) {
      return defaultConsensusValue;
    }

    return clamp(current, 1, maxConsensusValue);
  });
}, [activeAlgorithmIds, hasTouchedConsensusThreshold, isDemoProject]);

  useEffect(() => {
    if (!isColumnMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!columnMenuRef.current) return;

      if (!columnMenuRef.current.contains(event.target as Node)) {
        setIsColumnMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isColumnMenuOpen]);

  useEffect(() => {
    if (!selectedGene) return;

    if (!networkNodes.some((node) => node.id === selectedGene)) {
      setSelectedGene(null);
    }
  }, [networkNodes, selectedGene]);

  useEffect(() => {
    setTablePage(1);
  }, [
    tableSearch,
    tableSortDirection,
    tableSortKey,
    selectedAlgorithmIds,
    evidenceThreshold,
    confidenceThreshold,
    directionConfidenceThreshold,
    signConfidenceThreshold,
    consensusThreshold,
    isolatedGene,
    edgeDisplayLimit,
    selectedResultScopeId,
  ]);

  useEffect(() => {
    setTablePage((current) => Math.min(current, totalTablePages));
  }, [totalTablePages]);

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
          <div className="mt-8 rounded-[1.5rem] border border-rose-200 bg-rose-50 p-6 text-rose-700 shadow-sm">
            {error}
          </div>
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
                  matrixValidationError ? (
                    <DatasetValidationStatus
                      message={matrixValidationError}
                      issues={matrixValidationIssues}
                    />
                  ) : (
                    <JobProgressBanner
                      tasks={allJobTasks}
                      algorithmMetaMap={algorithmMetaMap}
                      notificationEmail={project?.notification_email ?? null}
                      onSaveNotificationEmail={
                        isDemoProject ? undefined : handleSaveNotificationEmail
                      }
                    />
                  )
                )}
              >
                {matrixValidationError ? (
                  <DatasetValidationIssuesSection
                    issues={matrixValidationIssues}
                    fallbackMessage={matrixValidationError}
                  />
                ) : null}

                <AlgorithmCardsSection
                  tasks={allJobTasks}
                  algorithmMetaMap={algorithmMetaMap}
                  warningsByAlgorithm={warningsByAlgorithm}
                  onOpenAlgorithmError={(task, anchorElement) => setActiveAlgorithmError({ task, anchorElement })}
                  onOpenAlgorithmWarnings={(warnings, anchorElement) => setActiveAlgorithmWarnings({ warnings, anchorElement })}
                  onStopAlgorithm={(task) => requestAlgorithmAction("stop", task)}
                  onRerunAlgorithm={(task) => requestAlgorithmAction("rerun", task)}
                  compact
                />

                <DatasetPreprocessingSection
                  expressionMatrixLabel={expressionMatrixLabel}
                  topVariableGenesLabel={topVariableGenesLabel}
                  tfOverrideLabel={tfOverrideLabel}
                  normalizationLabel={normalizationLabel}
                  logTransformLabel={logTransformLabel}
                  onOpenHelp={() => setIsDatasetHelpOpen(true)}
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
                      confidenceThreshold={evidenceThreshold}
                      consensusThreshold={consensusThreshold}
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

                {isPreparingFinishedResults ? null : resultsAvailabilityNotice ? (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
                    <p className="text-lg font-bold text-slate-950">{resultsAvailabilityNotice.title}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {resultsAvailabilityNotice.description}
                    </p>
                  </div>
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

                      <EdgeAnalysisTableSection
                      onExportEdgeList={handleExportEdgeList}
                      columnMenuRef={columnMenuRef}
                      isColumnMenuOpen={isColumnMenuOpen}
                      setIsColumnMenuOpen={setIsColumnMenuOpen}
                      completedAlgorithmIds={activeAlgorithmIds}
                      visibleAlgorithmColumns={visibleAlgorithmColumns}
                      setVisibleAlgorithmColumns={setVisibleAlgorithmColumns}
                      selectedView={activeAlgorithmIds.length >= 2 ? "consensus" : activeAlgorithmIds[0] ?? "consensus"}
                      tableSortKey={tableSortKey}
                      tableSortDirection={tableSortDirection}
                      setTableSortKey={setTableSortKey}
                      setTableSortDirection={setTableSortDirection}
                      setTablePage={setTablePage}
                      displayedTableRows={displayedTableRows}
                      selectedEdgeKey={selectedEdgeKey}
                      setSelectedEdgeKey={setSelectedEdgeKey}
                      setSelectedGene={setSelectedGene}
                      totalTablePages={totalTablePages}
                      sortedTableRows={sortedTableRows}
                      tablePage={tablePage}
                      />

                      {activeAlgorithmIds.length >= 2 && (
                        <ResultsSummarySection
                          perAlgorithmEdgeCounts={perAlgorithmEdgeCounts}
                          maxAlgorithmEdgeCount={maxAlgorithmEdgeCount}
                          completedAlgorithmIds={activeAlgorithmIds}
                          overlapEntries={overlapEntries}
                          maxOverlapCount={maxOverlapCount}
                        />
                      )}
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
          <DatasetHelpModal
            open={isDatasetHelpOpen}
            onClose={() => setIsDatasetHelpOpen(false)}
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

          <AlgorithmWarningPopover
            warnings={activeAlgorithmWarnings?.warnings ?? null}
            anchorElement={activeAlgorithmWarnings?.anchorElement ?? null}
            onClose={() => setActiveAlgorithmWarnings(null)}
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
        </div>
      </section>
    </main>
  );
}
