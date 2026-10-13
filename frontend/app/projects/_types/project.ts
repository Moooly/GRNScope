import type { ProjectJob } from "../../_lib/apiContracts";
export type { MatrixValidationIssue, ProjectJob, ProjectTask } from "../../_lib/apiContracts";

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
