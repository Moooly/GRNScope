import { API_BASE } from "../../_lib/apiConfig";
import type {
  AlgorithmParameter,
  BackendAlgorithmEntry,
  MethodologyCategory,
} from "../../_lib/apiContracts";
export type {
  AlgorithmParameter,
  BackendAlgorithmEntry,
  MethodologyCategory,
} from "../../_lib/apiContracts";

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
  estimatedRuntime: string;
  parameters: AlgorithmParameter[];
};

export type AlgorithmSpeedTier = "fast" | "moderate" | "slow";

export type AlgorithmSpeed = {
  tier: AlgorithmSpeedTier;
  label: string;
  /** Sort order, fastest first. */
  order: number;
};

/**
 * Map the free-text `estimated_runtime` string to a coarse speed tier. Uses the
 * worst case mentioned (checks "slow" before "medium") so the badge never
 * understates how long a method can take.
 */
export function getAlgorithmSpeed(entry: AlgorithmEntry): AlgorithmSpeed {
  const runtime = entry.estimatedRuntime.toLowerCase();
  if (runtime.includes("slow")) return { tier: "slow", label: "Slow", order: 2 };
  if (runtime.includes("medium") || runtime.includes("moderate")) {
    return { tier: "moderate", label: "Moderate", order: 1 };
  }
  if (runtime.includes("fast")) return { tier: "fast", label: "Fast", order: 0 };
  return { tier: "moderate", label: entry.estimatedRuntime || "Moderate", order: 1 };
}

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
    estimatedRuntime: algorithm.estimated_runtime ?? "",
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
  const lower =
    typeof parameter.exclusive_minimum === "number"
      ? `greater than ${parameter.exclusive_minimum}`
      : typeof parameter.minimum === "number"
        ? `at least ${parameter.minimum}`
        : null;
  const upper =
    typeof parameter.exclusive_maximum === "number"
      ? `less than ${parameter.exclusive_maximum}`
      : typeof parameter.maximum === "number"
        ? `at most ${parameter.maximum}`
        : null;
  if (lower && upper) return `Range: ${lower} and ${upper}`;
  if (lower) return `Value must be ${lower}`;
  if (upper) return `Value must be ${upper}`;
  return null;
}
