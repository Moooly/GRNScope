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

function numericHint(parameter: AlgorithmParameter): string | null {
  if (!isNumberParam(parameter)) return null;
  const lower =
    typeof parameter.exclusive_minimum === "number"
      ? `> ${parameter.exclusive_minimum}`
      : typeof parameter.minimum === "number"
        ? `≥ ${parameter.minimum}`
        : null;
  const upper =
    typeof parameter.exclusive_maximum === "number"
      ? `< ${parameter.exclusive_maximum}`
      : typeof parameter.maximum === "number"
        ? `≤ ${parameter.maximum}`
        : null;
  return [lower, upper].filter(Boolean).join(" and ") || null;
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
    if (
      typeof parameter.exclusive_minimum === "number" &&
      value <= parameter.exclusive_minimum
    ) {
      return `Must be greater than ${parameter.exclusive_minimum}.`;
    }
    if (
      typeof parameter.exclusive_maximum === "number" &&
      value >= parameter.exclusive_maximum
    ) {
      return `Must be less than ${parameter.exclusive_maximum}.`;
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<Draft>({});

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
    // Re-seed only when a different algorithm opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algorithm]);

  const positionPopover = useCallback(() => {
    const panel = panelRef.current;
    if (!panel || !anchorElement) return;
    if (!anchorElement.isConnected) {
      onClose();
      return;
    }

    const margin = 12;
    const gap = 10;
    const anchorRect = anchorElement.getBoundingClientRect();
    const modalElement = anchorElement.closest<HTMLElement>(
      "[data-create-project-modal]",
    );
    const modalRect = modalElement?.getBoundingClientRect();
    const boundaryTop = Math.max(margin, modalRect?.top ?? margin);
    const boundaryRight = Math.min(
      window.innerWidth - margin,
      modalRect?.right ?? window.innerWidth - margin,
    );
    const boundaryBottom = Math.min(
      window.innerHeight - margin,
      modalRect?.bottom ?? window.innerHeight - margin,
    );
    const boundaryLeft = Math.max(margin, modalRect?.left ?? margin);
    panel.style.maxHeight = `${Math.max(
      0,
      boundaryBottom - boundaryTop,
    )}px`;

    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;
    const roomBelow = boundaryBottom - anchorRect.bottom;
    const roomAbove = anchorRect.top - boundaryTop;
    const opensBelow =
      roomBelow >= panelHeight + gap || roomBelow >= roomAbove;
    const unclampedTop = opensBelow
      ? anchorRect.bottom + gap
      : anchorRect.top - panelHeight - gap;
    const rightAlignedX = anchorRect.right - panelWidth;
    const leftAlignedX = anchorRect.left;
    // Right-align popover to the anchor by default (current behaviour), but
    // flip to left-align when there isn't enough room to the anchor's left —
    // this avoids the popover being clamped flush against the modal edge for
    // cards near the left side.
    const preferredLeft =
      rightAlignedX >= boundaryLeft ? rightAlignedX : leftAlignedX;
    const viewportLeft = clamp(
      preferredLeft,
      boundaryLeft,
      boundaryRight - panelWidth,
    );
    const viewportTop = modalElement
      ? unclampedTop
      : clamp(
          unclampedTop,
          boundaryTop,
          boundaryBottom - panelHeight,
        );

    panel.style.left = modalElement
      ? `${
          viewportLeft -
          (modalRect?.left ?? 0) -
          modalElement.clientLeft +
          modalElement.scrollLeft
        }px`
      : `${viewportLeft}px`;
    panel.style.top = modalElement
      ? `${
          viewportTop -
          (modalRect?.top ?? 0) -
          modalElement.clientTop +
          modalElement.scrollTop
        }px`
      : `${viewportTop}px`;
    panel.style.visibility = "visible";
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

    const modalElement = anchorElement.closest<HTMLElement>(
      "[data-create-project-modal]",
    );
    window.addEventListener("resize", positionPopover);
    if (!modalElement) {
      document.addEventListener("scroll", positionPopover, true);
    }
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", positionPopover);
      if (!modalElement) {
        document.removeEventListener("scroll", positionPopover, true);
      }
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

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const parameter of parameters) {
      const error = validateDraftValue(parameter, draft[parameter.name]);
      if (error) errors[parameter.name] = error;
    }

    if (algorithm?.id === "SINGE") {
      const timeResolution = Number(draft.dT);
      const lagCount = Number(draft.num_lags);
      if (
        Number.isFinite(timeResolution) &&
        Number.isFinite(lagCount) &&
        timeResolution * lagCount >= 100
      ) {
        errors.num_lags = "ΔT × lags must be less than 100.";
      }
    }
    return errors;
  }, [algorithm?.id, draft, parameters]);

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
        const hasDefault =
          parameter.default !== null && parameter.default !== undefined;
        if (!hasDefault || value !== Number(parameter.default)) {
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
    const controlClass = `box-border h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 outline-none transition focus:ring-2 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
      error
        ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
        : "border-slate-200 hover:border-slate-300 focus:border-[#087ead] focus:ring-[#087ead]/15"
    }`;

    if (isBoolParam(parameter)) {
      return (
        <div
          key={parameter.name}
          className="flex items-center justify-between gap-3 py-3"
        >
          <label
            htmlFor={fieldId}
            className="text-sm font-semibold text-slate-800"
          >
            {parameter.label ?? parameter.name}
          </label>
          <button
            id={fieldId}
            type="button"
            role="switch"
            aria-checked={Boolean(value)}
            onClick={() => setField(parameter.name, !Boolean(value))}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
              value ? "bg-[#1b75a6]" : "bg-slate-300"
            }`}
          >
            <span
              className={`h-4 w-4 rounded-full bg-white shadow-sm transition ${
                value ? "translate-x-[1.1rem]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      );
    }

    return (
      <div key={parameter.name} className="py-3">
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <label
            htmlFor={fieldId}
            className="text-sm font-semibold text-slate-800"
          >
            {parameter.label ?? parameter.name}
          </label>
          {hint && !error ? (
            <span className="text-[11px] font-medium text-slate-400">{hint}</span>
          ) : null}
        </div>
        {options.length > 0 ? (
          <select
            id={fieldId}
            value={String(value ?? "")}
            onChange={(event) =>
              setField(parameter.name, event.target.value)
            }
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
        {error ? (
          <p id={errorId} className="mt-1.5 text-[11px] font-medium text-rose-600">
            {error}
          </p>
        ) : null}
      </div>
    );
  };

  const hasErrors = Object.keys(fieldErrors).length > 0;
  const modalElement = anchorElement.closest<HTMLElement>(
    "[data-create-project-modal]",
  );
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={`${algorithm.name} settings`}
      className={`${modalElement ? "absolute" : "fixed"} z-[140] w-[min(27rem,calc(100vw-1.5rem))] text-slate-900`}
      style={{ visibility: "hidden" }}
    >
      <div className="relative z-10 flex max-h-[inherit] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20">
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-4">
          <h3 className="truncate text-sm font-bold text-slate-900">
            {algorithm.name} parameters
          </h3>
          <a
            href={`/algorithms/${encodeURIComponent(algorithm.id)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-500 transition hover:text-[#1b75a6]"
          >
            About
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" aria-hidden="true">
              <path d="M3 9 9 3M4.5 3H9v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          {parameters.map(renderField)}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={resetToDefaults}
            className="rounded-full px-3.5 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-50 hover:text-[#1b75a6]"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={hasErrors}
            className="rounded-full bg-[#1b75a6] px-5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#155f87] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    modalElement ?? document.body,
  );
}
