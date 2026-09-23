import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { layoutNeighborhoods, partitionSkeleton } from "./neighborhoods";
import { EDGE_GAP } from "./theme";

cytoscape.use(fcose);

export type Point = { x: number; y: number };
export type GalaxyNode = { id: string; diameter: number; labelWidth: number };
export type GalaxyEdge = { id: string; source: string; target: string; sign: number; direction: number; /** Evidence, 0–1; ranks links for the layout backbone. */ weight?: number };
export type GalaxyInput = {
  nodes: GalaxyNode[];
  edges: GalaxyEdge[];
  width: number;
  height: number;
  /** Visible rim-to-rim length every edge aims for. Defaults to EDGE_GAP. */
  gap?: number;
};
export type Route = { distances: number[]; weights: number[] };
export type GalaxyResult = {
  positions: Record<string, Point>;
  routes: Record<string, Route>;
  components: number;
  neighborhoods?: Record<string, string>;
  /** Edges whose straight line passes under a gene they do not connect. */
  occluded?: string[];
};

const TAU = Math.PI * 2;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
function randomFor(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Undirected, unique adjacency is used only for geometry. Reciprocal edges,
 * self loops and their original direction remain separate rendered records. */
export function galaxyStructure(input: GalaxyInput) {
  const neighbors = new Map(input.nodes.map(n => [n.id, new Set<string>()]));
  for (const e of input.edges) {
    if (e.source === e.target || !neighbors.has(e.source) || !neighbors.has(e.target)) continue;
    neighbors.get(e.source)!.add(e.target);
    neighbors.get(e.target)!.add(e.source);
  }
  const components: string[][] = [];
  const seen = new Set<string>();
  for (const id of [...neighbors.keys()].sort()) {
    if (seen.has(id)) continue;
    const ids = [id];
    seen.add(id);
    for (let i = 0; i < ids.length; i++) {
      for (const other of [...neighbors.get(ids[i])!].sort()) {
        if (!seen.has(other)) { seen.add(other); ids.push(other); }
      }
    }
    components.push(ids);
  }
  const core = new Set(neighbors.keys());
  const remaining = new Map([...neighbors].map(([id, ns]) => [id, ns.size]));
  const parent = new Map<string, string>();
  const children = new Map(input.nodes.map(n => [n.id, [] as string[]]));
  const queue = [...neighbors.keys()].filter(id => remaining.get(id) === 1).sort();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    // Keep true branching junctions, including secondary hubs, in the skeleton.
    if (!core.has(id) || neighbors.get(id)!.size >= 3) continue;
    const ns = [...neighbors.get(id)!].filter(other => core.has(other));
    if (ns.length !== 1) continue;
    const owner = ns[0];
    parent.set(id, owner);
    children.get(owner)!.push(id);
    core.delete(id);
    remaining.set(owner, remaining.get(owner)! - 1);
    if (remaining.get(owner) === 1) queue.push(owner);
  }
  children.forEach(ids => ids.sort());
  const mass = new Map<string, number>();
  const depth = new Map<string, number>();
  for (const id of [...parent.keys(), ...core]) {
    const kids = children.get(id)!;
    mass.set(id, 1 + kids.reduce((sum, k) => sum + (mass.get(k) ?? 1), 0));
    depth.set(id, kids.length ? 1 + Math.max(...kids.map(k => depth.get(k) ?? 0)) : 0);
  }
  return { neighbors, components, core, parent, children, mass, depth };
}

/** Multi-scale layout: solve the connected skeleton, expand its branches,
 * relax local collisions, then pack whole connected components by translation. */
