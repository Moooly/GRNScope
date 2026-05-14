import type {
  GraphCounts,
  NetworkEdge,
  NetworkLayoutMode,
  NetworkNode,
  PositionMap,
} from "./networkGraphTypes";

// ----------------------------------------------------------------------------
// Shared helpers
// ----------------------------------------------------------------------------

function polarPosition(angle: number, radius: number) {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

type DirectedAdjacency = {
  // node id -> set of regulator ids (incoming edges)
  inMap: Map<string, Set<string>>;
  // node id -> set of target ids (outgoing edges)
  outMap: Map<string, Set<string>>;
  // node id -> set of all neighbors (undirected)
  undirected: Map<string, Set<string>>;
};

function buildAdjacency(
  nodes: NetworkNode[],
  edges: NetworkEdge[]
): DirectedAdjacency {
  const inMap = new Map<string, Set<string>>();
  const outMap = new Map<string, Set<string>>();
  const undirected = new Map<string, Set<string>>();

  for (const node of nodes) {
    inMap.set(node.id, new Set());
    outMap.set(node.id, new Set());
    undirected.set(node.id, new Set());
  }

  for (const edge of edges) {
    if (!inMap.has(edge.target) || !outMap.has(edge.source)) continue;
    if (edge.source === edge.target) continue;
    outMap.get(edge.source)!.add(edge.target);
    inMap.get(edge.target)!.add(edge.source);
    undirected.get(edge.source)!.add(edge.target);
    undirected.get(edge.target)!.add(edge.source);
  }

  return { inMap, outMap, undirected };
}

// ----------------------------------------------------------------------------
// Circular layout (edge-aware: barycenter ordering reduces edge crossings)
// ----------------------------------------------------------------------------

export function buildCircularPositions(
  nodes: NetworkNode[],
  edges: NetworkEdge[] = []
): PositionMap {
  if (nodes.length === 0) return {} as PositionMap;

  const { undirected } = buildAdjacency(nodes, edges);

  // Initial ordering: TFs first, then by degree desc, then alpha for stability
  let order: string[] = [...nodes]
    .sort((a, b) => {
      if (a.isTF !== b.isTF) return a.isTF ? -1 : 1;
      if (b.degree !== a.degree) return b.degree - a.degree;
      return a.id.localeCompare(b.id);
    })
    .map((node) => node.id);

  // Iterative barycenter passes. Each node moves toward the average angular
  // position of its neighbors. Three passes is enough to settle small/medium
  // graphs without over-clustering.
  if (edges.length > 0) {
    for (let pass = 0; pass < 3; pass++) {
      const indexById = new Map<string, number>();
      order.forEach((id, idx) => indexById.set(id, idx));

      const scored = order.map((id) => {
        const neighbors = undirected.get(id);
        if (!neighbors || neighbors.size === 0) {
          return { id, score: indexById.get(id) ?? 0 };
        }
        let sum = 0;
        let count = 0;
        for (const neighborId of neighbors) {
          const idx = indexById.get(neighborId);
          if (idx === undefined) continue;
          sum += idx;
          count += 1;
        }
        return { id, score: count === 0 ? indexById.get(id) ?? 0 : sum / count };
      });

      scored.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.id.localeCompare(b.id);
      });
      order = scored.map((item) => item.id);
    }
  }

  // Radius scales with node count so nodes stay roughly the same arc apart
  // regardless of graph size. Each node reserves ~62 px of perimeter
  // (matching the styled node diameter) plus a small gap.
  const minPerimeter = nodes.length * 78;
  const radius = Math.max(160, minPerimeter / (2 * Math.PI));

  const positions: PositionMap = {};
  order.forEach((id, idx) => {
    const angle = -Math.PI / 2 + (idx / order.length) * Math.PI * 2;
    positions[id] = polarPosition(angle, radius);
  });

  return positions;
}

// ----------------------------------------------------------------------------
// Concentric layout (edge-aware: hub at center, ring(s) by degree)
// ----------------------------------------------------------------------------

