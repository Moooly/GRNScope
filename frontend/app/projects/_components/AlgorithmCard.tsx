import type { KeyboardEvent } from "react";
import type { ProjectAlgorithm } from "../page";

interface AlgorithmCardProps {
  algorithm: ProjectAlgorithm;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  showCheckbox?: boolean;
  onConfigure?: () => void;
  isCustomized?: boolean;
}

export default function AlgorithmCard({
  algorithm,
  checked,
  disabled,
  onToggle,
  showCheckbox = true,
  onConfigure,
  isCustomized = false,
}: AlgorithmCardProps) {
  const hasParameters = (algorithm.parameters?.length ?? 0) > 0;
  const showGear = hasParameters && Boolean(onConfigure);
  // Keep the gear visible when the card is selected or has been customized so
  // the control (and the "customized" dot) is discoverable without hovering.
  const gearAlwaysVisible = checked || isCustomized;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    // Spacebar / Enter toggle selection — same as the click target on the card.
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-pressed={checked}
      onClick={disabled ? undefined : onToggle}
      onKeyDown={handleKeyDown}
      className={`group relative flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#1b75a6]/40 focus-visible:ring-offset-1 ${
        disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
          : checked
            ? "cursor-pointer border-[#1b75a6]/40 bg-[#f2f9fc]"
            : "cursor-pointer border-slate-200 bg-white hover:border-[#1b75a6]/30 hover:bg-[#f8fbfd]"
      }`}
    >
      {showCheckbox && (
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
            checked
              ? "border-[#1b75a6] bg-[#1b75a6]"
              : "border-slate-300 bg-white"
          }`}
        >
          {checked && (
            <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
              <path
                d="M3.4 8.1 6.5 11.2 12.8 4.8"
                fill="none"
                stroke="white"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <h3
          className="whitespace-nowrap text-sm font-semibold text-slate-950"
          title={algorithm.name}
        >
          {algorithm.name}
        </h3>
      </div>

      {showGear ? (
        <div className="flex h-7 w-8 shrink-0 items-center justify-end border-l border-slate-200/80 pl-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onConfigure?.();
            }}
            onKeyDown={(event) => {
              // Don't let space/enter on the gear bubble up and toggle the card.
              if (event.key === " " || event.key === "Enter") {
                event.stopPropagation();
              }
            }}
            aria-label={`Configure ${algorithm.name}`}
            title={`Configure ${algorithm.name}`}
            className={`relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent text-slate-400 transition hover:border-[#1b75a6]/30 hover:bg-[#e8f5fb] hover:text-[#1b75a6] focus-visible:border-[#1b75a6]/30 focus-visible:bg-[#e8f5fb] focus-visible:text-[#1b75a6] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b75a6]/40 ${
              gearAlwaysVisible
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {isCustomized ? (
              <span
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#1b75a6] ring-2 ring-white"
                aria-hidden="true"
              />
            ) : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}
