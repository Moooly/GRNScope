import type {
  NetworkNode,
  NetworkEdge,
  PositionMap,
} from "./networkGraphTypes";
import cytoscape from "cytoscape";
import { createAtlasLayout, packAtlasComponents } from "./networkAtlasLayout";

/** Peel terminal chains but retain branching junctions and the cyclic backbone.
 * Parent here describes geometry only; it is not a regulatory direction. */
export function branchStructure(nodes: NetworkNode[], edges: NetworkEdge[]) {
  const neighbors = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  edges.forEach((e) => {
    if (
      e.source === e.target ||
      !neighbors.has(e.source) ||
      !neighbors.has(e.target)
    )
      return;
    neighbors.get(e.source)!.add(e.target);
    neighbors.get(e.target)!.add(e.source);
  });
  const degree = new Map([...neighbors].map(([id, ns]) => [id, ns.size]));
  const alive = new Set(neighbors.keys());
  const parent = new Map<string, string>();
  const children = new Map(nodes.map((n) => [n.id, [] as string[]]));
  const queue = [...neighbors.keys()]
    .filter((id) => degree.get(id) === 1)
    .sort();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (!alive.has(id) || neighbors.get(id)!.size >= 3) continue;
    const ns = [...neighbors.get(id)!].filter((n) => alive.has(n));
    if (ns.length !== 1) continue;
    const p = ns[0];
    parent.set(id, p);
    children.get(p)!.push(id);
    alive.delete(id);
    degree.set(p, degree.get(p)! - 1);
    if (degree.get(p) === 1) queue.push(p);
  }
  children.forEach((list) => list.sort());
  return { core: alive, parent, children, neighbors };
}

