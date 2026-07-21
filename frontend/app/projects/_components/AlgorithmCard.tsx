import type { KeyboardEvent, MouseEvent } from "react";
import type { ProjectAlgorithm } from "../page";

interface AlgorithmCardProps {
  algorithm: ProjectAlgorithm;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  showCheckbox?: boolean;
  onToggleExpanded?: () => void;
  expanded?: boolean;
  isCustomized?: boolean;
}

export default function AlgorithmCard({
  algorithm,
  checked,
  disabled,
  onToggle,
  showCheckbox = true,
  onToggleExpanded,
  expanded = false,
  isCustomized = false,
}: AlgorithmCardProps) {
  const paramCount = algorithm.parameters?.length ?? 0;
  const hasParameters = paramCount > 0;
  const canExpand = hasParameters && checked && !disabled && Boolean(onToggleExpanded);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onToggle();
    }
  };

  const handleChevronClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleExpanded?.();
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-pressed={checked}
      onClick={disabled ? undefined : onToggle}
      onKeyDown={handleKeyDown}
      className={`group relative flex min-h-[3.25rem] w-full items-center gap-2 rounded-2xl pl-2 pr-1.5 py-2.5 text-left transition duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#1b75a6]/40 focus-visible:ring-offset-1 ${
        disabled
          ? "cursor-not-allowed border border-slate-200 bg-slate-50 opacity-60"
          : expanded
            ? "cursor-pointer border-2 border-[#1b75a6] bg-[#f2f9fc]"
            : checked
              ? "cursor-pointer border border-[#1b75a6]/40 bg-[#f2f9fc]"
              : "cursor-pointer border border-slate-200 bg-white hover:border-[#1b75a6]/30 hover:bg-[#f8fbfd]"
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
          className="break-words text-sm font-semibold leading-tight tracking-[-0.01em] text-slate-950"
          title={algorithm.name}
        >
          {algorithm.name}
        </h3>
      </div>

      {canExpand ? (
        <button
          type="button"
          onClick={handleChevronClick}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.stopPropagation();
            }
          }}
          aria-label={expanded ? `Collapse ${algorithm.name} parameters` : `Expand ${algorithm.name} parameters`}
          aria-expanded={expanded}
          title={expanded ? "Collapse parameters" : "Expand parameters"}
          className={`relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b75a6]/40 ${
            expanded
              ? "border-[#1b75a6]/40 bg-white text-[#1b75a6]"
              : "border-transparent text-slate-400 hover:border-[#1b75a6]/30 hover:bg-white hover:text-[#1b75a6]"
          }`}
        >
          <svg
            viewBox="0 0 12 12"
            className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            aria-hidden="true"
          >
            <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {isCustomized ? (
            <span
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#1b75a6] ring-2 ring-[#f2f9fc]"
              aria-label="edited"
            />
          ) : null}
        </button>
      ) : null}
    </div>
  );
}
