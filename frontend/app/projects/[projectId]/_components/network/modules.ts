import type { Core } from "cytoscape";
import { NETWORK_THEME as T } from "./theme";
import { layoutBackbone } from "./galaxyGeometry";

type Point = { x: number; y: number };
export type Module = { id: number; members: string[]; label: string };

/** Louvain-style local moving (Blondel et al. 2008), one level, deterministic:
 * genes are visited in a fixed order and join the neighbouring group with the
 * largest modularity gain. Links are weighted by evidence. These are groups of
 * densely connected genes in the drawn network, not biological pathways. */
export function detectModules(ids: string[], edges: Array<{ source: string; target: string; weight: number }>, minSize = 4): Module[] {
  if (ids.length < 8 || ids.length > 600) return [];
  const index = new Map(ids.map((id, i) => [id, i]));
  const adj: Array<Map<number, number>> = ids.map(() => new Map());
  let total = 0;
  for (const e of edges) {
    const a = index.get(e.source), b = index.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const w = Math.max(0.05, e.weight || 0);
    adj[a].set(b, (adj[a].get(b) ?? 0) + w); adj[b].set(a, (adj[b].get(a) ?? 0) + w);
    total += w;
  }
  if (!total) return [];
  const m2 = 2 * total;
  const k = adj.map(nb => [...nb.values()].reduce((s, w) => s + w, 0));
  const community = ids.map((_, i) => i);
  const tot = k.slice();
  for (let pass = 0; pass < 20; pass++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      const own = community[i];
      const links = new Map<number, number>();
      for (const [j, w] of adj[i]) links.set(community[j], (links.get(community[j]) ?? 0) + w);
      tot[own] -= k[i];
      let best = own, bestGain = (links.get(own) ?? 0) - tot[own] * k[i] / m2;
      for (const [c, w] of [...links].sort((x, y) => x[0] - y[0])) {
        const gain = w - tot[c] * k[i] / m2;
        if (gain > bestGain + 1e-12) { best = c; bestGain = gain; }
      }
      tot[best] += k[i];
      if (best !== own) { community[i] = best; moved = true; }
    }
    if (!moved) break;
  }
  const groups = new Map<number, string[]>();
  community.forEach((c, i) => { const g = groups.get(c) ?? []; g.push(ids[i]); groups.set(c, g); });
  const kept = [...groups.values()].filter(g => g.length >= minSize).sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  if (kept.length < 2) return [];
  return kept.map((members, id) => ({ id, members, label: "" }));
}

/** Name each group after its best-connected transcription factor (or gene). */
export function labelModules(modules: Module[], degree: (id: string) => number, isTF: (id: string) => boolean): Module[] {
  return modules.map(m => {
    const pool = m.members.some(isTF) ? m.members.filter(isTF) : m.members;
    const lead = [...pool].sort((a, b) => degree(b) - degree(a) || a.localeCompare(b))[0];
    return { ...m, label: lead };
  });
}

function convexHull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [], upper: Point[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** A soft, rounded hull around a group's discs, in model coordinates. */
type Anchor = Point & { side: "top" | "bottom" | "left" | "right" };
export function modulePath(circles: Array<Point & { r: number }>, pad = 18): { d: string; top: Point; anchors: Anchor[] } | null {
  const pts: Point[] = [];
  for (const c of circles) for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; pts.push({ x: c.x + Math.cos(a) * (c.r + pad), y: c.y + Math.sin(a) * (c.r + pad) }); }
  const hull = convexHull(pts);
  if (hull.length < 3) return null;
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const f = (v: number) => v.toFixed(1);
  let d = "";
  hull.forEach((p, i) => {
    const next = hull[(i + 1) % hull.length], m = mid(p, next);
    if (!i) { const start = mid(hull[hull.length - 1], p); d += `M${f(start.x)} ${f(start.y)}`; }
    d += `Q${f(p.x)} ${f(p.y)} ${f(m.x)} ${f(m.y)}`;
  });
  const top = hull.reduce((best, p) => p.y < best.y ? p : best, hull[0]);
  const bottom = hull.reduce((best, p) => p.y > best.y ? p : best, hull[0]);
  const left = hull.reduce((best, p) => p.x < best.x ? p : best, hull[0]);
  const right = hull.reduce((best, p) => p.x > best.x ? p : best, hull[0]);
  return { d: d + "Z", top, anchors: [{ ...top, side: "top" }, { ...bottom, side: "bottom" }, { ...left, side: "left" }, { ...right, side: "right" }] };
}

