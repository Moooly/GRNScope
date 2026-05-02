import type { KeyboardEvent } from "react";
import type { ProjectAlgorithm } from "../page";

interface AlgorithmCardProps {
  algorithm: ProjectAlgorithm;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  showCheckbox?: boolean;
  onInfoClick?: () => void;
}

export default function AlgorithmCard({
  algorithm,
  checked,
  disabled,
  onToggle,
  showCheckbox = true,
  onInfoClick,
}: AlgorithmCardProps) {
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
        <h3 className="whitespace-nowrap text-sm font-semibold text-slate-950">
          {algorithm.name}
        </h3>
      </div>

      {onInfoClick && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onInfoClick();
          }}
          onKeyDown={(event) => {
            // Don't let space/enter on the info button bubble up and toggle
            // the card.
            if (event.key === " " || event.key === "Enter") {
              event.stopPropagation();
            }
          }}
          aria-label={`View details for ${algorithm.name}`}
          title={`View details for ${algorithm.name}`}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent text-xs font-semibold text-slate-400 opacity-0 transition group-hover:border-slate-200 group-hover:bg-white group-hover:text-slate-500 group-hover:opacity-100 group-focus-within:border-slate-200 group-focus-within:bg-white group-focus-within:text-slate-500 group-focus-within:opacity-100 hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b75a6]/40"
        >
          i
        </button>
      )}
    </div>
  );
}
