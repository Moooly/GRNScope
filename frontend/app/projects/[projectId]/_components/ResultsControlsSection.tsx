import { useEffect, useMemo, useRef, useState } from "react";

type ResultsControlsSectionProps = {
  completedAlgorithmIds: string[];
  selectedAlgorithmIds: string[];
  onChangeSelectedAlgorithmIds: (value: string[]) => void;
  topN: number;
  maxAvailableTopN: number;
  onChangeTopN: (value: number) => void;
  consensusThreshold: number;
  maxConsensusThreshold: number;
  onChangeConsensusThreshold: (value: number) => void;
  isConsensusView: boolean;
};

export default function ResultsControlsSection({
  completedAlgorithmIds,
  selectedAlgorithmIds,
  onChangeSelectedAlgorithmIds,
  topN,
  maxAvailableTopN,
  onChangeTopN,
  consensusThreshold,
  maxConsensusThreshold,
  onChangeConsensusThreshold,
  isConsensusView,
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
    <div className="flex flex-wrap items-stretch gap-3 rounded-[1.5rem] border border-white/10 bg-slate-950/90 p-3 shadow-[0_18px_50px_rgba(2,6,23,0.45)] backdrop-blur-md">
      <div
        ref={algorithmMenuRef}
        className="relative rounded-[1.25rem] border border-white/10 bg-slate-950/60 px-4 py-3"
      >
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Algorithms</p>
        <button
          type="button"
          onClick={() => setIsAlgorithmMenuOpen((prev) => !prev)}
          className="mt-2 flex w-[260px] items-center justify-between rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-white outline-none"
        >
          <span className="truncate">{algorithmButtonLabel}</span>
          <span className="text-slate-400">▾</span>
        </button>
        <p className="mt-2 max-w-[260px] text-xs leading-5 text-slate-500">
          Select algorithms to control the overlap view, network visualization, and edge table.
        </p>

        {isAlgorithmMenuOpen && (
          <div className="absolute left-4 top-[76px] z-30 w-[260px] rounded-xl border border-white/10 bg-slate-950 p-2 shadow-2xl">
            <div className="mb-2 px-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
              Select one or more algorithms
            </div>
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {completedAlgorithmIds.map((algorithmId) => {
                const checked = selectedAlgorithmIds.includes(algorithmId);
                return (
                  <label
                    key={algorithmId}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm text-white hover:bg-white/[0.04]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAlgorithm(algorithmId)}
                      className="h-4 w-4 accent-teal-400"
                    />
                    <span>{algorithmId}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="min-w-[260px] flex-1 rounded-[1.25rem] border border-white/10 bg-slate-950/60 px-4 py-3">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-slate-500">
          <span>Top-N edges per algorithm</span>
          <span>
            {Math.min(topN, maxAvailableTopN).toLocaleString()} / {maxAvailableTopN.toLocaleString()}
          </span>
        </div>
        <input
          key={`${selectedAlgorithmIds.join(",")}-${maxAvailableTopN}`}
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
          max={effectiveMaxConsensusThreshold}
          value={Math.min(consensusThreshold, effectiveMaxConsensusThreshold)}
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