export function buildConcentricPositions(
  nodes: NetworkNode[],
  edges: NetworkEdge[] = []
): PositionMap {
  if (nodes.length === 0) return {} as PositionMap;

  // Sort by priority: TF status (boost), out-degree (regulators are hubs),
  // total degree, with id tiebreak for stable layouts.
  const sorted = [...nodes].sort((a, b) => {
    const priorityA =
      (a.isTF ? 1000 : 0) + a.outDegree * 3 + a.degree;
    const priorityB =
      (b.isTF ? 1000 : 0) + b.outDegree * 3 + b.degree;
    if (priorityA !== priorityB) return priorityB - priorityA;
    if (b.degree !== a.degree) return b.degree - a.degree;
    return a.id.localeCompare(b.id);
  });

  const positions: PositionMap = {};
  if (sorted.length === 0) return positions;

  // Single hub at center — the highest-priority node.
  const [hub, ...rest] = sorted;
  positions[hub.id] = { x: 0, y: 0 };

  if (rest.length === 0) return positions;

  // Determine ring count based on remaining count. Each ring holds about
  // (2π·radius / nodeSpacing) nodes, with radius growing per ring.
  const nodeSpacing = 78;
  const baseRadius = 140;
  const radiusStep = 110;

  const ringCapacityFor = (ringIndex: number) => {
    const radius = baseRadius + ringIndex * radiusStep;
    return Math.max(6, Math.floor((2 * Math.PI * radius) / nodeSpacing));
  };

  const rings: NetworkNode[][] = [];
  let remaining = rest;
  let ringIndex = 0;
  while (remaining.length > 0) {
    const capacity = ringCapacityFor(ringIndex);
    rings.push(remaining.slice(0, capacity));
    remaining = remaining.slice(capacity);
    ringIndex += 1;
  }

  // If we have edges, order each ring by barycenter relative to inner-ring
  // angular positions. This pulls connected nodes close together so radial
  // edges look cleaner.
  const { undirected } = buildAdjacency(nodes, edges);
  const angleByNode = new Map<string, number>();
  angleByNode.set(hub.id, 0);

  rings.forEach((ringNodes, idx) => {
    const radius = baseRadius + idx * radiusStep;

    // Order based on barycenter of already-placed neighbors
    const ordered =
      edges.length === 0
        ? ringNodes
        : [...ringNodes].sort((a, b) => {
            const baryA = computeAngularBarycenter(a.id, undirected, angleByNode);
            const baryB = computeAngularBarycenter(b.id, undirected, angleByNode);
            if (baryA === null && baryB === null) return 0;
            if (baryA === null) return 1;
            if (baryB === null) return -1;
            return baryA - baryB;
          });

    // Stagger every other ring by half a slot so neighboring rings don't align.
    const rotationOffset =
      -Math.PI / 2 + (idx % 2 === 0 ? 0 : Math.PI / Math.max(ordered.length, 2));

    ordered.forEach((node, nodeIndex) => {
      const angle =
        rotationOffset +
        (nodeIndex / Math.max(ordered.length, 1)) * Math.PI * 2;
      angleByNode.set(node.id, angle);
      positions[node.id] = polarPosition(angle, radius);
    });
  });

  return positions;
}

function computeAngularBarycenter(
  nodeId: string,
  undirected: Map<string, Set<string>>,
  angleByNode: Map<string, number>
): number | null {
  const neighbors = undirected.get(nodeId);
  if (!neighbors || neighbors.size === 0) return null;

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const neighborId of neighbors) {
    const angle = angleByNode.get(neighborId);
    if (angle === undefined) continue;
    sumX += Math.cos(angle);
    sumY += Math.sin(angle);
    count += 1;
  }
  if (count === 0) return null;

  return Math.atan2(sumY / count, sumX / count);
}

// ----------------------------------------------------------------------------
// Hierarchical layout (edge-aware topological layering)
// ----------------------------------------------------------------------------

