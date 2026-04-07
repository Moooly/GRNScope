"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import NetworkGraph from "./_components/NetworkGraph";
import ProjectHeader from "./_components/ProjectHeader";
import ResultsSummarySection from "./_components/ResultsSummarySection";
import ResultsControlsSection from "./_components/ResultsControlsSection";
import EdgeAnalysisTableSection from "./_components/EdgeAnalysisTableSection";
import { algorithms } from "../_data/algorithms";

type ProjectTask = {
  algorithm_id: string;
  status: string;
  elapsed_seconds: number;
  error_message: string | null;
  result_path?: string | null;
  completed_at?: string | null;
};

type ProjectJob = {
  job_id: string;
  overall_status: string;
  ensemble_enabled: boolean | string;
  tasks: ProjectTask[];
};

type ProjectManifest = {
  project_id: string;
  project_name: string;
  project_description: string;
  expression_path?: string;
  expression_filename?: string | null;
  pseudotime_path?: string | null;
  pseudotime_filename?: string | null;
};

type MetadataManifest = {
  expression_filename?: string | null;
  pseudotime_filename?: string | null;
  gene_count?: number | null;
  cell_count?: number | null;
  has_pseudotime?: boolean | null;
  preprocessing?: {
    top_variable_genes?: string;
    include_all_tfs?: boolean | string;
    normalize_enabled?: boolean | string;
    log_transform_enabled?: boolean | string;
  };
};

type AlgorithmStoredResult = {
  algorithm_id: string;
  generated_at: string;
  elapsed_seconds: number;
  network_summary?: {
    edge_count?: number;
    node_count?: number;
  };
  top_edges?: Array<{
    source: string;
    target: string;
    score: number;
  }>;
};

type AlgorithmCatalogItem = {
  id: string;
  category?: string;
  publicationYear?: string | number;
  publishedYear?: string | number;
  year?: string | number;
  journal?: string;
};

type AggregatedEdge = {
  key: string;
  source: string;
  target: string;
  score: number;
  count: number;
  rank: number;
  perAlgorithmScores: Record<string, number>;
  supportingAlgorithms: string[];
};

type NodeInfo = {
  id: string;
  inDegree: number;
  outDegree: number;
  degree: number;
  isTF: boolean;
  topRegulators: string[];
  topTargets: string[];
};

type OverlapEntry = {
  key: string;
  methods: string[];
  count: number;
};

type BenchmarkMetrics = {
  methodId: string;
  evaluatedEdges: number;
  positivesFound: number;
  precision: number;
  recall: number;
  auprc: number;
  auprcRatio: number;
};


const API_BASE_URL = "http://127.0.0.1:8000";
const POLL_INTERVAL_MS = 5000;

