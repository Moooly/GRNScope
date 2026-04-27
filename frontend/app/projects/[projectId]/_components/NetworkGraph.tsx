// REPLACED BY REQUEST
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import coseBilkent from "cytoscape-cose-bilkent";
import {
  buildCircularPositions,
  buildConcentricPositions,
  buildGraphElements,
  buildHierarchicalPositions,
  getLayoutConfig,
} from "./networkGraphLayouts";
import { getNetworkGraphStylesheet } from "./networkGraphStyles";
import type {
  EdgeTooltipState,
  NetworkGraphProps,
  NetworkLayoutMode,
  PositionMap,
} from "./networkGraphTypes";

coseBilkent(cytoscape);

let hasRegisteredCytoscapeSvg = false;

export default function NetworkGraph({
  nodes,
  edges,
  selectedGene,
  selectedEdgeKey,
  layout,
  onSelectGene,
  onSelectEdge,
  onGraphReady,
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const activeLayoutRef = useRef<ReturnType<Core["layout"]> | null>(null);
  const outerRafRef = useRef<number | null>(null);
  const innerRafRef = useRef<number | null>(null);

  const lastAppliedSignatureRef = useRef<string>("");
  const lastLayoutRef = useRef<NetworkLayoutMode>(layout);
  const lastNodePositionsRef = useRef<PositionMap>({});
  const layoutPositionCacheRef = useRef<Record<string, PositionMap>>({});
  const layoutViewportCacheRef = useRef<
    Record<string, { zoom: number; pan: { x: number; y: number } }>
  >({});
  const onSelectGeneRef = useRef(onSelectGene);
  const onSelectEdgeRef = useRef(onSelectEdge);
  const onGraphReadyRef = useRef(onGraphReady);
  const cacheViewportForKey = (cacheKey: string, cy: Core) => {
    layoutViewportCacheRef.current[cacheKey] = {
      zoom: cy.zoom(),
      pan: { ...cy.pan() },
    };
  };

  const fitGraphToVisibleCanvas = (cy: Core, animate = true) => {
    const visibleElements = cy.elements().filter((element) => !element.removed());

    if (visibleElements.empty()) {
      return;
    }

    cy.resize();

    if (animate) {
      cy.stop(true, false);
      cy.animate(
        {
          fit: {
            eles: visibleElements,
            padding: 56,
          },
        },
        {
          duration: 280,
          easing: "ease-out-cubic",
        }
      );
      return;
    }

    cy.fit(visibleElements, 56);
    cy.center(visibleElements);
  };

  const getConnectedNodeGroups = (cy: Core) => {
    const adjacency = new Map<string, Set<string>>();

    cy.nodes().forEach((node) => {
      adjacency.set(node.id(), new Set());
    });

    cy.edges().forEach((edge) => {
      const source = String(edge.data("source") ?? "");
      const target = String(edge.data("target") ?? "");

      if (!adjacency.has(source) || !adjacency.has(target)) {
        return;
      }

      adjacency.get(source)!.add(target);
      adjacency.get(target)!.add(source);
    });

    const visited = new Set<string>();
    const groups: string[][] = [];

    adjacency.forEach((_, startId) => {
      if (visited.has(startId)) {
        return;
      }

      const group: string[] = [];
      const stack = [startId];
      visited.add(startId);

      while (stack.length > 0) {
        const currentId = stack.pop()!;
        group.push(currentId);

        adjacency.get(currentId)?.forEach((nextId) => {
          if (!visited.has(nextId)) {
            visited.add(nextId);
            stack.push(nextId);
          }
        });
      }

      groups.push(group);
    });

    return groups.sort((a, b) => b.length - a.length);
  };

  const packDisconnectedComponents = (cy: Core) => {
    const groups = getConnectedNodeGroups(cy);

    if (groups.length <= 1) {
      return;
    }

    const gap = 38;
    const maxRowWidth = 460;
    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;

    const placements = groups.map((group) => {
      const collection = group.reduce(
        (acc, id) => acc.union(cy.getElementById(id)),
        cy.collection()
      );
      const box = collection.boundingBox();
      const width = Math.max(92, box.w);
      const height = Math.max(92, box.h);

      if (cursorX > 0 && cursorX + width > maxRowWidth) {
        cursorX = 0;
        cursorY += rowHeight + gap;
        rowHeight = 0;
      }

      const placement = {
        group,
        box,
        x: cursorX,
        y: cursorY,
        width,
        height,
      };

      cursorX += width + gap;
      rowHeight = Math.max(rowHeight, height);

      return placement;
    });

    const packedWidth = Math.max(
      ...placements.map((placement) => placement.x + placement.width),
      0
    );
    const packedHeight = Math.max(
      ...placements.map((placement) => placement.y + placement.height),
      0
    );

    placements.forEach((placement) => {
      const targetLeft = placement.x - packedWidth / 2;
      const targetTop = placement.y - packedHeight / 2;
      const dx = targetLeft - placement.box.x1;
      const dy = targetTop - placement.box.y1;

      placement.group.forEach((id) => {
        const node = cy.getElementById(id);
        const current = node.position();
        node.position({
          x: current.x + dx,
          y: current.y + dy,
        });
      });
    });
  };

  const [edgeTooltip, setEdgeTooltip] = useState<EdgeTooltipState | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);

  const { elements, elementsSignature } = useMemo(
    () => buildGraphElements(nodes, edges),
    [nodes, edges]
  );

  const layoutCacheSignature = useMemo(() => {
    const nodePart = nodes
      .map((node) => node.id)
      .sort()
      .join("|");

    const edgePart = edges
      .map((edge) => {
        if (
          "id" in edge &&
          typeof edge.id === "string" &&
          edge.id.length > 0
        ) {
          return edge.id;
        }

        return `${edge.source}->${edge.target}`;
      })
      .sort()
      .join("|");

    return `${nodePart}__${edgePart}`;
  }, [nodes, edges]);

  const graphCounts = useMemo(
    () => ({
      nodeCount: nodes.length,
      edgeCount: edges.length,
    }),
    [nodes.length, edges.length]
  );

  const hierarchicalPositions = useMemo(
    () => buildHierarchicalPositions(nodes, edges),
    [nodes, edges]
  );

  const concentricPositions = useMemo(
    () => buildConcentricPositions(nodes, edges),
    [nodes, edges]
  );

  const circularPositions = useMemo(
    () => buildCircularPositions(nodes, edges),
    [nodes, edges]
  );

  const getLayoutCacheKey = (layoutMode: NetworkLayoutMode, signature: string) =>
    `${layoutMode}::${signature}`;

  const getLayoutOptions = (
    layoutMode: NetworkLayoutMode,
    signature: string,
    allowRandomizeOnFirstForceRun = false,
    forceFreshLayout = false
  ) => {
    const baseConfig = getLayoutConfig(
      layoutMode,
      graphCounts,
      hierarchicalPositions,
      concentricPositions,
      circularPositions
    ) as Record<string, unknown>;

    if (layoutMode !== "force") {
      return baseConfig;
    }

    const hasCachedForcePositions = Boolean(
      layoutPositionCacheRef.current[getLayoutCacheKey(layoutMode, signature)]
    );

    return {
      ...baseConfig,
      randomize:
        forceFreshLayout ||
        (allowRandomizeOnFirstForceRun && !hasCachedForcePositions),
    };
  };

  useEffect(() => {
    onSelectGeneRef.current = onSelectGene;
    onSelectEdgeRef.current = onSelectEdge;
    onGraphReadyRef.current = onGraphReady;
  }, [onGraphReady, onSelectEdge, onSelectGene]);

  useEffect(() => {
    if (!containerRef.current || cyRef.current) {
      return;
    }

    let isCancelled = false;
    let cy: Core | null = null;

    const initializeGraph = async () => {
      if (!hasRegisteredCytoscapeSvg) {
        // @ts-expect-error local declaration is provided in frontend/types/cytoscape-svg.d.ts
        const cytoscapeSvgModule = (await import("cytoscape-svg")) as {
          default: (cytoscapeInstance: typeof cytoscape) => void;
        };
        const cytoscapeSvg = cytoscapeSvgModule.default;
        cytoscapeSvg(cytoscape);
        hasRegisteredCytoscapeSvg = true;
      }

      if (isCancelled || !containerRef.current || cyRef.current) {
        return;
      }

      const graph = cytoscape({
        container: containerRef.current,
        elements,
        style: getNetworkGraphStylesheet() as any,
        wheelSensitivity: 0.14,
        minZoom: 0.3,
        maxZoom: 2.4,
        boxSelectionEnabled: false,
        autoungrabify: false,
        userZoomingEnabled: true,
        userPanningEnabled: true,
        textureOnViewport: true,
      });
      cy = graph;

      graph.on("tap", "node", (event) => {
        const nodeId = event.target.id();
        onSelectGeneRef.current(nodeId);
      });
      graph.on("tap", "edge", (event) => {
        const edgeId = event.target.id();
        onSelectEdgeRef.current(edgeId);
      });

      graph.on("mouseover", "edge", (event) => {
        const renderedPosition = event.renderedPosition || { x: 0, y: 0 };
        const edgeId = event.target.id();

        graph.edges().removeClass("hovered");
        event.target.addClass("hovered");
        setHoveredEdgeKey(edgeId);

        setEdgeTooltip({
          x: renderedPosition.x,
          y: renderedPosition.y,
          source: String(event.target.data("source") ?? ""),
          target: String(event.target.data("target") ?? ""),
          score: Number(event.target.data("score") ?? 0),
          rank: Number(event.target.data("rank") ?? 0),
          supportingAlgorithms: Array.isArray(event.target.data("supportingAlgorithms"))
            ? (event.target.data("supportingAlgorithms") as string[])
            : [],
        });
      });

      graph.on("mousemove", "edge", (event) => {
        const renderedPosition = event.renderedPosition || { x: 0, y: 0 };
        setEdgeTooltip((current) =>
          current
            ? {
                ...current,
                x: renderedPosition.x,
                y: renderedPosition.y,
              }
            : current
        );
      });

      graph.on("mouseout", "edge", (event) => {
        event.target.removeClass("hovered");
        setHoveredEdgeKey((current) =>
          current === event.target.id() ? null : current
        );
        setEdgeTooltip(null);
      });

      graph.on("tap", (event) => {
        if (event.target === graph) {
          onSelectGeneRef.current(null);
          onSelectEdgeRef.current(null);
          graph.edges().removeClass("hovered");
          setHoveredEdgeKey(null);
          setEdgeTooltip(null);
        }
      });

      cyRef.current = graph;
      onGraphReadyRef.current?.(graph);
      lastAppliedSignatureRef.current = elementsSignature;
      lastLayoutRef.current = layout;

      outerRafRef.current = window.requestAnimationFrame(() => {
        innerRafRef.current = window.requestAnimationFrame(() => {
          if (!cyRef.current || cyRef.current !== graph || graph.destroyed()) {
            return;
          }

          graph.resize();

          const initialLayout = graph.layout({
            ...getLayoutOptions(layout, layoutCacheSignature, true),
            fit: true,
            padding: 56,
          } as any);

          activeLayoutRef.current = initialLayout;

          initialLayout.on("layoutstop", () => {
            if (
              activeLayoutRef.current !== initialLayout ||
              !cyRef.current ||
              graph.destroyed()
            ) {
              return;
            }

            activeLayoutRef.current = null;
            packDisconnectedComponents(graph);
            fitGraphToVisibleCanvas(graph, false);

            const initialPositions: PositionMap = {};
            graph.nodes().forEach((node) => {
              initialPositions[node.id()] = { ...node.position() };
            });

            lastNodePositionsRef.current = {
              ...lastNodePositionsRef.current,
              ...initialPositions,
            };

            const initialCacheKey = getLayoutCacheKey(layout, layoutCacheSignature);
            layoutPositionCacheRef.current[initialCacheKey] = initialPositions;
            cacheViewportForKey(initialCacheKey, graph);
          });

          if (!graph.destroyed()) {
            initialLayout.run();
          }
        });
      });
    };

    void initializeGraph();

    return () => {
      isCancelled = true;
      setHoveredEdgeKey(null);
      setEdgeTooltip(null);

      if (outerRafRef.current !== null) {
        window.cancelAnimationFrame(outerRafRef.current);
        outerRafRef.current = null;
      }

      if (innerRafRef.current !== null) {
        window.cancelAnimationFrame(innerRafRef.current);
        innerRafRef.current = null;
      }

      activeLayoutRef.current?.stop();
      activeLayoutRef.current = null;
      onGraphReadyRef.current?.(null);
      cy?.destroy();
      cyRef.current = null;
    };
  }, []);

  // Keep the Cytoscape canvas in sync with the container size. Without this,
  // resizing the window or toggling the inspector panel leaves the canvas at
  // its old internal size, so panning/zooming feels off.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    let pendingFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (pendingFrame !== null) return;
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = null;
        const cy = cyRef.current;
        if (!cy || cy.destroyed()) return;
        cy.resize();
      });
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
      if (pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame);
      }
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const signatureChanged = lastAppliedSignatureRef.current !== elementsSignature;
    const layoutChanged = lastLayoutRef.current !== layout;

    if (!signatureChanged && !layoutChanged) {
      return;
    }

    const existingViewport = {
      zoom: cy.zoom(),
      pan: { ...cy.pan() },
    };

    activeLayoutRef.current?.stop();
    activeLayoutRef.current = null;

    const previousPositions: PositionMap = {};
    cy.nodes().forEach((node) => {
      previousPositions[node.id()] = { ...node.position() };
    });

    const preservedPositions = {
      ...lastNodePositionsRef.current,
      ...previousPositions,
    };

    const layoutCacheKey = getLayoutCacheKey(layout, layoutCacheSignature);
    const cachedPositionsForLayout =
      layoutPositionCacheRef.current[layoutCacheKey];
    const cachedViewportForLayout =
      layoutViewportCacheRef.current[layoutCacheKey];

    const cachedPositionsForSignature = signatureChanged
      ? preservedPositions
      : cachedPositionsForLayout ?? preservedPositions;

    const nextNodeIds = nodes.map((node) => node.id);
    const hasCompleteSavedPositions =
      nextNodeIds.length > 0 &&
      nextNodeIds.every((id) => Boolean(cachedPositionsForSignature[id]));

    const canRestoreExactLayout =
      !signatureChanged && hasCompleteSavedPositions && Boolean(cachedPositionsForLayout);

    const elementsWithPositions = elements.map((element) => {
      const elementId = typeof element.data?.id === "string" ? element.data.id : undefined;

      if (!elementId || (element.data && "source" in element.data && "target" in element.data)) {
        return element;
      }

      const saved = cachedPositionsForSignature[elementId];
      if (!saved) {
        return element;
      }

      return {
        ...element,
        position: saved,
      };
    });

    cy.startBatch();
    cy.elements().remove();
    cy.add(elementsWithPositions);
    cy.style(getNetworkGraphStylesheet() as any);
    cy.resize();

    if ((layoutChanged && !canRestoreExactLayout) || !hasCompleteSavedPositions) {
      // For force layouts: keep existing node positions whenever possible. We
      // pre-place any *new* nodes (not in the cache) near the centroid of the
      // saved positions so cose-bilkent has something better than (0,0) to
      // work with. Then run with randomize=false so previously-laid-out nodes
      // only drift slightly.
      if (layout === "force") {
        const cachedPositions = cachedPositionsForSignature;
        const cachedKeys = Object.keys(cachedPositions);
        if (cachedKeys.length > 0) {
          let cx = 0;
          let cy2 = 0;
          for (const key of cachedKeys) {
            cx += cachedPositions[key].x;
            cy2 += cachedPositions[key].y;
          }
          cx /= cachedKeys.length;
          cy2 /= cachedKeys.length;

          cy.nodes().forEach((node) => {
            const id = node.id();
            if (!cachedPositions[id]) {
              // Spread new nodes in a small ring around the centroid so they
              // don't all overlap each other before the layout runs.
              const seed = id
                .split("")
                .reduce((acc, ch) => (acc * 33 + ch.charCodeAt(0)) >>> 0, 17);
              const angle = (seed % 360) * (Math.PI / 180);
              const radius = 60;
              node.position({
                x: cx + Math.cos(angle) * radius,
                y: cy2 + Math.sin(angle) * radius,
              });
            }
          });
        }
      }

      cy.endBatch();

      // Only randomize when we have no positions at all to fall back on.
      const hasAnyPriorPositions =
        Object.keys(lastNodePositionsRef.current).length > 0;

      if (layoutChanged && layout === "force") {
        delete layoutPositionCacheRef.current[layoutCacheKey];
        delete layoutViewportCacheRef.current[layoutCacheKey];
      }

      const rerunLayout = cy.layout(
        getLayoutOptions(
          layout,
          layoutCacheSignature,
          !hasAnyPriorPositions,
          layoutChanged && layout === "force"
        ) as any
      );

      activeLayoutRef.current = rerunLayout;

      rerunLayout.on("layoutstop", () => {
        if (activeLayoutRef.current !== rerunLayout || !cyRef.current) {
          return;
        }

        activeLayoutRef.current = null;
        packDisconnectedComponents(cy);

        if (signatureChanged) {
          window.requestAnimationFrame(() => fitGraphToVisibleCanvas(cy, true));
        } else if (layoutChanged && cachedViewportForLayout) {
          cy.zoom(cachedViewportForLayout.zoom);
          cy.pan(cachedViewportForLayout.pan);
        } else {
          cy.zoom(existingViewport.zoom);
          cy.pan(existingViewport.pan);
        }

        const nextPositions: PositionMap = {};
        cy.nodes().forEach((node) => {
          nextPositions[node.id()] = { ...node.position() };
        });

        lastNodePositionsRef.current = {
          ...lastNodePositionsRef.current,
          ...nextPositions,
        };

        layoutPositionCacheRef.current[layoutCacheKey] = nextPositions;
        cacheViewportForKey(layoutCacheKey, cy);
        lastAppliedSignatureRef.current = elementsSignature;
        lastLayoutRef.current = layout;
      });

      rerunLayout.run();
      return;
    }

    cy.nodes().forEach((node) => {
      const saved = cachedPositionsForSignature[node.id()];
      if (saved) {
        node.position(saved);
        node.lock();
      }
    });

    cy.endBatch();

    if (signatureChanged) {
      window.requestAnimationFrame(() => fitGraphToVisibleCanvas(cy, true));
    } else if (layoutChanged && cachedViewportForLayout) {
      cy.zoom(cachedViewportForLayout.zoom);
      cy.pan(cachedViewportForLayout.pan);
    } else {
      cy.zoom(existingViewport.zoom);
      cy.pan(existingViewport.pan);
    }

    cy.nodes().forEach((node) => {
      node.unlock();
    });

    const nextPositions: PositionMap = {};
    cy.nodes().forEach((node) => {
      nextPositions[node.id()] = { ...node.position() };
    });

    lastNodePositionsRef.current = {
      ...lastNodePositionsRef.current,
      ...nextPositions,
    };

    layoutPositionCacheRef.current[layoutCacheKey] = nextPositions;
    cacheViewportForKey(layoutCacheKey, cy);
    lastAppliedSignatureRef.current = elementsSignature;
    lastLayoutRef.current = layout;
  }, [
    circularPositions,
    concentricPositions,
    elements,
    elementsSignature,
    graphCounts,
    hierarchicalPositions,
    layout,
    layoutCacheSignature,
    nodes,
  ]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.elements().unselect();

    if (selectedGene) {
      const node = cy.getElementById(selectedGene);
      if (node.nonempty()) {
        node.select();
      }
    }

    if (selectedEdgeKey) {
      const edge = cy.getElementById(selectedEdgeKey);
      if (edge.nonempty()) {
        edge.select();
      }
    }
  }, [selectedGene, selectedEdgeKey]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.edges().removeClass("hovered");

    if (hoveredEdgeKey && hoveredEdgeKey !== selectedEdgeKey) {
      const edge = cy.getElementById(hoveredEdgeKey);
      if (edge.nonempty()) {
        edge.addClass("hovered");
      }
    }
  }, [hoveredEdgeKey, selectedEdgeKey]);

  const containerWidth = containerRef.current?.clientWidth ?? 0;
  const containerHeight = containerRef.current?.clientHeight ?? 0;
  const tooltipWidth = 300;
  const tooltipHeight = 170;
  const tooltipPadding = 16;

  const tooltipLeft = edgeTooltip
    ? Math.min(
        Math.max(edgeTooltip.x + 8, tooltipPadding),
        Math.max(tooltipPadding, containerWidth - tooltipWidth - tooltipPadding)
      )
    : tooltipPadding;

  const tooltipTop = edgeTooltip
    ? Math.min(
        Math.max(edgeTooltip.y - 4, tooltipPadding),
        Math.max(tooltipPadding, containerHeight - tooltipHeight - tooltipPadding)
      )
    : tooltipPadding;

  return (
    <div className="relative h-[680px] w-full overflow-hidden rounded-[1.75rem] border border-slate-200/70 bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.14),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(96,165,250,0.12),_transparent_22%),radial-gradient(circle_at_bottom_right,_rgba(15,23,42,0.08),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#eef4fb_52%,_#eaf1f8_100%)] shadow-[0_24px_60px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.86)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:34px_34px] opacity-45" />
      <div className="pointer-events-none absolute left-8 top-8 h-36 w-36 rounded-full bg-teal-300/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-10 right-10 h-40 w-40 rounded-full bg-blue-300/18 blur-3xl" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-white/50 to-transparent" />
      <div className="pointer-events-none absolute inset-0 rounded-[1.75rem] ring-1 ring-white/55" />

      <div
        ref={containerRef}
        className="absolute inset-0 z-10 h-full w-full"
        style={{ filter: "saturate(0.94) contrast(0.98)" }}
      />

      {edgeTooltip && (
        <div
          className="pointer-events-none absolute z-30 max-w-[300px] rounded-2xl border border-white/70 bg-white/88 px-4 py-3 text-xs text-slate-700 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur-xl"
          style={{
            left: tooltipLeft,
            top: tooltipTop,
          }}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-900">
                {edgeTooltip.source} → {edgeTooltip.target}
              </p>
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-700">
                Edge
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-2.5 py-2">
                <p className="text-slate-500">Score</p>
                <p className="mt-1 font-semibold text-slate-900">
                  {edgeTooltip.score.toFixed(3)}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-2.5 py-2">
                <p className="text-slate-500">Rank</p>
                <p className="mt-1 font-semibold text-slate-900">
                  {edgeTooltip.rank}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-2.5 py-2 text-[11px]">
              <p className="text-slate-500">Supporting algorithms</p>
              <p className="mt-1 font-medium leading-5 text-slate-900">
                {edgeTooltip.supportingAlgorithms.length > 0
                  ? edgeTooltip.supportingAlgorithms.join(", ")
                  : "-"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}