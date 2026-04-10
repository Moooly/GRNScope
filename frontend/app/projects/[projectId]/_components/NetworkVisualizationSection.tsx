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
  return (
    <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-5">
      <div>
        <h3 className="text-lg font-semibold text-white">Network Visualization</h3>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
            TF nodes = teal diamonds
          </span>
          <span className="rounded-full border border-slate-400/20 bg-slate-400/10 px-3 py-1 text-slate-200">
            Target genes = slate circles
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
            Node size ∝ degree
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
            Edge width ∝ score
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
            Edge color ∝ support count
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_0.75fr] xl:items-start">
        <div className="relative min-w-0 overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#f3f4f6]">
          <div className="pointer-events-none absolute inset-x-4 top-4 z-20 flex justify-end">
            <div className="pointer-events-auto inline-flex flex-wrap items-center gap-2 rounded-2xl border border-slate-300/70 bg-white/85 p-1 shadow-sm backdrop-blur">
              {layoutOptions.map(({ value, label }) => {
                const isActive = networkLayout === value;

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setNetworkLayout(value)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                      isActive
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <NetworkGraph
            nodes={networkNodes.map((node) => ({
              id: node.id,
              inDegree: node.inDegree,
              outDegree: node.outDegree,
              degree: node.degree,
              isTF: node.isTF,
            }))}
            edges={filteredNetworkEdges.slice(0, 220).map((edge) => ({
              key: edge.key,
              source: edge.source,
              target: edge.target,
              score: edge.score,
              count: edge.count,
              rank: edge.rank,
              supportingAlgorithms: edge.supportingAlgorithms,
            }))}
            selectedGene={selectedGene}
            selectedEdgeKey={selectedEdgeKey}
            layout={networkLayout}
            onSelectGene={setSelectedGene}
            onSelectEdge={setSelectedEdgeKey}
          />
        </div>

        <div className="min-w-0 rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-base font-semibold text-white">Node Inspection</h4>
            {selectedNode && (
              <button
                type="button"
                onClick={() => {
                  setSelectedGene(null);
                  setSelectedEdgeKey(null);
                }}
                className="rounded-2xl border border-white/10 px-3 py-1 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/[0.04]"
              >
                Clear
              </button>
            )}
          </div>

          {selectedNode ? (
            <>
              <div className="mt-4 rounded-[1.25rem] border border-white/10 bg-white/[0.04] p-4">
                <p className="text-lg font-semibold text-white">{selectedNode.id}</p>
                <p className="mt-2 text-sm text-slate-400">
                  {selectedNode.isTF ? "Transcription factor" : "Target gene"}
                </p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
                  In-degree: {selectedNode.inDegree}
                </div>
                <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
                  Out-degree: {selectedNode.outDegree}
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                    Top regulators
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedNode.topRegulators.slice(0, 8).map((gene) => (
                      <span
                        key={gene}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300"
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
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                    Top target genes
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedNode.topTargets.slice(0, 8).map((gene) => (
                      <span
                        key={gene}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300"
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

              <div className="mt-6 border-t border-white/10 pt-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {isolatedGene ? (
                    <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/25 bg-teal-400/10 px-3 py-1.5 text-xs font-medium text-teal-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <span className="h-2 w-2 rounded-full bg-teal-300 shadow-[0_0_0_4px_rgba(45,212,191,0.14)]" />
                      Isolating sub-network for <span className="font-semibold text-white">{isolatedGene}</span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300">
                      <span className="h-2 w-2 rounded-full bg-slate-500" />
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
                        ? "border border-teal-300/35 bg-teal-400/14 text-teal-50 shadow-[0_12px_28px_rgba(13,148,136,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]"
                        : "border border-white/10 bg-white/[0.04] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-teal-300/35 hover:bg-teal-300/10 hover:text-teal-50"
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
                        ? "border border-slate-300/18 bg-slate-900/55 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-white/20 hover:bg-slate-800/70"
                        : "cursor-not-allowed border border-white/8 bg-white/[0.03] text-slate-500"
                    }`}
                  >
                    Reset View
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-[1.25rem] border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm leading-6 text-slate-400">
              Click a node in the network to inspect the gene name, transcription-factor status, in-degree, out-degree, top regulators, and top target genes.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}