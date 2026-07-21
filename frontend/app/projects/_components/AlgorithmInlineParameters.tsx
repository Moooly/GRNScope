"use client";

import { useEffect, useMemo, useState } from "react";
import type { AlgorithmParameter, ProjectAlgorithm } from "../page";

interface AlgorithmInlineParametersProps {
  algorithm: ProjectAlgorithm;
  currentOverrides: Record<string, unknown>;
  contextualDefaults?: Record<string, unknown>;
  onApply: (algorithmId: string, overrides: Record<string, unknown>) => void;
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
  contextualDefault?: unknown,
): DraftValue {
  const raw = override !== undefined
    ? override
    : contextualDefault !== undefined
      ? contextualDefault
      : parameter.default;
  if (isBoolParam(parameter)) return Boolean(raw);
  return raw === null || raw === undefined ? "" : String(raw);
}

function defaultAsString(
  parameter: AlgorithmParameter,
  contextualDefault?: unknown,
): string {
  const raw = contextualDefault !== undefined
    ? contextualDefault
    : parameter.default;
  if (isBoolParam(parameter)) return String(Boolean(raw));
  return raw === null || raw === undefined ? "" : String(raw);
}

function numericHint(parameter: AlgorithmParameter): string | null {
  if (!isNumberParam(parameter)) return null;
  const formatBound = (value: number) => value.toLocaleString("en-US");
  const hasMin = typeof parameter.minimum === "number";
  const hasMax = typeof parameter.maximum === "number";
  if (hasMin && hasMax) {
    return `${formatBound(parameter.minimum as number)}–${formatBound(parameter.maximum as number)}`;
  }
  const lower = typeof parameter.exclusive_minimum === "number"
    ? `> ${formatBound(parameter.exclusive_minimum)}`
    : hasMin ? `≥ ${formatBound(parameter.minimum as number)}` : null;
  const upper = typeof parameter.exclusive_maximum === "number"
    ? `< ${formatBound(parameter.exclusive_maximum)}`
    : hasMax ? `≤ ${formatBound(parameter.maximum as number)}` : null;
  return [lower, upper].filter(Boolean).join(" and ") || null;
}

