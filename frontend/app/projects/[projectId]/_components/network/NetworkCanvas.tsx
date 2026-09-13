"use client";

import { useEffect, useMemo, useRef } from "react";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import fcose from "cytoscape-fcose";
import {
  buildCircularPositions,
  buildConcentricPositions,
  buildHierarchicalPositions,
} from "../networkGraphLayouts";
import type {
  NetworkEdge,
  NetworkGraphProps,
  NetworkNode,
  PositionMap,
} from "../networkGraphTypes";
import { NETWORK_SCALE, NETWORK_THEME } from "./theme";
import { buildNetworkStylesheet } from "./stylesheet";
import { forceLayoutOptions } from "./layout";
import { applyLabelBudget } from "./labels";
import { settleView, syncBundling } from "./camera";

const registry = globalThis as typeof globalThis & {
  __grnFcose?: boolean;
};
if (typeof window !== "undefined" && !registry.__grnFcose) {
  cytoscape.use(fcose);
  registry.__grnFcose = true;
}

function buildElements(
  nodes: NetworkNode[],
  edges: NetworkEdge[],
): ElementDefinition[] {
  // Degree counted over the relationships actually drawn. The upstream figure
  // counts the unfiltered network, so once the opening view trims to the
  // strongest links, sizing by it would show a gene as a hub on the strength
  // of edges the reader cannot see -- and the legend says "connections".
  const shown = new Map<string, number>();
  edges.forEach((edge) => {
    shown.set(edge.source, (shown.get(edge.source) ?? 0) + 1);
    shown.set(edge.target, (shown.get(edge.target) ?? 0) + 1);
  });
  return [
    ...nodes.map((node) => ({
      data: {
        id: node.id,
        label: node.id,
        fullLabel: node.id,
        degree: shown.get(node.id) ?? 0,
        isTF: node.isTF ? 1 : 0,
      },
    })),
    ...edges.map((edge) => ({
      data: {
        id: edge.key,
        source: edge.source,
        target: edge.target,
        sign: edge.sign,
        // Whether any method in the run actually resolved which gene acts on
        // which. Correlation and mutual-information methods do not, so the
        // pair order on an undirected edge is an artefact of how it was
        // stored -- putting a single arrowhead on one end of it would invent a
        // direction the data does not contain.
        directed:
          edge.directionCoverage > 0 && edge.directionConfidence !== null ? 1 : 0,
        support: edge.supportingAlgorithms?.length ?? 0,
        // Evidence drives how heavy the link is drawn, so it needs to be a
        // finite 0..1 whatever the methods returned.
        evidence: Math.max(
          0,
          Math.min(
            1,
            Number.isFinite(edge.confidence)
              ? edge.confidence
              : Number.isFinite(edge.score)
                ? edge.score
                : 0.5,
          ),
        ),
        confidence: edge.confidence,
        score: edge.score,
      },
    })),
  ];
}

/** A signature that changes only when the graph's shape changes, so panning,
 *  selecting and resizing never trigger a relayout. */
function topologyOf(nodes: NetworkNode[], edges: NetworkEdge[]) {
  return `${nodes.length}:${edges.length}:${nodes[0]?.id ?? ""}:${
    edges[0]?.key ?? ""
  }:${edges[edges.length - 1]?.key ?? ""}`;
}

/**
 * The network canvas.
 *
 * One renderer, one stylesheet, one sizing model. Where the old canvas asked
 * "how big is this graph?" and branched -- a different style above sixty
 * nodes, a different density above sixty edges, different layout constants
 * above eight hundred -- this one asks only "what zoom did the camera settle
 * on?" and divides its pixel budgets by it. Nothing swaps; things grow, fade
 * and thin out continuously, which is the only way a design can be honest
 * about covering five genes to five thousand.
 */
