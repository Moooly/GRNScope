import cytoscape, { type Core } from "cytoscape";
import type { NetworkFigureContext } from "../networkFigureExport";
import { NETWORK_THEME as T } from "./theme";
import { buildNetworkStylesheet } from "./stylesheet";
import { applyPresentation } from "./presentation";
import { CONFIDENCE_OPACITY, NODE_SIZE_OPTIONS, WIDTH_STEPS, widthEnds, type EdgeWidthBy, type NodeSizeBy } from "./encoding";

const NS = "http://www.w3.org/2000/svg";
const WIDTH = 1200;
const GRAPH_HEIGHT = 760;

/** Export a separate, fitted copy: selections, hover, viewport cropping and
 * export-time typography never mutate the interactive network. */
export async function buildPublicationFigure(source: Core, context: NetworkFigureContext): Promise<string> {
  const host = document.createElement("div");
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", width: `${WIDTH}px`, height: `${GRAPH_HEIGHT}px`, pointerEvents: "none" });
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);
  let graph: Core | undefined;
  try {
    graph = cytoscape({ container: host, style: buildNetworkStylesheet(),
      elements: source.elements().map(element => ({ data: { ...element.data(), label: "" }, ...(element.isNode() ? { position: { ...element.position() } } : {}) })),
      layout: { name: "preset" }, minZoom: 0.0001, maxZoom: 1.5, pixelRatio: 1,
    });
    const pins: string[] = (source.scratch("publicationPins") ?? []).filter((id: string) => !source.$id(id).empty());
    graph.scratch("publicationPins", pins);
    graph.scratch("publicationExport", true);
    graph.fit(graph.nodes(), 90);
    graph.scratch("galaxyFitZoom", graph.zoom());
    applyPresentation(graph, true);
    // The same chosen labels are embedded as vector text in both formats.
    const { default: plugin } = await import("cytoscape-svg");
    plugin(cytoscape);
    const parsed = new DOMParser().parseFromString(graph.svg({ full: false, scale: 1 }), "image/svg+xml");
    if (parsed.querySelector("parsererror")) throw new Error("Could not create the vector figure.");

    const svg = document.createElementNS(NS, "svg");
    const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const element = document.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
      if (text !== undefined) element.textContent = text;
      svg.appendChild(element); return element;
    };
    const text = (x: number, y: number, value: string, size = 17) => add("text", { x, y, fill: T.label, "font-family": "Arial, Helvetica, sans-serif", "font-size": size }, value);
    const encoding = (source.scratch("networkEncoding") ?? {}) as { sizeBy?: NodeSizeBy; widthBy?: EdgeWidthBy; methodCount?: number };
    const sizeBy = encoding.sizeBy ?? "all", methodCount = encoding.methodCount ?? context.methodCount ?? 1;
    const widthBy: EdgeWidthBy = encoding.widthBy === "support" && methodCount > 1 ? "support" : "evidence";
    const hasConfidence = source.edges().some(e => typeof e.data("confidence") === "number");
    const descriptions = [
      `${context.scope} · ${source.nodes().length} genes · ${source.edges().length} of ${context.matchingEdges} matching relationships`,
      `Methods (${context.methodCount}): ${context.methods.join(", ")}`,
      `Filters: ${context.filters || "None"}${context.focus ? ` · Neighborhood: ${context.focus}` : ""}`,
      `Selection: ${context.selectionRule || "Displayed relationships"}`,
      `Orange circles are transcription factors; grey circles are other genes. Node diameter runs linearly (1:10) from the smallest to the largest value of ${sizeBy === "out" ? "the number of displayed genes each gene regulates" : sizeBy === "in" ? "the number of displayed regulators of each gene" : "displayed connections"}. Layout distance represents connectivity, not biological distance; connected genes are drawn a fixed rim-to-rim distance apart where the topology allows; in dense networks each gene is placed by its three strongest links. Links passing under an unrelated gene are drawn lighter.`,
      "Blue = activation (arrowhead), red = repression (bar), grey = sign unknown (hollow arrowhead). A tip marks the regulated gene; no tip means the direction was not resolved.",
      `Line width: ${widthBy === "support" ? "number of selected methods reporting the relationship" : "evidence (per-target rank, 0–1)"}.${hasConfidence ? " Opacity: bootstrap confidence (≥ 0.8 solid, 0.5–0.8 45%, < 0.5 15%); relationships without a verified value are solid." : ""}`,
      ...(pins.length ? [`Pinned labels: ${pins.join(", ")}`] : []),
    ];
    const measure = document.createElement("canvas").getContext("2d");
    if (measure) measure.font = "17px Arial";
    const lines: string[] = [];
    for (const paragraph of descriptions) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && (measure?.measureText(next).width ?? next.length * 9) > WIDTH - 64) { lines.push(line); line = word; }
        else line = next;
      }
      lines.push(line);
    }
    // One-line key, the same as on screen: each group is laid out in turn and
    // the line wraps between groups if the figure is too narrow.
    const KEY = 16;
    if (measure) measure.font = `${KEY}px Arial`;
    const tw = (value: string) => measure?.measureText(value).width ?? value.length * KEY * 0.55;
    type Mark = (x: number, y: number) => void;
    type Part = { w: number; draw: Mark };
    const txt = (value: string, color: string = T.label): Part => ({ w: tw(value), draw: (x, y) => { add("text", { x, y: y + KEY * 0.36, fill: color, "font-family": "Arial, Helvetica, sans-serif", "font-size": KEY }, value); } });
    const mark = (w: number, draw: Mark): Part => ({ w, draw });
    const values = source.nodes().map(n => Number(n.data("sizeValue")));
    const directed = source.edges().some(e => Number(e.data("direction")) !== 0);
    const unsigned = source.edges().some(e => Number(e.data("sign")) === 0);
    const [low, high] = widthEnds(widthBy, methodCount);
    const groups: Part[][] = [
      [mark(14, (x, y) => { add("circle", { cx: x + 7, cy: y, r: 7, fill: T.tf }); }), txt("TF"), mark(14, (x, y) => { add("circle", { cx: x + 7, cy: y, r: 7, fill: T.node }); }), txt("Other gene")],
      [txt(NODE_SIZE_OPTIONS[sizeBy].scale, "#8a969c"), txt(String(Math.min(...values))), mark(56, (x, y) => {
        add("circle", { cx: x + 6, cy: y + 5, r: 3, fill: T.node }); add("circle", { cx: x + 21, cy: y + 2, r: 6.5, fill: T.node }); add("circle", { cx: x + 44, cy: y - 1, r: 10, fill: T.node });
      }), txt(String(Math.max(...values)))],
      [mark(30, (x, y) => { add("path", { d: `M${x} ${y}h${directed ? 20 : 30}`, stroke: T.activates, "stroke-width": 1.6 }); if (directed) add("path", { d: `M${x + 19} ${y - 5}l10 5-10 5Z`, fill: T.activates }); }), txt("Activates"),
       mark(28, (x, y) => { add("path", { d: directed ? `M${x} ${y}h26m0-7v14` : `M${x} ${y}h28`, stroke: T.represses, "stroke-width": 1.8, fill: "none" }); }), txt("Represses"),
       ...(unsigned ? [mark(30, (x, y) => { add("path", { d: `M${x} ${y}h${directed ? 20 : 30}`, stroke: T.unknown, "stroke-width": 1.6 }); if (directed) add("path", { d: `M${x + 19} ${y - 5}l10 5-10 5Z`, fill: "#fff", stroke: T.unknown, "stroke-width": 1.2 }); }), txt("Sign unknown")] : [])],
      [txt(widthBy === "support" ? "Methods" : "Evidence", "#8a969c"), txt(low), mark(88, (x, y) => { WIDTH_STEPS.forEach((w, i) => add("path", { d: `M${x + 2 + i * 22.5} ${y}h16`, stroke: "#333", "stroke-width": w })); }), txt(high)],
      ...(hasConfidence ? [[txt("Confidence", "#8a969c"), txt("<0.5"), mark(66, (x, y) => { [...CONFIDENCE_OPACITY].reverse().forEach((o, i) => add("path", { d: `M${x + 2 + i * 22} ${y}h16`, stroke: "#333", "stroke-width": 2.6, opacity: o })); }), txt("≥0.8")]] : []),
    ];
    const GAP = 8, PAD = 22, LINE = 34, left = 32, right = WIDTH - 32;
    const groupWidth = (g: Part[]) => g.reduce((sum, p) => sum + p.w, 0) + GAP * (g.length - 1);
    const rows: Part[][][] = [[]];
    let used = 0;
    for (const g of groups) {
      const need = groupWidth(g) + (rows[rows.length - 1].length ? 2 * PAD + 1 : 0);
      if (rows[rows.length - 1].length && used + need > right - left) { rows.push([]); used = 0; }
      used += rows[rows.length - 1].length ? need : groupWidth(g);
      rows[rows.length - 1].push(g);
    }
    const top = GRAPH_HEIGHT + 64;
    const keyTop = top + 30;
    const metadataY = keyTop + rows.length * LINE + 26;
    const height = metadataY + lines.length * 25 + 16;
    svg.setAttribute("xmlns", NS);
    svg.setAttribute("width", "180mm");
    svg.setAttribute("height", `${(height / WIDTH * 180).toFixed(2)}mm`);
    svg.setAttribute("viewBox", `0 0 ${WIDTH} ${height}`);
    svg.setAttribute("role", "img");
    add("title", {}, "Regulatory network");
    add("desc", {}, descriptions.join("\n"));
    add("rect", { width: WIDTH, height, fill: T.ground });
    text(32, 34, "Regulatory network", 24);
    const drawing = document.importNode(parsed.documentElement, true);
    drawing.setAttribute("x", "0"); drawing.setAttribute("y", "48");
    drawing.setAttribute("width", String(WIDTH)); drawing.setAttribute("height", String(GRAPH_HEIGHT));
    svg.appendChild(drawing);
    add("path", { d: `M32 ${top}H1168`, stroke: "#d9d9d9", "stroke-width": 1 });
    rows.forEach((row, r) => {
      let x = left;
      const y = keyTop + r * LINE;
      row.forEach((g, gi) => {
        if (gi) { x += PAD; add("path", { d: `M${x} ${y - 9}v18`, stroke: "#e0e5e8", "stroke-width": 1 }); x += 1 + PAD; }
        g.forEach((part, pi) => { part.draw(x, y); x += part.w + (pi < g.length - 1 ? GAP : 0); });
      });
    });
    lines.forEach((line, i) => text(32, metadataY + i * 25, line));
    return new XMLSerializer().serializeToString(svg);
  } finally { graph?.destroy(); host.remove(); }
}

export async function exportPublicationFigure(source: Core, format: "svg" | "png", filename: string, context: NetworkFigureContext) {
  const content = await buildPublicationFigure(source, context);
  const url = URL.createObjectURL(new Blob([content], { type: "image/svg+xml;charset=utf-8" }));
  try {
    let downloadUrl = url;
    if (format === "png") {
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Could not render the network figure.")); image.src = url; });
      const box = new DOMParser().parseFromString(content, "image/svg+xml").documentElement.getAttribute("viewBox")!.split(" ").map(Number);
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH * 3; canvas.height = box[3] * 3;
      const drawing = canvas.getContext("2d");
      if (!drawing) throw new Error("Image export is unavailable.");
      drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
      downloadUrl = canvas.toDataURL("image/png");
    }
    const link = document.createElement("a");
    link.href = downloadUrl; link.download = `${filename}-publication.${format}`;
    document.body.appendChild(link); link.click(); link.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
