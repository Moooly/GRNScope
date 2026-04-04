import { Project } from "../_types/project";

export const projects: Project[] = [
  {
    id: "project-1",
    name: "Gonadal Sex Determination",
    description: "Single-cell RNA-seq dataset for GRN inference.",
    createdAt: "2026-04-03 10:24",
    datasetCount: 2,
    jobCount: 3,
  },
  {
    id: "project-2",
    name: "Stem Cell Differentiation",
    description: "Trajectory-aware analysis with optional pseudotime input.",
    createdAt: "2026-04-01 14:10",
    datasetCount: 1,
    jobCount: 1,
  },
  {
    id: "project-3",
    name: "Immune Response Pilot",
    description: "Consensus comparison across multiple GRN algorithms.",
    createdAt: "2026-03-29 09:42",
    datasetCount: 3,
    jobCount: 4,
  },
];