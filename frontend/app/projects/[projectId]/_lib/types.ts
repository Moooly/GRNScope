export type ProjectTask = {
  algorithm_id: string;
  status: string;
  elapsed_seconds: number;
  error_message: string | null;
  error_type?: string | null;
  progress_percent?: number;
  progress_label?: string | null;
  estimated_remaining_seconds?: number | null;
  estimated_remaining_min_seconds?: number | null;
  estimated_remaining_max_seconds?: number | null;
  result_path?: string | null;
  started_at?: string | null;
  started_at_timestamp?: number | null;
  completed_at?: string | null;
  completed_at_timestamp?: number | null;
  run_metadata?: Record<string, Record<string, unknown>> | null;
  latest_attempt_status?: string | null;
  latest_attempt_error_message?: string | null;
  latest_attempt_elapsed_seconds?: number | null;
  latest_attempt_completed_at?: string | null;
};

export type MatrixValidationLocation = {
  row?: number | null;
  column?: number | null;
  label?: string | null;
  value?: string | null;
  gene?: string | null;
  cell?: string | null;
};

export type MatrixValidationIssue = {
  code: string;
  severity: "error" | "warning" | "info" | string;
  title: string;
  message: string;
  count: number;
  locations?: MatrixValidationLocation[];
};

export type ProjectJob = {
  job_id: string;
  overall_status: string;
  ensemble_enabled: boolean | string;
  tasks: ProjectTask[];
  setup_error_type?: string | null;
  setup_error_message?: string | null;
  setup_validation_issues?: MatrixValidationIssue[];
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
  gene_ordering_path?: string | null;
  gene_ordering_filename?: string | null;
  gene_ordering_validation?: GeneOrderingValidation;
  selected_algorithms?: string[];
  ensemble_enabled?: boolean | string;
  preprocessing?: PreprocessingConfig;
  preprocessing_status?: string | null;
  preprocessing_result?: PreprocessingResult | null;
  ranked_edges_per_target_limit?: number | string | null;
  algorithm_parameters?: Record<string, Record<string, unknown>>;
  resolved_algorithm_parameters?: Record<string, Record<string, unknown>>;
  celloracle?: {
    species?: string | null;
    base_grn?: string | null;
  };
  latest_job_id?: string | null;
  created_at?: string | null;
  created_at_display?: string | null;
  notification_email?: string | null;
  upload_status?: string | null;
  dataset_validation_status?: string | null;
  dataset_validation_error?: string | null;
  dataset_validation_issues?: MatrixValidationIssue[];
  setup_error_type?: string | null;
  setup_error_message?: string | null;
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
  gene_ordering_filename?: string | null;
  gene_count?: number | null;
  cell_count?: number | null;
  gene_names?: string[];
  species_inference?: {
    species: string;
    label: string;
    confidence: number;
    evidence_count: number;
    recognized_count: number;
    basis: string;
  } | null;
  cell_names?: string[];
  known_tf_gene_names?: string[];
  has_pseudotime?: boolean | null;
  has_cluster_labels?: boolean | null;
  has_gene_ordering?: boolean | null;
  gene_ordering_validation?: GeneOrderingValidation;
  cluster_count?: number | null;
  cluster_names?: string[];
  cluster_cell_counts?: Record<string, number>;
  has_ground_truth?: boolean | null;
  selected_algorithms?: string[];
  algorithm_parameters?: Record<string, Record<string, unknown>>;
  resolved_algorithm_parameters?: Record<string, Record<string, unknown>>;
  ensemble_enabled?: boolean | string;
  is_demo?: boolean;
  read_only?: boolean;
  upload_status?: string | null;
  dataset_validation_status?: string | null;
  dataset_validation_error?: string | null;
  dataset_validation_issues?: MatrixValidationIssue[];
  setup_error_type?: string | null;
  setup_error_message?: string | null;
  input_files?: Array<{
    name: string;
    path: string;
    description?: string;
  }>;
  job?: {
    job_id?: string;
    overall_status?: string;
  };
  preprocessing?: PreprocessingConfig;
  preprocessing_status?: string | null;
  preprocessing_result?: PreprocessingResult | null;
};

