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

export function isDenseNetwork(nodeCount: number, edgeCount: number) {
  if (nodeCount <= 0) return false;
  return edgeCount > 60 || edgeCount / nodeCount > 3;
}

function edgeEvidence(edge: NetworkEdge) {
  const score = Number(edge.confidence ?? edge.score);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

function nodePriority(node: NetworkNode) {
  return (node.isTF ? 1000 : 0) + node.outDegree * 4 + node.degree;
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

function buildWeightedUndirectedAdjacency(
  nodes: NetworkNode[],
  edges: NetworkEdge[]
) {
  const adjacency = new Map<string, Map<string, number>>();

  for (const node of nodes) {
    adjacency.set(node.id, new Map());
  }

  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    if (edge.source === edge.target) continue;

    const weight = 0.35 + edgeEvidence(edge) * 0.65;
    const sourceNeighbors = adjacency.get(edge.source)!;
    const targetNeighbors = adjacency.get(edge.target)!;

    sourceNeighbors.set(
      edge.target,
      Math.max(sourceNeighbors.get(edge.target) ?? 0, weight)
    );
    targetNeighbors.set(
      edge.source,
      Math.max(targetNeighbors.get(edge.source) ?? 0, weight)
    );
  }

  return adjacency;
}

function connectedComponents(
  nodes: NetworkNode[],
  undirected: Map<string, Set<string>>
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const components: NetworkNode[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;

    const component: NetworkNode[] = [];
    const stack = [node.id];
    visited.add(node.id);

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      const currentNode = nodeById.get(currentId);
      if (currentNode) component.push(currentNode);

      for (const neighborId of undirected.get(currentId) ?? []) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        stack.push(neighborId);
      }
    }

    components.push(component);
  }

  return components.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const priorityA = Math.max(...a.map(nodePriority), 0);
    const priorityB = Math.max(...b.map(nodePriority), 0);
    if (priorityA !== priorityB) return priorityB - priorityA;
    return a[0]?.id.localeCompare(b[0]?.id ?? "") ?? 0;
  });
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
  const weightedUndirected = buildWeightedUndirectedAdjacency(nodes, edges);
  const components = connectedComponents(nodes, undirected);
  const densityScale = isDenseNetwork(nodes.length, edges.length) ? 1.28 : 1;

  // Initial ordering: keep connected components contiguous, then sort inside
  // each component by biological/graph priority. This avoids small detached
  // motifs being interleaved through the main ring.
  let order: string[] = components.flatMap((component) =>
    [...component]
      .sort((a, b) => {
        const priorityDelta = nodePriority(b) - nodePriority(a);
        if (priorityDelta !== 0) return priorityDelta;
        return a.id.localeCompare(b.id);
      })
      .map((node) => node.id)
  );

  // Iterative barycenter passes. Each node moves toward the average angular
  // position of its neighbors. Edge evidence is used as the weight so strong
  // relationships stay visually close on the ring.
  if (edges.length > 0) {
    for (let pass = 0; pass < 5; pass++) {
      const indexById = new Map<string, number>();
      order.forEach((id, idx) => indexById.set(id, idx));

      const scored = order.map((id) => {
        const neighbors = weightedUndirected.get(id);
        if (!neighbors || neighbors.size === 0) {
          return { id, score: indexById.get(id) ?? 0 };
        }
        let sum = 0;
        let totalWeight = 0;
        for (const [neighborId, weight] of neighbors) {
          const idx = indexById.get(neighborId);
          if (idx === undefined) continue;
          sum += idx * weight;
          totalWeight += weight;
        }
        return {
          id,
          score:
            totalWeight === 0 ? indexById.get(id) ?? 0 : sum / totalWeight,
        };
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
  const componentGapSlots = Math.max(0, components.length - 1) * 0.85;
  const minPerimeter = (nodes.length + componentGapSlots) * 90 * densityScale;
  const radius = Math.max(190, minPerimeter / (2 * Math.PI));
  const componentBreaks = new Set<string>();
  let offset = 0;
  for (const component of components.slice(0, -1)) {
    offset += component.length;
    const nextId = order[offset];
    if (nextId) componentBreaks.add(nextId);
  }

  const positions: PositionMap = {};

  if (nodes.length > 90) {
    const ringCount = Math.min(4, Math.max(2, Math.ceil(nodes.length / 48)));
    const perRing = Math.ceil(order.length / ringCount);
    const baseRadius = 185;
    const radiusStep = 132;

    for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
      const ringIds = order.slice(ringIndex * perRing, (ringIndex + 1) * perRing);
      const radius = baseRadius + ringIndex * radiusStep;
      const ringOffset =
        ringIndex % 2 === 0 ? 0 : Math.PI / Math.max(ringIds.length, 2);

      ringIds.forEach((id, idx) => {
        const angle =
          -Math.PI / 2 +
          ringOffset +
          (idx / Math.max(ringIds.length, 1)) * Math.PI * 2;
        positions[id] = polarPosition(angle, radius);
      });
    }

    return positions;
  }

  let gapOffset = 0;
  order.forEach((id, idx) => {
    if (componentBreaks.has(id)) gapOffset += 0.85;
    const slot = idx + gapOffset;
    const totalSlots = Math.max(order.length + componentGapSlots, 1);
    const angle = -Math.PI / 2 + (slot / totalSlots) * Math.PI * 2;
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

  // Rank by hubness. nodePriority() weights TF status at 1000, which for a view
  // called "Hubs" swamps the thing being shown -- a degree-9 target ranked below
  // a degree-1 TF. Here TF only breaks ties between similarly connected genes.
  const hubScore = (node: NetworkNode) =>
    node.degree + node.outDegree * 0.6 + (node.isTF ? 1.5 : 0);

  const sorted = [...nodes].sort((a, b) => {
    const scoreDelta = hubScore(b) - hubScore(a);
    if (scoreDelta !== 0) return scoreDelta;
    if (b.degree !== a.degree) return b.degree - a.degree;
    return a.id.localeCompare(b.id);
  });

  const positions: PositionMap = {};
  if (sorted.length === 0) return positions;

  const densityScale = isDenseNetwork(nodes.length, edges.length) ? 1.28 : 1;
  const nodeSpacing = 92 * densityScale;
  const coreRadius = 82 * densityScale;
  const baseRadius = 190 * densityScale;
  const radiusStep = 118 * densityScale;
  const radiusFor = (ringIndex: number) =>
    ringIndex === 0 ? coreRadius : baseRadius + (ringIndex - 1) * radiusStep;
  const capacityFor = (ringIndex: number) =>
    Math.max(3, Math.floor((2 * Math.PI * radiusFor(ringIndex)) / nodeSpacing));

  // Ring sizes grow linearly outward (1:2:3...), so hubness actually decreases
  // with radius. Filling purely by circumference let one ring swallow 14 of 19
  // nodes and flattened the gradient the layout exists to show.
  const ringCount = Math.max(
    2,
    Math.min(5, Math.round(Math.sqrt(sorted.length / 2)))
  );
  const weightTotal = (ringCount * (ringCount + 1)) / 2;
  const targets: number[] = [];
  let allocated = 0;
  for (let index = 0; index < ringCount; index += 1) {
    const share = Math.max(
      1,
      Math.round(((index + 1) / weightTotal) * sorted.length)
    );
    targets.push(Math.min(share, capacityFor(index)));
    allocated += targets[index];
  }
  // Push any shortfall or excess onto the outermost ring, which has the room.
  targets[ringCount - 1] += sorted.length - allocated;
  if (targets[ringCount - 1] < 0) targets[ringCount - 1] = 0;

  const ringGroups: NetworkNode[][] = [];
  let cursor = 0;
  for (let index = 0; index < ringCount; index += 1) {
    const take = index === ringCount - 1 ? sorted.length - cursor : targets[index];
    ringGroups.push(sorted.slice(cursor, cursor + Math.max(0, take)));
    cursor += Math.max(0, take);
  }

  const coreNodes = ringGroups[0] ?? [];
  if (coreNodes.length === 1) {
    positions[coreNodes[0].id] = { x: 0, y: 0 };
  } else {
    coreNodes.forEach((node, idx) => {
      const angle = -Math.PI / 2 + (idx / Math.max(coreNodes.length, 1)) * Math.PI * 2;
      positions[node.id] = polarPosition(angle, coreRadius);
    });
  }

  const rings = ringGroups.slice(1).filter((ring) => ring.length > 0);
  if (rings.length === 0) return positions;

  // If we have edges, order each ring by barycenter relative to inner-ring
  // angular positions. This pulls connected nodes close together so radial
  // edges look cleaner.
  const { undirected } = buildAdjacency(nodes, edges);
  const angleByNode = new Map<string, number>();
  coreNodes.forEach((node) => {
    const position = positions[node.id];
    if (!position) return;
    angleByNode.set(node.id, Math.atan2(position.y, position.x));
  });

  rings.forEach((ringNodes, idx) => {
    const radius = radiusFor(idx + 1);

    // Order based on barycenter of already-placed neighbors
    const ordered =
      edges.length === 0
        ? ringNodes
        : [...ringNodes].sort((a, b) => {
            const baryA = computeAngularBarycenter(a.id, undirected, angleByNode);
            const baryB = computeAngularBarycenter(b.id, undirected, angleByNode);
            if (baryA === null && baryB === null) {
              const priorityDelta = nodePriority(b) - nodePriority(a);
              if (priorityDelta !== 0) return priorityDelta;
              return a.id.localeCompare(b.id);
            }
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

/**
 * Tarjan's strongly connected components, emitted in reverse topological order
 * of the condensation DAG.
 */
function stronglyConnectedComponents(
  nodes: NetworkNode[],
  outMap: Map<string, Set<string>>
): string[][] {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const strongConnect = (start: string) => {
    // Iterative so a deep chain cannot overflow the call stack.
    const work: Array<{ id: string; next: string[]; cursor: number }> = [];
    index.set(start, counter);
    lowLink.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);
    work.push({ id: start, next: [...(outMap.get(start) ?? [])], cursor: 0 });

    while (work.length) {
      const frame = work[work.length - 1];
      if (frame.cursor < frame.next.length) {
        const child = frame.next[frame.cursor];
        frame.cursor += 1;
        if (!index.has(child)) {
          index.set(child, counter);
          lowLink.set(child, counter);
          counter += 1;
          stack.push(child);
          onStack.add(child);
          work.push({
            id: child,
            next: [...(outMap.get(child) ?? [])],
            cursor: 0,
          });
        } else if (onStack.has(child)) {
          lowLink.set(
            frame.id,
            Math.min(lowLink.get(frame.id)!, index.get(child)!)
          );
        }
        continue;
      }

      work.pop();
      if (work.length) {
        const parent = work[work.length - 1];
        lowLink.set(
          parent.id,
          Math.min(lowLink.get(parent.id)!, lowLink.get(frame.id)!)
        );
      }
      if (lowLink.get(frame.id) === index.get(frame.id)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.id);
        components.push(component);
      }
    }
  };

  for (const node of nodes) {
    if (!index.has(node.id)) strongConnect(node.id);
  }
  return components;
}

/** Node diameter (62) plus breathing room, so a row can never self-overlap. */
const HIERARCHY_MIN_NODE_GAP = 86;

export function buildHierarchicalPositions(
  nodes: NetworkNode[],
  edges: NetworkEdge[] = []
): PositionMap {
  if (nodes.length === 0) return {} as PositionMap;

  const { inMap, outMap, undirected } = buildAdjacency(nodes, edges);
  const densityScale = isDenseNetwork(nodes.length, edges.length) ? 1.18 : 1;

  // Layer the condensation of the strongly connected components rather than the
  // raw graph. Longest-path layering on a cyclic graph gives every node its own
  // level -- on a 19-node/60-edge network that produced 15 levels and a frame
  // 218px wide by 3026px tall. Collapsing each cycle to one vertex keeps mutually
  // regulating genes on a shared level and makes the depth the real hierarchy.
  const components = stronglyConnectedComponents(nodes, outMap);
  const componentOf = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    for (const id of component) componentOf.set(id, componentIndex);
  });

  const componentIn = new Map<number, Set<number>>();
  for (const node of nodes) {
    const from = componentOf.get(node.id);
    if (from === undefined) continue;
    for (const targetId of outMap.get(node.id) ?? []) {
      const to = componentOf.get(targetId);
      if (to === undefined || to === from) continue;
      if (!componentIn.has(to)) componentIn.set(to, new Set());
      componentIn.get(to)!.add(from);
    }
  }

  // Tarjan emits components in reverse topological order, so walking backwards
  // visits every predecessor before its successors -- no recursion needed.
  const componentLevel = new Map<number, number>();
  for (let index = components.length - 1; index >= 0; index -= 1) {
    let maxPredecessor = -1;
    for (const predecessor of componentIn.get(index) ?? []) {
      maxPredecessor = Math.max(
        maxPredecessor,
        componentLevel.get(predecessor) ?? 0,
      );
    }
    componentLevel.set(index, maxPredecessor + 1);
  }

  const level = new Map<string, number>();
  for (const node of nodes) {
    const componentIndex = componentOf.get(node.id);
    level.set(
      node.id,
      componentIndex === undefined
        ? 0
        : (componentLevel.get(componentIndex) ?? 0),
    );
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

  const maxLevelWidth = Math.max(...sortedLevels.map((levelNodes) => levelNodes.length), 1);
  const crowdedLevelColumnCap =
    nodes.length > 120 ? 12 : nodes.length > 70 ? 14 : 16;
  const adaptiveLevelColumns =
    maxLevelWidth <= 14
      ? maxLevelWidth
      : Math.ceil(Math.sqrt(maxLevelWidth) * 2.1);
  const maxColumnsPerLevel = Math.max(
    8,
    Math.min(crowdedLevelColumnCap, adaptiveLevelColumns)
  );
  const rowGap = Math.round(
    Math.max(190, Math.min(270, 168 + Math.sqrt(nodes.length) * 10)) *
      densityScale
  );
  const wrappedRowGap = Math.round(
    Math.max(134, Math.min(176, 120 + Math.sqrt(nodes.length) * 4)) *
      densityScale
  );
  const minColumnGap = Math.round(
    Math.max(
      nodes.length > 80 ? 128 : 142,
      Math.min(
        nodes.length > 80 ? 168 : 205,
        122 + Math.sqrt(edges.length + maxLevelWidth) * 9
      )
    ) * densityScale
  );
  const rowsPerLevel = sortedLevels.map((levelNodes) =>
    Math.max(1, Math.ceil(levelNodes.length / maxColumnsPerLevel))
  );
  const levelCenters: number[] = [];
  let levelCursorY = 0;

  rowsPerLevel.forEach((rowCount, lvl) => {
    const levelHeight = Math.max(0, (rowCount - 1) * wrappedRowGap);
    levelCenters[lvl] = levelCursorY + levelHeight / 2;
    levelCursorY += levelHeight + rowGap;
  });

  const totalHeight = Math.max(0, levelCursorY - rowGap);

  const placeOrderedLevel = (
    ordered: NetworkNode[],
    lvl: number,
    resolveX?: (node: NetworkNode, orderedX: number) => number
  ) => {
    const rowCount = Math.max(1, Math.ceil(ordered.length / maxColumnsPerLevel));
    const centerY = (levelCenters[lvl] ?? 0) - totalHeight / 2;

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const rowNodes = ordered.slice(
        rowIndex * maxColumnsPerLevel,
        (rowIndex + 1) * maxColumnsPerLevel
      );
      const rowWidth = Math.max(0, (rowNodes.length - 1) * minColumnGap);
      const startX = -rowWidth / 2;
      const y = centerY + (rowIndex - (rowCount - 1) / 2) * wrappedRowGap;

      // The barycenter passes pull nodes toward their neighbours' centres, which
      // can drag two nodes on top of each other. Lay the row out, then sweep
      // left-to-right enforcing a minimum gap so a pull can never overlap them.
      const placed = rowNodes.map((node, idx) => {
        const orderedX = startX + idx * minColumnGap;
        return { node, x: resolveX ? resolveX(node, orderedX) : orderedX };
      });
      placed.sort((first, second) => first.x - second.x);
      for (let index = 1; index < placed.length; index += 1) {
        const gap = placed[index].x - placed[index - 1].x;
        if (gap < HIERARCHY_MIN_NODE_GAP) {
          placed[index].x = placed[index - 1].x + HIERARCHY_MIN_NODE_GAP;
        }
      }
      if (placed.length > 1) {
        // Re-centre so the separation sweep does not drift the row off-axis.
        const drift = (placed[0].x + placed[placed.length - 1].x) / 2;
        for (const entry of placed) entry.x -= drift;
      }
      for (const entry of placed) {
        positions[entry.node.id] = { x: entry.x, y };
        xPositionById.set(entry.node.id, entry.x);
      }
    }
  };

  sortedLevels.forEach((levelNodes, lvl) => {
    let ordered: NetworkNode[];
    if (lvl === 0 || edges.length === 0) {
      ordered = [...levelNodes].sort((a, b) => {
        if (a.isTF !== b.isTF) return a.isTF ? -1 : 1;
        const priorityDelta = nodePriority(b) - nodePriority(a);
        if (priorityDelta !== 0) return priorityDelta;
        if (b.degree !== a.degree) return b.degree - a.degree;
        return a.id.localeCompare(b.id);
      });
    } else {
      // Barycenter on parent x-positions
      ordered = [...levelNodes].sort((a, b) => {
        const baryA = computeBarycenter(a.id, inMap, xPositionById);
        const baryB = computeBarycenter(b.id, inMap, xPositionById);
        if (baryA === null && baryB === null) {
          const priorityDelta = nodePriority(b) - nodePriority(a);
          if (priorityDelta !== 0) return priorityDelta;
          return a.id.localeCompare(b.id);
        }
        if (baryA === null) return 1;
        if (baryB === null) return -1;
        if (baryA !== baryB) return baryA - baryB;
        return a.id.localeCompare(b.id);
      });
    }

    placeOrderedLevel(ordered, lvl);
  });

  // A second downward pass pulls children toward their parents' centers.
  // This is a cheap alternative to dot/Sugiyama post-layout straightening.
  for (let lvl = 1; lvl <= maxLevel; lvl++) {
    const levelNodes = sortedLevels[lvl];
    if (!levelNodes || levelNodes.length === 0) continue;

    const sortedByBary = [...levelNodes].sort((a, b) => {
      const baryA = computeBarycenter(a.id, inMap, xPositionById);
      const baryB = computeBarycenter(b.id, inMap, xPositionById);
      if (baryA === null && baryB === null) {
        const priorityDelta = nodePriority(b) - nodePriority(a);
        if (priorityDelta !== 0) return priorityDelta;
        return a.id.localeCompare(b.id);
      }
      if (baryA === null) return 1;
      if (baryB === null) return -1;
      return baryA - baryB;
    });

    placeOrderedLevel(sortedByBary, lvl);
  }

  // Upward pass: pull regulators toward the center of their placed targets.
  // This reduces the long diagonal sweeps that can appear when a regulator has
  // many downstream targets spread across a wide row.
  for (let lvl = maxLevel - 1; lvl >= 0; lvl--) {
    const levelNodes = sortedLevels[lvl];
    if (!levelNodes || levelNodes.length === 0) continue;

    const sortedByChildren = [...levelNodes].sort((a, b) => {
      const baryA = computeBarycenter(a.id, outMap, xPositionById);
      const baryB = computeBarycenter(b.id, outMap, xPositionById);
      if (baryA === null && baryB === null) {
        const priorityDelta = nodePriority(b) - nodePriority(a);
        if (priorityDelta !== 0) return priorityDelta;
        return a.id.localeCompare(b.id);
      }
      if (baryA === null) return 1;
      if (baryB === null) return -1;
      return baryA - baryB;
    });

    placeOrderedLevel(sortedByChildren, lvl, (node, orderedX) => {
      const childBarycenter = computeBarycenter(node.id, outMap, xPositionById);
      return childBarycenter === null
        ? orderedX
        : orderedX * 0.55 + childBarycenter * 0.45;
    });
  }

  // Same-level pass. After SCC condensation a whole cycle shares one level, so a
  // large cluster can put 40%+ of all edges flat across one row. Ordering those
  // members by the barycenter of their *same-level* neighbours shortens those
  // horizontal runs; the parent/child passes above ignore them entirely.
  for (let lvl = 0; lvl <= maxLevel; lvl++) {
    const levelNodes = sortedLevels[lvl];
    if (!levelNodes || levelNodes.length < 3) continue;

    const levelIds = new Set(levelNodes.map((node) => node.id));
    const sameLevelNeighbours = new Map<string, Set<string>>();
    let sameLevelEdgeCount = 0;
    for (const node of levelNodes) {
      const peers = new Set<string>();
      for (const neighbourId of undirected.get(node.id) ?? []) {
        if (levelIds.has(neighbourId)) peers.add(neighbourId);
      }
      sameLevelEdgeCount += peers.size;
      sameLevelNeighbours.set(node.id, peers);
    }
    if (sameLevelEdgeCount === 0) continue;

    // A few sweeps: order by the mean x of same-level neighbours, re-place, repeat.
    for (let sweep = 0; sweep < 3; sweep += 1) {
      const ordered = [...levelNodes].sort((a, b) => {
        const baryA = computeBarycenter(a.id, sameLevelNeighbours, xPositionById);
        const baryB = computeBarycenter(b.id, sameLevelNeighbours, xPositionById);
        if (baryA === null && baryB === null) {
          const parentA = computeBarycenter(a.id, inMap, xPositionById);
          const parentB = computeBarycenter(b.id, inMap, xPositionById);
          if (parentA !== null && parentB !== null) return parentA - parentB;
          return a.id.localeCompare(b.id);
        }
        if (baryA === null) return 1;
        if (baryB === null) return -1;
        return baryA - baryB;
      });
      placeOrderedLevel(ordered, lvl);
    }
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
  const isDenseGraph = isDenseNetwork(
    graphCounts.nodeCount,
    graphCounts.edgeCount
  );
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
  const densityRepulsionBoost = isDenseGraph
    ? Math.max(1.45, Math.min(1.82, edgesPerNode / 3.8))
    : Math.max(1, Math.min(1.34, edgesPerNode / 2.4));
  const baseRepulsion = isSparseGraph ? 8600 : isDenseGraph ? 9800 : 9400;
  const evidenceLengthFactor = meanEvidence >= 0.86 ? 0.94 : 1.08;
  const componentSpacing = isSparseGraph ? 72 : isDenseGraph ? 118 : 96;

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
      (isSparseGraph ? 118 : isDenseGraph ? 148 : 108) *
        (1 + Math.min(0.28, hubRatio)) *
        evidenceLengthFactor
    ),
    edgeElasticity: isSparseGraph ? 0.28 : isDenseGraph ? 0.12 : 0.2,
    nestingFactor: 0.95,
    gravity: isSparseGraph ? 0.72 : isDenseGraph ? 0.42 : 0.58,
    gravityRange: isSparseGraph ? 4.8 : 4.2,
    gravityRangeCompound: isSparseGraph ? 3.8 : 3.1,
    componentSpacing,
    tilingPaddingVertical: isSparseGraph ? 26 : 34,
    tilingPaddingHorizontal: isSparseGraph ? 26 : 34,
    numIter: isSparseGraph ? 3200 : isDenseGraph ? 3400 : 2800,
    initialEnergyOnIncremental: isDenseGraph ? 0.22 : 0.38,
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
  const maxInfluence = Math.max(
    ...nodes.map((node) => node.outDegree * 1.35 + node.degree * 0.35),
    1,
  );
  const denseNetwork = isDenseNetwork(nodes.length, edges.length);

  const getVisualScore = (score: number) => {
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore)) return 0;
    // Evidence is already a 0-1 measure. Keeping the mapping absolute means an
    // edge does not appear stronger merely because a filter removed its peers.
    return Math.max(0, Math.min(1, numericScore));
  };

  const getEvidenceOpacity = (score: number) => {
    const visualScore = getVisualScore(score);
    if (denseNetwork) {
      if (visualScore >= 0.9) return 0.46;
      if (visualScore >= 0.75) return 0.28;
      return 0.16;
    }
    if (visualScore >= 0.9) return 0.92;
    if (visualScore >= 0.75) return 0.7;
    return 0.46;
  };

  const getEdgeColor = (edge: NetworkEdge) => {
    if (edge.sign === 0) {
      return "#8290a3";
    }

    return edge.sign > 0 ? "#168f98" : "#d66c4d";
  };

  const getRelationshipShape = (edge: NetworkEdge) => {
    if (edge.direction === 0 || edge.directionCoverage <= 0) return "none";
    if (edge.directionConfidence === null) return "none";
    if (edge.sign === 0) {
      return "triangle";
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
    ...nodes.map((node) => {
      const fullLabel =
        node.id.length > 10 ? `${node.id.slice(0, 9)}…` : node.id;

      return {
        data: {
        id: node.id,
        label: node.showLabel === false ? "" : fullLabel,
        fullLabel,
        degree: node.degree,
        inDegree: node.inDegree,
        outDegree: node.outDegree,
        isTF: node.isTF ? 1 : 0,
        influence: Math.max(
          0,
          Math.min(1, (node.outDegree * 1.35 + node.degree * 0.35) / maxInfluence),
        ),
        componentIndex: node.componentIndex ?? 0,
        componentColor: node.componentColor ?? "#5c83d8",
        denseNetwork: denseNetwork ? 1 : 0,
        },
      };
    }),
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
          evidenceOpacity: getEvidenceOpacity(edge.score),
          denseNetwork: denseNetwork ? 1 : 0,
          edgeColor: getEdgeColor(edge),
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
      .map(
        (node) =>
          `${node.id}/${node.isTF ? 1 : 0}/${node.componentIndex ?? 0}/${node.componentColor ?? ""}`,
      )
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
