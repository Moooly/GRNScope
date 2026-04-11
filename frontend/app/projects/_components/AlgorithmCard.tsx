import { Algorithm } from "../_types/algorithm";

interface AlgorithmCardProps {
  algorithm: Algorithm;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  showCheckbox?: boolean;
}

export default function AlgorithmCard({
  algorithm,
  checked,
  disabled,
  onToggle,
  showCheckbox = true,
}: AlgorithmCardProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`w-full rounded-[2rem] border p-5 text-left transition ${
        disabled
          ? "cursor-not-allowed border-white/10 bg-white/[0.02] opacity-55"
          : checked
            ? "cursor-pointer border-teal-300/30 bg-teal-300/10"
            : "cursor-pointer border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            {showCheckbox && (
              <input
                type="checkbox"
                checked={checked}
                readOnly
                className="h-4 w-4"
              />
            )}
            <h3 className="text-xl font-semibold text-white">{algorithm.name}</h3>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            {algorithm.description}
          </p>
        </div>
        <span className="min-w-[84px] rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-center text-xs whitespace-nowrap text-slate-300">
          {algorithm.runtime}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-medium text-slate-300">
          {algorithm.category}
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-300">
          {algorithm.directed ? "Directed" : "Undirected"}
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-300">
          {algorithm.signed ? "Signed" : "Unsigned"}
        </span>
        {algorithm.requiresPseudotime && (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-slate-300">
            Requires pseudotime
          </span>
        )}
      </div>

      <div className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3 text-xs text-slate-400">
        <span className="whitespace-nowrap">{algorithm.year}</span>
        <span className="truncate text-right" title={algorithm.journal}>
          {algorithm.journal}
        </span>
      </div>
    </button>
  );
}