export type GeneOrderingValidation = {
  status?: "waiting_for_upload" | "pending" | "validated" | "failed" | "not_required" | string;
  gene_count?: number;
  matching_gene_count?: number;
  unmatched_gene_count?: number;
  unmatched_gene_names?: string[];
  has_variance?: boolean;
  error?: string;
};

export type PreprocessingConfig = {
  schema_version?: number;
  matrix_state?: "raw" | "normalized" | "log_normalized";
  dataset_species?: string;
  enabled_stages?: Array<"detection" | "trajectory" | "variance">;
  detection?: {
    enabled?: boolean;
    minimum_cell_percent?: number;
  };
  trajectory?: {
    enabled?: boolean;
    gene_ordering_source?: "calculate" | "upload";
    gene_ordering_filename?: string | null;
    p_value_threshold?: number;
    bonferroni_correction?: boolean;
    retain_significant_tfs?: boolean;
  };
  variance?: {
    enabled?: boolean;
    gene_count?: number;
    include_known_tfs?: boolean;
  };
};

export type GeneSelectionStageResult = {
  stage: "detection" | "trajectory" | "variance" | string;
  input_gene_count?: number;
  retained_gene_count?: number;
  removed_gene_count?: number;
  cell_count?: number;
  minimum_cell_percent?: number;
  minimum_detected_cell_count?: number;
  p_value_threshold?: number;
  effective_p_value_threshold?: number;
  bonferroni_correction?: boolean;
  retain_significant_tfs?: boolean;
  retained_significant_tf_count?: number;
  requested_gene_count?: number;
  include_known_tfs?: boolean;
  configured_include_known_tfs?: boolean;
  retain_significant_trajectory_tfs?: boolean;
  forced_known_tf_count?: number;
  gene_audit_available?: boolean;
};

export type PreprocessingResult = {
  status?: string;
  gene_count?: number;
  cell_count?: number;
  gene_selection?: GeneSelectionStageResult[];
};

export type AlgorithmPreprocessingSummary = {
  algorithm_id?: string;
  stage?: string;
  selection_method?: string;
  reason_code?: "runtime_guard" | "numerical_stability" | string;
  configured_gene_limit?: number;
  effective_gene_limit?: number;
  input_gene_count?: number;
  retained_gene_count?: number;
  removed_gene_count?: number;
  applied?: boolean;
  gene_audit_available?: boolean;
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
  confidence_summary?: ConfidenceSummary | null;
  algorithm_preprocessing?: AlgorithmPreprocessingSummary | null;
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
  confidence_summary?: ConfidenceSummary | null;
  algorithm_preprocessing?: AlgorithmPreprocessingSummary | null;
  top_edges?: AlgorithmResultEdge[];
};

export type SpearmanStabilityCheck = {
  method?: string;
  run_count?: number;
  stop_rho?: number;
  compared_edges?: number;
  rho?: number | null;
  stop_early?: boolean;
  status?: string;
  message?: string;
};

export type RepeatRunStabilityPair = {
  first_run?: string;
  second_run?: string;
  rho?: number | null;
};

export type RepeatRunStabilitySummary = {
  method?: string;
  edge_universe?: string;
  run_count?: number;
  usable_run_count?: number;
  pair_count?: number;
  median_rho?: number | null;
  mad_rho?: number | null;
  minimum_rho?: number | null;
  maximum_rho?: number | null;
  pairs?: RepeatRunStabilityPair[];
  status?: string;
};

