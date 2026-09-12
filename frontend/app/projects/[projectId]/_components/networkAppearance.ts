import type {
  Core,
  StylesheetJson,
  NodeSingular,
  EdgeSingular,
} from "cytoscape";
import { NETWORK_COLORS } from "./networkVisualEncoding";

export type NetworkAppearance =
  | "classic"
  | "teal"
  | "silver"
  | "pastel"
  | "graphite"
  | "atlas"
  | "braid";
export const NETWORK_APPEARANCES = {
  classic: {
    label: "Current style",
    description: "Flat nodes · clean connections",
    background: "#fafcfc",
    node: "#476477",
    tf: "#476477",
    text: "#263b49",
    positive: NETWORK_COLORS.positive,
    negative: NETWORK_COLORS.negative,
    unknown: NETWORK_COLORS.unknown,
    dark: false,
  },
  teal: {
    label: "Teal constellation",
    description: "Light canvas · flowing blue edges",
    background: "#f8fafc",
    node: "#456779",
    tf: "#31576b",
    text: "#263b49",
    positive: "#2b7fa7",
    negative: "#c46d4b",
    unknown: "#85929d",
    dark: false,
  },
  silver: {
    label: "Silver spheres",
    description: "Black canvas · pearl shading",
    background: "#080b10",
    node: "#dce5ef",
    tf: "#dce5ef",
    text: "#c9d2df",
    positive: "#9fcce8",
    negative: "#e8b49b",
    unknown: "#aeb5bf",
    dark: true,
  },
  pastel: {
    label: "Pastel network",
    description: "Mint hubs · airy light canvas",
    background: "#fcfcfa",
    node: "#94c1b0",
    tf: "#70adb1",
    text: "#405c59",
    positive: "#518b9e",
    negative: "#bc8068",
    unknown: "#99a8a3",
    dark: false,
  },
  graphite: {
    label: "Graphite spheres",
    description: "Gray canvas · sculpted shading",
    background: "#454545",
    node: "#bcbcbc",
    tf: "#bcbcbc",
    text: "#e2e2e2",
    positive: "#b0cedd",
    negative: "#e5b19a",
    unknown: "#bcbcbc",
    dark: true,
  },
  atlas: {
    label: "Regulatory atlas",
    description: "Light canvas · sized hubs · flowing links",
    background: "#edf3f8",
    node: "#3e6d88",
    tf: "#3e6d88",
    text: "#22384a",
    positive: "#1f9e8f",
    negative: "#c4693a",
    unknown: "#8a97a2",
    dark: false,
  },
  braid: {
    label: "Consensus braid",
    description: "One thread per method · labels inside nodes",
    background: "#ffffff",
    node: "#555555",
    tf: "#3c4a57",
    text: "#22384a",
    positive: "#2f8f7f",
    negative: "#c4693a",
    unknown: "#98a2ad",
    dark: false,
  },
} as const;

export function appearanceSignColor(
  sign: number,
  appearance: NetworkAppearance,
) {
  const palette = NETWORK_APPEARANCES[appearance];
  return sign > 0
    ? palette.positive
    : sign < 0
      ? palette.negative
      : palette.unknown;
}

// Degree here is computed from displayed edges, not expression or biological importance.
// Bounded sizes keep a hub from swallowing its labels or neighbouring genes.
export function appearanceNodeSize(
  degree: number,
  appearance: NetworkAppearance,
  isTF: boolean,
) {
  if (appearance === "classic") return isTF ? 27 : 21;
  if (appearance === "atlas")
    return Math.min(62, 6 + 6.5 * Math.sqrt(Math.max(0, degree)));
  if (appearance === "silver" || appearance === "graphite")
    return isTF ? 29 : 27;
  return appearance === "teal"
    ? Math.min(54, 11 + 6 * Math.sqrt(Math.max(0, degree)))
    : Math.min(44, 12 + 8 * Math.sqrt(Math.max(0, degree)));
}

