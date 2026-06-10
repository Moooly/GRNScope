export type ProjectTask = {
  algorithm_id: string;
  status: string;
  elapsed_seconds: number;
  error_message: string | null;
  progress_percent?: number;
  progress_label?: string | null;
  result_path?: string | null;
  started_at?: string | null;
  started_at_timestamp?: number | null;
  completed_at?: string | null;
  completed_at_timestamp?: number | null;
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
  selected_algorithms?: string[];
  ensemble_enabled?: boolean | string;
  latest_job_id?: string | null;
  created_at?: string | null;
  created_at_display?: string | null;
  notification_email?: string | null;
  is_demo?: boolean;
  read_only?: boolean;
};

export type MetadataManifest = {
  project_id?: string;
  project_name?: string;
  project_description?: string;
  expression_filename?: string | null;
  pseudotime_filename?: string | null;
  gene_count?: number | null;
  cell_count?: number | null;
  gene_names?: string[];
  cell_names?: string[];
  known_tf_gene_names?: string[];
  has_pseudotime?: boolean | null;
  has_ground_truth?: boolean | null;
  selected_algorithms?: string[];
  ensemble_enabled?: boolean | string;
  is_demo?: boolean;
  read_only?: boolean;
  input_files?: Array<{
    name: string;
    path: string;
    description?: string;
  }>;
  job?: {
    job_id?: string;
    overall_status?: string;
  };
  preprocessing?: {
    top_variable_genes?: string;
    include_all_tfs?: boolean | string;
    normalize_enabled?: boolean | string;
    log_transform_enabled?: boolean | string;
  };
};

export type GeneCoordinate = {
  gene_name?: string | null;
  chromosome: string;
  start: number;
  end: number;
  strand?: string | null;
  gene_type?: string | null;
  gene_id?: string | null;
  matched_gene_name?: string | null;
  coordinate_match?: string | null;
};

export type AlgorithmStoredResult = {
  algorithm_id: string;
  generated_at?: string;
  started_at?: string;
  started_at_timestamp?: number;
  completed_at?: string;
  completed_at_timestamp?: number;
  elapsed_seconds?: number;
  network_summary?: {
    edge_count?: number;
    node_count?: number;
  };
  edge_count?: number;
  edges?: AlgorithmResultEdge[];
  ranked_edges?: AlgorithmResultEdge[];
  top_edges?: AlgorithmResultEdge[];
  source_file?: string;
  gene_coordinates?: Record<string, GeneCoordinate>;
  gene_coordinate_count?: number;
};

export type AlgorithmResultEdge = {
  rank?: number;
  source: string;
  target: string;
  score: number;
  confidence?: number;
  stability?: number;
  mean_percentile?: number;
  meanPercentile?: number;
  mean_raw_score?: number;
  mean_z?: number;
  z_ci_lower?: number | null;
  z_ci_upper?: number | null;
  selected_runs?: number;
  observed_runs?: number;
  run_count?: number;
  normalized_score?: number;
  weight?: number;
  edge_weight?: number;
  algorithm_id?: string;
};

export type AlgorithmCatalogItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  requiresPseudotime: boolean;
  directed: boolean;
  signed: boolean;
  publication?: string;
  year?: string;
  journal?: string;
  dockerVersion?: string;
  paperUrl?: string;
};

export type AggregatedEdge = {
  key: string;
  source: string;
  target: string;
  score: number;
  confidence: number;
  stability?: number;
  meanPercentile?: number;
  count: number;
  rank: number;
  perAlgorithmScores: Record<string, number>;
  perAlgorithmRawScores?: Record<string, number>;
  perAlgorithmSigns?: Record<string, -1 | 0 | 1>;
  supportingAlgorithms: string[];
  direction: -1 | 0 | 1;
  directionConfidence: number | null;
  directionCoverage: number;
  sign: -1 | 0 | 1;
  signConfidence: number | null;
  signCoverage: number;
};

export type NodeInfo = {
  id: string;
  inDegree: number;
  outDegree: number;
  degree: number;
  isTF: boolean;
  topRegulators: string[];
  topTargets: string[];
  chromosome?: string | null;
  start?: number | null;
  end?: number | null;
  strand?: string | null;
  gene_type?: string | null;
  gene_id?: string | null;
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