export function buildHierarchicalPositions(
  nodes: NetworkNode[],
  edges: NetworkEdge[] = []
): PositionMap {
  if (nodes.length === 0) return {} as PositionMap;

  const { inMap, outMap } = buildAdjacency(nodes, edges);

  // Longest-path layering: a node's level is 1 + max(level of its regulators).
  // Nodes that are part of a cycle break it by treating already-visiting
  // ancestors as level 0 (Sugiyama-style cycle handling without full SCC
  // condensation).
  const level = new Map<string, number>();
  const visiting = new Set<string>();

  const computeLevel = (id: string): number => {
    if (level.has(id)) return level.get(id)!;
    if (visiting.has(id)) return 0; // cycle break

    visiting.add(id);
    const regulators = inMap.get(id);
    let maxRegLevel = -1;
    if (regulators) {
      for (const regId of regulators) {
        maxRegLevel = Math.max(maxRegLevel, computeLevel(regId));
      }
    }
    visiting.delete(id);
    const lvl = maxRegLevel + 1;
    level.set(id, lvl);
    return lvl;
  };

  for (const node of nodes) {
    if (!level.has(node.id)) computeLevel(node.id);
  }

  // Group nodes by level
  const levelMap = new Map<number, NetworkNode[]>();
  let maxLevel = 0;
  for (const node of nodes) {
    const lvl = level.get(node.id) ?? 0;
    maxLevel = Math.max(maxLevel, lvl);
    if (!levelMap.has(lvl)) levelMap.set(lvl, []);
    levelMap.get(lvl)!.push(node);
  }

  const sortedLevels: NetworkNode[][] = [];
  for (let i = 0; i <= maxLevel; i++) {
    sortedLevels.push(levelMap.get(i) ?? []);
  }

  // Within each level, order by barycenter of already-placed parents to
  // minimize crossing of inter-level edges. Top level is ordered by
  // out-degree desc as a starting baseline.
  const xPositionById = new Map<string, number>();
  const positions: PositionMap = {};

  const rowGap = 160;
  const minColumnGap = 130;
  const totalHeight = maxLevel * rowGap;

  sortedLevels.forEach((levelNodes, lvl) => {
    let ordered: NetworkNode[];
    if (lvl === 0 || edges.length === 0) {
      ordered = [...levelNodes].sort((a, b) => {
        if (a.isTF !== b.isTF) return a.isTF ? -1 : 1;
        if (b.outDegree !== a.outDegree) return b.outDegree - a.outDegree;
        if (b.degree !== a.degree) return b.degree - a.degree;
        return a.id.localeCompare(b.id);
      });
    } else {
      // Barycenter on parent x-positions
      ordered = [...levelNodes].sort((a, b) => {
        const baryA = computeBarycenter(a.id, inMap, xPositionById);
        const baryB = computeBarycenter(b.id, inMap, xPositionById);
        if (baryA === null && baryB === null) {
          if (b.outDegree !== a.outDegree) return b.outDegree - a.outDegree;
          return a.id.localeCompare(b.id);
        }
        if (baryA === null) return 1;
        if (baryB === null) return -1;
        if (baryA !== baryB) return baryA - baryB;
        return a.id.localeCompare(b.id);
      });
    }

    const columnGap = minColumnGap;
    const rowWidth = Math.max(0, (ordered.length - 1) * columnGap);
    const startX = -rowWidth / 2;
    const y = lvl * rowGap - totalHeight / 2;

    ordered.forEach((node, idx) => {
      const x = startX + idx * columnGap;
      positions[node.id] = { x, y };
      xPositionById.set(node.id, x);
    });
  });

  // A second downward pass pulls children toward their parents' centers.
  // This is a cheap alternative to dot/Sugiyama post-layout straightening.
  for (let lvl = 1; lvl <= maxLevel; lvl++) {
    const levelNodes = sortedLevels[lvl];
    if (!levelNodes || levelNodes.length === 0) continue;

    const sortedByBary = [...levelNodes].sort((a, b) => {
      const baryA = computeBarycenter(a.id, inMap, xPositionById);
      const baryB = computeBarycenter(b.id, inMap, xPositionById);
      if (baryA === null && baryB === null) return 0;
      if (baryA === null) return 1;
      if (baryB === null) return -1;
      return baryA - baryB;
    });

    const columnGap = minColumnGap;
    const rowWidth = Math.max(0, (sortedByBary.length - 1) * columnGap);
    const startX = -rowWidth / 2;
    const y = lvl * rowGap - totalHeight / 2;

    sortedByBary.forEach((node, idx) => {
      const x = startX + idx * columnGap;
      positions[node.id] = { x, y };
      xPositionById.set(node.id, x);
    });
  }

  // Disconnected isolates that ended up alone at level 0 get tucked to the
  // side so they don't visually "lead" the hierarchy. We move any level-0
  // node with no out-edges and no in-edges to a special bottom row.
  const isolatedNodes = nodes.filter(
    (node) =>
      (outMap.get(node.id)?.size ?? 0) === 0 &&
      (inMap.get(node.id)?.size ?? 0) === 0
  );
  if (isolatedNodes.length > 0) {
    const isolatedRowY = totalHeight / 2 + rowGap;
    const columnGap = minColumnGap;
    const rowWidth = Math.max(0, (isolatedNodes.length - 1) * columnGap);
    const startX = -rowWidth / 2;
    isolatedNodes.forEach((node, idx) => {
      positions[node.id] = { x: startX + idx * columnGap, y: isolatedRowY };
    });
  }

  return positions;
}