export function layoutGalaxy(input: GalaxyInput, neighborhoods: Record<string, string> = {}, multiscale = true): Record<string, Point> {
  if (!input.nodes.length) return {};
  const plan = galaxyStructure(input);
  const byId = new Map(input.nodes.map(n => [n.id, n]));
  const positions: Record<string, Point> = {};
  const groups: Array<{ ids: string[]; w: number; h: number }> = [];
  for (const ids of plan.components) {
    const roots = ids.filter(id => plan.core.has(id));
    const idSet = new Set(ids);
    const localEdges = input.edges.filter(e => idSet.has(e.source) && idSet.has(e.target));
    if (multiscale && ids.length >= 400 && roots.length >= 250 && localEdges.length/ids.length > 3) {
      const regions = partitionSkeleton(roots, plan.neighbors);
      if (regions.length > 1) {
        regions.forEach(region => {
          const anchor = region[0];
          for (let i=0;i<region.length;i++) {
            neighborhoods[region[i]] = anchor;
            region.push(...plan.children.get(region[i])!);
          }
        });
        Object.assign(positions, layoutNeighborhoods({ ...input, nodes: input.nodes.filter(n => idSet.has(n.id)), edges: localEdges }, regions, child => layoutGalaxy(child, {}, false)));
        const x1=Math.min(...ids.map(id => positions[id].x-byId.get(id)!.labelWidth/2-20));
        const x2=Math.max(...ids.map(id => positions[id].x+byId.get(id)!.labelWidth/2+20));
        const y1=Math.min(...ids.map(id => positions[id].y-byId.get(id)!.diameter/2-20));
        const y2=Math.max(...ids.map(id => positions[id].y+byId.get(id)!.diameter/2+40));
        ids.forEach(id => { positions[id].x-=x1; positions[id].y-=y1; });
        groups.push({ ids, w: x2-x1+32, h: y2-y1+32 });
        continue;
      }
    }
    const gap = input.gap ?? EDGE_GAP;
    const kidMax = (id: string) => Math.max(0, ...plan.children.get(id)!.map(k => byId.get(k)!.diameter));
    // A hub reserves room for its fan of single-link genes; a plain gene
    // reserves little more than its own disc, so its edges can reach `gap`.
    const footprint = (id: string) => {
      const d = byId.get(id)!.diameter, kids = plan.children.get(id)!.length;
      if (!kids) return d + 12;
      return d + 2 * (gap + kidMax(id)) * Math.min(1, 0.45 + kids / 14);
    };
    const extra = (id: string) => (footprint(id) - byId.get(id)!.diameter) / 2;
    if (roots.length === 1) positions[roots[0]] = { x: 0, y: 0 };
    else {
      const rootSet = new Set(roots);
      const links = new Set<string>();
      // Seed the best-connected genes at the centre of the spiral so hubs start
      // among their neighbours instead of being pushed to the rim.
      const seeded = [...roots].sort((a, b) => plan.neighbors.get(b)!.size - plan.neighbors.get(a)!.size || a.localeCompare(b));
      const elements: cytoscape.ElementDefinition[] = seeded.map((id, i) => {
        const angle = i * 2.399963;
        const radius = 100 * Math.sqrt(i + 1);
        return { data: { id, footprint: footprint(id) }, position: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius } };
      });
      for (const e of input.edges) {
        if (!rootSet.has(e.source) || !rootSet.has(e.target) || e.source === e.target) continue;
        const pair = JSON.stringify([e.source, e.target].sort());
        if (links.has(pair)) continue;
        links.add(pair);
        elements.push({ data: { id: `skeleton-${links.size}`, source: e.source, target: e.target } });
      }
      const solver = cytoscape({ headless: true, styleEnabled: true, elements, layout: { name: "preset" }, style: [{ selector: "node", style: { width: "data(footprint)", height: "data(footprint)", label: "", "border-width": 0 } }] });
      try {
        solver.layout({
          name: "fcose", quality: "proof", randomize: false, animate: false,
          fit: false, packComponents: false, tile: false, nodeDimensionsIncludeLabels: false,
          // Fixed edge length: the rim-to-rim distance aims for `gap` on every
          // edge. The solver measures between footprints, so a hub's reserved
          // fan margin is subtracted; the floor keeps two fans from colliding.
          idealEdgeLength: (e: cytoscape.EdgeSingular) => Math.max(24, gap - extra(e.source().id()) - extra(e.target().id())),
          nodeRepulsion: () => 22000,
          edgeElasticity: () => 0.45, gravity: 0.04, gravityRange: 4,
          numIter: roots.length > 500 ? 1400 : 2400,
        } as unknown as cytoscape.LayoutOptions).run();
        solver.nodes().forEach(n => { positions[n.id()] = { ...n.position() }; });
      } finally { solver.destroy(); }
    }
    // Fixed edge length: refine the force solution with stress majorization,
    // whose springs connect every pair of genes and rest at graph distance.
    // One hop rests at exactly rim + gap + rim, so connected genes end up the
    // same visible distance apart wherever the topology allows it.
    if (roots.length > 1 && roots.length <= 900) {
      const reach = (id: string) => byId.get(id)!.diameter / 2 + (plan.children.get(id)!.length ? 0.5 * (gap + kidMax(id)) : 0);
      stressMajorize(roots, positions, plan.neighbors, reach, gap);
    }

    const centre = roots.reduce((c, id) => ({ x: c.x + positions[id].x / roots.length, y: c.y + positions[id].y / roots.length }), { x: 0, y: 0 });
    if (roots.length >= 3) {
      let xx=0, yy=0, xy=0;
      roots.forEach(id=>{const x=positions[id].x-centre.x,y=positions[id].y-centre.y;xx+=x*x;yy+=y*y;xy+=x*y;});
      const angle=-0.5*Math.atan2(2*xy,xx-yy);
      roots.forEach(id=>{const p=positions[id],x=p.x-centre.x,y=p.y-centre.y;p.x=centre.x+x*Math.cos(angle)-y*Math.sin(angle);p.y=centre.y+x*Math.sin(angle)+y*Math.cos(angle);});
      // No anisotropic stretch: it would make horizontal edges longer than
      // vertical ones and break the fixed edge length.
    }
    const jobs: Array<{ id: string; angle: number; sweep: number }> = [];
    for (const id of roots) {
      const p = positions[id];
      const peers = [...plan.neighbors.get(id)!].filter(n => plan.core.has(n));
      const angles = peers.map(n => Math.atan2(positions[n].y - p.y, positions[n].x - p.x)).sort((a, b) => a - b);
      let angle = Math.atan2(p.y - centre.y, p.x - centre.x);
      let sweep = TAU * 0.85;
      if (angles.length) {
        // Face the largest free sector around the local hub, not a global ring.
        let gap = -1;
        for (let i = 0; i < angles.length; i++) {
          const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + TAU;
          if (next - angles[i] > gap) { gap = next - angles[i]; angle = angles[i] + gap / 2; }
        }
        sweep = clamp(gap * 0.82, plan.children.get(id)!.length > 32 ? 1.8 : 0.8, 4.5);
      } else angle = randomFor(id) * TAU;
      jobs.push({ id, angle, sweep });
    }
    // Single-link genes sit on an arc around their hub at exactly one edge
    // length from its rim. When one arc cannot hold them, further rings follow.
    for (let i = 0; i < jobs.length; i++) {
      const { id, angle, sweep } = jobs[i];
      const kids = plan.children.get(id)!;
      if (!kids.length) continue;
      const r = byId.get(id)!.diameter / 2, maxKid = kidMax(id);
      // A gene occupies its disc or its name, whichever is wider, plus margin.
      const extent = (k: string) => Math.max(byId.get(k)!.diameter, byId.get(k)!.labelWidth) + 18;
      const ringStep = Math.max(...kids.map(extent));
      const need = (k: string, ring: number) => extent(k) / (r + gap + maxKid / 2 + ring * ringStep);
      const limit = TAU * 0.94;
      const rings: string[][] = [[]];
      let used = 0;
      const ordered = [...kids].sort((a, b) => plan.mass.get(b)! - plan.mass.get(a)! || a.localeCompare(b));
      for (const k of ordered) {
        const ring = rings.length - 1;
        if (used + need(k, ring) > limit && rings[ring].length) { rings.push([]); used = 0; }
        rings[rings.length - 1].push(k);
        used += need(k, rings.length - 1);
      }
      rings.forEach((ringKids, ring) => {
        ringKids.sort();
        const needs = ringKids.map(k => need(k, ring));
        const needed = needs.reduce((a, b) => a + b, 0);
        const span = clamp(Math.max(sweep, needed), Math.min(needed, 0.6), limit);
        // Every gene first gets the arc it needs; spare arc goes to genes that
        // carry their own branches. Nothing is ever squeezed below its need.
        const spare = Math.max(0, span - needed), massTotal = ringKids.reduce((t, q) => t + Math.sqrt(plan.mass.get(q)!), 0);
        const weights = ringKids.map((k, j) => needs[j] + spare * Math.sqrt(plan.mass.get(k)!) / massTotal);
        const scale = 1;
        let cursor = angle - span / 2;
        ringKids.forEach((child, j) => {
          const segment = weights[j] * scale;
          const theta = cursor + segment / 2;
          const radius = r + gap + byId.get(child)!.diameter / 2 + ring * ringStep;
          positions[child] = { x: positions[id].x + Math.cos(theta) * radius, y: positions[id].y + Math.sin(theta) * radius };
          jobs.push({ id: child, angle: theta, sweep: Math.min(2.6, Math.max(0.9, segment)) });
          cursor += segment;
        });
      });
    }
    relaxCollisions(ids, positions, byId);
    // Rotate to the principal axis. No anisotropic scaling of neighborhoods.
    if (ids.length > 2) {
      const mid = ids.reduce((p, id) => ({ x: p.x + positions[id].x / ids.length, y: p.y + positions[id].y / ids.length }), { x: 0, y: 0 });
      let xx = 0, yy = 0, xy = 0;
      ids.forEach(id => { const x = positions[id].x - mid.x, y = positions[id].y - mid.y; xx += x*x; yy += y*y; xy += x*y; });
      const a = -0.5 * Math.atan2(2 * xy, xx - yy) + (ids.length <= 6 ? (randomFor(ids[0]) - 0.5) * 1.6 : 0);
      ids.forEach(id => { const p = positions[id], x = p.x - mid.x, y = p.y - mid.y; p.x = x * Math.cos(a) - y * Math.sin(a); p.y = x * Math.sin(a) + y * Math.cos(a); });
      relaxCollisions(ids, positions, byId);
    }
    const minX = Math.min(...ids.map(id => positions[id].x - Math.max(byId.get(id)!.diameter / 2, byId.get(id)!.labelWidth / 2)));
    const minY = Math.min(...ids.map(id => positions[id].y - byId.get(id)!.diameter / 2));
    const maxX = Math.max(...ids.map(id => positions[id].x + Math.max(byId.get(id)!.diameter / 2, byId.get(id)!.labelWidth / 2)));
    const maxY = Math.max(...ids.map(id => positions[id].y + byId.get(id)!.diameter / 2));
    ids.forEach(id => { positions[id].x -= minX; positions[id].y -= minY; });
    groups.push({ ids, w: maxX - minX + 32, h: maxY - minY + 32 });
  }
  packGroups(groups, positions, input.width / Math.max(1, input.height));
  return positions;
}

