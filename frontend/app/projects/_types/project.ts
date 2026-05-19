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
  jobCount: number;
  latestJob?: ProjectJob | null;
};
