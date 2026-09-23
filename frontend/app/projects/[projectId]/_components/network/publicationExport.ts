import cytoscape, { type Core } from "cytoscape";
import type { NetworkFigureContext } from "../networkFigureExport";
import { NETWORK_THEME as T } from "./theme";
import { buildNetworkStylesheet } from "./stylesheet";
import { applyPresentation } from "./presentation";
import { moduleMarkup, type Module } from "./modules";
import { CONFIDENCE_LABELS, CONFIDENCE_OPACITY, EVIDENCE_LABELS, NODE_SIZE_OPTIONS, WIDTH_STEPS, supportLabels, type EdgeWidthBy, type NodeSizeBy } from "./encoding";

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
    const degrees = [...new Set(source.nodes().map(n => Number(n.data("sizeValue"))))].sort((a, b) => a - b);
    const samples = [...new Set([degrees[0], degrees[Math.floor(degrees.length / 2)], degrees.at(-1)])].map(degree => {
      const node = graph!.nodes().filter(n => Number(n.data("sizeValue")) === degree).first();
      return { degree, radius: Number(node.data("diameter")) * graph!.zoom() / 2 };
    });
    const largestRadius = Math.max(0, ...samples.map(s => s.radius));
    const top = GRAPH_HEIGHT + 64;
    const sizeY = top + 110 + largestRadius;
    const metadataY = sizeY + largestRadius + 36;
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
    // Group shading sits under the drawing, in the same coordinates.
    const modules = (source.scratch("networkModules") ?? []) as Module[];
    if (modules.length && source.scratch("showModules") !== false) {
      const shade = new DOMParser().parseFromString(`<svg xmlns="${NS}">${moduleMarkup(graph, modules, graph.zoom(), graph.pan(), 15)}</svg>`, "image/svg+xml").documentElement;
      [...shade.childNodes].reverse().forEach(node => drawing.insertBefore(document.importNode(node, true), drawing.firstChild));
    }
    svg.appendChild(drawing);
    add("path", { d: `M32 ${top}H1168`, stroke: "#d9d9d9", "stroke-width": 1 });
    add("circle", { cx: 42, cy: top + 29, r: 8, fill: T.tf });
    text(59, top + 35, "Transcription factor");
    add("circle", { cx: 236, cy: top + 29, r: 8, fill: T.node });
    text(253, top + 35, "Other gene");
    add("path", { d: `M393 ${top + 29}h26`, stroke: T.activates, "stroke-width": 1.6 });
    add("path", { d: `M417 ${top + 24}l9 5-9 5Z`, fill: T.activates });
    text(433, top + 35, "Activation");
    add("path", { d: `M550 ${top + 29}h30m0-7v14`, stroke: T.represses, "stroke-width": 1.8, fill: "none" });
    text(591, top + 35, "Repression");
    add("path", { d: `M718 ${top + 29}h24`, stroke: T.unknown, "stroke-width": 1.6 });
    add("path", { d: `M742 ${top + 24}l9 5-9 5Z`, fill: "#fff", stroke: T.unknown, "stroke-width": 1.2 });
    text(759, top + 35, "Sign unknown");
    text(930, top + 35, "Tip = regulated gene", 16);

    const widthCounts = [0, 0, 0, 0], confidenceCounts = [0, 0, 0];
    source.edges().forEach(e => {
      widthCounts[Number(e.data("widthStep")) || 0]++;
      if (typeof e.data("confidence") === "number") confidenceCounts[Number(e.data("confidenceBand")) || 0]++;
    });
    const widthLabels = (widthBy === "support" ? supportLabels(methodCount) : [...EVIDENCE_LABELS]).map((label, i) => label ? `${label} (${widthCounts[i]})` : "");
    text(32, top + 72, widthBy === "support" ? "Width: method support" : "Width: evidence");
    let wx = 232;
    WIDTH_STEPS.forEach((w, i) => {
      if (!widthLabels[i]) return;
      add("path", { d: `M${wx} ${top + 67}h32`, stroke: "#333", "stroke-width": w });
      text(wx + 40, top + 73, widthLabels[i], 15);
      wx += 40 + widthLabels[i].length * 8.5 + 26;
    });
    if (hasConfidence) {
      let cx = Math.max(wx + 20, 760);
      text(cx, top + 72, "Opacity: confidence"); cx += 170;
      CONFIDENCE_OPACITY.forEach((o, i) => {
        add("path", { d: `M${cx} ${top + 67}h28`, stroke: "#333", "stroke-width": 2.2, opacity: o });
        const label = `${CONFIDENCE_LABELS[i]} (${confidenceCounts[i]})`;
        text(cx + 34, top + 73, label, 15); cx += 34 + label.length * 8.5 + 20;
      });
    }
    text(32, top + 104, `Node diameter: ${NODE_SIZE_OPTIONS[sizeBy].legend.replace(/^Size: /, "")}`);
    const keyWidth = samples.reduce((sum, sample) => sum + 2 * sample.radius + 76, 0);
    let cursor = (WIDTH - keyWidth) / 2;
    samples.forEach(({ degree, radius }) => {
      const x = cursor + radius;
      add("circle", { cx: x, cy: sizeY, r: radius, fill: T.node });
      text(x + radius + 8, sizeY + 6, String(degree), 16);
      cursor += 2 * radius + 76;
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
