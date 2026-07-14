"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { AlgorithmParameter, ProjectAlgorithm } from "../page";

interface AlgorithmSettingsPopoverProps {
  algorithm: ProjectAlgorithm | null;
  anchorElement: HTMLButtonElement | null;
  currentOverrides: Record<string, unknown>;
  onApply: (algorithmId: string, overrides: Record<string, unknown>) => void;
  onClose: () => void;
}

type DraftValue = string | boolean;
type Draft = Record<string, DraftValue>;

const NUMBER_TYPES = new Set(["int", "integer", "float", "number", "double"]);
const INTEGER_TYPES = new Set(["int", "integer"]);
const BOOL_TYPES = new Set(["bool", "boolean"]);

function isNumberParam(parameter: AlgorithmParameter) {
  return NUMBER_TYPES.has(String(parameter.value_type ?? "").toLowerCase());
}

function isIntegerParam(parameter: AlgorithmParameter) {
  return INTEGER_TYPES.has(String(parameter.value_type ?? "").toLowerCase());
}

function isBoolParam(parameter: AlgorithmParameter) {
  return BOOL_TYPES.has(String(parameter.value_type ?? "").toLowerCase());
}

function initialDraftValue(
  parameter: AlgorithmParameter,
  override: unknown,
): DraftValue {
  const raw = override !== undefined ? override : parameter.default;
  if (isBoolParam(parameter)) return Boolean(raw);
  return raw === null || raw === undefined ? "" : String(raw);
}

function defaultAsString(parameter: AlgorithmParameter): string {
  if (isBoolParam(parameter)) return String(Boolean(parameter.default));
  return parameter.default === null || parameter.default === undefined
    ? ""
    : String(parameter.default);
}

function defaultHint(parameter: AlgorithmParameter): string {
  if (isBoolParam(parameter)) return Boolean(parameter.default) ? "On" : "Off";
  return defaultAsString(parameter) || "—";
}

function numericHint(parameter: AlgorithmParameter): string | null {
  if (!isNumberParam(parameter)) return null;
  if (
    typeof parameter.minimum === "number" &&
    typeof parameter.maximum === "number"
  ) {
    return `${parameter.minimum}–${parameter.maximum}`;
  }
  if (typeof parameter.minimum === "number") return `≥ ${parameter.minimum}`;
  if (typeof parameter.maximum === "number") return `≤ ${parameter.maximum}`;
  return null;
}

