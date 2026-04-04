import { Algorithm } from "../_types/algorithm";

export const algorithms: Algorithm[] = [
  {
    id: "pidc",
    name: "PIDC",
    description:
      "Information-theoretic inference using partial information decomposition.",
    category: "Information Theory",
    year: "2017",
    journal: "Bioinformatics",
    runtime: "~8 min",
    runtimeMinutes: 8,
    directed: true,
    signed: false,
    requiresPseudotime: false,
  },
  {
    id: "genie3",
    name: "GENIE3",
    description: "Tree-based ensemble method for ranking regulatory links.",
    category: "Machine Learning",
    year: "2010",
    journal: "PLoS ONE",
    runtime: "~25 min",
    runtimeMinutes: 25,
    directed: true,
    signed: false,
    requiresPseudotime: false,
  },
  {
    id: "grnboost2",
    name: "GRNBoost2",
    description:
      "Gradient-boosting approach optimized for scalable GRN inference.",
    category: "Machine Learning",
    year: "2019",
    journal: "Cell Systems",
    runtime: "~10 min",
    runtimeMinutes: 10,
    directed: true,
    signed: false,
    requiresPseudotime: false,
  },
  {
    id: "pearson",
    name: "Pearson Correlation",
    description:
      "Correlation-based baseline for fast co-expression discovery.",
    category: "Correlation",
    year: "Classic",
    journal: "Statistical Method",
    runtime: "~2 min",
    runtimeMinutes: 2,
    directed: false,
    signed: true,
    requiresPseudotime: false,
  },
  {
    id: "singe",
    name: "SINGE",
    description:
      "Granger-causality framework that uses pseudotime-ordered cells.",
    category: "Granger Causality",
    year: "2019",
    journal: "Cell Systems",
    runtime: "~35 min",
    runtimeMinutes: 35,
    directed: true,
    signed: false,
    requiresPseudotime: true,
  },
  {
    id: "scribe",
    name: "SCRIBE",
    description:
      "Information-based causal inference over dynamic cell trajectories.",
    category: "Information Theory",
    year: "2018",
    journal: "PNAS",
    runtime: "~30 min",
    runtimeMinutes: 30,
    directed: true,
    signed: true,
    requiresPseudotime: true,
  },
];

export const recommendedIds = ["pidc", "genie3", "grnboost2"];