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
import { openingEdgeBudget, selectOpeningEdges } from "./networkOpeningView";
import NetworkCanvas, { fitNetwork } from "./network/NetworkCanvas";
import { NetworkKey, NetworkLinkFilter } from "./network/Legend";
import { DEFAULT_PALETTE, PALETTE_LABELS, type PaletteName } from "./network/theme";
import { NODE_SIZE_OPTIONS, figureCounts, passesEffect, type EdgeWidthBy, type EffectFilter, type NodeSizeBy } from "./network/encoding";
import { nodeDegrees } from "./network/model";
import { NetworkViewCountsProvider, type NetworkViewCounts } from "./networkViewCounts";
import NetworkInspectorPanel from "./network/Inspector";
import NetworkInspector from "./NetworkInspector";
import {
  edgeMetric,
  hasDirection,
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
    title: "Explore hubs, branches and connections",
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
  // view also decides how many can be read at once. Neither cut is hidden: the
  // live count inside Results Settings reports what the filters produced, and
  // the canvas caption carries the trimmed total for readers who never open
  // the panel.
  // The complete network (every relationship passing Results Settings) is the
  // only view; the old trimmed "Overview" has been retired.
  const [showAllEdges, setShowAllEdges] = useState(true);
  const [sizeBy, setSizeBy] = useState<NodeSizeBy>("all");
  const [widthBy, setWidthBy] = useState<EdgeWidthBy>("evidence");
  const [effect, setEffect] = useState<EffectFilter>("all");
  // Display menu: occasional adjustments, out of the way until needed.
  const [spacing, setSpacing] = useState(100);
  // Temporary: both palettes stay available until the boss chooses.
  const [figurePalette, setFigurePalette] = useState<PaletteName>(DEFAULT_PALETTE);
  const [layoutNonce, setLayoutNonce] = useState(0);
  const [displayOpen, setDisplayOpen] = useState(false);
  const displayMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!displayOpen) return;
    const close = (event: MouseEvent) => { if (!displayMenuRef.current?.contains(event.target as Node)) setDisplayOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setDisplayOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [displayOpen]);
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
        showAllEdges || Boolean(isolatedGene),
      ),
    [filteredNetworkEdges, networkNodes.length, showAllEdges, isolatedGene],
  );
  const edges = opening.edges;
  // Rebuilt only when a number actually moves, so opening or closing the panel
  // cannot make the readout animate a change that did not happen.
  const viewCounts = useMemo<NetworkViewCounts>(
    () => ({
      shown: opening.shown,
      total: opening.total,
      trimmed: opening.trimmed,
      showAll: showAllEdges,
      canShowAll: opening.total > openingEdgeBudget(networkNodes.length),
      onToggleShowAll: () => setShowAllEdges((current) => !current),
    }),
    [opening.shown, opening.total, opening.trimmed, showAllEdges, networkNodes.length],
  );
  const nodes = useMemo(
    () => networkNodes.filter((node) =>
      edges.some((edge) => edge.source === node.id || edge.target === node.id),
    ),
    [edges, networkNodes],
  );
  const effectiveSizeBy: NodeSizeBy = edges.some((e) => hasDirection(e)) ? sizeBy : "all";
  const hasUnsignedLinks = edges.some((e) => e.sign === 0);
  const effectiveEffect: EffectFilter = effect === "unknown" && !hasUnsignedLinks ? "all" : effect;
  const visibleEdges = useMemo(() => edges.filter((e) => passesEffect(e.sign, effectiveEffect)), [edges, effectiveEffect]);
  const figureKeyCounts = useMemo(() => {
    const degrees = nodeDegrees(edges)[effectiveSizeBy];
    const effectiveWidth: EdgeWidthBy = selectedAlgorithmIds.length > 1 ? widthBy : "evidence";
    return figureCounts(visibleEdges, effectiveWidth, selectedAlgorithmIds.length, nodes.map((node) => degrees.get(node.id) ?? 0));
  }, [edges, visibleEdges, nodes, effectiveSizeBy, widthBy, selectedAlgorithmIds.length]);
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
          metric: useNewCanvas ? "evidence" : metric,
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
          selectionRule: isolatedGene ? "All matching direct relationships of the focused gene" : opening.trimmed ? `Overview: top ${opening.shown} by method support, then verified bootstrap confidence or evidence` : "All relationships passing the selected filters",
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
                  {useNewCanvas && networkLayout !== "circos" ? "Regulatory network" : "Regulatory atlas"}
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
                <NetworkViewCountsProvider value={viewCounts}>
                  {resultsControls}
                </NetworkViewCountsProvider>
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
              {useNewCanvas && networkLayout !== "circos" && (
                <div ref={displayMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setDisplayOpen((open) => !open)}
                    aria-expanded={displayOpen}
                    aria-haspopup="dialog"
                    className="inline-flex h-10 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                  >
                    Display <span aria-hidden="true">▾</span>
                  </button>
                  {displayOpen && (
                    <div className="display-menu" role="dialog" aria-label="Display options">
                      <label>Node size
                        <select value={effectiveSizeBy} onChange={(event) => setSizeBy(event.target.value as NodeSizeBy)} title={NODE_SIZE_OPTIONS[effectiveSizeBy].help}>
                          {(Object.keys(NODE_SIZE_OPTIONS) as NodeSizeBy[]).map((key) => (
                            <option key={key} value={key} disabled={key !== "all" && !edges.some((e) => hasDirection(e))}>{NODE_SIZE_OPTIONS[key].label}</option>
                          ))}
                        </select>
                      </label>
                      <label>Line width
                        <select value={selectedAlgorithmIds.length > 1 ? widthBy : "evidence"} onChange={(event) => setWidthBy(event.target.value as EdgeWidthBy)}>
                          <option value="evidence">Evidence</option>
                          <option value="support" disabled={selectedAlgorithmIds.length <= 1}>Method support</option>
                        </select>
                      </label>
                      <label>Palette
                        <select value={figurePalette} onChange={(event) => setFigurePalette(event.target.value as PaletteName)} title="Colour palette (temporary, while the two are compared)">
                          {(Object.keys(PALETTE_LABELS) as PaletteName[]).map((key) => <option key={key} value={key}>{PALETTE_LABELS[key]}</option>)}
                        </select>
                      </label>
                      <label>Spacing
                        <span className="display-range">
                          <input type="range" min="100" max="250" step="25" value={spacing} onChange={(event) => setSpacing(Number(event.target.value))} aria-label="Network spacing" />
                          <output>{spacing}%</output>
                        </span>
                      </label>
                      <button type="button" className="display-link" onClick={() => { setLayoutNonce((n) => n + 1); setDisplayOpen(false); }} title="Recompute the arrangement, e.g. after dragging genes">Reset layout</button>
                    </div>
                  )}
                </div>
              )}
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
                  {useNewCanvas && (
                    <button
                      type="button"
                      onClick={() => { const graph = coreRef.current; if (graph && !graph.destroyed()) fitNetwork(graph); }}
                      className="inline-flex h-full w-10 items-center justify-center border-l border-slate-200 text-slate-600 transition hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                      aria-label="Fit network to view"
                      title="Fit view"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
                    </button>
                  )}
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
                            Complete displayed network with labels and a figure legend.
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
                          High-resolution figure with the same layout and legend.
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
        {useNewCanvas && networkLayout !== "circos" ? (
          <NetworkLinkFilter
            relationships={edges.length}
            signCounts={{
              activation: edges.filter((e) => e.sign === 1).length,
              repression: edges.filter((e) => e.sign === -1).length,
              unknown: edges.filter((e) => e.sign === 0).length,
            }}
            effect={effectiveEffect}
            onEffectChange={setEffect}
            palette={figurePalette}
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
                totalRelationships={opening.total}
                methodCount={selectedAlgorithmIds.length}
                sizeBy={sizeBy}
                widthBy={selectedAlgorithmIds.length > 1 ? widthBy : "evidence"}
                onSizeByChange={setSizeBy}
                onWidthByChange={setWidthBy}
                effect={effectiveEffect}
                spacing={spacing}
                layoutNonce={layoutNonce}
                palette={figurePalette}
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
              onFocus={id => { focus(id); clearSelection(); }}
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
        {useNewCanvas && networkLayout !== "circos" && nodes.length > 0 && (
          <NetworkKey
            directionSplit={edges.some((e) => hasDirection(e))}
            hasUndirected={edges.some((e) => !hasDirection(e))}
            widthBy={selectedAlgorithmIds.length > 1 ? widthBy : "evidence"}
            methodCount={selectedAlgorithmIds.length}
            counts={figureKeyCounts}
            palette={figurePalette}
          />
        )}
        {showHelp && (
          <NetworkHelpModal
            galaxy={useNewCanvas && networkLayout !== "circos"}
            onClose={() => setShowHelp(false)}
            isClosing={false}
          />
        )}
      </section>
    </div>
  );
}
