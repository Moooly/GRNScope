import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type ResultsControlsSectionProps = {
  completedAlgorithmIds: string[];
  selectedAlgorithmIds: string[];
  onChangeSelectedAlgorithmIds: (value: string[]) => void;
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
  compact?: boolean;
  projectId?: string;
  isGuideOpen?: boolean;
  onOpenGuide?: () => void;
};

type SettingsPanel = "algorithms";

export default function ResultsControlsSection({
  completedAlgorithmIds,
  selectedAlgorithmIds,
  onChangeSelectedAlgorithmIds,
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
  compact = false,
  isGuideOpen = false,
  onOpenGuide,
}: ResultsControlsSectionProps) {
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState<SettingsPanel | null>(null);
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

  useEffect(() => {
    if (!isSettingsMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (isGuideOpen) return;
      if (!settingsMenuRef.current) return;
      if (!settingsMenuRef.current.contains(event.target as Node)) {
        setIsSettingsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isGuideOpen, isSettingsMenuOpen]);

  const panelHeader = (
    panel: SettingsPanel,
    title: string
  ) => {
    const isOpen = openPanel === panel;

    return (
      <button
        type="button"
        onClick={() => setOpenPanel((currentPanel) => (currentPanel === panel ? null : panel))}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
          isOpen
            ? "border-[#1b75a6] bg-[#1b75a6] text-white shadow-sm"
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

  const algorithmSelectionSummary =
    selectedAlgorithmIds.length === completedAlgorithmIds.length
      ? "All selected"
      : `${selectedAlgorithmIds.length}/${completedAlgorithmIds.length} selected`;

  const inlinePercentControl = (
    value: number,
    onChange: (value: number) => void,
    label: string
  ) => (
    <div
      className="flex h-9 w-[132px] shrink-0 items-center overflow-hidden rounded-lg border border-slate-200 bg-white"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => adjustPercent(value, -5, onChange)}
        className="h-full w-8 shrink-0 text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-[#1b75a6]"
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
        className="h-full min-w-0 flex-1 border-x border-slate-200 bg-white px-1 text-center text-sm font-bold text-slate-900 outline-none"
        aria-label={label}
      />
      <span className="px-1 text-xs font-bold text-slate-500">%</span>
      <button
        type="button"
        onClick={() => adjustPercent(value, 5, onChange)}
        className="h-full w-8 shrink-0 text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-[#1b75a6]"
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );

  const inlineMethodsControl = () => (
    <div
      className="flex h-9 w-[132px] shrink-0 items-center overflow-hidden rounded-lg border border-slate-200 bg-white"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => adjustSupportingMethods(-1)}
        disabled={!isConsensusView || safeConsensusThreshold <= 1}
        className="h-full w-8 shrink-0 text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-35"
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
        className="h-full min-w-0 flex-1 border-x border-slate-200 bg-white px-1 text-center text-sm font-bold text-slate-900 outline-none disabled:opacity-50"
        aria-label="Minimum supporting methods"
      />
      <button
        type="button"
        onClick={() => adjustSupportingMethods(1)}
        disabled={!isConsensusView || safeConsensusThreshold >= effectiveMaxConsensusThreshold}
        className="h-full w-8 shrink-0 text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Increase supporting methods"
      >
        +
      </button>
    </div>
  );

  const inlineRow = (
    title: string,
    control: ReactNode
  ) => (
    <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-[#eef3f7] px-3 py-2 text-left text-slate-800">
      <span className="flex min-w-0 items-center">
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold">{title}</span>
        </span>
      </span>
      {control}
    </div>
  );

  return (
    <div
      ref={settingsMenuRef}
      className={
        compact
          ? "relative shrink-0 text-slate-900"
          : "relative rounded-[1.5rem] border border-slate-200 bg-white p-4 text-slate-900 shadow-sm"
      }
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsSettingsMenuOpen((value) => !value)}
          className={`inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold transition ${
            isSettingsMenuOpen
              ? "bg-[#1b75a6] text-white shadow-sm"
              : "border border-slate-200 bg-slate-50 text-slate-900 hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc]"
          }`}
        >
          <span
            className={`inline-flex w-5 items-center justify-center text-2xl leading-none ${
              isSettingsMenuOpen ? "text-white/90" : "text-[#1b75a6]"
            }`}
            aria-hidden="true"
          >
            ⚙
          </span>
          <span>Results Settings</span>
          <span className="text-xs">{isSettingsMenuOpen ? "▴" : "▾"}</span>
        </button>
      </div>

      {isSettingsMenuOpen && (
        <div className="absolute right-0 top-[48px] z-40 w-[min(90vw,400px)] rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/20">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-2 py-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#1b75a6]">
                Results settings
              </p>
              <button
                type="button"
                onClick={onOpenGuide}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#1b75a6]/20 bg-[#f2f9fc] text-xs font-bold text-[#1b75a6] transition hover:border-[#1b75a6]/35 hover:bg-[#e8f5fb]"
                aria-label="Open results controls guide"
                title="Open results controls guide"
              >
                ?
              </button>
            </div>
            {panelHeader("algorithms", "Algorithms")}
            {openPanel === "algorithms" && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-2">
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    {algorithmSelectionSummary}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChangeSelectedAlgorithmIds([...completedAlgorithmIds])}
                    className="rounded-full border border-[#1b75a6]/20 bg-white px-2 py-1 text-[10px] font-bold text-[#1b75a6] transition hover:bg-[#f2f9fc]"
                  >
                    Select all
                  </button>
                </div>
                <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
                  {completedAlgorithmIds.map((algorithmId) => {
                    const checked = selectedAlgorithmIds.includes(algorithmId);
                    return (
                      <label
                        key={algorithmId}
                        className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-xs font-bold transition ${
                          checked
                            ? "border-[#1b75a6]/25 bg-[#f2f9fc] text-[#1b75a6]"
                            : "border-transparent bg-white text-slate-600 hover:border-[#1b75a6]/20 hover:text-[#1b75a6]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAlgorithm(algorithmId)}
                          className="h-3.5 w-3.5 shrink-0 accent-[#1b75a6]"
                        />
                        <span className="min-w-0 truncate">{algorithmId}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

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
          </div>
        </div>
      )}
    </div>
  );
}
