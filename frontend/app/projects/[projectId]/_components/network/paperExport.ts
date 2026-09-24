import type { Core, EdgeSingular, NodeCollection, NodeSingular } from "cytoscape";
import { PALETTES, DEFAULT_PALETTE, type Palette, type PaletteName } from "./theme";
import { widthEnds, type EdgeWidthBy } from "./encoding";
import { planLabels, type LabelCandidate } from "./labels";

/**
 * The network as a journal figure: one double-column panel (183 mm wide) that
 * can be placed in a paper as it is. Drawn from the live network's positions
 * and data, but in print units — names 7 pt, key 6 pt, links 0.5–2 pt — so
 * nothing depends on the screen. The file holds the figure only (network +
 * one-line key); the descriptive text goes in the copyable figure legend.
 */
export const PAPER = {
  widthMm: 183,
  maxNetworkHeightMm: 170,
  minNetworkHeightMm: 70,
  namePt: 7,
  keyPt: 6,
  linkPt: [0.5, 0.75, 1.25, 2] as const,
  marginMm: 1.5,
  pngDpi: 600,
} as const;

const PT = 25.4 / 72; // mm per point
const f = (v: number) => Number(v.toFixed(3));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
let measure: CanvasRenderingContext2D | null | undefined;
/** Width of Arial text in mm: measured in the browser, estimated elsewhere. */
function textWidth(s: string, sizeMm: number, italic = false) {
  if (measure === undefined) measure = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  if (measure) { measure.font = `${italic ? "italic " : ""}100px Arial, Helvetica, sans-serif`; return measure.measureText(s).width / 100 * sizeMm; }
  return s.length * sizeMm * 0.54;
}

export type PaperFigure = { svg: string; widthMm: number; heightMm: number };
export type PaperFigureOptions = { fontFamily?: string };

type Pt = { x: number; y: number };

function wedge(c: Pt, r: number, a0: number, a1: number, fill: string) {
  if (a1 - a0 <= 1e-6) return "";
  if (a1 - a0 >= 0.9999) return `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" fill="${fill}"/>`;
  const A = (p: number) => p * 2 * Math.PI - Math.PI / 2;
  const p0 = { x: c.x + r * Math.cos(A(a0)), y: c.y + r * Math.sin(A(a0)) }, p1 = { x: c.x + r * Math.cos(A(a1)), y: c.y + r * Math.sin(A(a1)) };
  return `<path d="M${f(c.x)} ${f(c.y)}L${f(p0.x)} ${f(p0.y)}A${f(r)} ${f(r)} 0 ${a1 - a0 > 0.5 ? 1 : 0} 1 ${f(p1.x)} ${f(p1.y)}Z" fill="${fill}"/>`;
}

function pie(c: Pt, r: number, parts: [number, number, number], shades: readonly [string, string, string], plain: string) {
  const total = parts[0] + parts[1] + parts[2];
  if (!total) return `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" fill="${plain}"/>`;
  let start = 0, out = "";
  parts.forEach((v, i) => { const p = v / total; out += wedge(c, r, start, start + p, shades[i]); start += p; });
  return out;
}

/** Arrowhead or bar at `tip`, pointing along `u`; returns [svg, how far the line must stop short]. */
function tipMark(kind: string, tip: Pt, u: Pt, widthMm: number, ink: string): [string, number] {
  const h = 1.15 + 2.1 * widthMm;
  if (kind === "triangle") {
    const b = { x: tip.x - u.x * h, y: tip.y - u.y * h }, half = h * 0.42;
    return [`<path d="M${f(tip.x)} ${f(tip.y)}L${f(b.x - u.y * half)} ${f(b.y + u.x * half)}L${f(b.x + u.y * half)} ${f(b.y - u.x * half)}Z" fill="${ink}"/>`, h * 0.85];
  }
  if (kind === "tee") {
    const half = h * 0.5;
    return [`<path d="M${f(tip.x - u.y * half)} ${f(tip.y + u.x * half)}L${f(tip.x + u.y * half)} ${f(tip.y - u.x * half)}" stroke="${ink}" stroke-width="${f(Math.max(widthMm, 0.35))}" fill="none"/>`, 0];
  }
  return ["", 0];
}