function validateDraftValue(
  parameter: AlgorithmParameter,
  raw: DraftValue | undefined,
): string | null {
  if (isBoolParam(parameter)) return null;

  const text = String(raw ?? "").trim();
  if (text === "") {
    return parameter.required && parameter.default == null
      ? "Required."
      : null;
  }

  if (isNumberParam(parameter)) {
    const value = Number(text);
    if (!Number.isFinite(value)) return "Enter a valid number.";
    if (isIntegerParam(parameter) && !Number.isInteger(value)) {
      return "Use a whole number.";
    }
    if (typeof parameter.minimum === "number" && value < parameter.minimum) {
      return `Minimum ${parameter.minimum}.`;
    }
    if (typeof parameter.maximum === "number" && value > parameter.maximum) {
      return `Maximum ${parameter.maximum}.`;
    }
  }

  if (
    parameter.options?.length &&
    !parameter.options.some((option) => String(option) === text)
  ) {
    return "Choose a listed option.";
  }

  return null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export default function AlgorithmSettingsPopover({
  algorithm,
  anchorElement,
  currentOverrides,
  onApply,
  onClose,
}: AlgorithmSettingsPopoverProps) {
  const parameters = useMemo(() => algorithm?.parameters ?? [], [algorithm]);
  const basicParameters = parameters.filter((parameter) => !parameter.advanced);
  const advancedParameters = parameters.filter((parameter) => parameter.advanced);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const arrowRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!algorithm) return;
    const next: Draft = {};
    for (const parameter of algorithm.parameters ?? []) {
      next[parameter.name] = initialDraftValue(
        parameter,
        currentOverrides[parameter.name],
      );
    }
    setDraft(next);
    setShowAdvanced(
      (algorithm.parameters ?? []).some(
        (parameter) =>
          parameter.advanced && currentOverrides[parameter.name] !== undefined,
      ),
    );
    // Re-seed only when a different algorithm opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algorithm]);

  const positionPopover = useCallback(() => {
    const panel = panelRef.current;
    const arrow = arrowRef.current;
    if (!panel || !arrow || !anchorElement) return;
    if (!anchorElement.isConnected) {
      onClose();
      return;
    }

    const margin = 12;
    const gap = 10;
    const anchorRect = anchorElement.getBoundingClientRect();
    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;
    const roomBelow = window.innerHeight - anchorRect.bottom;
    const opensBelow =
      roomBelow >= panelHeight + gap || roomBelow >= anchorRect.top;
    const unclampedTop = opensBelow
      ? anchorRect.bottom + gap
      : anchorRect.top - panelHeight - gap;
    const top = clamp(
      unclampedTop,
      margin,
      window.innerHeight - panelHeight - margin,
    );
    const left = clamp(
      anchorRect.right - panelWidth,
      margin,
      window.innerWidth - panelWidth - margin,
    );
    const arrowLeft = clamp(
      anchorRect.left + anchorRect.width / 2 - left - 6,
      18,
      panelWidth - 30,
    );

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.visibility = "visible";
    arrow.style.left = `${arrowLeft}px`;
    arrow.style.top = opensBelow ? "-6px" : "auto";
    arrow.style.bottom = opensBelow ? "auto" : "-6px";
  }, [anchorElement, onClose]);

  useLayoutEffect(() => {
    if (!algorithm || !anchorElement) return;
    positionPopover();

    const panel = panelRef.current;
    const resizeObserver =
      panel && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(positionPopover)
        : null;
    if (panel) resizeObserver?.observe(panel);

    window.addEventListener("resize", positionPopover);
    document.addEventListener("scroll", positionPopover, true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", positionPopover);
      document.removeEventListener("scroll", positionPopover, true);
    };
  }, [algorithm, anchorElement, positionPopover]);

  useEffect(() => {
    if (!algorithm || !anchorElement) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorElement.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [algorithm, anchorElement, onClose]);

  const changedNames = useMemo(
    () =>
      parameters
        .filter((parameter) => {
          const current = draft[parameter.name];
          return (
            current !== undefined &&
            String(current) !== defaultAsString(parameter)
          );
        })
        .map((parameter) => parameter.name),
    [draft, parameters],
  );

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const parameter of parameters) {
      const error = validateDraftValue(parameter, draft[parameter.name]);
      if (error) errors[parameter.name] = error;
    }
    return errors;
  }, [draft, parameters]);

  if (!algorithm || !anchorElement || typeof document === "undefined") {
    return null;
  }

  const setField = (name: string, value: DraftValue) => {
    setDraft((current) => ({ ...current, [name]: value }));
  };

  const resetToDefaults = () => {
    const next: Draft = {};
    for (const parameter of parameters) {
      next[parameter.name] = initialDraftValue(parameter, undefined);
    }
    setDraft(next);
  };

  const handleApply = () => {
    if (Object.keys(fieldErrors).length > 0) return;
    const overrides: Record<string, unknown> = {};

    for (const parameter of parameters) {
      const raw = draft[parameter.name];
      if (raw === undefined) continue;

      if (isBoolParam(parameter)) {
        const value = Boolean(raw);
        if (String(value) !== defaultAsString(parameter)) {
          overrides[parameter.name] = value;
        }
        continue;
      }

      if (isNumberParam(parameter)) {
        const text = String(raw).trim();
        if (text === "") continue;
        const value = Number(text);
        if (String(value) !== String(Number(defaultAsString(parameter)))) {
          overrides[parameter.name] = value;
        }
        continue;
      }

      const value = String(raw);
      if (value !== defaultAsString(parameter)) {
        overrides[parameter.name] = value;
      }
    }

    onApply(algorithm.id, overrides);
    onClose();
  };

  const renderField = (parameter: AlgorithmParameter) => {
    const value = draft[parameter.name];
    const error = fieldErrors[parameter.name];
    const hint = numericHint(parameter);
    const options = parameter.options ?? [];
    const fieldId = `popover-${algorithm.id}-${parameter.name}`;
    const errorId = `${fieldId}-error`;
    const controlClass = `w-full rounded-lg border bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:ring-2 ${
      error
        ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
        : "border-slate-200 focus:border-[#1b75a6]/50 focus:ring-[#1b75a6]/15"
    }`;

    return (
      <div key={parameter.name} className="py-2.5 first:pt-0 last:pb-0">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={fieldId} className="text-xs font-semibold text-slate-800">
            {parameter.label ?? parameter.name}
          </label>
          <span className="shrink-0 text-[10px] text-slate-400">
            Default {defaultHint(parameter)}
          </span>
        </div>

        <div className="mt-1.5">
          {isBoolParam(parameter) ? (
            <button
              id={fieldId}
              type="button"
              role="switch"
              aria-checked={Boolean(value)}
              onClick={() => setField(parameter.name, !Boolean(value))}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                value ? "bg-[#1b75a6]" : "bg-slate-300"
              }`}
            >
              <span
                className={`h-4 w-4 rounded-full bg-white shadow-sm transition ${
                  value ? "translate-x-[1.1rem]" : "translate-x-0.5"
                }`}
              />
            </button>
          ) : options.length > 0 ? (
            <select
              id={fieldId}
              value={String(value ?? "")}
              onChange={(event) => setField(parameter.name, event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              className={controlClass}
            >
              {options.map((option) => (
                <option key={String(option)} value={String(option)}>
                  {String(option)}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={fieldId}
              type={isNumberParam(parameter) ? "number" : "text"}
              value={String(value ?? "")}
              min={isNumberParam(parameter) ? parameter.minimum : undefined}
              max={isNumberParam(parameter) ? parameter.maximum : undefined}
              step={isNumberParam(parameter) ? parameter.step : undefined}
              onChange={(event) => setField(parameter.name, event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              className={controlClass}
            />
          )}
        </div>

        <div className="mt-1 flex min-h-3 items-start justify-between gap-2">
          {error ? (
            <p id={errorId} className="text-[10px] font-medium text-rose-600">
              {error}
            </p>
          ) : (
            <span />
          )}
          {hint ? <p className="shrink-0 text-[10px] text-slate-400">{hint}</p> : null}
        </div>
      </div>
    );
  };

  const hasErrors = Object.keys(fieldErrors).length > 0;
  const titleId = `algorithm-settings-${algorithm.id}`;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="fixed z-[140] w-[min(22rem,calc(100vw-1.5rem))] text-slate-900"
      style={{ visibility: "hidden" }}
    >
      <div
        ref={arrowRef}
        aria-hidden="true"
        className="absolute z-0 h-3 w-3 rotate-45 border border-slate-200 bg-white"
      />
      <div className="relative z-10 flex max-h-[min(32rem,calc(100vh-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/20">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <p id={titleId} className="text-sm font-bold text-slate-900">
            {algorithm.name} settings
          </p>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            {changedNames.length === 0
              ? "Defaults"
              : `${changedNames.length} changed`}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="divide-y divide-slate-100">
            {basicParameters.map(renderField)}
          </div>

          {advancedParameters.length > 0 ? (
            <div className="mt-2 border-t border-slate-200 pt-2">
              <button
                type="button"
                onClick={() => setShowAdvanced((current) => !current)}
                className="flex w-full items-center justify-between py-1.5 text-xs font-semibold text-slate-600 transition hover:text-[#1b75a6]"
                aria-expanded={showAdvanced}
              >
                <span>Advanced ({advancedParameters.length})</span>
                <span
                  className={`transition ${showAdvanced ? "rotate-180" : ""}`}
                  aria-hidden="true"
                >
                  ▾
                </span>
              </button>
              {showAdvanced ? (
                <div className="mt-1 divide-y divide-slate-100">
                  {advancedParameters.map(renderField)}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-4 py-2.5">
          <button
            type="button"
            onClick={resetToDefaults}
            className="rounded-full px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-white hover:text-[#1b75a6]"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={hasErrors}
            className="rounded-full bg-[#1b75a6] px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#155f87] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
