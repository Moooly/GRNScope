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

type EdgeAnalysisTableSectionProps = {
  isTableFullscreen: boolean;
  setIsTableFullscreen: React.Dispatch<React.SetStateAction<boolean>>;
  tableSearch: string;
  setTableSearch: (value: string) => void;
  columnMenuRef?: React.RefObject<HTMLDivElement | null>;
  isColumnMenuOpen?: boolean;
  setIsColumnMenuOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  visibleAlgorithmColumns?: string[];
  setVisibleAlgorithmColumns?: React.Dispatch<React.SetStateAction<string[]>>;
  completedAlgorithmIds: string[];
  selectedView: string;
  tableSortKey: "rank" | "source" | "target" | "score" | "count";
  tableSortDirection: "asc" | "desc";
  setTableSortKey: (
    value: "rank" | "source" | "target" | "score" | "count"
  ) => void;
  setTableSortDirection: React.Dispatch<React.SetStateAction<"asc" | "desc">>;
  setTablePage: React.Dispatch<React.SetStateAction<number>>;
  displayedTableRows: AggregatedEdge[];
  selectedEdgeKey: string | null;
  setSelectedEdgeKey: (value: string | null) => void;
  setSelectedGene: (value: string | null) => void;
  totalTablePages: number;
  sortedTableRows: AggregatedEdge[];
  tablePage: number;
};

export default function EdgeAnalysisTableSection({
  isTableFullscreen,
  setIsTableFullscreen,
  tableSearch,
  setTableSearch,
  columnMenuRef,
  isColumnMenuOpen,
  setIsColumnMenuOpen,
  visibleAlgorithmColumns,
  setVisibleAlgorithmColumns,
  completedAlgorithmIds,
  selectedView,
  tableSortKey,
  tableSortDirection,
  setTableSortKey,
  setTableSortDirection,
  setTablePage,
  displayedTableRows,
  selectedEdgeKey,
  setSelectedEdgeKey,
  setSelectedGene,
  totalTablePages,
  sortedTableRows,
  tablePage,
}: EdgeAnalysisTableSectionProps) {
  void columnMenuRef;
  void isColumnMenuOpen;
  void setIsColumnMenuOpen;
  void visibleAlgorithmColumns;
  void setVisibleAlgorithmColumns;
  return (
    <div
      className={`mt-6 rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-5 ${
        isTableFullscreen ? "fixed inset-6 z-[65] overflow-auto" : ""
      }`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <h3 className="text-lg font-semibold text-white">Edge Analysis Table</h3>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end">
          <input
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="Search gene name"
            aria-label="Search gene name"
            className="w-full min-w-0 rounded-2xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-white outline-none placeholder:text-slate-500 sm:min-w-[260px] lg:w-[320px]"
          />

          <button
            type="button"
            onClick={() => setIsTableFullscreen((current) => !current)}
            className="w-full rounded-2xl border border-white/10 px-4 py-2 text-sm text-white transition hover:border-white/20 hover:bg-white/[0.04] sm:w-auto"
          >
            {isTableFullscreen ? "Exit full-screen" : "Full-screen"}
          </button>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-[1.5rem] border border-white/10">
        <table className="min-w-full divide-y divide-white/10 text-sm">
          <thead className="bg-slate-900/90 text-left text-slate-300">
            <tr>
              {[
                ["rank", selectedView === "consensus" ? "Consensus Rank" : "Rank"],
                ["source", "Source Gene"],
                ["target", "Target Gene"],
                ["count", "Consensus Count"],
                ["score", selectedView === "consensus" ? "Consensus Score" : "Score"],
              ].map(([key, label]) => (
                <th key={key} className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      setTablePage(1);
                      if (tableSortKey === key) {
                        setTableSortDirection((current) =>
                          current === "asc" ? "desc" : "asc"
                        );
                      } else {
                        setTableSortKey(
                          key as "rank" | "source" | "target" | "score" | "count"
                        );
                        setTableSortDirection("asc");
                      }
                    }}
                    className="inline-flex items-center gap-2 text-left text-slate-300 transition hover:text-white"
                  >
                    <span>{label}</span>
                    {tableSortKey === key && (
                      <span>{tableSortDirection === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                </th>
              ))}

              {completedAlgorithmIds.map((algorithmId) => (
                <th key={algorithmId} className="px-4 py-3 font-medium">
                  {algorithmId}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-white/10 bg-slate-950/60">
            {displayedTableRows.length > 0 ? (
              displayedTableRows.map((edge) => {
                const isSelected = selectedEdgeKey === edge.key;
                return (
                  <tr
                    key={edge.key}
                    onClick={() => {
                      setSelectedEdgeKey(edge.key);
                      setSelectedGene(edge.source);
                    }}
                    className={`cursor-pointer transition hover:bg-white/[0.04] ${
                      isSelected ? "bg-teal-300/10" : ""
                    }`}
                    title={`${edge.source} → ${edge.target} · score ${edge.score.toFixed(3)} · ${edge.supportingAlgorithms.join(", ")}`}
                  >
                    <td className="px-4 py-3 text-slate-300">{edge.rank}</td>
                    <td className="px-4 py-3 text-white">{edge.source}</td>
                    <td className="px-4 py-3 text-white">{edge.target}</td>
                    <td className="px-4 py-3 text-slate-300">{edge.count}</td>
                    <td className="px-4 py-3 text-slate-300">{edge.score.toFixed(3)}</td>

                    {completedAlgorithmIds.map((algorithmId) => (
                      <td key={algorithmId} className="px-4 py-3">
                        {edge.perAlgorithmScores[algorithmId] !== undefined ? (
                          <span className="text-slate-300">
                            {edge.perAlgorithmScores[algorithmId].toFixed(3)}
                          </span>
                        ) : (
                          <span className="rounded-md bg-white/[0.03] px-2 py-1 text-xs text-slate-500">
                            -
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  className="px-4 py-6 text-center text-slate-500"
                  colSpan={5 + completedAlgorithmIds.length}
                >
                  No matching edges.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
        <p>
          Page {tablePage.toLocaleString()} of {totalTablePages.toLocaleString()} · {sortedTableRows.length.toLocaleString()} matching rows
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTablePage(1)}
            disabled={tablePage === 1}
            className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-white transition hover:border-white/20 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
          >
            First
          </button>
          <button
            type="button"
            onClick={() => setTablePage((current) => Math.max(1, current - 1))}
            disabled={tablePage === 1}
            className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-white transition hover:border-white/20 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setTablePage((current) => Math.min(totalTablePages, current + 1))}
            disabled={tablePage === totalTablePages}
            className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-white transition hover:border-white/20 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
          <button
            type="button"
            onClick={() => setTablePage(totalTablePages)}
            disabled={tablePage === totalTablePages}
            className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-white transition hover:border-white/20 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Last
          </button>
        </div>
      </div>
    </div>
  );
}