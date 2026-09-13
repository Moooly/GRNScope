import type { Core } from "cytoscape";
import {
  METRICS,
  metricWidth,
  type NetworkMetric,
} from "./networkVisualEncoding";

import {
  NETWORK_APPEARANCES,
  type NetworkAppearance,
} from "./networkAppearance";
import {
  MODULE_BRIDGE,
  MODULE_COLORS,
  MODULE_NEUTRAL,
} from "./networkModules";

export type NetworkFigureContext = {
  metric: NetworkMetric;
  appearance?: NetworkAppearance;
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
  const appearance = context.appearance ?? "classic";
  const palette = NETWORK_APPEARANCES[appearance];
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
    appearance === "braid"
      ? "Arrowhead size counts the methods that agree; a solid head marks stronger evidence; line darkness is bootstrap confidence."
      : appearance === "atlas"
        ? "Colour groups genes by the regulatory hub that reaches them first. Neutral links bridge two modules."
        : METRICS[context.metric].description,
    `Style: ${palette.label} · Shape: gene type${appearance === "teal" || appearance === "pastel" ? " · Node size: displayed connections" : ""}`,
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
  add("rect", { width, height, fill: palette.background });
  add(
    "text",
    {
      x: 24,
      y: 29,
      fill: palette.text,
      "font-size": 18,
      "font-weight": 600,
      "font-family": "Arial, sans-serif",
    },
    appearance === "braid"
      ? "GRNScope · Consensus regulatory network"
      : appearance === "atlas"
        ? "GRNScope · Regulatory atlas"
        : `GRNScope · Regulatory atlas · ${METRICS[context.metric].label}`,
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
      cy.svg({ full: false, scale: 1, bg: palette.background }),
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
      href: cy.png({ full: false, scale: 2, bg: palette.background }),
    });
  }
  const top = graphHeight + 60;
  add("path", { d: `M24 ${top}H${width - 24}`, stroke: "#dfe7e9" });
  const label = (
    x: number,
    y: number,
    text: string,
    color: string = palette.text,
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
  const focused = appearance === "braid";
  const atlasView = appearance === "atlas";

  if (focused) {
    // Row 1: what a link means, and what a gene is.
    add("circle", {
      cx: 30,
      cy: top + 24,
      r: 6,
      fill: palette.tf,
      stroke: "#61d0c4",
      "stroke-width": 2,
    });
    label(43, top + 28, "TF");
    add("circle", {
      cx: 103,
      cy: top + 24,
      r: 5.5,
      fill: palette.node,
      stroke: "#a8c3d5",
      "stroke-width": 1.5,
    });
    label(115, top + 28, "Other gene");
    add("path", {
      d: `M225 ${top + 24}h22`,
      stroke: palette.positive,
      "stroke-width": 1.8,
    });
    add("path", { d: `M243 ${top + 19}l8 5-8 5Z`, fill: palette.positive });
    label(259, top + 28, "Activation", palette.positive);
    add("path", {
      d: `M345 ${top + 24}h25m0-6v12`,
      stroke: palette.negative,
      "stroke-width": 1.8,
      fill: "none",
    });
    label(379, top + 28, "Repression", palette.negative);
    label(470, top + 28, "Node size = regulatory links");
    label(665, top + 28, "Tip points to affected gene");

    // Row 2: the three edge metrics, each on its own channel.
    add("path", {
      d: `M24 ${top + 49}h12`,
      stroke: palette.node,
      "stroke-width": 1.5,
    });
    add("path", { d: `M36 ${top + 46}l5 3-5 3Z`, fill: palette.node });
    add("path", {
      d: `M54 ${top + 49}h10`,
      stroke: palette.node,
      "stroke-width": 1.5,
    });
    add("path", { d: `M64 ${top + 43}l10 6-10 6Z`, fill: palette.node });
    label(80, top + 53, "Methods that agree");

    add("path", {
      d: `M245 ${top + 49}h12`,
      stroke: palette.node,
      "stroke-width": 1.5,
    });
    add("path", {
      d: `M257 ${top + 44}l8 5-8 5Z`,
      fill: palette.background,
      stroke: palette.node,
      "stroke-width": 1.4,
    });
    add("path", {
      d: `M280 ${top + 49}h12`,
      stroke: palette.node,
      "stroke-width": 1.5,
    });
    add("path", { d: `M292 ${top + 44}l8 5-8 5Z`, fill: palette.node });
    label(308, top + 53, "Evidence: solid is stronger");

    add("path", {
      d: `M520 ${top + 49}h30`,
      stroke: palette.node,
      "stroke-width": 2.4,
      "stroke-opacity": 0.3,
    });
    add("path", {
      d: `M556 ${top + 49}h30`,
      stroke: palette.node,
      "stroke-width": 2.4,
    });
    label(592, top + 53, "Confidence");

    add("path", {
      d: `M700 ${top + 49}h30`,
      stroke: palette.unknown,
      "stroke-width": 1.8,
      "stroke-dasharray": "4 3",
    });
    label(736, top + 53, "Unavailable");
  } else if (atlasView) {
    MODULE_COLORS.slice(0, 6).forEach((color, index) => {
      add("circle", { cx: 28 + index * 13, cy: top + 24, r: 5, fill: color });
    });
    label(110, top + 28, "Regulatory module");
    add("circle", { cx: 240, cy: top + 24, r: 5, fill: MODULE_NEUTRAL });
    label(252, top + 28, "Outside the main modules");
    add("path", {
      d: `M410 ${top + 24}h26`,
      stroke: MODULE_BRIDGE,
      "stroke-width": 2,
    });
    label(444, top + 28, "Bridge between modules");
    add("path", { d: `M620 ${top + 18}l6 6-6 6-6-6Z`, fill: palette.node });
    label(633, top + 28, "TF");
    add("circle", { cx: 690, cy: top + 24, r: 5, fill: palette.node });
    label(702, top + 28, "Other gene");

    label(24, top + 53, `Line darkness: ${METRICS[context.metric].label}`);
    [0, 0.5, 1].forEach((value, index) => {
      const x = 220 + index * 100;
      add("path", {
        d: `M${x} ${top + 49}h35`,
        stroke: palette.node,
        "stroke-width": 2.4,
        "stroke-opacity": Math.max(0.18, 0.42 + value * 0.58),
        "stroke-linecap": "round",
      });
      label(
        x + 42,
        top + 53,
        context.metric === "evidence" ? value.toFixed(1) : `${value * 100}%`,
      );
    });
    label(560, top + 53, "Node size = regulatory links");
  } else {
    add("path", { d: `M30 ${top + 18}l6 6-6 6-6-6Z`, fill: palette.node });
    label(43, top + 28, "TF");
    add("circle", { cx: 103, cy: top + 24, r: 5, fill: palette.node });
    label(115, top + 28, "Other gene");
    add("path", {
      d: `M225 ${top + 24}h22`,
      stroke: palette.positive,
      "stroke-width": 1.8,
    });
    add("path", {
      d: `M243 ${top + 19}l8 5-8 5Z`,
      fill: palette.positive,
    });
    label(259, top + 28, "Activation", palette.positive);
    add("path", {
      d: `M345 ${top + 24}h25m0-6v12`,
      stroke: palette.negative,
      "stroke-width": 1.8,
      fill: "none",
    });
    label(379, top + 28, "Repression", palette.negative);
    add("path", {
      d: `M470 ${top + 24}h22m0-5 8 5-8 5Z`,
      stroke: palette.unknown,
      "stroke-width": 1.5,
      fill: "none",
    });
    label(508, top + 28, "Unresolved sign", palette.unknown);
    label(665, top + 28, "Tip points to affected gene");
    label(24, top + 53, `Line width: ${METRICS[context.metric].label}`);
    [0, 0.5, 1].forEach((value, index) => {
      const x = 220 + index * 100;
      add("path", {
        d: `M${x} ${top + 49}h35`,
        stroke: palette.node,
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
      stroke: palette.unknown,
      "stroke-width": metricWidth(null),
      "stroke-dasharray": "4 3",
    });
    label(574, top + 53, "Unavailable");
  }
  label(
    24,
    top + 76,
    focused
      ? "Fixed absolute scale · No tip: direction unresolved · Gold outline: selection · Support counts reporting methods, not agreement."
      : atlasView
        ? "Colour is assigned by graph distance to the highest-degree genes · Sign colours appear on screen when zoomed in · Gold outline: selection."
        : "Fixed absolute scale · No tip: direction unresolved · Gold outline: selection · Support counts reporting methods, not agreement.",
    palette.text,
    10,
  );
  lines.forEach((line, index) =>
    label(24, top + 101 + index * 18, line, palette.text, 11),
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
    link.download = `${filename}-${context.metric}-${appearance}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
