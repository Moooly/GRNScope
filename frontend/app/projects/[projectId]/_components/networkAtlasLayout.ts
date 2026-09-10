import cytoscape, { type Core, type LayoutOptions } from "cytoscape";
import cola from "cytoscape-cola";
import coseBilkent from "cytoscape-cose-bilkent";
import { getLayoutConfig } from "./networkGraphLayouts";
import type {
  NetworkNode,
  NetworkEdge,
  PositionMap,
} from "./networkGraphTypes";

cytoscape.use(cola);
cytoscape.use(coseBilkent);

// The layout uses full label footprints, independent of zoom, selection and
// label culling in the renderer. The solver box is centered 14px below the
// marker to include its bottom-aligned label and white outline.
export function atlasFootprint(
  node: NetworkNode,
  measure?: (text: string, bold: boolean) => number,
) {
  return {
    width: Math.max(
      node.isTF ? 31 : 25,
      (measure?.(node.id, node.isTF) ?? node.id.length * 9) + 10,
    ),
    height: 60,
  };
}

// Place whole components using rigid transforms only. Never compress coordinates after collision
// avoidance: markers and labels do not shrink when model positions are scaled.
export function packAtlasComponents(
  solver: Core,
  viewport: { width: number; height: number },
): PositionMap {
  const components = solver.elements().components();
  // A rigid quarter-turn can suit a wide canvas better. Accept it only when
  // the upright labels still have their full clearance; no geometry is scaled.
  for (const component of components) {
    const members = component.nodes().toArray();
    const before = component.nodes().boundingBox({ includeLabels: false });
    const boxes = members.map((node) => ({
      x: -node.position().y,
      y: node.position().x,
      w: node.width(),
      h: node.height(),
    }));
    const collides = boxes.some((a, i) =>
      boxes
        .slice(i + 1)
        .some(
          (b) =>
            Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 16 &&
            Math.abs(a.y - b.y) < (a.h + b.h) / 2 + 16,
        ),
    );
    const width =
      Math.max(...boxes.map((b) => b.x + b.w / 2)) -
      Math.min(...boxes.map((b) => b.x - b.w / 2));
    const height =
      Math.max(...boxes.map((b) => b.y + b.h / 2)) -
      Math.min(...boxes.map((b) => b.y - b.h / 2));
    if (
      !collides &&
      Math.min(viewport.width / width, viewport.height / height) >
        Math.min(viewport.width / before.w, viewport.height / before.h)
    ) {
      component
        .nodes()
        .positions((node) => ({ x: -node.position().y, y: node.position().x }));
    }
  }
  const groups = components
    .map((component) => ({
      nodes: component.nodes(),
      box: component.nodes().boundingBox({ includeLabels: false }),
    }))
    .sort(
      (a, b) =>
        b.box.h - a.box.h || a.nodes[0].id().localeCompare(b.nodes[0].id()),
    );
  if (!groups.length) return {};
  const gap = 48;
  let cumulative = 0;
  const widths = groups.map(({ box }) => (cumulative += box.w + gap));
  let bestScore = -1;
  let best: PositionMap = {};
  for (const width of widths) {
    let x = 0,
      y = 0,
      rowHeight = 0,
      usedWidth = 0;
    const positions: PositionMap = {};
    for (const group of groups) {
      if (x && x + group.box.w > width) {
        y += rowHeight + gap;
        x = 0;
        rowHeight = 0;
      }
      group.nodes.forEach((node) => {
        positions[node.id()] = {
          x: node.position().x - group.box.x1 + x,
          y: node.position().y - group.box.y1 + y - 14,
        };
      });
      usedWidth = Math.max(usedWidth, x + group.box.w);
      x += group.box.w + gap;
      rowHeight = Math.max(rowHeight, group.box.h);
    }
    const score = Math.min(
      Math.max(1, viewport.width - 80) / usedWidth,
      Math.max(1, viewport.height - 80) / (y + rowHeight),
    );
    if (score > bestScore) {
      bestScore = score;
      best = positions;
    }
  }
  return best;
}