function computeBarycenter(
  nodeId: string,
  parents: Map<string, Set<string>>,
  xPositionById: Map<string, number>
): number | null {
  const parentSet = parents.get(nodeId);
  if (!parentSet || parentSet.size === 0) return null;
  let sum = 0;
  let count = 0;
  for (const parentId of parentSet) {
    const x = xPositionById.get(parentId);
    if (x === undefined) continue;
    sum += x;
    count += 1;
  }
  if (count === 0) return null;
  return sum / count;
}

// ----------------------------------------------------------------------------
// Force-directed layout config (cose-bilkent, edge-aware via the layout itself)
// ----------------------------------------------------------------------------

export function getLayoutConfig(
  layout: NetworkLayoutMode,
  graphCounts: GraphCounts,
  nodes: NetworkNode[] = [],
  edges: NetworkEdge[] = [],
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

  // Force-directed (cose-bilkent). Tune parameters based on graph size,
  // hub pressure, and the evidence profile of the visible edges.
  const isSparseGraph =
    graphCounts.edgeCount <= graphCounts.nodeCount * 1.5;
  const edgesPerNode =
    graphCounts.edgeCount / Math.max(graphCounts.nodeCount, 1);
  const maxDegree = Math.max(...nodes.map((node) => node.degree), 1);
  const hubRatio = maxDegree / Math.max(graphCounts.nodeCount, 1);
  const evidenceValues = edges
    .map((edge) => Number(edge.confidence ?? edge.score))
    .filter((score) => Number.isFinite(score));
  const meanEvidence =
    evidenceValues.length > 0
      ? evidenceValues.reduce((sum, score) => sum + score, 0) /
        evidenceValues.length
      : 0.8;
  const nodeScale = Math.max(1, Math.min(2.15, Math.sqrt(graphCounts.nodeCount / 18)));
  const hubRepulsionBoost = 1 + Math.min(0.72, hubRatio * 1.9);
  const densityRepulsionBoost = Math.max(1, Math.min(1.34, edgesPerNode / 2.4));
  const baseRepulsion = isSparseGraph ? 8600 : 9400;
  const evidenceLengthFactor = meanEvidence >= 0.86 ? 0.94 : 1.08;
  const componentSpacing = isSparseGraph ? 72 : 96;

  return {
    name: "cose-bilkent",
    quality: graphCounts.nodeCount <= 80 ? "proof" : "default",
    animate: false,
    nodeDimensionsIncludeLabels: true,
    // randomize is decided by the caller based on whether positions exist; the
    // base config defaults to false so existing positions are kept.
    randomize: false,
    fit: true,
    padding: isSparseGraph ? 42 : 56,
    nodeRepulsion: Math.round(
      baseRepulsion * nodeScale * hubRepulsionBoost * densityRepulsionBoost
    ),
    idealEdgeLength: Math.round(
      (isSparseGraph ? 118 : 108) *
        (1 + Math.min(0.28, hubRatio)) *
        evidenceLengthFactor
    ),
    edgeElasticity: isSparseGraph ? 0.28 : 0.2,
    nestingFactor: 0.95,
    gravity: isSparseGraph ? 0.72 : 0.58,
    gravityRange: isSparseGraph ? 4.8 : 4.2,
    gravityRangeCompound: isSparseGraph ? 3.8 : 3.1,
    componentSpacing,
    tilingPaddingVertical: isSparseGraph ? 26 : 34,
    tilingPaddingHorizontal: isSparseGraph ? 26 : 34,
    numIter: isSparseGraph ? 3200 : 2800,
    initialEnergyOnIncremental: 0.38,
    tile: true,
  } as const;
}

// ----------------------------------------------------------------------------
// Element building & change-detection signature
// ----------------------------------------------------------------------------

