import { useEffect, useMemo, useRef, useState } from "react";

type ResultsControlsSectionProps = {
  completedAlgorithmIds: string[];
  selectedAlgorithmIds: string[];
  onChangeSelectedAlgorithmIds: (value: string[]) => void;
  confidenceThreshold: number;
  onChangeConfidenceThreshold: (value: number) => void;
  consensusThreshold: number;
  maxConsensusThreshold: number;
  onChangeConsensusThreshold: (value: number) => void;
  isConsensusView: boolean;
  compact?: boolean;
  projectId?: string;
  onOpenGuide?: () => void;
};

export default function ResultsControlsSection({
  completedAlgorithmIds,
  selectedAlgorithmIds,
  onChangeSelectedAlgorithmIds,
  confidenceThreshold = 0.3,
  onChangeConfidenceThreshold = () => {},
  consensusThreshold,
  maxConsensusThreshold,
  onChangeConsensusThreshold,
  isConsensusView,
  compact = false,
  projectId,
  onOpenGuide,
}: ResultsControlsSectionProps) {
  const [isAlgorithmMenuOpen, setIsAlgorithmMenuOpen] = useState(false);
  const algorithmMenuRef = useRef<HTMLDivElement | null>(null);

  const algorithmButtonLabel = useMemo(() => {
    if (selectedAlgorithmIds.length === 0) return "Choose algorithms";
    if (selectedAlgorithmIds.length === completedAlgorithmIds.length) return "All algorithms";
    if (selectedAlgorithmIds.length === 1) return selectedAlgorithmIds[0];
    return `${selectedAlgorithmIds.length} algorithms selected`;
  }, [completedAlgorithmIds.length, selectedAlgorithmIds]);

  const effectiveMaxConsensusThreshold = Math.max(selectedAlgorithmIds.length, 1);
  const safeConfidenceThreshold = Number.isFinite(confidenceThreshold) ? confidenceThreshold : 0.8;

  const toggleAlgorithm = (algorithmId: string) => {
    const isSelected = selectedAlgorithmIds.includes(algorithmId);
    if (isSelected) {
      if (selectedAlgorithmIds.length === 1) return;
      onChangeSelectedAlgorithmIds(selectedAlgorithmIds.filter((id) => id !== algorithmId));
      return;
    }
    onChangeSelectedAlgorithmIds([...selectedAlgorithmIds, algorithmId]);
  };

  useEffect(() => {
    if (!isAlgorithmMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!algorithmMenuRef.current) return;
      if (!algorithmMenuRef.current.contains(event.target as Node)) {
        setIsAlgorithmMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isAlgorithmMenuOpen]);

  return (
    <div
      className={`border border-slate-200 bg-white text-slate-900 ${
        compact ? "rounded-[1.25rem] p-2" : "rounded-[1.5rem] p-3"
      }`}
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#1b75a6]">
          Results settings
        </p>
        <button
          type="button"
          onClick={onOpenGuide}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] text-xs font-bold text-[#1b75a6] transition hover:border-[#1b75a6]/35 hover:bg-[#e8f5fb]"
          aria-label="Open results controls guide"
          title="Open results controls guide"
        >
          ?
        </button>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <div
          ref={algorithmMenuRef}
          className={`relative min-w-0 rounded-[1rem] border border-slate-200 bg-slate-50/80 ${
            compact ? "px-3 py-2" : "px-4 py-3"
          }`}
        >
          {!compact && (
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Algorithms</p>
          )}
          <button
            type="button"
            onClick={() => setIsAlgorithmMenuOpen((prev) => !prev)}
            className={`flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 outline-none transition hover:border-[#1b75a6]/30 focus:border-[#1b75a6]/40 focus:ring-4 focus:ring-[#1b75a6]/10 ${
              compact ? "py-2" : "mt-2 py-2"
            }`}
          >
            <span className="truncate">{algorithmButtonLabel}</span>
            <span className="text-slate-500">▾</span>
          </button>
          {!compact && (
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Select algorithms to control the overlap view, network visualization, and edge table.
            </p>
          )}

          {isAlgorithmMenuOpen && (
            <div
              className={`absolute z-30 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/15 ${
                compact ? "left-3 right-3 top-[52px]" : "left-4 right-4 top-[76px]"
              }`}
            >
              <div className="mb-2 px-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Select one or more algorithms
              </div>
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {completedAlgorithmIds.map((algorithmId) => {
                  const checked = selectedAlgorithmIds.includes(algorithmId);
                  return (
                    <label
                      key={algorithmId}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAlgorithm(algorithmId)}
                        className="h-4 w-4 accent-[#1b75a6]"
                      />
                      <span>{algorithmId}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>



      <div
        className={`min-w-0 rounded-[1rem] border border-slate-200 bg-slate-50/80 ${
          compact ? "px-3 py-2" : "px-4 py-3"
        }`}
      >
        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.16em] text-[#1b75a6]">
          <span>Confidence level</span>
          <span>{Math.round(safeConfidenceThreshold * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(safeConfidenceThreshold * 100)}
          onChange={(e) => onChangeConfidenceThreshold(Number(e.target.value) / 100)}
          className={`${compact ? "mt-2" : "mt-3"} w-full accent-[#1b75a6]`}
        />
        {!compact && (
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Keep only edges whose inferred confidence is at least this threshold.
          </p>
        )}
      </div>

      <div
        className={`min-w-0 rounded-[1rem] border border-slate-200 bg-slate-50/80 ${
          compact ? "px-3 py-2" : "px-4 py-3"
        }`}
      >
        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.16em] text-[#1b75a6]">
          <span>Minimum Supporting Methods</span>
          <span>{consensusThreshold}</span>
        </div>
        <input
          type="range"
          min={1}
          max={effectiveMaxConsensusThreshold}
          value={Math.min(consensusThreshold, effectiveMaxConsensusThreshold)}
          onChange={(e) => onChangeConsensusThreshold(Number(e.target.value))}
          disabled={!isConsensusView}
          className={`${compact ? "mt-2" : "mt-3"} w-full accent-[#1b75a6] disabled:opacity-40`}
        />
        {!compact && (
          <p className="mt-2 text-xs leading-5 text-slate-500">
            An edge is included only if this many algorithms rank it above their individual median.
          </p>
        )}
      </div>
      </div>
    </div>
  );
}
