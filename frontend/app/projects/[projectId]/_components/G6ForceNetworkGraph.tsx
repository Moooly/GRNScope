import { useEffect, useRef } from "react";
import { CanvasEvent, EdgeEvent, Graph, GraphEvent, NodeEvent } from "@antv/g6";
import { Renderer as SVGRenderer } from "@antv/g-svg";
import type {
  NetworkEdge,
  NetworkGraphExportOptions,
  NetworkGraphHandle,
  NetworkNode,
} from "./networkGraphTypes";

type G6ForceNetworkGraphProps = {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  selectedGene: string | null;
  selectedEdgeKey: string | null;
  onSelectGene: (geneId: string | null) => void;
  onSelectEdge: (edgeKey: string | null) => void;
  onGraphReady?: (graph: NetworkGraphHandle | null) => void;
};

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 2.4;
const GRAPH_BACKGROUND = "#f8fbff";

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function startingPoint(id: string, index: number, width: number, height: number) {
  const hash = hashString(id);
  const angle = ((hash % 360) * Math.PI) / 180;
  const radius = 90 + ((hash >>> 8) % 180) + (index % 5) * 12;
  return {
    x: width / 2 + Math.cos(angle) * radius,
    y: height / 2 + Math.sin(angle) * radius,
  };
}

function nodeSize(node: NetworkNode) {
  return node.isTF ? Math.min(38, 24 + node.degree * 0.8) : Math.min(28, 16 + node.degree * 0.45);
}

function stopG6Layout(graph: Graph) {
  if (graph.destroyed) return;

  // G6 may be torn down before its layout runtime has been installed (for
  // example during a fast layout switch or a failed render). Its public
  // stopLayout method currently assumes that runtime always exists.
  try {
    graph.stopLayout();
  } catch {
    // There is no layout work left to stop in this lifecycle state.
  }
}

function applyG6Selection(
  graph: Graph,
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  selectedGene: string | null,
  selectedEdgeKey: string | null,
) {
  if (graph.destroyed || !graph.rendered) return;

  nodes.forEach((node) => {
    void graph.setElementState(node.id, node.id === selectedGene ? ["selected"] : []);
  });
  edges.forEach((edge) => {
    void graph.setElementState(
      edge.key,
      edge.key === selectedEdgeKey ? ["selected"] : [],
    );
  });
}

function createG6Handle(
  graph: Graph,
  container: HTMLDivElement,
): NetworkGraphHandle {
  return {
    kind: "g6",
    zoom: () => graph.getZoom(),
    minZoom: () => MIN_ZOOM,
    maxZoom: () => MAX_ZOOM,
    width: () => graph.getSize()[0] || container.clientWidth,
    height: () => graph.getSize()[1] || container.clientHeight,
    stop: () => stopG6Layout(graph),
    setZoom: (level) => {
      void graph.zoomTo(level, false, graph.getCanvasCenter());
    },
    on: (event, listener) => {
      if (event === "zoom") graph.on(GraphEvent.AFTER_TRANSFORM, listener);
    },
    off: (event, listener) => {
      if (event === "zoom") graph.off(GraphEvent.AFTER_TRANSFORM, listener);
    },
    destroyed: () => graph.destroyed,
    png: async (options: NetworkGraphExportOptions = {}) =>
      graph.toDataURL({
        mode: options.full ? "overall" : "viewport",
        type: "image/png",
        encoderOptions: 1,
      }),
    svg: async () => {
      const svg = container.querySelector("svg");
      if (!svg) throw new Error("The force network SVG is not available yet.");
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(container.clientWidth));
      clone.setAttribute("height", String(container.clientHeight));
      return new XMLSerializer().serializeToString(clone);
    },
  };
}