export function buildPaperFigure(source: Core, options: PaperFigureOptions = {}): PaperFigure {
  const T: Palette = PALETTES[(source.scratch("palette") ?? DEFAULT_PALETTE) as PaletteName];
  const font = options.fontFamily ?? "Arial, Helvetica, sans-serif";
  const encoding = (source.scratch("networkEncoding") ?? {}) as { widthBy?: EdgeWidthBy; methodCount?: number };
  const methodCount = encoding.methodCount ?? 1;
  const widthBy: EdgeWidthBy = encoding.widthBy === "support" && methodCount > 1 ? "support" : "evidence";

  const edges = source.edges().filter(e => !e.data("effectHidden"));
  const nodes = source.nodes().filter(n => !n.data("effectFaded") && (edges.length === 0 || n.connectedEdges().some(e => !e.data("effectHidden")))) as unknown as NodeCollection;
  if (!nodes.length) throw new Error("There is no network to export.");

  const nameMm = PAPER.namePt * PT, keyMm = PAPER.keyPt * PT;
  const netW = PAPER.widthMm - 2 * PAPER.marginMm;
  // Fit: circles and the names that may run past them stay inside the frame.
  const model = nodes.map(n => ({ n, id: n.id(), p: n.position(), r: Number(n.data("diameter")) / 2, name: String(n.data("fullLabel") ?? n.id()) }));
  let s = 1;
  for (let i = 0; i < 4; i += 1) {
    const halfX = (m: typeof model[number]) => Math.max(m.r, (textWidth(m.name, nameMm, true) / 2 + 0.4) / s);
    const x0 = Math.min(...model.map(m => m.p.x - halfX(m))), x1 = Math.max(...model.map(m => m.p.x + halfX(m)));
    const y0 = Math.min(...model.map(m => m.p.y - Math.max(m.r, nameMm / s))), y1 = Math.max(...model.map(m => m.p.y + Math.max(m.r, nameMm / s)));
    s = Math.min(netW / Math.max(1e-6, x1 - x0), PAPER.maxNetworkHeightMm / Math.max(1e-6, y1 - y0));
    if (i === 3) {
      const netH = Math.max(PAPER.minNetworkHeightMm, (y1 - y0) * s);
      const ox = PAPER.marginMm + (netW - (x1 - x0) * s) / 2 - x0 * s, oy = PAPER.marginMm + (netH - (y1 - y0) * s) / 2 - y0 * s;
      return draw(netH, (p: Pt) => ({ x: p.x * s + ox, y: p.y * s + oy }), s);
    }
  }
  throw new Error("Could not lay out the figure.");

  function draw(netH: number, at: (p: Pt) => Pt, scale: number): PaperFigure {
    const pos = new Map(model.map(m => [m.id, at(m.p)]));
    const rad = new Map(model.map(m => [m.id, m.r * scale]));
    const ink = T.activates;
    const parts: string[] = [];

    // Links: weakest first. A reciprocal pair gets two parallel lanes.
    const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
    const pairCount = new Map<string, number>();
    edges.forEach(e => { const k = pairKey(e.source().id(), e.target().id()); pairCount.set(k, (pairCount.get(k) ?? 0) + 1); });
    const ordered = edges.sort((a: EdgeSingular, b: EdgeSingular) => (Number(a.data("zIndex")) || 0) - (Number(b.data("zIndex")) || 0));
    ordered.forEach(e => {
      const sId = e.source().id(), tId = e.target().id();
      const a = pos.get(sId), b = pos.get(tId);
      if (!a || !b || sId === tId) return;
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
      const lane = (pairCount.get(pairKey(sId, tId)) ?? 1) > 1 ? (sId < tId ? 0.55 : -0.55) : 0;
      const nx = -u.y * lane, ny = u.x * lane;
      const w = PAPER.linkPt[Math.max(0, Math.min(3, Number(e.data("widthStep")) || 0))] * PT;
      const gap = 0.45;
      let start = { x: a.x + u.x * ((rad.get(sId) ?? 0) + gap) + nx, y: a.y + u.y * ((rad.get(sId) ?? 0) + gap) + ny };
      let end = { x: b.x - u.x * ((rad.get(tId) ?? 0) + gap) + nx, y: b.y - u.y * ((rad.get(tId) ?? 0) + gap) + ny };
      let marks = "";
      const tt = String(e.data("targetTip") ?? "none"), st = String(e.data("sourceTip") ?? "none");
      if (tt !== "none") { const [m, back] = tipMark(tt, end, u, w, ink); marks += m; end = { x: end.x - u.x * back, y: end.y - u.y * back }; }
      if (st !== "none") { const [m, back] = tipMark(st, start, { x: -u.x, y: -u.y }, w, ink); marks += m; start = { x: start.x + u.x * back, y: start.y + u.y * back }; }
      const dash = e.data("dashed") ? ` stroke-dasharray="${f(w * 3 + 0.8)} ${f(w * 2 + 0.6)}"` : "";
      const opacity = Number(e.data("inkOpacity"));
      parts.push(`<g${Number.isFinite(opacity) && opacity < 1 ? ` opacity="${opacity}"` : ""}><path d="M${f(start.x)} ${f(start.y)}L${f(end.x)} ${f(end.y)}" stroke="${ink}" stroke-width="${f(w)}" stroke-linecap="butt" fill="none"${dash}/>${marks}</g>`);
    });

    // Genes, with the same direction pie as on screen.
    nodes.forEach((n: NodeSingular) => {
      const c = pos.get(n.id())!, r = rad.get(n.id())!;
      const tf = Number(n.data("isTF")) === 1;
      const split = n.data("pieSize") === "100%";
      parts.push(split
        ? pie(c, r, [Number(n.data("pieOut")) || 0, Number(n.data("pieIn")) || 0, Number(n.data("pieUnknown")) || 0], tf ? T.pieTF : T.pieGene, tf ? T.tf : T.node)
        : `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" fill="${tf ? T.tf : T.node}"/>`);
    });

    // Names: every gene in small networks; in large ones, a name is dropped
    // rather than printed over another name (planned at 96 px per inch).
    const PX = 96 / 25.4;
    const candidates: LabelCandidate[] = model.map(m => {
      const c = pos.get(m.id)!;
      return { id: m.id, x: c.x * PX, y: c.y * PX, radius: (rad.get(m.id) ?? 0) * PX, width: textWidth(m.name, nameMm, true) * PX + 2, height: nameMm * 1.15 * PX, priority: 0, degree: m.n.degree(false) };
    });
    const placed = planLabels(candidates, PAPER.widthMm * PX, (netH + 2 * PAPER.marginMm) * PX, candidates.length, [], model.length <= 60);
    model.forEach(m => {
      if (!placed.has(m.id)) return;
      const c = pos.get(m.id)!;
      parts.push(`<text x="${f(c.x)}" y="${f(c.y + nameMm * 0.35)}" font-family="${font}" font-style="italic" font-size="${f(nameMm)}" text-anchor="middle" fill="${T.label}">${esc(m.name)}</text>`);
    });

    // One-line key, wrapping between groups at the figure width.
    const signs = new Set(edges.map(e => Number(e.data("sign"))));
    const undirected = edges.some(e => Number(e.data("direction")) === 0);
    const split = nodes.some(n => n.data("pieSize") === "100%");
    const faded = edges.some(e => Number(e.data("inkOpacity")) < 1);
    const hasTF = nodes.some(n => Number(n.data("isTF")) === 1), hasGene = nodes.some(n => Number(n.data("isTF")) !== 1);
    const k = keyMm;
    type Part = { w: number; draw: (x: number, y: number) => string };
    const text = (v: string, color: string = T.label): Part => ({ w: textWidth(v, k), draw: (x, y) => `<text x="${f(x)}" y="${f(y + k * 0.36)}" font-family="${font}" font-size="${f(k)}" fill="${color}">${esc(v)}</text>` });
    const dot = (color: string): Part => ({ w: k * 0.95, draw: (x, y) => `<circle cx="${f(x + k * 0.45)}" cy="${f(y)}" r="${f(k * 0.42)}" fill="${color}"/>` });
    const keyW = PAPER.linkPt[1] * PT;
    const act: Part = { w: k * 2.3, draw: (x, y) => `<path d="M${f(x)} ${f(y)}H${f(x + k * 1.5)}" stroke="${ink}" stroke-width="${f(keyW)}"/><path d="M${f(x + k * 2.3)} ${f(y)}L${f(x + k * 1.4)} ${f(y - k * 0.38)}L${f(x + k * 1.4)} ${f(y + k * 0.38)}Z" fill="${ink}"/>` };
    const rep: Part = { w: k * 2.1, draw: (x, y) => `<path d="M${f(x)} ${f(y)}H${f(x + k * 2)}M${f(x + k * 2)} ${f(y - k * 0.45)}V${f(y + k * 0.45)}" stroke="${ink}" stroke-width="${f(keyW)}" fill="none"/>` };
    const plain: Part = { w: k * 2.1, draw: (x, y) => `<path d="M${f(x)} ${f(y)}H${f(x + k * 2)}" stroke="${ink}" stroke-width="${f(keyW)}"/>` };
    const dashed: Part = { w: k * 2.4, draw: (x, y) => `<path d="M${f(x)} ${f(y)}H${f(x + k * 2.4)}" stroke="${ink}" stroke-width="${f(keyW)}" stroke-dasharray="${f(keyW * 3 + 0.8)} ${f(keyW * 2 + 0.6)}"/>` };
    const pieMark: Part = { w: k * 1.2, draw: (x, y) => pie({ x: x + k * 0.6, y }, k * 0.58, [0.7, 0.3, 0], T.pieTF, T.tf) };
    const widths: Part = { w: k * 5.4, draw: (x, y) => PAPER.linkPt.map((pt, i) => `<path d="M${f(x + i * k * 1.35)} ${f(y)}H${f(x + i * k * 1.35 + k)}" stroke="${ink}" stroke-width="${f(pt * PT)}"/>`).join("") };
    const fades: Part = { w: k * 4, draw: (x, y) => [0.15, 0.45, 1].map((o, i) => `<path d="M${f(x + i * k * 1.35)} ${f(y)}H${f(x + i * k * 1.35 + k)}" stroke="${ink}" stroke-width="${f(PAPER.linkPt[2] * PT)}" opacity="${o}"/>`).join("") };
    // Plain ASCII/Latin-1 ends so the standard PDF fonts can set them.
    const [low, high] = widthBy === "support" ? widthEnds(widthBy, methodCount) : ["<0.5", "0.9–1"];
    const groups: Part[][] = [
      [...(hasTF ? [dot(T.tf), text("TF")] : []), ...(hasGene ? [dot(T.node), text("Other gene")] : [])],
      [...(signs.has(1) ? [act, text("Activation")] : []), ...(signs.has(-1) ? [rep, text("Repression")] : []), ...(signs.has(0) ? [plain, text("Sign unknown")] : []), ...(undirected ? [dashed, text("Direction unknown")] : [])],
      ...(split ? [[pieMark, text("dark regulates · light regulated by")]] : []),
      [text(widthBy === "support" ? "Methods" : "Evidence", "#8a949e"), text(low), widths, text(high)],
      ...(faded ? [[text("Confidence", "#8a949e"), text("<0.5"), fades, text("0.8–1")]] : []),
    ].filter(g => g.length);
    const gap = k * 0.45, pad = k * 1.6, lineH = k * 1.9;
    const rows: Part[][][] = [[]];
    let used = 0;
    const gw = (g: Part[]) => g.reduce((sum, p) => sum + p.w, 0) + gap * (g.length - 1);
    groups.forEach(g => {
      const row = rows[rows.length - 1];
      const need = gw(g) + (row.length ? pad : 0);
      if (row.length && used + need > netW) { rows.push([g]); used = gw(g); } else { row.push(g); used += need; }
    });
    const keyTop = PAPER.marginMm + netH + k * 1.4;
    rows.forEach((row, r) => {
      let x = PAPER.marginMm + 0.5;
      const y = keyTop + r * lineH;
      row.forEach((g, gi) => {
        if (gi) x += pad;
        g.forEach((p, pi) => { parts.push(p.draw(x, y)); x += p.w + (pi < g.length - 1 ? gap : 0); });
      });
    });
    const height = keyTop + (rows.length - 1) * lineH + k * 0.8 + PAPER.marginMm;
    const W = PAPER.widthMm;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${f(height)}mm" viewBox="0 0 ${W} ${f(height)}">`
      + `<title>Gene regulatory network</title><rect width="${W}" height="${f(height)}" fill="#ffffff"/>${parts.join("")}</svg>`;
    return { svg, widthMm: W, heightMm: height };
  }
}

