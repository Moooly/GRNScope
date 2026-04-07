type ResultsControlsSectionProps = {
  selectedView: string;
  completedAlgorithmIds: string[];
  onChangeView: (value: string) => void;
  networkLayout: "force" | "hierarchical" | "concentric" | "circular";
  onChangeLayout: (value: "force" | "hierarchical" | "concentric" | "circular") => void;
  topN: number;
  maxAvailableTopN: number;
  onChangeTopN: (value: number) => void;
  consensusThreshold: number;
  maxConsensusThreshold: number;
  onChangeConsensusThreshold: (value: number) => void;
  isConsensusView: boolean;
};

export default function ResultsControlsSection({
  selectedView,
  completedAlgorithmIds,
  onChangeView,
  networkLayout,
  onChangeLayout,
  topN,
  maxAvailableTopN,
  onChangeTopN,
  consensusThreshold,
  maxConsensusThreshold,
  onChangeConsensusThreshold,
  isConsensusView,
}: ResultsControlsSectionProps) {
  return (
    <div className="flex flex-wrap items-stretch gap-3">
      <div className="rounded-[1.25rem] border border-white/10 bg-slate-950/60 px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">View</p>
        <select
          value={selectedView}
          onChange={(e) => onChangeView(e.target.value)}
          className="mt-2 w-[210px] rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-white outline-none"
        >
          <option value="consensus">Consensus network</option>
          {completedAlgorithmIds.map((algorithmId) => (
            <option key={algorithmId} value={algorithmId}>
              {algorithmId}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-[1.25rem] border border-white/10 bg-slate-950/60 px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Layout</p>
        <select
          value={networkLayout}
          onChange={(e) =>
            onChangeLayout(
              e.target.value as "force" | "hierarchical" | "concentric" | "circular"
            )
          }
          className="mt-2 w-[180px] rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-white outline-none"
        >
          <option value="force">Force-directed</option>
          <option value="hierarchical">Hierarchical</option>
          <option value="concentric">Concentric</option>
          <option value="circular">Circular</option>
        </select>
      </div>

      <div className="min-w-[260px] flex-1 rounded-[1.25rem] border border-white/10 bg-slate-950/60 px-4 py-3">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-slate-500">
          <span>Top-N edges per algorithm</span>
          <span>
            {Math.min(topN, maxAvailableTopN).toLocaleString()} / {maxAvailableTopN.toLocaleString()}
          </span>
        </div>
        <input
          key={`${selectedView}-${maxAvailableTopN}`}
          type="range"
          min={1}
          max={maxAvailableTopN}
          step={1}
          value={Math.min(topN, maxAvailableTopN)}
          onChange={(e) => onChangeTopN(Number(e.target.value))}
          className="mt-3 w-full accent-teal-400"
        />
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Truncate each algorithm&apos;s output to top N edges to exclude low-confidence predictions. Maximum available for this view: {maxAvailableTopN.toLocaleString()}.
        </p>
      </div>

      <div className="min-w-[260px] flex-1 rounded-[1.25rem] border border-white/10 bg-slate-950/60 px-4 py-3">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-slate-500">
          <span>Consensus threshold</span>
          <span>{consensusThreshold}</span>
        </div>
        <input
          type="range"
          min={1}
          max={maxConsensusThreshold}
          value={Math.min(consensusThreshold, maxConsensusThreshold)}
          onChange={(e) => onChangeConsensusThreshold(Number(e.target.value))}
          disabled={!isConsensusView}
          className="mt-3 w-full accent-teal-400 disabled:opacity-40"
        />
        <p className="mt-2 text-xs leading-5 text-slate-500">
          An edge is included only if the number of algorithms supporting it meets or exceeds the threshold.
        </p>
      </div>
    </div>
  );
}