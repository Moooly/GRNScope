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
import { algorithms } from "../_data/algorithms";
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
const POLL_INTERVAL_MS = 1000;

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Array.isArray(params?.projectId) ? params.projectId[0] : params?.projectId;

  const [project, setProject] = useState<ProjectManifest | null>(null);
  const [metadata, setMetadata] = useState<MetadataManifest | null>(null);
  const [latestJob, setLatestJob] = useState<ProjectJob | null>(null);
  const [algorithmResults, setAlgorithmResults] = useState<Record<string, AlgorithmStoredResult>>({});
  const [selectedAlgorithmIds, setSelectedAlgorithmIds] = useState<string[]>([]);
  const [topN, setTopN] = useState(1);
  const [hasTouchedTopN, setHasTouchedTopN] = useState(false);
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
  const [groundTruthEdges, setGroundTruthEdges] = useState<Set<string>>(new Set());
  const [groundTruthFilename, setGroundTruthFilename] = useState<string>("");
  const [groundTruthError, setGroundTruthError] = useState("");
  const [activeAlgorithmErrorTask, setActiveAlgorithmErrorTask] = useState<{ algorithmId: string; errorMessage: string } | null>(null);

  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const networkGraphRef = useRef<Core | null>(null);

  const allJobTasks = useMemo(() => latestJob?.tasks ?? [], [latestJob]);

  const completedTasks = useMemo(
    () => allJobTasks.filter((task) => task.status === "Completed"),
    [allJobTasks]
  );

  const completedAlgorithmIds = useMemo(
    () => completedTasks.map((task) => task.algorithm_id),
    [completedTasks]
  );

  useEffect(() => {
    setSelectedAlgorithmIds(completedAlgorithmIds);
  }, [completedAlgorithmIds]);

  const activeAlgorithmIds = useMemo(() => {
    return selectedAlgorithmIds.filter((id) => completedAlgorithmIds.includes(id));
  }, [completedAlgorithmIds, selectedAlgorithmIds]);

  const algorithmMetaMap = useMemo(
    () => new Map((algorithms as AlgorithmCatalogItem[]).map((item) => [item.id, item])),
    []
  );

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

      const edges = uniqueEdges.slice(0, topN);

      next[algorithmId] = edges
        .map((edge, index) => {
          const normalizedScore = clamp(Number(edge.normalized_score ?? 1), 0, 1);

          return {
            key: `${algorithmId}-${edge.source}-${edge.target}-${index}`,
            source: edge.source,
            target: edge.target,
            score: edge.score,
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
  }, [algorithmResults, completedAlgorithmIds, confidenceThreshold, topN]);

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

  const maxAvailableTopN = useMemo(() => {
    if (activeAlgorithmIds.length >= 2) {
      const counts = activeAlgorithmIds.map(
        (algorithmId) => algorithmResults[algorithmId]?.top_edges?.length ?? 0
      );

      return Math.max(...counts, 1);
    }

    if (activeAlgorithmIds.length === 1) {
      return Math.max(algorithmResults[activeAlgorithmIds[0]]?.top_edges?.length ?? 0, 1);
    }

    return 1;
  }, [activeAlgorithmIds, algorithmResults]);

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

  const confirmDownload = () => {
    if (!pendingDownload) return;

    const link = document.createElement("a");
    link.href = pendingDownload.href;
    link.download = pendingDownload.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    closeDownloadModal();
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
      if (!hasTouchedConsensusThreshold) {
        return defaultConsensusValue;
      }

      return clamp(current, 1, maxConsensusValue);
    });
  }, [activeAlgorithmIds, hasTouchedConsensusThreshold]);

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
    const defaultTopN = Math.max(1, Math.floor(maxAvailableTopN / 2));
    setTopN((current) => (hasTouchedTopN ? clamp(current, 1, maxAvailableTopN) : defaultTopN));
  }, [hasTouchedTopN, maxAvailableTopN]);

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
    topN,
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

          payloads.forEach((result) => {
            if (result?.algorithm_id) next[result.algorithm_id] = result;
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

          payloads.forEach((result) => {
            if (result?.algorithm_id) next[result.algorithm_id] = result;
          });

          setAlgorithmResults(next);
        }
      } catch {
        return;
      }
    };

    const interval = window.setInterval(() => {
      if (hasActiveTasks) {
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
            projectName={project?.project_name?.trim() || "Untitled project"}
            projectDescription={project?.project_description?.trim() || "No description"}
          />

          <div className="group mt-8 rounded-[1.5rem] border border-slate-200 bg-white/95 p-6 text-slate-900 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Algorithms used</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Scroll horizontally to view all selected algorithms. The status marker in the top-right corner updates for each algorithm independently.
                </p>
              </div>
            </div>

            <div className="relative mt-5 overflow-hidden">
              <div className="overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex min-w-max gap-4 pr-32">
                  {(latestJob?.tasks ?? []).map((task) => {
                    const meta = algorithmMetaMap.get(task.algorithm_id);
                    const progressPercent = Math.max(
                      0,
                      Math.min(100, Number(task.progress_percent ?? 0))
                    );
                    const progressLabel =
                      typeof task.progress_label === "string" && task.progress_label.trim().length > 0
                        ? task.progress_label
                        : task.status;

                    return (
                      <div
                        key={task.algorithm_id}
                        className="flex w-[22rem] shrink-0 flex-col rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-3">
                              <p className="truncate text-2xl font-bold tracking-tight text-slate-950">
                                {meta?.name ?? task.algorithm_id}
                              </p>
                            </div>
                            <p className="mt-2 line-clamp-2 min-h-[3rem] text-sm leading-6 text-slate-600">
                              {meta?.description ?? "Selected GRN inference algorithm."}
                            </p>
                          </div>

                          {task.status === "Completed" ? (
                            <span className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full border border-[#20b779]/20 bg-[#e8f7f1] px-2 text-base font-bold text-[#178a62]">
                              ✓
                            </span>
                          ) : task.status === "Failed" ? (
                            <button
                              type="button"
                              onClick={() =>
                                setActiveAlgorithmErrorTask({
                                  algorithmId: task.algorithm_id,
                                  errorMessage:
                                    task.error_message?.replace(/\/Users\/[^ ]+/g, "server log file") ||
                                    "This algorithm failed. The server did not return a detailed message.",
                                })
                              }
                              className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-2 text-base font-bold text-rose-600 transition hover:border-rose-300 hover:bg-rose-100"
                              aria-label={`View error for ${task.algorithm_id}`}
                              title="View error"
                            >
                              !
                            </button>
                          ) : task.status === "Running" ? (
                            <span
                              className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center"
                              aria-label={`${progressPercent}% complete for ${task.algorithm_id}`}
                              title={`${progressPercent}% • ${progressLabel}`}
                              style={{
                                background: `conic-gradient(#1b75a6 ${progressPercent * 3.6}deg, rgba(27,117,166,0.14) 0deg)`,
                                borderRadius: "9999px",
                              }}
                            >
                              <span className="absolute inset-[2px] rounded-full bg-white" />
                              <span className="relative text-[10px] font-bold text-[#1b75a6]">
                                {progressPercent}%
                              </span>
                            </span>
                          ) : task.status === "Queued" ? (
                            <span
                              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-amber-200 bg-amber-50"
                              aria-label={`Queued ${task.algorithm_id}`}
                              title="Queued"
                            >
                              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5">
                          <p className="text-[0.64rem] font-bold uppercase tracking-[0.16em] text-slate-400">
                            Methodology
                          </p>
                          <p className="mt-1 text-sm font-bold leading-5 text-[#1b75a6]">
                            {meta?.category ?? "Algorithm"}
                          </p>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">
                            {meta?.requiresPseudotime ? "Pseudotime" : "No time"}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">
                            {meta?.directed ? "Directed" : "Undirected"}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">
                            {meta?.signed ? "Signed" : "Unsigned"}
                          </span>
                          {(task.status === "Running" || task.status === "Queued") && (
                            <span
                              className={`rounded-full px-2.5 py-1 font-medium ${
                                task.status === "Running"
                                  ? "border border-sky-200 bg-sky-50 text-sky-700"
                                  : "border border-amber-200 bg-amber-50 text-amber-700"
                              }`}
                            >
                              {progressLabel}
                            </span>
                          )}
                        </div>

                        {task.status === "Completed" && (
                          <button
                            type="button"
                            onClick={() => {
                              if (!projectId) return;
                              openDownloadModal(
                                `${task.algorithm_id} raw result`,
                                `${API_BASE}/projects/${projectId}/download/result/${task.algorithm_id}`,
                                `${task.algorithm_id}-raw-ranked-edges.csv`
                              );
                            }}
                            className="mt-4 w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                          >
                            Download raw result
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {(latestJob?.tasks.length ?? 0) > 4 && (
                <div className="pointer-events-none absolute inset-y-0 right-0 hidden group-hover:flex items-center">
                  <div className="flex h-full w-16 items-center justify-center bg-gradient-to-l from-white via-white/80 to-transparent text-5xl text-slate-400">
                    ›
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white/95 p-6 text-slate-900 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-slate-950">Dataset and preprocessing</h2>
              <button
                type="button"
                onClick={() => {
                  if (!projectId) return;

                  const selectedView =
                    activeAlgorithmIds.length >= 2
                      ? "consensus"
                      : activeAlgorithmIds[0] ?? "consensus";

                  const query = new URLSearchParams({
                    selected_view: selectedView,
                    top_n: String(topN),
                    confidence_threshold: String(confidenceThreshold),
                    consensus_threshold: String(consensusThreshold),
                    selected_algorithms: activeAlgorithmIds.join(","),
                  });

                  openDownloadModal(
                    "Analysis metadata",
                    `${API_BASE}/projects/${projectId}/download/metadata?${query.toString()}`,
                    `${projectId ?? "project"}-analysis-metadata.json`
                  );
                }}
                className={`rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] ${
                  projectId ? "" : "pointer-events-none opacity-60"
                }`}
              >
                Export metadata
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                  Expression matrix
                </p>
                <p className="mt-3 text-base font-bold text-slate-950">
                  {metadata?.gene_count && metadata?.cell_count
                    ? `${metadata.gene_count.toLocaleString()} genes × ${metadata.cell_count.toLocaleString()} cells`
                    : "Pending"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!projectId || !metadata?.has_pseudotime) return;

                  openDownloadModal(
                    "Pseudotime file",
                    `${API_BASE}/projects/${projectId}/download/pseudotime`,
                    metadata?.pseudotime_filename || project?.pseudotime_filename || "pseudotime.csv"
                  );
                }}
                className={`group relative overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5 text-left transition hover:border-[#1b75a6]/25 hover:bg-white ${
                  projectId && metadata?.has_pseudotime
                    ? "cursor-pointer"
                    : "pointer-events-none opacity-60"
                }`}
              >
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                  Pseudotime file
                </p>
                <p className="mt-3 line-clamp-2 text-base font-bold text-slate-950">
                  {metadata?.pseudotime_filename || project?.pseudotime_filename || "Not provided"}
                </p>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/85 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] px-4 py-2 text-sm font-bold text-[#1b75a6]">
                    Download pseudotime
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!projectId) return;

                  openDownloadModal(
                    "Dataset file",
                    `${API_BASE}/projects/${projectId}/download/expression`,
                    metadata?.expression_filename || project?.expression_filename || "dataset.csv"
                  );
                }}
                className={`group relative overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5 text-left transition hover:border-[#1b75a6]/25 hover:bg-white ${
                  projectId ? "cursor-pointer" : "pointer-events-none opacity-60"
                }`}
              >
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                  Dataset file
                </p>
                <p className="mt-3 line-clamp-2 text-base font-bold text-slate-950">
                  {metadata?.expression_filename || project?.expression_filename || "Not available"}
                </p>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/85 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] px-4 py-2 text-sm font-bold text-[#1b75a6]">
                    Download dataset
                  </span>
                </div>
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-4">
              <span className="inline-flex rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] px-5 py-3 text-sm font-bold text-[#1b75a6]">
                Top variable genes retained: {metadata?.preprocessing?.top_variable_genes || "-"}
              </span>
              <span className="inline-flex rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] px-5 py-3 text-sm font-bold text-[#1b75a6]">
                Transcription factor override: {boolText(metadata?.preprocessing?.include_all_tfs).toLowerCase()}
              </span>
              <span className="inline-flex rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] px-5 py-3 text-sm font-bold text-[#1b75a6]">
                Library-size normalization: {boolText(metadata?.preprocessing?.normalize_enabled).toLowerCase()}
              </span>
              <span className="inline-flex rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] px-5 py-3 text-sm font-bold text-[#1b75a6]">
                log₂(x + 1) transformation: {boolText(metadata?.preprocessing?.log_transform_enabled).toLowerCase()}
              </span>
            </div>
          </div>

          <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white/95 p-6 text-slate-900 shadow-sm">
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Results hub</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Use the compact toolbar below to update the overlap plot, network visualization, and edge table together.
                </p>
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
                  topN={topN}
                  maxAvailableTopN={maxAvailableTopN}
                  onChangeTopN={(value) => {
                    setHasTouchedTopN(true);
                    setTopN(value);
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

          {pendingDownload && (
            <div
              className={`fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 px-6 py-10 backdrop-blur-sm ${
                isDownloadModalClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
              }`}
            >
              <div
                className={`w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 ${
                  isDownloadModalClosing ? "animate-modal-panel-out" : "animate-modal-panel"
                }`}
              >
                <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
                  Download file
                </p>
                <h3 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
                  Download {pendingDownload.label}?
                </h3>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  This will download the saved file from the project record in the backend.
                </p>
                <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="break-words text-sm font-bold text-slate-950">{pendingDownload.filename}</p>
                </div>
                <div className="mt-6 flex justify-end gap-3 border-t border-[#213f54]/15 pt-5">
                  <button
                    type="button"
                    onClick={closeDownloadModal}
                    className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDownload}
                    className="rounded-full bg-[#1b75a6] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#155f87]"
                  >
                    Download
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeAlgorithmErrorTask && (
            <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/80 px-6 py-10 backdrop-blur-md">
              <div className="w-full max-w-2xl rounded-[2rem] border border-white/10 bg-slate-900/95 p-6 shadow-2xl shadow-slate-950/40">
                <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-rose-200/80">
                      Algorithm error
                    </p>
                    <h3 className="mt-3 break-words text-2xl font-semibold text-white">
                      {activeAlgorithmErrorTask.algorithmId}
                    </h3>
                    <p className="mt-2 text-sm text-slate-400">
                      This algorithm did not finish successfully. Review the message below for details.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveAlgorithmErrorTask(null)}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 text-lg text-slate-300 transition hover:border-white/20 hover:bg-white/[0.04] hover:text-white"
                    aria-label="Close error dialog"
                  >
                    ×
                  </button>
                </div>

                <div className="mt-6 rounded-[1.5rem] border border-rose-300/15 bg-rose-300/[0.08] p-5">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-rose-300/20 bg-rose-300/10 px-2 text-sm font-semibold text-rose-200">
                      !
                    </span>
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-rose-100/80">
                      Error message
                    </p>
                  </div>

                  <div className="mt-4 max-h-[40vh] overflow-y-auto rounded-[1.25rem] border border-white/10 bg-slate-950/50 p-4">
                    <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-100">
                      {activeAlgorithmErrorTask.errorMessage}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setActiveAlgorithmErrorTask(null)}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.07]"
                  >
                    Close
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