export default function NetworkCanvas({
  nodes,
  edges,
  layout,
  selectedGene,
  selectedEdgeKey,
  onSelectGene,
  onSelectEdge,
  onGraphReady,
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const coreRef = useRef<Core | null>(null);
  const topologyRef = useRef("");
  const layingOutRef = useRef(false);
  const stopLayoutRef = useRef<(() => void) | null>(null);
  const latest = useRef({ nodes, edges, onSelectGene, onSelectEdge, onGraphReady });
  latest.current = { nodes, edges, onSelectGene, onSelectEdge, onGraphReady };

  const topology = useMemo(() => topologyOf(nodes, edges), [nodes, edges]);

  // --- construction ------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: buildNetworkStylesheet({
        zoom: 1,
        minDegree: 1,
        maxDegree: 1,
        edgeCount: 0,
      }),
      minZoom: NETWORK_SCALE.minZoom,
      maxZoom: NETWORK_SCALE.maxZoom,
      wheelSensitivity: 0.25,
      // Draw at the display's own density. Pinning this to 1 renders the whole
      // canvas at half resolution on a Retina screen and then scales it up --
      // every disc and every gene name comes out soft. The texture-on-viewport
      // trick blurs for the same reason, swapping the live scene for a bitmap
      // while you pan; a few hundred nodes do not need either.
      pixelRatio: "auto",
      textureOnViewport: false,
      motionBlur: false,
    });
    coreRef.current = cy;
    // This instance holds no elements yet, so the topology guard must not
    // still be carrying the last one's signature. React mounts effects twice
    // in development, and without this the second instance saw its own
    // topology as already drawn and stayed empty.
    topologyRef.current = "";
    latest.current.onGraphReady?.(cy);

    cy.on("tap", "node", (event) =>
      latest.current.onSelectGene(event.target.id()),
    );
    cy.on("tap", "edge", (event) =>
      latest.current.onSelectEdge(event.target.id()),
    );
    cy.on("tap", (event) => {
      if (event.target === cy) {
        latest.current.onSelectGene(null);
        latest.current.onSelectEdge(null);
      }
    });
    cy.on("mouseover", "node", (e) => e.target.addClass("hovered"));
    cy.on("mouseout", "node", (e) => e.target.removeClass("hovered"));
    cy.on("mouseover", "edge", (e) => e.target.addClass("hovered"));
    cy.on("mouseout", "edge", (e) => e.target.removeClass("hovered"));

    // Panning and zooming change which names fit, but not how big anything
    // should be -- the pixel budget is set when the camera settles, and a
    // reader zooming in expects the graph to get bigger, not to stay put.
    let frame = 0;
    const onView = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (cy.destroyed() || layingOutRef.current) return;
        syncBundling(cy);
        applyLabelBudget(cy);
      });
    };
    cy.on("zoom pan", onView);

    const observer = new ResizeObserver(() => {
      if (cy.destroyed()) return;
      cy.resize();
      if (!layingOutRef.current) settleView(cy);
    });
    observer.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(frame);
      stopLayoutRef.current?.();
      observer.disconnect();
      latest.current.onGraphReady?.(null);
      cy.destroy();
      coreRef.current = null;
      topologyRef.current = "";
    };
  }, []);

  // --- topology and layout ----------------------------------------------
  useEffect(() => {
    const cy = coreRef.current;
    if (!cy || cy.destroyed()) return;
    if (topologyRef.current === topology) return;
    topologyRef.current = topology;

    stopLayoutRef.current?.();
    cy.batch(() => {
      cy.elements().remove();
      cy.add(buildElements(nodes, edges));
    });
    if (!nodes.length) return;

    if (layout === "force") {
      layingOutRef.current = true;
      const run = cy.layout(
        forceLayoutOptions(nodes.length, { width: cy.width(), height: cy.height() }, () => {
          layingOutRef.current = false;
          if (!cy.destroyed()) settleView(cy);
        }),
      );
      stopLayoutRef.current = () => {
        try {
          run.stop();
        } catch {
          // already settled
        }
        layingOutRef.current = false;
      };
      run.run();
      return;
    }

    const positions: PositionMap =
      layout === "hierarchical"
        ? buildHierarchicalPositions(nodes, edges)
        : layout === "concentric"
          ? buildConcentricPositions(nodes, edges)
          : buildCircularPositions(nodes, edges);
    cy.nodes().positions((node) => positions[node.id()] ?? { x: 0, y: 0 });
    settleView(cy);
  }, [topology, layout, nodes, edges]);

  // --- selection: the only colour on the canvas --------------------------
  useEffect(() => {
    const cy = coreRef.current;
    if (!cy || cy.destroyed()) return;

    cy.batch(() => {
      cy.elements().removeClass("traced traced-neighbour muted");
      const focusNode = selectedGene ? cy.getElementById(selectedGene) : null;
      const focusEdge = selectedEdgeKey
        ? cy.getElementById(selectedEdgeKey)
        : null;

      if (focusEdge && focusEdge.nonempty()) {
        focusEdge.addClass("traced");
        focusEdge.connectedNodes().addClass("traced");
        cy.elements()
          .difference(focusEdge.union(focusEdge.connectedNodes()))
          .addClass("muted");
        return;
      }
      if (focusNode && focusNode.nonempty()) {
        const links = focusNode.connectedEdges();
        const neighbours = links.connectedNodes().difference(focusNode);
        focusNode.addClass("traced");
        neighbours.addClass("traced-neighbour");
        links.addClass("traced");
        cy.elements()
          .difference(focusNode.union(neighbours).union(links))
          .addClass("muted");
      }
    });
    // Tracing something means following its actual links, so the trunks let
    // go for as long as a selection is live.
    syncBundling(cy);
    applyLabelBudget(cy);
  }, [selectedGene, selectedEdgeKey, topology]);

  return (
    <div
      ref={containerRef}
      className="grn-canvas"
      style={{ width: "100%", height: "100%", background: NETWORK_THEME.ground }}
    />
  );
}