export function atlasReadability(
  nodes: NetworkNode[],
  positions: PositionMap,
  viewport: { width: number; height: number },
  measure?: (text: string, bold: boolean) => number,
) {
  if (!nodes.length) return 0;
  const boxes = nodes.map((node) => {
    const p = positions[node.id],
      size = atlasFootprint(node, measure);
    return {
      x1: p?.x - size.width / 2,
      x2: p?.x + size.width / 2,
      y1: p?.y + 14 - size.height / 2,
      y2: p?.y + 14 + size.height / 2,
    };
  });
  if (boxes.some((b) => Object.values(b).some((v) => !Number.isFinite(v))))
    return 0;
  if (
    boxes.some((a, i) =>
      boxes
        .slice(i + 1)
        .some(
          (b) =>
            Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.1 &&
            Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0.1,
        ),
    )
  )
    return 0;
  const width =
    Math.max(...boxes.map((b) => b.x2)) - Math.min(...boxes.map((b) => b.x1));
  const height =
    Math.max(...boxes.map((b) => b.y2)) - Math.min(...boxes.map((b) => b.y1));
  return Math.min(
    Math.max(1, viewport.width - 80) / width,
    Math.max(1, viewport.height - 80) / height,
    3,
  );
}

export function createAtlasLayout(
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  viewport: { width: number; height: number },
  options: {
    onComplete: (positions: PositionMap) => void;
    measure?: (text: string, bold: boolean) => number;
    synchronous?: boolean;
    compareCose?: boolean;
  },
) {
  if (!nodes.length) {
    options.onComplete({});
    return () => {};
  }
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const solver = cytoscape({
    headless: true,
    styleEnabled: true,
    layout: { name: "preset" },
    elements: [
      ...ordered.map((node, i) => {
        const footprint = atlasFootprint(node, options.measure);
        const angle = i * Math.PI * (3 - Math.sqrt(5));
        const radius = 55 * Math.sqrt(i);
        return {
          data: {
            id: node.id,
            width: footprint.width,
            height: footprint.height,
          },
          position: {
            x: radius * Math.cos(angle),
            y: radius * Math.sin(angle),
          },
        };
      }),
      ...[...edges]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((edge) => ({
          data: { id: edge.key, source: edge.source, target: edge.target },
        })),
    ],
    style: [
      {
        selector: "node",
        style: {
          width: "data(width)",
          height: "data(height)",
          shape: "rectangle",
          label: "",
          "border-width": 0,
        },
      },
    ],
  });
  let baseline: PositionMap | undefined;
  if (options.compareCose !== false && nodes.length) {
    const initial: PositionMap = {};
    solver.nodes().forEach((node) => {
      initial[node.id()] = { ...node.position() };
    });
    solver
      .layout({
        ...getLayoutConfig(
          "force",
          { nodeCount: nodes.length, edgeCount: edges.length },
          nodes,
          edges,
        ),
        fit: false,
      } as LayoutOptions)
      .run();
    baseline = packAtlasComponents(solver, viewport);
    solver.nodes().positions((node) => initial[node.id()]);
  }
  // WebCola's distance solver is expensive on large graphs. Keep the existing
  // CoSE path for those, with the same corrected label geometry and packing.
  if (nodes.length > 250 && baseline) {
    const scheduled = setTimeout(() => {
      solver.destroy();
      options.onComplete(baseline!);
    }, 0);
    if (options.synchronous) {
      clearTimeout(scheduled);
      solver.destroy();
      options.onComplete(baseline);
    }
    return () => {
      clearTimeout(scheduled);
      if (!solver.destroyed()) solver.destroy();
    };
  }
  let cancelled = false;
  const layout = solver.layout({
    name: "cola",
    animate: !options.synchronous,
    refresh: 8,
    maxSimulationTime: 4000,
    fit: false,
    randomize: false,
    avoidOverlap: true,
    nodeDimensionsIncludeLabels: true,
    nodeSpacing: 8,
    handleDisconnected: true,
    boundingBox: {
      x1: 0,
      y1: 0,
      w: Math.max(320, viewport.width),
      h: Math.max(240, viewport.height),
    },
    edgeLength: edges.length > nodes.length * 3 ? 135 : 95,
    unconstrIter: 20,
    allConstIter: 30,
    convergenceThreshold: 0.02,
    stop: () => {
      if (cancelled) return;
      const positions = packAtlasComponents(solver, viewport);
      solver.destroy();
      const useBaseline =
        baseline &&
        atlasReadability(nodes, baseline, viewport, options.measure) >
          atlasReadability(nodes, positions, viewport, options.measure);
      options.onComplete(useBaseline ? baseline! : positions);
    },
  } as LayoutOptions);
  // Defer browser work so the loading state can paint and immediate topology
  // changes can cancel the pending run before the solver starts.
  const scheduled = options.synchronous
    ? undefined
    : setTimeout(() => layout.run(), 0);
  if (options.synchronous) layout.run();
  return () => {
    cancelled = true;
    if (scheduled !== undefined) clearTimeout(scheduled);
    layout.stop();
    if (!solver.destroyed()) solver.destroy();
  };
}
