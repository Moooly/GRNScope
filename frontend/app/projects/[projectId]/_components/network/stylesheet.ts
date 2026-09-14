import type { StylesheetJson, EdgeSingular } from "cytoscape";
import { NETWORK_THEME as T } from "./theme";

export function buildNetworkStylesheet(): StylesheetJson {
  const color = (e: EdgeSingular) => e.data("sign") === -1 ? T.represses : T.link;
  return [
    { selector: "node", style: {
      width: "data(diameter)", height: "data(diameter)", shape: "ellipse",
      "background-color": T.node, "border-width": 0, label: "data(label)", color: T.label,
      "font-family": "Arial, Helvetica, sans-serif", "font-size": "data(labelSize)", "font-weight": 400,
      "text-valign": "bottom", "text-margin-y": 4,
      "text-outline-width": 1.3, "text-outline-color": T.ground, "min-zoomed-font-size": 7,
      "overlay-opacity": 0, "z-index": 10,
    } },
    { selector: "node[isTF = 1]", style: { "border-color": T.regulatorRing, "border-width": 1.2 } },
    { selector: "node[degree > 8]", style: { "font-weight": 600 } },
    { selector: "edge", style: {
      "curve-style": (e: EdgeSingular) => e.data("routeDistances") ? "unbundled-bezier" : "bezier",
      "control-point-distances": (e: EdgeSingular) => e.data("routeDistances") ?? [0],
      "control-point-weights": (e: EdgeSingular) => e.data("routeWeights") ?? [0.5],
      "edge-distances": "node-position", "line-cap": "round", "line-color": color,
      width: "data(width)", opacity: 0.26, "overlay-opacity": 0,
      "source-arrow-shape": "none", "target-arrow-shape": "none",
      "source-arrow-color": color, "target-arrow-color": color,
      "source-arrow-fill": (e: EdgeSingular) => e.data("arrowFill"),
      "target-arrow-fill": (e: EdgeSingular) => e.data("arrowFill"),
      "arrow-scale": 0.65, "z-index": 1,
    } },
    { selector: "edge.detail, edge.traced, edge.traced-neighbour, edge.hovered", style: {
      "source-arrow-shape": (e: EdgeSingular) => e.data("sourceTip"),
      "target-arrow-shape": (e: EdgeSingular) => e.data("targetTip"),
      opacity: 0.82,
    } },
    { selector: "node.hovered, node.traced", style: {
      label: "data(fullLabel)", "min-zoomed-font-size": 0,
      "border-width": 2, "border-color": T.accent,
      "underlay-color": T.accent, "underlay-opacity": 0.13, "underlay-padding": 6, "z-index": 30,
    } },
    { selector: "node.traced-neighbour", style: { label: "data(fullLabel)", "min-zoomed-font-size": 0, "z-index": 20 } },
    { selector: "edge.traced, edge.hovered", style: { width: (e: EdgeSingular) => Number(e.data("width")) * 1.8, opacity: 1, "z-index": 15 } },
    { selector: "edge.traced, edge.traced-neighbour, edge.hovered", style: { "curve-style": "bezier", "control-point-step-size": 20 } },
    { selector: "node.muted", style: { opacity: 0.25, "text-opacity": 0.2 } },
    { selector: "edge.muted", style: { opacity: 0.045 } },
  ];
}