export function buildGraphElements(
  nodes: NetworkNode[],
  edges: NetworkEdge[]
) {
  const maxSupportCount = Math.max(...edges.map((edge) => edge.count), 1);
  const edgeScores = edges
    .map((edge) => Number(edge.score))
    .filter((score) => Number.isFinite(score));
  const minEdgeScore = edgeScores.length > 0 ? Math.min(...edgeScores) : 0;
  const maxEdgeScore = edgeScores.length > 0 ? Math.max(...edgeScores) : 1;
  const edgeScoreRange = maxEdgeScore - minEdgeScore;

  const getVisualScore = (score: number) => {
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore)) return 0;
    if (edgeScoreRange === 0) return 1;
    return Math.max(
      0,
      Math.min(1, (numericScore - minEdgeScore) / edgeScoreRange)
    );
  };

  const getEdgeColor = () => "#64748b";

  const getRelationshipShape = (edge: NetworkEdge) => {
    if (edge.direction === 0 || edge.directionCoverage <= 0) return "none";
    if (edge.directionConfidence === null) return "none";
    if (edge.signConfidence === null || edge.sign === 0 || edge.signCoverage === 0) {
      return "none";
    }

    return edge.sign > 0 ? "triangle" : "tee";
  };

  const getEndpointDistance = (shape: string) => {
    if (shape === "tee") return 6;
    if (shape === "triangle") return 2;
    return 0;
  };

  const directedPairs = new Set(
    edges.map((edge) => `${edge.source}|||${edge.target}`)
  );

  const hasReciprocalEdge = (edge: NetworkEdge) =>
    directedPairs.has(`${edge.target}|||${edge.source}`);

  const getEffectiveDirection = (edge: NetworkEdge, hasReciprocal: boolean) => {
    // If both A->B and B->A survived the filters, show them as true reciprocal
    // edges instead of letting low-confidence direction inference collapse them
    // onto the same visual direction.
    if (hasReciprocal) return 1;
    return edge.direction;
  };

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
    ...edges.map((edge) => {
      const hasReciprocal = hasReciprocalEdge(edge);
      const effectiveDirection = getEffectiveDirection(edge, hasReciprocal);
      const displaySource = effectiveDirection === -1 ? edge.target : edge.source;
      const displayTarget = effectiveDirection === -1 ? edge.source : edge.target;
      const sourceArrowShape =
        effectiveDirection === -1 ? getRelationshipShape(edge) : "none";
      const targetArrowShape =
        effectiveDirection === 1 ? getRelationshipShape(edge) : "none";

      return {
        classes: hasReciprocal ? "reciprocal" : undefined,
        data: {
          id: edge.key,
          source: edge.source,
          target: edge.target,
          displaySource,
          displayTarget,
          score: edge.score,
          confidence: edge.confidence,
          visualScore: getVisualScore(edge.score),
          edgeColor: getEdgeColor(),
          sourceArrowShape,
          targetArrowShape,
          sourceDistanceFromNode: getEndpointDistance(sourceArrowShape),
          targetDistanceFromNode: getEndpointDistance(targetArrowShape),
          controlPointDistance: hasReciprocal ? 34 : 0,
          controlPointWeight: 0.5,
          arrowFill: "filled",
          count: edge.count,
          rank: edge.rank,
          supportRatio:
            maxSupportCount <= 1 ? 1 : edge.count / maxSupportCount,
          supportingAlgorithms: edge.supportingAlgorithms,
          directionConfidence: edge.directionConfidence,
          directionCoverage: edge.directionCoverage,
          sign: edge.sign,
          signConfidence: edge.signConfidence,
          signCoverage: edge.signCoverage,
        },
      };
    }),
  ];

  // Include score/sign annotations so threshold and consensus changes update
  // visual encodings even when the visible edge identities stay the same.
  const elementsSignature =
    nodes
      .map((node) => `${node.id}/${node.isTF ? 1 : 0}`)
      .sort()
      .join(",") +
    "|" +
    edges
      .map(
        (edge) =>
          `${edge.key}/${edge.score.toFixed(6)}/${edge.confidence.toFixed(6)}/${edge.count}/${edge.direction}/${edge.directionCoverage.toFixed(4)}/${edge.sign}/${edge.signConfidence?.toFixed(4) ?? "na"}`
      )
      .sort()
      .join(",");

  return { elements, elementsSignature };
}