function braidStyles(): StylesheetJson {
  const p = NETWORK_APPEARANCES.braid;
  // Circle sized to hold its label (labels live inside the node) and to grow
  // with connectivity, as in the Cytoscape.js fCoSE gene demo.
  // Size means connectivity and nothing else; the label is fitted to the
  // circle by shrinking type, so a long gene name never inflates a node.
  const nodeSize = (n: NodeSingular) =>
    Math.min(84, Math.max(30, 26 + 7 * Math.sqrt(Math.max(0, n.degree(false)))));
  // A label only sits inside the circle if it fits at a readable size; small
  // genes with long names drop their label below the node instead of shrinking
  // into illegibility (which keeps node size meaning connectivity alone).
  const labelFits = (n: NodeSingular) => {
    const label = String(n.data("fullLabel") ?? "");
    return label.length === 0 || nodeSize(n) * 0.8 >= label.length * 8 * 0.58;
  };
  const fontSize = (n: NodeSingular) => {
    const label = String(n.data("fullLabel") ?? "");
    if (!label.length) return 10;
    if (!labelFits(n)) return 9;
    return Math.max(8, Math.min(13, (nodeSize(n) * 0.8) / (label.length * 0.58)));
  };
  const signed = (e: EdgeSingular) => appearanceSignColor(e.data("sign"), "braid");
  return [
    {
      selector: "node",
      style: {
        width: nodeSize,
        height: nodeSize,
        shape: "ellipse",
        "background-color": p.node,
        "background-fill": "solid",
        "border-width": 0,
        label: "data(label)",
        color: (n: NodeSingular) => (labelFits(n) ? "#ffffff" : "#22384a"),
        "text-valign": (n: NodeSingular) =>
          (labelFits(n) ? "center" : "bottom") as "center" | "bottom",
        "text-halign": "center",
        "text-margin-y": (n: NodeSingular) => (labelFits(n) ? 0 : 5),
        "text-outline-color": "#ffffff",
        "text-outline-width": (n: NodeSingular) => (labelFits(n) ? 0 : 2),
        "font-size": fontSize,
        "font-weight": 600,
        "min-zoomed-font-size": 7,
      },
    },
    {
      selector: "node[isTF = 1]",
      style: { shape: "ellipse", "background-color": p.tf },
    },
    // The consensus edge: straight through the middle, carries direction+sign.
    {
      selector: "edge",
      style: {
        width: 1.6,
        "line-color": signed,
        "target-arrow-color": signed,
        "source-arrow-color": signed,
        color: signed,
        opacity: 0.75,
        "curve-style": "unbundled-bezier",
        "control-point-distances": [0],
        "control-point-weights": [0.5],
        "arrow-scale": 0.9,
        "z-index": 10,
        "text-outline-color": p.background,
      },
    },
    // One thread per supporting method, fanned around the consensus edge.
    {
      selector: "edge.strand",
      style: {
        width: 1.3,
        // Neutral by default: the count of threads carries the meaning. Method
        // colour is revealed on demand (see .strand-lit) where it is readable.
        "line-color": "#94a3b1",
        opacity: 0.6,
        "curve-style": "unbundled-bezier",
        // Two control points at the same offset keep the middle of each thread
        // parallel to its neighbours, so a bundle reads as a cable, not a lens.
        "control-point-distances": (e: EdgeSingular) => {
          const offset = (e.data("strandOffset") as number) ?? 0;
          return [offset, offset];
        },
        "control-point-weights": [0.2, 0.8],
        "source-arrow-shape": "none",
        "target-arrow-shape": "none",
        label: "",
        events: "no",
        "z-index": 1,
      },
    },
    { selector: "edge.strand.trace-mute", style: { opacity: 0.03 } },
    { selector: "edge.strand.context-muted", style: { opacity: 0.03 } },
    { selector: "edge.strand.trace-on", style: { opacity: 0.75 } },
    { selector: "edge.strand.local-edge", style: { opacity: 0.75 } },
    {
      selector: "edge.strand.strand-lit",
      style: {
        "line-color": "data(strandColor)",
        opacity: 0.95,
        width: 1.7,
        "z-index": 6,
      },
    },
    { selector: "node.context-muted", style: { opacity: 0.2, "text-opacity": 0.2 } },
    { selector: "edge.context-muted", style: { opacity: 0.06 } },
    {
      selector: "node:selected, node.endpoint",
      style: {
        "border-width": 3,
        "border-color": NETWORK_COLORS.selection,
        "z-index": 30,
      },
    },
    { selector: "edge:selected, edge.hovered", style: { opacity: 1, width: 2.4 } },
  ];
}

