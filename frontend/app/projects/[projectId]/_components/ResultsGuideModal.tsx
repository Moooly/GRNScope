

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
      onMouseDown={(event) => event.stopPropagation()}
      onClick={onClose}
    >
      <div
        className="max-h-[calc(100vh-5rem)] w-full max-w-2xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl shadow-slate-900/20 animate-modal-panel"
        onMouseDown={(event) => event.stopPropagation()}
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
            <h4 className="text-base font-bold text-slate-950">Evidence</h4>
            <p className="mt-1 text-sm leading-5 text-slate-600">
              Controls the minimum full-data regulation evidence required for a
              regulation to appear. Evidence is a per-target percentile, so
              methods with different native score scales can be compared.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-base font-bold text-slate-950">Confidence level</h4>
            <p className="mt-1 text-sm leading-5 text-slate-600">
              Controls the minimum bootstrap recovery required for an edge to
              appear. New analyses draw the full number of cells with
              replacement and report how often the edge&apos;s normalized
              per-target evidence reaches the configured threshold τ. It
              measures sensitivity to sampled cells, not uncertainty between
              donors or causality.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-base font-bold text-slate-950">Direction confidence</h4>
            <p className="mt-1 text-sm leading-5 text-slate-600">
              Keeps edges only when direction-aware methods agree strongly enough on the arrow direction. Methods that cannot infer direction abstain instead of lowering this confidence.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-base font-bold text-slate-950">Sign stability</h4>
            <p className="mt-1 text-sm leading-5 text-slate-600">
              Keeps edges only when enough signed bootstrap recoveries agree
              with the activation or repression shown by the full-data result
              (or the bootstrap-mean sign for a bootstrap-only edge).
              Sign coverage reports how many recovered samples supplied a
              nonzero sign. Unsigned methods and legacy results without
              bootstrap sign data abstain.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-base font-bold text-slate-950">Minimum supporting methods</h4>
            <p className="mt-1 text-sm leading-5 text-slate-600">
              Used when two or more algorithms are selected. An edge must be supported by at least this many selected algorithms to remain visible.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-[1.25rem] border border-[#1b75a6]/15 bg-[#f2f9fc] p-4">
          <p className="text-sm leading-5 text-slate-700">
            These controls update only the Network tab. Comparison tools use
            their own clearly labeled settings so an invisible graph filter
            cannot change their conclusions.
          </p>
        </div>
      </div>
    </div>
  );
}
