import type cytoscape from "cytoscape";
import type {
  GraphCounts,
  NetworkEdge,
  NetworkLayoutMode,
  NetworkNode,
  PositionMap,
} from "./networkGraphTypes";

function polarPosition(angle: number, radius: number) {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function sortNodesByPriority(
  nodes: NetworkNode[],
  getPriority: (node: NetworkNode) => number,
  tieBreaker?: (a: NetworkNode, b: NetworkNode) => number
) {
  return [...nodes].sort((a, b) => {
    const priorityDiff = getPriority(b) - getPriority(a);
    if (priorityDiff !== 0) return priorityDiff;

    if (tieBreaker) {
      const tieBreakDiff = tieBreaker(a, b);
      if (tieBreakDiff !== 0) return tieBreakDiff;
    }

    return a.id.localeCompare(b.id);
  });
}

function compareByDegreeThenOutDegree(a: NetworkNode, b: NetworkNode) {
  if (b.degree !== a.degree) return b.degree - a.degree;
  if (b.outDegree !== a.outDegree) return b.outDegree - a.outDegree;
  return 0;
}

export function buildCircularPositions(nodes: NetworkNode[]) {
  if (nodes.length === 0) return {} as PositionMap;

  const sorted = sortNodesByPriority(
    nodes,
    (node) =>
      (node.isTF ? 100 : 0) +
      node.outDegree * 3 +
      node.degree * 1.1 -
      node.inDegree * 0.25,
    compareByDegreeThenOutDegree
  );

  const positions: PositionMap = {};
  const radius =
    nodes.length <= 8
      ? 145
      : nodes.length <= 12
        ? 185
        : nodes.length <= 18
          ? 245
          : Math.min(390, 260 + (nodes.length - 18) * 8);
  const count = sorted.length;

  sorted.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    positions[node.id] = polarPosition(angle, radius);
  });

  return positions;
}

export function buildConcentricPositions(nodes: NetworkNode[]) {
  if (nodes.length === 0) return {} as PositionMap;

  const sorted = sortNodesByPriority(
    nodes,
    (node) =>
      (node.isTF ? 100 : 0) +
      node.outDegree * 3 +
      node.degree * 1.25 -
      node.inDegree * 0.35,
    compareByDegreeThenOutDegree
  );

  const positions: PositionMap = {};

  const centerCount = nodes.length <= 10 ? 1 : 2;
  const centerNodes = sorted.slice(0, centerCount);
  const remainingNodes = sorted.slice(centerCount);

  if (centerNodes.length === 1) {
    positions[centerNodes[0].id] = { x: 0, y: 0 };
  } else {
    const centerRadius = 84;
    centerNodes.forEach((node, index) => {
      const angle =
        -Math.PI / 2 + (index / centerNodes.length) * Math.PI * 2;
      positions[node.id] = polarPosition(angle, centerRadius);
    });
  }

  if (remainingNodes.length === 0) {
    return positions;
  }

  let ringSizes: number[] = [];

  if (remainingNodes.length <= 8) {
    ringSizes = [remainingNodes.length];
  } else if (remainingNodes.length <= 18) {
    const firstRing = Math.ceil(remainingNodes.length / 2);
    const secondRing = remainingNodes.length - firstRing;
    ringSizes = secondRing > 0 ? [firstRing, secondRing] : [firstRing];
  } else if (remainingNodes.length <= 30) {
    const firstRing = Math.max(7, Math.round(remainingNodes.length * 0.34));
    const secondRing = Math.max(7, Math.round(remainingNodes.length * 0.33));
    const thirdRing = Math.max(
      0,
      remainingNodes.length - firstRing - secondRing
    );
    ringSizes =
      thirdRing > 0
        ? [firstRing, secondRing, thirdRing]
        : [firstRing, secondRing];
  } else {
    ringSizes = [];
    let remaining = remainingNodes.length;
    let currentRingCapacity = 8;

    while (remaining > 0) {
      const take = Math.min(currentRingCapacity, remaining);
      ringSizes.push(take);
      remaining -= take;
      currentRingCapacity += 6;
    }
  }

  const baseRadius = nodes.length <= 12 ? 120 : 150;
  const radiusStep = nodes.length <= 18 ? 95 : 115;
  let offset = 0;

  ringSizes.forEach((ringSize, ringIndex) => {
    const ringNodes = remainingNodes.slice(offset, offset + ringSize);
    offset += ringSize;

    const radius = baseRadius + ringIndex * radiusStep;
    const rotationOffset =
      -Math.PI / 2 +
      (ringIndex % 2 === 0 ? 0 : Math.PI / Math.max(ringSize, 2));

    ringNodes.forEach((node, nodeIndex) => {
      const angle =
        rotationOffset +
        ((nodeIndex + (ringIndex % 2 === 0 ? 0 : 0.5)) / ringSize) * Math.PI * 2;
      positions[node.id] = polarPosition(angle, radius);
    });
  });

  return positions;
}

