import { useEffect, useMemo, useState } from "react";
import type { AlgorithmParameter, ProjectAlgorithm } from "../page";

interface AlgorithmSettingsModalProps {
  algorithm: ProjectAlgorithm | null;
  /** Currently-applied overrides for this algorithm ({ paramName: value }). */
  currentOverrides: Record<string, unknown>;
  isClosing: boolean;
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

function isBoolParam(parameter: AlgorithmParameter) {
  return BOOL_TYPES.has(String(parameter.value_type ?? "").toLowerCase());
}

function isIntegerParam(parameter: AlgorithmParameter) {
  return INTEGER_TYPES.has(String(parameter.value_type ?? "").toLowerCase());
}

function validateDraftValue(
  parameter: AlgorithmParameter,
  raw: DraftValue | undefined,
): string | null {
  if (isBoolParam(parameter)) return null;

  const text = String(raw ?? "").trim();
  if (text === "") {
    return parameter.required && parameter.default == null
      ? "This setting is required."
      : null;
  }

  if (isNumberParam(parameter)) {
    const value = Number(text);
    if (!Number.isFinite(value)) return "Enter a valid number.";
    if (isIntegerParam(parameter) && !Number.isInteger(value)) {
      return "Enter a whole number. Decimals are not allowed.";
    }
    if (typeof parameter.minimum === "number" && value < parameter.minimum) {
      return `Enter a value of at least ${parameter.minimum}.`;
    }
    if (typeof parameter.maximum === "number" && value > parameter.maximum) {
      return `Enter a value no greater than ${parameter.maximum}.`;
    }
  }

  if (
    parameter.options?.length &&
    !parameter.options.some((option) => String(option) === text)
  ) {
    return "Choose one of the available options.";
  }

  return null;
}

// Initialise a draft field from an existing override, falling back to default.
function initialDraftValue(
  parameter: AlgorithmParameter,
  override: unknown,
): DraftValue {
  const raw = override !== undefined ? override : parameter.default;
  if (isBoolParam(parameter)) return Boolean(raw);
  return raw === null || raw === undefined ? "" : String(raw);
}

// Canonical string form of a parameter's default, for change detection.
function defaultAsString(parameter: AlgorithmParameter): string {
  if (isBoolParam(parameter)) return String(Boolean(parameter.default));
  return parameter.default === null || parameter.default === undefined
    ? ""
    : String(parameter.default);
}

function rangeHint(parameter: AlgorithmParameter): string | null {
  if (parameter.options && parameter.options.length > 0) {
    return parameter.options.map((option) => String(option)).join(" · ");
  }
  if (isBoolParam(parameter)) return null;
  if (typeof parameter.minimum === "number" && typeof parameter.maximum === "number") {
    return `Range ${parameter.minimum} – ${parameter.maximum}`;
  }
  return null;
}

function defaultHint(parameter: AlgorithmParameter): string {
  if (isBoolParam(parameter)) return Boolean(parameter.default) ? "On" : "Off";
  return defaultAsString(parameter) || "—";
}

/**
 * Layered modal for tuning one algorithm's parameters during project creation.
 * Sits on top of the create-project modal; controls are generated from the
 * algorithm's parameter metadata. Only values that differ from the recommended
 * default are returned as overrides.
 */
export default function AlgorithmSettingsModal({
  algorithm,
  currentOverrides,
  isClosing,
  onApply,
  onClose,
}: AlgorithmSettingsModalProps) {
  const parameters = useMemo(() => algorithm?.parameters ?? [], [algorithm]);
  const basicParameters = parameters.filter((parameter) => !parameter.advanced);
  const advancedParameters = parameters.filter((parameter) => parameter.advanced);

  const [draft, setDraft] = useState<Draft>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Rebuild the draft whenever a different algorithm's modal opens.
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
    setShowAdvanced(false);
    // currentOverrides is intentionally excluded: we only re-seed on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algorithm]);

  useEffect(() => {
    if (!algorithm) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [algorithm, onClose]);

  const changedNames = useMemo(() => {
    return parameters
      .filter((parameter) => {
        const current = draft[parameter.name];
        if (current === undefined) return false;
        return String(current) !== defaultAsString(parameter);
      })
      .map((parameter) => parameter.name);
  }, [draft, parameters]);

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const parameter of parameters) {
      const error = validateDraftValue(parameter, draft[parameter.name]);
      if (error) errors[parameter.name] = error;
    }
    return errors;
  }, [draft, parameters]);

  const hasErrors = Object.keys(fieldErrors).length > 0;

  if (!algorithm) return null;

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
    if (hasErrors) return;
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
        if (text === "") continue; // empty → leave at default
        const value = Number(text);
        if (!Number.isFinite(value)) continue;
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
    const hint = rangeHint(parameter);
    const options = parameter.options ?? [];
    const error = fieldErrors[parameter.name];
    const errorId = `param-${parameter.name}-error`;

    return (
      <div
        key={parameter.name}
        className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3.5"
      >
        <div className="flex items-start justify-between gap-3">
          <label
            htmlFor={`param-${parameter.name}`}
            className="text-sm font-semibold text-slate-900"
          >
            {parameter.label ?? parameter.name}
          </label>
          <span className="mt-0.5 shrink-0 text-xs text-slate-400">
            Default: {defaultHint(parameter)}
          </span>
        </div>

        {parameter.description ? (
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {parameter.description}
          </p>
        ) : null}

        <div className="mt-3">
          {isBoolParam(parameter) ? (
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(value)}
              id={`param-${parameter.name}`}
              onClick={() => setField(parameter.name, !Boolean(value))}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                value ? "bg-[#1b75a6]" : "bg-slate-300"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                  value ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          ) : options.length > 0 ? (
            <select
              id={`param-${parameter.name}`}
              value={String(value ?? "")}
              onChange={(event) => setField(parameter.name, event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              className={`w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:ring-2 ${
                error
                  ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                  : "border-slate-200 focus:border-[#1b75a6]/50 focus:ring-[#1b75a6]/20"
              }`}
            >
              {options.map((option) => (
                <option key={String(option)} value={String(option)}>
                  {String(option)}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`param-${parameter.name}`}
              type={isNumberParam(parameter) ? "number" : "text"}
              value={String(value ?? "")}
              min={isNumberParam(parameter) ? parameter.minimum : undefined}
              max={isNumberParam(parameter) ? parameter.maximum : undefined}
              step={isNumberParam(parameter) ? parameter.step : undefined}
              onChange={(event) => setField(parameter.name, event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              className={`w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:ring-2 ${
                error
                  ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                  : "border-slate-200 focus:border-[#1b75a6]/50 focus:ring-[#1b75a6]/20"
              }`}
            />
          )}
        </div>

        {error ? (
          <p id={errorId} className="mt-2 text-xs font-medium text-rose-600">
            {error}
          </p>
        ) : null}
        {hint ? <p className="mt-2 text-xs text-slate-400">{hint}</p> : null}
      </div>
    );
  };

  return (
    <div
      className={`fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-slate-950/55 px-4 py-10 backdrop-blur-sm sm:px-6 lg:py-14 ${
        isClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      onClick={onClose}
    >
      <div
        className={`max-h-[calc(100vh-5rem)] w-full max-w-lg overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/30 lg:p-7 ${
          isClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {algorithm.name} settings
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {algorithm.tagline}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 cursor-pointer rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          >
            <span className="block h-4 w-4 leading-none">×</span>
          </button>
        </div>

        <p className="mt-4 text-xs font-medium text-slate-500">
          {changedNames.length === 0
            ? "Using recommended defaults."
            : `${changedNames.length} setting${changedNames.length === 1 ? "" : "s"} customized.`}
        </p>

        <div className="mt-3 space-y-2.5">
          {basicParameters.map(renderField)}
        </div>

        {advancedParameters.length > 0 ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
              className="flex w-full items-center justify-between rounded-xl px-1 py-2 text-sm font-semibold text-slate-600 transition hover:text-[#1b75a6]"
              aria-expanded={showAdvanced}
            >
              <span>Advanced settings</span>
              <span className={`text-xs transition ${showAdvanced ? "rotate-180" : ""}`}>▾</span>
            </button>
            {showAdvanced ? (
              <div className="mt-2 space-y-2.5">
                {advancedParameters.map(renderField)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={resetToDefaults}
              className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400 transition hover:text-[#1b75a6]"
            >
              Reset to defaults
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={hasErrors}
              className="cursor-pointer rounded-full bg-[#1b75a6] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#155f87] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
