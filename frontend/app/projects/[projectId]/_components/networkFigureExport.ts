import type { Core } from "cytoscape";
import {
  METRICS,
  NETWORK_COLORS,
  metricWidth,
  type NetworkMetric,
} from "./networkVisualEncoding";

export type NetworkFigureContext = {
  metric: NetworkMetric;
  methodCount: number;
  scope: string;
  geneCount: number;
  edgeCount: number;
  matchingEdges: number;
  methods: string[];
  filters: string;
  focus: string | null;
  highlightedMethod: string | null;
};
const NS = "http://www.w3.org/2000/svg";

export async function exportNetworkFigure(
  cy: Core,
  format: "png" | "svg",
  filename: string,
  context: NetworkFigureContext,
) {
  if (cy.destroyed() || !cy.elements().length)
    throw new Error("There is no network to export.");
  const width = Math.max(900, Math.round(cy.width()));
  const graphHeight = Math.round(cy.height());
  const svg = document.createElementNS(NS, "svg");
  const add = (
    tag: string,
    attrs: Record<string, string | number>,
    text?: string,
  ) => {
    const element = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) =>
      element.setAttribute(key, String(value)),
    );
    if (text !== undefined) element.textContent = text;
    svg.appendChild(element);
    return element;
  };
  const lines = [
    `${context.scope} · ${context.geneCount} genes · ${context.edgeCount} of ${context.matchingEdges} matching relationships`,
    `Methods (${context.methodCount}): ${context.methods.join(", ")}`,
    `Filters: ${context.filters || "None"}${context.focus ? " · Neighborhood: " + context.focus : ""}${context.highlightedMethod ? " · Highlight: " + context.highlightedMethod : ""}`,
    METRICS[context.metric].description,
  ].flatMap((line) => {
    const maxChars = Math.floor((width - 48) / 6.5);
    const result: string[] = [];
    let remaining = line;
    while (remaining.length > maxChars) {
      let at = remaining.lastIndexOf(" ", maxChars);
      if (at < 1) at = maxChars;
      result.push(remaining.slice(0, at));
      remaining = remaining.slice(at).trimStart();
    }
    result.push(remaining);
    return result;
  });
  const height = graphHeight + 162 + lines.length * 18;
  svg.setAttribute("xmlns", NS);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  add("rect", { width, height, fill: "#ffffff" });
  add(
    "text",
    {
      x: 24,
      y: 29,
      fill: "#263e4c",
      "font-size": 18,
      "font-weight": 600,
      "font-family": "Arial, sans-serif",
    },
    `GRNScope · Regulatory atlas · ${METRICS[context.metric].label}`,
  );
  if (format === "svg") {
    if (typeof cy.svg !== "function") {
      const [{ default: plugin }, { default: cytoscape }] = await Promise.all([
        import("cytoscape-svg"),
        import("cytoscape"),
      ]);
      plugin(cytoscape);
    }
    const parsed = new DOMParser().parseFromString(
      cy.svg({ full: false, scale: 1, bg: "#fff" }),
      "image/svg+xml",
    );
    const graph = parsed.documentElement;
    if (graph.nodeName === "parsererror")
      throw new Error("Could not create the vector export.");
    graph.setAttribute("x", String((width - cy.width()) / 2));
    graph.setAttribute("y", "44");
    svg.appendChild(document.importNode(graph, true));
  } else {
    add("image", {
      x: (width - cy.width()) / 2,
      y: 44,
      width: cy.width(),
      height: graphHeight,
      href: cy.png({ full: false, scale: 2, bg: "#fff" }),
    });
  }
  const top = graphHeight + 60;
  add("path", { d: `M24 ${top}H${width - 24}`, stroke: "#dfe7e9" });
  const label = (
    x: number,
    y: number,
    text: string,
    color = "#526b79",
    size = 11,
  ) =>
    add(
      "text",
      {
        x,
        y,
        fill: color,
        "font-size": size,
        "font-family": "Arial, sans-serif",
      },
      text,
    );
  add("path", { d: `M30 ${top + 18}l6 6-6 6-6-6Z`, fill: NETWORK_COLORS.node });
  label(43, top + 28, "TF");
  add("circle", { cx: 103, cy: top + 24, r: 5, fill: NETWORK_COLORS.node });
  label(115, top + 28, "Other gene");
  add("path", {
    d: `M225 ${top + 24}h22`,
    stroke: NETWORK_COLORS.positive,
    "stroke-width": 1.8,
  });
  add("path", {
    d: `M243 ${top + 19}l8 5-8 5Z`,
    fill: NETWORK_COLORS.positive,
  });
  label(259, top + 28, "Activation", NETWORK_COLORS.positive);
  add("path", {
    d: `M345 ${top + 24}h25m0-6v12`,
    stroke: NETWORK_COLORS.negative,
    "stroke-width": 1.8,
    fill: "none",
  });
  label(379, top + 28, "Repression", NETWORK_COLORS.negative);
  add("path", {
    d: `M470 ${top + 24}h22m0-5 8 5-8 5Z`,
    stroke: NETWORK_COLORS.unknown,
    "stroke-width": 1.5,
    fill: "none",
  });
  label(508, top + 28, "Unresolved sign", NETWORK_COLORS.unknown);
  label(665, top + 28, "Tip points to affected gene");
  label(24, top + 53, `Line width: ${METRICS[context.metric].label}`);
  [0, 0.5, 1].forEach((value, index) => {
    const x = 220 + index * 100;
    add("path", {
      d: `M${x} ${top + 49}h35`,
      stroke: NETWORK_COLORS.node,
      "stroke-width": metricWidth(value),
      "stroke-linecap": "round",
    });
    label(
      x + 42,
      top + 53,
      context.metric === "evidence" ? value.toFixed(1) : `${value * 100}%`,
    );
  });
  add("path", {
    d: `M535 ${top + 49}h30`,
    stroke: NETWORK_COLORS.unknown,
    "stroke-width": metricWidth(null),
    "stroke-dasharray": "4 3",
  });
  label(574, top + 53, "Unavailable");
  label(
    24,
    top + 76,
    "Fixed absolute scale · No tip: direction unresolved · Gold outline: selection · Support counts reporting methods, not agreement.",
    "#78909b",
    10,
  );
  lines.forEach((line, index) =>
    label(24, top + 101 + index * 18, line, "#667e8a", 11),
  );
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  try {
    let downloadUrl = url;
    if (format === "png") {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () =>
          reject(new Error("Could not render the network image."));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const drawing = canvas.getContext("2d");
      if (!drawing)
        throw new Error("Image export is unavailable in this browser.");
      drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
      downloadUrl = canvas.toDataURL("image/png");
    }
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `${filename}-${context.metric}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
