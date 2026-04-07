type OverlapEntry = {
  key: string;
  methods: string[];
  count: number;
};

type BenchmarkMetrics = {
  methodId: string;
  evaluatedEdges: number;
  positivesFound: number;
  precision: number;
  recall: number;
  auprc: number;
  auprcRatio: number;
};

type PerAlgorithmEdgeCount = {
  algorithmId: string;
  count: number;
};

type ResultsSummarySectionProps = {
  perAlgorithmEdgeCounts: PerAlgorithmEdgeCount[];
  maxAlgorithmEdgeCount: number;
  completedAlgorithmIds: string[];
  overlapEntries: OverlapEntry[];
  maxOverlapCount: number;
  groundTruthFilename: string;
  groundTruthEdgeCount: number;
  groundTruthError: string;
  benchmarkMetrics: BenchmarkMetrics[];
  onGroundTruthUpload: (file: File | null) => void;
};

export default function ResultsSummarySection({
  perAlgorithmEdgeCounts,
  maxAlgorithmEdgeCount,
  completedAlgorithmIds,
  overlapEntries,
  maxOverlapCount,
  groundTruthFilename,
  groundTruthEdgeCount,
  groundTruthError,
  benchmarkMetrics,
  onGroundTruthUpload,
}: ResultsSummarySectionProps) {
  return (
    <div className="mt-2 rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-white">Per-Algorithm Edge Count</h4>
              <p className="mt-1 text-sm text-slate-400">
                Number of unique edges retained for each method within the current Top-N cutoff.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {perAlgorithmEdgeCounts.length > 0 ? (
              perAlgorithmEdgeCounts.map((item) => (
                <div key={item.algorithmId} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-white">{item.algorithmId}</span>
                    <span className="text-slate-400">{item.count.toLocaleString()}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-teal-400 to-cyan-300"
                      style={{ width: `${(item.count / maxAlgorithmEdgeCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.25rem] border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
                No completed algorithms available yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-white">Method Overlap Visualization</h4>
              <p className="mt-1 text-sm text-slate-400">
                {completedAlgorithmIds.length >= 4
                  ? "UpSet-style intersection summary of the strongest overlaps across methods."
                  : "Venn-style overlap summary for the selected methods."}
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {overlapEntries.length > 0 ? (
              overlapEntries.map((entry) => (
                <div key={entry.key} className="rounded-[1.25rem] border border-white/10 bg-slate-950/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{entry.methods.join(" ∩ ")}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {entry.methods.length} method{entry.methods.length === 1 ? "" : "s"} in this overlap group
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                      {entry.count.toLocaleString()} edges
                    </span>
                  </div>
                  <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-400 via-sky-400 to-teal-300"
                      style={{ width: `${(entry.count / maxOverlapCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.25rem] border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
                Select at least two completed algorithms to view overlap statistics.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h4 className="text-base font-semibold text-white">Ground-Truth Benchmarking</h4>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
              Upload a ground-truth Source/Target CSV to compute precision, recall, AUPRC, and AUPRC ratio for the consensus network and each selected method.
            </p>
          </div>

          <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.07]">
            Upload ground truth
            <input
              type="file"
              accept=".csv,.txt,.tsv"
              onChange={(e) => onGroundTruthUpload(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-300">
            File: {groundTruthFilename || "Not uploaded"}
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-300">
            Ground-truth edges: {groundTruthEdgeCount.toLocaleString()}
          </span>
        </div>

        {groundTruthError && (
          <div className="mt-4 rounded-[1.25rem] border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
            {groundTruthError}
          </div>
        )}

        {benchmarkMetrics.length > 0 ? (
          <div className="mt-5 overflow-x-auto rounded-[1.25rem] border border-white/10">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead className="bg-slate-900/90 text-left text-slate-300">
                <tr>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Evaluated Edges</th>
                  <th className="px-4 py-3 font-medium">True Positives</th>
                  <th className="px-4 py-3 font-medium">Precision</th>
                  <th className="px-4 py-3 font-medium">Recall</th>
                  <th className="px-4 py-3 font-medium">AUPRC</th>
                  <th className="px-4 py-3 font-medium">AUPRC Ratio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-slate-950/60">
                {benchmarkMetrics.map((metric) => (
                  <tr key={metric.methodId}>
                    <td className="px-4 py-3 text-white">{metric.methodId}</td>
                    <td className="px-4 py-3 text-slate-300">{metric.evaluatedEdges.toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-300">{metric.positivesFound.toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-300">{metric.precision.toFixed(3)}</td>
                    <td className="px-4 py-3 text-slate-300">{metric.recall.toFixed(3)}</td>
                    <td className="px-4 py-3 text-slate-300">{metric.auprc.toFixed(3)}</td>
                    <td className="px-4 py-3 text-slate-300">{metric.auprcRatio.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5 rounded-[1.25rem] border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm leading-6 text-slate-400">
            Upload a ground-truth edge list to activate benchmarking metrics.
          </div>
        )}
      </div>
    </div>
  );
}