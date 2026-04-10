export type ProjectTask = {
  algorithm_id: string;
  status: string;
  elapsed_seconds: number;
  error_message: string | null;
  progress_percent?: number;
  progress_label?: string | null;
  result_path?: string | null;
  completed_at?: string | null;
};

export type ProjectJob = {
  job_id: string;
  overall_status: string;
  ensemble_enabled: boolean | string;
  tasks: ProjectTask[];
};

export type ProjectManifest = {
  project_id: string;
  project_name: string;
  project_description: string;
  expression_path?: string;
  expression_filename?: string | null;
  pseudotime_path?: string | null;
  pseudotime_filename?: string | null;
};

export type MetadataManifest = {
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

export type AlgorithmStoredResult = {
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

export type AlgorithmCatalogItem = {
  id: string;
  category?: string;
  publicationYear?: string | number;
  publishedYear?: string | number;
  year?: string | number;
  journal?: string;
};

export type AggregatedEdge = {
  key: string;
  source: string;
  target: string;
  score: number;
  count: number;
  rank: number;
  perAlgorithmScores: Record<string, number>;
  supportingAlgorithms: string[];
};

export type NodeInfo = {
  id: string;
  inDegree: number;
  outDegree: number;
  degree: number;
  isTF: boolean;
  topRegulators: string[];
  topTargets: string[];
};

export type OverlapEntry = {
  key: string;
  methods: string[];
  count: number;
};

export type BenchmarkMetrics = {
  methodId: string;
  evaluatedEdges: number;
  positivesFound: number;
  precision: number;
  recall: number;
  auprc: number;
  auprcRatio: number;
};