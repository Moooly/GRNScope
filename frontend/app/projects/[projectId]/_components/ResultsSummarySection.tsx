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
  "#1b75a6",
  "#5fc8bd",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#ec4899",
  "#84cc16",
  "#06b6d4",
  "#eab308",
  "#6366f1",
  "#10b981",
  "#f43f5e",
  "#65a30d",
];

function getMethodColor(index: number) {
  if (index < UPSET_METHOD_COLORS.length) {
    return UPSET_METHOD_COLORS[index];
  }

  const hue = (index * 137.508) % 360;
  return `hsl(${hue} 72% 45%)`;
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
      <div className="mt-5 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
        <div className="flex justify-center overflow-x-auto">
          <svg viewBox="0 0 640 360" className="mx-auto h-auto w-full max-w-[42rem]">
            <circle cx="250" cy="180" r="110" fill="rgba(95,200,189,0.22)" stroke="rgba(95,200,189,0.72)" strokeWidth="3" />
            <circle cx="390" cy="180" r="110" fill="rgba(27,117,166,0.18)" stroke="rgba(27,117,166,0.65)" strokeWidth="3" />

            <text x="210" y="62" textAnchor="middle" className="fill-slate-950 text-[16px] font-bold">{a}</text>
            <text x="430" y="62" textAnchor="middle" className="fill-slate-950 text-[16px] font-bold">{b}</text>

            {aOnly > 0 && (
              <text x="205" y="188" textAnchor="middle" className="fill-[#1b75a6] text-[26px] font-bold">{aOnly.toLocaleString()}</text>
            )}
            {ab > 0 && (
              <text x="320" y="188" textAnchor="middle" className="fill-slate-950 text-[26px] font-bold">{ab.toLocaleString()}</text>
            )}
            {bOnly > 0 && (
              <text x="435" y="188" textAnchor="middle" className="fill-[#1b75a6] text-[26px] font-bold">{bOnly.toLocaleString()}</text>
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
      <div className="mt-5 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
        <div className="flex justify-center overflow-x-auto">
          <svg viewBox="0 0 700 470" className="mx-auto h-auto w-full max-w-[44rem]">
            <circle cx="290" cy="185" r="122" fill="rgba(95,200,189,0.22)" stroke="rgba(95,200,189,0.72)" strokeWidth="3" />
            <circle cx="410" cy="185" r="122" fill="rgba(27,117,166,0.18)" stroke="rgba(27,117,166,0.65)" strokeWidth="3" />
            <circle cx="350" cy="290" r="122" fill="rgba(139,92,246,0.14)" stroke="rgba(139,92,246,0.55)" strokeWidth="3" />

            <text x="235" y="52" textAnchor="middle" className="fill-slate-950 text-[16px] font-bold">{a}</text>
            <text x="465" y="52" textAnchor="middle" className="fill-slate-950 text-[16px] font-bold">{b}</text>
            <text x="350" y="446" textAnchor="middle" className="fill-slate-950 text-[16px] font-bold">{c}</text>

            {aOnly > 0 && (
              <text x="238" y="172" textAnchor="middle" className="fill-[#1b75a6] text-[24px] font-bold">{aOnly.toLocaleString()}</text>
            )}
            {bOnly > 0 && (
              <text x="462" y="172" textAnchor="middle" className="fill-[#1b75a6] text-[24px] font-bold">{bOnly.toLocaleString()}</text>
            )}
            {cOnly > 0 && (
              <text x="350" y="346" textAnchor="middle" className="fill-violet-700 text-[24px] font-bold">{cOnly.toLocaleString()}</text>
            )}
            {ab > 0 && (
              <text x="350" y="146" textAnchor="middle" className="fill-slate-950 text-[22px] font-bold">{ab.toLocaleString()}</text>
            )}
            {ac > 0 && (
              <text x="286" y="266" textAnchor="middle" className="fill-slate-950 text-[22px] font-bold">{ac.toLocaleString()}</text>
            )}
            {bc > 0 && (
              <text x="414" y="266" textAnchor="middle" className="fill-slate-950 text-[22px] font-bold">{bc.toLocaleString()}</text>
            )}
            {abc > 0 && (
              <text x="350" y="230" textAnchor="middle" className="fill-slate-950 text-[24px] font-bold">{abc.toLocaleString()}</text>
            )}
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50/80 p-5 text-sm text-slate-600">
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
  const setPanelWidth = 340;
  const matrixWidth = Math.max(rows.length * columnWidth, 420);

  const rowIndexToY = (rowIndex: number, rowHeightValue: number) => rowIndex * rowHeightValue + rowHeightValue / 2;

  return (
    <div className="mt-5">
      <div className="w-full pb-2">
        <div className="mx-auto" style={{ width: `100%` }}>
          <div className="grid items-end gap-6" style={{ gridTemplateColumns: `${setPanelWidth}px minmax(0, 1fr)` }}>
            <div className="self-end rounded-[1.25rem] border border-slate-200 bg-slate-50/80 px-5 py-5">
              <div className="mb-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#1b75a6]">
                  Set size
                </p>
              </div>
              <div>
                {setSummaries.map((item, rowIndex) => {
                  const color = getMethodColorById(methodIds, item.algorithmId);
                  const barWidth = (item.count / maxSetSize) * 100;

                  return (
                    <div
                      key={`legend-row-${item.algorithmId}`}
                      className={`grid items-center gap-4 pr-2 ${rowIndex % 2 === 1 ? "bg-white" : "bg-transparent"}`}
                      style={{
                        gridTemplateColumns: "72px minmax(0, 1fr) 128px",
                        height: `${rowHeight}px`,
                      }}
                    >
                      <div className="text-right text-sm font-bold tabular-nums text-slate-950">
                        {item.count.toLocaleString()}
                      </div>
                      <div className="h-4 overflow-hidden rounded-full bg-slate-200 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${barWidth}%`,
                            background: color,
                            boxShadow: `0 0 0 1px ${color}22 inset`,
                          }}
                        />
                      </div>
                      <div className="text-left text-sm font-bold whitespace-nowrap text-slate-700">
                        {item.algorithmId}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="overflow-x-auto pb-1">
              <div className="min-w-fit rounded-[1.25rem] border border-slate-200 bg-slate-50/80 px-5 py-5">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#1b75a6]">
                    Intersection size
                  </p>
                  <div
                    className="mt-4 grid items-end border-b border-slate-200"
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
                          <span className="text-sm font-bold text-slate-950">
                            {row.count.toLocaleString()}
                          </span>
                          <div
                            className="w-11 rounded-t-[0.8rem] bg-gradient-to-t from-[#1b75a6] to-[#5fc8bd]"
                            style={{
                              height: `${Math.max(barHeight, 8)}px`,
                              boxShadow: "0 0 0 1px rgba(27,117,166,0.14) inset",
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-6 pt-6">
                  <div className="mb-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#1b75a6]">
                      Membership
                    </p>
                  </div>
                  <div className="relative" style={{ width: `${matrixWidth}px` }}>
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
                            left: `${columnIndex * columnWidth + columnWidth / 2 - 2}px`,
                            top: `${top}px`,
                            width: "4px",
                            height: `${bottom - top}px`,
                            background: "rgba(100,116,139,0.45)",
                          }}
                        />
                      );
                    })}

                    {setSummaries.map((item, rowIndex) => {
                      const color = getMethodColorById(methodIds, item.algorithmId);

                      return (
                        <div
                          key={`shared-row-${item.algorithmId}`}
                          className={`grid items-center ${rowIndex % 2 === 1 ? "bg-white" : "bg-transparent"}`}
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
                                <div className="absolute left-1/2 top-1/2 h-[2px] w-10 -translate-x-1/2 -translate-y-1/2 bg-slate-200" />
                                <div
                                  className="relative h-9 w-9 rounded-full border"
                                  style={{
                                    background: included ? color : "rgba(148,163,184,0.18)",
                                    borderColor: included ? color : "rgba(148,163,184,0.28)",
                                    boxShadow: included ? `0 0 0 1px ${color}33 inset` : "none",
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
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
    <div className="w-full">
      <div className="hidden rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-base font-bold text-slate-950">Per-Algorithm Edge Count</h4>
            <p className="mt-1 text-sm text-slate-600">
              Number of unique edges retained for each method within the current Top-N cutoff.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {perAlgorithmEdgeCounts.length > 0 ? (
            perAlgorithmEdgeCounts.map((item) => (
              <div key={item.algorithmId} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-bold text-slate-950">{item.algorithmId}</span>
                  <span className="text-slate-500">{item.count.toLocaleString()}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#1b75a6] to-[#5fc8bd]"
                    style={{ width: `${(item.count / maxAlgorithmEdgeCount) * 100}%` }}
                  />
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50/80 p-5 text-sm text-slate-600">
              No completed algorithms available yet.
            </div>
          )}
        </div>
      </div>

      <div className="w-full rounded-[1.5rem] border border-slate-200 bg-white p-5 text-slate-900 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-base font-bold text-slate-950">Method Overlap Visualization</h4>
            <p className="mt-1 text-sm text-slate-600">
              {completedAlgorithmIds.length >= 4
                ? "UpSet plot showing intersection sizes, set sizes, and membership across methods. Scroll horizontally to view all overlap groups."
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
          <div className="mt-5 rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50/80 p-5 text-sm text-slate-600">
            Select at least two completed algorithms to view overlap statistics.
          </div>
        )}
      </div>
    </div>
  );
}