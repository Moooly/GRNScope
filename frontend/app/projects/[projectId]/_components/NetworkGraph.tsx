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
      spacingFactor: 1.18,
      animate: false,
      padding: 52,
    } as const;
  }

  if (layout === "concentric") {
    return {
      name: "concentric",
      animate: false,
      minNodeSpacing: 34,
      padding: 52,
      concentric: (node: cytoscape.NodeSingular) => node.data("degree") || 1,
      levelWidth: () => 2,
    } as const;
  }

  if (layout === "circular") {
    return {
      name: "circle",
      animate: false,
      padding: 52,
      spacingFactor: 1.12,
    } as const;
  }

  const densityFactor = Math.max(1, Math.min(2.2, edgeCount / Math.max(nodeCount, 1) / 2));

  return {
    name: "cose-bilkent",
    animate: false,
    fit: true,
    padding: 60,
    nodeRepulsion: 18000 * densityFactor,
    idealEdgeLength: 150 * densityFactor,
    edgeElasticity: 0.06,
    nestingFactor: 0.9,
    gravity: 0.18,
    numIter: 1800,
    tile: true,
  } as const;
}

function getStylesheet() {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        color: "#ffffff",
        "font-size": 11,
        "font-weight": 700,
        "text-wrap": "none",
        "text-max-width": 96,
        "text-valign": "center",
        "text-halign": "center",
        "text-outline-width": 2,
        "text-outline-color": "#0f172a",
        "min-zoomed-font-size": 9,
        width: "mapData(degree, 1, 20, 22, 76)",
        height: "mapData(degree, 1, 20, 22, 76)",
        "overlay-opacity": 0,
      },
    },
    {
      selector: 'node[isTF = 1]',
      style: {
        shape: "diamond",
        "background-color": "#14b8a6",
        "border-width": 2.5,
        "border-color": "#0f766e",
      },
    },
    {
      selector: 'node[isTF = 0]',
      style: {
        shape: "ellipse",
        "background-color": "#64748b",
        "border-width": 2.5,
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
        width: "mapData(score, 0, 1, 1, 4.6)",
        "line-color": "#cbd5e1",
        opacity: 0.34,
        "curve-style": "straight",
        "source-endpoint": "outside-to-node",
        "target-endpoint": "outside-to-node",
        "line-cap": "round",
        "target-arrow-shape": "none",
        "overlay-opacity": 0,
      },
    },
    {
      selector: 'edge[supportRatio >= 0.25]',
      style: {
        "line-color": "#94a3b8",
        opacity: 0.42,
      },
    },
    {
      selector: 'edge[supportRatio >= 0.5]',
      style: {
        "line-color": "#5eead4",
        opacity: 0.52,
      },
    },
    {
      selector: 'edge[supportRatio >= 0.75]',
      style: {
        "line-color": "#2dd4bf",
        opacity: 0.66,
      },
    },
    {
      selector: 'edge[supportRatio >= 0.99]',
      style: {
        "line-color": "#0f766e",
        opacity: 0.8,
      },
    },
    {
      selector: "node:selected",
      style: {
        "border-width": 4,
        "border-color": "#2563eb",
      },
    },
    {
      selector: "edge:selected",
      style: {
        width: 6,
        "line-color": "#2563eb",
        opacity: 1,
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

    cy.on("mouseout", "edge", () => {
      setEdgeTooltip(null);
    });

    cy.on("tap", (event) => {
      if (event.target === cy) {
        onSelectGene(null);
        onSelectEdge(null);
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

  return (
    <div className="relative h-[680px] w-full overflow-hidden rounded-[1.5rem] border border-slate-300/70 bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.16),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.12),_transparent_30%),linear-gradient(180deg,_#f8fafc_0%,_#eef2f7_100%)] shadow-[0_20px_45px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.75)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:32px_32px] opacity-50" />
      <div className="pointer-events-none absolute left-6 top-6 h-28 w-28 rounded-full bg-teal-300/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-8 right-8 h-36 w-36 rounded-full bg-blue-300/15 blur-3xl" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-white/35 to-transparent" />
      <div className="pointer-events-none absolute inset-0 rounded-[1.5rem] ring-1 ring-white/40" />
      <div className="pointer-events-none absolute left-5 top-5 z-20 flex items-center gap-2 rounded-full border border-white/60 bg-white/75 px-3 py-1.5 text-[11px] font-semibold tracking-[0.16em] text-slate-600 shadow-sm backdrop-blur-md">
        NETWORK CANVAS
      </div>
      <div className="pointer-events-none absolute right-5 top-5 z-20 rounded-full border border-slate-300/70 bg-white/70 px-3 py-1.5 text-[11px] font-medium text-slate-500 shadow-sm backdrop-blur-md">
        Scroll to zoom · Drag to pan
      </div>
      <div
        ref={containerRef}
        className="absolute inset-0 z-10 h-full w-full"
      />
      {edgeTooltip && (
        <div
          className="pointer-events-none absolute z-30 max-w-[280px] rounded-2xl border border-slate-300/80 bg-white/92 px-4 py-3 text-xs text-slate-700 shadow-xl backdrop-blur-md"
          style={{
            left: Math.min(edgeTooltip.x + 18, 760),
            top: Math.max(edgeTooltip.y - 12, 16),
          }}
        >
          <div className="space-y-1.5">
            <p className="font-semibold text-slate-900">
              {edgeTooltip.source} → {edgeTooltip.target}
            </p>
            <p>
              <span className="font-medium text-slate-900">Score:</span>{" "}
              {edgeTooltip.score.toFixed(3)}
            </p>
            <p>
              <span className="font-medium text-slate-900">Rank:</span>{" "}
              {edgeTooltip.rank}
            </p>
            <p>
              <span className="font-medium text-slate-900">Algorithms:</span>{" "}
              {edgeTooltip.supportingAlgorithms.length > 0
                ? edgeTooltip.supportingAlgorithms.join(", ")
                : "-"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}