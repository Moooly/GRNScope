"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Core } from "cytoscape";
import NetworkGraph, {
  MIN_NETWORK_ZOOM,
  MAX_NETWORK_ZOOM,
} from "./NetworkGraph";
import { DownloadIcon } from "./DownloadMenu";
import CircosNetworkGraph from "./CircosNetworkGraph";
import NetworkHelpModal from "./NetworkHelpModal";
import {
  NETWORK_APPEARANCES,
  resolveNetworkAppearance,
  type NetworkAppearance,
} from "./networkAppearance";
import NetworkLegend from "./NetworkLegend";
import { selectOpeningEdges } from "./networkOpeningView";
import NetworkCanvas from "./network/NetworkCanvas";
import NetworkLegendBar from "./network/Legend";
import NetworkInspectorPanel from "./network/Inspector";
import NetworkInspector from "./NetworkInspector";
import {
  edgeMetric,
  type NetworkMetric,
} from "./networkVisualEncoding";
import type { AggregatedEdge, NodeInfo } from "../_lib/types";
import type { NetworkFigureContext } from "./networkFigureExport";
import "./networkWorkspace.css";

type Layout = "force" | "hierarchical" | "concentric" | "circular" | "circos";
type Props = {
  networkLayout: Layout;
  setNetworkLayout: (layout: Layout) => void;
  onExportNetwork: (
    format: "png" | "svg",
    context: NetworkFigureContext,
  ) => void | Promise<void>;
  onExportCircosPng: (svg: SVGSVGElement) => void | Promise<void>;
  onGraphReady?: (cy: Core | null) => void;
  networkNodes: NodeInfo[];
  filteredNetworkEdges: AggregatedEdge[];
  selectedGene: string | null;
  selectedEdgeKey: string | null;
  setSelectedGene: (id: string | null) => void;
  setSelectedEdgeKey: (id: string | null) => void;
  selectedNode: NodeInfo | null;
  isolatedGene: string | null;
  setIsolatedGene: (id: string | null) => void;
  cellOracleReady: boolean;
  perturbationGenes: string[];
  onOpenPerturbation: (gene: string) => void;
  resultsControls?: ReactNode;
  selectedAlgorithmIds: string[];
  scopeLabel: string;
  filterChips?: ReactNode;
  filterSummary: string;
};

const layoutOptions = [
  {
    value: "force",
    label: "Force",
    title: "Explore components and regulatory neighborhoods",
  },
  {
    value: "hierarchical",
    label: "Hierarchical",
    title: "Arrange regulation in directional layers",
  },
  {
    value: "concentric",
    label: "Hubs",
    title: "Place high-degree regulators near the center",
  },
  {
    value: "circular",
    label: "Circular",
    title: "Arrange nodes around a circle",
  },
  {
    value: "circos",
    label: "Circos",
    title: "Explore regulatory flow between chromosomes",
  },
] as const;

const NETWORK_ZOOM_FACTOR = 1.2;

