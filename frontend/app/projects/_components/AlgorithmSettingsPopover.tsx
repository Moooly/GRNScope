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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const arrowRef = useRef<SVGSVGElement | null>(null);
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
    const arrow = arrowRef.current;
    if (!panel || !arrow || !anchorElement) return;
    if (!anchorElement.isConnected) {
      onClose();
      return;
    }

    const margin = 12;
    const gap = 10;
    const arrowExtent = 7;
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
      boundaryBottom - boundaryTop - arrowExtent,
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
    const viewportLeft = clamp(
      anchorRect.right - panelWidth,
      boundaryLeft,
      boundaryRight - panelWidth,
    );
    const viewportTop = modalElement
      ? unclampedTop
      : clamp(
          unclampedTop,
          boundaryTop + (opensBelow ? arrowExtent : 0),
          boundaryBottom - panelHeight - (opensBelow ? 0 : arrowExtent),
        );
    const arrowLeft = clamp(
      anchorRect.left + anchorRect.width / 2 - viewportLeft - 8,
      18,
      panelWidth - 34,
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
    arrow.style.left = `${arrowLeft}px`;
    arrow.style.top = opensBelow ? "-7px" : "auto";
    arrow.style.bottom = opensBelow ? "auto" : "-7px";
    arrow.style.transform = opensBelow ? "rotate(180deg)" : "none";
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
    const controlClass = `box-border h-9 w-full rounded-lg border bg-white px-2.5 py-0 text-sm text-slate-900 outline-none transition focus:ring-2 ${
      error
        ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
        : "border-slate-200 focus:border-[#1b75a6]/50 focus:ring-[#1b75a6]/15"
    }`;

    return (
      <div
        key={parameter.name}
        className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-start gap-3 py-2"
      >
        <label
          htmlFor={fieldId}
          className="mt-2 whitespace-nowrap text-sm font-semibold leading-5 text-slate-800"
        >
          {parameter.label ?? parameter.name}
        </label>

        <div>
          <div className="flex h-9 items-center">
            {isBoolParam(parameter) ? (
              <button
                id={fieldId}
                type="button"
                role="switch"
                aria-checked={Boolean(value)}
                onClick={() => setField(parameter.name, !Boolean(value))}
                className={`relative ml-auto inline-flex h-5 w-9 items-center rounded-full transition ${
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
          </div>
          {error ? (
            <p id={errorId} className="text-[10px] font-medium text-rose-600">
              {error}
            </p>
          ) : hint ? (
            <p className="mt-0.5 text-right text-[10px] text-slate-400">{hint}</p>
          ) : null}
        </div>
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
      <svg
        ref={arrowRef}
        aria-hidden="true"
        viewBox="0 0 16 8"
        className="absolute z-20 h-2 w-4 overflow-visible"
      >
        <rect x="0" y="-1" width="16" height="2" fill="white" />
        <path
          d="M 0 0 L 8 8 L 16 0"
          fill="white"
          stroke="#e2e8f0"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="relative z-10 flex max-h-[inherit] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/20">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div>{parameters.map(renderField)}</div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 bg-slate-50/70 px-4 py-2.5">
          <a
            href={`/algorithms?algorithm=${encodeURIComponent(algorithm.id)}`}
            target="_blank"
            rel="noreferrer"
            className="-ml-3 min-w-0 truncate rounded-full px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-white hover:text-[#1b75a6]"
          >
            About {algorithm.name}
          </a>
          <div className="flex shrink-0 items-center gap-1.5">
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
      </div>
    </div>,
    modalElement ?? document.body,
  );
}
