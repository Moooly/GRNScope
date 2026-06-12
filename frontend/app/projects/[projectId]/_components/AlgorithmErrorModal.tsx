

"use client";

type AlgorithmErrorTask = {
  algorithmId: string;
  errorMessage: string;
};

type AlgorithmErrorModalProps = {
  task: AlgorithmErrorTask | null;
  onClose: () => void;
};

export default function AlgorithmErrorModal({ task, onClose }: AlgorithmErrorModalProps) {
  if (!task) return null;

  const errorMessage = normalizeAlgorithmErrorMessage(task.errorMessage, task.algorithmId);

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
            The selected algorithm did not finish successfully. Review the message below for details.
          </p>
        </div>

        <div className="mt-5 max-h-[45vh] overflow-y-auto rounded-[1.25rem] border border-rose-100 bg-rose-50/70 p-4">
          <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-rose-700">
            {errorMessage}
          </pre>
        </div>

        <div className="mt-5 flex justify-end">
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

function normalizeAlgorithmErrorMessage(message: string, algorithmId: string): string {
  const trimmedMessage = message.trim();
  const lowered = trimmedMessage.toLowerCase();

  if (
    lowered.includes("rankededges.csv not found") ||
    (lowered.includes("rankededges.csv") && lowered.includes("no such file"))
  ) {
    return `${algorithmId} finished without producing an edge result. This usually means the algorithm container stopped before exporting its output. If this happened after changing a Docker image, restore or rebuild that image and rerun the algorithm.`;
  }

  return trimmedMessage
    .replace(/\/home\/[^ ]+\/GRNScope\/backend\/projects\/[^\s'"]+/g, "project runtime file")
    .replace(/\/Users\/[^ ]+\/GRNScope\/backend\/projects\/[^\s'"]+/g, "project runtime file");
}