export default function NetworkVisualizationSection(props: Props) {
  const {
    networkLayout,
    setNetworkLayout,
    networkNodes,
    filteredNetworkEdges,
    selectedGene,
    selectedEdgeKey,
    selectedNode,
    isolatedGene,
    setIsolatedGene,
    selectedAlgorithmIds,
    scopeLabel,
    resultsControls,
  } = props;
  // Focused consensus is the default: it shows sign, method agreement,
  // evidence and connectivity at once, and NetworkGraph hands networks larger
  // than BRAID_MAX_NODES to the atlas automatically. `?style=` still overrides
  // it for evaluating the older styles without adding chrome to the toolbar.
  const [appearance, setAppearance] = useState<NetworkAppearance>("braid");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const requested = new URLSearchParams(window.location.search).get("style");
    if (requested && requested in NETWORK_APPEARANCES) {
      setAppearance(requested as NetworkAppearance);
    }
  }, []);
  // Resolve exactly as the canvas does, so the legend never describes a view
  // the user is not looking at.
  const activeAppearance =
    networkLayout === "circos"
      ? "classic"
      : resolveNetworkAppearance(appearance, networkNodes.length);
  const palette = NETWORK_APPEARANCES[activeAppearance];
  const [metricChoice, setMetric] = useState<NetworkMetric | null>(null);
  const hasVerifiedConfidence = filteredNetworkEdges.some(
    (edge) =>
      edgeMetric(edge, "confidence", selectedAlgorithmIds.length) !== null,
  );
  const metric =
    metricChoice === "confidence" && !hasVerifiedConfidence
      ? "evidence"
      : (metricChoice ?? (hasVerifiedConfidence ? "confidence" : "evidence"));
  const [highlightedMethod, setHighlightedMethod] = useState<string | null>(
    null,
  );
  const [isExportConfirmOpen, setIsExportConfirmOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [networkZoom, setNetworkZoom] = useState(1);
  const [networkMinZoom, setNetworkMinZoom] = useState(MIN_NETWORK_ZOOM);
  const graphZoomHandlerRef = useRef<(() => void) | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const coreRef = useRef<Core | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { onGraphReady } = props;
  const graphReady = useCallback(
    (graph: Core | null) => {
      const previousGraph = coreRef.current;
      const previousZoomHandler = graphZoomHandlerRef.current;

      if (previousGraph && previousZoomHandler && !previousGraph.destroyed()) {
        previousGraph.off("zoom", previousZoomHandler);
      }

      coreRef.current = graph;
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
    [onGraphReady],
  );

  const changeNetworkZoom = useCallback((factor: number) => {
    const graph = coreRef.current;
    if (!graph || graph.destroyed()) return;

    // Use the graph's live floor, which is relaxed for tall layouts, rather than
    // the static constant -- otherwise the button stops short of what fit allows.
    const nextZoom = Math.min(
      MAX_NETWORK_ZOOM,
      Math.max(graph.minZoom(), graph.zoom() * factor),
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

  // Results Settings decides which relationships are credible; the opening
  // view also decides how many can be read at once. Everything is one click
  // away, and the count below the legend says so rather than hiding the cut.
  const [showAllEdges, setShowAllEdges] = useState(false);
  // The rebuilt canvas is what the project page shows. The previous renderer
  // is still here, reachable with ?canvas=legacy, because the inspector,
  // Circos, figure export and the trajectory and perturbation views all reach
  // into it -- it comes out in one piece once nothing depends on it, not by
  // being deleted underneath them.
  const [useNewCanvas, setUseNewCanvas] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setUseNewCanvas(
      new URLSearchParams(window.location.search).get("canvas") !== "legacy",
    );
  }, []);
  const opening = useMemo(
    () =>
      selectOpeningEdges(
        filteredNetworkEdges,
        networkNodes.length,
        showAllEdges,
      ),
    [filteredNetworkEdges, networkNodes.length, showAllEdges],
  );
  const edges = opening.edges;
  const nodes = useMemo(
    () => networkNodes.filter((node) =>
      edges.some((edge) => edge.source === node.id || edge.target === node.id),
    ),
    [edges, networkNodes],
  );
  const selectedEdge =
    edges.find((edge) => edge.key === selectedEdgeKey) ?? null;
  const selectedVisibleNode =
    selectedNode && nodes.some((n) => n.id === selectedNode.id)
      ? selectedNode
      : null;
  const effectiveHighlight =
    highlightedMethod && selectedAlgorithmIds.includes(highlightedMethod)
      ? highlightedMethod
      : null;
  const selectGene = (id: string | null) => {
    props.setSelectedGene(id);
    props.setSelectedEdgeKey(null);
  };
  const selectEdge = (id: string | null) => {
    props.setSelectedEdgeKey(id);
    props.setSelectedGene(null);
  };
  const focus = (id: string) => {
    setIsolatedGene(id);
    setNetworkLayout("force");
    selectGene(id);
  };
  const clearSelection = () => {
    props.setSelectedGene(null);
    props.setSelectedEdgeKey(null);
  };
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

  const exportFigure = async (format: "png" | "svg") => {
    setExporting(true);
    setExportError("");
    try {
      if (networkLayout === "circos") {
        if (svgRef.current) await props.onExportCircosPng(svgRef.current);
      } else
        await props.onExportNetwork(format, {
          metric,
          // Resolved, not requested: an exported figure of a 100-gene network
          // is an atlas, and its legend has to say so.
          appearance: activeAppearance,
          methodCount: selectedAlgorithmIds.length,
          scope: scopeLabel,
          geneCount: nodes.length,
          edgeCount: edges.length,
          matchingEdges: filteredNetworkEdges.length,
          methods: selectedAlgorithmIds,
          filters: props.filterSummary,
          focus: isolatedGene,
          highlightedMethod: effectiveHighlight,
        });
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Could not export the network. Please try again.",
      );
    } finally {
      setExporting(false);
    }
  };
  return (
    <div>
      <section
        className="network-atlas grn-atlas"
        data-appearance={activeAppearance}
        style={
          {
            "--grn-network-bg": palette.background,
            "--grn-network-text": palette.text,
            "--grn-network-node": palette.node,
          } as import("react").CSSProperties
        }
        aria-label="Regulatory network workspace"
      >
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
                    setShowHelp(true);
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
                Click a node or edge to inspect it and explore the network in
                more detail.
              </p>
            </div>
            {resultsControls ? (
              <div className="network-atlas-controls shrink-0">
                {resultsControls}
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="grn-layout-picker inline-flex h-10 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-px"
                aria-label="Network layout"
              >
                {layoutOptions.map(({ value, label, title }) => {
                  const isActive = networkLayout === value;

                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setNetworkLayout(value)}
                      title={title}
                      aria-pressed={isActive}
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
                <div
                  className="inline-flex h-10 overflow-hidden rounded-full border border-slate-200 bg-white"
                  aria-label="Network zoom"
                >
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
                  disabled={exporting || !edges.length}
                  aria-label="Download current network"
                  aria-expanded={isExportConfirmOpen}
                  aria-haspopup="dialog"
                  title="Download current network"
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#1b75a6]/10"
                >
                  <DownloadIcon />
                  Download
                  <span
                    className={`text-[10px] transition-transform ${isExportConfirmOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  >
                    ▾
                  </span>
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
                          void exportFigure("svg");
                          closeExportConfirm();
                        }}
                        className="group flex w-full items-center justify-between gap-4 rounded-xl px-3 py-3 text-left transition hover:bg-[#f2f9fc]"
                      >
                        <span>
                          <span className="block text-sm font-bold text-slate-900">
                            Publication vector
                          </span>
                          <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                            Scalable atlas with a self-contained legend.
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-[#087ead]">
                          SVG
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        void exportFigure("png");
                        closeExportConfirm();
                      }}
                      className="group flex w-full items-center justify-between gap-4 rounded-xl px-3 py-3 text-left transition hover:bg-[#f2f9fc]"
                    >
                      <span>
                        <span className="block text-sm font-bold text-slate-900">
                          Presentation image
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                          High-resolution view with the current focus and
                          framing.
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-[#087ead]">
                        PNG
                      </span>
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

        {exportError && (
          <p className="grn-error" role="alert">
            {exportError}
          </p>
        )}
        {useNewCanvas ? (
          <NetworkLegendBar
            regulatorShare={
              nodes.length
                ? nodes.filter((n) => n.isTF).length / nodes.length
                : 0
            }
            hasSign={edges.some((e) => e.sign !== 0)}
            hasSelection={!!(selectedGene || selectedEdgeKey)}
          />
        ) : (
        <NetworkLegend
          appearance={activeAppearance}
          metric={metric}
          methodCount={selectedAlgorithmIds.length}
          circos={networkLayout === "circos"}
          onChangeMetric={setMetric}
          confidenceDisabled={!hasVerifiedConfidence}
        />
        )}
        {(opening.trimmed || showAllEdges) && (
          <p className="grn-view-provenance">
            {showAllEdges
              ? `Showing all ${opening.total.toLocaleString()} relationships.`
              : `Showing the ${opening.shown.toLocaleString()} strongest of ${opening.total.toLocaleString()} relationships \u2014 ranked by method agreement, then confidence.`}{" "}
            <button
              type="button"
              className="grn-view-provenance-action"
              onClick={() => setShowAllEdges(!showAllEdges)}
            >
              {showAllEdges ? "Show the strongest" : "Show all"}
            </button>
          </p>
        )}
        <div
          className={`grn-stage${networkLayout === "circos" ? " grn-stage-circos" : ""}${selectedEdge || selectedVisibleNode ? " grn-stage-inspecting" : ""}`}
        >
          <div className="grn-graph-region">
            {!nodes.length ? (
              <div className="grn-empty">
                <span>◎</span>
                <h3>No relationships in this view</h3>
                <p>
                  Choose a completed method or loosen the result filters to
                  explore its network.
                </p>
                {isolatedGene && (
                  <button onClick={() => setIsolatedGene(null)}>
                    Return to the atlas
                  </button>
                )}
              </div>
            ) : networkLayout === "circos" ? (
              <div className="grn-circos">
                <CircosNetworkGraph
                  nodes={nodes}
                  edges={edges}
                  selectedGene={selectedGene}
                  selectedEdgeKey={selectedEdgeKey}
                  onSelectGene={selectGene}
                  onSelectEdge={selectEdge}
                  svgRef={svgRef}
                />
              </div>
            ) : useNewCanvas ? (
              <NetworkCanvas
                nodes={nodes}
                edges={edges}
                selectedGene={selectedGene}
                selectedEdgeKey={selectedEdgeKey}
                layout={networkLayout}
                onSelectGene={selectGene}
                onSelectEdge={selectEdge}
                onGraphReady={graphReady}
              />
            ) : (
              <NetworkGraph
                nodes={nodes}
                edges={edges}
                layout={networkLayout}
                appearance={appearance}
                metric={metric}
                methodCount={selectedAlgorithmIds.length}
                highlightedMethod={effectiveHighlight}
                selectedGene={selectedVisibleNode?.id ?? null}
                selectedEdgeKey={selectedEdge?.key ?? null}
                onSelectGene={selectGene}
                onSelectEdge={selectEdge}
                onGraphReady={graphReady}
              />
            )}
          </div>
          {useNewCanvas ? (
            <NetworkInspectorPanel
              node={selectedVisibleNode}
              edge={selectedEdge}
              methodCount={selectedAlgorithmIds.length}
              onClose={clearSelection}
            />
          ) : (
          <NetworkInspector
            edge={selectedEdge}
            node={selectedVisibleNode}
            nodes={networkNodes}
            edges={edges}
            methods={selectedAlgorithmIds}
            highlightedMethod={effectiveHighlight}
            onHighlight={setHighlightedMethod}
            onSelectEdge={selectEdge}
            onSelectGene={selectGene}
            onFocus={focus}
            onClose={clearSelection}
            canPerturb={
              props.cellOracleReady &&
              !!selectedGene &&
              props.perturbationGenes.includes(selectedGene)
            }
            onPerturb={props.onOpenPerturbation}
          />
          )}
        </div>
        {showHelp && (
          <NetworkHelpModal
            onClose={() => setShowHelp(false)}
            isClosing={false}
          />
        )}
      </section>
    </div>
  );
}