function boolText(value: boolean | string | undefined) {
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (value === "true") return "Enabled";
  if (value === "false") return "Disabled";
  return "-";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parseGroundTruthCsv(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const edges = new Set<string>();

  lines.forEach((line, index) => {
    const parts = line.split(/[\t,]/).map((part) => part.trim());
    if (parts.length < 2) return;

    const source = parts[0];
    const target = parts[1];

    const lowerSource = source.toLowerCase();
    const lowerTarget = target.toLowerCase();
    const isHeaderLike =
      index === 0 &&
      ((lowerSource.includes("source") || lowerSource.includes("tf") || lowerSource.includes("regulator")) &&
        (lowerTarget.includes("target") || lowerTarget.includes("gene")));

    if (isHeaderLike || !source || !target) return;
    edges.add(`${source}|||${target}`);
  });

  return edges;
}

function computeBenchmarkMetrics(
  methodId: string,
  rows: AggregatedEdge[],
  groundTruthEdges: Set<string>,
  baselineUniverseSize: number
): BenchmarkMetrics {
  const rankedRows = [...rows].sort((a, b) => b.score - a.score);
  const totalGroundTruth = groundTruthEdges.size;

  if (rankedRows.length === 0 || totalGroundTruth === 0) {
    return {
      methodId,
      evaluatedEdges: rankedRows.length,
      positivesFound: 0,
      precision: 0,
      recall: 0,
      auprc: 0,
      auprcRatio: 0,
    };
  }

  let tp = 0;
  let fp = 0;
  let prevRecall = 0;
  let area = 0;

  rankedRows.forEach((edge) => {
    const key = `${edge.source}|||${edge.target}`;
    if (groundTruthEdges.has(key)) {
      tp += 1;
    } else {
      fp += 1;
    }

    const precision = tp / (tp + fp);
    const recall = tp / totalGroundTruth;
    area += (recall - prevRecall) * precision;
    prevRecall = recall;
  });

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = totalGroundTruth > 0 ? tp / totalGroundTruth : 0;
  const randomBaseline = baselineUniverseSize > 0 ? totalGroundTruth / baselineUniverseSize : 0;

  return {
    methodId,
    evaluatedEdges: rankedRows.length,
    positivesFound: tp,
    precision,
    recall,
    auprc: area,
    auprcRatio: randomBaseline > 0 ? area / randomBaseline : 0,
  };
}






export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Array.isArray(params?.projectId) ? params.projectId[0] : params?.projectId;

  const [project, setProject] = useState<ProjectManifest | null>(null);
  const [metadata, setMetadata] = useState<MetadataManifest | null>(null);
  const [latestJob, setLatestJob] = useState<ProjectJob | null>(null);
  const [algorithmResults, setAlgorithmResults] = useState<Record<string, AlgorithmStoredResult>>({});
  const [selectedView, setSelectedView] = useState<string>("consensus");
  const [topN, setTopN] = useState(1);
  const [hasTouchedTopN, setHasTouchedTopN] = useState(false);
  const [consensusThreshold, setConsensusThreshold] = useState(1);
  const [geneSearch, setGeneSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [networkLayout, setNetworkLayout] = useState<"force" | "hierarchical" | "concentric" | "circular">("force");
  const [selectedGene, setSelectedGene] = useState<string | null>(null);
  const [isolatedGene, setIsolatedGene] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [isTableFullscreen, setIsTableFullscreen] = useState(false);
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
  const columnMenuRef = useRef<HTMLDivElement | null>(null);


  const completedTasks = useMemo(
    () => latestJob?.tasks.filter((task) => task.status === "Completed") ?? [],
    [latestJob]
  );

  const completedAlgorithmIds = useMemo(
    () => completedTasks.map((task) => task.algorithm_id),
    [completedTasks]
  );

  const algorithmMetaMap = useMemo(
    () => new Map((algorithms as AlgorithmCatalogItem[]).map((item) => [item.id, item])),
    []
  );

  const hasActiveTasks = useMemo(() => {
    const status = latestJob?.overall_status;
    return status === "Queued" || status === "Running";
  }, [latestJob]);

  const algorithmEdgeRows = useMemo(() => {
    const next: Record<string, AggregatedEdge[]> = {};

    completedAlgorithmIds.forEach((algorithmId) => {
      const edges = (algorithmResults[algorithmId]?.top_edges ?? []).slice(0, topN);
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

    completedAlgorithmIds.forEach((algorithmId) => {
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
  }, [algorithmEdgeRows, completedAlgorithmIds, consensusThreshold]);

  const activeEdges = useMemo(
    () => (selectedView === "consensus" ? consensusRows : algorithmEdgeRows[selectedView] ?? []),
    [algorithmEdgeRows, consensusRows, selectedView]
  );

  const activeMethodLabel = selectedView === "consensus" ? "Consensus network" : selectedView;

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
    filteredNetworkEdges.forEach((edge) => {
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
    return Array.from(nodes.values()).sort((a, b) => b.degree - a.degree);
  }, [filteredNetworkEdges]);

  const selectedNode = useMemo(
    () => networkNodes.find((node) => node.id === selectedGene) ?? null,
    [networkNodes, selectedGene]
  );

  const perAlgorithmEdgeCounts = useMemo(() => {
    return completedAlgorithmIds.map((algorithmId) => ({
      algorithmId,
      count: algorithmEdgeRows[algorithmId]?.length ?? 0,
    }));
  }, [algorithmEdgeRows, completedAlgorithmIds]);

  const maxAlgorithmEdgeCount = useMemo(() => {
    return Math.max(...perAlgorithmEdgeCounts.map((item) => item.count), 1);
  }, [perAlgorithmEdgeCounts]);

  const overlapEntries = useMemo<OverlapEntry[]>(() => {
    if (completedAlgorithmIds.length < 2) return [];

    const edgeMembership = new Map<string, string[]>();
    completedAlgorithmIds.forEach((algorithmId) => {
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

    return Array.from(buckets.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, completedAlgorithmIds.length >= 4 ? 10 : 7);
  }, [algorithmEdgeRows, completedAlgorithmIds]);

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
    if (selectedView === "consensus") {
      const counts = completedAlgorithmIds.map(
        (algorithmId) => algorithmResults[algorithmId]?.top_edges?.length ?? 0
      );
      return Math.max(...counts, 1);
    }

    return Math.max(algorithmResults[selectedView]?.top_edges?.length ?? 0, 1);
  }, [algorithmResults, completedAlgorithmIds, selectedView]);

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





  useEffect(() => {
    setVisibleAlgorithmColumns(completedAlgorithmIds);
    setConsensusThreshold((current) => clamp(current, 1, Math.max(completedAlgorithmIds.length, 1)));
  }, [completedAlgorithmIds]);

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
    const validViews = ["consensus", ...completedAlgorithmIds];
    if (!validViews.includes(selectedView)) {
      setSelectedView("consensus");
    }
  }, [completedAlgorithmIds, selectedView]);

  useEffect(() => {
    if (!selectedGene) return;
    if (!networkNodes.some((node) => node.id === selectedGene)) {
      setSelectedGene(null);
    }
  }, [networkNodes, selectedGene]);

  useEffect(() => {
    setTablePage(1);
  }, [tableSearch, tableSortDirection, tableSortKey, selectedView, consensusThreshold, topN, isolatedGene, geneSearch]);

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
          overallStatus={latestJob?.overall_status}
        />

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

        <div className="group mt-8 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">Algorithms used</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Scroll horizontally to view all selected algorithms.
              </p>
            </div>
          </div>

          <div className="relative mt-5 overflow-hidden">
            <div className="overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex gap-4 pr-20">
                {(latestJob?.tasks ?? []).map((task) => {
                  const meta = algorithmMetaMap.get(task.algorithm_id);
                  return (
                    <div
                      key={task.algorithm_id}
                      className="w-[calc((100%-1rem)/2.5)] shrink-0 rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 sm:w-[calc((100%-1rem)/2.5)] md:w-[calc((100%-2rem)/3.5)] xl:w-[calc((100%-3rem)/4.5)]"
                    >
                      <p className="text-2xl font-semibold text-white">{task.algorithm_id}</p>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <span className="rounded-full border border-teal-300/25 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-100">
                          {meta?.category ?? "Algorithm"}
                        </span>
                      </div>
                      <div className="mt-8 flex items-end justify-between gap-3 text-sm text-slate-400">
                        <span>{String(meta?.publicationYear || meta?.publishedYear || meta?.year || "-")}</span>
                        <span className="text-right text-xs text-slate-500">{meta?.journal ?? ""}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {(latestJob?.tasks.length ?? 0) > 4 && (
              <div className="pointer-events-none absolute inset-y-0 right-0 hidden group-hover:flex">
                <div className="flex h-full w-20 items-center justify-center border-l border-white/10 bg-slate-950/70 text-5xl text-white shadow-lg shadow-slate-950/30 backdrop-blur-[1px]">
                  ›
                </div>
              </div>
            )}
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

        <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
          <div className="-mx-2 rounded-[1.75rem] border border-white/10 bg-slate-950/90 px-2 py-2 shadow-xl shadow-slate-950/20 backdrop-blur-md">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3 px-2">
                <h2 className="text-xl font-semibold text-white">Results hub</h2>
              </div>

              <ResultsSummarySection
                perAlgorithmEdgeCounts={perAlgorithmEdgeCounts}
                maxAlgorithmEdgeCount={maxAlgorithmEdgeCount}
                completedAlgorithmIds={completedAlgorithmIds}
                overlapEntries={overlapEntries}
                maxOverlapCount={maxOverlapCount}
                groundTruthFilename={groundTruthFilename}
                groundTruthEdgeCount={groundTruthEdges.size}
                groundTruthError={groundTruthError}
                benchmarkMetrics={benchmarkMetrics}
                onGroundTruthUpload={handleGroundTruthUpload}
            />

              <ResultsControlsSection
                selectedView={selectedView}
                completedAlgorithmIds={completedAlgorithmIds}
                onChangeView={(value) => {
                  setSelectedView(value);
                  setSelectedGene(null);
                  setSelectedEdgeKey(null);
                  setIsolatedGene(null);
                }}
                networkLayout={networkLayout}
                onChangeLayout={setNetworkLayout}
                topN={topN}
                maxAvailableTopN={maxAvailableTopN}
                onChangeTopN={(value) => {
                  setHasTouchedTopN(true);
                  setTopN(value);
                }}
                consensusThreshold={consensusThreshold}
                maxConsensusThreshold={Math.max(completedAlgorithmIds.length, 1)}
                onChangeConsensusThreshold={setConsensusThreshold}
                isConsensusView={selectedView === "consensus"}
              />

              <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-5">
                <div>
                  <h3 className="text-lg font-semibold text-white">Network Visualization</h3>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                      TF nodes = teal diamonds
                    </span>
                    <span className="rounded-full border border-slate-400/20 bg-slate-400/10 px-3 py-1 text-slate-200">
                      Target genes = slate circles
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                      Node size ∝ degree
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                      Edge width ∝ score
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                      Edge color ∝ support count
                    </span>
                  </div>
                </div>

                <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_0.75fr] xl:items-start">
                  <div className="min-w-0 overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#f3f4f6] p-4">
                    <NetworkGraph
                      key={`${selectedView}-${networkLayout}`}
                      nodes={networkNodes.map((node) => ({
                        id: node.id,
                        inDegree: node.inDegree,
                        outDegree: node.outDegree,
                        degree: node.degree,
                        isTF: node.isTF,
                      }))}
                      edges={filteredNetworkEdges.slice(0, 220).map((edge) => ({
                        key: edge.key,
                        source: edge.source,
                        target: edge.target,
                        score: edge.score,
                        count: edge.count,
                        rank: edge.rank,
                        supportingAlgorithms: edge.supportingAlgorithms,
                      }))}
                      selectedGene={selectedGene}
                      selectedEdgeKey={selectedEdgeKey}
                      layout={networkLayout}
                      onSelectGene={setSelectedGene}
                      onSelectEdge={setSelectedEdgeKey}
                    />
                  </div>

                  <div className="min-w-0 rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-base font-semibold text-white">Node Inspection</h4>
                      {selectedNode && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedGene(null);
                            setSelectedEdgeKey(null);
                          }}
                          className="rounded-2xl border border-white/10 px-3 py-1 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/[0.04]"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {selectedNode ? (
                      <>
                        <div className="mt-4 rounded-[1.25rem] border border-white/10 bg-white/[0.04] p-4">
                          <p className="text-lg font-semibold text-white">{selectedNode.id}</p>
                          <p className="mt-2 text-sm text-slate-400">
                            {selectedNode.isTF ? "Transcription factor" : "Target gene"}
                          </p>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
                            In-degree: {selectedNode.inDegree}
                          </div>
                          <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
                            Out-degree: {selectedNode.outDegree}
                          </div>
                        </div>

                        <div className="mt-4 space-y-4">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                              Top regulators
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {selectedNode.topRegulators.slice(0, 8).map((gene) => (
                                <span
                                  key={gene}
                                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300"
                                >
                                  {gene}
                                </span>
                              ))}
                              {selectedNode.topRegulators.length === 0 && (
                                <span className="text-xs text-slate-500">None</span>
                              )}
                            </div>
                          </div>

                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                              Top target genes
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {selectedNode.topTargets.slice(0, 8).map((gene) => (
                                <span
                                  key={gene}
                                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300"
                                >
                                  {gene}
                                </span>
                              ))}
                              {selectedNode.topTargets.length === 0 && (
                                <span className="text-xs text-slate-500">None</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="mt-6 flex flex-wrap gap-3 border-t border-white/10 pt-5">
                          <button
                            type="button"
                            onClick={() => {
                              setIsolatedGene(selectedNode.id);
                              setSelectedEdgeKey(null);
                            }}
                            className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-teal-300/35 hover:bg-teal-300/10 hover:text-teal-50"
                          >
                            Isolate Sub-network
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsolatedGene(null);
                              setSelectedEdgeKey(null);
                            }}
                            className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-white/20 hover:bg-white/[0.07]"
                          >
                            Reset View
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="mt-4 rounded-[1.25rem] border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm leading-6 text-slate-400">
                        Click a node in the network to inspect the gene name, transcription-factor status, in-degree, out-degree, top regulators, and top target genes.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <EdgeAnalysisTableSection
              isTableFullscreen={isTableFullscreen}
              setIsTableFullscreen={setIsTableFullscreen}
              tableSearch={tableSearch}
              setTableSearch={setTableSearch}
              columnMenuRef={columnMenuRef}
              isColumnMenuOpen={isColumnMenuOpen}
              setIsColumnMenuOpen={setIsColumnMenuOpen}
              completedAlgorithmIds={completedAlgorithmIds}
              visibleAlgorithmColumns={visibleAlgorithmColumns}
              setVisibleAlgorithmColumns={setVisibleAlgorithmColumns}
              selectedView={selectedView}
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
          </div>
        </div>
      </section>
    </main>
  );
}