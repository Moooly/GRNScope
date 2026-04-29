

"use client";

type AlgorithmHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function AlgorithmHelpModal({ open, onClose }: AlgorithmHelpModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 px-6 py-10 backdrop-blur-sm animate-modal-overlay"
      onClick={onClose}
    >
      <div
        className="max-h-[70vh] w-full max-w-xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 animate-modal-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
            Algorithms guide
          </p>
          <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950">
            What do these algorithm properties mean?
          </h3>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            Each card summarizes one algorithm result and the main properties that affect how the method should be understood.
          </p>
        </div>

        <div className="mt-5 space-y-3">
          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-sm font-bold text-slate-950">Method description</h4>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              The short text under the algorithm name describes the method family, such as random forest, regression, correlation, or information-theory based inference.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-sm font-bold text-slate-950">Pseudotime property</h4>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Pseudotime means the algorithm uses cell ordering information. No pseudotime means the method only uses the expression matrix without cell-order information.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-sm font-bold text-slate-950">Directed or undirected</h4>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Directed means the algorithm predicts a source gene and target gene direction. Undirected means the result mainly shows association without a clear regulatory direction.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-sm font-bold text-slate-950">Signed or unsigned</h4>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Signed methods can indicate whether a relationship is activating or repressing. Unsigned methods only report the strength of the predicted relationship.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-sm font-bold text-slate-950">Status and download</h4>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              A check mark means the algorithm completed successfully. The download button exports the raw ranked edge result for that method.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-[1.25rem] border border-[#1b75a6]/15 bg-[#f2f9fc] p-4">
          <p className="text-xs leading-5 text-slate-700">
            These properties help compare algorithms without showing long descriptions directly on each card.
          </p>
        </div>
      </div>
    </div>
  );
}