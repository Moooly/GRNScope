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
  tableSearch: string;
  setTableSearch: (value: string) => void;
  onExportEdgeList: () => void;
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
  tableSearch,
  setTableSearch,
  onExportEdgeList,
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

  const sortColumns: Array<[
    "rank" | "source" | "target" | "count" | "score",
    string
  ]> = [
    ["rank", selectedView === "consensus" ? "Consensus Rank" : "Rank"],
    ["source", "Source Gene"],
    ["target", "Target Gene"],
    ["count", "Consensus Count"],
    ["score", selectedView === "consensus" ? "Consensus Score" : "Raw Score"],
  ];

  return (
    <div className="mt-6 rounded-[1.75rem] border border-slate-200 bg-white/95 p-6 text-slate-900 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <h3 className="text-xl font-bold tracking-tight text-slate-950">
          Edge Analysis Table
        </h3>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center lg:w-auto lg:justify-end">
          <input
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="Search gene name"
            aria-label="Search gene name"
            className="w-full min-w-0 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10 sm:min-w-[260px] lg:w-[320px]"
          />

          <button
            type="button"
            onClick={onExportEdgeList}
            className="w-full whitespace-nowrap rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] sm:w-auto"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                {sortColumns.map(([key, label]) => (
                  <th key={key} className="px-4 py-3 align-top font-medium">
                    <button
                      type="button"
                      onClick={() => {
                        setTablePage(1);
                        if (tableSortKey === key) {
                          setTableSortDirection((current) =>
                            current === "asc" ? "desc" : "asc"
                          );
                        } else {
                          setTableSortKey(key);
                          setTableSortDirection("asc");
                        }
                      }}
                      className="group inline-flex items-start gap-2 text-left transition hover:text-[#1b75a6]"
                    >
                      <span className="block font-bold text-slate-800 group-hover:text-[#1b75a6]">
                        {label}
                      </span>
                      {tableSortKey === key && (
                        <span className="mt-0.5 text-[#1b75a6]">
                          {tableSortDirection === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                    </button>
                  </th>
                ))}

                {completedAlgorithmIds.map((algorithmId) => (
                  <th key={algorithmId} className="px-4 py-3 align-top font-medium">
                    <span className="block font-bold text-slate-800">{algorithmId}</span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
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
                      className={`cursor-pointer transition hover:bg-[#f2f9fc] ${
                        isSelected ? "bg-[#e8f5fb]" : ""
                      }`}
                      title={`${edge.source} → ${edge.target} · raw score ${edge.score.toFixed(3)} · ${edge.supportingAlgorithms.join(", ")}`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-600">{edge.rank}</td>
                      <td className="px-4 py-3 font-bold text-slate-950">{edge.source}</td>
                      <td className="px-4 py-3 font-bold text-slate-950">{edge.target}</td>
                      <td className="px-4 py-3 text-slate-600">{edge.count}</td>
                      <td className="px-4 py-3 text-slate-600">{edge.score.toFixed(3)}</td>

                      {completedAlgorithmIds.map((algorithmId) => (
                        <td key={algorithmId} className="px-4 py-3">
                          {edge.perAlgorithmScores[algorithmId] !== undefined ? (
                            <span className="tabular-nums text-slate-600">
                              {edge.perAlgorithmScores[algorithmId].toFixed(3)}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    className="px-4 py-8 text-center text-slate-500"
                    colSpan={5 + completedAlgorithmIds.length}
                  >
                    No matching edges.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <p>
          Page {tablePage.toLocaleString()} of {totalTablePages.toLocaleString()} · {sortedTableRows.length.toLocaleString()} matching rows
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTablePage(1)}
            disabled={tablePage === 1}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-40"
          >
            First
          </button>
          <button
            type="button"
            onClick={() => setTablePage((current) => Math.max(1, current - 1))}
            disabled={tablePage === 1}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setTablePage((current) => Math.min(totalTablePages, current + 1))}
            disabled={tablePage === totalTablePages}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
          <button
            type="button"
            onClick={() => setTablePage(totalTablePages)}
            disabled={tablePage === totalTablePages}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Last
          </button>
        </div>
      </div>
    </div>
  );
}