import type { StylesheetJson, EdgeSingular, NodeSingular } from "cytoscape";
import { PALETTE, type Palette } from "./theme";

/** Ink of a hovered link. */
const FOCUS_INK = "#1f2a33";

export function buildNetworkStylesheet(T: Palette = PALETTE): StylesheetJson {
  // Three sign states, three colours: activation blue, repression red, and a
  // light grey for relationships no method could sign, so an unsigned record is
  // never drawn as an activation.
  const color = (e: EdgeSingular) =>
    e.data("sign") === -1 ? T.represses : e.data("sign") === 1 ? T.activates : T.unknown;
  return [
    { selector: "node", style: {
      width: "data(diameter)", height: "data(diameter)", shape: "ellipse",
      "background-color": T.node, "background-fill": "solid", "border-width": 0,
      // The name sits inside the circle and may run past the rim of a small
      // node. Plain dark text, no halo.
      label: "data(label)", color: T.label,
      // One light weight for every name (TF or not, hovered or not), so hub
      // names do not compete with the links.
      "font-family": "Arial, Helvetica, sans-serif", "font-size": "data(labelSize)", "font-weight": 400,
      // Gene symbols are italic by convention, as in journal figures.
      "font-style": "italic",
      "text-halign": (n: NodeSingular) => n.data("labelHalign"), "text-valign": (n: NodeSingular) => n.data("labelValign"),
      "text-margin-x": (n: NodeSingular) => n.data("labelOffsetX"), "text-margin-y": (n: NodeSingular) => n.data("labelOffsetY"),
      "text-outline-width": 0,
      "min-zoomed-font-size": 7,
      "overlay-opacity": 0, "z-index": 10,
    } },
    { selector: "node[isTF = 1]", style: { "background-color": T.tf } },
    // Direction split: dark = regulates, light = regulated by, pale = unknown.
    { selector: "node", style: {
      "pie-size": "data(pieSize)",
      "pie-1-background-color": (n: NodeSingular) => (n.data("isTF") === 1 ? T.pieTF : T.pieGene)[0], "pie-1-background-size": (n: NodeSingular) => Number(n.data("pieOut")) || 0,
      "pie-2-background-color": (n: NodeSingular) => (n.data("isTF") === 1 ? T.pieTF : T.pieGene)[1], "pie-2-background-size": (n: NodeSingular) => Number(n.data("pieIn")) || 0,
      "pie-3-background-color": (n: NodeSingular) => (n.data("isTF") === 1 ? T.pieTF : T.pieGene)[2], "pie-3-background-size": (n: NodeSingular) => Number(n.data("pieUnknown")) || 0,
    } },
    // Links filter: hidden links leave the figure; genes left without any fade.
    { selector: "edge[?effectHidden]", style: { display: "none" } },
    { selector: "node[?effectFaded]", style: { opacity: 0.25 } },
    { selector: "edge", style: {
      "curve-style": (e: EdgeSingular) => e.data("routeDistances") ? "unbundled-bezier" : "bezier",
      "control-point-distances": (e: EdgeSingular) => e.data("routeDistances") ?? [0],
      "control-point-weights": (e: EdgeSingular) => e.data("routeWeights") ?? [0.5],
      "edge-distances": "node-position", "line-cap": "butt", "line-color": color,
      "line-style": (e: EdgeSingular) => e.data("dashed") ? "dashed" : "solid",
      "line-dash-pattern": ((e: EdgeSingular) => e.data("dashPattern") ?? [5, 4]) as unknown as number[],
      width: "data(width)", opacity: (e: EdgeSingular) => e.data("inkOpacity"), "overlay-opacity": 0,
      // Tip = direction, drawn only at a resolved regulated end. Arrowhead =
      // activation, flat bar = repression, hollow arrowhead = sign unknown.
      "source-arrow-shape": (e: EdgeSingular) => e.data("sourceTip"),
      "target-arrow-shape": (e: EdgeSingular) => e.data("targetTip"),
      "source-arrow-color": color, "target-arrow-color": color,
      "source-arrow-fill": (e: EdgeSingular) => e.data("arrowFill"),
      "target-arrow-fill": (e: EdgeSingular) => e.data("arrowFill"),
      "arrow-scale": (e: EdgeSingular) => Number(e.data("arrowScale")) || 0.8,
      "source-distance-from-node": (e: EdgeSingular) => Number(e.data("tipGap")) || 4,
      "target-distance-from-node": (e: EdgeSingular) => Number(e.data("tipGap")) || 4,
      // Weak relationships underneath, strong ones on top.
      "z-index": (e: EdgeSingular) => Number(e.data("zIndex")) || 1,
    } },
    { selector: "node.hovered", style: { "min-zoomed-font-size": 0, "z-index": 30 } },
    { selector: "node.traced", style: {
      "min-zoomed-font-size": 0,
      "underlay-color": T.accent, "underlay-opacity": 0.14, "underlay-padding": 6, "underlay-shape": "ellipse", "z-index": 30,
    } },
    { selector: "node.traced-neighbour", style: { "min-zoomed-font-size": 0, "z-index": 20 } },
    { selector: "edge.traced-neighbour", style: { opacity: (e: EdgeSingular) => Math.max(0.6, Number(e.data("inkOpacity")) || 1) } },
    { selector: "edge.traced, edge.hovered, edge.row-hover", style: { width: (e: EdgeSingular) => Number(e.data("width")) * 1.6, opacity: 1, "z-index": 25 } },
    { selector: "node.muted", style: { opacity: 0.25, "text-opacity": 0.2 } },
    { selector: "edge.muted", style: { opacity: 0.06 } },
    // Hovered link in focus (canvas or table row): the rest fades, the link
    // turns near-black and thick on a white casing, its genes stay full.
    { selector: "edge.focus-dim", style: { opacity: 0.1 } },
    { selector: "node.focus-dim", style: { opacity: 0.35, "text-opacity": 0.35 } },
    { selector: "node.focus-end", style: { opacity: 1, "text-opacity": 1, "min-zoomed-font-size": 0, "z-index": 30 } },
    { selector: "edge.focus-edge", style: {
      "line-color": FOCUS_INK, "source-arrow-color": FOCUS_INK, "target-arrow-color": FOCUS_INK,
      width: (e: EdgeSingular) => Math.max(3.2, Number(e.data("width")) * 2.2),
      opacity: 1, "z-index": 40,
      "underlay-color": "#ffffff", "underlay-opacity": 1, "underlay-padding": 2.5,
    } },
    // Hovered gene in focus: its links dark on a white casing, a little
    // lighter than a single hovered link because there are several.
    { selector: "edge.focus-link", style: {
      "line-color": FOCUS_INK, "source-arrow-color": FOCUS_INK, "target-arrow-color": FOCUS_INK,
      width: (e: EdgeSingular) => Math.max(2, Number(e.data("width")) * 1.6),
      opacity: 1, "z-index": 40,
      "underlay-color": "#ffffff", "underlay-opacity": 1, "underlay-padding": 2,
    } },
  ];
}
