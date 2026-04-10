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

const API_BASE_URL = "http://127.0.0.1:8000";
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
  const [consensusThreshold, setConsensusThreshold] = useState(1);
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
    if (completedAlgorithmIds.length === 0) {
      setSelectedAlgorithmIds([]);
      return;
    }

    setSelectedAlgorithmIds((prev) => {
      const filtered = prev.filter((id) => completedAlgorithmIds.includes(id));
      if (filtered.length > 0) return filtered;
      return completedAlgorithmIds;
    });
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
      const scores = edges.map((edge) => edge.score);
      const minScore = scores.length > 0 ? Math.min(...scores) : 0;
      const maxScore = scores.length > 0 ? Math.max(...scores) : 1;
      const scoreRange = maxScore - minScore;

      next[algorithmId] = edges.map((edge, index) => ({
        key: `${algorithmId}-${edge.source}-${edge.target}-${index}`,
        source: edge.source,
        target: edge.target,
        score: edge.score,
        count: 1,
        rank: index + 1,
        supportingAlgorithms: [algorithmId],
        perAlgorithmScores: {
          [algorithmId]: scoreRange === 0 ? 1 : (edge.score - minScore) / scoreRange,
        },
      }));
    });

    return next;
  }, [algorithmResults, completedAlgorithmIds, topN]);

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

  const networkNodes = useMemo(() => {
    const nodes = new Map<string, NodeInfo>();

    activeEdges.forEach((edge) => {
      if (!nodes.has(edge.source)) {
        nodes.set(edge.source, {
          id: edge.source,
          inDegree: 0,
          outDegree: 0,
          degree: 0,
          isTF: true,
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
          isTF: false,
          topRegulators: [],
          topTargets: [],
        });
      }
      const source = nodes.get(edge.source)!;
      const target = nodes.get(edge.target)!;
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
  }, [activeEdges, filteredNetworkEdges]);

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

    const selectedView = activeAlgorithmIds.length >= 2 ? "consensus" : activeAlgorithmIds[0] ?? "consensus";

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
    setConsensusThreshold((current) => clamp(current, 1, Math.max(activeAlgorithmIds.length, 1)));
  }, [activeAlgorithmIds]);

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
    setTopN((current) => (hasTouchedTopN ? clamp(current, 1, maxAvailableTopN) : maxAvailableTopN));
  }, [hasTouchedTopN, maxAvailableTopN]);

  useEffect(() => {
    if (!selectedGene) return;
    if (!networkNodes.some((node) => node.id === selectedGene)) {
      setSelectedGene(null);
    }
  }, [networkNodes, selectedGene]);

  useEffect(() => {
    setTablePage(1);
  }, [tableSearch, tableSortDirection, tableSortKey, selectedAlgorithmIds, consensusThreshold, topN, isolatedGene, geneSearch]);

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
      try {
        setError("");
        const [projectResponse, metadataResponse, resultsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/projects/${projectId}`),
          fetch(`${API_BASE_URL}/api/projects/${projectId}/metadata`).catch(() => null),
          fetch(`${API_BASE_URL}/api/projects/${projectId}/results`).catch(() => null),
        ]);

        if (!projectResponse.ok) {
          if (!cancelled) setError("Project detail could not be loaded.");
          return;
        }

        const projectData = await projectResponse.json();
        if (cancelled) return;

        setProject((projectData.project ?? null) as ProjectManifest | null);
        setLatestJob((projectData.latest_job ?? null) as ProjectJob | null);

        if (metadataResponse && metadataResponse.ok) {
          const metadataData = await metadataResponse.json();
          if (!cancelled) {
            setMetadata((metadataData.metadata ?? null) as MetadataManifest | null);
          }
        }

        if (resultsResponse && resultsResponse.ok) {
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
                  `${API_BASE_URL}/api/projects/${projectId}/results/${item.algorithm_id}`
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
        }
      } catch {
        if (!cancelled) setError("Could not connect to the backend.");
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !hasActiveTasks) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const [projectResponse, resultsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/projects/${projectId}`),
          fetch(`${API_BASE_URL}/api/projects/${projectId}/results`),
        ]);

        if (!projectResponse.ok) return;
        const projectData = await projectResponse.json();
        if (cancelled) return;
        setLatestJob((projectData.latest_job ?? null) as ProjectJob | null);

        if (resultsResponse.ok) {
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
                  `${API_BASE_URL}/api/projects/${projectId}/results/${item.algorithm_id}`
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
        }
      } catch {
        return;
      }
    };

    poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [projectId, hasActiveTasks]);

  if (error) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <section className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
          <Link
            href="/projects"
            className="inline-flex rounded-2xl border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/5"
          >
            Back to projects
          </Link>
          <div className="mt-8 rounded-[2rem] border border-rose-300/20 bg-rose-300/10 p-6 text-rose-100">
            {error}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
        <ProjectHeader
          projectName={project?.project_name ?? "Project detail"}
          projectDescription={project?.project_description || "No project description provided."}
        />

        <div className="group mt-8 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">Algorithms used</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
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
                      className="w-[19rem] shrink-0 rounded-[2rem] border border-white/10 bg-white/[0.03] p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-2xl font-semibold text-white">{task.algorithm_id}</p>
                        </div>

                        {task.status === "Completed" ? (
                          <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 text-sm font-semibold text-emerald-200">
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
                            className="inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-rose-300/20 bg-rose-300/10 px-2 text-sm font-semibold text-rose-200 transition hover:border-rose-300/35 hover:bg-rose-300/15"
                            aria-label={`View error for ${task.algorithm_id}`}
                            title="View error"
                          >
                            !
                          </button>
                        ) : task.status === "Running" ? (
                          <span
                            className="relative inline-flex h-11 w-11 items-center justify-center"
                            aria-label={`${progressPercent}% complete for ${task.algorithm_id}`}
                            title={`${progressPercent}% • ${progressLabel}`}
                            style={{
                              background: `conic-gradient(rgb(125 211 252) ${progressPercent * 3.6}deg, rgba(125,211,252,0.14) 0deg)`,
                              borderRadius: "9999px",
                            }}
                          >
                            <span className="absolute inset-[2px] rounded-full bg-slate-950" />
                            <span className="relative text-[10px] font-semibold text-sky-200">
                              {progressPercent}%
                            </span>
                          </span>
                        ) : task.status === "Queued" ? (
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-amber-300/30 bg-amber-300/10" aria-label={`Queued ${task.algorithm_id}`} title="Queued">
                            <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-5 flex flex-wrap gap-2">
                        <span className="rounded-full border border-teal-300/25 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-100">
                          {meta?.category ?? "Algorithm"}
                        </span>
                        {(task.status === "Running" || task.status === "Queued") && (
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-medium ${
                              task.status === "Running"
                                ? "border border-sky-300/20 bg-sky-300/10 text-sky-200"
                                : "border border-amber-300/20 bg-amber-300/10 text-amber-200"
                            }`}
                          >
                            {progressLabel}
                          </span>
                        )}
                      </div>

                      <div className="mt-8 flex items-end justify-between gap-3 text-sm text-slate-400">
                        <span>{String(meta?.publicationYear || meta?.publishedYear || meta?.year || "-")}</span>
                        <span className="text-right text-xs text-slate-500">{meta?.journal ?? ""}</span>
                      </div>

                      {task.status === "Completed" && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!projectId) return;
                            openDownloadModal(
                              `${task.algorithm_id} raw result`,
                              `${API_BASE_URL}/api/projects/${projectId}/download/result/${task.algorithm_id}`,
                              `${task.algorithm_id}-raw-ranked-edges.csv`
                            );
                          }}
                          className="mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.07]"
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
                <div className="flex h-full w-16 items-center justify-center bg-gradient-to-l from-slate-950/90 via-slate-950/70 to-transparent text-5xl text-white/90">
                  ›
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-xl font-semibold text-white">Dataset and preprocessing</h2>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                Expression matrix
              </p>
              <p className="mt-3 text-base font-medium text-white">
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
                  `${API_BASE_URL}/api/projects/${projectId}/download/pseudotime`,
                  metadata?.pseudotime_filename || project?.pseudotime_filename || "pseudotime.csv"
                );
              }}
              className={`group relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5 text-left transition hover:border-white/20 hover:bg-slate-950/80 ${
                projectId && metadata?.has_pseudotime
                  ? "cursor-pointer"
                  : "pointer-events-none opacity-60"
              }`}
            >
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                Pseudotime file
              </p>
              <p className="mt-3 line-clamp-2 text-base font-medium text-white">
                {metadata?.pseudotime_filename || project?.pseudotime_filename || "Not provided"}
              </p>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/75 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="rounded-full border border-teal-300/30 bg-teal-300/10 px-4 py-2 text-sm font-medium text-teal-50">
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
                  `${API_BASE_URL}/api/projects/${projectId}/download/expression`,
                  metadata?.expression_filename || project?.expression_filename || "dataset.csv"
                );
              }}
              className={`group relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5 text-left transition hover:border-white/20 hover:bg-slate-950/80 ${
                projectId ? "cursor-pointer" : "pointer-events-none opacity-60"
              }`}
            >
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                Dataset file
              </p>
              <p className="mt-3 line-clamp-2 text-base font-medium text-white">
                {metadata?.expression_filename || project?.expression_filename || "Not available"}
              </p>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/75 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="rounded-full border border-teal-300/30 bg-teal-300/10 px-4 py-2 text-sm font-medium text-teal-50">
                  Download dataset
                </span>
              </div>
            </button>
          </div>

          <div className="mt-5 flex flex-wrap gap-4">
            <span className="inline-flex rounded-full border border-teal-300/30 bg-teal-300/10 px-5 py-3 text-sm font-medium text-teal-50 shadow-[inset_0_0_0_1px_rgba(45,212,191,0.08)]">
              Top variable genes retained: {metadata?.preprocessing?.top_variable_genes || "-"}
            </span>
            <span className="inline-flex rounded-full border border-teal-300/30 bg-teal-300/10 px-5 py-3 text-sm font-medium text-teal-50 shadow-[inset_0_0_0_1px_rgba(45,212,191,0.08)]">
              Transcription factor override: {boolText(metadata?.preprocessing?.include_all_tfs).toLowerCase()}
            </span>
            <span className="inline-flex rounded-full border border-teal-300/30 bg-teal-300/10 px-5 py-3 text-sm font-medium text-teal-50 shadow-[inset_0_0_0_1px_rgba(45,212,191,0.08)]">
              Library-size normalization: {boolText(metadata?.preprocessing?.normalize_enabled).toLowerCase()}
            </span>
            <span className="inline-flex rounded-full border border-teal-300/30 bg-teal-300/10 px-5 py-3 text-sm font-medium text-teal-50 shadow-[inset_0_0_0_1px_rgba(45,212,191,0.08)]">
              log₂(x + 1) transformation: {boolText(metadata?.preprocessing?.log_transform_enabled).toLowerCase()}
            </span>
          </div>
        </div>

        {pendingDownload && (
          <div
            className={`fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 px-6 py-10 backdrop-blur-sm ${
              isDownloadModalClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
            }`}
          >
            <div
              className={`w-full max-w-md rounded-[2rem] border border-white/10 bg-slate-900 p-6 shadow-2xl shadow-cyan-950/20 ${
                isDownloadModalClosing ? "animate-modal-panel-out" : "animate-modal-panel"
              }`}
            >
              <p className="text-sm font-medium uppercase tracking-[0.22em] text-teal-300">
                Download file
              </p>
              <h3 className="mt-4 text-2xl font-semibold text-white">
                Download {pendingDownload.label}?
              </h3>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                This will download the saved file from the project record in the backend.
              </p>
              <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-4">
                <p className="text-sm font-medium text-white">{pendingDownload.filename}</p>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeDownloadModal}
                  className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDownload}
                  className="rounded-2xl border border-teal-300/30 bg-teal-300/10 px-5 py-3 text-sm font-medium text-teal-50 transition hover:border-teal-300/45 hover:bg-teal-300/15"
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

        <div className="mt-8 rounded-[2rem] border border-white/10 bg-slate-950/90 p-6 shadow-xl shadow-slate-950/20 backdrop-blur-md">
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-semibold text-white">Results hub</h2>
            </div>

              <div className="sticky top-[76px] z-[60]">
              <ResultsControlsSection
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
                consensusThreshold={consensusThreshold}
                maxConsensusThreshold={Math.max(activeAlgorithmIds.length, 1)}
                onChangeConsensusThreshold={setConsensusThreshold}
                isConsensusView={activeAlgorithmIds.length >= 2}
              />
            </div>

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
              <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
                <p className="text-lg font-semibold text-white">{resultsAvailabilityNotice.title}</p>
                <p className="mt-3 text-sm leading-6 text-slate-400">
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
      </section>
    </main>
  );
}