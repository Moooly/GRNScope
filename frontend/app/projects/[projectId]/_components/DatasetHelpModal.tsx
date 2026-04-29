

"use client";

type DatasetHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function DatasetHelpModal({ open, onClose }: DatasetHelpModalProps) {
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
              Dataset and preprocessing guide
            </p>
            <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950">
              What do these settings mean?
            </h3>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              These values summarize the input matrix and preprocessing steps used before running the GRN inference algorithms.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-sm font-bold text-slate-950">Matrix size</h4>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Shows the shape of the expression matrix. In this project, rows are genes and columns are cells.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-sm font-bold text-slate-950">Gene filtering</h4>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Controls how many highly variable genes are retained before inference. Keeping all genes means no top-variable-gene reduction was applied.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-sm font-bold text-slate-950">TF override</h4>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Keeps known transcription factors in the dataset even if they would otherwise be removed during filtering.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-sm font-bold text-slate-950">Normalization</h4>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Adjusts library-size differences across cells so expression values are more comparable.
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
            <h4 className="text-sm font-bold text-slate-950">log₂(x + 1) transformation</h4>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Compresses large expression values and reduces scale effects before algorithms are run.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-[1.25rem] border border-[#1b75a6]/15 bg-[#f2f9fc] p-4">
          <p className="text-xs leading-5 text-slate-700">
            These settings describe the data preparation steps used before the algorithm results are generated.
          </p>
        </div>
      </div>
    </div>
  );
}