export function buildHierarchicalPositions(nodes: NetworkNode[]) {
  if (nodes.length === 0) return {} as PositionMap;

  const sorted = sortNodesByPriority(
    nodes,
    (node) =>
      node.outDegree * 2.4 +
      node.degree * 0.35 -
      node.inDegree * 0.45 +
      (node.isTF ? 2 : 0),
    (a, b) => {
      if (b.outDegree !== a.outDegree) return b.outDegree - a.outDegree;
      if (b.degree !== a.degree) return b.degree - a.degree;
      return 0;
    }
  );

  const levelSizes: number[] = [];
  let remaining = sorted.length;
  let currentLevelSize = 1;

  while (remaining > 0) {
    if (remaining <= currentLevelSize + 1 && levelSizes.length > 0) {
      levelSizes[levelSizes.length - 1] += remaining;
      remaining = 0;
      break;
    }

    const take = Math.min(currentLevelSize, remaining);
    levelSizes.push(take);
    remaining -= take;
    currentLevelSize += 2;
  }

  const levels: NetworkNode[][] = [];
  let offset = 0;
  levelSizes.forEach((size) => {
    levels.push(sorted.slice(offset, offset + size));
    offset += size;
  });

  const positions: PositionMap = {};
  const rowGap = 150;
  const topColumnGap = 165;
  const bottomColumnGap = 135;
  const totalHeight = (levels.length - 1) * rowGap;

  levels.forEach((level, levelIndex) => {
    const orderedLevel = [...level].sort((a, b) => {
      const diff = compareByDegreeThenOutDegree(a, b);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

    const widthRatio = levels.length <= 1 ? 1 : levelIndex / (levels.length - 1);
    const columnGap =
      topColumnGap - (topColumnGap - bottomColumnGap) * widthRatio;
    const rowWidth = Math.max(0, (orderedLevel.length - 1) * columnGap);
    const startX = -rowWidth / 2;
    const y = levelIndex * rowGap - totalHeight / 2;
    const staggerOffset = levelIndex % 2 === 0 ? 0 : columnGap * 0.35;

    orderedLevel.forEach((node, nodeIndex) => {
      positions[node.id] = {
        x: startX + nodeIndex * columnGap + staggerOffset,
        y,
      };
    });
  });

  return positions;
}

export function getLayoutConfig(
  layout: NetworkLayoutMode,
  graphCounts: GraphCounts,
  hierarchicalPositions?: PositionMap,
  concentricPositions?: PositionMap,
  circularPositions?: PositionMap
) {
  if (layout === "hierarchical") {
    return {
      name: "preset",
      animate: false,
      fit: true,
      padding: 56,
      positions: hierarchicalPositions ?? {},
    } as const;
  }

  if (layout === "concentric") {
    return {
      name: "preset",
      animate: false,
      fit: true,
      padding: 56,
      positions: concentricPositions ?? {},
    } as const;
  }

  if (layout === "circular") {
    return {
      name: "preset",
      animate: false,
      fit: true,
      padding: 56,
      positions: circularPositions ?? {},
    } as const;
  }

  const isSparseGraph = graphCounts.edgeCount <= graphCounts.nodeCount * 1.5;
  const edgesPerNode = graphCounts.edgeCount / Math.max(graphCounts.nodeCount, 1);
  const densityFactor = isSparseGraph
    ? 0.82
    : Math.max(0.68, Math.min(1.2, edgesPerNode / 2));
  const componentSpacing = isSparseGraph ? 4 : 32;

  return {
    name: "cose-bilkent",
    animate: false,
    randomize: false,
    fit: true,
    padding: isSparseGraph ? 34 : 48,
    nodeRepulsion: isSparseGraph ? 7200 : 7200 * densityFactor,
    idealEdgeLength: isSparseGraph ? 88 : 82 * densityFactor,
    edgeElasticity: isSparseGraph ? 0.3 : 0.22,
    nestingFactor: 1,
    gravity: isSparseGraph ? 1.05 : 0.86,
    gravityRangeCompound: isSparseGraph ? 3.2 : 2.4,
    componentSpacing,
    tilingPaddingVertical: isSparseGraph ? 2 : 18,
    tilingPaddingHorizontal: isSparseGraph ? 2 : 18,
    numIter: isSparseGraph ? 2200 : 1800,
    tile: true,
  } as const;
}

export function buildGraphElements(
  nodes: NetworkNode[],
  edges: NetworkEdge[]
) {
  const maxSupportCount = Math.max(...edges.map((edge) => edge.count), 1);

  const elements = [
    ...nodes.map((node) => ({
      data: {
        id: node.id,
        label: node.id.length > 10 ? `${node.id.slice(0, 9)}…` : node.id,
        degree: node.degree,
        inDegree: node.inDegree,
        outDegree: node.outDegree,
        isTF: node.isTF ? 1 : 0,
      },
    })),
    ...edges.map((edge) => ({
      data: {
        id: edge.key,
        source: edge.source,
        target: edge.target,
        score: edge.score,
        count: edge.count,
        rank: edge.rank,
        supportRatio: maxSupportCount <= 1 ? 1 : edge.count / maxSupportCount,
        supportingAlgorithms: edge.supportingAlgorithms,
      },
    })),
  ];

  const elementsSignature = JSON.stringify({
    nodes: nodes.map((node) => ({
      id: node.id,
      inDegree: node.inDegree,
      outDegree: node.outDegree,
      degree: node.degree,
      isTF: node.isTF,
    })),
    edges: edges.map((edge) => ({
      key: edge.key,
      source: edge.source,
      target: edge.target,
      score: edge.score,
      count: edge.count,
      rank: edge.rank,
    })),
  });

  return { elements, elementsSignature };
}