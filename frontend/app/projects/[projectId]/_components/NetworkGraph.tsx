"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, {
  type Core,
  type ElementDefinition,
  type Layouts,
} from "cytoscape";
import coseBilkent from "cytoscape-cose-bilkent";

cytoscape.use(coseBilkent);

type NetworkNode = {
  id: string;
  inDegree: number;
  outDegree: number;
  degree: number;
  isTF: boolean;
};

type NetworkEdge = {
  key: string;
  source: string;
  target: string;
  score: number;
  count: number;
  rank: number;
  supportingAlgorithms: string[];
};

type NetworkGraphProps = {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  selectedGene: string | null;
  selectedEdgeKey: string | null;
  layout: "force" | "hierarchical" | "concentric" | "circular";
  onSelectGene: (geneId: string | null) => void;
  onSelectEdge: (edgeKey: string | null) => void;
};

type EdgeTooltipState = {
  x: number;
  y: number;
  source: string;
  target: string;
  score: number;
  rank: number;
  supportingAlgorithms: string[];
};

function getLayoutConfig(
  layout: NetworkGraphProps["layout"],
  nodeCount: number,
  edgeCount: number
) {
  if (layout === "hierarchical") {
    return {
      name: "breadthfirst",
      directed: true,
      spacingFactor: 1.32,
      animate: false,
      padding: 64,
      circle: false,
      grid: false,
    } as const;
  }

  if (layout === "concentric") {
    return {
      name: "concentric",
      animate: false,
      minNodeSpacing: 42,
      padding: 60,
      concentric: (node: cytoscape.NodeSingular) => node.data("degree") || 1,
      levelWidth: () => 2,
      startAngle: (-Math.PI * 3) / 4,
      sweep: undefined,
      clockwise: true,
    } as const;
  }

  if (layout === "circular") {
    return {
      name: "circle",
      animate: false,
      padding: 60,
      spacingFactor: 1.18,
      startAngle: (-Math.PI * 3) / 4,
      clockwise: true,
    } as const;
  }

  const densityFactor = Math.max(1, Math.min(2.2, edgeCount / Math.max(nodeCount, 1) / 2));

  return {
    name: "cose-bilkent",
    animate: false,
    fit: true,
    padding: 74,
    nodeRepulsion: 26000 * densityFactor,
    idealEdgeLength: 185 * densityFactor,
    edgeElasticity: 0.06,
    nestingFactor: 1,
    gravity: 0.14,
    gravityRangeCompound: 1.25,
    numIter: 2600,
    tile: true,
  } as const;
}

function getStylesheet() {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        color: "#f8fafc",
        "font-size": 11,
        "font-weight": 700,
        "text-wrap": "none",
        "text-max-width": 96,
        "text-valign": "center",
        "text-halign": "center",
        "text-outline-width": 3,
        "text-outline-color": "#0f172a",
        "min-zoomed-font-size": 9,
        width: "mapData(degree, 1, 20, 24, 78)",
        height: "mapData(degree, 1, 20, 24, 78)",
        "overlay-opacity": 0,
        "border-width": 2,
        "border-opacity": 0.95,
        "background-opacity": 0.97,
        "shadow-blur": 18,
        "shadow-opacity": 0.2,
        "shadow-offset-x": 0,
        "shadow-offset-y": 8,
        "shadow-color": "#0f172a",
        "text-margin-y": 0,
      },
    },
    {
      selector: 'node[isTF = 1]',
      style: {
        shape: "diamond",
        "background-color": "#14b8a6",
        "border-width": 3,
        "border-color": "#0f766e",
      },
    },
    {
      selector: 'node[isTF = 0]',
      style: {
        shape: "ellipse",
        "background-color": "#64748b",
        "border-width": 3,
        "border-color": "#334155",
      },
    },
    {
      selector: 'node[degree >= 8]',
      style: {
        "font-size": 12,
      },
    },
    {
      selector: 'node[degree < 3]',
      style: {
        "font-size": 9,
      },
    },
    {
      selector: "edge",
      style: {
        width: "mapData(score, 0, 1, 0.9, 3.8)",
        "line-color": "#9fb1c5",
        opacity: 0.28,
        "curve-style": "bezier",
        "source-endpoint": "outside-to-node",
        "target-endpoint": "outside-to-node",
        "line-cap": "round",
        "target-arrow-shape": "triangle",
        "target-arrow-color": "#9fb1c5",
        "arrow-scale": 0.72,
        "overlay-opacity": 0,
        "z-index": 1,
      },
    },
    {
      selector: 'edge[supportRatio >= 0.25]',
      style: {
        "line-color": "#94a3b8",
        "target-arrow-color": "#94a3b8",
        opacity: 0.34,
      },
    },
    {
      selector: 'edge[supportRatio >= 0.5]',
      style: {
        "line-color": "#5eead4",
        "target-arrow-color": "#5eead4",
        opacity: 0.46,
      },
    },
    {
      selector: 'edge[supportRatio >= 0.75]',
      style: {
        "line-color": "#2dd4bf",
        "target-arrow-color": "#2dd4bf",
        opacity: 0.58,
      },
    },
    {
      selector: 'edge[supportRatio >= 0.99]',
      style: {
        "line-color": "#0f766e",
        "target-arrow-color": "#0f766e",
        opacity: 0.72,
      },
    },
    {
      selector: "node:selected",
      style: {
        "border-width": 5,
        "border-color": "#2563eb",
        "shadow-blur": 28,
        "shadow-opacity": 0.32,
        "shadow-color": "#60a5fa",
      },
    },
    {
      selector: "edge:selected",
      style: {
        width: 5.8,
        "line-color": "#2563eb",
        "target-arrow-color": "#2563eb",
        opacity: 1,
        "z-index": 12,
        "underlay-color": "rgba(37, 99, 235, 0.18)",
        "underlay-padding": 4,
        "underlay-opacity": 1,
      },
    },
    {
      selector: "edge.hovered",
      style: {
        width: 6.6,
        "line-color": "#14b8a6",
        "target-arrow-color": "#14b8a6",
        opacity: 0.96,
        "z-index": 11,
        "underlay-color": "rgba(20, 184, 166, 0.2)",
        "underlay-padding": 4,
        "underlay-opacity": 1,
      },
    },
  ];
}

