import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type { AlgorithmCatalogItem } from "../_lib/types";

type ResultsControlsSectionProps = {
  completedAlgorithmIds: string[];
  algorithmCatalog?: AlgorithmCatalogItem[];
  selectedAlgorithmIds: string[];
  onChangeSelectedAlgorithmIds: (value: string[]) => void;
  resultScopes?: Array<{
    id: string;
    label: string;
    type: string;
    cellCount?: number;
    skipped?: boolean;
  }>;
  selectedResultScopeId?: string;
  onChangeSelectedResultScopeId?: (value: string) => void;
  evidenceThreshold: number;
  onChangeEvidenceThreshold: (value: number) => void;
  confidenceThreshold: number;
  onChangeConfidenceThreshold: (value: number) => void;
  directionConfidenceThreshold: number;
  onChangeDirectionConfidenceThreshold: (value: number) => void;
  signConfidenceThreshold: number;
  onChangeSignConfidenceThreshold: (value: number) => void;
  consensusThreshold: number;
  maxConsensusThreshold: number;
  onChangeConsensusThreshold: (value: number) => void;
  isConsensusView: boolean;
  edgeDisplayLimit: number;
  onChangeEdgeDisplayLimit: (value: number) => void;
  filteredEdgeCount: number;
  compact?: boolean;
  projectId?: string;
  isGuideOpen?: boolean;
  onOpenGuide?: () => void;
};

type SettingsPanel = "algorithms";
type AlgorithmDirectionFilter = "all" | "directed" | "undirected";
type AlgorithmSignFilter = "all" | "signed" | "unsigned";

