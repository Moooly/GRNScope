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
import { isDenseNetwork } from "./networkGraphLayouts";
import CircosNetworkGraph from "./CircosNetworkGraph";
import NetworkHelpModal from "./NetworkHelpModal";
import NetworkLegend from "./NetworkLegend";
import NetworkInspector from "./NetworkInspector";
import {
  METRICS,
  edgeMetric,
  evidenceText,
  percent,
  relationshipLabel,
  signColor,
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
  edgeDisplayLimit: number;
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
    edgeDisplayLimit,
    selectedAlgorithmIds,
    scopeLabel,
    resultsControls,
  } = props;
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
  const displayMenuRef = useRef<HTMLDetailsElement>(null);
  const [networkZoom, setNetworkZoom] = useState(1);
  const [networkMinZoom, setNetworkMinZoom] = useState(MIN_NETWORK_ZOOM);
  const graphZoomHandlerRef = useRef<(() => void) | null>(null);
  const [showList, setShowList] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [workspaceHeight, setWorkspaceHeight] = useState(0);
  const workspaceRef = useRef<HTMLElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
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

  const limit =
    edgeDisplayLimit > 0 ? edgeDisplayLimit : filteredNetworkEdges.length;
  const edges = useMemo(
    () => filteredNetworkEdges.slice(0, limit),
    [filteredNetworkEdges, limit],
  );
  const nodes = useMemo(() => {
    const ids = new Set(edges.flatMap((e) => [e.source, e.target]));
    return networkNodes.filter((node) => ids.has(node.id));
  }, [edges, networkNodes]);
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
  const componentCount = useMemo(() => {
    const neighbors = new Map(nodes.map((n) => [n.id, [] as string[]]));
    edges.forEach((e) => {
      neighbors.get(e.source)?.push(e.target);
      neighbors.get(e.target)?.push(e.source);
    });
    const visited = new Set<string>();
    let count = 0;
    nodes.forEach((n) => {
      if (visited.has(n.id)) return;
      count++;
      const stack = [n.id];
      while (stack.length) {
        const id = stack.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        stack.push(
          ...(neighbors.get(id) ?? []).filter((next) => !visited.has(next)),
        );
      }
    });
    return count;
  }, [nodes, edges]);
  const selectGene = (id: string | null) => {
    if (id) setShowList(false);
    props.setSelectedGene(id);
    props.setSelectedEdgeKey(null);
  };
  const selectEdge = (id: string | null) => {
    if (id) setShowList(false);
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
  useEffect(() => {
    const closeDisplay = (event: PointerEvent | KeyboardEvent) => {
      const menu = displayMenuRef.current;
      if (!menu?.open) return;
      if (
        (event instanceof KeyboardEvent && event.key === "Escape") ||
        (event instanceof PointerEvent &&
          event.target instanceof Node &&
          !menu.contains(event.target))
      )
        menu.open = false;
    };
    document.addEventListener("pointerdown", closeDisplay);
    document.addEventListener("keydown", closeDisplay);
    return () => {
      document.removeEventListener("pointerdown", closeDisplay);
      document.removeEventListener("keydown", closeDisplay);
    };
  }, []);

  useEffect(() => {
    if (!expanded || !workspaceRef.current) return;
    const workspace = workspaceRef.current;
    const expandButton = expandButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Keep background controls out of the modal's keyboard navigation without
    // moving/remounting the graph or losing its settled positions.
    const background: Array<{ element: HTMLElement; inert: boolean }> = [];
    let branch: HTMLElement = workspace;
    while (branch.parentElement && branch !== document.body) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (
          sibling !== branch &&
          sibling instanceof HTMLElement &&
          !sibling.contains(
            document.querySelector(
              '[role="dialog"][aria-modal="true"]:not(.grn-expanded)',
            ),
          )
        ) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
    const onKey = (event: KeyboardEvent) => {
      const externalDialog = Array.from(
        document.querySelectorAll('[aria-modal="true"]'),
      ).some((el) => el !== workspace && !workspace.contains(el));
      if (externalDialog) return;
      if (event.key === "Escape") {
        if (workspace.querySelector('details[open], [role="dialog"]')) return;
        event.preventDefault();
        setExpanded(false);
      }
      if (event.key === "Tab") {
        const items = Array.from(
          workspace.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]',
          ),
        ).filter((el) => el.getClientRects().length && !el.closest("[inert]"));
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    expandButton?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      background.forEach(({ element, inert }) => {
        element.inert = inert;
      });
      expandButton?.focus({ preventScroll: true });
    };
  }, [expanded]);

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
    <div style={expanded ? { height: workspaceHeight } : undefined}>
      <section
        ref={workspaceRef}
        className={`network-atlas grn-atlas${expanded ? " grn-expanded" : ""}`}
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded || undefined}
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
              <details className="grn-display" ref={displayMenuRef}>
                <summary>Display ▾</summary>{" "}
                <div className="grn-display-options">
                  {networkLayout !== "circos" ? (
                    <>
                      <div className="grn-metric-switch">
                        <span>Line width</span>
                        {(Object.keys(METRICS) as NetworkMetric[]).map(
                          (key) => (
                            <button
                              key={key}
                              aria-pressed={metric === key}
                              disabled={
                                key === "confidence" && !hasVerifiedConfidence
                              }
                              aria-describedby={
                                key === "confidence" && !hasVerifiedConfidence
                                  ? "network-confidence-availability"
                                  : undefined
                              }
                              title={
                                key === "confidence" && !hasVerifiedConfidence
                                  ? "Verified bootstrap confidence unavailable for this result"
                                  : METRICS[key].description
                              }
                              onClick={() => setMetric(key)}
                            >
                              {METRICS[key].label}
                            </button>
                          ),
                        )}
                      </div>
                      {!hasVerifiedConfidence && (
                        <p
                          id="network-confidence-availability"
                          className="grn-confidence-notice"
                        >
                          Verified bootstrap confidence is unavailable for this
                          result. Use Evidence or Method support. Legacy
                          resampling scores are available in the inspector.
                        </p>
                      )}
                      <label className="grn-method-select">
                        <span>Highlight</span>
                        <select
                          aria-label="Highlight an algorithm"
                          value={effectiveHighlight ?? ""}
                          onChange={(event) =>
                            setHighlightedMethod(event.target.value || null)
                          }
                        >
                          <option value="">All methods</option>
                          {selectedAlgorithmIds.map((id) => (
                            <option key={id}>{id}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <p>Chromosome relationships · select a ribbon to explore</p>
                  )}
                  <button
                    aria-pressed={showEdgeLabels}
                    onClick={() => setShowEdgeLabels(!showEdgeLabels)}
                    disabled={networkLayout === "circos"}
                  >
                    Show edge values
                  </button>
                </div>
              </details>
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
                  <button
                    type="button"
                    className="grn-fit-button"
                    onClick={() => coreRef.current?.fit(undefined, 40)}
                    aria-label="Fit network to view"
                  >
                    Fit
                  </button>
                </div>
              )}
              <button
                ref={expandButtonRef}
                type="button"
                className="grn-expand-button"
                onClick={() => {
                  if (!expanded)
                    setWorkspaceHeight(
                      workspaceRef.current?.getBoundingClientRect().height ?? 0,
                    );
                  setExpanded(!expanded);
                }}
                aria-label={
                  expanded ? "Exit expanded network" : "Expand network"
                }
                aria-expanded={expanded}
              >
                {expanded ? "↙ Exit expanded" : "⤢ Expand"}
              </button>
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

        <div className="grn-scope-strip" aria-live="polite">
          <span>
            <b>{nodes.length}</b> genes ·{" "}
            <button
              className="grn-count-button"
              aria-expanded={showList}
              aria-label={`Browse ${edges.length} displayed relationships`}
              onClick={() => {
                clearSelection();
                setShowList(!showList);
              }}
            >
              <b>{edges.length}</b> of {filteredNetworkEdges.length} matching
              relationships
            </button>{" "}
            · {componentCount} connected{" "}
            {componentCount === 1 ? "group" : "groups"}
          </span>
          <span>
            {scopeLabel} ·{" "}
            {selectedAlgorithmIds.length > 1
              ? "Consensus network"
              : (selectedAlgorithmIds[0] ?? "Select a method")}
          </span>
        </div>
        {exportError && (
          <p className="grn-error" role="alert">
            {exportError}
          </p>
        )}
        <div
          className={`grn-stage${networkLayout === "circos" ? " grn-stage-circos" : ""}${selectedEdge || selectedVisibleNode ? " grn-stage-inspecting" : ""}`}
        >
          <div className="grn-graph-region">
            {!edges.length ? (
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
            ) : (
              <NetworkGraph
                nodes={nodes}
                edges={edges}
                layout={networkLayout}
                metric={metric}
                methodCount={selectedAlgorithmIds.length}
                highlightedMethod={effectiveHighlight}
                showEdgeLabels={showEdgeLabels}
                selectedGene={selectedVisibleNode?.id ?? null}
                selectedEdgeKey={selectedEdge?.key ?? null}
                onSelectGene={selectGene}
                onSelectEdge={selectEdge}
                onGraphReady={graphReady}
              />
            )}
            {edges.length > 0 && networkLayout !== "circos" && (
              <>
                <div className="grn-canvas-caption">
                  <span>
                    {isolatedGene
                      ? `${isolatedGene} neighborhood`
                      : networkLayout === "hierarchical"
                        ? "Regulatory flow"
                        : networkLayout === "force"
                          ? "Connected neighborhoods"
                          : networkLayout === "concentric"
                            ? "Regulatory hubs"
                            : "Circular network"}
                  </span>
                  <small>
                    {effectiveHighlight
                      ? `${effectiveHighlight} highlighted · consensus unchanged`
                      : isDenseNetwork(nodes.length, edges.length)
                        ? "Dense view · Select a gene to reveal signs & relationships"
                        : "Drag to explore · Scroll to zoom · Select to inspect"}
                  </small>
                </div>
              </>
            )}
            {showList && (
              <div className="grn-browse-panel">
                <header>
                  <strong>
                    Relationships <span>{edges.length}</span>
                  </strong>
                  <button
                    aria-label="Close relationship list"
                    onClick={() => setShowList(false)}
                  >
                    ×
                  </button>
                </header>
                <div className="grn-relationship-list">
                  {edges.map((edge) => (
                    <button
                      key={edge.key}
                      aria-pressed={edge.key === selectedEdgeKey}
                      onClick={() => selectEdge(edge.key)}
                    >
                      <strong>
                        <i style={{ background: signColor(edge.sign) }} />
                        {relationshipLabel(edge)}
                      </strong>
                      <small>
                        C{" "}
                        {percent(
                          edgeMetric(
                            edge,
                            "confidence",
                            selectedAlgorithmIds.length,
                          ),
                        )}{" "}
                        · E {evidenceText(edge.score)} · {edge.count}/
                        {selectedAlgorithmIds.length} methods
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
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
        </div>
        <NetworkLegend
          metric={metric}
          methodCount={selectedAlgorithmIds.length}
          circos={networkLayout === "circos"}
        />
        <div className="grn-atlas-note">
          <span>
            {networkLayout === "circos"
              ? "Chromosome overview"
              : `${!hasVerifiedConfidence && edges.length ? "Verified bootstrap confidence unavailable in this result. " : ""}${METRICS[metric].description}`}
          </span>
          <span>
            Connected groups describe topology, not biological modules.
          </span>
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