export type ConfidenceSummary = {
  bootstrap_runs?: number;
  planned_bootstrap_runs?: number;
  total_algorithm_runs?: number;
  full_data_run_id?: string;
  resampling_scheme?: string;
  sampling_unit?: string;
  sampling_with_replacement?: boolean;
  sample_size_fraction?: number;
  confidence_definition?: string;
  evidence_definition?: string;
  interval_definition?: string;
  sign_confidence_definition?: string;
  sign_coverage_definition?: string;
  min_runs?: number;
  stop_rho?: number;
  stop_streak?: number;
  early_stopping_enabled?: boolean;
  subsample_fraction?: number;
  stability_top_k?: number;
  early_stopping?: {
    enabled?: boolean;
    method?: string;
    stop_rho?: number;
    stop_streak?: number;
    min_runs?: number;
    stopped_early?: boolean;
    stopped_after_runs?: number;
    streak?: number;
    checks?: SpearmanStabilityCheck[];
    decision?: SpearmanStabilityCheck | null;
  } | null;
  repeat_run_stability?: RepeatRunStabilitySummary | null;
  run_metadata?: Record<string, Record<string, unknown>> | null;
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
  bootstrap_mean_evidence?: number;
  evidence_ci_lower?: number | null;
  evidence_ci_upper?: number | null;
  full_data_evidence?: number | null;
  full_data_raw_score?: number | null;
  full_data_rank?: number | null;
  full_data_present?: boolean;
  mean_raw_score?: number;
  mean_z?: number;
  z_ci_lower?: number | null;
  z_ci_upper?: number | null;
  selected_runs?: number;
  positive_selected_runs?: number;
  negative_selected_runs?: number;
  signed_selected_runs?: number;
  sign_agreeing_runs?: number | null;
  bootstrap_sign_confidence?: number | null;
  bootstrap_sign_coverage?: number | null;
  bootstrap_positive_probability?: number | null;
  bootstrap_negative_probability?: number | null;
  bootstrap_sign_reference?: "full_data" | "bootstrap_mean" | null;
  observed_runs?: number;
  run_count?: number;
  normalized_score?: number;
  weight?: number;
  edge_weight?: number;
  algorithm_id?: string;
  run_ranks?: Record<string, number | null>;
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
  bootstrapVerified?: boolean;
  bootstrapSelectedRuns?: number;
  bootstrapRunCount?: number;
  evidenceCiLower?: number | null;
  evidenceCiUpper?: number | null;
  bootstrapSignConfidence?: number | null;
  bootstrapSignCoverage?: number | null;
  bootstrapPositiveProbability?: number | null;
  bootstrapNegativeProbability?: number | null;
  bootstrapSignedSelectedRuns?: number;
  bootstrapSignAgreeingRuns?: number;
  bootstrapSignReference?: "full_data" | "bootstrap_mean" | null;
  stability?: number;
  meanPercentile?: number;
  count: number;
  rank: number;
  perAlgorithmScores: Record<string, number>;
  perAlgorithmConfidences?: Record<string, number>;
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
  perturbation_score?: number | null;
  perturbation_score_p_value?: number | null;
  perturbation_score_direction?: "promotes" | "blocks" | "neutral" | string | null;
  perturbation_score_grid_point_count?: number;
  perturbation_score_unavailable_reason?: string | null;
  pseudotime_trajectory?: string;
  pseudotime_cell_count?: number;
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
    perturbation_score?: number | null;
    perturbation_score_p_value?: number | null;
    perturbation_score_direction?: "promotes" | "blocks" | "neutral" | string | null;
    perturbation_score_grid_point_count?: number;
    perturbation_score_unavailable_reason?: string | null;
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
  // Pseudotime-derived development flow (arrows following natural differentiation).
  development_vectors?: Array<{ x: number; y: number; dx: number; dy: number }>;
  // Trajectory-specific perturbation flow used by CellOracle to calculate the
  // development inner product. This intentionally differs from whole-dataset
  // grid_vectors when pseudotime covers only a subset of cells.
  development_perturbation_vectors?: Array<{ x: number; y: number; dx: number; dy: number }>;
  // Per-grid inner product of the perturbation shift vs the development direction:
  // score > 0 = perturbation promotes development, < 0 = blocks it.
  inner_product_grid?: Array<{ x: number; y: number; score: number }>;
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
