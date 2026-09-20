import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { layoutNeighborhoods, partitionSkeleton } from "./neighborhoods";

cytoscape.use(fcose);

export type Point = { x: number; y: number };
export type GalaxyNode = { id: string; diameter: number; labelWidth: number };
export type GalaxyEdge = { id: string; source: string; target: string; sign: number; direction: number };
export type GalaxyInput = {
  nodes: GalaxyNode[];
  edges: GalaxyEdge[];
  width: number;
  height: number;
};
export type Route = { distances: number[]; weights: number[] };
export type GalaxyResult = {
  positions: Record<string, Point>;
  routes: Record<string, Route>;
  components: number;
  neighborhoods?: Record<string, string>;
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
    const footprint = (id: string) => {
      const count = plan.children.get(id)!.length;
      if (!count) return Math.max(44, byId.get(id)!.diameter + 28);
      const fanRadius = Math.max(54, count > 32 ? Math.sqrt(count)*42 : count*23/3.8) + byId.get(id)!.diameter * 0.6;
      return Math.max(byId.get(id)!.diameter + 24,
        count > 12 ? fanRadius * 2.4 : 0,
        (48 + Math.sqrt(Math.max(0, count - 2)) * 25 + Math.min(3, plan.depth.get(id)!) * 10) * (count > 5 ? 1.5 : 1));
    };
    if (roots.length === 1) positions[roots[0]] = { x: 0, y: 0 };
    else {
      const rootSet = new Set(roots);
      const links = new Set<string>();
      const elements: cytoscape.ElementDefinition[] = roots.map((id, i) => {
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
          idealEdgeLength: (e: cytoscape.EdgeSingular) => {
            const d = Math.min(plan.neighbors.get(e.source().id())!.size, plan.neighbors.get(e.target().id())!.size);
            return 85 + Math.min(140, d * 10);
          },
          nodeRepulsion: (n: cytoscape.NodeSingular) => 14000 + 1600 * Math.sqrt(plan.neighbors.get(n.id())!.size),
          edgeElasticity: () => 0.18, gravity: 0.05, gravityRange: 4,
          numIter: roots.length > 500 ? 1400 : 2400,
        } as unknown as cytoscape.LayoutOptions).run();
        solver.nodes().forEach(n => { positions[n.id()] = { ...n.position() }; });
      } finally { solver.destroy(); }
    }

    const centre = roots.reduce((c, id) => ({ x: c.x + positions[id].x / roots.length, y: c.y + positions[id].y / roots.length }), { x: 0, y: 0 });
    if (roots.length >= 3) {
      let xx=0, yy=0, xy=0;
      roots.forEach(id=>{const x=positions[id].x-centre.x,y=positions[id].y-centre.y;xx+=x*x;yy+=y*y;xy+=x*y;});
      const angle=-0.5*Math.atan2(2*xy,xx-yy);
      roots.forEach(id=>{const p=positions[id],x=p.x-centre.x,y=p.y-centre.y;p.x=centre.x+x*Math.cos(angle)-y*Math.sin(angle);p.y=centre.y+x*Math.sin(angle)+y*Math.cos(angle);});
      const w=Math.max(...roots.map(id=>positions[id].x))-Math.min(...roots.map(id=>positions[id].x));
      const h=Math.max(...roots.map(id=>positions[id].y))-Math.min(...roots.map(id=>positions[id].y));
      const spread=clamp(Math.sqrt((input.width/Math.max(1,input.height))*Math.max(h,100)/Math.max(w,100)),1,1.85);
      // Shape the skeleton before expanding neighborhoods. Satellite fans keep
      // their local distances and angles; the finished graph is never stretched.
      roots.forEach(id=>{positions[id].x=centre.x+(positions[id].x-centre.x)*spread;});
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
    for (let i = 0; i < jobs.length; i++) {
      const { id, angle, sweep } = jobs[i];
      const kids = plan.children.get(id)!;
      if (!kids.length) continue;
      const total = kids.reduce((sum, k) => sum + Math.sqrt(plan.mass.get(k)!), 0);
      const baseRadius = Math.max(54, kids.length > 32 ? Math.sqrt(kids.length*TAU/sweep)*32 : kids.length*30/sweep) + byId.get(id)!.diameter * 0.6;
      let cursor = angle - sweep / 2;
      kids.forEach(child => {
        const segment = sweep * Math.sqrt(plan.mass.get(child)!) / total;
        const theta = cursor + segment * (0.42 + randomFor(child + "angle") * 0.16);
        const radius = baseRadius * (kids.length > 32 ? Math.sqrt(0.2+0.8*randomFor(child)) : 0.78+0.44*randomFor(child)) + Math.min(70, (plan.depth.get(child) ?? 0) * 14);
        positions[child] = { x: positions[id].x + Math.cos(theta) * radius, y: positions[id].y + Math.sin(theta) * radius };
        jobs.push({ id: child, angle: theta, sweep: Math.min(2.6, Math.max(0.7, segment)) });
        cursor += segment;
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
    const maxY = Math.max(...ids.map(id => positions[id].y + byId.get(id)!.diameter / 2 + 17));
    ids.forEach(id => { positions[id].x -= minX; positions[id].y -= minY; });
    groups.push({ ids, w: maxX - minX + 32, h: maxY - minY + 32 });
  }
  packGroups(groups, positions, input.width / Math.max(1, input.height));
  return positions;
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
          const minX = (Math.max(node.diameter + 8, node.labelWidth) + Math.max(peer.diameter + 8, peer.labelWidth)) / 2 + 6;
          const minY = (node.diameter + peer.diameter) / 2 + 18;
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

export function buildGalaxy(input: GalaxyInput): GalaxyResult {
  const neighborhoods: Record<string, string> = {};
  const positions=layoutGalaxy(input, neighborhoods);
  return {positions,routes:routeGalaxy(input,positions),components:galaxyStructure(input).components.length, neighborhoods};
}
