type OverlapEntry = {
  key: string;
  methods: string[];
  count: number;
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
};

function VennSummary({ overlapEntries }: { overlapEntries: OverlapEntry[] }) {
  const uniqueEntries = overlapEntries.filter((entry) => entry.methods.length === 1);
  const sharedEntries = overlapEntries.filter((entry) => entry.methods.length > 1);

  return (
    <div className="mt-5 space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
          Unique predictions
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {uniqueEntries.map((entry) => (
            <div
              key={entry.key}
              className="rounded-[1.25rem] border border-white/10 bg-slate-950/60 p-4"
            >
              <p className="text-sm font-medium text-white">{entry.methods[0]} only</p>
              <p className="mt-2 text-2xl font-semibold text-cyan-300">{entry.count.toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-400">Edges predicted only by this method</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
          Shared intersections
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sharedEntries.map((entry) => (
            <div
              key={entry.key}
              className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-4"
            >
              <p className="text-sm font-medium text-white">{entry.methods.join(" ∩ ")}</p>
              <p className="mt-2 text-2xl font-semibold text-violet-300">{entry.count.toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-400">
                {entry.methods.length === 2 ? "Pairwise overlap" : "Higher-order overlap"}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UpSetSummary({
  overlapEntries,
  completedAlgorithmIds,
  maxOverlapCount,
}: {
  overlapEntries: OverlapEntry[];
  completedAlgorithmIds: string[];
  maxOverlapCount: number;
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-[1.25rem] border border-white/10 bg-slate-950/60">
      <div className="grid grid-cols-[minmax(180px,1.2fr)_minmax(320px,2fr)_96px] gap-4 border-b border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
        <div>Intersection</div>
        <div>Membership matrix</div>
        <div className="text-right">Edges</div>
      </div>

      <div className="divide-y divide-white/10">
        {overlapEntries.map((entry) => (
          <div
            key={entry.key}
            className="grid grid-cols-[minmax(180px,1.2fr)_minmax(320px,2fr)_96px] gap-4 px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-white">{entry.methods.join(" ∩ ")}</p>
              <p className="mt-1 text-xs text-slate-400">
                {entry.methods.length === 1
                  ? "Unique to one method"
                  : `${entry.methods.length}-way intersection`}
              </p>
            </div>

            <div className="space-y-2">
              {completedAlgorithmIds.map((algorithmId) => {
                const included = entry.methods.includes(algorithmId);
                return (
                  <div key={`${entry.key}-${algorithmId}`} className="grid grid-cols-[112px_1fr] items-center gap-3">
                    <span className="text-xs text-slate-400">{algorithmId}</span>
                    <div className="relative h-3 rounded-full bg-white/[0.04]">
                      <div
                        className={`absolute left-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full ${
                          included ? "bg-teal-300 shadow-[0_0_0_3px_rgba(45,212,191,0.12)]" : "bg-slate-600"
                        }`}
                      />
                      {included && (
                        <div className="absolute left-0 top-1/2 h-[2px] w-full -translate-y-1/2 bg-teal-300/40" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col items-end justify-center gap-2">
              <span className="text-sm font-semibold text-white">{entry.count.toLocaleString()}</span>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-400 via-sky-400 to-teal-300"
                  style={{ width: `${(entry.count / maxOverlapCount) * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ResultsSummarySection({
  perAlgorithmEdgeCounts,
  maxAlgorithmEdgeCount,
  completedAlgorithmIds,
  overlapEntries,
  maxOverlapCount,
}: ResultsSummarySectionProps) {
  return (
    <>
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
                  ? "UpSet-style overlap visualization showing unique edges plus all pairwise and higher-order intersections across methods."
                  : "Venn-style overlap summary showing unique edges and shared intersections for the selected methods."}
              </p>
            </div>
          </div>

          {overlapEntries.length > 0 ? (
            completedAlgorithmIds.length >= 4 ? (
              <UpSetSummary
                overlapEntries={overlapEntries}
                completedAlgorithmIds={completedAlgorithmIds}
                maxOverlapCount={maxOverlapCount}
              />
            ) : (
              <VennSummary overlapEntries={overlapEntries} />
            )
          ) : (
            <div className="mt-5 rounded-[1.25rem] border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
              Select at least two completed algorithms to view overlap statistics.
            </div>
          )}
        </div>
      </div>
    </>
  );
}