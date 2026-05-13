import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import NetworkGraph from "./NetworkGraph";
import CircosNetworkGraph from "./CircosNetworkGraph";

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
  count: number;
  rank: number;
  perAlgorithmScores: Record<string, number>;
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
  selectedView: string;
  networkLayout: "force" | "hierarchical" | "concentric" | "circular" | "circos";
  setNetworkLayout: (value: "force" | "hierarchical" | "concentric" | "circular" | "circos") => void;
  onExportNetwork: (format: "png" | "svg") => void;
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
};

const layoutOptions = [
  { value: "force", label: "Force" },
  { value: "hierarchical", label: "Hierarchical" },
  { value: "concentric", label: "Concentric" },
  { value: "circular", label: "Circular" },
  { value: "circos", label: "Circos" },
] as const;

export default function NetworkVisualizationSection({
  selectedView,
  networkLayout,
  setNetworkLayout,
  onExportNetwork,
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
}: NetworkVisualizationSectionProps) {
  const [isExportConfirmOpen, setIsExportConfirmOpen] = useState(false);
  const [isExportConfirmClosing, setIsExportConfirmClosing] = useState(false);
  const [isVisualGuideOpen, setIsVisualGuideOpen] = useState(false);
  const [isVisualGuideClosing, setIsVisualGuideClosing] = useState(false);
  const [isInspectionGuideOpen, setIsInspectionGuideOpen] = useState(false);
  const [isInspectionGuideClosing, setIsInspectionGuideClosing] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Memoize the projections passed into NetworkGraph so identity stays stable
  // across renders that don't actually change the graph. NetworkGraph compares
  // these by reference to decide whether to rebuild the Cytoscape instance.
  const graphNodes = useMemo(
    () =>
      networkNodes.map((node) => ({
        id: node.id,
        inDegree: node.inDegree,
        outDegree: node.outDegree,
        degree: node.degree,
        isTF: node.isTF,
      })),
    [networkNodes]
  );

  const graphEdges = useMemo(
    () =>
      filteredNetworkEdges.map((edge) => ({
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
    [filteredNetworkEdges]
  );

  const selectedEdge =
    filteredNetworkEdges.find((edge) => edge.key === selectedEdgeKey) ?? null;

  const closeExportConfirm = () => {
    setIsExportConfirmClosing(true);
    window.setTimeout(() => {
      setIsExportConfirmOpen(false);
      setIsExportConfirmClosing(false);
    }, 480);
  };

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

  return (
    <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-white p-5 text-slate-900 shadow-sm">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-bold text-slate-950">Network Visualization</h3>
        <button
          type="button"
          onClick={() => {
            setIsVisualGuideClosing(false);
            setIsVisualGuideOpen(true);
          }}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] text-xs font-bold text-[#1b75a6] transition hover:border-[#1b75a6]/35 hover:bg-[#e8f5fb]"
          aria-label="Open network visual guide"
          title="Open network visual guide"
        >
          ?
        </button>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_0.75fr] xl:items-start">
        <div className="relative min-w-0 overflow-hidden rounded-[1.5rem] border border-slate-200 bg-[#f3f4f6] shadow-sm">
          <div className="pointer-events-none absolute inset-x-4 top-4 z-20 flex items-center justify-between gap-3">
            <div className="pointer-events-auto inline-flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 p-1 shadow-sm backdrop-blur">
              {layoutOptions.map(({ value, label }) => {
                const isActive = networkLayout === value;

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setNetworkLayout(value)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                      isActive
                        ? "bg-[#1b75a6] text-white shadow-sm"
                        : "text-slate-600 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="pointer-events-auto relative -top-px inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 p-1 shadow-sm backdrop-blur">
              <button
                type="button"
                onClick={() => {
                  if (networkLayout === "circos") return;
                  setIsExportConfirmClosing(false);
                  setIsExportConfirmOpen(true);
                }}
                disabled={networkLayout === "circos"}
                aria-label="Download current network"
                title={networkLayout === "circos" ? "Download is not available for Circos view yet" : "Download current network"}
                className={`rounded-xl px-4 py-1.5 text-xs font-bold transition ${
                  networkLayout === "circos"
                    ? "cursor-not-allowed text-slate-400"
                    : "text-slate-600 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                }`}
              >
                Download
              </button>
            </div>
          </div>
          {networkLayout === "circos" ? (
            <CircosNetworkGraph
              nodes={networkNodes}
              edges={filteredNetworkEdges}
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
              onGraphReady={onGraphReady}
            />
          )}

        </div>

        <div className="min-w-0 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h4 className="text-base font-bold text-slate-950">
                {selectedEdge ? "Edge Inspection" : "Node Inspection"}
              </h4>
              {selectedEdge && (
                <button
                  type="button"
                  onClick={() => {
                    setIsInspectionGuideClosing(false);
                    setIsInspectionGuideOpen(true);
                  }}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] text-xs font-bold text-[#1b75a6] transition hover:border-[#1b75a6]/35 hover:bg-[#e8f5fb]"
                  aria-label="Open edge inspection guide"
                  title="Open edge inspection guide"
                >
                  ?
                </button>
              )}
            </div>
            {selectedNode && !selectedEdge && (
              <button
                type="button"
                onClick={() => {
                  setSelectedGene(null);
                  setSelectedEdgeKey(null);
                }}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-600 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
              >
                Clear
              </button>
            )}
          </div>

          {selectedEdge ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#1b75a6]">
                    Selected edge
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
                      ? "Activating"
                      : selectedEdge.sign < 0
                        ? "Repressing"
                      : "Unknown"}
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
                    Edge evidence
                  </p>
                  <p className="mt-2 text-2xl font-bold text-slate-950">
                    {selectedEdge.score.toFixed(3)}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    rank #{selectedEdge.rank}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    Supporting methods
                  </p>
                  <p className="mt-2 text-2xl font-bold text-slate-950">
                    {selectedEdge.count}
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
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    Sign confidence
                  </p>
                  <p className="mt-2 text-2xl font-bold text-slate-950">
                    {selectedEdge.signConfidence === null
                      ? "-"
                      : `${Math.round(selectedEdge.signConfidence * 100)}%`}
                  </p>
                </div>
              </div>

              <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#1b75a6]">
                    Method evidence
                  </p>
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
                      No selected method recovered this edge in its repeated confidence runs.
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
          ) : (
            <div className="mt-4 rounded-[1.25rem] border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">
              Click a node to inspect gene details, or click an edge to inspect evidence, confidence, sign, and supporting algorithms.
            </div>
          )}
        </div>
      </div>
      {isMounted &&
        isVisualGuideOpen &&
        createPortal(
          <div
            className={`fixed inset-0 z-[9999] flex min-h-screen items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm ${
              isVisualGuideClosing
                ? "animate-modal-overlay-out"
                : "animate-modal-overlay"
            }`}
            onClick={closeVisualGuide}
          >
            <div
              className={`w-full max-w-lg rounded-[1.5rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 ${
                isVisualGuideClosing
                  ? "animate-modal-panel-out"
                  : "animate-modal-panel"
              }`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#1b75a6]">
                    Visual guide
                  </p>
                  <h5 className="mt-2 text-lg font-bold text-slate-950">
                    How to read network edges
                  </h5>
                </div>
                <button
                  type="button"
                  onClick={closeVisualGuide}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-bold text-slate-500 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                  aria-label="Close visual guide"
                >
                  ×
                </button>
              </div>

              <div className="mt-5 space-y-5">
                <div>
                  <h6 className="text-sm font-bold text-slate-950">Relationship head</h6>
                  <div className="mt-3 grid gap-2">
                    <div className="grid grid-cols-[4rem_1fr] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <span className="inline-flex h-5 w-14 items-center">
                        <svg viewBox="0 0 56 18" aria-hidden="true" className="h-5 w-14">
                          <path d="M2 9H39" stroke="#64748b" strokeWidth="2.4" strokeLinecap="round" />
                          <path d="M39 3L53 9L39 15Z" fill="#64748b" />
                        </svg>
                      </span>
                      <span className="leading-5">
                        <span className="block text-sm font-semibold text-slate-800">Activation</span>
                        <span className="block text-xs text-slate-500">arrowhead points to the regulated gene</span>
                      </span>
                    </div>
                    <div className="grid grid-cols-[4rem_1fr] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <span className="inline-flex h-5 w-14 items-center">
                        <svg viewBox="0 0 56 18" aria-hidden="true" className="h-5 w-14">
                          <path d="M2 9H44" stroke="#64748b" strokeWidth="2.4" strokeLinecap="round" />
                          <path d="M44 3V15" stroke="#64748b" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                      </span>
                      <span className="leading-5">
                        <span className="block text-sm font-semibold text-slate-800">Repression</span>
                        <span className="block text-xs text-slate-500">bar head marks inhibitory regulation</span>
                      </span>
                    </div>
                    <div className="grid grid-cols-[4rem_1fr] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <span className="inline-flex h-5 w-14 items-center">
                        <svg viewBox="0 0 56 18" aria-hidden="true" className="h-5 w-14">
                          <path d="M2 9H50" stroke="#64748b" strokeWidth="2.4" strokeLinecap="round" />
                        </svg>
                      </span>
                      <span className="leading-5">
                        <span className="block text-sm font-semibold text-slate-800">Unannotated</span>
                        <span className="block text-xs text-slate-500">no supported sign or direction annotation</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <h6 className="text-sm font-bold text-slate-950">Thickness</h6>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="grid grid-cols-[4rem_1fr] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <span className="h-px w-12 rounded-full bg-slate-500" />
                      <span className="text-sm font-semibold text-slate-800">Low evidence</span>
                    </div>
                    <div className="grid grid-cols-[4rem_1fr] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <span className="h-1.5 w-12 rounded-full bg-slate-500" />
                      <span className="text-sm font-semibold text-slate-800">High evidence</span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>,
          document.body
        )}
      {isMounted &&
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
                  <h6 className="text-sm font-bold text-slate-950">Edge evidence</h6>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Mean per-target percentile rank from the repeated runs. Higher values mean the regulator is ranked closer to the top for this target gene.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h6 className="text-sm font-bold text-slate-950">Direction confidence</h6>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    How confident the app is about which gene regulates the other. Higher confidence means direction-aware methods agree on the arrow direction.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h6 className="text-sm font-bold text-slate-950">Sign confidence</h6>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    How confident the app is about activation versus repression. Higher confidence means signed methods agree on the relationship type.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h6 className="text-sm font-bold text-slate-950">Method evidence</h6>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Per-method confidence after repeated runs. Methods listed as supporting recovered this edge with nonzero stability.
                  </p>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
      {isMounted &&
        isExportConfirmOpen &&
        createPortal(
          <div
            className={`fixed inset-0 z-[9999] flex min-h-screen items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm ${
              isExportConfirmClosing
                ? "animate-modal-overlay-out"
                : "animate-modal-overlay"
            }`}
          >
            <div
              className={`w-full max-w-md rounded-[1.5rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 ${
                isExportConfirmClosing
                  ? "animate-modal-panel-out"
                  : "animate-modal-panel"
              }`}
            >
              <div>
                <h5 className="text-lg font-bold text-slate-950">Export current network?</h5>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Download exactly what is currently shown on the canvas, including the current zoom level, node positions, and any isolated sub-network. Choose PNG or SVG below.
                </p>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeExportConfirm}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onExportNetwork("svg");
                    closeExportConfirm();
                  }}
                  className="rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] px-4 py-2.5 text-sm font-bold text-[#1b75a6] transition hover:border-[#1b75a6]/35 hover:bg-[#e8f5fb]"
                >
                  Download SVG
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onExportNetwork("png");
                    closeExportConfirm();
                  }}
                  className="rounded-full bg-[#1b75a6] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#155f87]"
                >
                  Download PNG
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
