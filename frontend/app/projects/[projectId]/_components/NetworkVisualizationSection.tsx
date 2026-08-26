import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Core } from "cytoscape";
import NetworkGraph, {
  MAX_NETWORK_ZOOM,
  MIN_NETWORK_ZOOM,
} from "./NetworkGraph";
import CircosNetworkGraph from "./CircosNetworkGraph";
import NetworkHelpModal from "./NetworkHelpModal";
import { DownloadIcon } from "./DownloadMenu";
import { isDenseNetwork } from "./networkGraphLayouts";

type NodeInfo = {
  id: string;
  inDegree: number;
  outDegree: number;
  degree: number;
  isTF: boolean;
  topRegulators: string[];
  topTargets: string[];
};

type AggregatedEdge = {
  key: string;
  source: string;
  target: string;
  score: number;
  confidence: number;
  bootstrapVerified?: boolean;
  bootstrapSelectedRuns?: number;
  bootstrapRunCount?: number;
  evidenceCiLower?: number | null;
  evidenceCiUpper?: number | null;
  bootstrapSignConfidence?: number | null;
  bootstrapSignCoverage?: number | null;
  bootstrapSignedSelectedRuns?: number;
  bootstrapSignAgreeingRuns?: number;
  bootstrapSignReference?: "full_data" | "bootstrap_mean" | null;
  count: number;
  rank: number;
  perAlgorithmScores: Record<string, number>;
  perAlgorithmConfidences?: Record<string, number>;
  perAlgorithmRawScores?: Record<string, number>;
  perAlgorithmSigns?: Record<string, -1 | 0 | 1>;
  supportingAlgorithms: string[];
  direction: -1 | 0 | 1;
  directionConfidence: number | null;
  directionCoverage: number;
  sign: -1 | 0 | 1;
  signConfidence: number | null;
  signCoverage: number;
};

type NetworkVisualizationSectionProps = {
  networkLayout: "force" | "hierarchical" | "concentric" | "circular" | "circos";
  setNetworkLayout: (value: "force" | "hierarchical" | "concentric" | "circular" | "circos") => void;
  onExportNetwork: (format: "png" | "svg") => void;
  onExportCircosPng: (svgElement: SVGSVGElement) => void | Promise<void>;
  onGraphReady?: (cy: import("cytoscape").Core | null) => void;
  networkNodes: NodeInfo[];
  filteredNetworkEdges: AggregatedEdge[];
  selectedGene: string | null;
  selectedEdgeKey: string | null;
  setSelectedGene: (value: string | null) => void;
  setSelectedEdgeKey: (value: string | null) => void;
  selectedNode: NodeInfo | null;
  isolatedGene: string | null;
  setIsolatedGene: (value: string | null) => void;
  edgeDisplayLimit: number;
  cellOracleReady: boolean;
  perturbationGenes: string[];
  onOpenPerturbation: (gene: string) => void;
  resultsControls?: ReactNode;
};

const layoutOptions = [
  { value: "force", label: "Force", title: "Explore components and regulatory neighborhoods" },
  { value: "hierarchical", label: "Hierarchical", title: "Arrange regulation in directional layers" },
  { value: "concentric", label: "Hubs", title: "Place high-degree regulators near the center" },
  { value: "circular", label: "Circular", title: "Arrange nodes around a circle" },
  { value: "circos", label: "Circos", title: "Arrange genes by genomic position" },
] as const;

const NODE_COLOR = "#5c83d8";

function buildComponentAssignments(
  nodes: NodeInfo[],
  edges: AggregatedEdge[],
) {
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  edges.forEach((edge) => {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });

  const visited = new Set<string>();
  const components: string[][] = [];
  [...adjacency.keys()].sort().forEach((startId) => {
    if (visited.has(startId)) return;
    const component: string[] = [];
    const stack = [startId];
    visited.add(startId);

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      component.push(currentId);
      adjacency.get(currentId)?.forEach((nextId) => {
        if (visited.has(nextId)) return;
        visited.add(nextId);
        stack.push(nextId);
      });
    }

    components.push(component);
  });

  components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  const assignments = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    component.forEach((nodeId) => assignments.set(nodeId, componentIndex));
  });

  return { assignments, componentCount: components.length };
}

