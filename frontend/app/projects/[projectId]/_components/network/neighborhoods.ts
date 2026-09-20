import cytoscape from "cytoscape";
import type { GalaxyInput, Point } from "./galaxyGeometry";

/** Connected, bounded regions for drawing only — not inferred communities.
 * High-degree seeds establish local landmarks; frontier affinity grows each
 * region without allowing one giant hub to absorb the complete skeleton. */
export function partitionSkeleton(ids: string[], neighbors: Map<string, Set<string>>) {
  const available = new Set(ids);
  const ordered = [...ids].sort((a,b) => neighbors.get(b)!.size-neighbors.get(a)!.size || a.localeCompare(b));
  const limit = Math.max(24, Math.min(48, Math.ceil(Math.sqrt(ids.length)*1.6)));
  const groups: string[][] = [];
  for (const seed of ordered) {
    if (!available.has(seed)) continue;
    const group: string[] = [], frontier = new Map<string, number>();
    let next: string | undefined = seed;
    while (next && group.length < limit) {
      group.push(next); available.delete(next); frontier.delete(next);
      for (const peer of neighbors.get(next)!) if (available.has(peer)) frontier.set(peer, (frontier.get(peer) ?? 0)+1);
      next = [...frontier.keys()].sort((a,b) => frontier.get(b)!/Math.sqrt(neighbors.get(b)!.size)-frontier.get(a)!/Math.sqrt(neighbors.get(a)!.size) || a.localeCompare(b))[0];
    }
    groups.push(group);
  }
  // Absorb tiny boundary fragments only into an adjacent, bounded region.
  const owner = new Map(groups.flatMap((g,i) => g.map(id => [id,i] as const)));
  for (let i=groups.length-1;i>=0;i--) {
    if (groups[i].length >= 10) continue;
    const affinity = new Map<number, number>();
    for (const id of groups[i]) for (const peer of neighbors.get(id)!) {
      const j = owner.get(peer);
      if (j !== undefined && j !== i && groups[j].length+groups[i].length <= limit*1.5) affinity.set(j,(affinity.get(j) ?? 0)+1);
    }
    const target = [...affinity.keys()].sort((a,b) => affinity.get(b)!-affinity.get(a)! || a-b)[0];
    if (target !== undefined) {
      groups[i].forEach(id => owner.set(id,target));
      groups[target].push(...groups[i]); groups[i] = [];
    }
  }
  return groups.filter(g => g.length);
}

export function layoutNeighborhoods(input: GalaxyInput, groups: string[][], localLayout: (input: GalaxyInput) => Record<string, Point>) {
  const owner = new Map(groups.flatMap((ids,i) => ids.map(id => [id,i] as const)));
  const positions: Record<string, Point> = {};
  const boxes = groups.map((ids,i) => {
    const subset = new Set(ids);
    const nodes = input.nodes.filter(n => subset.has(n.id));
    const edges = input.edges.filter(e => subset.has(e.source) && subset.has(e.target));
    const local = localLayout({ ...input, nodes, edges, width: 900, height: 650 });
    Object.assign(positions, local);
    const x1 = Math.min(...nodes.map(n => local[n.id].x-Math.max(n.diameter,n.labelWidth)/2));
    const x2 = Math.max(...nodes.map(n => local[n.id].x+Math.max(n.diameter,n.labelWidth)/2));
    const y1 = Math.min(...nodes.map(n => local[n.id].y-n.diameter/2));
    const y2 = Math.max(...nodes.map(n => local[n.id].y+n.diameter/2+18));
    ids.forEach(id => { positions[id].x -= (x1+x2)/2; positions[id].y -= (y1+y2)/2; });
    return { id: `region-${i}`, w: x2-x1+160, h: y2-y1+160 };
  });
  const links = new Map<string, { source: string; target: string; count: number }>();
  for (const e of input.edges) {
    const a = owner.get(e.source), b = owner.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const pair = [a,b].sort((x,y) => x-y), key = pair.join(":");
    const link = links.get(key) ?? { source: `region-${pair[0]}`, target: `region-${pair[1]}`, count: 0 };
    link.count++; links.set(key,link);
  }
  const elements: cytoscape.ElementDefinition[] = boxes.map((box,i) => ({ data: box, position: { x: Math.cos(i*2.399963)*500*Math.sqrt(i+1), y: Math.sin(i*2.399963)*500*Math.sqrt(i+1) } }));
  links.forEach((data,id) => elements.push({ data: { ...data, id: `link-${id}` } }));
  const solver = cytoscape({ headless: true, styleEnabled: true, elements, layout: { name: "preset" }, style: [{ selector: "node", style: { width: "data(w)", height: "data(h)", shape: "rectangle", label: "" } }] });
  const centers: Point[] = [];
  try {
    solver.layout({ name: "fcose", quality: "proof", randomize: false, animate: false, fit: false, tile: false, packComponents: false,
      idealEdgeLength: 200, nodeRepulsion: 24000, edgeElasticity: 0.12, gravity: 0.08, numIter: 1400,
    } as unknown as cytoscape.LayoutOptions).run();
    boxes.forEach(box => centers.push({ ...solver.$id(box.id).position() }));
  } finally { solver.destroy(); }
  // Guarantee full region rectangles remain separate after the coarse solve.
  for (let pass=0;pass<100;pass++) {
    let overlaps = 0;
    for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
      const a=centers[i], b=centers[j], dx=a.x-b.x, dy=a.y-b.y;
      const ox=(boxes[i].w+boxes[j].w)/2-Math.abs(dx), oy=(boxes[i].h+boxes[j].h)/2-Math.abs(dy);
      if (ox<=0 || oy<=0) continue;
      overlaps++;
      if (ox<oy) { const d=(ox/2+1)*(dx>=0?1:-1); a.x+=d; b.x-=d; }
      else { const d=(oy/2+1)*(dy>=0?1:-1); a.y+=d; b.y-=d; }
    }
    if (!overlaps) break;
  }
  groups.forEach((ids,i) => ids.forEach(id => { positions[id].x+=centers[i].x; positions[id].y+=centers[i].y; }));
  return positions;
}