// ---- File formats ------------------------------------------------------

export async function paperFigurePdf(source: Core): Promise<Blob> {
  // svg2pdf maps Arial to jsPDF's built-in Helvetica, which has the same metrics.
  const figure = buildPaperFigure(source);
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const doc = new jsPDF({ unit: "mm", format: [figure.widthMm, figure.heightMm], orientation: figure.widthMm > figure.heightMm ? "landscape" : "portrait", compress: true });
  doc.setProperties({ title: "Gene regulatory network", creator: "GRNScope" });
  const element = new DOMParser().parseFromString(figure.svg, "image/svg+xml").documentElement as unknown as Element;
  await svg2pdf(element, doc, { x: 0, y: 0, width: figure.widthMm, height: figure.heightMm });
  return doc.output("blob");
}

export function paperFigureSvg(source: Core): Blob {
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${buildPaperFigure(source).svg}`], { type: "image/svg+xml;charset=utf-8" });
}

export async function paperFigurePng(source: Core, dpi: number = PAPER.pngDpi): Promise<Blob> {
  const figure = buildPaperFigure(source);
  const url = URL.createObjectURL(new Blob([figure.svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Could not render the figure.")); image.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(figure.widthMm / 25.4 * dpi);
    canvas.height = Math.round(figure.heightMm / 25.4 * dpi);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image export is unavailable.");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("Could not encode the image.")), "image/png"));
    return withPngDpi(blob, dpi);
  } finally { URL.revokeObjectURL(url); }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Record the resolution in the PNG (pHYs), so Word and journals place it at
 * its true size (183 mm) instead of assuming 72 or 96 dpi. */
export async function withPngDpi(png: Blob, dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await png.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, ppm); view.setUint32(12, ppm); chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const ihdrEnd = 8 + 8 + 13 + 4; // signature + IHDR (length, type, 13 data bytes, CRC)
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(bytes.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return new Blob([out], { type: "image/png" });
}
