import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import NetworkGraph from "./NetworkGraph";

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
  count: number;
  rank: number;
  perAlgorithmScores: Record<string, number>;
  supportingAlgorithms: string[];
};

type NetworkVisualizationSectionProps = {
  selectedView: string;
  networkLayout: "force" | "hierarchical" | "concentric" | "circular";
  setNetworkLayout: (value: "force" | "hierarchical" | "concentric" | "circular") => void;
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
        count: edge.count,
        rank: edge.rank,
        supportingAlgorithms: edge.supportingAlgorithms,
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

  return (
    <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-white p-5 text-slate-900 shadow-sm">
      <div>
        <h3 className="text-lg font-bold text-slate-950">Network Visualization</h3>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-medium text-slate-600">
            TF nodes = teal diamonds
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-medium text-slate-600">
            Target genes = slate circles
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-medium text-slate-600">
            Edge color ∝ support count
          </span>
        </div>
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
                  setIsExportConfirmClosing(false);
                  setIsExportConfirmOpen(true);
                }}
                aria-label="Download current network"
                title="Download current network"
                className="rounded-xl px-4 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
              >
                Download
              </button>
            </div>
          </div>
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
        </div>

        <div className="min-w-0 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-base font-bold text-slate-950">
              {selectedEdge ? "Edge Inspection" : "Node Inspection"}
            </h4>
            {(selectedNode || selectedEdge) && (
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
            <>
              <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1b75a6]">
                  Selected edge
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-lg font-bold text-slate-950">
                  <span>{selectedEdge.source}</span>
                  <span className="text-[#1b75a6]">→</span>
                  <span>{selectedEdge.target}</span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                    Consensus score
                  </p>
                  <p className="mt-2 text-lg font-bold text-slate-950">
                    {selectedEdge.score.toFixed(3)}
                  </p>
                </div>
                <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                    Rank
                  </p>
                  <p className="mt-2 text-lg font-bold text-slate-950">
                    {selectedEdge.rank}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1b75a6]">
                  Supporting algorithms
                </p>
                <div className="mt-3 space-y-2">
                  {selectedEdge.supportingAlgorithms.map((algorithmId) => {
                    const algorithmScore = selectedEdge.perAlgorithmScores[algorithmId];

                    return (
                      <div
                        key={algorithmId}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <span className="text-sm font-bold text-slate-700">
                          {algorithmId}
                        </span>
                        <span className="rounded-full border border-[#1b75a6]/15 bg-[#f2f9fc] px-2.5 py-1 text-xs font-bold tabular-nums text-[#1b75a6]">
                          {algorithmScore !== undefined ? algorithmScore.toFixed(3) : "-"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

            </>
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
              Click a node to inspect gene details, or click an edge to inspect its source gene, target gene, supporting algorithms, and normalized scores.
            </div>
          )}
        </div>
      </div>
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