export default function ResultsControlsSection({
  completedAlgorithmIds,
  algorithmCatalog = [],
  selectedAlgorithmIds,
  onChangeSelectedAlgorithmIds,
  resultScopes = [],
  selectedResultScopeId = "global",
  onChangeSelectedResultScopeId,
  evidenceThreshold = 0.8,
  onChangeEvidenceThreshold = () => {},
  confidenceThreshold = 0.8,
  onChangeConfidenceThreshold = () => {},
  directionConfidenceThreshold = 0,
  onChangeDirectionConfidenceThreshold = () => {},
  signConfidenceThreshold = 0,
  onChangeSignConfidenceThreshold = () => {},
  consensusThreshold,
  onChangeConsensusThreshold,
  isConsensusView,
  edgeDisplayLimit,
  onChangeEdgeDisplayLimit,
  filteredEdgeCount,
  compact = false,
  onOpenGuide,
}: ResultsControlsSectionProps) {
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [isSettingsClosing, setIsSettingsClosing] = useState(false);
  const settingsCloseTimeoutRef = useRef<number | null>(null);
  const [openPanel, setOpenPanel] = useState<SettingsPanel | null>(null);
  const [edgeDisplayDraft, setEdgeDisplayDraft] = useState<string | null>(null);
  const [algorithmDirectionFilter, setAlgorithmDirectionFilter] =
    useState<AlgorithmDirectionFilter>("all");
  const [algorithmSignFilter, setAlgorithmSignFilter] =
    useState<AlgorithmSignFilter>("all");
  const [algorithmCategoryFilter, setAlgorithmCategoryFilter] = useState("all");
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);

  const effectiveMaxConsensusThreshold = Math.max(selectedAlgorithmIds.length, 1);
  const safeEvidenceThreshold = Number.isFinite(evidenceThreshold) ? evidenceThreshold : 0.8;
  const safeConfidenceThreshold = Number.isFinite(confidenceThreshold) ? confidenceThreshold : 0.8;
  const safeDirectionThreshold = Number.isFinite(directionConfidenceThreshold)
    ? directionConfidenceThreshold
    : 0;
  const safeSignThreshold = Number.isFinite(signConfidenceThreshold)
    ? signConfidenceThreshold
    : 0;
  const selectableResultScopes = resultScopes.filter((scope) => !scope.skipped);
  const safeConsensusThreshold = Math.max(
    1,
    Math.min(consensusThreshold, effectiveMaxConsensusThreshold)
  );

  const toggleAlgorithm = (algorithmId: string) => {
    const isSelected = selectedAlgorithmIds.includes(algorithmId);
    if (isSelected) {
      if (selectedAlgorithmIds.length === 1) return;
      onChangeSelectedAlgorithmIds(selectedAlgorithmIds.filter((id) => id !== algorithmId));
      return;
    }
    onChangeSelectedAlgorithmIds([...selectedAlgorithmIds, algorithmId]);
  };

  const algorithmMetaMap = useMemo(
    () => new Map(algorithmCatalog.map((algorithm) => [algorithm.id, algorithm])),
    [algorithmCatalog]
  );

  const completedAlgorithmCategories = useMemo(() => {
    const categories = new Set<string>();

    completedAlgorithmIds.forEach((algorithmId) => {
      const category = algorithmMetaMap.get(algorithmId)?.category?.trim();
      if (category) categories.add(category);
    });

    return [...categories].sort((a, b) => a.localeCompare(b));
  }, [algorithmMetaMap, completedAlgorithmIds]);

  const filteredAlgorithmIds = useMemo(() => {
    return completedAlgorithmIds.filter((algorithmId) => {
      const meta = algorithmMetaMap.get(algorithmId);
      const isDirected = meta?.directed ?? true;
      const isSigned = meta?.signed ?? false;
      const category = meta?.category ?? "";

      if (algorithmDirectionFilter === "directed" && !isDirected) return false;
      if (algorithmDirectionFilter === "undirected" && isDirected) return false;
      if (algorithmSignFilter === "signed" && !isSigned) return false;
      if (algorithmSignFilter === "unsigned" && isSigned) return false;
      if (algorithmCategoryFilter !== "all" && category !== algorithmCategoryFilter) {
        return false;
      }

      return true;
    });
  }, [
    algorithmCategoryFilter,
    algorithmDirectionFilter,
    algorithmMetaMap,
    algorithmSignFilter,
    completedAlgorithmIds,
  ]);

  const hasAlgorithmFilter =
    algorithmDirectionFilter !== "all" ||
    algorithmSignFilter !== "all" ||
    algorithmCategoryFilter !== "all";

  const resetAlgorithmFilters = () => {
    setAlgorithmDirectionFilter("all");
    setAlgorithmSignFilter("all");
    setAlgorithmCategoryFilter("all");
  };

  const clampPercent = (value: number) => Math.min(1, Math.max(0, value));

  const updatePercent = (value: number, onChange: (value: number) => void) => {
    if (!Number.isFinite(value)) return;
    onChange(clampPercent(value / 100));
  };

  const adjustPercent = (
    currentValue: number,
    delta: number,
    onChange: (value: number) => void
  ) => {
    onChange(clampPercent(currentValue + delta / 100));
  };

  const adjustSupportingMethods = (delta: number) => {
    const nextValue = Math.min(
      effectiveMaxConsensusThreshold,
      Math.max(1, safeConsensusThreshold + delta)
    );
    onChangeConsensusThreshold(nextValue);
  };

  const openSettings = () => {
    if (settingsCloseTimeoutRef.current) {
      window.clearTimeout(settingsCloseTimeoutRef.current);
      settingsCloseTimeoutRef.current = null;
    }
    setIsSettingsClosing(false);
    setIsSettingsMenuOpen(true);
  };

  const closeSettings = () => {
    if (settingsCloseTimeoutRef.current) return;
    setIsSettingsClosing(true);
    settingsCloseTimeoutRef.current = window.setTimeout(() => {
      setIsSettingsMenuOpen(false);
      setIsSettingsClosing(false);
      settingsCloseTimeoutRef.current = null;
    }, 240);
  };

  const panelHeader = (
    panel: SettingsPanel,
    title: string
  ) => {
    const isOpen = openPanel === panel;

    return (
      <button
        type="button"
        onClick={() => setOpenPanel((currentPanel) => (currentPanel === panel ? null : panel))}
        className={`flex min-h-[54px] w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${
          isOpen
            ? "border-[#1b75a6] bg-[#1b75a6] text-white"
            : "border-slate-200 bg-[#eef3f7] text-slate-800 hover:border-[#1b75a6]/30 hover:bg-[#e7f2f7]"
        }`}
      >
        <span className="flex min-w-0 items-center">
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">{title}</span>
          </span>
        </span>
        <span className="shrink-0 text-xs font-bold">{isOpen ? "▴" : "▾"}</span>
      </button>
    );
  };

  const safeFilteredEdgeCount = Math.max(0, filteredEdgeCount);
  const minEdgeDisplayLimit = 0;
  const safeEdgeDisplayLimit = Math.min(
    safeFilteredEdgeCount,
    Number.isFinite(edgeDisplayLimit) && edgeDisplayLimit >= 0
      ? Math.floor(edgeDisplayLimit)
      : 0
  );
  const updateEdgeDisplayLimit = (value: number) => {
    if (!Number.isFinite(value)) return;
    const nextValue = Math.max(
      minEdgeDisplayLimit,
      Math.min(safeFilteredEdgeCount, Math.floor(value))
    );
    onChangeEdgeDisplayLimit(nextValue);
    return nextValue;
  };
  const adjustEdgeDisplayLimit = (delta: number) => {
    setEdgeDisplayDraft(null);
    updateEdgeDisplayLimit(safeEdgeDisplayLimit + delta);
  };
  const handleEdgeDisplayInputChange = (value: string) => {
    if (value.trim() === "") {
      setEdgeDisplayDraft("");
      onChangeEdgeDisplayLimit(0);
      return;
    }

    const nextValue = updateEdgeDisplayLimit(Number(value));
    if (nextValue !== undefined) {
      setEdgeDisplayDraft(String(nextValue));
    }
  };
  const matchingEdgesLabel = safeFilteredEdgeCount.toLocaleString();

  const inlinePercentControl = (
    value: number,
    onChange: (value: number) => void,
    label: string
  ) => (
    <div
      className="grid h-9 w-[146px] shrink-0 grid-cols-[32px_52px_30px_32px] overflow-hidden rounded-lg border border-slate-200 bg-white"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => adjustPercent(value, -5, onChange)}
        className="h-full text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-[#1b75a6]"
        aria-label={`Decrease ${label}`}
      >
        -
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={Math.round(value * 100)}
        onChange={(e) => updatePercent(Number(e.target.value), onChange)}
        className="h-full min-w-0 border-x border-slate-200 bg-white px-0 text-center text-sm font-bold tabular-nums text-slate-900 outline-none"
        aria-label={label}
      />
      <span className="flex h-full items-center justify-center border-r border-slate-200 text-xs font-bold text-slate-500">
        %
      </span>
      <button
        type="button"
        onClick={() => adjustPercent(value, 5, onChange)}
        className="h-full text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-[#1b75a6]"
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );

  const inlineMethodsControl = () => (
    <div
      className="grid h-9 w-[146px] shrink-0 grid-cols-[32px_82px_32px] overflow-hidden rounded-lg border border-slate-200 bg-white"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => adjustSupportingMethods(-1)}
        disabled={!isConsensusView || safeConsensusThreshold <= 1}
        className="h-full text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Decrease supporting methods"
      >
        -
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={safeConsensusThreshold}
        onChange={(e) => {
          const inputValue = Number(e.target.value);
          if (!Number.isFinite(inputValue)) return;
          const nextValue = Math.min(
            effectiveMaxConsensusThreshold,
            Math.max(1, inputValue)
          );
          onChangeConsensusThreshold(nextValue);
        }}
        disabled={!isConsensusView}
        className="h-full min-w-0 border-x border-slate-200 bg-white px-0 text-center text-sm font-bold tabular-nums text-slate-900 outline-none disabled:opacity-50"
        aria-label="Minimum supporting methods"
      />
      <button
        type="button"
        onClick={() => adjustSupportingMethods(1)}
        disabled={!isConsensusView || safeConsensusThreshold >= effectiveMaxConsensusThreshold}
        className="h-full text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Increase supporting methods"
      >
        +
      </button>
    </div>
  );

  const resultScopeControl = () => (
    <label
      className="relative block h-9 w-[146px] shrink-0"
      onClick={(event) => event.stopPropagation()}
    >
      <span className="sr-only">Result cluster</span>
      <select
        value={selectedResultScopeId}
        onChange={(event) => onChangeSelectedResultScopeId?.(event.target.value)}
        className="h-full w-full appearance-none rounded-lg border border-slate-200 bg-white py-0 pl-2 pr-7 text-center text-sm font-bold text-slate-900 outline-none transition hover:bg-slate-50 hover:text-[#1b75a6] focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
        style={{ textAlignLast: "center" }}
        aria-label="Result cluster"
      >
        {selectableResultScopes.map((scope) => (
          <option key={scope.id} value={scope.id}>
            {scope.type === "global"
              ? "Global"
              : `${scope.label}${scope.cellCount ? ` (${scope.cellCount})` : ""}`}
          </option>
        ))}
      </select>
      <span
        className="pointer-events-none absolute right-2.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center text-[10px] font-bold leading-none text-slate-500"
        aria-hidden="true"
      >
        ▾
      </span>
    </label>
  );

  const edgeDisplayControl = () => (
    <div
      className="grid h-9 w-[128px] shrink-0 grid-cols-[30px_68px_30px] overflow-hidden rounded-lg border border-slate-200 bg-white"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => adjustEdgeDisplayLimit(-10)}
        disabled={safeEdgeDisplayLimit <= minEdgeDisplayLimit}
        className="h-full text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Decrease shown edges"
      >
        -
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        max={safeFilteredEdgeCount}
        min={minEdgeDisplayLimit}
        value={edgeDisplayDraft ?? safeEdgeDisplayLimit}
        onChange={(e) => handleEdgeDisplayInputChange(e.target.value)}
        onFocus={() => setEdgeDisplayDraft(String(safeEdgeDisplayLimit))}
        onBlur={() => setEdgeDisplayDraft(null)}
        className="h-full min-w-0 border-x border-slate-200 bg-white px-0 text-center text-sm font-bold tabular-nums text-slate-900 outline-none"
        aria-label="Shown edges"
      />
      <button
        type="button"
        onClick={() => adjustEdgeDisplayLimit(10)}
        disabled={safeEdgeDisplayLimit >= safeFilteredEdgeCount}
        className="h-full text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-[#1b75a6]"
        aria-label="Increase shown edges"
      >
        +
      </button>
    </div>
  );

  const inlineRow = (
    title: string,
    control: ReactNode,
    subtitle?: string
  ) => (
    <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-[#eef3f7] px-3 py-2 text-left text-slate-800">
      <span className="flex min-w-0 items-center">
        <span className="min-w-0">
          <span className="block text-sm font-bold leading-tight">{title}</span>
          {subtitle && (
            <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-500">
              {subtitle}
            </span>
          )}
        </span>
      </span>
      {control}
    </div>
  );

  const sectionLabel = (title: string, accessory?: ReactNode) => (
    <div className="flex items-center justify-between gap-2 px-1 pb-0.5 pt-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </span>
      {accessory}
    </div>
  );

  const matchingEdgesBadge = (
    <span className="shrink-0 rounded-full border border-[#1b75a6]/20 bg-white px-2.5 py-1 text-[11px] font-bold tabular-nums text-[#1b75a6]">
      {matchingEdgesLabel} matching edges
    </span>
  );

  const compactSelect = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: Array<{ value: string; label: string }>
  ) => (
    <label className="relative min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full appearance-none rounded-xl border-2 border-slate-200 bg-white px-3.5 pr-9 text-[13px] font-bold text-slate-700 outline-none transition hover:border-[#1b75a6]/30 hover:bg-[#f8fcff] focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10"
        aria-label={label}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span
        className="pointer-events-none absolute right-3.5 top-1/2 h-2 w-2 -translate-y-[65%] rotate-45 border-b-2 border-r-2 border-slate-500"
        aria-hidden="true"
      />
    </label>
  );

  const edgeDisplayRow = (
    <div className="mt-3 border-t border-slate-200 pt-3">
      {sectionLabel(
        "Display limit",
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
          Network and table
        </span>
      )}
      {inlineRow(
        "Top-ranked edges",
        edgeDisplayControl(),
        `Showing top ${safeEdgeDisplayLimit.toLocaleString()} of ${matchingEdgesLabel} matching edges`
      )}
    </div>
  );

  return (
    <div
      ref={settingsMenuRef}
      className={
        compact
          ? "relative shrink-0 text-slate-900"
          : "relative rounded-[1.5rem] border border-slate-200 bg-white p-4 text-slate-900"
      }
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => (isSettingsMenuOpen ? closeSettings() : openSettings())}
          className={`inline-flex h-10 items-center gap-2 rounded-full border bg-white px-5 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#1b75a6]/10 ${
            isSettingsMenuOpen
              ? "border-[#1b75a6]/40 bg-[#f2f9fc] text-[#1b75a6]"
              : "border-slate-200 text-slate-700 hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
          }`}
        >
          <span
            className="inline-flex w-5 items-center justify-center text-[19px] leading-none text-[#1b75a6]"
            aria-hidden="true"
          >
            ⚙
          </span>
          <span>Results Settings</span>
          <span
            className={`ml-0.5 text-[11px] leading-none ${
              isSettingsMenuOpen ? "text-[#1b75a6]" : "text-slate-500"
            }`}
          >
            {isSettingsMenuOpen ? "▴" : "▾"}
          </span>
        </button>
      </div>

      {isSettingsMenuOpen && createPortal(
        <div className="fixed inset-0 z-[80]">
          <div
            className={`absolute inset-0 bg-slate-950/40 backdrop-blur-sm ${
              isSettingsClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
            }`}
            onMouseDown={closeSettings}
          />
          <div
            className={`absolute inset-y-0 right-0 w-[440px] max-w-[92vw] overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl shadow-slate-900/20 ${
              isSettingsClosing ? "animate-slide-out-right" : "animate-slide-in-right"
            }`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-950">Results settings</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenGuide}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] text-xs font-bold text-[#1b75a6] transition hover:border-[#1b75a6]/35 hover:bg-[#e8f5fb]"
                  aria-label="Open results controls guide"
                  title="Open results controls guide"
                >
                  ?
                </button>
                <button
                  type="button"
                  onClick={closeSettings}
                  aria-label="Close panel"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                >
                  ✕
                </button>
              </div>
            </div>
          <div className="space-y-1.5">
            {sectionLabel("Filters", matchingEdgesBadge)}
            {panelHeader("algorithms", "Algorithms")}
            {openPanel === "algorithms" && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="relative mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {compactSelect(
                    "Direction filter",
                    algorithmDirectionFilter,
                    (value) => setAlgorithmDirectionFilter(value as AlgorithmDirectionFilter),
                    [
                      { value: "all", label: "All directions" },
                      { value: "directed", label: "Directed" },
                      { value: "undirected", label: "Undirected" },
                    ]
                  )}
                  {compactSelect(
                    "Sign filter",
                    algorithmSignFilter,
                    (value) => setAlgorithmSignFilter(value as AlgorithmSignFilter),
                    [
                      { value: "all", label: "All signs" },
                      { value: "signed", label: "Signed" },
                      { value: "unsigned", label: "Unsigned" },
                    ]
                  )}
                  {compactSelect(
                    "Category filter",
                    algorithmCategoryFilter,
                    setAlgorithmCategoryFilter,
                    [
                      { value: "all", label: "All categories" },
                      ...completedAlgorithmCategories.map((category) => ({
                        value: category,
                        label: category,
                      })),
                    ]
                  )}
                  {hasAlgorithmFilter && (
                    <button
                      type="button"
                      onClick={resetAlgorithmFilters}
                      className="absolute right-0 top-[calc(100%+6px)] z-10 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-500 shadow-sm transition hover:border-[#1b75a6]/20 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                    >
                      Reset
                    </button>
                  )}
                </div>
                {filteredAlgorithmIds.length > 0 ? (
                  <div className="grid max-h-[170px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
                    {filteredAlgorithmIds.map((algorithmId) => {
                      const checked = selectedAlgorithmIds.includes(algorithmId);
                      const algorithmName =
                        algorithmMetaMap.get(algorithmId)?.name ?? algorithmId;

                      return (
                        <label
                          key={algorithmId}
                          className={`flex min-h-[46px] min-w-0 cursor-pointer items-center justify-center rounded-xl border-2 px-2 text-center text-[13px] font-bold transition ${
                            checked
                              ? "border-[#9cc8df] bg-[#f2f9fc] text-[#1b75a6]"
                              : "border-slate-200 bg-white text-slate-600 hover:border-[#9cc8df] hover:bg-[#f8fcff] hover:text-[#1b75a6]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAlgorithm(algorithmId)}
                            className="sr-only"
                          />
                          <span className="block min-w-0 truncate">{algorithmName}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-[11px] font-bold text-slate-500">
                    No completed algorithms match these filters.
                  </div>
                )}
              </div>
            )}

            {selectableResultScopes.length > 1 &&
              inlineRow("Result cluster", resultScopeControl())}
            {inlineRow(
              "Evidence",
              inlinePercentControl(
                safeEvidenceThreshold,
                onChangeEvidenceThreshold,
                "Evidence"
              )
            )}
            {inlineRow(
              "Confidence level",
              inlinePercentControl(
                safeConfidenceThreshold,
                onChangeConfidenceThreshold,
                "Confidence level"
              )
            )}
            {inlineRow(
              "Direction confidence",
              inlinePercentControl(
                safeDirectionThreshold,
                onChangeDirectionConfidenceThreshold,
                "Direction confidence"
              )
            )}
            {inlineRow(
              "Sign confidence",
              inlinePercentControl(safeSignThreshold, onChangeSignConfidenceThreshold, "Sign confidence")
            )}
            {inlineRow(
              "Minimum supporting methods",
              inlineMethodsControl()
            )}
            {edgeDisplayRow}
          </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