/** Localized stress majorization (Gansner, Koren & North 2004). Ideal
 * distances are shortest paths in which an edge a-b is reach(a) + gap + reach(b);
 * weights 1/d^2 satisfy short-range distances first. Deterministic. */
export function stressMajorize(ids: string[], positions: Record<string, Point>, neighbors: Map<string, Set<string>>, reach: (id: string) => number, gap: number, iterations = 160) {
  const n = ids.length, index = new Map(ids.map((id, i) => [id, i]));
  const r = ids.map(reach);
  const adj: Array<Array<[number, number]>> = ids.map((id, i) => [...neighbors.get(id)!].filter(o => index.has(o)).map(o => { const j = index.get(o)!; return [j, r[i] + gap + r[j]] as [number, number]; }));
  const dist = new Float64Array(n * n).fill(Infinity);
  for (let s = 0; s < n; s++) {
    // Dijkstra with a binary heap.
    const d = dist.subarray(s * n, s * n + n); d[s] = 0;
    const heap: Array<[number, number]> = [[0, s]];
    while (heap.length) {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) { heap[0] = last; let k = 0; for (;;) { const a = 2 * k + 1, b = a + 1; let m = k; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === k) break; [heap[k], heap[m]] = [heap[m], heap[k]]; k = m; } }
      const [du, u] = top; if (du > d[u]) continue;
      for (const [v, w] of adj[u]) if (du + w < d[v]) { d[v] = du + w; heap.push([d[v], v]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[k], heap[p]] = [heap[p], heap[k]]; k = p; } }
    }
  }
  const x = new Float64Array(n), y = new Float64Array(n);
  ids.forEach((id, i) => { x[i] = positions[id].x; y[i] = positions[id].y; });
  // Scale the starting arrangement to the ideal distances before iterating.
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = dist[i * n + j]; if (!Number.isFinite(d)) continue; const e = Math.hypot(x[i] - x[j], y[i] - y[j]) || 1; num += e / d; den += (e * e) / (d * d); }
  const k0 = den ? num / den : 1;
  for (let i = 0; i < n; i++) { x[i] *= k0; y[i] *= k0; }
  for (let it = 0; it < iterations; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, sw = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const d = dist[i * n + j]; if (!Number.isFinite(d)) continue;
        const w = 1 / (d * d), dx = x[i] - x[j], dy = y[i] - y[j];
        const e = Math.hypot(dx, dy) || 1e-6;
        sx += w * (x[j] + d * dx / e); sy += w * (y[j] + d * dy / e); sw += w;
      }
      if (!sw) continue;
      const nx = sx / sw, ny = sy / sw;
      moved = Math.max(moved, Math.hypot(nx - x[i], ny - y[i]));
      x[i] = nx; y[i] = ny;
    }
    if (moved < 0.5) break;
  }
  ids.forEach((id, i) => { positions[id] = { x: x[i], y: y[i] }; });
}