function atlasStyles(): StylesheetJson {
  const p = NETWORK_APPEARANCES.atlas;
  const nodeSize = (n: NodeSingular) =>
    appearanceNodeSize(n.degree(false), "atlas", !!n.data("isTF"));
  const tfSize = (n: NodeSingular) => 1.15 * nodeSize(n);
  const signColor = (e: EdgeSingular) =>
    appearanceSignColor(e.data("sign"), "atlas");
  return [
    {
      selector: "node",
      style: {
        width: nodeSize,
        height: nodeSize,
        shape: "ellipse",
        "background-color": p.node,
        "background-fill": "radial-gradient",
        "background-gradient-stop-colors": ["#7ba0b6", p.node, "#264a5e"],
        "background-gradient-stop-positions": ["0%", "46%", "100%"],
        "border-width": 0,
        color: p.text,
        "text-outline-color": p.background,
        "text-outline-width": 3,
        "font-size": (n: NodeSingular) => 8 + Math.min(10, n.degree(false) * 0.5),
        "font-weight": (n: NodeSingular) => (n.degree(false) >= 6 ? 700 : 500),
        "text-valign": "bottom",
        "text-margin-y": 6,
        "min-zoomed-font-size": 9,
      },
    },
    {
      selector: "node[isTF = 1]",
      style: { shape: "diamond", width: tfSize, height: tfSize },
    },
    {
      selector: "node[denseNetwork = 1]",
      style: {
        width: (n: NodeSingular) =>
          Math.min(30, 3 + 3.4 * Math.sqrt(Math.max(0, n.degree(false)))),
        height: (n: NodeSingular) =>
          Math.min(30, 3 + 3.4 * Math.sqrt(Math.max(0, n.degree(false)))),
        "min-zoomed-font-size": 18,
        "text-outline-width": 2,
      },
    },
    {
      selector: "edge",
      style: {
        "line-color": signColor,
        "target-arrow-color": signColor,
        "source-arrow-color": signColor,
        color: signColor,
        width: 1.7,
        opacity: (e: EdgeSingular) => (e.data("metricOpacity") as number) ?? 0.4,
        "curve-style": "unbundled-bezier",
        "control-point-distances": (e: EdgeSingular) =>
          e.data("galleryCurve") ?? [10, 6],
        "control-point-weights": [0.25, 0.72],
        "arrow-scale": 0.85,
        "text-outline-color": p.background,
      },
    },
    { selector: "edge[denseNetwork = 1]", style: { opacity: 0.16 } },
    {
      selector: "edge.local-edge, edge.hovered, edge:selected",
      style: { opacity: 0.95 },
    },
    {
      selector: "edge.reciprocal",
      style: { "curve-style": "bezier", "control-point-step-size": 48 },
    },
    { selector: "node.context-muted", style: { opacity: 0.18, "text-opacity": 0 } },
    { selector: "edge.context-muted", style: { opacity: 0.05, "text-opacity": 0 } },
    {
      selector: "node.revealed",
      style: { label: "data(fullLabel)", "min-zoomed-font-size": 0 },
    },
    {
      selector: "node:selected, node.endpoint",
      style: {
        "border-width": 3,
        "border-color": NETWORK_COLORS.selection,
        label: "data(fullLabel)",
        "min-zoomed-font-size": 0,
        "z-index": 20,
      },
    },
    {
      selector: "edge.annotated",
      style: {
        "text-background-color": p.background,
        "text-border-color": "#657274",
        color: p.text,
      },
    },
  ];
}

