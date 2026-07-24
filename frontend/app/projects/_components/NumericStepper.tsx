"use client";

interface NumericStepperProps {
  value: string;
  onChange: (value: string) => void;
  onStep?: (value: string) => void;
  onBlur?: () => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  ariaLabel: string;
  className?: string;
  invalid?: boolean;
}

function decimalPlaces(value: number) {
  const text = String(value).toLowerCase();
  if (text.includes("e-")) return Number(text.split("e-")[1]) || 0;
  return text.includes(".") ? text.split(".")[1].length : 0;
}

function clamp(value: number, min?: number, max?: number) {
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));
}

export default function NumericStepper({
  value,
  onChange,
  onStep,
  onBlur,
  min,
  max,
  step = 1,
  suffix,
  ariaLabel,
  className = "w-[132px]",
  invalid = false,
}: NumericStepperProps) {
  const numericValue = Number(value);
  const hasNumericValue = value.trim() !== "" && Number.isFinite(numericValue);
  const atMinimum = hasNumericValue && min !== undefined && numericValue <= min;
  const atMaximum = hasNumericValue && max !== undefined && numericValue >= max;

  const adjust = (direction: -1 | 1) => {
    const fallback = direction > 0 ? (min ?? 0) - step : max ?? min ?? step;
    const base = hasNumericValue ? numericValue : fallback;
    const next = clamp(base + direction * step, min, max);
    const nextValue = String(Number(next.toFixed(decimalPlaces(step))));
    onChange(nextValue);
    onStep?.(nextValue);
  };

  return (
    <div
      className={`grid h-10 shrink-0 overflow-hidden rounded-lg border bg-white ${
        suffix ? "grid-cols-[34px_minmax(52px,1fr)_28px_34px]" : "grid-cols-[34px_minmax(58px,1fr)_34px]"
      } ${invalid ? "border-rose-300" : "border-slate-200"} ${className}`}
    >
      <button
        type="button"
        onClick={() => adjust(-1)}
        disabled={atMinimum}
        className="h-full cursor-pointer text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-35"
        aria-label={`Decrease ${ariaLabel}`}
      >
        −
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className="h-full min-w-0 border-x border-slate-200 bg-white px-1 text-center text-sm font-bold tabular-nums text-slate-900 outline-none"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
      />
      {suffix ? (
        <span className="flex h-full items-center justify-center border-r border-slate-200 text-xs font-bold text-slate-500">
          {suffix}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => adjust(1)}
        disabled={atMaximum}
        className="h-full cursor-pointer text-sm font-bold text-slate-500 transition hover:bg-slate-50 hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-35"
        aria-label={`Increase ${ariaLabel}`}
      >
        +
      </button>
    </div>
  );
}