export function arrangeBranches(
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  backbone: PositionMap,
  measure?: (text: string, bold: boolean) => number,
  viewport = { width: 1280, height: 700 },
): PositionMap {
  const plan = branchStructure(nodes, edges);
  const positions: PositionMap = {};
  const masses = new Map<string, number>();
  // Peeling records children before parents, avoiding recursion on long chains.
  for (const id of [...plan.parent.keys(), ...plan.core]) {
    masses.set(
      id,
      Math.max(
        1,
        plan.children
          .get(id)!
          .reduce((sum, c) => sum + (masses.get(c) ?? 1), 0),
      ),
    );
  }
  const roots = [...plan.core].sort();
  roots.forEach((id, i) => {
    positions[id] = { ...(backbone[id] ?? { x: i * 240, y: 0 }) };
  });
  const radii = new Map(
    roots.map((id) => [
      id,
      plan.children.get(id)!.length
        ? (plan.children.get(id)!.length > 2 ? 80 : 45) +
          Math.sqrt(masses.get(id)!) * 28
        : 55,
    ]),
  );
  // Give each hub room for its attached branches before placing leaves.
  for (let pass = 0; pass < 90; pass++) {
    let moved = false;
    for (let i = 0; i < roots.length; i++)
      for (let j = i + 1; j < roots.length; j++) {
        const a = positions[roots[i]],
          b = positions[roots[j]];
        const dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy);
        const minimum = radii.get(roots[i])! + radii.get(roots[j])!;
        if (d >= minimum) continue;
        const angle = d > 0.01 ? Math.atan2(dy, dx) : (i + j + 1) * 2.39996;
        const shift = (minimum - d) * 0.51;
        a.x -= Math.cos(angle) * shift;
        a.y -= Math.sin(angle) * shift;
        b.x += Math.cos(angle) * shift;
        b.y += Math.sin(angle) * shift;
        moved = true;
      }
    if (!moved) break;
  }
  const jobs: Array<{ id: string; angle: number; sweep: number }> = [];
  const cx =
    roots.reduce((sum, id) => sum + positions[id].x, 0) /
    Math.max(1, roots.length);
  const cy =
    roots.reduce((sum, id) => sum + positions[id].y, 0) /
    Math.max(1, roots.length);
  roots.forEach((id, i) => {
    const peers = [...plan.neighbors.get(id)!].filter((n) => plan.core.has(n));
    const p = positions[id];
    const toward = peers.reduce(
      (sum, n) => ({
        x: sum.x + positions[n].x - p.x,
        y: sum.y + positions[n].y - p.y,
      }),
      { x: 0, y: 0 },
    );
    let angle =
      Math.hypot(toward.x, toward.y) > 1
        ? Math.atan2(-toward.y, -toward.x)
        : Math.atan2(p.y - cy, p.x - cx);
    if (roots.length === 1) angle = -Math.PI / 2;
    if (!Number.isFinite(angle)) angle = i * 2.39996;
    jobs.push({
      id,
      angle,
      sweep: peers.length ? Math.PI * 1.35 : Math.PI * 1.9,
    });
  });
  for (let i = 0; i < jobs.length; i++) {
    const { id, angle, sweep } = jobs[i];
    const kids = plan.children.get(id)!;
    if (!kids.length) continue;
    const total = kids.reduce((sum, k) => sum + masses.get(k)!, 0);
    let cursor = angle - sweep / 2;
    const radius = Math.max(90, (kids.length * 45) / sweep);
    kids.forEach((k) => {
      const segment = (sweep * masses.get(k)!) / total;
      const theta = cursor + segment / 2;
      const length =
        radius + (kids.length > 1 ? Math.sqrt(masses.get(k)!) * 12 : 0);
      positions[k] = {
        x: positions[id].x + Math.cos(theta) * length,
        y: positions[id].y + Math.sin(theta) * length,
      };
      jobs.push({
        id: k,
        angle: theta,
        sweep: Math.min(Math.PI * 0.85, Math.max(0.45, segment)),
      });
      cursor += segment;
    });
  }
  // Orient the finished structure to the canvas before resolving label boxes.
  // Rotation preserves branch angles and distances; labels remain upright.
  if (nodes.length && viewport.width > viewport.height) {
    const points = Object.values(positions);
    const w =
      Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const h =
      Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
    if (h > w)
      Object.values(positions).forEach((p) => {
        const x = p.x;
        p.x = -p.y;
        p.y = x;
      });
  }
  // Resolve full label boxes without compressing the layout into a fixed canvas.
  const boxes = [...nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => ({
      id: n.id,
      w: Math.max(50, (measure?.(n.id, n.isTF) ?? n.id.length * 8) + 12),
      h: 64,
    }));
  for (let pass = 0; pass < 100; pass++) {
    let overlaps = 0;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const aa = boxes[i],
          bb = boxes[j],
          a = positions[aa.id],
          b = positions[bb.id];
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const ox = (aa.w + bb.w) / 2 + 12 - Math.abs(dx),
          oy = aa.h + 12 - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        overlaps++;
        if (ox < oy) {
          const d = (ox / 2 + 0.1) * (dx >= 0 ? 1 : -1);
          a.x -= d;
          b.x += d;
        } else {
          const d = (oy / 2 + 0.1) * (dy >= 0 ? 1 : -1);
          a.y -= d;
          b.y += d;
        }
      }
    if (!overlaps) break;
  }
  const packer = cytoscape({
    headless: true,
    styleEnabled: true,
    layout: { name: "preset" },
    elements: [
      ...boxes.map((box) => ({
        data: { id: box.id, w: box.w, h: box.h },
        position: { x: positions[box.id].x, y: positions[box.id].y + 14 },
      })),
      ...edges.map((edge) => ({
        data: {
          id: `pack-${edge.key}`,
          source: edge.source,
          target: edge.target,
        },
      })),
    ],
    style: [
      {
        selector: "node",
        style: {
          width: "data(w)",
          height: "data(h)",
          shape: "rectangle",
          label: "",
          "border-width": 0,
        },
      },
    ],
  });
  try {
    return packAtlasComponents(packer, viewport);
  } finally {
    packer.destroy();
  }
}

export function createBranchLayout(
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  viewport: { width: number; height: number },
  options: Parameters<typeof createAtlasLayout>[3],
) {
  if (nodes.length > 600)
    return createAtlasLayout(nodes, edges, viewport, options);
  const plan = branchStructure(nodes, edges);
  // Keep the existing bounded solver for very large backbones.
  const coreNodes = nodes.filter((n) => plan.core.has(n.id));
  const coreEdges = edges.filter(
    (e) => plan.core.has(e.source) && plan.core.has(e.target),
  );
  return createAtlasLayout(coreNodes, coreEdges, viewport, {
    ...options,
    onComplete: (p) =>
      options.onComplete(
        arrangeBranches(nodes, edges, p, options.measure, viewport),
      ),
  });
}
