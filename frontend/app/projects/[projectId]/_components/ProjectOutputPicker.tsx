"use client";

import { useId, useState } from "react";
import type { PackageOutput } from "../_lib/projectPackage";

type Category = PackageOutput["group"];
type Selection = Record<string, boolean>;
type Format = "svg" | "png";
const categories: { key: Category; name: string }[] = [
  { key: "network", name: "Network results" },
  { key: "tables", name: "Analysis tables" },
  { key: "figures", name: "Figures" },
  { key: "perturbations", name: "Perturbation results" },
];

type Props = {
  outputs: PackageOutput[];
  selection: Selection;
  format: Format;
  disabled: boolean;
  onSelect: (files: PackageOutput[], checked: boolean) => void;
  onFormatChange: (format: Format) => void;
};

export default function ProjectOutputPicker({ outputs, selection, format, disabled, onSelect, onFormatChange }: Props) {
  const [category, setCategory] = useState<Category>("network");
  const typeId = useId();
  const formatId = useId();
  const items = outputs.filter(file => file.group === category);
  const checked = (file: PackageOutput) => selection[file.id] ?? true;
  const all = items.every(checked);
  const network = category === "network";
  const isAdditional = (file: PackageOutput) => file.id === "network/current" || file.id === "network/consensus";
  const ordered = network ? [...items.filter(file => !isAdditional(file)).sort((a, b) => a.label.localeCompare(b.label)), ...items.filter(isAdditional)] : items;
  const title = categories.find(group => group.key === category)!.name;

  return <section aria-label="Choose analysis outputs" className="mt-1 flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200">
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1">
      <label htmlFor={typeId} className="sr-only">Output type</label>
      <select id={typeId} value={category} disabled={disabled} onChange={event => setCategory(event.target.value as Category)}
        className="min-h-9 min-w-0 max-w-[80%] rounded bg-transparent pr-1 text-xs font-medium text-slate-800 focus-visible:ring-2 focus-visible:ring-[#1b75a6]/25">
        {categories.map(group => <option key={group.key} value={group.key}>{group.name}</option>)}
      </select>
      <button type="button" disabled={disabled || !items.length} onClick={() => onSelect(items, !all)}
        aria-label={`${all ? "Clear" : "Select all"} ${title.toLowerCase()}`}
        className="min-h-9 shrink-0 rounded text-xs font-medium text-[#1b75a6] hover:underline disabled:text-slate-400">
        {all ? "Clear" : "Select all"}
      </button>
    </div>
    <div key={category} role="group" aria-label={title}
      className={`grid min-h-0 max-h-48 overflow-y-auto overscroll-contain px-3 py-1 ${network ? "grid-cols-2 gap-x-2" : "grid-cols-1"}`}>
      {ordered.map(file => <label key={file.id}
        className={`flex min-h-9 cursor-pointer items-center gap-2 rounded py-1 text-xs text-slate-700 hover:bg-slate-50 pointer-coarse:min-h-11 ${network && isAdditional(file) ? "col-span-2" : ""}`}>
        <input type="checkbox" className="h-3.5 w-3.5 shrink-0 accent-[#1b75a6]" disabled={disabled}
          checked={checked(file)} onChange={event => onSelect([file], event.target.checked)} />
        <span className="min-w-0 break-words">{file.label}</span>
      </label>)}
      {!items.length && <p className="col-span-full py-4 text-xs text-slate-500">{category === "perturbations" ? "No saved simulations" : "No outputs available"}</p>}
    </div>
    {category === "figures" && <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
      <label htmlFor={formatId}>Figure format</label>
      <select id={formatId} value={format} disabled={disabled} onChange={event => onFormatChange(event.target.value as Format)}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
        <option value="svg">SVG</option><option value="png">PNG</option>
      </select>
    </div>}
  </section>;
}