export default function NetworkGraph({
  nodes,
  edges,
  selectedGene,
  selectedEdgeKey,
  layout,
  onSelectGene,
  onSelectEdge,
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const activeLayoutRef = useRef<Layouts | null>(null);
  const outerRafRef = useRef<number | null>(null);
  const innerRafRef = useRef<number | null>(null);
  const lastAppliedSignatureRef = useRef<string>("");
  const lastLayoutRef = useRef<NetworkGraphProps["layout"]>(layout);
  const lastNodePositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const positionCacheRef = useRef<Record<string, Record<string, { x: number; y: number }>>>({});
  const [edgeTooltip, setEdgeTooltip] = useState<EdgeTooltipState | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);

  const elements = useMemo<ElementDefinition[]>(() => {
    const maxSupportCount = Math.max(...edges.map((edge) => edge.count), 1);

    const cyNodes: ElementDefinition[] = nodes.map((node) => ({
      data: {
        id: node.id,
        label: node.id.length > 10 ? `${node.id.slice(0, 9)}…` : node.id,
        degree: node.degree,
        inDegree: node.inDegree,
        outDegree: node.outDegree,
        isTF: node.isTF ? 1 : 0,
      },
    }));

    const cyEdges: ElementDefinition[] = edges.map((edge) => ({
      data: {
        id: edge.key,
        source: edge.source,
        target: edge.target,
        score: edge.score,
        count: edge.count,
        rank: edge.rank,
        supportRatio: maxSupportCount <= 1 ? 1 : edge.count / maxSupportCount,
        supportingAlgorithms: edge.supportingAlgorithms,
      },
    }));

    return [...cyNodes, ...cyEdges];
  }, [nodes, edges]);

  const elementsSignature = useMemo(
    () =>
      JSON.stringify({
        nodes: nodes.map((node) => ({
          id: node.id,
          inDegree: node.inDegree,
          outDegree: node.outDegree,
          degree: node.degree,
          isTF: node.isTF,
        })),
        edges: edges.map((edge) => ({
          key: edge.key,
          source: edge.source,
          target: edge.target,
          score: edge.score,
          count: edge.count,
          rank: edge.rank,
        })),
      }),
    [nodes, edges]
  );

  const graphCounts = useMemo(
    () => ({
      nodeCount: nodes.length,
      edgeCount: edges.length,
    }),
    [nodes.length, edges.length]
  );

  useEffect(() => {
    if (!containerRef.current || cyRef.current) {
      return;
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: getStylesheet() as any,
      wheelSensitivity: 0.14,
      minZoom: 0.3,
      maxZoom: 2.4,
      boxSelectionEnabled: false,
      autoungrabify: false,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      textureOnViewport: true,
    });

    cy.on("tap", "node", (event) => {
      const nodeId = event.target.id();
      onSelectGene(nodeId);
      onSelectEdge(null);
    });

    cy.on("tap", "edge", (event) => {
      const edgeId = event.target.id();
      const sourceId = event.target.data("source") as string | undefined;
      onSelectEdge(edgeId);
      onSelectGene(sourceId ?? null);
    });

    cy.on("mouseover", "edge", (event) => {
      const renderedPosition = event.renderedPosition || { x: 0, y: 0 };
      const edgeId = event.target.id();

      cy.edges().removeClass("hovered");
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

    cy.on("mousemove", "edge", (event) => {
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

    cy.on("mouseout", "edge", (event) => {
      event.target.removeClass("hovered");
      setHoveredEdgeKey((current) => (current === event.target.id() ? null : current));
      setEdgeTooltip(null);
    });

    cy.on("tap", (event) => {
      if (event.target === cy) {
        onSelectGene(null);
        onSelectEdge(null);
        cy.edges().removeClass("hovered");
        setHoveredEdgeKey(null);
        setEdgeTooltip(null);
      }
    });

    cyRef.current = cy;
    lastAppliedSignatureRef.current = elementsSignature;
    lastLayoutRef.current = layout;

    outerRafRef.current = window.requestAnimationFrame(() => {
      innerRafRef.current = window.requestAnimationFrame(() => {
        if (!cyRef.current || cyRef.current !== cy || cy.destroyed()) {
          return;
        }

        cy.resize();

        const initialLayout = cy.layout({
          ...getLayoutConfig(layout, graphCounts.nodeCount, graphCounts.edgeCount),
          fit: false,
        } as any);
        activeLayoutRef.current = initialLayout;

        initialLayout.on("layoutstop", () => {
          if (activeLayoutRef.current !== initialLayout || !cyRef.current || cy.destroyed()) {
            return;
          }

          activeLayoutRef.current = null;
          cy.resize();
          cy.fit(cy.elements(), 40);

          const initialPositions: Record<string, { x: number; y: number }> = {};
          cy.nodes().forEach((node) => {
            initialPositions[node.id()] = { ...node.position() };
          });

          lastNodePositionsRef.current = {
            ...lastNodePositionsRef.current,
            ...initialPositions,
          };
          positionCacheRef.current[elementsSignature] = initialPositions;
        });

        if (!cy.destroyed()) {
          initialLayout.run();
        }
      });
    });

    return () => {
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
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }

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

    const previousPositions: Record<string, { x: number; y: number }> = {};
    cy.nodes().forEach((node) => {
      previousPositions[node.id()] = { ...node.position() };
    });

    const preservedPositions = {
      ...lastNodePositionsRef.current,
      ...previousPositions,
    };

    const cachedPositionsForSignature =
      positionCacheRef.current[elementsSignature] ?? preservedPositions;

    const nextNodeIds = nodes.map((node) => node.id);
    const hasCompleteSavedPositions =
      nextNodeIds.length > 0 && nextNodeIds.every((id) => Boolean(cachedPositionsForSignature[id]));

    const elementsWithPositions = elements.map((element) => {
      const elementId = typeof element.data?.id === "string" ? element.data.id : undefined;
      if (!elementId || element.group === "edges") {
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
    cy.style(getStylesheet() as any);
    cy.resize();

    if (layoutChanged || !hasCompleteSavedPositions) {
      cy.endBatch();
      const rerunLayout = cy.layout(
        getLayoutConfig(layout, graphCounts.nodeCount, graphCounts.edgeCount) as any
      );
      activeLayoutRef.current = rerunLayout;
      rerunLayout.on("layoutstop", () => {
        if (activeLayoutRef.current !== rerunLayout || !cyRef.current) {
          return;
        }

        activeLayoutRef.current = null;
        cy.zoom(existingViewport.zoom);
        cy.pan(existingViewport.pan);

        const nextPositions: Record<string, { x: number; y: number }> = {};
        cy.nodes().forEach((node) => {
          nextPositions[node.id()] = { ...node.position() };
        });

        lastNodePositionsRef.current = {
          ...lastNodePositionsRef.current,
          ...nextPositions,
        };
        positionCacheRef.current[elementsSignature] = nextPositions;
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

    cy.zoom(existingViewport.zoom);
    cy.pan(existingViewport.pan);
    cy.endBatch();

    cy.nodes().forEach((node) => {
      node.unlock();
    });

    const nextPositions: Record<string, { x: number; y: number }> = {};
    cy.nodes().forEach((node) => {
      nextPositions[node.id()] = { ...node.position() };
    });

    lastNodePositionsRef.current = {
      ...lastNodePositionsRef.current,
      ...nextPositions,
    };
    positionCacheRef.current[elementsSignature] = nextPositions;
    lastAppliedSignatureRef.current = elementsSignature;
    lastLayoutRef.current = layout;
  }, [elements, elementsSignature, layout]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }

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
    if (!cy) {
      return;
    }

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
      <div className="pointer-events-none absolute left-5 top-5 z-20 flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.18em] text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur-md">
        NETWORK VIEW
      </div>
      <div className="pointer-events-none absolute right-5 top-5 z-20 rounded-full border border-slate-200/80 bg-white/78 px-3.5 py-1.5 text-[11px] font-medium text-slate-500 shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur-md">
        Scroll to zoom · Drag to pan · Click to inspect
      </div>
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
                <p className="mt-1 font-semibold text-slate-900">{edgeTooltip.score.toFixed(3)}</p>
              </div>
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-2.5 py-2">
                <p className="text-slate-500">Rank</p>
                <p className="mt-1 font-semibold text-slate-900">{edgeTooltip.rank}</p>
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