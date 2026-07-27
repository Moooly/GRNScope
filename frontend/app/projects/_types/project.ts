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
};

export type MatrixValidationIssue = {
  code: string;
  severity: string;
  title: string;
  message: string;
  count: number;
  locations?: Array<{
    row?: number | null;
    column?: number | null;
    label?: string | null;
    value?: string | null;
  }>;
};

export type ProjectJob = {
  job_id: string;
  overall_status: string;
  ensemble_enabled: string | boolean;
  tasks: ProjectTask[];
  setup_error_type?: string | null;
  setup_error_message?: string | null;
  setup_validation_issues?: MatrixValidationIssue[];
};

export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  createdAtTimestamp?: number | string | null;
  datasetCount: number;
  geneCount?: number | null;
  cellCount?: number | null;
  jobCount: number;
  latestJob?: ProjectJob | null;
};
