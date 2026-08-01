import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Core } from "cytoscape";
import NetworkGraph, {
  MAX_NETWORK_ZOOM,
  MIN_NETWORK_ZOOM,
} from "./NetworkGraph";
import CircosNetworkGraph from "./CircosNetworkGraph";
import EdgeCalculationGuide from "./EdgeCalculationGuide";
import {
  DOWNLOAD_BUTTON_CLASS,
  DownloadIcon,
} from "./DownloadMenu";
import { RESULT_SECTION_HEADING_CLASS } from "./sectionStyles";

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
  { value: "force", label: "Force", title: "Distribute nodes by connectivity" },
  { value: "hierarchical", label: "Hierarchical", title: "Arrange regulation in layers" },
  { value: "concentric", label: "Hubs", title: "Place high-degree regulators near the center" },
  { value: "circular", label: "Circular", title: "Arrange nodes around a circle" },
  { value: "circos", label: "Circos", title: "Arrange genes by genomic position" },
] as const;

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

  // Memoize the projections passed into NetworkGraph so identity stays stable
  // across renders that don't actually change the graph. NetworkGraph compares
  // these by reference to decide whether to rebuild the Cytoscape instance.
  const graphNodes = useMemo(
    () =>
      visualNodes.map((node) => ({
        id: node.id,
        inDegree: node.inDegree,
        outDegree: node.outDegree,
        degree: node.degree,
        isTF: node.isTF,
      })),
    [visualNodes]
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
        const handleZoom = () => setNetworkZoom(graph.zoom());
        graphZoomHandlerRef.current = handleZoom;
        graph.on("zoom", handleZoom);
        setNetworkZoom(graph.zoom());
      } else {
        setNetworkZoom(1);
      }

      onGraphReady?.(graph);
    },
    [onGraphReady]
  );

  const changeNetworkZoom = useCallback((factor: number) => {
    const graph = graphCoreRef.current;
    if (!graph || graph.destroyed()) return;

    const nextZoom = Math.min(
      MAX_NETWORK_ZOOM,
      Math.max(MIN_NETWORK_ZOOM, graph.zoom() * factor)
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

  return (
    <section className="text-slate-900">
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={RESULT_SECTION_HEADING_CLASS}>Network</h3>
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
          <p className="mt-2 text-sm leading-6 text-slate-600 lg:whitespace-nowrap">
            Click a node or edge to open its inspection panel and explore the network in more detail.
          </p>
        </div>
        {resultsControls ? (
          <div className="sticky top-[calc(var(--grnscope-header-height)+12px)] z-50 w-full self-start lg:w-auto">
            {resultsControls}
          </div>
        ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 lg:col-span-2">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-slate-200 bg-white p-1" aria-label="Network layout">
          {layoutOptions.map(({ value, label, title }) => {
            const isActive = networkLayout === value;

            return (
              <button
                key={value}
                type="button"
                onClick={() => setNetworkLayout(value)}
                title={title}
                className={`h-8 rounded-full px-3.5 text-xs font-semibold transition ${
                  isActive
                    ? "bg-[#1b75a6] text-white"
                    : "text-slate-600 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {networkLayout !== "circos" && (
            <div className="inline-flex h-10 overflow-hidden rounded-full border border-slate-200 bg-white" aria-label="Network zoom">
              <button
                type="button"
                onClick={() => changeNetworkZoom(1 / NETWORK_ZOOM_FACTOR)}
                disabled={networkZoom <= MIN_NETWORK_ZOOM + 0.001}
                className="inline-flex h-full w-10 items-center justify-center border-r border-slate-200 text-base font-bold text-slate-600 transition hover:bg-[#f2f9fc] hover:text-[#1b75a6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#1b75a6]/10 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-slate-600"
                aria-label="Zoom out network"
                title="Zoom out"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => changeNetworkZoom(NETWORK_ZOOM_FACTOR)}
                disabled={networkZoom >= MAX_NETWORK_ZOOM - 0.001}
                className="inline-flex h-full w-10 items-center justify-center text-base font-bold text-slate-600 transition hover:bg-[#f2f9fc] hover:text-[#1b75a6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#1b75a6]/10 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-slate-600"
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
              className={DOWNLOAD_BUTTON_CLASS}
            >
              <DownloadIcon />
              Download
              <svg
                viewBox="0 0 16 16"
                className={`h-3.5 w-3.5 transition-transform ${
                  isExportConfirmOpen ? "rotate-180" : ""
                }`}
                fill="none"
                aria-hidden="true"
              >
                <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          {isExportConfirmOpen && (
            <>
              <div
                className="absolute right-0 top-[calc(100%+0.75rem)] z-40 w-[min(22rem,calc(100vw-3rem))] text-slate-900"
                role="dialog"
                aria-modal="false"
                aria-label="Download current network"
              >
                <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/20">
                  <div className="p-2">
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
                          <span className="block text-sm font-bold text-slate-950 group-hover:text-[#1b75a6]">
                            Vector image
                          </span>
                          <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                            Scalable network with the current layout and node positions.
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                          SVG
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (networkLayout === "circos") {
                          if (circosSvgRef.current) {
                            void Promise.resolve(onExportCircosPng(circosSvgRef.current)).catch(
                              () => undefined
                            );
                          }
                        } else {
                          onExportNetwork("png");
                        }
                        closeExportConfirm();
                      }}
                      className="group flex w-full items-center justify-between gap-4 rounded-xl px-3 py-3 text-left transition hover:bg-[#f2f9fc]"
                    >
                      <span>
                        <span className="block text-sm font-bold text-slate-950 group-hover:text-[#1b75a6]">
                          Raster image
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                          {networkLayout === "circos"
                            ? "Current filtered Circos view as a ready-to-use image."
                            : "Current canvas view, including zoom and any isolated sub-network."}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                        PNG
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
          </div>
        </div>
      </div>

      <div className="relative -mt-1 lg:col-span-2">
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
            className="animate-inspector-panel absolute inset-x-4 bottom-4 z-30 max-h-[70%] min-w-0 overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-slate-50/95 p-5 shadow-2xl shadow-slate-900/20 backdrop-blur-sm xl:bottom-4 xl:left-auto xl:right-4 xl:top-4 xl:max-h-none xl:w-[25rem]"
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
      </div>
      {portalRoot &&
        isVisualGuideOpen &&
        createPortal(
          <div
            className={`fixed inset-0 z-[9999] flex min-h-screen items-center justify-center bg-slate-950/30 px-4 py-8 backdrop-blur-[2px] ${
              isVisualGuideClosing
                ? "animate-modal-overlay-out"
                : "animate-modal-overlay"
            }`}
            onClick={closeVisualGuide}
            role="presentation"
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="network-visual-guide-title"
              aria-describedby="network-visual-guide-summary"
              className={`flex max-h-[min(800px,calc(100vh-4rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white text-slate-900 shadow-2xl ${
                isVisualGuideClosing
                  ? "animate-modal-panel-out"
                  : "animate-modal-panel"
              }`}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-start justify-between gap-5 border-b border-slate-100 px-6 py-5">
                <div>
                  <h3
                    id="network-visual-guide-title"
                    className="text-lg font-extrabold tracking-tight text-slate-950"
                  >
                    Understanding the network
                  </h3>
                  <p
                    id="network-visual-guide-summary"
                    className="mt-1 text-sm leading-5 text-slate-500"
                  >
                    How genes, regulations, evidence, confidence, and controls
                    work together.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeVisualGuide}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 transition hover:border-[#087ead]/30 hover:bg-[#f2f9fc] hover:text-[#087ead] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087ead]/30"
                  aria-label="Close visual guide"
                >
                  ×
                </button>
              </header>

              <div className="overflow-y-auto px-6 py-5 text-sm leading-6 text-slate-600">
                <section>
                  <h4 className="font-extrabold text-slate-900">
                    What is currently drawn
                  </h4>
                  <p className="mt-2">
                    Results Settings first selects the result scope and methods,
                    then applies minimum evidence, bootstrap confidence,
                    direction confidence, sign stability, and—when comparing
                    methods—minimum support. Search keeps regulations whose
                    source or target matches the gene name.
                  </p>
                  <p className="mt-2">
                    The graph draws the first requested number of matching edges
                    in saved rank order and only the genes connected by those
                    edges. Isolating a gene keeps its directly incident edges;
                    it does not recalculate evidence or rank.
                  </p>
                </section>

                <section className="mt-5 border-t border-slate-100 pt-5">
                  <h4 className="font-extrabold text-slate-900">
                    Visual language
                  </h4>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <span className="h-6 w-6 shrink-0 rotate-45 rounded-[4px] bg-slate-700" />
                      <span>
                        <strong className="block text-slate-800">
                          Transcription factor
                        </strong>
                        <span className="text-xs text-slate-500">
                          diamond-shaped regulator
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <span className="h-7 w-7 shrink-0 rounded-full bg-slate-700" />
                      <span>
                        <strong className="block text-slate-800">Other gene</strong>
                        <span className="text-xs text-slate-500">
                          circular target or regulator
                        </span>
                      </span>
                    </div>
                    <div className="grid grid-cols-[4rem_1fr] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <svg viewBox="0 0 56 18" aria-hidden="true" className="h-5 w-14">
                        <path d="M2 9H39" stroke="#64748b" strokeWidth="2.4" strokeLinecap="round" />
                        <path d="M39 3L53 9L39 15Z" fill="#64748b" />
                      </svg>
                      <span>
                        <strong className="block text-slate-800">Activation</strong>
                        <span className="text-xs text-slate-500">
                          arrow points to the regulated gene
                        </span>
                      </span>
                    </div>
                    <div className="grid grid-cols-[4rem_1fr] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <svg viewBox="0 0 56 18" aria-hidden="true" className="h-5 w-14">
                        <path d="M2 9H44" stroke="#64748b" strokeWidth="2.4" strokeLinecap="round" />
                        <path d="M44 3V15" stroke="#64748b" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      <span>
                        <strong className="block text-slate-800">Repression</strong>
                        <span className="text-xs text-slate-500">
                          bar marks inhibitory regulation
                        </span>
                      </span>
                    </div>
                    <div className="grid grid-cols-[4rem_1fr] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <svg viewBox="0 0 56 18" aria-hidden="true" className="h-5 w-14">
                        <path d="M2 9H50" stroke="#64748b" strokeWidth="2.4" strokeLinecap="round" />
                      </svg>
                      <span>
                        <strong className="block text-slate-800">
                          Unannotated line
                        </strong>
                        <span className="text-xs text-slate-500">
                          direction or sign is unavailable
                        </span>
                      </span>
                    </div>
                    <div className="grid grid-cols-[4rem_1fr] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <span className="flex flex-col gap-1.5">
                        <span className="h-px w-12 rounded-full bg-slate-500" />
                        <span className="h-1.5 w-12 rounded-full bg-slate-500" />
                      </span>
                      <span>
                        <strong className="block text-slate-800">
                          Relative evidence
                        </strong>
                        <span className="text-xs text-slate-500">
                          thicker means stronger among visible edges
                        </span>
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Thickness is scaled from the lowest to highest evidence in
                    the current visible set; compare the numeric values when
                    switching filters. Reciprocal regulations curve apart, and
                    the selected edge and its endpoints are highlighted blue.
                  </p>
                </section>

                <section className="mt-5 border-t border-slate-100 pt-5">
                  <h4 className="font-extrabold text-slate-900">
                    Edge metrics
                  </h4>
                  <dl className="mt-2 space-y-3">
                    <div>
                      <dt className="font-bold text-slate-800">
                        Regulation evidence
                      </dt>
                      <dd>
                        A normalized 0–1 full-data score. For one method it is
                        the saved per-target rank evidence. With multiple
                        methods it is the mean normalized evidence across every
                        selected method, including 0 for methods without the
                        edge. A 95% interval appears when bootstrap evidence
                        bounds are available.
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold text-slate-800">
                        Rank and bootstrap confidence
                      </dt>
                      <dd>
                        Rank is assigned by bootstrap confidence and then
                        evidence. For one method, confidence is the share of
                        with-replacement cell-bootstrap samples that recover the
                        edge; for a consensus it is the median recovery among
                        supporting methods. Legacy scores predate genuine cell
                        bootstrapping and require a rerun.
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold text-slate-800">
                        Direction confidence and coverage
                      </dt>
                      <dd>
                        Confidence is the absolute forward-versus-reverse
                        evidence margin divided by all direction-aware evidence.
                        Low values mean a split, not that the reverse is correct.
                        Coverage is the share of total edge evidence supplied by
                        methods capable of voting on direction.
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold text-slate-800">
                        Sign stability and coverage
                      </dt>
                      <dd>
                        Activation or repression follows the evidence-weighted
                        signed vote. Stability is the share of signed bootstrap
                        recoveries agreeing with that displayed sign; coverage
                        is how often recovered samples supplied a nonzero sign.
                        Unsigned methods abstain.
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold text-slate-800">
                        Support and method evidence
                      </dt>
                      <dd>
                        Support counts selected methods reporting the edge. The
                        inspection panel lists each supporting method&apos;s
                        normalized full-data evidence so the consensus can be
                        audited.
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    These values measure agreement and sensitivity to sampled
                    cells. They are not probabilities of biological causality.
                  </p>
                </section>

                <EdgeCalculationGuide />

                <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="font-extrabold text-slate-900">Brief example</h4>
                  <p className="mt-2">
                    With five selected methods, suppose A → B has evidence
                    0.90, 0.80, 0.70, 0, and 0. Consensus evidence is 0.48 and
                    support is 3/5. If the three supporting methods recover it
                    in 90%, 80%, and 70% of bootstrap samples, consensus
                    confidence is the median: 80%.
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    If direction-aware evidence is 1.6 forward and 0.4 reverse,
                    direction confidence is |1.6 − 0.4| ÷ 2.0 = 60%. The graph
                    leans A → B, but that 60% is an evidence margin rather than
                    a probability.
                  </p>
                </section>

                <section className="mt-5 rounded-xl border border-[#cfe5ee] bg-[#f2f9fc] p-4">
                  <h4 className="font-extrabold text-slate-900">
                    Inspecting and navigating
                  </h4>
                  <p className="mt-2">
                    Hover an edge for a quick metric summary. Select an edge for
                    its full evidence panel, or select a node for its type,
                    incoming-regulator count, outgoing-target count, top
                    neighbors, sub-network isolation, and CellOracle
                    perturbation when available. Select empty canvas space to
                    close the inspection panel.
                  </p>
                  <p className="mt-2">
                    Force groups connected genes; Hierarchical places
                    regulation in layers; Hubs centers high-degree regulators;
                    Circular arranges genes on rings; and Circos uses genomic
                    position when available. You can pan, zoom, and drag nodes.
                    SVG preserves the current layout and node positions; PNG
                    captures the current canvas, zoom, and isolated view.
                  </p>
                </section>
              </div>
            </section>
          </div>,
          portalRoot
        )}
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
