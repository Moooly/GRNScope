export type ProjectTask = {
  algorithm_id: string;
  status: string;
  elapsed_seconds: number;
  error_message: string | null;
  progress_percent?: number;
  progress_label?: string | null;
  estimated_remaining_seconds?: number | null;
  result_path?: string | null;
  started_at?: string | null;
  started_at_timestamp?: number | null;
  completed_at?: string | null;
  completed_at_timestamp?: number | null;
};

export type ProjectJob = {
  job_id: string;
  overall_status: string;
  ensemble_enabled: string | boolean;
  tasks: ProjectTask[];
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
