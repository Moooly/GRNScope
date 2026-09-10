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
  | "graphite";
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
    description: "White hubs · flowing teal edges",
    background: "#303738",
    node: "#e4eeec",
    tf: "#e4eeec",
    text: "#e1eeeb",
    positive: "#45c5be",
    negative: "#f0a274",
    unknown: "#aab7b8",
    dark: true,
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
  if (appearance === "silver" || appearance === "graphite")
    return isTF ? 29 : 27;
  return appearance === "teal"
    ? Math.min(44, 9 + 5 * Math.sqrt(Math.max(0, degree)))
    : Math.min(44, 12 + 8 * Math.sqrt(Math.max(0, degree)));
}

export function appearanceStyles(
  appearance: NetworkAppearance,
): StylesheetJson {
  if (appearance === "classic") return [];
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
        opacity: appearance === "pastel" ? 0.48 : 0.45,
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
    { selector: "edge[denseNetwork = 1]", style: { opacity: 0.2 } },
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
  if (appearance === "classic" || appearance === "pastel") return;
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