export function appearanceStyles(
  appearance: NetworkAppearance,
): StylesheetJson {
  if (appearance === "classic") return [];
  if (appearance === "atlas") return atlasStyles();
  if (appearance === "braid") return braidStyles();
  const p = NETWORK_APPEARANCES[appearance];
  const sphere = appearance === "silver" || appearance === "graphite";
  return [
    {
      selector: "node",
      style: {
        width: (n: NodeSingular) =>
          appearanceNodeSize(n.degree(false), appearance, !!n.data("isTF")),
        height: (n: NodeSingular) =>
          appearanceNodeSize(n.degree(false), appearance, !!n.data("isTF")),
        "background-color": (n: NodeSingular) =>
          n.data("isTF") ? p.tf : p.node,
        "background-fill": sphere
          ? appearance === "silver"
            ? "radial-gradient"
            : "linear-gradient"
          : "solid",
        "background-gradient-stop-colors":
          appearance === "silver"
            ? ["#ffffff", "#e1e4e8", "#737b85"]
            : ["#f7f7f7", "#b5b5b5", "#505050", "#262626"],
        "background-gradient-stop-positions":
          appearance === "silver"
            ? ["0%", "40%", "100%"]
            : ["0%", "28%", "65%", "100%"],
        "background-gradient-direction": "to-bottom-right",
        "border-width": 0,
        color: p.text,
        "text-outline-color": p.background,
        "text-outline-width": 2,
        "font-size": 12,
        "font-weight": 400,
      },
    },
    { selector: "node[isTF = 1]", style: { "font-weight": 700 } },
    ...(appearance === "teal"
      ? [
          {
            selector: "node[denseNetwork = 1]",
            style: {
              width: (n: NodeSingular) =>
                Math.min(32, 8 + 3.8 * Math.sqrt(Math.max(0, n.degree(false)))),
              height: (n: NodeSingular) =>
                Math.min(32, 8 + 3.8 * Math.sqrt(Math.max(0, n.degree(false)))),
              "min-zoomed-font-size": 18,
            },
          },
        ]
      : []),
    {
      selector: "edge",
      style: {
        "line-color": (e: EdgeSingular) =>
          appearanceSignColor(e.data("sign"), appearance),
        "target-arrow-color": (e: EdgeSingular) =>
          appearanceSignColor(e.data("sign"), appearance),
        "source-arrow-color": (e: EdgeSingular) =>
          appearanceSignColor(e.data("sign"), appearance),
        color: (e: EdgeSingular) =>
          appearanceSignColor(e.data("sign"), appearance),
        opacity: (e: EdgeSingular) =>
          (e.data("metricOpacity") as number) ?? 0.5,
        "curve-style":
          appearance === "teal"
            ? (e: EdgeSingular) => e.data("galleryRoute") ?? "straight"
            : appearance === "pastel"
              ? "bezier"
              : "unbundled-bezier",
        "control-point-distances": (e: EdgeSingular) =>
          e.data("galleryCurve") ?? [12, 8],
        "control-point-weights": [0.25, 0.72],
        "text-outline-color": p.background,
      },
    },
    {
      selector: "edge.reciprocal",
      style: { "curve-style": "bezier", "control-point-step-size": 48 },
    },
    {
      selector: "edge[denseNetwork = 1]",
      style: {
        opacity: (e: EdgeSingular) =>
          Math.max(0.34, ((e.data("metricOpacity") as number) ?? 0.5) * 0.86),
      },
    },
    {
      selector: "edge.local-edge, edge.hovered, edge:selected",
      style: { opacity: 1 },
    },
    { selector: "node.context-muted", style: { opacity: 0.22 } },
    { selector: "edge.context-muted", style: { opacity: 0.06 } },
    {
      selector: "node:selected, node.endpoint",
      style: { "border-width": 3, "border-color": NETWORK_COLORS.selection },
    },
    {
      selector: "edge.annotated",
      style: {
        "text-background-color": p.background,
        "text-border-color": p.dark ? "#657274" : "#dfe7e5",
      },
    },
  ];
}

