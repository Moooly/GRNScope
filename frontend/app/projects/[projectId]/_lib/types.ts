export type ProjectTask = {
  algorithm_id: string;
  status: string;
  elapsed_seconds: number;
  error_message: string | null;
  error_type?: string | null;
  progress_percent?: number;
  progress_label?: string | null;
  estimated_remaining_seconds?: number | null;
  result_path?: string | null;
  started_at?: string | null;
  started_at_timestamp?: number | null;
  completed_at?: string | null;
  completed_at_timestamp?: number | null;
  run_metadata?: Record<string, Record<string, unknown>> | null;
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
  cluster_labels_path?: string | null;
  cluster_labels_filename?: string | null;
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
  cluster_labels_filename?: string | null;
  gene_count?: number | null;
  cell_count?: number | null;
  gene_names?: string[];
  cell_names?: string[];
  known_tf_gene_names?: string[];
  has_pseudotime?: boolean | null;
  has_cluster_labels?: boolean | null;
  cluster_count?: number | null;
  cluster_names?: string[];
  cluster_cell_counts?: Record<string, number>;
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
  scope_order?: string[];
  scopes?: Record<string, AlgorithmResultScope>;
  source_file?: string;
  gene_coordinates?: Record<string, GeneCoordinate>;
  gene_coordinate_count?: number;
};

export type AlgorithmResultScope = {
  scope_id: string;
  scope_label: string;
  scope_type: "global" | "cluster" | string;
  cell_count?: number;
  status?: string;
  skip_reason?: string | null;
  network_summary?: {
    edge_count?: number;
    node_count?: number;
  } | null;
  top_edges?: AlgorithmResultEdge[];
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

export type PerturbationRun = {
  run_id: string;
  gene: string;
  perturbation_value: number;
  n_propagation: number;
  clip_delta_x: boolean;
  status: "Queued" | "Preparing" | "Running" | "Completed" | "Failed" | string;
  progress_label?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  created_at_timestamp?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  elapsed_seconds?: number;
};

export type GeneExpressionDistribution = {
  gene: string;
  scope_type: "global" | "cluster" | string;
  scope_label?: string | null;
  expression_layer: "celloracle_imputed_count" | string;
  cell_count: number;
  baseline_mean: number;
  simulated_mean: number;
  baseline_median: number;
  simulated_median: number;
  mean_change: number;
  mean_absolute_change: number;
  increased_cell_fraction: number;
  decreased_cell_fraction: number;
  histogram: Array<{
    start: number;
    end: number;
    baseline_count: number;
    simulated_count: number;
  }>;
};

export type PerturbationResult = {
  run_id: string;
  gene: string;
  perturbation_value: number;
  n_propagation: number;
  clip_delta_x: boolean;
  celloracle_version?: string;
  model_reused?: boolean;
  model_scope?: "cluster_specific" | "global" | string;
  grn_unit?: "cluster" | "whole" | string;
  cluster_count?: number;
  cluster_specific_topology_count?: number;
  cluster_specific_topology_labels?: string[];
  global_topology_fallback_labels?: string[];
  input_cells?: number;
  cells_analyzed: number;
  genes_analyzed: number;
  ood_warning_gene_count: number;
  max_ood_exceeding_ratio: number;
  ood_genes?: Array<{
    gene: string;
    max_exceeding_ratio: number;
    ood_cell_ratio: number;
  }>;
  mean_shift_magnitude: number;
  mean_random_shift_magnitude: number;
  completed_at?: string | null;
  top_affected_genes: Array<{
    gene: string;
    mean_change: number;
    mean_absolute_change: number;
    original_mean?: number;
    simulated_mean?: number;
  }>;
  cluster_effects: Array<{
    cluster: string;
    gene: string;
    mean_change: number;
  }>;
  cluster_summary?: Array<{
    cluster: string;
    cell_count: number;
    mean_shift_magnitude: number;
    mean_random_shift_magnitude: number;
    shift_ratio?: number | null;
    ood_warning_gene_count?: number | null;
    top_genes?: Array<{
      gene: string;
      mean_change: number;
    }>;
  }>;
  gene_expression_distributions?: GeneExpressionDistribution[];
  embedding_points: Array<{
    x: number;
    y: number;
    cluster: string;
    shift_x?: number;
    shift_y?: number;
    random_shift_x?: number;
    random_shift_y?: number;
  }>;
  grid_vectors?: Array<{
    x: number;
    y: number;
    dx: number;
    dy: number;
    random_dx: number;
    random_dy: number;
    density: number;
  }>;
  grid_settings?: {
    source: string;
    smooth: number;
    steps: [number, number] | number[];
    min_mass: number;
    n_neighbors: number;
  };
  vectors?: Array<{
    x: number;
    y: number;
    dx: number;
    dy: number;
    random_dx: number;
    random_dy: number;
  }>;
};

export type PerturbationState = {
  available: boolean;
  reason?: string | null;
  eligible_genes: string[];
  model_scope?: {
    mode: "cluster_specific" | "global" | string;
    cluster_labels_available: boolean;
    cluster_specific_topology_count: number;
    cluster_specific_topology_labels: string[];
    global_topology_fallback_labels: string[];
  } | null;
  runs: PerturbationRun[];
  latest_result?: PerturbationResult | null;
};

export type GeneExpressionProfile = {
  gene: string;
  minimum: number;
  q1: number;
  median: number;
  q3: number;
  maximum: number;
  mean: number;
  nonzero_fraction: number;
  cell_count: number;
  safe_upper_limit: number;
  limit_source?: "observed_expression" | "celloracle_imputed_count" | string;
  histogram: Array<{
    start: number;
    end: number;
    count: number;
  }>;
};
