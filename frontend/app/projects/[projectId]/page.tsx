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
import AlgorithmErrorModal from "./_components/AlgorithmErrorModal";
import ConfirmDownloadModal from "./_components/ConfirmDownloadModal";
import DatasetHelpModal from "./_components/DatasetHelpModal";
import FileDownloadMenuModal from "./_components/FileDownloadMenuModal";
import ResultsGuideModal from "./_components/ResultsGuideModal";
import AlgorithmCardsSection from "./_components/AlgorithmCardsSection";
import DatasetPreprocessingSection from "./_components/DatasetPreprocessingSection";
import JobProgressBanner from "./_components/JobProgressBanner";
import ResultsHubSection from "./_components/ResultsHubSection";
import useProjectDetailData from "./_hooks/useProjectDetailData";

import {
  type AggregatedEdge,
  type AlgorithmResultEdge,
  type MetadataManifest,
  type NodeInfo,
  type OverlapEntry,
  type ProjectManifest,
} from "./_lib/types";
import { boolText, clamp } from "./_lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";
const CONFIDENCE_STABILITY_TOP_K = 10;

type GeneCoordinateInfo = {
  chromosome?: string | null;
  start?: number | null;
  end?: number | null;
  strand?: string | null;
  gene_type?: string | null;
  gene_id?: string | null;
};