// Fan each hub's edges toward its neighbours' mean position. The paths remain
// individually traceable; this is curved routing, not an edge-bundling algorithm.
export function updateGalleryCurves(cy: Core, appearance: NetworkAppearance) {
  if (appearance === "classic" || appearance === "pastel" || appearance === "braid")
    return;
  if (appearance === "teal") {
    updateBranchCurves(cy);
    return;
  }
  const strength = appearance === "graphite" ? 0.8 : 0.42;
  // Cache each source's neighbour centroid once per update, including during dragging.
  const centers = new Map<string, { x: number; y: number }>();
  cy.batch(() =>
    cy.edges().forEach((edge) => {
      if (edge.isLoop() || edge.hasClass("reciprocal")) return;
      const a = edge.source().position(),
        b = edge.target().position();
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy);
      if (length < 1) {
        edge.data("galleryCurve", [0, 0]);
        return;
      }
      const sourceId = edge.source().id();
      let center = centers.get(sourceId);
      if (!center) {
        const neighbours = edge.source().neighborhood().nodes();
        const sum = neighbours.reduce(
          (point, n) => ({
            x: point.x + n.position().x,
            y: point.y + n.position().y,
          }),
          { x: 0, y: 0 },
        );
        const count = Math.max(1, neighbours.length);
        center = { x: sum.x / count, y: sum.y / count };
        centers.set(sourceId, center);
      }
      const perpendicular =
        ((center.x - a.x) * -dy + (center.y - a.y) * dx) / length;
      const limit = Math.min(75, length * 0.24);
      const bend = Math.max(-limit, Math.min(limit, perpendicular * strength));
      edge.data("galleryCurve", [bend, bend * 0.45]);
    }),
  );
}

/** Curve compatible outgoing fans; leave bridges and isolated connections straight.
 * Separate colors and actual directions prevent a bundle implying false agreement. */
export function updateBranchCurves(cy: Core) {
  const groups = new Map<
    string,
    Array<{
      edge: EdgeSingular;
      reverse: boolean;
      hub: { x: number; y: number };
      leaf: { x: number; y: number };
    }>
  >();
  cy.batch(() => {
    cy.edges().forEach((edge) => {
      edge.data("galleryRoute", edge.isLoop() ? "bezier" : "straight");
      edge.data("galleryCurve", [0, 0]);
      if (edge.isLoop() || edge.hasClass("reciprocal")) return;
      const source = edge.source(),
        target = edge.target();
      const reverse = target.degree(false) > source.degree(false);
      const hub = reverse ? target : source,
        leaf = reverse ? source : target;
      if (hub.degree(false) < 3 || leaf.degree(false) > 2) return;
      const a = hub.position(),
        b = leaf.position();
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 70) return;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const sector = Math.floor((angle + Math.PI) / (Math.PI / 3));
      const tip = reverse
        ? edge.data("sourceArrowShape")
        : edge.data("targetArrowShape");
      const key = `${hub.id()}|${sector}|${edge.data("sign")}|${tip}`;
      const group = groups.get(key) ?? [];
      group.push({ edge, reverse, hub: a, leaf: b });
      groups.set(key, group);
    });
    groups.forEach((group) => {
      if (group.length < 3) return;
      const center = group.reduce(
        (s, g) => ({
          x: s.x + g.leaf.x / group.length,
          y: s.y + g.leaf.y / group.length,
        }),
        { x: 0, y: 0 },
      );
      group.forEach(({ edge, reverse, hub, leaf }) => {
        const dx = leaf.x - hub.x,
          dy = leaf.y - hub.y,
          length = Math.hypot(dx, dy);
        const bend =
          (((center.x - hub.x) * -dy + (center.y - hub.y) * dx) / length) *
          0.55;
        const bounded = Math.max(-length * 0.2, Math.min(length * 0.2, bend));
        if (Math.abs(bounded) < 2) return;
        edge.data("galleryRoute", "unbundled-bezier");
        edge.data(
          "galleryCurve",
          reverse ? [-bounded * 0.45, -bounded] : [bounded, bounded * 0.45],
        );
      });
    });
  });
}
