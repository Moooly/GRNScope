import type { ProjectAlgorithm } from "../page";

interface AlgorithmCardProps {
  algorithm: ProjectAlgorithm;
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
      className={`group flex w-full flex-col rounded-[1.5rem] border p-5 text-left shadow-sm transition duration-200 ${
        disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
          : checked
            ? "cursor-pointer border-[#1b75a6]/40 bg-[#f2f9fc] shadow-md shadow-slate-200/70"
            : "cursor-pointer border-slate-200 bg-white hover:-translate-y-1 hover:border-[#1b75a6]/25 hover:shadow-xl hover:shadow-slate-200/70"
      }`}
    >
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              {showCheckbox && (
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-bold transition ${
                    checked
                      ? "border-[#1b75a6] bg-[#1b75a6] text-white"
                      : "border-slate-300 bg-white text-transparent"
                  }`}
                >
                  ✓
                </span>
              )}
              <h3 className="truncate text-xl font-bold tracking-tight text-slate-950">
                {algorithm.name}
              </h3>
            </div>
            <p className="mt-2 line-clamp-2 min-h-[3rem] text-sm leading-6 text-slate-600">
              {algorithm.tagline}
            </p>
          </div>

          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {algorithm.year}
          </span>
        </div>

        <div className="mt-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5">
            <p className="text-[0.64rem] font-bold uppercase tracking-[0.16em] text-slate-400">
              Methodology
            </p>
            <p className="mt-1 text-sm font-bold leading-5 text-[#1b75a6]">
              {algorithm.category}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">
              {algorithm.requiresPseudotime ? "Pseudotime" : "No Pseudotime"}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">
              {algorithm.directed ? "Directed" : "Undirected"}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">
              {algorithm.signed ? "Signed" : "Unsigned"}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}