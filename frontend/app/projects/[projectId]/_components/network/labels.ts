import type { Core, NodeSingular } from "cytoscape";

export type Rect = { x1: number; x2: number; y1: number; y2: number };
export type LabelCandidate = { id: string; x: number; y: number; radius: number; width: number; height: number; priority: number; degree: number };
type Placement = { rect: Rect; side: "center" };
export const labelsOverlap = (a: Rect, b: Rect) => a.x1 < b.x2 + 4 && b.x1 < a.x2 + 4 && a.y1 < b.y2 + 3 && b.y1 < a.y2 + 3;

/** Names sit centred inside their node and may overflow its rim. Placement
 * only decides *which* names are shown: a name is dropped rather than printed
 * over another name or across another gene's disc. With `always`, every name
 * in the budget is shown (small networks, where each gene must be named). */
export function planLabels(candidates: LabelCandidate[], width: number, height: number, budget: number, reserved: Rect[] = [], always = false): Map<string, Placement> {
  const placed = new Map<string, Placement>();
  const grid = new Map<string, LabelCandidate[]>();
  let maxRadius = 0;
  for (const n of candidates) {
    const key = `${Math.floor(n.x/64)},${Math.floor(n.y/64)}`;
    const bucket = grid.get(key) ?? []; bucket.push(n); grid.set(key,bucket);
    maxRadius = Math.max(maxRadius,n.radius+3);
  }
  const touchesNode = (r: Rect, id: string) => {
    for (let x=Math.floor((r.x1-maxRadius)/64);x<=Math.floor((r.x2+maxRadius)/64);x++) {
      for (let y=Math.floor((r.y1-maxRadius)/64);y<=Math.floor((r.y2+maxRadius)/64);y++) {
        for (const n of grid.get(`${x},${y}`) ?? []) {
          if (n.id === id) continue;
          const px=Math.max(r.x1,Math.min(r.x2,n.x)),py=Math.max(r.y1,Math.min(r.y2,n.y));
          if (Math.hypot(px-n.x,py-n.y)<n.radius+3) return true;
        }
      }
    }
    return false;
  };
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority || b.radius - a.radius || b.degree - a.degree || a.id.localeCompare(b.id));
  for (const n of ordered) {
    if (placed.size >= budget) break;
    if (n.x < 0 || n.x > width || n.y < 0 || n.y > height) continue;
    const rect = { x1: n.x-n.width/2, x2: n.x+n.width/2, y1: n.y-n.height/2, y2: n.y+n.height/2 };
    const fits = always || (!reserved.some(other => labelsOverlap(rect,other))
      && ![...placed.values()].some(p => labelsOverlap(rect, p.rect))
      && (n.priority >= 5 || !touchesNode(rect,n.id)));  // a pinned name may cross a disc, never another name
    if (fits) placed.set(n.id, { side: "center", rect });
  }
  return placed;
}

export function applyLabelBudget(cy: Core) {
  if (cy.destroyed()) return;
  const zoom = cy.zoom(), nodes = cy.nodes();
  const relative = zoom / (Number(cy.scratch("galaxyFitZoom")) || zoom);
  const pinned = new Set<string>(cy.scratch("publicationPins") ?? []);
  const always = nodes.length <= 60;
  const budget = always ? nodes.length : Math.max(pinned.size, Math.ceil(Math.min(55, Math.sqrt(nodes.length) * 2.2) * Math.max(1, relative)));
  // Canvas text metrics match the renderer's face and weight. The fallback is
  // conservative and also supports headless geometry/export tests.
  let measure = cy.scratch("galaxyLabelMeasure") as CanvasRenderingContext2D | undefined;
  if (!measure && cy.container()) {
    measure = cy.container()!.ownerDocument.createElement("canvas").getContext("2d") ?? undefined;
    cy.scratch("galaxyLabelMeasure", measure);
  }
  const priority = (n: NodeSingular) => pinned.has(n.id()) ? 5 : n.hasClass("traced") || n.selected() ? 4 : n.hasClass("hovered") ? 3 : n.hasClass("traced-neighbour") ? 2 : n.data("layoutAnchor") ? 1 : 0;
  const candidates = nodes.map(n => {
    const font = Number(n.data("labelSize"))*zoom, text = String(n.data("fullLabel"));
    if (measure) measure.font = `italic ${Number(n.data("diameter")) > 60 ? 600 : 400} ${font}px Arial`;
    return { id: n.id(), ...n.renderedPosition(), radius: n.renderedOuterWidth()/2,
      width: (measure?.measureText(text).width ?? text.length*font*0.62)+2, height: font*1.2,
      degree: Number(n.data("degree")), priority: priority(n) };
  });
  const bounds = cy.container()?.getBoundingClientRect();
  const reserved = bounds ? Array.from(cy.container()!.parentElement?.querySelectorAll(".galaxy-caption, .galaxy-controls") ?? []).map(element => {
    const rect=element.getBoundingClientRect();
    return { x1: rect.left-bounds.left, x2: rect.right-bounds.left, y1: rect.top-bounds.top, y2: rect.bottom-bounds.top };
  }) : [];
  const placements = planLabels(candidates, cy.width(), cy.height(), budget, reserved, always);
  cy.batch(() => nodes.forEach(n => {
    const p = placements.get(n.id());
    const data = { label: p ? n.data("fullLabel") : "", labelHalign: "center", labelValign: "center", labelOffsetX: 0, labelOffsetY: 0 };
    if (Object.entries(data).some(([key,value]) => n.data(key) !== value)) n.data(data);
  }));
}

