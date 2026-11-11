"use client";

// @refresh reset
// Recreate the download session after edits instead of retaining stale hook state.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { apiFetch } from "../../../_lib/clientIdentity";
import { downloadBlob } from "../_lib/downloads";
import { buildProjectPackage, edgeOutputFile, type PackageOutput } from "../_lib/projectPackage";
import type { AggregatedEdge } from "../_lib/types";
import ProjectOutputPicker from "./ProjectOutputPicker";
import { DownloadIcon } from "./DownloadMenu";
import ProjectOutputExports, { type ProjectInsightsExportProps } from "./ProjectOutputExports";

type Group = { file_count: number; size_bytes: number; available: boolean; status?: string };
type Inventory = { filename: string; groups: { original: Group; prepared: Group } };
type SavedOutput = { id: string; label: string; path: string; url: string; size_bytes: number };
export type ProjectDownloadData = {
  insights: ProjectInsightsExportProps;
  methodRows: Record<string, AggregatedEdge[]>;
  consensusRows: AggregatedEdge[];
  filteredRows: AggregatedEdge[];
  settings: Record<string, unknown>;
  loading: boolean;
};
type Props = { projectId?: string; apiBase: string; outputData: ProjectDownloadData };

function Checkbox({ mixed, ...props }: InputHTMLAttributes<HTMLInputElement> & { mixed?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!mixed; }, [mixed]);
  return <input {...props} ref={ref} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#1b75a6] disabled:cursor-not-allowed" />;
}
const DOWNLOAD_ROW_CLASS = "flex min-h-12 items-center gap-3 rounded-lg px-1 py-3 hover:bg-slate-50";
const DOWNLOAD_LABEL_CLASS = "text-sm font-semibold leading-5";

