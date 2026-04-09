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

type UpSetRow = {
  key: string;
  methods: string[];
  count: number;
};

type UpSetSetSummary = {
  algorithmId: string;
  count: number;
};

const UPSET_METHOD_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#14b8a6",
  "#f97316",
  "#ec4899",
  "#84cc16",
  "#06b6d4",
  "#eab308",
  "#8b5cf6",
  "#10b981",
  "#f43f5e",
  "#6366f1",
  "#65a30d",
];

function getMethodColor(index: number) {
  if (index < UPSET_METHOD_COLORS.length) {
    return UPSET_METHOD_COLORS[index];
  }

  const hue = (index * 137.508) % 360;
  return `hsl(${hue} 72% 58%)`;
}

function getMethodColorById(methodIds: string[], methodId: string) {
  const index = methodIds.indexOf(methodId);
  return getMethodColor(index >= 0 ? index : 0);
}

function VennSummary({ overlapEntries }: { overlapEntries: OverlapEntry[] }) {
  const methodIds = Array.from(
    new Set(overlapEntries.flatMap((entry) => entry.methods))
  ).sort();

  const countForExact = (...methods: string[]) => {
    const key = [...methods].sort().join("||");
    return (
      overlapEntries.find(
        (entry) => [...entry.methods].sort().join("||") === key
      )?.count ?? 0
    );
  };

  if (methodIds.length === 2) {
    const [a, b] = methodIds;
    const aOnly = countForExact(a);
    const bOnly = countForExact(b);
    const ab = countForExact(a, b);

    return (
      <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
        <div className="flex justify-center overflow-x-auto">
          <svg viewBox="0 0 640 360" className="mx-auto h-auto w-full max-w-[42rem]">
            <circle cx="250" cy="180" r="110" fill="rgba(45,212,191,0.22)" stroke="rgba(45,212,191,0.55)" strokeWidth="3" />
            <circle cx="390" cy="180" r="110" fill="rgba(96,165,250,0.22)" stroke="rgba(96,165,250,0.55)" strokeWidth="3" />

            <text x="210" y="62" textAnchor="middle" className="fill-white text-[16px] font-semibold">{a}</text>
            <text x="430" y="62" textAnchor="middle" className="fill-white text-[16px] font-semibold">{b}</text>

            {aOnly > 0 && (
              <text x="205" y="188" textAnchor="middle" className="fill-cyan-100 text-[26px] font-semibold">{aOnly.toLocaleString()}</text>
            )}
            {ab > 0 && (
              <text x="320" y="188" textAnchor="middle" className="fill-white text-[26px] font-semibold">{ab.toLocaleString()}</text>
            )}
            {bOnly > 0 && (
              <text x="435" y="188" textAnchor="middle" className="fill-sky-100 text-[26px] font-semibold">{bOnly.toLocaleString()}</text>
            )}
          </svg>
        </div>
      </div>
    );
  }

  if (methodIds.length === 3) {
    const [a, b, c] = methodIds;
    const aOnly = countForExact(a);
    const bOnly = countForExact(b);
    const cOnly = countForExact(c);
    const ab = countForExact(a, b);
    const ac = countForExact(a, c);
    const bc = countForExact(b, c);
    const abc = countForExact(a, b, c);

    return (
      <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
        <div className="flex justify-center overflow-x-auto">
          <svg viewBox="0 0 700 470" className="mx-auto h-auto w-full max-w-[44rem]">
            <circle cx="290" cy="185" r="122" fill="rgba(45,212,191,0.22)" stroke="rgba(45,212,191,0.55)" strokeWidth="3" />
            <circle cx="410" cy="185" r="122" fill="rgba(96,165,250,0.22)" stroke="rgba(96,165,250,0.55)" strokeWidth="3" />
            <circle cx="350" cy="290" r="122" fill="rgba(168,85,247,0.18)" stroke="rgba(168,85,247,0.5)" strokeWidth="3" />

            <text x="235" y="52" textAnchor="middle" className="fill-white text-[16px] font-semibold">{a}</text>
            <text x="465" y="52" textAnchor="middle" className="fill-white text-[16px] font-semibold">{b}</text>
            <text x="350" y="446" textAnchor="middle" className="fill-white text-[16px] font-semibold">{c}</text>

            {aOnly > 0 && (
              <text x="238" y="172" textAnchor="middle" className="fill-cyan-100 text-[24px] font-semibold">{aOnly.toLocaleString()}</text>
            )}
            {bOnly > 0 && (
              <text x="462" y="172" textAnchor="middle" className="fill-sky-100 text-[24px] font-semibold">{bOnly.toLocaleString()}</text>
            )}
            {cOnly > 0 && (
              <text x="350" y="346" textAnchor="middle" className="fill-violet-100 text-[24px] font-semibold">{cOnly.toLocaleString()}</text>
            )}
            {ab > 0 && (
              <text x="350" y="146" textAnchor="middle" className="fill-white text-[22px] font-semibold">{ab.toLocaleString()}</text>
            )}
            {ac > 0 && (
              <text x="286" y="266" textAnchor="middle" className="fill-white text-[22px] font-semibold">{ac.toLocaleString()}</text>
            )}
            {bc > 0 && (
              <text x="414" y="266" textAnchor="middle" className="fill-white text-[22px] font-semibold">{bc.toLocaleString()}</text>
            )}
            {abc > 0 && (
              <text x="350" y="230" textAnchor="middle" className="fill-white text-[24px] font-bold">{abc.toLocaleString()}</text>
            )}
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-[1.25rem] border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
      Venn diagram visualization is available for two or three algorithms.
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
  const rows: UpSetRow[] = [...overlapEntries]
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((entry) => ({
      key: entry.key,
      methods: entry.methods,
      count: entry.count,
    }));

  const setSummaries: UpSetSetSummary[] = completedAlgorithmIds.map((algorithmId) => ({
    algorithmId,
    count: overlapEntries
      .filter((entry) => entry.methods.includes(algorithmId))
      .reduce((sum, entry) => sum + entry.count, 0),
  }));

  const methodIds = completedAlgorithmIds;
  const maxSetSize = Math.max(...setSummaries.map((item) => item.count), 1);
  const chartHeight = 220;
  const rowHeight = 52;
  const columnWidth = 72;
  const setPanelWidth = 300;
  const matrixWidth = Math.max(rows.length * columnWidth, 420);

  const rowIndexToY = (rowIndex: number, rowHeightValue: number) => rowIndex * rowHeightValue + rowHeightValue / 2;
  return (
    <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
      <div className="w-full overflow-x-auto">
        <div className="mx-auto" style={{ width: `${setPanelWidth + matrixWidth + 24}px` }}>
          <div className="flex flex-col gap-6">
            {/* Intersection size card (aligned with set columns) */}
            <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] px-5 pt-5 pb-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
                Intersection size
              </p>
              <div className="mt-4" style={{ paddingLeft: `${setPanelWidth}px` }}>
                <div
                  className="grid items-end border-b border-white/10"
                  style={{
                    gridTemplateColumns: `repeat(${rows.length}, ${columnWidth}px)`,
                    height: `${chartHeight - 56}px`,
                    width: `${matrixWidth}px`,
                  }}
                >
                {rows.map((row) => {
                  const barHeight =
                    (row.count / Math.max(maxOverlapCount, 1)) * (chartHeight - 102);

                  return (
                    <div
                      key={`bar-${row.key}`}
                      className="flex h-full flex-col items-center justify-end gap-2"
                    >
                      <span className="text-sm font-semibold text-white">
                        {row.count.toLocaleString()}
                      </span>
                      <div
                        className="w-11 rounded-t-[0.8rem] bg-gradient-to-t from-teal-400 to-cyan-300"
                        style={{
                          height: `${Math.max(barHeight, 8)}px`,
                          boxShadow: "0 0 0 1px rgba(125,211,252,0.14) inset",
                        }}
                      />
                    </div>
                  );
                })}
                </div>
              </div>
            </div>

            {/* Shared panel with Set size label integrated */}
            <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] px-5 py-5">
              <div className="mb-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
                  Set size and membership
                </p>
              </div>
              <div className="relative" style={{ width: `${setPanelWidth + matrixWidth + 20}px` }}>
                {rows.map((row, columnIndex) => {
                  const includedIndexes = setSummaries
                    .map((item, index) => (row.methods.includes(item.algorithmId) ? index : -1))
                    .filter((index) => index >= 0);

                  if (includedIndexes.length < 2) {
                    return null;
                  }

                  const top = rowIndexToY(includedIndexes[0], rowHeight);
                  const bottom = rowIndexToY(includedIndexes[includedIndexes.length - 1], rowHeight);

                  return (
                    <div
                      key={`connector-${row.key}`}
                      className="pointer-events-none absolute z-0"
                      style={{
                        left: `${setPanelWidth + columnIndex * columnWidth + columnWidth / 2 - 2}px`,
                        top: `${top}px`,
                        width: "4px",
                        height: `${bottom - top}px`,
                        background: "rgba(226,232,240,0.6)",
                      }}
                    />
                  );
                })}

                {setSummaries.map((item, rowIndex) => {
                  const color = getMethodColorById(methodIds, item.algorithmId);
                  const barWidth = (item.count / maxSetSize) * 100;

                  return (
                    <div
                      key={`shared-row-${item.algorithmId}`}
                      className="grid items-center"
                      style={{
                        gridTemplateColumns: `${setPanelWidth}px ${matrixWidth}px`,
                        height: `${rowHeight}px`,
                      }}
                    >
                      <div className="grid items-center gap-4 pr-5" style={{ gridTemplateColumns: "64px minmax(0, 1fr) 110px" }}>
                        <div className="text-right text-sm font-semibold text-white">
                          {item.count.toLocaleString()}
                        </div>
                        <div className="h-4 overflow-hidden rounded-full bg-white/[0.05]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${barWidth}%`,
                              background: color,
                              boxShadow: `0 0 0 1px ${color}22 inset`,
                            }}
                          />
                        </div>
                        <div className="text-sm font-medium text-white whitespace-nowrap text-left">
                          {item.algorithmId}
                        </div>
                      </div>

                      <div
                        className={`grid items-center rounded-[0.75rem] ${rowIndex % 2 === 1 ? "bg-white/[0.035]" : "bg-transparent"}`}
                        style={{
                          gridTemplateColumns: `repeat(${rows.length}, ${columnWidth}px)`,
                          height: `${rowHeight}px`,
                        }}
                      >
                        {rows.map((row) => {
                          const included = row.methods.includes(item.algorithmId);

                          return (
                            <div
                              key={`cell-${item.algorithmId}-${row.key}`}
                              className="relative z-10 flex h-full items-center justify-center"
                            >
                              <div className="absolute left-1/2 top-1/2 h-[2px] w-10 -translate-x-1/2 -translate-y-1/2 bg-white/[0.08]" />
                              <div
                                className="relative h-9 w-9 rounded-full border"
                                style={{
                                  background: included ? color : "rgba(148,163,184,0.16)",
                                  borderColor: included ? color : "rgba(148,163,184,0.10)",
                                  boxShadow: included ? `0 0 0 1px ${color}33 inset` : "none",
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
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
      <div className="w-full">
        <div className="hidden rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5">
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

        <div className="w-full rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-white">Method Overlap Visualization</h4>
              <p className="mt-1 text-sm text-slate-400">
                {completedAlgorithmIds.length >= 4
                  ? "UpSet plot showing intersection sizes, set sizes, and membership across methods."
                  : "Venn diagram showing exclusive overlap regions among the selected methods."}
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