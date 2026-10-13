/** Wire types shared by pages that consume the backend API. */

export type MethodologyCategory =
  | "Partial information decomposition"
  | "Random forest"
  | "Gradient boosting"
  | "Bayesian ridge regression"
  | "Partial correlation"
  | "Pearson correlation"
  | "Linear ODE"
  | "Ridge regression"
  | "Directed information"
  | "Kernel Granger causality"
  | "Lagged correlation"
  | "Linear ODE + velocity"
  | "Bayesian ARMA"
  | "Dynamical model + trees"
  | "Signed graph learning";

export type AlgorithmParameter = {
  name: string;
  label?: string;
  description?: string;
  default?: unknown;
  required?: boolean;
  value_type?: string;
  options?: unknown[];
  minimum?: number;
  maximum?: number;
  exclusive_minimum?: number;
  exclusive_maximum?: number;
  step?: number;
  advanced?: boolean;
};

export type BackendAlgorithmEntry = {
  id: string;
  name: string;
  description: string;
  long_description: string;
  category: MethodologyCategory;
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
  parameters: AlgorithmParameter[];
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
  latest_run_manifest_path?: string | null;
  run_manifest_error?: string | null;
};

export type ProjectJob = {
  job_id: string;
  overall_status: string;
  ensemble_enabled?: boolean | string;
  tasks: ProjectTask[];
  setup_error_type?: string | null;
  setup_error_message?: string | null;
  setup_validation_issues?: MatrixValidationIssue[];
};