function relaxCollisions(ids: string[], positions: Record<string, Point>, nodes: Map<string, GalaxyNode>) {
  // Include the largest node/label footprint in the search radius. A fixed
  // adjacent-cell search misses large hubs after widening the node-size scale.
  const reach = Math.ceil((Math.max(...ids.map(id => Math.max(nodes.get(id)!.diameter, nodes.get(id)!.labelWidth))) + 32) / 100);
  // Spatial hashing bounds collision work even for a large connected component.
  for (let pass = 0; pass < 45; pass++) {
    const grid = new Map<string, string[]>();
    let collisions = 0;
    for (const id of ids) {
      const p = positions[id], node = nodes.get(id)!;
      const gx = Math.floor(p.x / 100), gy = Math.floor(p.y / 100);
      for (let x = gx - reach; x <= gx + reach; x++) for (let y = gy - reach; y <= gy + reach; y++) {
        for (const other of grid.get(`${x},${y}`) ?? []) {
          const q = positions[other], peer = nodes.get(other)!;
          const dx = p.x - q.x, dy = p.y - q.y;
          // Names sit inside the discs, so a gene only needs its disc -- or its
          // name, where that is wider -- plus a clear margin.
          const minX = (Math.max(node.diameter, node.labelWidth) + Math.max(peer.diameter, peer.labelWidth)) / 2 + 16;
          const minY = (node.diameter + peer.diameter) / 2 + 16;
          const ox = minX - Math.abs(dx), oy = minY - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          collisions++;
          if (ox < oy) { const push = (ox * 0.51 + 0.1) * (dx >= 0 ? 1 : -1); p.x += push; q.x -= push; }
          else { const push = (oy * 0.51 + 0.1) * (dy >= 0 ? 1 : -1); p.y += push; q.y -= push; }
        }
      }
      const key = `${Math.floor(p.x / 100)},${Math.floor(p.y / 100)}`;
      const bucket = grid.get(key) ?? []; bucket.push(id); grid.set(key, bucket);
    }
    if (!collisions) break;
  }
}

