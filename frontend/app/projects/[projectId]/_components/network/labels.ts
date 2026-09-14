import type { Core, NodeSingular } from "cytoscape";

export type Rect = { x1: number; x2: number; y1: number; y2: number };
export type LabelCandidate = { id: string; x: number; y: number; radius: number; width: number; height: number; priority: number; degree: number };
type Placement = { rect: Rect; side: "bottom" | "top" | "left" | "right" };
export const labelsOverlap = (a: Rect, b: Rect) => a.x1 < b.x2 + 4 && b.x1 < a.x2 + 4 && a.y1 < b.y2 + 3 && b.y1 < a.y2 + 3;

/** Even selected neighbours obey collision checks. Selection changes priority,
 * never forces hundreds of names through the same space. */
export function planLabels(candidates: LabelCandidate[], width: number, height: number, budget: number, reserved: Rect[] = []): Map<string, Placement> {
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
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority || b.degree - a.degree || a.id.localeCompare(b.id));
  for (const n of ordered) {
    if (placed.size >= budget) break;
    if (n.x < 0 || n.x > width || n.y < 0 || n.y > height) continue;
    const gap = n.radius + 5;
    const choices: Placement[] = [
      { side: "bottom", rect: { x1: n.x-n.width/2, x2: n.x+n.width/2, y1: n.y+gap, y2: n.y+gap+n.height } },
      { side: "top", rect: { x1: n.x-n.width/2, x2: n.x+n.width/2, y1: n.y-gap-n.height, y2: n.y-gap } },
      { side: "right", rect: { x1: n.x+gap, x2: n.x+gap+n.width, y1: n.y-n.height/2, y2: n.y+n.height/2 } },
      { side: "left", rect: { x1: n.x-gap-n.width, x2: n.x-gap, y1: n.y-n.height/2, y2: n.y+n.height/2 } },
    ];
    const choice = choices.find(({ rect: r }) => r.x1 >= 4 && r.y1 >= 4 && r.x2 <= width-4 && r.y2 <= height-4
      && !reserved.some(other => labelsOverlap(r,other))
      && ![...placed.values()].some(p => labelsOverlap(r, p.rect))
      && !touchesNode(r,n.id));
    if (choice) placed.set(n.id, choice);
  }
  return placed;
}

export function applyLabelBudget(cy: Core) {
  if (cy.destroyed()) return;
  const zoom = cy.zoom(), nodes = cy.nodes();
  const relative = zoom / (Number(cy.scratch("galaxyFitZoom")) || zoom);
  const budget = nodes.length <= 100 ? nodes.length : Math.ceil(Math.min(90, Math.sqrt(nodes.length)*4.5) * Math.max(1, relative));
  // Canvas text metrics match the renderer's face and weight. The fallback is
  // conservative and also supports headless geometry/export tests.
  let measure = cy.scratch("galaxyLabelMeasure") as CanvasRenderingContext2D | undefined;
  if (!measure && cy.container()) {
    measure = cy.container()!.ownerDocument.createElement("canvas").getContext("2d") ?? undefined;
    cy.scratch("galaxyLabelMeasure", measure);
  }
  const priority = (n: NodeSingular) => n.hasClass("traced") || n.selected() ? 4 : n.hasClass("hovered") ? 3 : n.hasClass("traced-neighbour") ? 2 : n.data("layoutAnchor") ? 1 : 0;
  const candidates = nodes.map(n => {
    const font = Number(n.data("labelSize"))*zoom, text = String(n.data("fullLabel"));
    if (measure) measure.font = `${Number(n.data("degree")) > 8 ? 600 : 400} ${font}px Arial`;
    return { id: n.id(), ...n.renderedPosition(), radius: n.renderedOuterWidth()/2,
      width: (measure?.measureText(text).width ?? text.length*font*0.65)+3, height: font*1.35,
      degree: Number(n.data("degree")), priority: priority(n) };
  });
  const bounds = cy.container()?.getBoundingClientRect();
  const reserved = bounds ? Array.from(cy.container()!.parentElement?.querySelectorAll(".galaxy-caption, .galaxy-controls") ?? []).map(element => {
    const rect=element.getBoundingClientRect();
    return { x1: rect.left-bounds.left, x2: rect.right-bounds.left, y1: rect.top-bounds.top, y2: rect.bottom-bounds.top };
  }) : [];
  const placements = planLabels(candidates, cy.width(), cy.height(), budget, reserved);
  cy.batch(() => nodes.forEach(n => {
    const p = placements.get(n.id()), side = p?.side ?? "bottom";
    const data = { label: p ? n.data("fullLabel") : "",
      labelHalign: side === "left" || side === "right" ? side : "center",
      labelValign: side === "bottom" || side === "top" ? side : "center",
      labelOffsetX: (side === "left" ? -5 : side === "right" ? 5 : 0)/zoom,
      labelOffsetY: (side === "top" ? -5 : side === "bottom" ? 5 : 0)/zoom,
    };
    if (Object.entries(data).some(([key,value]) => n.data(key) !== value)) n.data(data);
  }));
}
