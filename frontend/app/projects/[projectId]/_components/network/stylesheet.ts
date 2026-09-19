import type { StylesheetJson, EdgeSingular, NodeSingular } from "cytoscape";
import { NETWORK_THEME as T } from "./theme";

export function buildNetworkStylesheet(): StylesheetJson {
  // Three sign states, three colours. This used to be a binary -- repression got
  // clay, *everything else* got teal -- so a relationship whose sign no method
  // resolved rendered identically to a confirmed activation. With no glyph drawn
  // in that case either, the two were indistinguishable: the figure asserted an
  // activation the data had never claimed. The bug was invisible in practice
  // only because every run checked so far resolved a sign on 100% of edges.
  const color = (e: EdgeSingular) =>
    e.data("sign") === -1 ? T.represses : e.data("sign") === 1 ? T.link : T.unknown;
  return [
    { selector: "node", style: {
      width: "data(diameter)", height: "data(diameter)", shape: "ellipse",
      "background-color": T.node,
      "background-fill": "solid",
      "border-color": T.nodeRim, "border-width": 0.55, label: "data(label)", color: T.label,
      "font-family": "Arial, Helvetica, sans-serif", "font-size": "data(labelSize)", "font-weight": 400,
      "text-halign": (n: NodeSingular) => n.data("labelHalign"), "text-valign": (n: NodeSingular) => n.data("labelValign"),
      "text-margin-x": (n: NodeSingular) => n.data("labelOffsetX"), "text-margin-y": (n: NodeSingular) => n.data("labelOffsetY"),
      "text-outline-width": 1, "text-outline-color": T.ground, "min-zoomed-font-size": 9,
      "overlay-opacity": 0, "z-index": 10,
    } },
    /* Shape is the whole of it. Fill, rim and area are identical to a
     * target gene, so nothing but the silhouette says "regulator" -- no second
     * colour to learn, and the two marks sit at the same visual weight in a
     * dense field. The area match is done in model.ts, not here, because the
     * geometry solver has to know the widened box as well.
     *
     * The cost is at the smallest sizes: around seven pixels a diamond and a
     * circle are nearly the same handful of pixels. Zoom resolves it, and the
     * inspector names the role outright. */
    { selector: "node[isTF = 1]", style: { shape: "diamond" } },
    { selector: "node[degree > 8]", style: { "font-weight": 600 } },
    { selector: "edge", style: {
      "curve-style": (e: EdgeSingular) => e.data("routeDistances") ? "unbundled-bezier" : "bezier",
      "control-point-distances": (e: EdgeSingular) => e.data("routeDistances") ?? [0],
      "control-point-weights": (e: EdgeSingular) => e.data("routeWeights") ?? [0.5],
      "edge-distances": "node-position", "line-cap": "round", "line-color": color,
      "line-style": (e: EdgeSingular) => e.data("sign") === -1 && !e.data("direction") ? "dashed" : "solid",
      "line-dash-pattern": [4, 3],
      width: "data(width)", opacity: (e: EdgeSingular) => e.data("inkOpacity"), "overlay-opacity": 0,
      // Drawn at every zoom, not gated behind a detail threshold. The glyph is
      // the only channel that states the effect as a mark rather than as a hue,
      // and a mark nobody finds without zooming is not doing its job. Cost is
      // contained: arrows inherit the edge's own opacity, so on a dense view
      // they fade exactly as far as the line carrying them.
      "source-arrow-shape": (e: EdgeSingular) => e.data("sourceTip"),
      "target-arrow-shape": (e: EdgeSingular) => e.data("targetTip"),
      "source-arrow-color": color, "target-arrow-color": color,
      "source-arrow-fill": (e: EdgeSingular) => e.data("arrowFill"),
      "target-arrow-fill": (e: EdgeSingular) => e.data("arrowFill"),
      // Set per-edge alongside width, because the two move together: the tip is
      // sized as a multiple of the stroke, so a density step-down has to change
      // both or the heads swell as the lines thin.
      "arrow-scale": (e: EdgeSingular) => Number(e.data("arrowScale")) || 0.78,
      "z-index": 1,
    } },
    { selector: "node.hovered, node.traced", style: {
      "min-zoomed-font-size": 0,
      "border-width": 2, "border-color": T.accent,
      "underlay-color": T.accent, "underlay-opacity": 0.16, "underlay-padding": 6, "z-index": 30,
    } },
    { selector: "node.traced-neighbour", style: { "min-zoomed-font-size": 0, "z-index": 20 } },
    { selector: "edge.traced-neighbour", style: { opacity: 0.85 } },
    { selector: "edge.traced, edge.hovered", style: { width: (e: EdgeSingular) => Number(e.data("width")) * 1.8, opacity: 1, "arrow-scale": (e: EdgeSingular) => (Number(e.data("arrowScale")) || 0.78) * 0.8, "z-index": 15 } },
    { selector: "node.muted", style: { opacity: 0.25, "text-opacity": 0.2 } },
    { selector: "edge.muted", style: { opacity: 0.09 } },
  ];
}