function packGroups(groups: Array<{ ids: string[]; w: number; h: number }>, positions: Record<string, Point>, aspect: number) {
  groups.sort((a,b) => b.w*b.h-a.w*a.h || a.ids[0].localeCompare(b.ids[0]));
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const ratio = clamp(aspect, 0.65, 3);
  let bounds = { x1: 0, y1: 0, x2: 0, y2: 0 };
  for(const g of groups) {
    let best: {x:number;y:number;score:number}|undefined;
    // A deterministic spiral gives separate islands an organic distribution.
    // Every candidate must clear the full component rectangle, including labels.
    for(let i=0;i<2400;i++) {
      const a=i*2.399963, r=24*Math.sqrt(i);
      const x=Math.cos(a)*r*Math.sqrt(ratio)-g.w/2;
      const y=Math.sin(a)*r/Math.sqrt(ratio)-g.h/2;
      if(placed.some(p=>x<p.x+p.w+14&&x+g.w+14>p.x&&y<p.y+p.h+14&&y+g.h+14>p.y)) continue;
      const w=Math.max(bounds.x2,x+g.w)-Math.min(bounds.x1,x);
      const h=Math.max(bounds.y2,y+g.h)-Math.min(bounds.y1,y);
      const score=Math.max(w/ratio,h)+r*0.1;
      if(!best||score<best.score) best={x,y,score};
      if(i===0) break;
    }
    // Large collections can exhaust the search radius; place safely outside it.
    const p=best??{x:bounds.x2+30,y:bounds.y1,score:0};
    placed.push({...p,w:g.w,h:g.h});
    bounds={x1:Math.min(bounds.x1,p.x),y1:Math.min(bounds.y1,p.y),x2:Math.max(bounds.x2,p.x+g.w),y2:Math.max(bounds.y2,p.y+g.h)};
    g.ids.forEach(id=>{positions[id].x+=p.x;positions[id].y+=p.y;});
  }
}