type Circle = { x: number; y: number; r: number };
/** A link as rendered: midpoint, unit normal, half its drawn width and its two genes. */
export type LinkLabelGeometry = { x: number; y: number; nx: number; ny: number; halfWidth: number; ends: [Circle, Circle] };

/** Top-left corner for a w×h label beside a link: pushed off the midpoint
 * along the link's normal until the box clears the line, on whichever side
 * keeps it inside the canvas and off the two genes. */
export function placeLinkLabel(tip: LinkLabelGeometry, w: number, h: number, bounds: { width: number; height: number }) {
  const margin = 6, gap = 8 + tip.halfWidth;
  const clear = Math.abs(tip.nx) * w / 2 + Math.abs(tip.ny) * h / 2 + gap;
  const overlapCircle = (left: number, top: number, c: Circle) => {
    const dx = Math.max(left - c.x, 0, c.x - (left + w)), dy = Math.max(top - c.y, 0, c.y - (top + h));
    return Math.max(0, c.r + 4 - Math.hypot(dx, dy));
  };
  let best = { left: 0, top: 0, cost: Infinity };
  for (const push of [1, 1.6, 2.4]) {
    for (const side of [1, -1]) {
      const cx = tip.x + side * tip.nx * clear * push, cy = tip.y + side * tip.ny * clear * push;
      const left = cx - w / 2, top = cy - h / 2;
      const outside = Math.max(0, margin - left) + Math.max(0, left + w - bounds.width + margin) + Math.max(0, margin - top) + Math.max(0, top + h - bounds.height + margin);
      const cost = outside * 4 + overlapCircle(left, top, tip.ends[0]) + overlapCircle(left, top, tip.ends[1]) + (push - 1) * 2;
      if (cost < best.cost) best = { left, top, cost };
    }
    if (best.cost < 1) break;
  }
  return {
    left: Math.min(Math.max(best.left, margin), Math.max(margin, bounds.width - w - margin)),
    top: Math.min(Math.max(best.top, margin), Math.max(margin, bounds.height - h - margin)),
  };
}

type Segment = { x1: number; y1: number; x2: number; y2: number };
/** A gene as rendered: centre, radius, its links and its partner genes. */
export type GeneLabelGeometry = { x: number; y: number; r: number; links: Segment[]; genes: Circle[] };

/** Length of a segment inside a box (Liang-Barsky clipping). */
function lengthInside(s: Segment, left: number, top: number, w: number, h: number) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, s.x1 - left], [dx, left + w - s.x1], [-dy, s.y1 - top], [dy, top + h - s.y1]] as const) {
    if (p === 0) { if (q < 0) return 0; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return 0; t0 = Math.max(t0, t); } else { if (t < t0) return 0; t1 = Math.min(t1, t); }
  }
  return t1 > t0 ? (t1 - t0) * Math.hypot(dx, dy) : 0;
}

/** Top-left corner for a w×h label next to a hovered gene: tried above first,
 * then round the gene, on the spot that covers the least of the gene's links
 * and partners and stays inside the canvas. */
export function placeGeneLabel(gene: GeneLabelGeometry, w: number, h: number, bounds: { width: number; height: number }) {
  const margin = 6, gap = 8;
  const angles = [-90, -60, -120, -30, -150, 0, 180, 30, 150, 60, 120, 90];
  let best = { left: 0, top: 0, cost: Infinity };
  angles.forEach((deg, rank) => {
    for (const push of [1, 1.3]) {
      const a = deg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
      const d = (gene.r + gap + Math.abs(ux) * w / 2 + Math.abs(uy) * h / 2) * push;
      const left = gene.x + ux * d - w / 2, top = gene.y + uy * d - h / 2;
      const outside = Math.max(0, margin - left) + Math.max(0, left + w - bounds.width + margin) + Math.max(0, margin - top) + Math.max(0, top + h - bounds.height + margin);
      const covered = gene.links.reduce((sum, s) => sum + lengthInside(s, left - 3, top - 3, w + 6, h + 6), 0);
      const genes = gene.genes.reduce((sum, c) => {
        const dx = Math.max(left - c.x, 0, c.x - (left + w)), dy = Math.max(top - c.y, 0, c.y - (top + h));
        return sum + Math.max(0, c.r + 3 - Math.hypot(dx, dy));
      }, 0);
      const cost = outside * 4 + covered + genes * 2 + rank * 1.5 + (push - 1) * 60;
      if (cost < best.cost) best = { left, top, cost };
    }
  });
  return {
    left: Math.min(Math.max(best.left, margin), Math.max(margin, bounds.width - w - margin)),
    top: Math.min(Math.max(best.top, margin), Math.max(margin, bounds.height - h - margin)),
  };
}
