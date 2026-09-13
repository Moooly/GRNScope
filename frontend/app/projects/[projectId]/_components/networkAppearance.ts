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
    label: "Focused consensus",
    description: "Labels inside nodes · sized hubs · best under 60 genes",
    background: "#ffffff",
    node: "#dfeaf2",
    tf: "#1b75a6",
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
  // Use the regulatory degree carried in node data rather than cytoscape's
  // degree(), so size means connectivity in the network and nothing else.
  // A wide ramp on purpose. At 26 + 7*sqrt(d) a degree-14 hub came out 52px
  // against a degree-1 leaf at 33px -- a 14x difference in connectivity
  // rendered as 1.5x in diameter, so the genes organising the network did not
  // announce themselves. This spreads the same range over 34px to 72px.
  const nodeSize = (n: NodeSingular) =>
    Math.min(
      96,
      Math.max(32, 20 + 14 * Math.sqrt(Math.max(0, Number(n.data("degree")) || 0))),
    );
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
        // Pale target genes need an edge of their own to sit on white.
        "border-width": 1.5,
        "border-color": "#a8c3d5",
        label: "data(label)",
        color: p.text,
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
      // Transcription factors are solid brand blue against pale targets, so the
      // distinction survives without relying on a thin ring: the two node
      // classes previously differed only as #555555 against #3c4a57.
      selector: "node[isTF = 1]",
      style: {
        shape: "ellipse",
        "background-color": p.tf,
        "border-width": 2.5,
        "border-color": "#61d0c4",
        color: (n: NodeSingular) => (labelFits(n) ? "#ffffff" : p.text),
      },
    },
    // The consensus edge: one line per relationship, straight through the
    // middle, carrying direction, sign, support and confidence at once.
    {
      selector: "edge",
      style: {
        // Uniform, thin lines. Weight along the stroke is what made dense
        // neighbourhoods read as overlapping ribbons, so all three edge
        // metrics live off the line itself: darkness for confidence, and the
        // arrowhead's size and fill for support and evidence.
        width: 1.8,
        "line-color": signed,
        "target-arrow-color": signed,
        "source-arrow-color": signed,
        color: signed,
        opacity: (e: EdgeSingular) =>
          (e.data("confidenceOpacity") as number) ?? 0.75,
        // A round cap overshoots the tee bar by half the line width; butt ends
        // the stroke exactly at the arrow.
        "line-cap": "butt",
        "curve-style": "unbundled-bezier",
        // Bow each spoke away from its hub's neighbour centroid so a fan splays
        // apart instead of converging into a hard star. Straight lines made
        // every crossing maximally visible.
        "control-point-distances": (e: EdgeSingular) =>
          (e.data("galleryCurve") as number[]) ?? [0, 0],
        "control-point-weights": [0.25, 0.75],
        // Arrowhead size = methods that agree, in discrete steps.
        "arrow-scale": (e: EdgeSingular) =>
          (e.data("supportArrow") as number) ?? 1,
        // Arrowhead fill = evidence. This overrides the shared "hollow means
        // unsigned" convention; in this view an unsigned relationship is still
        // distinguishable by its grey hue.
        "target-arrow-fill": (e: EdgeSingular) =>
          (e.data("evidenceFill") as string) ?? "filled",
        "source-arrow-fill": (e: EdgeSingular) =>
          (e.data("evidenceFill") as string) ?? "filled",
        "z-index": 10,
        "text-outline-color": p.background,
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
    {
      // Support and evidence now live in the arrowhead, so the selected edge
      // can thicken freely without overwriting either.
      selector: "edge:selected, edge.hovered",
      style: { opacity: 1, width: 3 },
    },
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
          e.data("galleryCurve") ?? [10, 10],
        "control-point-weights": [0.25, 0.75],
        "arrow-scale": 0.85,
        "text-outline-color": p.background,
      },
    },
    {
      // Dense views dim edges, but proportionally: flattening every edge to one
      // value would erase the confidence/evidence the opacity channel carries.
      selector: "edge[denseNetwork = 1]",
      style: {
        opacity: (e: EdgeSingular) =>
          Math.max(0.18, ((e.data("metricOpacity") as number) ?? 0.5) * 0.62),
      },
    },
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
  if (appearance === "classic" || appearance === "pastel") return;
  if (appearance === "teal") {
    updateBranchCurves(cy);
    return;
  }
  const strength =
    appearance === "graphite" ? 0.7 : appearance === "braid" ? 0.24 : 0.36;
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
      // This view draws far fewer, longer edges than the atlas, so the same
      // bend that reads as organic there swings into a swoop here and bundles
      // neighbouring spokes together. Keep it to a subtle bow.
      const limit =
        appearance === "braid"
          ? Math.min(34, length * 0.12)
          : Math.min(75, length * 0.24);
      const bend = Math.max(-limit, Math.min(limit, perpendicular * strength));
      // Both control points get the SAME offset, placed symmetrically about the
      // midpoint. Cytoscape renders multiple control points as a chain of
      // quadratic segments, and the joins are only smooth where the points are
      // symmetric -- the old [bend, bend * 0.45] pair made every edge bend hard
      // out of its source and then visibly flatten, which is the kink that read
      // as "not smooth". Equal offsets give a near-circular arc with uniform
      // curvature instead.
      edge.data("galleryCurve", [bend, bend]);
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
