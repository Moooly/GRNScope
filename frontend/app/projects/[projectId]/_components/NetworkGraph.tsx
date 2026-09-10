"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core, type LayoutOptions } from "cytoscape";
import { updateGalleryCurves } from "./networkAppearance";
import { frameNetworkSelection } from "./networkCamera";
import { createBranchLayout } from "./networkBranchLayout";
import { createAtlasLayout } from "./networkAtlasLayout";
import {
  buildCircularPositions,
  buildConcentricPositions,
  buildGraphElements,
  buildHierarchicalPositions,
  getLayoutConfig,
} from "./networkGraphLayouts";
import { getNetworkGraphStylesheet } from "./networkGraphStyles";
import {
  edgeAnnotation,
  edgeMetric,
  evidenceText,
  metricWidth,
  percent,
  relationshipLabel,
  signText,
} from "./networkVisualEncoding";
import type {
  NetworkEdge,
  NetworkGraphProps,
  PositionMap,
} from "./networkGraphTypes";

const registry = globalThis as typeof globalThis & {
  __grnScopeSvgRegistered?: boolean;
};
export const MIN_NETWORK_ZOOM = 0.02;
export const MAX_NETWORK_ZOOM = 3;
export const ABSOLUTE_MIN_NETWORK_ZOOM = MIN_NETWORK_ZOOM;

