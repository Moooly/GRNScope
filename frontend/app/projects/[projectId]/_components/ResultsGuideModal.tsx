

"use client";

type ResultsGuideModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function ResultsGuideModal({ open, onClose }: ResultsGuideModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 px-6 py-10 backdrop-blur-sm animate-modal-overlay"
      onClick={onClose}
    >
      <div
        className="max-h-[calc(100vh-5rem)] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl shadow-slate-900/20 animate-modal-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
            Results settings guide
          </p>
          <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950">
            What do these controls mean?
          </h3>
        </div>

        <div className="mt-4 space-y-3">
          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-base font-bold text-slate-950">Algorithm selector</h4>
            <p className="mt-1 text-sm leading-5 text-slate-600">
              Choose which completed algorithms are included in the current result view. Selecting one algorithm shows that method&apos;s edges. Selecting two or more algorithms creates a consensus view based on the selected methods.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-base font-bold text-slate-950">Confidence filter</h4>
            <p className="mt-1 text-sm leading-5 text-slate-600">
              Controls the minimum edge-existence evidence required for an edge to appear. Evidence is computed by ranking candidate regulators separately for each target gene, so algorithms with different score scales can still be compared.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-base font-bold text-slate-950">Consensus threshold</h4>
            <p className="mt-1 text-sm leading-5 text-slate-600">
              Used when two or more algorithms are selected. It controls how many selected algorithms must rank the edge above their own median evidence before the edge appears in the consensus network and table.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-base font-bold text-slate-950">Direction and sign</h4>
            <p className="mt-1 text-sm leading-5 text-slate-600">
              Direction and sign are annotations on top of edge evidence. Directed or signed algorithms contribute to their own confidence and coverage metrics, while algorithms that cannot provide that information abstain.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-[1.25rem] border border-[#1b75a6]/15 bg-[#f2f9fc] p-4">
          <p className="text-sm leading-5 text-slate-700">
            These controls update the overlap visualization, network view, and edge analysis table together.
          </p>
        </div>
      </div>
    </div>
  );
}