/** SVG markup for the group shading: hulls in model space under one
 * transform, names in screen space at a constant size. */
export function moduleMarkup(cy: Core, modules: Module[], zoom: number, pan: Point, fontPx = 11): string {
  if (!modules.length) return "";
  let hulls = "", labels = "";
  // A group's name goes on the first side of its shading where it touches no
  // gene and no other group's name; if every side is taken it is left out.
  const discs = cy.nodes().map(n => ({ x: n.position().x * zoom + pan.x, y: n.position().y * zoom + pan.y, r: Number(n.data("diameter")) / 2 * zoom }));
  const taken: Array<{ x1: number; x2: number; y1: number; y2: number }> = [];
  for (const m of modules) {
    const circles = m.members.map(id => cy.$id(id)).filter(n => n.nonempty()).map(n => ({ ...n.position(), r: Number(n.data("diameter")) / 2 }));
    const shape = circles.length >= 3 ? modulePath(circles) : null;
    if (!shape) continue;
    hulls += `<path d="${shape.d}" fill="${T.module}" fill-opacity="0.75"/>`;
    const w = m.label.length * fontPx * 0.58, h = fontPx * 1.1;
    for (const a of shape.anchors) {
      const x = a.x * zoom + pan.x, y = a.y * zoom + pan.y;
      const cx = a.side === "left" ? x - 6 - w / 2 : a.side === "right" ? x + 6 + w / 2 : x;
      const cy2 = a.side === "top" ? y - 6 - h / 2 : a.side === "bottom" ? y + 6 + h / 2 : y;
      const box = { x1: cx - w / 2, x2: cx + w / 2, y1: cy2 - h / 2, y2: cy2 + h / 2 };
      const hitsGene = discs.some(c => Math.hypot(Math.max(box.x1, Math.min(box.x2, c.x)) - c.x, Math.max(box.y1, Math.min(box.y2, c.y)) - c.y) < c.r + 3);
      const hitsName = taken.some(t => box.x1 < t.x2 && t.x1 < box.x2 && box.y1 < t.y2 && t.y1 < box.y2);
      if (hitsGene || hitsName) continue;
      taken.push(box);
      labels += `<text x="${cx.toFixed(1)}" y="${(cy2 + fontPx * 0.35).toFixed(1)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-style="italic" font-size="${fontPx}" fill="#7a8791">${m.label}</text>`;
      break;
    }
  }
  return `<g transform="translate(${pan.x.toFixed(2)} ${pan.y.toFixed(2)}) scale(${zoom})">${hulls}</g>${labels}`;
}

/** Compute and cache the groups for the elements currently drawn. */
export function computeModules(cy: Core): Module[] {
  const ids = cy.nodes().map(n => n.id());
  // Group on the same backbone that positions the genes, so every group is
  // also a compact region of the drawing.
  const backbone = layoutBackbone({
    nodes: cy.nodes().map(n => ({ id: n.id(), diameter: 0, labelWidth: 0 })),
    edges: cy.edges().map(e => ({ id: e.id(), source: e.source().id(), target: e.target().id(), sign: 0, direction: 0, weight: Number(e.data("evidence")) || 0 })),
    width: 0, height: 0,
  });
  const edges = backbone.edges.map(e => ({ source: e.source, target: e.target, weight: e.weight ?? 0 }));
  const modules = labelModules(detectModules(ids, edges), id => Number(cy.$id(id).data("degree")) || 0, id => cy.$id(id).data("isTF") === 1);
  cy.scratch("networkModules", modules);
  return modules;
}
