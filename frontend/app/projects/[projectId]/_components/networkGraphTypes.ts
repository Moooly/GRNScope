import type { Core, ElementDefinition } from "cytoscape";

export type NetworkNode = {
  id: string;
  inDegree: number;
  outDegree: number;
  degree: number;
  isTF: boolean;
};

export type NetworkEdge = {
  key: string;
  source: string;
  target: string;
  score: number;
  confidence: number;
  count: number;
  rank: number;
  supportingAlgorithms: string[];
  direction: -1 | 0 | 1;
  directionConfidence: number | null;
  directionCoverage: number;
  sign: -1 | 0 | 1;
  signConfidence: number | null;
  signCoverage: number;
};

export type NetworkLayoutMode =
  | "force"
  | "hierarchical"
  | "concentric"
  | "circular";

export type NetworkGraphProps = {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  selectedGene: string | null;
  selectedEdgeKey: string | null;
  layout: NetworkLayoutMode;
  onSelectGene: (geneId: string | null) => void;
  onSelectEdge: (edgeKey: string | null) => void;
  onGraphReady?: (cy: Core | null) => void;
};

export type EdgeTooltipState = {
  x: number;
  y: number;
  source: string;
  target: string;
  score: number;
  rank: number;
  supportingAlgorithms: string[];
  directionConfidence: number | null;
  sign: -1 | 0 | 1;
  signConfidence: number | null;
  signCoverage: number;
};

export type PositionMap = Record<string, { x: number; y: number }>;

export type GraphCounts = {
  nodeCount: number;
  edgeCount: number;
};

export type GraphElementsResult = {
  elements: ElementDefinition[];
  elementsSignature: string;
};
