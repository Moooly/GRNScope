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
import AlgorithmHelpModal from "./_components/AlgorithmHelpModal";
import ConfirmDownloadModal from "./_components/ConfirmDownloadModal";
import DatasetHelpModal from "./_components/DatasetHelpModal";
import FileDownloadMenuModal from "./_components/FileDownloadMenuModal";
import ResultsGuideModal from "./_components/ResultsGuideModal";
import AlgorithmCardsSection from "./_components/AlgorithmCardsSection";
import DatasetPreprocessingSection from "./_components/DatasetPreprocessingSection";

import {
  type AggregatedEdge,
  type AlgorithmCatalogItem,
  type AlgorithmStoredResult,
  type BenchmarkMetrics,
  type MetadataManifest,
  type NodeInfo,
  type OverlapEntry,
  type ProjectJob,
  type ProjectManifest,
} from "./_lib/types";
import { boolText, clamp } from "./_lib/utils";
import { computeBenchmarkMetrics, parseGroundTruthCsv } from "./_lib/benchmark";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";
const API_ROOT = API_BASE.replace(/\/api\/?$/, "");

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
// Spec §7.6: refresh job status every five seconds while any task is in a
// non-terminal state.
const POLL_INTERVAL_MS = 5000;

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const routeProjectId = Array.isArray(params?.projectId) ? params.projectId[0] : params?.projectId;
  const projectId = routeProjectId === "sample" ? "demo" : routeProjectId;

  const [project, setProject] = useState<ProjectManifest | null>(null);
  const [metadata, setMetadata] = useState<MetadataManifest | null>(null);
  const [latestJob, setLatestJob] = useState<ProjectJob | null>(null);
  const [algorithmResults, setAlgorithmResults] = useState<Record<string, AlgorithmStoredResult>>({});
  const [algorithmCatalog, setAlgorithmCatalog] = useState<AlgorithmCatalogItem[]>([]);
  const [selectedAlgorithmIds, setSelectedAlgorithmIds] = useState<string[]>([]);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.8);
  const [consensusThreshold, setConsensusThreshold] = useState(1);
  const [hasTouchedConsensusThreshold, setHasTouchedConsensusThreshold] = useState(false);
  const [geneSearch, setGeneSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [networkLayout, setNetworkLayout] = useState<"force" | "hierarchical" | "concentric" | "circular">("force");
  const [selectedGene, setSelectedGene] = useState<string | null>(null);
  const [isolatedGene, setIsolatedGene] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [visibleAlgorithmColumns, setVisibleAlgorithmColumns] = useState<string[]>([]);
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const [tableSortKey, setTableSortKey] = useState<"rank" | "source" | "target" | "score" | "count">("rank");
  const [tableSortDirection, setTableSortDirection] = useState<"asc" | "desc">("asc");
  const [error, setError] = useState("");
  const [pendingDownload, setPendingDownload] = useState<{ label: string; href: string; filename: string } | null>(null);
  const [isDownloadModalClosing, setIsDownloadModalClosing] = useState(false);
  const [isFileDownloadMenuOpen, setIsFileDownloadMenuOpen] = useState(false);
  const [isAlgorithmHelpOpen, setIsAlgorithmHelpOpen] = useState(false);
  const [isDatasetHelpOpen, setIsDatasetHelpOpen] = useState(false);
  const [isResultsGuideOpen, setIsResultsGuideOpen] = useState(false);
  const [groundTruthEdges, setGroundTruthEdges] = useState<Set<string>>(new Set());
  const [groundTruthFilename, setGroundTruthFilename] = useState<string>("");
  const [groundTruthError, setGroundTruthError] = useState("");
  const [activeAlgorithmErrorTask, setActiveAlgorithmErrorTask] = useState<{ algorithmId: string; errorMessage: string } | null>(null);

  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const networkGraphRef = useRef<Core | null>(null);
  const hasAppliedDemoDefaultsRef = useRef(false);

  const demoProjectFlag = project as (ProjectManifest & { is_demo?: boolean; read_only?: boolean }) | null;
  const demoMetadataFlag = metadata as (MetadataManifest & { is_demo?: boolean; read_only?: boolean }) | null;
  const isDemoProject = projectId === "demo" || routeProjectId === "sample" || demoProjectFlag?.is_demo === true || demoMetadataFlag?.is_demo === true;
  const isReadOnlyProject = isDemoProject || demoProjectFlag?.read_only === true || demoMetadataFlag?.read_only === true;

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

    setConfidenceThreshold(0.85);
    setConsensusThreshold(7);
    setHasTouchedConsensusThreshold(true);
    hasAppliedDemoDefaultsRef.current = true;
  }, [isDemoProject, activeAlgorithmIds.length]);

  const algorithmMetaMap = useMemo(
    () => new Map(algorithmCatalog.map((item) => [item.id, item])),
    [algorithmCatalog]
  );

  useEffect(() => {
    let cancelled = false;

    const loadAlgorithmCatalog = async () => {
      try {
        const response = await fetch(`${API_ROOT}/algorithms`, {
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as BackendAlgorithmEntry[];

        if (!cancelled) {
          setAlgorithmCatalog(
            data
              .filter((algorithm) => algorithm.active)
              .map(mapBackendAlgorithm)
          );
        }
      } catch {
        if (!cancelled) {
          setAlgorithmCatalog([]);
        }
      }
    };

    loadAlgorithmCatalog();

    return () => {
      cancelled = true;
    };
  }, []);

  const hasActiveTasks = useMemo(() => {
    return allJobTasks.some(
      (task) => task.status === "Queued" || task.status === "Running"
    );
  }, [allJobTasks]);

  const algorithmEdgeRows = useMemo(() => {
    const next: Record<string, AggregatedEdge[]> = {};

    completedAlgorithmIds.forEach((algorithmId) => {
      const rawEdges = algorithmResults[algorithmId]?.top_edges ?? [];
      const uniqueEdges: typeof rawEdges = [];
      const seenEdgeKeys = new Set<string>();

      rawEdges.forEach((edge) => {
        const edgeKey = `${edge.source}|||${edge.target}`;
        if (seenEdgeKeys.has(edgeKey)) return;
        seenEdgeKeys.add(edgeKey);
        uniqueEdges.push(edge);
      });

      next[algorithmId] = uniqueEdges
        .map((edge, index) => {
          const rawNormalized = edge.normalized_score;
          const hasNormalized =
            rawNormalized !== undefined &&
            rawNormalized !== null &&
            Number.isFinite(Number(rawNormalized));
          const rawScore = Number(edge.score ?? edge.weight ?? edge.edge_weight ?? 0);
          const hasRawScore = Number.isFinite(rawScore);
          const normalizedScore = hasNormalized
            ? clamp(Number(rawNormalized), 0, 1)
            : hasRawScore
              ? clamp(Math.abs(rawScore), 0, 1)
              : 0;

          return {
            key: `${algorithmId}-${edge.source}-${edge.target}-${index}`,
            source: edge.source,
            target: edge.target,
            score: hasRawScore ? rawScore : 0,
            count: 1,
            rank: index + 1,
            supportingAlgorithms: [algorithmId],
            perAlgorithmScores: {
              [algorithmId]: normalizedScore,
            },
          };
        })
        .filter((edge) => edge.perAlgorithmScores[algorithmId] >= confidenceThreshold);
    });

    return next;
  }, [algorithmResults, completedAlgorithmIds, confidenceThreshold]);

  const consensusRows = useMemo(() => {
    const bucket = new Map<string, AggregatedEdge>();

    activeAlgorithmIds.forEach((algorithmId) => {
      (algorithmEdgeRows[algorithmId] ?? []).forEach((edge) => {
        const key = `${edge.source}|||${edge.target}`;
        const current = bucket.get(key);
        const normalized = edge.perAlgorithmScores[algorithmId] ?? edge.score;

        if (!current) {
          bucket.set(key, {
            key,
            source: edge.source,
            target: edge.target,
            score: normalized,
            count: 1,
            rank: 0,
            supportingAlgorithms: [algorithmId],
            perAlgorithmScores: { [algorithmId]: normalized },
          });
          return;
        }

        current.score += normalized;
        current.count += 1;
        current.supportingAlgorithms.push(algorithmId);
        current.perAlgorithmScores[algorithmId] = normalized;
      });
    });

    return Array.from(bucket.values())
      .map((edge) => ({
        ...edge,
        score: edge.score / edge.count,
        supportingAlgorithms: [...edge.supportingAlgorithms].sort(),
      }))
      .filter((edge) => edge.count >= consensusThreshold)
      .sort((a, b) => b.score - a.score)
      .map((edge, index) => ({ ...edge, rank: index + 1 }));
  }, [activeAlgorithmIds, algorithmEdgeRows, consensusThreshold]);

  const activeEdges = useMemo(() => {
    if (activeAlgorithmIds.length >= 2) return consensusRows;
    if (activeAlgorithmIds.length === 1) return algorithmEdgeRows[activeAlgorithmIds[0]] ?? [];
    return [];
  }, [activeAlgorithmIds, algorithmEdgeRows, consensusRows]);

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

  const networkNodes = useMemo(() => {
    const nodes = new Map<string, NodeInfo>();

    activeEdges.forEach((edge) => {
      if (!nodes.has(edge.source)) {
        nodes.set(edge.source, {
          id: edge.source,
          inDegree: 0,
          outDegree: 0,
          degree: 0,
          isTF: stableTFGeneIds.has(edge.source.toUpperCase()),
          topRegulators: [],
          topTargets: [],
        });
      }

      if (!nodes.has(edge.target)) {
        nodes.set(edge.target, {
          id: edge.target,
          inDegree: 0,
          outDegree: 0,
          degree: 0,
          isTF: stableTFGeneIds.has(edge.target.toUpperCase()),
          topRegulators: [],
          topTargets: [],
        });
      }

      const source = nodes.get(edge.source)!;
      const target = nodes.get(edge.target)!;

      source.isTF = stableTFGeneIds.has(edge.source.toUpperCase());
      target.isTF = stableTFGeneIds.has(edge.target.toUpperCase());

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
  }, [activeEdges, filteredNetworkEdges, stableTFGeneIds]);

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

  const benchmarkMetrics = useMemo<BenchmarkMetrics[]>(() => {
    if (groundTruthEdges.size === 0) return [];

    const universe = new Set<string>();

    completedAlgorithmIds.forEach((algorithmId) => {
      (algorithmEdgeRows[algorithmId] ?? []).forEach((edge) => {
        universe.add(`${edge.source}|||${edge.target}`);
      });
    });

    consensusRows.forEach((edge) => {
      universe.add(`${edge.source}|||${edge.target}`);
    });

    groundTruthEdges.forEach((edgeKey) => universe.add(edgeKey));

    const baselineUniverseSize = universe.size;

    const methodRows: BenchmarkMetrics[] = completedAlgorithmIds.map((algorithmId) =>
      computeBenchmarkMetrics(
        algorithmId,
        algorithmEdgeRows[algorithmId] ?? [],
        groundTruthEdges,
        baselineUniverseSize
      )
    );

    return [
      computeBenchmarkMetrics("Consensus", consensusRows, groundTruthEdges, baselineUniverseSize),
      ...methodRows,
    ];
  }, [algorithmEdgeRows, completedAlgorithmIds, consensusRows, groundTruthEdges]);

  const resultsAvailabilityNotice = useMemo(() => {
    if (completedAlgorithmIds.length === 0) {
      return {
        title: "No completed algorithm results yet",
        description:
          "The network visualization and edge analysis table will appear after at least one algorithm finishes successfully.",
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
    const escapeCsvValue = (value: string | number) => {
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
      "Consensus Count",
      selectedView === "consensus" ? "Consensus Score" : "Score",
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
    confidenceThreshold,
    consensusThreshold,
    isolatedGene,
    geneSearch,
  ]);

  useEffect(() => {
    setTablePage((current) => Math.min(current, totalTablePages));
  }, [totalTablePages]);

  const handleGroundTruthUpload = async (file: File | null) => {
    if (!file) return;

    try {
      const text = await file.text();
      const parsedEdges = parseGroundTruthCsv(text);

      if (parsedEdges.size === 0) {
        setGroundTruthError("Ground-truth file could not be parsed. Use a CSV with Source and Target columns.");
        setGroundTruthEdges(new Set());
        setGroundTruthFilename("");
        return;
      }

      setGroundTruthEdges(parsedEdges);
      setGroundTruthFilename(file.name);
      setGroundTruthError("");
    } catch {
      setGroundTruthError("Ground-truth file could not be read.");
      setGroundTruthEdges(new Set());
      setGroundTruthFilename("");
    }
  };

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const load = async () => {
      setError("");

      try {
        const projectResponse = await fetch(`${API_BASE}/projects/${projectId}`);

        if (!projectResponse.ok) {
          if (!cancelled) {
            setProject(null);
            setLatestJob(null);

            if (isDemoProject) {
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
        const metadataResponse = await fetch(`${API_BASE}/projects/${projectId}/metadata`);

        if (!cancelled && metadataResponse.ok) {
          const metadataData = await metadataResponse.json();
          setMetadata((metadataData.metadata ?? null) as MetadataManifest | null);
        }
      } catch {
        if (!cancelled) setMetadata(null);
      }

      try {
        const resultsResponse = await fetch(`${API_BASE}/projects/${projectId}/results`);

        if (!resultsResponse.ok || cancelled) return;

        const resultsData = await resultsResponse.json();
        const resultRows = Array.isArray(resultsData.results) ? resultsData.results : [];
        const completedRows = resultRows.filter(
          (item: { algorithm_id?: string; status?: string }) =>
            item.algorithm_id && item.status === "Completed"
        );

        const payloads = await Promise.all(
          completedRows.map(async (item: { algorithm_id: string }) => {
            try {
              const response = await fetch(
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

        if (!cancelled) {
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

          setAlgorithmResults(next);
        }
      } catch {
        if (!cancelled) setAlgorithmResults({});
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const [projectResponse, resultsResponse] = await Promise.all([
          fetch(`${API_BASE}/projects/${projectId}`),
          fetch(`${API_BASE}/projects/${projectId}/results`).catch(() => null),
        ]);

        if (projectResponse.ok) {
          const projectData = await projectResponse.json();

          if (!cancelled) {
            setProject((projectData.project ?? null) as ProjectManifest | null);
            setLatestJob((projectData.latest_job ?? null) as ProjectJob | null);
          }
        }

        if (!resultsResponse || !resultsResponse.ok || cancelled) return;

        const resultsData = await resultsResponse.json();
        const resultRows = Array.isArray(resultsData.results) ? resultsData.results : [];
        const completedRows = resultRows.filter(
          (item: { algorithm_id?: string; status?: string }) =>
            item.algorithm_id && item.status === "Completed"
        );

        const payloads = await Promise.all(
          completedRows.map(async (item: { algorithm_id: string }) => {
            try {
              const response = await fetch(
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

        if (!cancelled) {
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

          setAlgorithmResults(next);
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
      window.clearInterval(interval);
    };
  }, [projectId, hasActiveTasks]);

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
            projectDescription={
              project?.project_description?.trim() ||
              (isDemoProject
                ? "Explore a precomputed example gene regulatory network built from BEELINE-compatible sample data."
                : "No description")
            }
          />


          <AlgorithmCardsSection
            tasks={latestJob?.tasks ?? []}
            algorithmMetaMap={algorithmMetaMap}
            projectId={projectId}
            apiBase={API_BASE}
            onOpenHelp={() => setIsAlgorithmHelpOpen(true)}
            onOpenDownload={openDownloadModal}
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

          <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white/95 p-6 text-slate-900 shadow-sm">
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Results hub</h2>
              </div>

              <div
                className="sticky z-[55]"
                style={{ top: "var(--grnscope-header-height, 78px)" }}
              >
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
                  confidenceThreshold={confidenceThreshold}
                  onChangeConfidenceThreshold={setConfidenceThreshold}
                  consensusThreshold={consensusThreshold}
                  maxConsensusThreshold={Math.max(activeAlgorithmIds.length, 1)}
                  onChangeConsensusThreshold={(value) => {
                    setHasTouchedConsensusThreshold(true);
                    setConsensusThreshold(value);
                  }}
                  isConsensusView={activeAlgorithmIds.length >= 2}
                  onOpenGuide={() => setIsResultsGuideOpen(true)}
                />
              </div>

              <div className="min-w-0 space-y-6">
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
              </div>
            </div>
          </div>

          <AlgorithmHelpModal
            open={isAlgorithmHelpOpen}
            onClose={() => setIsAlgorithmHelpOpen(false)}
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
            confidenceThreshold={confidenceThreshold}
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