const NETWORK_ZOOM_FACTOR = 1.2;

export default function NetworkVisualizationSection({
  networkLayout,
  setNetworkLayout,
  onExportNetwork,
  onExportCircosPng,
  onGraphReady,
  networkNodes,
  filteredNetworkEdges,
  selectedGene,
  selectedEdgeKey,
  setSelectedGene,
  setSelectedEdgeKey,
  selectedNode,
  isolatedGene,
  setIsolatedGene,
  edgeDisplayLimit,
  cellOracleReady,
  perturbationGenes,
  onOpenPerturbation,
  resultsControls,
}: NetworkVisualizationSectionProps) {
  const [isExportConfirmOpen, setIsExportConfirmOpen] = useState(false);
  const [isVisualGuideOpen, setIsVisualGuideOpen] = useState(false);
  const [isVisualGuideClosing, setIsVisualGuideClosing] = useState(false);
  const [isInspectionGuideOpen, setIsInspectionGuideOpen] = useState(false);
  const [isInspectionGuideClosing, setIsInspectionGuideClosing] = useState(false);
  const [networkZoom, setNetworkZoom] = useState(1);
  // Mirrors the graph's floor, which is relaxed per layout for tall graphs.
  const [networkMinZoom, setNetworkMinZoom] = useState(MIN_NETWORK_ZOOM);
  const circosSvgRef = useRef<SVGSVGElement | null>(null);
  const graphCoreRef = useRef<Core | null>(null);
  const graphZoomHandlerRef = useRef<(() => void) | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const portalRoot = typeof document === "undefined" ? null : document.body;

  const selectedEdge =
    filteredNetworkEdges.find((edge) => edge.key === selectedEdgeKey) ?? null;
  const effectiveEdgeLimit =
    filteredNetworkEdges.length === 0
      ? 0
      : Math.min(
          filteredNetworkEdges.length,
          Number.isFinite(edgeDisplayLimit) && edgeDisplayLimit >= 0
            ? Math.floor(edgeDisplayLimit)
            : 0
        );

  const visualEdges = useMemo(() => {
    return filteredNetworkEdges.slice(0, effectiveEdgeLimit);
  }, [effectiveEdgeLimit, filteredNetworkEdges]);

  const visualNodes = useMemo(() => {
    const visibleNodeIds = new Set<string>();
    visualEdges.forEach((edge) => {
      visibleNodeIds.add(edge.source);
      visibleNodeIds.add(edge.target);
    });

    return networkNodes.filter((node) => visibleNodeIds.has(node.id));
  }, [networkNodes, visualEdges]);

  const componentAssignments = useMemo(
    () => buildComponentAssignments(visualNodes, visualEdges),
    [visualEdges, visualNodes],
  );
  const isDenseGraph = isDenseNetwork(visualNodes.length, visualEdges.length);

  // Memoize the projections passed into NetworkGraph so identity stays stable
  // across renders that don't actually change the graph. NetworkGraph compares
  // these by reference to decide whether to rebuild the Cytoscape instance.
  const graphNodes = useMemo(
    () => {
      const labelPriority = [...visualNodes]
        .sort(
          (a, b) =>
            b.outDegree * 2 + b.degree - (a.outDegree * 2 + a.degree) ||
            a.id.localeCompare(b.id),
        );
      const labeledNodeIds = isDenseGraph
        ? new Set([
            ...visualNodes.filter((node) => node.isTF).map((node) => node.id),
            ...labelPriority
              .filter((node) => !node.isTF)
              .slice(0, Math.min(6, visualNodes.length))
              .map((node) => node.id),
          ])
        : new Set(
            labelPriority
              .slice(0, Math.min(24, visualNodes.length))
              .map((node) => node.id)
          );

      if (selectedGene) labeledNodeIds.add(selectedGene);
      if (selectedEdge) {
        labeledNodeIds.add(selectedEdge.source);
        labeledNodeIds.add(selectedEdge.target);
      }

      return visualNodes.map((node) => {
        const componentIndex = componentAssignments.assignments.get(node.id) ?? 0;

        return {
        id: node.id,
        inDegree: node.inDegree,
        outDegree: node.outDegree,
        degree: node.degree,
          isTF: node.isTF,
          componentIndex,
          componentColor: NODE_COLOR,
          showLabel: labeledNodeIds.has(node.id),
        };
      });
    },
    [componentAssignments, isDenseGraph, selectedEdge, selectedGene, visualNodes]
  );

  const graphEdges = useMemo(
    () =>
      visualEdges.map((edge) => ({
        key: edge.key,
        source: edge.source,
        target: edge.target,
        score: edge.score,
        confidence: edge.confidence,
        count: edge.count,
        rank: edge.rank,
        supportingAlgorithms: edge.supportingAlgorithms,
        direction: edge.direction,
        directionConfidence: edge.directionConfidence,
        directionCoverage: edge.directionCoverage,
        sign: edge.sign,
        signConfidence: edge.signConfidence,
        signCoverage: edge.signCoverage,
      })),
    [visualEdges]
  );

  const closeExportConfirm = () => {
    setIsExportConfirmOpen(false);
  };

  useEffect(() => {
    if (!isExportConfirmOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (exportMenuRef.current?.contains(target)) return;
      closeExportConfirm();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeExportConfirm();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isExportConfirmOpen]);

  const closeVisualGuide = () => {
    setIsVisualGuideClosing(true);
    window.setTimeout(() => {
      setIsVisualGuideOpen(false);
      setIsVisualGuideClosing(false);
    }, 280);
  };

  const closeInspectionGuide = () => {
    setIsInspectionGuideClosing(true);
    window.setTimeout(() => {
      setIsInspectionGuideOpen(false);
      setIsInspectionGuideClosing(false);
    }, 280);
  };

  const closeInspection = useCallback(() => {
    setSelectedGene(null);
    setSelectedEdgeKey(null);
  }, [setSelectedEdgeKey, setSelectedGene]);

  useEffect(() => {
    if (!selectedNode && !selectedEdge) return;
    if (isExportConfirmOpen || isVisualGuideOpen || isInspectionGuideOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeInspection();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    isExportConfirmOpen,
    isInspectionGuideOpen,
    isVisualGuideOpen,
    closeInspection,
    selectedEdge,
    selectedNode,
  ]);

  const handleGraphReady = useCallback(
    (graph: Core | null) => {
      const previousGraph = graphCoreRef.current;
      const previousZoomHandler = graphZoomHandlerRef.current;

      if (previousGraph && previousZoomHandler && !previousGraph.destroyed()) {
        previousGraph.off("zoom", previousZoomHandler);
      }

      graphCoreRef.current = graph;
      graphZoomHandlerRef.current = null;

      if (graph && !graph.destroyed()) {
        const handleZoom = () => {
          setNetworkZoom(graph.zoom());
          setNetworkMinZoom(graph.minZoom());
        };
        graphZoomHandlerRef.current = handleZoom;
        graph.on("zoom", handleZoom);
        setNetworkZoom(graph.zoom());
        setNetworkMinZoom(graph.minZoom());
      } else {
        setNetworkZoom(1);
        setNetworkMinZoom(MIN_NETWORK_ZOOM);
      }

      onGraphReady?.(graph);
    },
    [onGraphReady]
  );

  const changeNetworkZoom = useCallback((factor: number) => {
    const graph = graphCoreRef.current;
    if (!graph || graph.destroyed()) return;

    // Use the graph's live floor, which is relaxed for tall layouts, rather than
    // the static constant -- otherwise the button stops short of what fit allows.
    const nextZoom = Math.min(
      MAX_NETWORK_ZOOM,
      Math.max(graph.minZoom(), graph.zoom() * factor)
    );

    graph.stop(true, false);
    graph.zoom({
      level: nextZoom,
      renderedPosition: {
        x: graph.width() / 2,
        y: graph.height() / 2,
      },
    });
  }, []);

  const inspectorHeightClass =
    visualNodes.length <= 18
      ? "xl:max-h-[clamp(560px,68vh,700px)]"
      : visualNodes.length <= 60
        ? "xl:max-h-[clamp(640px,74vh,820px)]"
        : "xl:max-h-[clamp(700px,78vh,920px)]";

  return (
    <section className="network-atlas overflow-clip rounded-[2rem] border border-slate-200 bg-white text-slate-900 shadow-[0_30px_76px_-46px_rgba(30,64,89,0.3)]">
      {resultsControls ? (
        <div className="pointer-events-none sticky top-[calc(var(--grnscope-header-height)+4px)] z-50 h-0">
          <div className="flex justify-end px-5 pt-4 sm:px-6">
            <div className="network-atlas-controls pointer-events-auto">
              {resultsControls}
            </div>
          </div>
        </div>
      ) : null}

      <header className="relative z-40 bg-[linear-gradient(180deg,#ffffff_0%,#ffffff_78%,#fbfdfe_100%)] px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h3 className="text-2xl font-bold tracking-[-0.025em] text-slate-950">
                Regulatory atlas
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsVisualGuideClosing(false);
                  setIsVisualGuideOpen(true);
                }}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-[11px] font-extrabold leading-none text-slate-500 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
                aria-label="Open network visual guide"
                aria-haspopup="dialog"
                aria-controls="network-visual-guide-title"
                title="Open network visual guide"
              >
                ?
              </button>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600 xl:whitespace-nowrap">
              Click a node or edge to inspect it and explore the network in more detail.
            </p>
          </div>
          {resultsControls ? <div className="h-10 w-[488px] shrink-0" aria-hidden="true" /> : null}
        </div>

        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-10 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-px" aria-label="Network layout">
              {layoutOptions.map(({ value, label, title }) => {
                const isActive = networkLayout === value;

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setNetworkLayout(value)}
                    title={title}
                    className={`h-full rounded-full px-4 text-xs font-bold transition ${
                      isActive
                        ? "bg-[#1b75a6] text-white shadow-sm"
                        : "text-slate-600 hover:bg-white hover:text-[#1b75a6]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {networkLayout !== "circos" && (
              <div className="inline-flex h-10 overflow-hidden rounded-full border border-slate-200 bg-white" aria-label="Network zoom">
                <button
                  type="button"
                  onClick={() => changeNetworkZoom(1 / NETWORK_ZOOM_FACTOR)}
                  disabled={networkZoom <= networkMinZoom + 0.001}
                  className="inline-flex h-full w-10 items-center justify-center border-r border-slate-200 text-base font-bold text-slate-600 transition hover:bg-[#f2f9fc] hover:text-[#1b75a6] disabled:cursor-default disabled:opacity-30"
                  aria-label="Zoom out network"
                  title="Zoom out"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => changeNetworkZoom(NETWORK_ZOOM_FACTOR)}
                  disabled={networkZoom >= MAX_NETWORK_ZOOM - 0.001}
                  className="inline-flex h-full w-10 items-center justify-center text-base font-bold text-slate-600 transition hover:bg-[#f2f9fc] hover:text-[#1b75a6] disabled:cursor-default disabled:opacity-30"
                  aria-label="Zoom in network"
                  title="Zoom in"
                >
                  +
                </button>
              </div>
            )}
            <div ref={exportMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsExportConfirmOpen((current) => !current)}
                aria-label="Download current network"
                aria-expanded={isExportConfirmOpen}
                aria-haspopup="dialog"
                title="Download current network"
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#1b75a6]/10"
              >
                <DownloadIcon />
                Download
                <span className={`text-[10px] transition-transform ${isExportConfirmOpen ? "rotate-180" : ""}`} aria-hidden="true">▾</span>
              </button>
              {isExportConfirmOpen && (
                <div
                  className="absolute right-0 top-[calc(100%+0.75rem)] z-40 w-[min(22rem,calc(100vw-3rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white/98 p-2 text-slate-900 shadow-2xl shadow-slate-900/15 backdrop-blur-xl"
                  role="dialog"
                  aria-modal="false"
                  aria-label="Download current network"
                >
                  {networkLayout !== "circos" && (
                    <button
                      type="button"
                      onClick={() => {
                        onExportNetwork("svg");
                        closeExportConfirm();
                      }}
                      className="group flex w-full items-center justify-between gap-4 rounded-xl px-3 py-3 text-left transition hover:bg-[#f2f9fc]"
                    >
                      <span>
                        <span className="block text-sm font-bold text-slate-900">Publication vector</span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-500">Scalable atlas with a self-contained legend.</span>
                      </span>
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-[#087ead]">SVG</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (networkLayout === "circos") {
                        if (circosSvgRef.current) {
                          void Promise.resolve(onExportCircosPng(circosSvgRef.current)).catch(() => undefined);
                        }
                      } else {
                        onExportNetwork("png");
                      }
                      closeExportConfirm();
                    }}
                    className="group flex w-full items-center justify-between gap-4 rounded-xl px-3 py-3 text-left transition hover:bg-[#f2f9fc]"
                  >
                    <span>
                      <span className="block text-sm font-bold text-slate-900">Presentation image</span>
                      <span className="mt-0.5 block text-xs leading-5 text-slate-500">High-resolution view with the current focus and framing.</span>
                    </span>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-[#087ead]">PNG</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {isolatedGene ? (
          <button
            type="button"
            onClick={() => setIsolatedGene(null)}
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#168f98]/20 bg-[#e9f7f7] px-3 py-1.5 text-[11px] font-bold text-[#116f76] transition hover:bg-[#dff2f2]"
            title="Return to the full network"
          >
            Focus: {isolatedGene}
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </header>

      <div className={`grid min-w-0 ${selectedNode || selectedEdge ? "xl:grid-cols-[minmax(0,1fr)_390px]" : "grid-cols-1"}`}>
        <div className="relative min-w-0">
          {networkLayout === "circos" ? (
            <CircosNetworkGraph
              nodes={visualNodes}
              edges={visualEdges}
              selectedGene={selectedGene}
              selectedEdgeKey={selectedEdgeKey}
              onSelectGene={(gene) => {
                setSelectedGene(gene);
                setSelectedEdgeKey(null);
              }}
              onSelectEdge={(edgeKey) => {
                setSelectedEdgeKey(edgeKey);
                setSelectedGene(null);
              }}
              svgRef={circosSvgRef}
            />
          ) : (
            <NetworkGraph
              nodes={graphNodes}
              edges={graphEdges}
              selectedGene={selectedGene}
              selectedEdgeKey={selectedEdgeKey}
              layout={networkLayout}
              onSelectGene={(gene) => {
                setSelectedGene(gene);
                setSelectedEdgeKey(null);
              }}
              onSelectEdge={(edgeKey) => {
                setSelectedEdgeKey(edgeKey);
                setSelectedGene(null);
              }}
              onGraphReady={handleGraphReady}
            />
          )}
        </div>
        {(selectedNode || selectedEdge) && (
          <aside
            className={`network-inspector animate-inspector-panel min-w-0 overflow-y-auto border-t border-slate-200 bg-[#f8fafc] p-5 shadow-[-24px_0_70px_-50px_rgba(30,64,89,0.32)] xl:border-l xl:border-t-0 ${inspectorHeightClass}`}
            aria-label={selectedEdge ? "Regulation inspection" : "Node inspection"}
          >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h4 className="text-base font-bold text-slate-950">
                {selectedEdge ? "Regulation Inspection" : "Node Inspection"}
              </h4>
              {selectedEdge && (
                <button
                  type="button"
                  onClick={() => {
                    setIsInspectionGuideClosing(false);
                    setIsInspectionGuideOpen(true);
                  }}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-[11px] font-extrabold leading-none text-slate-500 transition hover:border-[#087ead]/40 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
                  aria-label="Open edge inspection guide"
                  title="Open edge inspection guide"
                >
                  ?
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={closeInspection}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-base font-bold text-slate-500 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
              aria-label="Close inspection panel"
              title="Close inspection panel"
            >
              ×
            </button>
          </div>

          {selectedEdge ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#1b75a6]">
                    Selected regulation
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                      selectedEdge.sign > 0
                        ? "bg-[#e8f5fb] text-[#0072B2]"
                        : selectedEdge.sign < 0
                          ? "bg-[#fff0e8] text-[#D55E00]"
                          : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {selectedEdge.sign > 0
                      ? "Activation"
                      : selectedEdge.sign < 0
                        ? "Repression"
                      : "Unsigned"}
                  </span>
                </div>

                <div
                  className="mt-3 min-w-0 whitespace-nowrap text-2xl font-bold leading-tight text-slate-950"
                  title={`${selectedEdge.source} → ${selectedEdge.target}`}
                >
                  <span>{selectedEdge.source}</span>
                  <span className="px-2 text-[#1b75a6]">→</span>
                  <span>{selectedEdge.target}</span>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    Regulation evidence
                  </p>
                  <p className="mt-2 text-2xl font-bold text-slate-950">
                    {selectedEdge.score.toFixed(3)}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    {selectedEdge.bootstrapVerified &&
                    selectedEdge.evidenceCiLower !== null &&
                    selectedEdge.evidenceCiLower !== undefined &&
                    selectedEdge.evidenceCiUpper !== null &&
                    selectedEdge.evidenceCiUpper !== undefined
                      ? `95% bootstrap interval ${selectedEdge.evidenceCiLower.toFixed(2)}–${selectedEdge.evidenceCiUpper.toFixed(2)}`
                      : `rank #${selectedEdge.rank}`}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    {selectedEdge.bootstrapVerified
                      ? "Bootstrap confidence"
                      : "Legacy resampling score"}
                  </p>
                  <p
                    className="mt-2 text-2xl font-bold text-slate-950"
                    title={
                      selectedEdge.bootstrapVerified
                        ? "How often the edge was recovered in genuine cell-bootstrap samples."
                        : "This saved result predates with-replacement cell bootstrapping."
                    }
                  >
                    {selectedEdge.bootstrapVerified
                      ? `${Math.round(selectedEdge.confidence * 100)}%`
                      : selectedEdge.confidence.toFixed(3)}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    {selectedEdge.bootstrapVerified &&
                    selectedEdge.bootstrapSelectedRuns !== undefined &&
                    selectedEdge.bootstrapRunCount !== undefined
                      ? `recovered in ${selectedEdge.bootstrapSelectedRuns} of ${selectedEdge.bootstrapRunCount} samples`
                      : selectedEdge.bootstrapVerified
                        ? "median cell-bootstrap recovery"
                        : "rerun to calculate bootstrap confidence"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    Direction confidence
                  </p>
                  <p className="mt-2 text-2xl font-bold text-slate-950">
                    {selectedEdge.directionConfidence === null
                      ? "-"
                      : `${Math.round(selectedEdge.directionConfidence * 100)}%`}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    coverage {Math.round(selectedEdge.directionCoverage * 100)}%
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    <span className="block">Sign</span>
                    <span className="block">stability</span>
                  </p>
                  <p className="mt-2 text-2xl font-bold text-slate-950">
                    {selectedEdge.signConfidence === null
                      ? "-"
                      : `${Math.round(selectedEdge.signConfidence * 100)}%`}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    {selectedEdge.signConfidence !== null &&
                    selectedEdge.bootstrapSignAgreeingRuns !== undefined &&
                    selectedEdge.bootstrapSignedSelectedRuns !== undefined &&
                    selectedEdge.bootstrapSelectedRuns !== undefined
                      ? `${selectedEdge.bootstrapSignAgreeingRuns}/${selectedEdge.bootstrapSignedSelectedRuns} signed recoveries matched; sign present in ${selectedEdge.bootstrapSignedSelectedRuns}/${selectedEdge.bootstrapSelectedRuns} edge recoveries`
                      : selectedEdge.signConfidence !== null
                        ? `signed bootstrap coverage ${Math.round(selectedEdge.signCoverage * 100)}%`
                        : "rerun to measure sign across bootstrap samples"}
                  </p>
                </div>
              </div>

              <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#1b75a6]">
                    Method evidence
                  </p>
                  <span className="shrink-0 text-xs font-bold text-slate-500">
                    {selectedEdge.count} supporting
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {selectedEdge.supportingAlgorithms.length > 0 ? (
                    selectedEdge.supportingAlgorithms
                      .map((algorithmId) => ({
                        algorithmId,
                        algorithmScore: selectedEdge.perAlgorithmScores[algorithmId],
                      }))
                      .sort((a, b) => {
                        const scoreDifference =
                          (b.algorithmScore ?? Number.NEGATIVE_INFINITY) -
                          (a.algorithmScore ?? Number.NEGATIVE_INFINITY);

                        return scoreDifference !== 0
                          ? scoreDifference
                          : a.algorithmId.localeCompare(b.algorithmId);
                      })
                      .map(({ algorithmId, algorithmScore }) => {

                      return (
                        <div
                          key={algorithmId}
                          className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5"
                        >
                          <span className="min-w-0 truncate text-sm font-bold text-slate-700">
                            {algorithmId}
                          </span>
                          <span className="whitespace-nowrap rounded-full border border-[#1b75a6]/15 bg-white px-2.5 py-1 text-xs font-bold tabular-nums text-[#1b75a6]">
                            {algorithmScore !== undefined ? algorithmScore.toFixed(3) : "-"}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
                      No selected method recovered this edge in its bootstrap samples.
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : selectedNode ? (
            <>
              <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-4">
                <p className="text-lg font-bold text-slate-950">{selectedNode.id}</p>
                <p className="mt-2 text-sm text-slate-600">
                  {selectedNode.isTF ? "Transcription factor" : "Target gene"}
                </p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">
                  In-degree: {selectedNode.inDegree}
                </div>
                <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">
                  Out-degree: {selectedNode.outDegree}
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-[#087ead]/15 bg-[#f2f9fc] px-3.5 py-3">
                <p className="text-sm font-bold text-slate-950">CellOracle perturbation</p>
                <div className="mt-3 flex justify-start gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenPerturbation(selectedNode.id)}
                    disabled={!cellOracleReady || !perturbationGenes.includes(selectedNode.id)}
                    className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-[#087ead] px-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#066b94] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Perturb {selectedNode.id}
                  </button>
                  <span className={`self-center text-xs leading-5 ${
                    cellOracleReady && perturbationGenes.includes(selectedNode.id)
                      ? "text-[#178a62]"
                      : "text-slate-500"
                  }`}>
                    {cellOracleReady
                      ? perturbationGenes.includes(selectedNode.id)
                        ? `${selectedNode.id} ready to perturb`
                        : "Not an active regulator"
                      : "Waiting for CellOracle"
                    }
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1b75a6]">
                    Top regulators
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedNode.topRegulators.slice(0, 8).map((gene) => (
                      <span
                        key={gene}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600"
                      >
                        {gene}
                      </span>
                    ))}
                    {selectedNode.topRegulators.length === 0 && (
                      <span className="text-xs text-slate-500">None</span>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1b75a6]">
                    Top target genes
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedNode.topTargets.slice(0, 8).map((gene) => (
                      <span
                        key={gene}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600"
                      >
                        {gene}
                      </span>
                    ))}
                    {selectedNode.topTargets.length === 0 && (
                      <span className="text-xs text-slate-500">None</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-6 border-t border-slate-200 pt-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {isolatedGene ? (
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#20b779]/20 bg-[#e8f7f1] px-3 py-1.5 text-xs font-bold text-[#178a62]">
                      <span className="h-2 w-2 rounded-full bg-[#20b779] shadow-[0_0_0_4px_rgba(32,183,121,0.14)]" />
                      Isolating sub-network for <span className="font-bold text-[#178a62]">{isolatedGene}</span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600">
                      <span className="h-2 w-2 rounded-full bg-slate-400" />
                      Full network view
                    </div>
                  )}
                </div>

                <div className="flex flex-nowrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsolatedGene(selectedNode.id);
                      setSelectedEdgeKey(null);
                    }}
                    className={`inline-flex flex-1 whitespace-nowrap items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                      isolatedGene === selectedNode.id
                        ? "border border-[#20b779]/20 bg-[#e8f7f1] text-[#178a62]"
                        : "border border-slate-200 bg-white text-slate-700 hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                    }`}
                  >
                    {isolatedGene === selectedNode.id ? "Currently Isolating" : "Isolate Sub-network"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsolatedGene(null);
                      setSelectedEdgeKey(null);
                    }}
                    disabled={!isolatedGene}
                    className={`inline-flex flex-1 items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                      isolatedGene
                        ? "border border-slate-200 bg-white text-slate-700 hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                        : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                    }`}
                  >
                    Reset View
                  </button>
                </div>
              </div>
            </>
          ) : null}
          </aside>
        )}
      </div>
      {portalRoot && isVisualGuideOpen ? (
        <NetworkHelpModal
          onClose={closeVisualGuide}
          isClosing={isVisualGuideClosing}
        />
      ) : null}
      {portalRoot &&
        isInspectionGuideOpen &&
        createPortal(
          <div
            className={`fixed inset-0 z-[9999] flex min-h-screen items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm ${
              isInspectionGuideClosing
                ? "animate-modal-overlay-out"
                : "animate-modal-overlay"
            }`}
            onClick={closeInspectionGuide}
          >
            <div
              className={`w-full max-w-lg rounded-[1.5rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 ${
                isInspectionGuideClosing
                  ? "animate-modal-panel-out"
                  : "animate-modal-panel"
              }`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#1b75a6]">
                    Edge inspection
                  </p>
                  <h5 className="mt-2 text-lg font-bold text-slate-950">
                    What do these metrics mean?
                  </h5>
                </div>
                <button
                  type="button"
                  onClick={closeInspectionGuide}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-bold text-slate-500 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                  aria-label="Close edge inspection guide"
                >
                  ×
                </button>
              </div>

              <div className="mt-5 space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h6 className="text-sm font-bold text-slate-950">Regulation evidence</h6>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Per-target percentile rank from the original full-data fit.
                    The interval shows its variation across bootstrap samples.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h6 className="text-sm font-bold text-slate-950">Bootstrap confidence</h6>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Percentage of with-replacement cell-bootstrap samples that
                    recover the edge among the strongest regulators for its
                    target. Older results are marked as legacy and require a
                    rerun. This measures sensitivity to sampled cells, not
                    uncertainty between biological donors or proof of causality.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h6 className="text-sm font-bold text-slate-950">Direction confidence & coverage</h6>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Agreement among direction-aware methods on arrow direction. Direction coverage shows how much total regulation evidence came from methods that can vote on direction.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h6 className="text-sm font-bold text-slate-950">Sign stability & coverage</h6>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Among bootstrap samples that recovered the edge with a
                    nonzero sign, sign stability is the percentage that agreed
                    with the displayed full-data activation or repression
                    (or the bootstrap-mean sign when the edge was absent from
                    the full-data fit).
                    Coverage shows how often recovered samples supplied a sign.
                    Unsigned methods abstain.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h6 className="text-sm font-bold text-slate-950">Method evidence</h6>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Full-data rank evidence from each supporting method. New
                    results include genuine with-replacement bootstrap recovery.
                  </p>
                </div>
              </div>
            </div>
          </div>,
          portalRoot
        )}
    </section>
  );
}
