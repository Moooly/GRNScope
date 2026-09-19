import cytoscape, { type Core } from "cytoscape";
import type { NetworkFigureContext } from "../networkFigureExport";
import { NETWORK_THEME as T } from "./theme";
import { buildNetworkStylesheet } from "./stylesheet";
import { applyPresentation, evidenceWidth } from "./presentation";

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
      layout: { name: "preset" }, minZoom: 0.0001, maxZoom: 8, pixelRatio: 1,
    });
    const pins: string[] = (source.scratch("publicationPins") ?? []).filter((id: string) => !source.$id(id).empty());
    graph.scratch("publicationPins", pins);
    graph.scratch("publicationWeighted", source.scratch("publicationWeighted") !== false);
    graph.scratch("publicationExport", true);
    graph.fit(graph.nodes(), 90);
    graph.scratch("galaxyFitZoom", graph.zoom());
    applyPresentation(graph, true);
    // The same chosen labels are embedded as vector text in both formats.
    const { default: plugin } = await import("cytoscape-svg");
    plugin(cytoscape);
    const parsed = new DOMParser().parseFromString(graph.svg({ full: false, scale: 1, bg: T.ground }), "image/svg+xml");
    if (parsed.querySelector("parsererror")) throw new Error("Could not create the vector figure.");

    const svg = document.createElementNS(NS, "svg");
    const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const element = document.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
      if (text !== undefined) element.textContent = text;
      svg.appendChild(element); return element;
    };
    const text = (x: number, y: number, value: string, size = 17) => add("text", { x, y, fill: T.label, "font-family": "Arial, Helvetica, sans-serif", "font-size": size }, value);
    const descriptions = [
      `${context.scope} · ${source.nodes().length} genes · ${source.edges().length} of ${context.matchingEdges} matching relationships`,
      `Methods (${context.methodCount}): ${context.methods.join(", ")}`,
      `Filters: ${context.filters || "None"}${context.focus ? ` · Neighborhood: ${context.focus}` : ""}`,
      `Selection: ${context.selectionRule || "Displayed relationships"}`,
      "Node size: incident relationships in this figure (bounded scale). Layout spacing represents connectivity, not biological distance.",
      "Colour shows predicted sign. An arrow or bar marks the regulated end only when direction is resolved; no tip means unresolved direction.",
      "Dashed negative links have unresolved direction. Grey links have unresolved sign; a hollow arrow shows resolved direction without a sign.",
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
    const top = GRAPH_HEIGHT + 64, height = top + 112 + lines.length * 25;
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
    add("path", { d: `M32 ${top}H1168`, stroke: "#d8e3dd", "stroke-width": 1 });
    add("circle", { cx: 42, cy: top + 29, r: 7, fill: T.node, stroke: T.nodeRim, "stroke-width": 0.6 });
    text(59, top + 35, "Gene");
    add("path", { d: `M170 ${top + 20}l9 9-9 9-9-9Z`, fill: T.node, stroke: T.nodeRim, "stroke-width": 0.6 });
    text(191, top + 35, "Transcription factor");
    add("path", { d: `M393 ${top + 29}h30`, stroke: T.activates, "stroke-width": 1.5 });
    text(433, top + 35, "Activation");
    add("path", { d: `M550 ${top + 29}h30`, stroke: T.represses, "stroke-width": 1.5, "stroke-dasharray": "4 3" });
    text(591, top + 35, "Repression");
    add("path", { d: `M718 ${top + 29}h30`, stroke: T.unknown, "stroke-width": 1.5 });
    text(759, top + 35, "Sign unresolved");
    add("path", { d: `M962 ${top + 29}h24m42 0h24m0-6v12`, stroke: T.label, "stroke-width": 1.2, fill: "none" });
    add("path", { d: `M983 ${top + 24}l8 5-8 5Z`, fill: T.label });
    text(1070, top + 35, "Direction");

    const weighted = source.scratch("publicationWeighted") !== false;
    text(32, top + 72, weighted ? "Line width: evidence" : "Line width: uniform");
    (weighted ? [0, 0.5, 1] : [0]).forEach((value, i) => {
      const x = 222 + i * 100;
      add("path", { d: `M${x} ${top + 67}h35`, stroke: T.activates, "stroke-width": evidenceWidth(value, weighted) });
      if (weighted) text(x + 43, top + 73, value.toFixed(1), 16);
    });
    text(575, top + 72, "Node size: displayed connections");
    const degrees = [...new Set(source.nodes().map(n => Number(n.data("degree"))))].sort((a, b) => a - b);
    const samples = [...new Set([degrees[0], degrees[Math.floor(degrees.length / 2)], degrees.at(-1)])];
    samples.forEach((degree, i) => {
      const node = graph!.nodes().filter(n => Number(n.data("degree")) === degree).first();
      // Use an equal-area circle even when the sampled node is a TF diamond.
      const radius = Number(node.data("diameter")) * graph!.zoom() / 2 / (node.data("isTF") ? 1.2533 : 1);
      const x = 887 + i * 97;
      add("circle", { cx: x, cy: top + 66, r: radius, fill: T.node, stroke: T.nodeRim, "stroke-width": 0.5 });
      text(x + radius + 6, top + 72, String(degree), 16);
    });
    lines.forEach((line, i) => text(32, top + 110 + i * 25, line));
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