export default function NetworkGraph(props: NetworkGraphProps) {
  const {
    nodes,
    edges,
    layout,
    appearance = "classic",
    metric = "confidence",
    methodCount = 1,
    highlightedMethod,
    showEdgeLabels = false,
    selectedGene,
    selectedEdgeKey,
    focusGene,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<Core | null>(null);
  const latest = useRef(props);
  const topologyRef = useRef("");
  const cancelLayout = useRef<(() => void) | null>(null);
  const layoutPending = useRef(false);
  const [arranging, setArranging] = useState(false);
  const refreshLabels = useRef<() => void>(() => {});
  const positionCache = useRef(new Map<string, PositionMap>());
  const [tooltip, setTooltip] = useState<{
    edge: NetworkEdge;
    x: number;
    y: number;
  } | null>(null);
  const elements = useMemo(
    () => buildGraphElements(nodes, edges).elements,
    [nodes, edges],
  );
  const topology = useMemo(
    () =>
      JSON.stringify([
        layout,
        layout === "force" && appearance === "teal" ? "branches" : "atlas",
        nodes.map((n) => [n.id, n.isTF]).sort(),
        edges.map((e) => [e.key, e.source, e.target]).sort(),
      ]),
    [nodes, edges, layout, appearance],
  );

  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: getNetworkGraphStylesheet(),
      minZoom: MIN_NETWORK_ZOOM,
      maxZoom: MAX_NETWORK_ZOOM,
      selectionType: "single",
      boxSelectionEnabled: false,
      autounselectify: false,
      layout: { name: "preset" },
    });
    coreRef.current = cy;
    latest.current.onGraphReady?.(cy);
    void import("cytoscape-svg").then((module) => {
      if (!registry.__grnScopeSvgRegistered) {
        module.default(cytoscape);
        registry.__grnScopeSvgRegistered = true;
      }
    });
    cy.on("tap", "node", (event) => {
      latest.current.onSelectEdge(null);
      latest.current.onSelectGene(event.target.id());
    });
    cy.on("tap", "edge", (event) => {
      latest.current.onSelectGene(null);
      latest.current.onSelectEdge(event.target.id());
    });
    cy.on("tap", (event) => {
      if (event.target === cy) {
        latest.current.onSelectGene(null);
        latest.current.onSelectEdge(null);
      }
    });
    cy.on("mouseover", "node", (event) => event.target.addClass("revealed"));
    cy.on("mouseout", "node", (event) => event.target.removeClass("revealed"));
    cy.on("mouseover", "edge", (event) => {
      const edge = latest.current.edges.find(
        (item) => item.key === event.target.id(),
      );
      if (!edge) return;
      event.target.addClass("hovered");
      const point = event.renderedPosition ?? event.target.renderedMidpoint();
      setTooltip({
        edge,
        x: Math.max(8, Math.min(point.x + 16, cy.width() - 292)),
        y: Math.max(8, Math.min(point.y + 16, cy.height() - 180)),
      });
    });
    cy.on("mouseout", "edge", (event) => {
      event.target.removeClass("hovered");
      setTooltip(null);
    });
    cy.on("zoom pan", () => setTooltip(null));
    // Label budget follows actual screen space. Selected endpoints always remain readable.
    let frame = 0;
    const updateLabels = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (cy.destroyed() || layoutPending.current) return;
        const occupied: Array<{ x: number; y: number; w: number }> = [];
        const ordered = cy
          .nodes()
          .toArray()
          .sort(
            (a, b) =>
              Number(b.selected()) - Number(a.selected()) ||
              b.data("degree") - a.data("degree"),
          );
        cy.batch(() =>
          ordered.forEach((node) => {
            const p = node.renderedPosition();
            const text = node.data("fullLabel") as string;
            const w = Math.max(35, text.length * 7 * Math.min(cy.zoom(), 1.4));
            const priority = node.selected() || node.hasClass("endpoint");
            const visible =
              p.x > 0 && p.x < cy.width() && p.y > 0 && p.y < cy.height();
            const fits = !occupied.some(
              (box) =>
                Math.abs(box.y - p.y) < 25 &&
                Math.abs(box.x - p.x) < (box.w + w) / 2 + 8,
            );
            const label =
              priority ||
              (visible &&
                ((cy.nodes().length <= 40 && cy.zoom() >= 0.65) ||
                  (fits && (cy.zoom() > 0.55 || occupied.length < 18))))
                ? text
                : "";
            if (node.data("label") !== label) node.data("label", label);
            if (label) occupied.push({ x: p.x, y: p.y, w });
          }),
        );
      });
    };
    refreshLabels.current = updateLabels;
    cy.on("zoom pan position layoutstop select unselect", updateLabels);
    let previousWidth = cy.width(),
      previousHeight = cy.height();
    const observer = new ResizeObserver(() => {
      cy.resize();
      const width = cy.width(),
        height = cy.height();
      if (
        !layoutPending.current &&
        (Math.abs(width - previousWidth) > 2 ||
          Math.abs(height - previousHeight) > 2)
      ) {
        if (!frameNetworkSelection(cy)) cy.fit(undefined, 40);
      }
      previousWidth = width;
      previousHeight = height;
      updateLabels();
    });
    observer.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(frame);
      cancelLayout.current?.();
      layoutPending.current = false;
      observer.disconnect();
      latest.current.onGraphReady?.(null);
      cy.destroy();
      coreRef.current = null;
      topologyRef.current = "";
    };
  }, []);

  useEffect(() => {
    const cy = coreRef.current;
    if (!cy) return;
    const changed = topologyRef.current !== topology;
    if (changed && topologyRef.current && !layoutPending.current) {
      const saved: PositionMap = {};
      cy.nodes().forEach((n) => {
        saved[n.id()] = { ...n.position() };
      });
      positionCache.current.set(topologyRef.current, saved);
      if (positionCache.current.size > 10)
        positionCache.current.delete(
          positionCache.current.keys().next().value!,
        );
    }
    if (changed) {
      cancelLayout.current?.();
      cancelLayout.current = null;
      layoutPending.current = false;
    }
    const edgeMap = new Map(edges.map((edge) => [edge.key, edge]));
    cy.batch(() => {
      const wanted = new Set(elements.map((element) => element.data.id));
      cy.elements()
        .filter((element) => !wanted.has(element.id()))
        .remove();
      elements.forEach((element) => {
        const edge = edgeMap.get(element.data.id!);
        const value = edge ? edgeMetric(edge, metric, methodCount) : null;
        const data = {
          ...element.data,
          ...(edge
            ? {
                metricWidth: metricWidth(value),
                metricUnavailable: value === null ? 1 : 0,
                annotation: edgeAnnotation(edge, methodCount),
              }
            : {}),
        };
        const existing = cy.getElementById(data.id!);
        if (existing.length) existing.data(data);
        else cy.add({ ...element, data });
      });
    });
    if (changed) {
      topologyRef.current = topology;
      setArranging(false);
      // Fit using every full label before zoom-dependent label culling.
      cy.nodes().forEach((node) => {
        node.data("label", node.data("fullLabel"));
      });
      const cached = positionCache.current.get(topology);
      if (cached) {
        cy.nodes().positions((n) => cached[n.id()] ?? { x: 0, y: 0 });
        cy.fit(undefined, 40);
      } else if (nodes.length && layout === "force") {
        layoutPending.current = true;
        setArranging(true);
        const context = document.createElement("canvas").getContext("2d");
        const arrange =
          appearance === "teal" ? createBranchLayout : createAtlasLayout;
        cancelLayout.current = arrange(
          nodes,
          edges,
          { width: cy.width(), height: cy.height() },
          {
            measure: context
              ? (text, bold) => {
                  context.font = `${bold ? 700 : 500} 13px Arial`;
                  return context.measureText(text).width;
                }
              : undefined,
            onComplete: (positions) => {
              if (cy.destroyed() || topologyRef.current !== topology) return;
              layoutPending.current = false;
              cy.batch(() => {
                cy.nodes().positions((node) => positions[node.id()]);
                cy.nodes().forEach((node) => {
                  node.data("label", node.data("fullLabel"));
                });
              });
              if (!frameNetworkSelection(cy)) cy.fit(undefined, 40);
              setArranging(false);
              refreshLabels.current();
            },
          },
        );
      } else if (nodes.length) {
        const config = getLayoutConfig(
          layout,
          { nodeCount: nodes.length, edgeCount: edges.length },
          nodes,
          edges,
          layout === "hierarchical"
            ? buildHierarchicalPositions(nodes, edges)
            : undefined,
          layout === "concentric"
            ? buildConcentricPositions(nodes, edges)
            : undefined,
          layout === "circular"
            ? buildCircularPositions(nodes, edges)
            : undefined,
        );
        cy.layout({
          ...config,
          fit: false,
        } as LayoutOptions).run();
        cy.fit(undefined, 40);
      }
    }
    cy.batch(() => {
      cy.elements()
        .removeClass("context-muted endpoint annotated local-edge")
        .unselect();
      let emphasized = cy.collection();
      if (highlightedMethod) {
        const ids = new Set(
          edges
            .filter((e) => e.supportingAlgorithms.includes(highlightedMethod))
            .map((e) => e.key),
        );
        emphasized = cy.edges().filter((e) => ids.has(e.id()));
        emphasized = emphasized.union(emphasized.connectedNodes());
      }
      if (selectedGene) {
        const node = cy.getElementById(selectedGene);
        node.select();
        const neighborhood = node.closedNeighborhood();
        neighborhood.edges().addClass("local-edge");
        emphasized = highlightedMethod
          ? emphasized.intersection(neighborhood).union(node)
          : neighborhood;
      }
      if (selectedEdgeKey) {
        const edge = cy.getElementById(selectedEdgeKey);
        edge.select().addClass("annotated");
        edge.connectedNodes().addClass("endpoint");
        emphasized = highlightedMethod
          ? emphasized.union(edge).union(edge.connectedNodes())
          : edge.union(edge.connectedNodes());
      }
      if (highlightedMethod || selectedGene || selectedEdgeKey)
        cy.elements().difference(emphasized).addClass("context-muted");
      if (showEdgeLabels)
        cy.edges()
          .filter((e) => !e.hasClass("context-muted"))
          .addClass("annotated");
    });
    refreshLabels.current();
  }, [
    elements,
    topology,
    nodes,
    edges,
    layout,
    appearance,
    metric,
    methodCount,
    highlightedMethod,
    showEdgeLabels,
    selectedGene,
    selectedEdgeKey,
  ]);

  useEffect(() => {
    const cy = coreRef.current;
    if (!cy) return;
    updateGalleryCurves(cy, appearance);
    cy.style(getNetworkGraphStylesheet("light", appearance));
    refreshLabels.current();
    let frame = 0;
    const route = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!cy.destroyed()) updateGalleryCurves(cy, appearance);
      });
    };
    cy.on("position layoutstop", route);
    return () => {
      cancelAnimationFrame(frame);
      cy.off("position layoutstop", route);
    };
  }, [appearance, elements]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const cy = coreRef.current;
      if (cy && !layoutPending.current) frameNetworkSelection(cy);
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedGene, selectedEdgeKey]);

  useEffect(() => {
    const cy = coreRef.current;
    if (cy && focusGene) {
      const node = cy.getElementById(focusGene);
      if (node.length) cy.center(node);
    }
  }, [focusGene]);

  return (
    <div className="grn-canvas-shell">
      <div
        ref={containerRef}
        className="grn-canvas"
        style={{ opacity: arranging ? 0 : 1 }}
        aria-busy={arranging}
        tabIndex={0}
        role="group"
        aria-label="Interactive gene network. Arrow keys select genes; Escape clears selection. Use the relationship list to browse edges."
        onKeyDown={(event) => {
          const cy = coreRef.current;
          if (!cy) return;
          if (event.key === "Escape") {
            props.onSelectGene(null);
            props.onSelectEdge(null);
          }
          if (
            ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(
              event.key,
            )
          ) {
            event.preventDefault();
            const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
            if (!ordered.length) return;
            const current = ordered.findIndex((n) => n.id === selectedGene);
            const step =
              event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
            const next =
              ordered[(current + step + ordered.length) % ordered.length];
            props.onSelectEdge(null);
            props.onSelectGene(next.id);
            cy.center(cy.getElementById(next.id));
          }
        }}
      />
      {arranging && (
        <div className="grn-layout-status" role="status">
          Arranging network…
        </div>
      )}
      {tooltip && (
        <div
          className="grn-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          role="tooltip"
        >
          <strong>{relationshipLabel(tooltip.edge)}</strong>
          <span>
            {signText(tooltip.edge.sign)} ·{" "}
            {nodes.find((n) => n.id === tooltip.edge.source)?.isTF
              ? "TF"
              : "Gene"}{" "}
            /{" "}
            {nodes.find((n) => n.id === tooltip.edge.target)?.isTF
              ? "TF"
              : "Gene"}
          </span>
          <div className="grn-tooltip-metrics">
            <span>
              Confidence{" "}
              <b>
                {percent(edgeMetric(tooltip.edge, "confidence", methodCount))}
              </b>
            </span>
            <span>
              Evidence <b>{evidenceText(tooltip.edge.score)}</b>
            </span>
            <span>
              Methods{" "}
              <b>
                {tooltip.edge.count}/{methodCount}
              </b>
            </span>
          </div>
          <small>Click to inspect the relationship</small>
        </div>
      )}
    </div>
  );
}