export default function FileDownloadMenuModal({ projectId, apiBase, outputData }: Props) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<ProjectDownloadData | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [selection, setSelection] = useState({ original: true, prepared: true });
  const [outputSelection, setOutputSelection] = useState<Record<string, boolean>>({});
  const [generatedOutputs, setGeneratedOutputs] = useState<PackageOutput[]>([]);
  const [savedOutputs, setSavedOutputs] = useState<SavedOutput[]>([]);
  const [outputsExpanded, setOutputsExpanded] = useState(false);
  const [format, setFormat] = useState<"svg" | "png">("svg");
  const [loading, setLoading] = useState(false);
  const [renderReady, setRenderReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [outputError, setOutputError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [placement, setPlacement] = useState({ top: 0, right: 16, width: 400, maxHeight: 600 });
  const markReady = useCallback(() => setRenderReady(true), []);
  const receiveOutputs = useCallback((outputs: PackageOutput[]) => setGeneratedOutputs(outputs), []);

  useEffect(() => () => requestRef.current?.abort(), [projectId]);
  useEffect(() => {
    if (open && session?.loading && !outputData.loading) setSession(outputData);
  }, [open, session?.loading, outputData]);
  useEffect(() => {
    if (!open || !projectId) return;
    panelRef.current?.focus();
    const controller = new AbortController();
    setLoading(true); setError(""); setOutputError(""); setInventory(null); setSavedOutputs([]);
    const loadInputs = apiFetch(`${apiBase}/projects/${projectId}/project-data`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Project files could not be loaded. Please try again.");
        return response.json() as Promise<Inventory>;
      }).then(data => {
        if (controller.signal.aborted) return;
        setInventory(data);
        setSelection({ original: data.groups.original.available, prepared: data.groups.prepared.available });
      }).catch(caught => { if (!controller.signal.aborted) setError(caught.message); });
    const loadOutputs = apiFetch(`${apiBase}/projects/${projectId}/output-files`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Saved simulations could not be checked.");
        return response.json() as Promise<{ perturbations: SavedOutput[] }>;
      }).then(data => { if (!controller.signal.aborted) setSavedOutputs(data.perturbations); })
      .catch(caught => { if (!controller.signal.aborted) setOutputError(caught.message); });
    void Promise.allSettled([loadInputs, loadOutputs]).then(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, projectId, apiBase, refresh]);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(400, window.innerWidth - 32);
      const desiredHeight = outputsExpanded ? 550 : 330;
      const top = Math.min(rect.bottom + 8, Math.max(16, window.innerHeight - desiredHeight - 16));
      setPlacement({ top, right: Math.max(16, Math.min(window.innerWidth - rect.right, window.innerWidth - width - 16)), width, maxHeight: window.innerHeight - top - 16 });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !downloading) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !downloading) { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, downloading, outputsExpanded]);

  const outputs = useMemo<PackageOutput[]>(() => {
    if (!session) return [];
    const network: PackageOutput[] = Object.entries(session.methodRows).map(([id, rows]) => ({
      id: `network/${id}`, label: id, group: "network",
      build: async () => [edgeOutputFile(`analysis_outputs/network/${id.replace(/[^a-z0-9_-]/gi, "_")}-ranked-edges.csv`, rows)],
    }));
    if (session.insights.activeAlgorithmIds.length > 1) network.push({
      id: "network/consensus", label: "Consensus network · unfiltered", group: "network",
      build: async () => [edgeOutputFile("analysis_outputs/network/consensus-unfiltered.csv", session.consensusRows)],
    });
    if (session.insights.activeAlgorithmIds.length) network.push({
      id: "network/current", label: "Filtered network", group: "network",
      build: async () => [edgeOutputFile("analysis_outputs/network/current-network-filtered.csv", session.filteredRows)],
    });
    return [...network, ...generatedOutputs, ...savedOutputs.map(file => ({
      id: file.id, label: file.label, group: "perturbations" as const,
      build: async (_format: "svg" | "png", signal: AbortSignal) => {
        const response = await apiFetch(`${apiBase}/projects/${projectId}/${file.url}`, { signal });
        if (!response.ok) throw new Error(`${file.label} is no longer available. Reopen Download to refresh the list.`);
        return [{ filename: file.path, blob: await response.blob() }];
      },
    }))];
  }, [session, generatedOutputs, savedOutputs, apiBase, projectId]);
  const selectedOutputs = useMemo(() => outputs.filter(output => outputSelection[output.id] ?? true), [outputs, outputSelection]);
  const outputReady = !!session && !session.loading && renderReady;
  const hasSelection = selection.original || selection.prepared || selectedOutputs.length > 0;
  const close = () => { if (!downloading) { setOpen(false); triggerRef.current?.focus(); } };
  const selectOutputs = (items: PackageOutput[], checked: boolean) => setOutputSelection(current => ({ ...current, ...Object.fromEntries(items.map(item => [item.id, checked])) }));
  const openPanel = () => {
    if (open) { close(); return; }
    setSession(outputData); setGeneratedOutputs([]); setOutputSelection({}); setOutputsExpanded(false); setRenderReady(false); setOpen(true);
  };
  const download = async () => {
    if (!inventory || downloading || !projectId || !hasSelection) return;
    const controller = new AbortController(); requestRef.current = controller;
    setDownloading(true); setError(""); setProgress("Preparing inputs…");
    try {
      // The configuration is an automatic companion to every selection.
      const query = new URLSearchParams({ original: String(selection.original), prepared: String(selection.prepared), manifest: "true" });
      const response = await apiFetch(`${apiBase}/projects/${projectId}/download/project-data?${query}`, { signal: controller.signal });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(typeof payload?.detail === "string" ? payload.detail : "The package could not be prepared. Please try again.");
      }
      const base = await response.arrayBuffer();
      const blob = await buildProjectPackage({ base, outputs: selectedOutputs, format, settings: session?.settings ?? {}, signal: controller.signal, onProgress: setProgress });
      controller.signal.throwIfAborted();
      downloadBlob(blob, inventory.filename.replace(/_data\.zip$/, "_project.zip"));
      setOpen(false); triggerRef.current?.focus();
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Download failed. Please try again.");
    } finally {
      if (!controller.signal.aborted) { setDownloading(false); setProgress(""); }
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  return <div ref={rootRef} className="relative shrink-0">
    <button ref={triggerRef} type="button" disabled={!projectId || downloading} aria-label="Download project files" aria-haspopup="dialog" aria-expanded={open} aria-controls={panelId} onClick={openPanel} className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-bold text-slate-600 transition hover:bg-[#eef7fb] hover:text-[#1b75a6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b75a6]/25 disabled:opacity-60"><DownloadIcon />Download</button>
    {open && <>
      {session && !session.loading && <ProjectOutputExports insights={session.insights} networkEdges={session.filteredRows} onChange={receiveOutputs} onReady={markReady} />}
      <div ref={panelRef} tabIndex={-1} id={panelId} role="dialog" aria-label="Download project" aria-busy={loading || downloading} style={placement} className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl shadow-slate-900/15">
        <h3 className="mb-3 shrink-0 py-1 text-base font-bold">Download project</h3>
        {loading ? <p role="status" className="py-4 text-sm text-slate-500">Checking project files…</p> : inventory && <>
          {(["original", "prepared"] as const).map(key => {
            const group = inventory.groups[key];
            return <label key={key} className={`${DOWNLOAD_ROW_CLASS} ${group.available ? "cursor-pointer" : "text-slate-400"}`}>
              <Checkbox aria-label={key === "original" ? "Original inputs" : "Prepared inputs"} checked={selection[key] && group.available} disabled={!group.available || downloading} onChange={event => setSelection(current => ({ ...current, [key]: event.target.checked }))} />
              <span className={DOWNLOAD_LABEL_CLASS}>{key === "original" ? "Original inputs" : "Prepared inputs"}</span>
            </label>;
          })}
          <div className={`${DOWNLOAD_ROW_CLASS} shrink-0`}>
            <label className="flex flex-1 cursor-pointer items-center gap-3">
              <Checkbox aria-label="Select all analysis outputs" checked={outputs.length > 0 && selectedOutputs.length === outputs.length}
                mixed={selectedOutputs.length > 0 && selectedOutputs.length < outputs.length}
                disabled={downloading || !outputReady || !outputs.length}
                onChange={event => selectOutputs(outputs, event.target.checked)} />
              <span className={DOWNLOAD_LABEL_CLASS}>Analysis outputs</span>
            </label>
            <button type="button" aria-label={`${outputsExpanded ? "Collapse" : "Expand"} analysis outputs`}
              aria-expanded={outputsExpanded} aria-controls={`${panelId}-outputs`}
              disabled={!outputReady || downloading || !outputs.length} onClick={() => setOutputsExpanded(current => !current)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-50">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                className={`h-4 w-4 ${outputsExpanded ? "rotate-90" : ""}`}>
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </div>
          {outputsExpanded && <div id={`${panelId}-outputs`} className="flex min-h-0 flex-col">
            <ProjectOutputPicker outputs={outputs} selection={outputSelection} format={format} disabled={downloading}
              onSelect={selectOutputs} onFormatChange={setFormat} />
          </div>}
        </>}
        {(error || outputError) && <p role="alert" className="mt-3 text-sm text-rose-700">{error || outputError}</p>}
        {(error || outputError) && !downloading && <button type="button" onClick={() => setRefresh(current => current + 1)} className="mt-2 text-xs font-semibold text-[#1b75a6]">Refresh available files</button>}
        <button type="button" disabled={loading || downloading || !inventory || !hasSelection || (!!selectedOutputs.length && !outputReady)} onClick={() => void download()} className="mt-4 inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-full bg-[#1b75a6] px-4 py-3 text-sm font-bold text-white hover:bg-[#155f87] disabled:cursor-not-allowed disabled:opacity-50"><DownloadIcon />{downloading ? "Preparing ZIP…" : "Download ZIP"}</button>
        {downloading && <p role="status" className="mt-2 text-xs text-slate-500">{progress}</p>}
      </div>
    </>}
  </div>;
}