/** Straight connections remain individually traceable. Only parallel or
 * reciprocal records need separate gentle lanes; loops use native routing. */
export function routeGalaxy(input: Pick<GalaxyInput, "edges"> & Partial<Pick<GalaxyInput, "nodes">>, positions: Record<string, Point>): Record<string, Route> {
  const routes: Record<string, Route> = {};
  const radii = new Map((input.nodes ?? []).map(n => [n.id, n.diameter / 2 + 3]));
  const pairs = new Map<string, GalaxyEdge[]>();
  for (const e of input.edges) {
    if (e.source === e.target || !positions[e.source] || !positions[e.target]) continue;
    const key = JSON.stringify([e.source, e.target].sort());
    const group = pairs.get(key) ?? [];
    group.push(e); pairs.set(key, group);
  }
  for (const group of pairs.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.id.localeCompare(b.id));
    group.forEach((e, index) => {
      const s = positions[e.source], t = positions[e.target];
      const length = Math.hypot(t.x - s.x, t.y - s.y);
      const start = radii.get(e.source) ?? 0, end = radii.get(e.target) ?? 0;
      if (length <= start + end + 2) return;
      const lane = (index - (group.length - 1) / 2) * Math.min(24, length * 0.18) * (e.source < e.target ? 1 : -1);
      routes[e.id] = { distances: [lane], weights: [(start / length + 1 - end / length) / 2] };
    });
  }
  return routes;
}

/** Backbone for dense networks: every gene keeps its `perGene` strongest
 * links (by evidence), and only those position the genes. All links are still
 * drawn. Sparse networks use every link. */
export function layoutBackbone(input: GalaxyInput, perGene = 3): GalaxyInput {
  const real = input.edges.filter(e => e.source !== e.target);
  // Above ~600 genes the dense path partitions the network into bounded
  // regions instead, which is what keeps very large layouts fast.
  if (real.length <= input.nodes.length * 1.5 || input.nodes.length > 600) return input;
  const byGene = new Map<string, GalaxyEdge[]>();
  for (const e of real) for (const id of [e.source, e.target]) { const list = byGene.get(id) ?? []; list.push(e); byGene.set(id, list); }
  const keep = new Set<string>();
  for (const list of byGene.values()) {
    list.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.id.localeCompare(b.id));
    list.slice(0, perGene).forEach(e => keep.add(e.id));
  }
  return { ...input, edges: input.edges.filter(e => keep.has(e.id)) };
}

/** Straight links that pass under the disc of a gene they do not connect. */
export function occludedEdges(input: Pick<GalaxyInput, "nodes" | "edges">, positions: Record<string, Point>): string[] {
  const cell = 120, grid = new Map<string, GalaxyNode[]>();
  let maxR = 0;
  for (const n of input.nodes) {
    const p = positions[n.id]; if (!p) continue;
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    const bucket = grid.get(key) ?? []; bucket.push(n); grid.set(key, bucket);
    maxR = Math.max(maxR, n.diameter / 2);
  }
  const out: string[] = [];
  for (const e of input.edges) {
    const a = positions[e.source], b = positions[e.target];
    if (!a || !b || e.source === e.target) continue;
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
    const x1 = Math.floor((Math.min(a.x, b.x) - maxR) / cell), x2 = Math.floor((Math.max(a.x, b.x) + maxR) / cell);
    const y1 = Math.floor((Math.min(a.y, b.y) - maxR) / cell), y2 = Math.floor((Math.max(a.y, b.y) + maxR) / cell);
    let hit = false;
    for (let gx = x1; gx <= x2 && !hit; gx++) for (let gy = y1; gy <= y2 && !hit; gy++) {
      for (const n of grid.get(`${gx},${gy}`) ?? []) {
        if (n.id === e.source || n.id === e.target) continue;
        const p = positions[n.id], t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
        if (Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) < n.diameter / 2 - 1) { hit = true; break; }
      }
    }
    if (hit) out.push(e.id);
  }
  return out;
}

export function buildGalaxy(input: GalaxyInput): GalaxyResult {
  const neighborhoods: Record<string, string> = {};
  const positions=layoutGalaxy(layoutBackbone(input), neighborhoods);
  return {positions,routes:routeGalaxy(input,positions),components:galaxyStructure(input).components.length, neighborhoods, occluded: occludedEdges(input, positions)};
}
