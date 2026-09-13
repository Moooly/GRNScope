import type { EdgeSingular, NodeSingular, StylesheetJson } from "cytoscape";
import { NETWORK_SCALE, NETWORK_THEME as T } from "./theme";
import {
  labelSizePx,
  linkOpacity,
  linkWidthPx,
  modelUnits,
  nodeDiameterModel,
} from "./encoding";

export type StylesheetInput = {
  /** The zoom the camera has settled on. Every pixel budget below is divided
   *  by it, which is what makes the numbers mean the same thing at any size. */
  zoom: number;
  minDegree: number;
  maxDegree: number;
  edgeCount: number;
};

/**
 * The whole visual language, in one stylesheet with no branches on graph size.
 *
 * It is rebuilt after the camera settles rather than carrying per-node style
 * bypasses. Bypasses were how the previous version went wrong: they are
 * applied outside the stylesheet, they survive restyles, and when one pass set
 * a white halo on text that another pass had already coloured white, the
 * result was gene names rendered as blank bars. A stylesheet rebuilt from one
 * set of inputs cannot disagree with itself.
 */
export function buildNetworkStylesheet({
  zoom,
  minDegree,
  maxDegree,
  edgeCount,
}: StylesheetInput): StylesheetJson {
  const px = (value: number) => modelUnits(value, zoom);
  // Model units: fixed, so changing the zoom cannot change the node size that
  // the zoom was derived from.
  const diameter = (n: NodeSingular) =>
    nodeDiameterModel(Number(n.data("degree")) || 0, maxDegree, minDegree);
  const restOpacity = linkOpacity(edgeCount);

  return [
    {
      selector: "node",
      style: {
        width: diameter,
        height: diameter,
        shape: "ellipse",
        "background-color": T.node,
        "background-fill": "solid",
        "border-width": 1,
        "border-color": T.nodeRim,
        label: "data(label)",
        color: T.label,
        "font-size": (n: NodeSingular) =>
          px(labelSizePx(Number(n.data("degree")) || 0, maxDegree)),
        "font-weight": 500,
        // Below the node, never inside it. A name inside a disc has to shrink
        // to fit the disc, which ties legibility to degree and makes the least
        // connected genes the hardest to read -- exactly backwards.
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": px(3),
        "text-outline-color": T.labelHalo,
        "text-outline-width": px(1.5),
        // The one label control. Cytoscape drops labels below this rendered
        // size on its own, so zooming out thins the names instead of turning
        // them into grit.
        "min-zoomed-font-size": NETWORK_SCALE.labelMinPx - 1,
        "z-index": 10,
        "transition-property": "background-color, border-color, opacity",
        "transition-duration": 120,
      },
    },
    {
      // A regulator is a diamond. Shape is the right channel for a category:
      // it is absolute rather than comparative, it survives being small, and
      // unlike a hue it costs nothing from the colour budget -- which the
      // edges below need in full for sign.
      //
      // A diamond of a given width covers about half the ink of a circle of
      // the same width, so it is drawn larger to keep size meaning degree and
      // only degree.
      selector: "node[isTF = 1]",
      style: {
        shape: "diamond",
        width: (n: NodeSingular) =>
          nodeDiameterModel(Number(n.data("degree")) || 0, maxDegree, minDegree) *
          1.32,
        height: (n: NodeSingular) =>
          nodeDiameterModel(Number(n.data("degree")) || 0, maxDegree, minDegree) *
          1.32,
        "border-color": T.regulatorRing,
      },
    },
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        "control-point-step-size": 18,
        // Evidence as weight, sign as hue. Two channels that do not collide:
        // you can see that a link is strong without knowing which way it acts,
        // and vice versa, which is what lets both survive at four hundred
        // links when neither would survive as a label.
        width: (e: EdgeSingular) =>
          px(linkWidthPx(Number(e.data("evidence")), edgeCount)),
        "line-color": (e: EdgeSingular) => {
          const sign = Number(e.data("sign"));
          if (sign === 1) return T.activates;
          if (sign === -1) return T.represses;
          return T.link;
        },
        opacity: restOpacity,
        "target-arrow-shape": "none",
        "source-arrow-shape": "none",
        "arrow-scale": 1.15,
        "target-arrow-fill": "filled",
        "source-arrow-fill": "filled",
        // Hold the tip clear of the disc so it reads as a tip rather than
        // disappearing into the node it points at.
        "target-distance-from-node": 2,
        "source-distance-from-node": 2,
        // Under the nodes, always. A link that crosses a disc should pass
        // behind it; drawing threads over the things they connect is most of
        // what makes a dense graph look like a scribble.
        "z-index": 1,
        "transition-property": "line-color, opacity, width",
        "transition-duration": 120,
      },
    },

    // --- the tip: what the regulator does to its target ---------------------
    //
    // Hue alone says activation or repression, but only once you have learned
    // which hue is which; the shape of the tip says it outright, and the two
    // together survive being small, being faint, and being colour-blind.
    //
    // Which end carries it depends on whether the run knows a direction. When
    // it does, the tip goes on the target, as an arrow should. When it does
    // not -- correlation and mutual information cannot tell which gene acts on
    // which -- the tip goes on both ends. That is not decoration: a
    // double-ended tip states exactly what the methods found, an activating or
    // repressing relationship between two genes with no direction to it, and
    // it keeps the canvas from asserting a direction no method inferred.
    {
      selector: "edge[sign = 1][directed = 1]",
      style: { "target-arrow-shape": "triangle", "target-arrow-color": T.activates },
    },
    {
      selector: "edge[sign = -1][directed = 1]",
      style: { "target-arrow-shape": "tee", "target-arrow-color": T.represses },
    },
    {
      selector: "edge[sign = 1][directed = 0]",
      style: {
        "target-arrow-shape": "triangle",
        "source-arrow-shape": "triangle",
        "target-arrow-color": T.activates,
        "source-arrow-color": T.activates,
      },
    },
    {
      selector: "edge[sign = -1][directed = 0]",
      style: {
        "target-arrow-shape": "tee",
        "source-arrow-shape": "tee",
        "target-arrow-color": T.represses,
        "source-arrow-color": T.represses,
      },
    },

    // --- selection and tracing: the only colour on the canvas ---------------
    {
      selector: "node.traced",
      style: {
        "background-color": T.accent,
        "border-color": T.accent,
        color: T.label,
        "font-weight": 700,
        label: "data(fullLabel)",
        "min-zoomed-font-size": 0,
        "z-index": 30,
      },
    },
    {
      selector: "node.traced-neighbour",
      style: {
        "background-color": T.accentSoft,
        "border-color": T.accent,
        label: "data(fullLabel)",
        "min-zoomed-font-size": 0,
        "z-index": 25,
      },
    },
    {
      selector: "edge.traced",
      style: {
        "line-color": T.accent,
        "target-arrow-color": T.accent,
        "source-arrow-color": T.accent,
        width: (e: EdgeSingular) =>
          px(linkWidthPx(Number(e.data("evidence")), edgeCount) + 0.8),
        opacity: 1,
        "z-index": 20,
      },
    },
    {
      // Everything the selection does not reach steps back. Fading the rest is
      // what makes one accent enough: the eye finds the coloured thing because
      // nothing else is competing, not because the colour is loud.
      selector: "node.muted",
      style: {
        "background-color": T.nodeMuted,
        "border-color": T.nodeMuted,
        "text-opacity": 0.25,
        "z-index": 2,
      },
    },
    {
      selector: "edge.muted",
      style: {
        "line-color": T.linkMuted,
        "target-arrow-color": T.linkMuted,
        "source-arrow-color": T.linkMuted,
        opacity: 0.35,
        "z-index": 0,
      },
    },
    {
      selector: "node.hovered",
      style: { "border-color": T.accent, "border-width": 2.6 },
    },
    {
      selector: "edge.hovered",
      style: {
        "line-color": T.accent,
        "target-arrow-color": T.accent,
        "source-arrow-color": T.accent,
        opacity: 1,
        width: (e: EdgeSingular) =>
          px(linkWidthPx(Number(e.data("evidence")), edgeCount) + 0.8),
      },
    },
  ];
}
