"use client";

import { useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "../../../_lib/clientIdentity";
import { DownloadIcon } from "./DownloadMenu";

type Group = {
  file_count: number;
  size_bytes: number;
  available: boolean;
  status?: string;
};
type Inventory = {
  filename: string;
  groups: { original: Group; prepared: Group };
};
type Selection = { original: boolean; prepared: boolean; manifest: boolean };
type Props = { projectId?: string; apiBase: string };

function describeFiles(group: Group) {
  const size = group.size_bytes;
  const formatted =
    size >= 1048576
      ? `${(size / 1048576).toFixed(1)} MB`
      : size >= 1024
        ? `${(size / 1024).toFixed(1)} KB`
        : `${size} B`;
  return `${group.file_count} ${group.file_count === 1 ? "file" : "files"} · ${formatted}`;
}

export default function FileDownloadMenuModal({ projectId, apiBase }: Props) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [selection, setSelection] = useState<Selection>({
    original: true,
    prepared: true,
    manifest: true,
  });
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => requestRef.current?.abort(), [projectId]);
  useEffect(() => {
    if (!open || !projectId) return;
    const controller = new AbortController();
    // A new inventory is required each time the panel opens, including after preparation finishes.
    setLoading(true);
    setError("");
    setInventory(null);
    apiFetch(`${apiBase}/projects/${projectId}/project-data`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Project files could not be loaded. Please try again.",
          );
        return response.json() as Promise<Inventory>;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setInventory(data);
        setSelection({
          original: data.groups.original.available,
          prepared: data.groups.prepared.available,
          manifest: true,
        });
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Project files could not be loaded.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, projectId, apiBase]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !downloading)
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !downloading) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, downloading]);

  const download = async () => {
    if (!inventory || downloading || !projectId) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setDownloading(true);
    setError("");
    try {
      const query = new URLSearchParams(
        Object.entries(selection).map(([key, value]) => [key, String(value)]),
      );
      const response = await apiFetch(
        `${apiBase}/projects/${projectId}/download/project-data?${query}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          typeof payload?.detail === "string"
            ? payload.detail
            : "The package could not be downloaded. Please try again.",
        );
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = inventory.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setOpen(false);
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(
          caught instanceof Error
            ? caught.message
            : "Download failed. Please try again.",
        );
    } finally {
      if (!controller.signal.aborted) setDownloading(false);
    }
  };

  const options = [
    {
      key: "original" as const,
      label: "Original inputs",
      description: "Files you uploaded.",
      detail: inventory
        ? inventory.groups.original.available
          ? describeFiles(inventory.groups.original)
          : "No uploaded files available"
        : "",
      disabled: !inventory?.groups.original.available,
    },
    {
      key: "prepared" as const,
      label: "Prepared inputs",
      description: "Processed files used for analysis.",
      detail: inventory
        ? inventory.groups.prepared.status === "preparing"
          ? "Preparing"
          : inventory.groups.prepared.status === "failed"
            ? "Preparation failed"
            : inventory.groups.prepared.available
              ? describeFiles(inventory.groups.prepared)
              : "No prepared files available"
        : "",
      disabled: !inventory?.groups.prepared.available,
    },
    {
      key: "manifest" as const,
      label: "Project manifest",
      description: "Dataset information and configuration.",
      detail: "JSON",
      disabled: !inventory,
    },
  ];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={!projectId || downloading}
        aria-label="Download project files"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-bold text-slate-600 transition hover:bg-[#eef7fb] hover:text-[#1b75a6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b75a6]/25 disabled:opacity-60"
      >
        <DownloadIcon />
        Download
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Project data package"
          aria-busy={loading || downloading}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(23rem,calc(100vw-3rem))] rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl shadow-slate-900/15"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold">Project data package</h3>
            <button
              type="button"
              disabled={downloading}
              aria-label="Close project data package"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="rounded px-2 text-lg text-slate-500 hover:bg-slate-50"
            >
              ×
            </button>
          </div>
          {loading ? (
            <p role="status" className="py-4 text-sm text-slate-500">
              Checking project files…
            </p>
          ) : (
            inventory && (
              <div className="space-y-1">
                {options.map((option) => (
                  <label
                    key={option.key}
                    className={`flex gap-3 rounded-lg px-2 py-2.5 ${option.disabled ? "text-slate-400" : "cursor-pointer hover:bg-slate-50"}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 accent-[#1b75a6]"
                      checked={selection[option.key] && !option.disabled}
                      disabled={option.disabled || downloading}
                      onChange={(event) =>
                        setSelection((current) => ({
                          ...current,
                          [option.key]: event.target.checked,
                        }))
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="text-sm font-semibold">
                          {option.label}
                        </span>
                        <span className="text-xs text-slate-500">
                          {option.detail}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {option.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-rose-700">
              {error}
            </p>
          )}
          {!loading && !inventory ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="mt-3 text-sm font-semibold text-[#1b75a6]"
            >
              Close and try again
            </button>
          ) : (
            <button
              type="button"
              disabled={
                loading ||
                downloading ||
                !inventory ||
                !Object.values(selection).some(Boolean)
              }
              onClick={() => void download()}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#1b75a6] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#155f87] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <DownloadIcon />
              {downloading ? "Preparing ZIP…" : "Download ZIP"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