const edgeKeyFor = (source: string, target: string) => `${source}|||${target}`;

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
    error,
  } = useProjectDetailData({ projectId, isDemoRoute });
  const [selectedAlgorithmIds, setSelectedAlgorithmIds] = useState<string[]>([]);
  const [evidenceThreshold, setEvidenceThreshold] = useState(0.9);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.9);
  const [directionConfidenceThreshold, setDirectionConfidenceThreshold] = useState(0);
  const [signConfidenceThreshold, setSignConfidenceThreshold] = useState(0);
  const [consensusThreshold, setConsensusThreshold] = useState(1);
  const [hasTouchedConsensusThreshold, setHasTouchedConsensusThreshold] = useState(false);
  const [geneSearch, setGeneSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [networkLayout, setNetworkLayout] = useState<"force" | "hierarchical" | "concentric" | "circular" | "circos">("force");
  const [selectedGene, setSelectedGene] = useState<string | null>(null);
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
  const [activeAlgorithmErrorTask, setActiveAlgorithmErrorTask] = useState<{ algorithmId: string; errorMessage: string } | null>(null);

  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const networkGraphRef = useRef<Core | null>(null);
  const hasAppliedDemoDefaultsRef = useRef(false);

  const demoProjectFlag = project as (ProjectManifest & { is_demo?: boolean; read_only?: boolean }) | null;
  const demoMetadataFlag = metadata as (MetadataManifest & { is_demo?: boolean; read_only?: boolean }) | null;
  const isDemoProject = isDemoRoute || demoProjectFlag?.is_demo === true || demoMetadataFlag?.is_demo === true;

  const expressionMatrixLabel =
    metadata?.gene_count && metadata?.cell_count
      ? `${metadata.gene_count.toLocaleString()} genes × ${metadata.cell_count.toLocaleString()} cells`
      : isDemoProject
        ? "19 genes × 2,000 cells"
        : "Pending";
  const topVariableGenesLabel = isDemoProject
    ? "All 19 genes retained"
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


  const allJobTasks = useMemo(() => latestJob?.tasks ?? [], [latestJob]);

  const completedTasks = useMemo(
    () => allJobTasks.filter((task) => task.status === "Completed"),
    [allJobTasks]
  );

  const completedAlgorithmIds = useMemo(
    () => completedTasks.map((task) => task.algorithm_id),
    [completedTasks]
  );


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

  useEffect(() => {
    if (!isDemoProject || hasAppliedDemoDefaultsRef.current) return;
    if (activeAlgorithmIds.length < 7) return;

    setEvidenceThreshold(0.9);
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
      (algorithmResults[algorithmId]?.top_edges ?? []).forEach((edge) => {
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
  }, [algorithmResults, completedAlgorithmIds]);

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

      (algorithmResults[algorithmId]?.top_edges ?? []).forEach((edge) => {
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
        entries
          .sort((a, b) => {
            const scoreDelta = Math.abs(b.rawScore) - Math.abs(a.rawScore);
            if (scoreDelta !== 0) return scoreDelta;
            return a.source.localeCompare(b.source);
          })
          .forEach((entry, index) => {
            const rank = index + 1;
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
          });
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
        .filter(meetsConfidenceFilters)
        .map((edge, index) => ({ ...edge, rank: index + 1 }));
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

  const consensusRows = useMemo(() => {
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

    return Array.from(buckets.entries())
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
      .filter(
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
      )
      .sort((a, b) => b.confidence - a.confidence || b.score - a.score)
      .map((edge, index) => ({ ...edge, rank: index + 1 }));
  }, [
    activeAlgorithmIds,
    algorithmMetaMap,
    candidateRegulatorIds,
    evidenceThreshold,
    confidenceThreshold,
    consensusThreshold,
    directionConfidenceThreshold,
    signConfidenceThreshold,
    standardizedAlgorithmEdgeRows,
  ]);

  const activeEdges = useMemo(() => {
    if (activeAlgorithmIds.length >= 2) return consensusRows;
    if (activeAlgorithmIds.length === 1) return algorithmEdgeRows[activeAlgorithmIds[0]] ?? [];
    return [];
  }, [activeAlgorithmIds, algorithmEdgeRows, consensusRows]);

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
    const query = geneSearch.trim().toLowerCase();

    return activeEdges.filter((edge) => {
      const matchesSearch =
        !query ||
        edge.source.toLowerCase().includes(query) ||
        edge.target.toLowerCase().includes(query);

      const matchesIsolation =
        !isolatedGene || edge.source === isolatedGene || edge.target === isolatedGene;

      return matchesSearch && matchesIsolation;
    });
  }, [activeEdges, geneSearch, isolatedGene]);

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
      count: algorithmEdgeRows[algorithmId]?.length ?? 0,
    }));
  }, [activeAlgorithmIds, algorithmEdgeRows]);

  const maxAlgorithmEdgeCount = useMemo(() => {
    return Math.max(...perAlgorithmEdgeCounts.map((item) => item.count), 1);
  }, [perAlgorithmEdgeCounts]);

  const overlapEntries = useMemo<OverlapEntry[]>(() => {
    if (activeAlgorithmIds.length < 2) return [];

    const edgeMembership = new Map<string, string[]>();

    activeAlgorithmIds.forEach((algorithmId) => {
      (algorithmEdgeRows[algorithmId] ?? []).forEach((edge) => {
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
  }, [activeAlgorithmIds, algorithmEdgeRows]);

  const maxOverlapCount = useMemo(() => {
    return Math.max(...overlapEntries.map((entry) => entry.count), 1);
  }, [overlapEntries]);


  const resultsAvailabilityNotice = useMemo(() => {
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
  }, [activeAlgorithmIds.length, completedAlgorithmIds.length]);

  const visibleTableRows = useMemo(() => {
    if (!tableSearch.trim()) {
      return filteredNetworkEdges;
    }

    const query = tableSearch.trim().toLowerCase();

    return filteredNetworkEdges.filter(
      (edge) =>
        edge.source.toLowerCase().includes(query) ||
        edge.target.toLowerCase().includes(query)
    );
  }, [filteredNetworkEdges, tableSearch]);

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
      "Supporting Method Count",
      selectedView === "consensus" ? "Consensus Evidence" : "Edge Evidence",
      "Inferred Confidence",
      "Direction",
      "Direction Confidence",
      "Direction Coverage",
      "Sign",
      "Sign Confidence",
      "Sign Coverage",
      ...activeAlgorithmIds,
      "Supporting Algorithms",
    ];

    const lines = [
      headerColumns.join(","),
      ...sortedTableRows.map((edge) => {
        const row = [
          edge.rank,
          edge.source,
          edge.target,
          edge.count,
          edge.score.toFixed(3),
          edge.confidence.toFixed(3),
          edge.direction === 1 ? "source_to_target" : edge.direction === -1 ? "reverse" : "unknown",
          edge.directionConfidence === null ? "" : edge.directionConfidence.toFixed(3),
          edge.directionCoverage.toFixed(3),
          edge.sign === 1 ? "positive" : edge.sign === -1 ? "negative" : "unknown",
          edge.signConfidence === null ? "" : edge.signConfidence.toFixed(3),
          edge.signCoverage.toFixed(3),
          ...activeAlgorithmIds.map((algorithmId) =>
            edge.perAlgorithmScores[algorithmId] !== undefined
              ? edge.perAlgorithmScores[algorithmId].toFixed(3)
              : ""
          ),
          edge.supportingAlgorithms.join("; "),
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
    geneSearch,
  ]);

  useEffect(() => {
    setTablePage((current) => Math.min(current, totalTablePages));
  }, [totalTablePages]);



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
      <section className="relative overflow-x-clip overflow-y-visible bg-[#f4f6f8]">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/90 to-transparent" />
        <div className="absolute -left-24 top-28 h-72 w-72 rounded-full bg-cyan-100/60 blur-3xl" />
        <div className="absolute -right-24 top-20 h-72 w-72 rounded-full bg-teal-100/60 blur-3xl" />

        <div className="relative mx-auto max-w-[1180px] px-6 py-10 lg:px-10">
          <ProjectHeader
            projectName={project?.project_name?.trim() || (isDemoProject ? "Demo Project" : "Untitled project")}
          />

          <JobProgressBanner
            tasks={latestJob?.tasks ?? []}
            algorithmMetaMap={algorithmMetaMap}
          />

          <ResultsHubSection
            controls={
              <ResultsControlsSection
                  compact
                  projectId={projectId}
                  completedAlgorithmIds={completedAlgorithmIds}
                  selectedAlgorithmIds={selectedAlgorithmIds}
                  onChangeSelectedAlgorithmIds={(value) => {
                    setSelectedAlgorithmIds(value);
                    setSelectedGene(null);
                    setSelectedEdgeKey(null);
                    setIsolatedGene(null);
                  }}
                  evidenceThreshold={evidenceThreshold}
                  onChangeEvidenceThreshold={setEvidenceThreshold}
                  confidenceThreshold={confidenceThreshold}
                  onChangeConfidenceThreshold={setConfidenceThreshold}
                  directionConfidenceThreshold={directionConfidenceThreshold}
                  onChangeDirectionConfidenceThreshold={setDirectionConfidenceThreshold}
                  signConfidenceThreshold={signConfidenceThreshold}
                  onChangeSignConfidenceThreshold={setSignConfidenceThreshold}
                  consensusThreshold={consensusThreshold}
                  maxConsensusThreshold={Math.max(activeAlgorithmIds.length, 1)}
                  onChangeConsensusThreshold={(value) => {
                    setHasTouchedConsensusThreshold(true);
                    setConsensusThreshold(value);
                  }}
                  isConsensusView={activeAlgorithmIds.length >= 2}
                  isGuideOpen={isResultsGuideOpen}
                  onOpenGuide={() => setIsResultsGuideOpen(true)}
                />
            }
          >
                {activeAlgorithmIds.length >= 2 && (
                  <div className="w-full">
                    <ResultsSummarySection
                      perAlgorithmEdgeCounts={perAlgorithmEdgeCounts}
                      maxAlgorithmEdgeCount={maxAlgorithmEdgeCount}
                      completedAlgorithmIds={activeAlgorithmIds}
                      overlapEntries={overlapEntries}
                      maxOverlapCount={maxOverlapCount}
                    />
                  </div>
                )}

                {resultsAvailabilityNotice ? (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
                    <p className="text-lg font-bold text-slate-950">{resultsAvailabilityNotice.title}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {resultsAvailabilityNotice.description}
                    </p>
                  </div>
                ) : (
                  <>
                    <NetworkVisualizationSection
                      selectedView={activeAlgorithmIds.length >= 2 ? "consensus" : activeAlgorithmIds[0] ?? "consensus"}
                      networkLayout={networkLayout}
                      setNetworkLayout={setNetworkLayout}
                      onExportNetwork={handleExportNetwork}
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
                    />

                    <EdgeAnalysisTableSection
                      tableSearch={tableSearch}
                      setTableSearch={setTableSearch}
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
                  </>
                )}
          </ResultsHubSection>

          <AlgorithmCardsSection
            tasks={latestJob?.tasks ?? []}
            algorithmMetaMap={algorithmMetaMap}
            onOpenAlgorithmError={setActiveAlgorithmErrorTask}
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
          />

          <ResultsGuideModal
            open={isResultsGuideOpen}
            onClose={() => setIsResultsGuideOpen(false)}
          />
          <DatasetHelpModal
            open={isDatasetHelpOpen}
            onClose={() => setIsDatasetHelpOpen(false)}
          />
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
          <ConfirmDownloadModal
            pendingDownload={pendingDownload}
            isClosing={isDownloadModalClosing}
            onClose={closeDownloadModal}
          />

          <AlgorithmErrorModal
            task={activeAlgorithmErrorTask}
            onClose={() => setActiveAlgorithmErrorTask(null)}
          />
        </div>
      </section>
    </main>
  );
}
