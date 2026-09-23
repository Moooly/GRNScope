import type { StylesheetJson, EdgeSingular, NodeSingular } from "cytoscape";
import { NETWORK_THEME as T } from "./theme";

export function buildNetworkStylesheet(): StylesheetJson {
  // Three sign states, three colours: activation blue, repression red, and a
  // light grey for relationships no method could sign, so an unsigned record is
  // never drawn as an activation.
  const color = (e: EdgeSingular) =>
    e.data("sign") === -1 ? T.represses : e.data("sign") === 1 ? T.activates : T.unknown;
  return [
    { selector: "node", style: {
      width: "data(diameter)", height: "data(diameter)", shape: "ellipse",
      "background-color": T.node, "background-fill": "solid", "border-width": 0,
      // The name sits inside the circle. It may run past the rim of a small
      // node; dark text on a thin white halo stays readable either way.
      label: "data(label)", color: T.label,
      "font-family": "Arial, Helvetica, sans-serif", "font-size": "data(labelSize)", "font-weight": 400,
      "text-halign": (n: NodeSingular) => n.data("labelHalign"), "text-valign": (n: NodeSingular) => n.data("labelValign"),
      "text-margin-x": (n: NodeSingular) => n.data("labelOffsetX"), "text-margin-y": (n: NodeSingular) => n.data("labelOffsetY"),
      "text-outline-width": 1, "text-outline-color": T.labelHalo, "text-outline-opacity": 0.85,
      "min-zoomed-font-size": 7,
      "overlay-opacity": 0, "z-index": 10,
    } },
    { selector: "node[isTF = 1]", style: { "background-color": T.tf } },
    { selector: "node[diameter > 90]", style: { "font-weight": 600 } },
    { selector: "edge", style: {
      "curve-style": (e: EdgeSingular) => e.data("routeDistances") ? "unbundled-bezier" : "bezier",
      "control-point-distances": (e: EdgeSingular) => e.data("routeDistances") ?? [0],
      "control-point-weights": (e: EdgeSingular) => e.data("routeWeights") ?? [0.5],
      "edge-distances": "node-position", "line-cap": "butt", "line-color": color, "line-style": "solid",
      width: "data(width)", opacity: (e: EdgeSingular) => e.data("inkOpacity"), "overlay-opacity": 0,
      // Tip = direction, drawn only at a resolved regulated end. Arrowhead =
      // activation, flat bar = repression, hollow arrowhead = sign unknown.
      "source-arrow-shape": (e: EdgeSingular) => e.data("sourceTip"),
      "target-arrow-shape": (e: EdgeSingular) => e.data("targetTip"),
      "source-arrow-color": color, "target-arrow-color": color,
      "source-arrow-fill": (e: EdgeSingular) => e.data("arrowFill"),
      "target-arrow-fill": (e: EdgeSingular) => e.data("arrowFill"),
      "arrow-scale": (e: EdgeSingular) => Number(e.data("arrowScale")) || 0.8,
      // Weak relationships underneath, strong ones on top.
      "z-index": (e: EdgeSingular) => Number(e.data("zIndex")) || 1,
    } },
    { selector: "node.hovered, node.traced", style: {
      "min-zoomed-font-size": 0,
      "underlay-color": T.accent, "underlay-opacity": 0.14, "underlay-padding": 6, "z-index": 30,
    } },
    { selector: "node.traced-neighbour", style: { "min-zoomed-font-size": 0, "z-index": 20 } },
    { selector: "edge.traced-neighbour", style: { opacity: (e: EdgeSingular) => Math.max(0.6, Number(e.data("inkOpacity")) || 1) } },
    { selector: "edge.traced, edge.hovered", style: { width: (e: EdgeSingular) => Number(e.data("width")) * 1.6, opacity: 1, "z-index": 25 } },
    { selector: "node.muted", style: { opacity: 0.25, "text-opacity": 0.2 } },
    { selector: "edge.muted", style: { opacity: 0.06 } },
  ];
}
