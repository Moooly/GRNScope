import type { StylesheetJson, EdgeSingular } from "cytoscape";
import { appearanceStyles, type NetworkAppearance } from "./networkAppearance";
import { NETWORK_COLORS } from "./networkVisualEncoding";

export function getNetworkGraphStylesheet(
  appearance: "light" | "publication" = "light",
  preset: NetworkAppearance = "classic",
): StylesheetJson {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-family": "Arial, Helvetica, sans-serif",
        "font-size": 13,
        "font-weight": 500,
        color: "#263b49",
        "text-valign": "bottom",
        "text-margin-y": 8,
        "text-outline-width": 3,
        "text-outline-color": appearance === "publication" ? "#fff" : "#fafcfc",
        "min-zoomed-font-size": 10,
        width: 21,
        height: 21,
        "background-color": NETWORK_COLORS.node,
        "border-color": "#fff",
        "border-width": 2,
        "overlay-opacity": 0,
      },
    },
    {
      selector: "node[isTF = 1]",
      style: { shape: "diamond", width: 27, height: 27, "font-weight": 700 },
    },
    { selector: "node[isTF = 0]", style: { shape: "ellipse" } },
    {
      selector: "edge",
      style: {
        width: 1.7,
        "line-color": "data(edgeColor)",
        opacity: (edge: EdgeSingular) =>
          (edge.data("metricOpacity") as number) ?? 0.5,
        "curve-style": "bezier",
        "line-cap": "round",
        "arrow-scale": 0.7,
        "source-arrow-shape": (edge) => edge.data("sourceArrowShape"),
        "target-arrow-shape": (edge) => edge.data("targetArrowShape"),
        "source-arrow-color": "data(edgeColor)",
        "target-arrow-color": "data(edgeColor)",
        "source-distance-from-node": (edge) => edge.data("sourceDistanceFromNode"),
        "target-distance-from-node": (edge) => edge.data("targetDistanceFromNode"),
        "source-arrow-fill": (edge) => edge.data("arrowFill"),
        "target-arrow-fill": (edge) => edge.data("arrowFill"),
        label: "",
        "font-size": 12,
        "font-weight": 700,
        color: "data(edgeColor)",
        "text-background-color": "#fafcfc",
        "text-background-opacity": 0,
        "text-background-padding": "0px",
        "text-margin-y": -7,
        "text-outline-color": "#fafcfc",
        "text-outline-width": 1,
        "text-rotation": "none",
        "min-zoomed-font-size": 10,
        "overlay-opacity": 0,
      },
    },
    { selector: "edge[denseNetwork = 1]", style: { opacity: 0.24, label: "" } },
    {
      selector: "edge.local-edge, edge.hovered",
      style: { opacity: 0.9, label: "" },
    },
    {
      selector: "edge[metricUnavailable = 1]",
      style: { "line-style": "dashed" },
    },
    {
      selector: "edge.reciprocal",
      style: { "curve-style": "bezier", "control-point-step-size": 42 },
    },
    {
      selector: "node.context-muted",
      style: { opacity: 0.24, "text-opacity": 0 },
    },
    {
      selector: "edge.context-muted",
      style: { opacity: 0.09, "text-opacity": 0 },
    },
    {
      selector: "node.revealed",
      style: { label: "data(fullLabel)", "min-zoomed-font-size": 0 },
    },
    {
      selector: "node:selected, node.endpoint",
      style: {
        label: "data(fullLabel)",
        "min-zoomed-font-size": 0,
        "border-width": 3,
        "border-color": NETWORK_COLORS.selection,
        "underlay-color": NETWORK_COLORS.selection,
        "underlay-opacity": 0.12,
        "underlay-padding": 8,
        "z-index": 20,
      },
    },
    {
      selector: "edge:selected, edge.hovered",
      style: {
        opacity: 1,
        "underlay-color": NETWORK_COLORS.selection,
        "underlay-opacity": 0.2,
        "underlay-padding": 5,
        "z-index": 19,
      },
    },
    {
      selector: "edge.annotated",
      style: {
        label: "data(annotation)",
        "font-size": 11,
        "font-weight": 500,
        "text-margin-y": -12,
        "text-background-color": "#fff",
        "text-background-opacity": 1,
        "text-outline-width": 0,
        "text-background-padding": "5px",
        "min-zoomed-font-size": 0,
        "text-border-width": 1,
        "text-border-color": "#e0e7e9",
        "text-border-opacity": 1,
      },
    },
    { selector: "node.trace-mute", style: { opacity: 0.15, "text-opacity": 0 } },
    { selector: "edge.trace-mute", style: { opacity: 0.05, "text-opacity": 0 } },
    { selector: "edge.trace-on", style: { opacity: 0.95 } },
    {
      selector: "node.trace-focus",
      style: {
        label: "data(fullLabel)",
        "min-zoomed-font-size": 0,
        "z-index": 30,
      },
    },
    ...appearanceStyles(preset),
    // The selection braid: one coloured thread per method backing the
    // relationship the user clicked. These elements exist only while that
    // relationship is selected, so they are drawn lit rather than waiting for
    // a highlight class.
    {
      selector: "edge.strand",
      style: {
        width: 1.9,
        "line-color": "data(strandColor)",
        opacity: 0.9,
        "curve-style": "unbundled-bezier",
        // Bend + offset, matching the consensus edge's own control points so
        // the fan stays parallel to the line it belongs to.
        "control-point-distances": (e: EdgeSingular) => {
          const curve = e.data("galleryCurve") as number[] | undefined;
          if (curve) return curve;
          const offset = (e.data("strandOffset") as number) ?? 0;
          return [offset, offset];
        },
        "control-point-weights": [0.25, 0.72],
        "source-arrow-shape": "none",
        "target-arrow-shape": "none",
        "source-distance-from-node": 10,
        "target-distance-from-node": 10,
        // A round cap would overshoot the consensus arrowhead by half the width.
        "line-cap": "butt",
        label: "",
        events: "no",
        "z-index": 3,
      },
    },
  ];
}
