

"use client";

type AlgorithmErrorTask = {
  algorithmId: string;
  errorMessage: string;
  errorType?: string | null;
};

type AlgorithmErrorModalProps = {
  task: AlgorithmErrorTask | null;
  onClose: () => void;
};

export default function AlgorithmErrorModal({ task, onClose }: AlgorithmErrorModalProps) {
  if (!task) return null;

  const openContactSupport = () => {
    const pageUrl = typeof window !== "undefined" ? window.location.href : "";
    const projectId = pageUrl.match(/\/projects\/([^/?#]+)/)?.[1];
    const question = `Algorithm ${task.algorithmId} failed in this project. Please help me investigate the issue.`;

    window.dispatchEvent(
      new CustomEvent("grnscope:open-contact", {
        detail: {
          algorithmId: task.algorithmId,
          projectId,
          pageUrl,
          question,
        },
      }),
    );
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 px-6 py-10 backdrop-blur-sm animate-modal-overlay"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 animate-modal-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-rose-600">
            Algorithm error
          </p>
          <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950">
            {task.algorithmId} failed
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            GRNScope could not produce a result for this algorithm.
          </p>
        </div>

        <div className="mt-5 rounded-[1.25rem] border border-rose-100 bg-rose-50/70 p-4 text-sm leading-6 text-slate-700">
          <p>
            Try running the algorithm again. If it continues to fail, contact us and
            we’ll investigate it using this project’s details. Your project and results
            from other algorithms are not affected.
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={openContactSupport}
            className="rounded-full bg-[#1b75a6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#16638f]"
          >
            Contact us
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