function validateDraftValue(
  parameter: AlgorithmParameter,
  raw: DraftValue | undefined,
): string | null {
  if (isBoolParam(parameter)) return null;
  const text = String(raw ?? "").trim();
  if (text === "") {
    return parameter.required && parameter.default == null ? "Required." : null;
  }
  if (isNumberParam(parameter)) {
    const value = Number(text);
    if (!Number.isFinite(value)) return "Enter a valid number.";
    if (isIntegerParam(parameter) && !Number.isInteger(value)) return "Use a whole number.";
    if (typeof parameter.minimum === "number" && value < parameter.minimum) return `Minimum ${parameter.minimum}.`;
    if (typeof parameter.maximum === "number" && value > parameter.maximum) return `Maximum ${parameter.maximum}.`;
    if (typeof parameter.exclusive_minimum === "number" && value <= parameter.exclusive_minimum) {
      return `Must be greater than ${parameter.exclusive_minimum}.`;
    }
    if (typeof parameter.exclusive_maximum === "number" && value >= parameter.exclusive_maximum) {
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

function buildOverrides(
  parameters: AlgorithmParameter[],
  draft: Draft,
  contextualDefaults: Record<string, unknown>,
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  for (const parameter of parameters) {
    const raw = draft[parameter.name];
    if (raw === undefined) continue;

    if (isBoolParam(parameter)) {
      const value = Boolean(raw);
      if (String(value) !== defaultAsString(parameter, contextualDefaults[parameter.name])) {
        overrides[parameter.name] = value;
      }
      continue;
    }
    if (isNumberParam(parameter)) {
      const text = String(raw).trim();
      if (text === "") continue;
      const value = Number(text);
      const defaultValue = contextualDefaults[parameter.name] !== undefined
        ? contextualDefaults[parameter.name]
        : parameter.default;
      const hasDefault = defaultValue !== null && defaultValue !== undefined;
      if (!hasDefault || value !== Number(defaultValue)) {
        overrides[parameter.name] = value;
      }
      continue;
    }
    const value = String(raw);
    if (value !== defaultAsString(parameter, contextualDefaults[parameter.name])) {
      overrides[parameter.name] = value;
    }
  }
  return overrides;
}

export default function AlgorithmInlineParameters({
  algorithm,
  currentOverrides,
  contextualDefaults = {},
  onApply,
}: AlgorithmInlineParametersProps) {
  const parameters = useMemo(() => algorithm.parameters ?? [], [algorithm]);

  const [draft, setDraft] = useState<Draft>(() => {
    const next: Draft = {};
    for (const parameter of parameters) {
      next[parameter.name] = initialDraftValue(
        parameter,
        currentOverrides[parameter.name],
        contextualDefaults[parameter.name],
      );
    }
    return next;
  });

  useEffect(() => {
    const next: Draft = {};
    for (const parameter of parameters) {
      next[parameter.name] = initialDraftValue(
        parameter,
        currentOverrides[parameter.name],
        contextualDefaults[parameter.name],
      );
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-seed draft when algorithm/overrides change externally
    setDraft(next);
  }, [algorithm.id, contextualDefaults, currentOverrides, parameters]);

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const parameter of parameters) {
      const error = validateDraftValue(parameter, draft[parameter.name]);
      if (error) errors[parameter.name] = error;
    }
    if (algorithm.id === "SINGE") {
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
  }, [algorithm.id, draft, parameters]);

  const commit = (nextDraft: Draft) => {
    for (const parameter of parameters) {
      if (validateDraftValue(parameter, nextDraft[parameter.name])) return;
    }
    onApply(algorithm.id, buildOverrides(parameters, nextDraft, contextualDefaults));
  };

  const setField = (name: string, value: DraftValue, commitImmediately = false) => {
    setDraft((current) => {
      const next = { ...current, [name]: value };
      if (commitImmediately) commit(next);
      return next;
    });
  };

  const commitField = (name: string) => {
    commit({ ...draft, [name]: draft[name] });
  };

  const resetToDefaults = () => {
    const next: Draft = {};
    for (const parameter of parameters) {
      next[parameter.name] = initialDraftValue(
        parameter,
        undefined,
        contextualDefaults[parameter.name],
      );
    }
    setDraft(next);
    onApply(algorithm.id, {});
  };

  const renderField = (parameter: AlgorithmParameter) => {
    const value = draft[parameter.name];
    const error = fieldErrors[parameter.name];
    const hint = numericHint(parameter);
    const options = parameter.options ?? [];
    const fieldId = `inline-${algorithm.id}-${parameter.name}`;
    const errorId = `${fieldId}-error`;
    const controlClass = `box-border h-9 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 outline-none transition focus:ring-2 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
      error
        ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
        : "border-slate-200 hover:border-slate-300 focus:border-[#087ead] focus:ring-[#087ead]/15"
    }`;

    if (isBoolParam(parameter)) {
      return (
        <div key={parameter.name} className="flex items-center justify-between gap-3">
          <label htmlFor={fieldId} className="text-sm font-medium text-slate-800">
            {parameter.label ?? parameter.name}
          </label>
          <button
            id={fieldId}
            type="button"
            role="switch"
            aria-checked={Boolean(value)}
            onClick={() => setField(parameter.name, !Boolean(value), true)}
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
      <div key={parameter.name}>
        <label htmlFor={fieldId} className="block text-xs font-medium text-slate-600">
          {parameter.label ?? parameter.name}
        </label>
        {options.length > 0 ? (
          <div className="relative mt-1.5">
            <select
              id={fieldId}
              value={String(value ?? "")}
              onChange={(event) => setField(parameter.name, event.target.value, true)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              className={`${controlClass} appearance-none pr-9`}
            >
              {options.map((option) => (
                <option key={String(option)} value={String(option)}>
                  {String(option)}
                </option>
              ))}
            </select>
            <svg
              viewBox="0 0 12 12"
              className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400"
              fill="none"
              aria-hidden="true"
            >
              <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ) : (
          <input
            id={fieldId}
            type={isNumberParam(parameter) ? "number" : "text"}
            value={String(value ?? "")}
            min={isNumberParam(parameter) ? parameter.minimum : undefined}
            max={isNumberParam(parameter) ? parameter.maximum : undefined}
            step={isNumberParam(parameter) ? parameter.step : undefined}
            onChange={(event) => setField(parameter.name, event.target.value)}
            onBlur={() => commitField(parameter.name)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className={`${controlClass} mt-1.5 [appearance:textfield]`}
          />
        )}
        {error ? (
          <p id={errorId} className="mt-1.5 text-[11px] font-medium text-rose-600">
            {error}
          </p>
        ) : hint ? (
          <p className="mt-1.5 text-[11px] font-normal text-slate-400">{hint}</p>
        ) : null}
      </div>
    );
  };

  const advancedParams = parameters.filter((parameter) => parameter.advanced);
  const primaryParams = parameters.filter((parameter) => !parameter.advanced);

  return (
    <div className="relative rounded-2xl border border-[#1b75a6]/60 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-950">{algorithm.name} parameters</p>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={resetToDefaults}
            className="text-xs font-medium text-slate-500 transition hover:text-[#1b75a6]"
          >
            Reset to defaults
          </button>
          <a
            href={`/algorithms/${encodeURIComponent(algorithm.id)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-[#1b75a6] transition hover:text-[#155f87]"
          >
            Method details
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" aria-hidden="true">
              <path d="M3 9 9 3M4.5 3H9v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </div>

      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {primaryParams.map(renderField)}
      </div>

      {advancedParams.length > 0 ? (
        <details className="mt-4 border-t border-slate-100 pt-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 transition hover:text-[#1b75a6]">
            Advanced
          </summary>
          <div className="mt-3 grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {advancedParams.map(renderField)}
          </div>
        </details>
      ) : null}
    </div>
  );
}