export default function G6ForceNetworkGraph({
  nodes,
  edges,
  selectedGene,
  selectedEdgeKey,
  onSelectGene,
  onSelectEdge,
  onGraphReady,
}: G6ForceNetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const onGraphReadyRef = useRef(onGraphReady);
  const onSelectGeneRef = useRef(onSelectGene);
  const onSelectEdgeRef = useRef(onSelectEdge);
  const selectedGeneRef = useRef(selectedGene);
  const selectedEdgeKeyRef = useRef(selectedEdgeKey);

  useEffect(() => {
    onGraphReadyRef.current = onGraphReady;
    onSelectGeneRef.current = onSelectGene;
    onSelectEdgeRef.current = onSelectEdge;
  }, [onGraphReady, onSelectEdge, onSelectGene]);

  useEffect(() => {
    selectedGeneRef.current = selectedGene;
    selectedEdgeKeyRef.current = selectedEdgeKey;
  }, [selectedEdgeKey, selectedGene]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = Math.max(container.clientWidth, 720);
    const height = Math.max(container.clientHeight, 680);
    const graph = new Graph({
      container,
      width,
      height,
      renderer: () => new SVGRenderer(),
      background: GRAPH_BACKGROUND,
      animation: false,
      autoResize: true,
      padding: 56,
      zoomRange: [MIN_ZOOM, MAX_ZOOM],
      autoFit: "view",
      data: {
        nodes: nodes.map((node, index) => {
          const point = startingPoint(node.id, index, width, height);
          const size = nodeSize(node);
          return {
            id: node.id,
            x: point.x,
            y: point.y,
            data: node,
            style: {
              size,
              fill: node.isTF ? "#7357df" : "#b6a7f3",
              stroke: node.isTF ? "#5034c5" : "#8c78df",
              lineWidth: node.isTF ? 2 : 1.25,
              labelText: node.showLabel === false ? "" : node.id,
              labelFill: "#26304b",
              labelFontSize: node.isTF ? 12 : 10,
              labelFontWeight: node.isTF ? 700 : 500,
              labelPlacement: "bottom",
              labelOffsetY: 7,
              halo: node.isTF,
              haloStroke: "#9a87ef",
              haloStrokeOpacity: 0.18,
              haloLineWidth: 12,
            },
          };
        }),
        edges: edges.map((edge) => ({
          id: edge.key,
          source: edge.source,
          target: edge.target,
          data: edge,
          style: {
            stroke:
              edge.sign > 0
                ? "#0072b2"
                : edge.sign < 0
                  ? "#d55e00"
                  : "#aeb7c9",
            lineWidth: Math.max(0.8, Math.min(3, 0.8 + edge.confidence * 1.8)),
            strokeOpacity: 0.22 + Math.min(0.58, edge.score * 0.55),
            endArrow: edge.direction === 0 ? false : true,
          },
        })),
      },
      layout: {
        type: "force",
        preventOverlap: true,
        nodeSize: (node) => nodeSize(node.data as NetworkNode),
        nodeSpacing: 18,
        linkDistance: 150,
        nodeStrength: (node) => -(170 + (node.data as NetworkNode).degree * 8),
        edgeStrength: (edge) => 30 + (edge.data as NetworkEdge).confidence * 55,
        gravity: 8,
        damping: 0.88,
        maxSpeed: 40,
      },
      behaviors: [
        "drag-canvas",
        { type: "zoom-canvas", sensitivity: 0.7 },
        { type: "drag-element-force", fixed: true },
        "hover-activate",
        { type: "fix-element-size", enable: true },
      ],
      node: {
        type: "circle",
        state: {
          selected: {
            halo: true,
            haloStroke: "#21145f",
            haloStrokeOpacity: 0.42,
            haloLineWidth: 18,
            lineWidth: 3,
          },
          active: {
            halo: true,
            haloStroke: "#7357df",
            haloStrokeOpacity: 0.3,
            haloLineWidth: 15,
          },
        },
      },
      edge: {
        type: "line",
        state: {
          selected: {
            lineWidth: 3,
            strokeOpacity: 0.95,
            halo: true,
            haloLineWidth: 10,
            haloStrokeOpacity: 0.2,
          },
          active: {
            strokeOpacity: 0.9,
            halo: true,
            haloLineWidth: 8,
            haloStrokeOpacity: 0.14,
          },
        },
      },
    });

    graph.on(NodeEvent.CLICK, (event) => {
      const target = (event as { target?: { id?: string } }).target;
      if (!target?.id) return;
      onSelectGeneRef.current(target.id);
      onSelectEdgeRef.current(null);
    });
    graph.on(EdgeEvent.CLICK, (event) => {
      const target = (event as { target?: { id?: string } }).target;
      if (!target?.id) return;
      onSelectEdgeRef.current(target.id);
      onSelectGeneRef.current(null);
    });
    graph.on(CanvasEvent.CLICK, () => {
      onSelectGeneRef.current(null);
      onSelectEdgeRef.current(null);
    });

    graphRef.current = graph;
    const handle = createG6Handle(graph, container);
    let cancelled = false;
    let renderSettled = false;

    const destroyGraph = () => {
      if (graph.destroyed) return;
      stopG6Layout(graph);
      graph.destroy();
      if (graphRef.current === graph) graphRef.current = null;
    };

    void graph
      .render()
      .then(() => {
        renderSettled = true;
        if (cancelled) {
          destroyGraph();
          return;
        }
        if (!graph.destroyed) {
          applyG6Selection(
            graph,
            nodes,
            edges,
            selectedGeneRef.current,
            selectedEdgeKeyRef.current,
          );
          onGraphReadyRef.current?.(handle);
        }
      })
      .catch(() => {
        renderSettled = true;
        if (cancelled) {
          destroyGraph();
          return;
        }
        if (!graph.destroyed) onGraphReadyRef.current?.(null);
      });

    return () => {
      cancelled = true;
      onGraphReadyRef.current?.(null);
      // G6's render() yields once before initializing its runtime. Waiting for
      // that promise avoids destroying the instance during that gap, which
      // otherwise causes its own "graph instance has been destroyed" warning.
      if (renderSettled) destroyGraph();
    };
  }, [edges, nodes]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || graph.destroyed || !graph.rendered) return;

    applyG6Selection(graph, nodes, edges, selectedGene, selectedEdgeKey);
  }, [edges, nodes, selectedEdgeKey, selectedGene]);

  return (
    <div
      ref={containerRef}
      className="h-[680px] w-full overflow-hidden rounded-[1.75rem] border border-slate-200 bg-[#f8fbff] shadow-inner shadow-slate-900/5"
      aria-label="Force-directed gene regulation network"
    />
  );
}
