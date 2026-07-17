import { API_BASE } from "../../_lib/apiConfig";

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
  strengths: string[];
  limitations: string[];
  recommended_use_cases: string[];
  parameters: AlgorithmParameter[];
};

export type AlgorithmEntry = {
  id: string;
  name: string;
  tagline: string;
  category: MethodologyCategory;
  requiresPseudotime: boolean;
  directed: boolean;
  signed: boolean;
  supportsExpressionMatrix: boolean;
  publication: string;
  year: string;
  journal: string;
  dockerVersion: string;
  paperUrl: string;
  sourceUrl: string | null;
  strengths: string[];
  limitations: string[];
  recommendedUseCases: string[];
  detail: string;
  recommended: boolean;
  runner: string;
  parameters: AlgorithmParameter[];
};

function getDockerVersion(dockerImage: string) {
  const parts = dockerImage.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : dockerImage;
}

export function mapBackendAlgorithm(algorithm: BackendAlgorithmEntry): AlgorithmEntry {
  return {
    id: algorithm.id,
    name: algorithm.name,
    tagline: algorithm.description,
    category: algorithm.category,
    requiresPseudotime: algorithm.requires_pseudotime,
    directed: algorithm.directed,
    signed: algorithm.signed,
    supportsExpressionMatrix: algorithm.supports_expression_matrix,
    publication: algorithm.publication_title,
    year: algorithm.year,
    journal: algorithm.journal,
    dockerVersion: getDockerVersion(algorithm.docker_image),
    paperUrl: algorithm.publication_url,
    sourceUrl: algorithm.source_url,
    strengths: algorithm.strengths,
    limitations: algorithm.limitations,
    recommendedUseCases: algorithm.recommended_use_cases,
    detail: algorithm.long_description,
    recommended: algorithm.recommended,
    runner: algorithm.runner,
    parameters: algorithm.parameters ?? [],
  };
}

export async function fetchActiveAlgorithms(signal?: AbortSignal): Promise<AlgorithmEntry[]> {
  const response = await fetch(`${API_BASE}/algorithms`, {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to load algorithms: ${response.status}`);
  }

  const data = (await response.json()) as BackendAlgorithmEntry[];
  return data.filter((algorithm) => algorithm.active).map(mapBackendAlgorithm);
}

export async function fetchAlgorithmById(
  algorithmId: string,
  signal?: AbortSignal,
): Promise<AlgorithmEntry> {
  const response = await fetch(`${API_BASE}/algorithms/${encodeURIComponent(algorithmId)}`, {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(response.status === 404 ? "Algorithm not found." : `Failed to load algorithm: ${response.status}`);
  }

  return mapBackendAlgorithm((await response.json()) as BackendAlgorithmEntry);
}

export function formatParameterDefault(parameter: AlgorithmParameter): string {
  const { default: value, value_type: valueType } = parameter;
  if (value === null || value === undefined) return parameter.required ? "Required" : "—";
  if (valueType === "bool" || valueType === "boolean") return value ? "On" : "Off";
  return String(value);
}

export function formatParameterRange(parameter: AlgorithmParameter): string | null {
  if (parameter.options && parameter.options.length > 0) {
    return parameter.options.map((option) => String(option)).join(" · ");
  }
  if (parameter.value_type === "bool" || parameter.value_type === "boolean") return "On / Off";
  if (typeof parameter.minimum === "number" && typeof parameter.maximum === "number") {
    return `Range ${parameter.minimum} – ${parameter.maximum}`;
  }
  return null;
}
