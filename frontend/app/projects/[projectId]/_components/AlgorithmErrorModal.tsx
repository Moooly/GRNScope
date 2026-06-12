

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
  const openContactSupport = () => {
    const pageUrl = typeof window !== "undefined" ? window.location.href : "";
    const projectId = pageUrl.match(/\/projects\/([^/?#]+)/)?.[1];

    window.dispatchEvent(
      new CustomEvent("grnscope:open-contact", {
        detail: {
          algorithmId: task.algorithmId,
          projectId,
          pageUrl,
          question: `Algorithm ${task.algorithmId} failed.\n\nReason shown by GRNScope:\n${errorMessage}`,
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
            GRNScope could not finish this algorithm. The message below shows the most likely reason. If it is still unclear, contact us and we can inspect the runtime logs.
          </p>
        </div>

        <div className="mt-5 max-h-[45vh] overflow-y-auto rounded-[1.25rem] border border-rose-100 bg-rose-50/70 p-4">
          <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-rose-700">
            {errorMessage}
          </pre>
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

function normalizeAlgorithmErrorMessage(message: string, algorithmId: string): string {
  const trimmedMessage = message.trim();
  const lowered = trimmedMessage.toLowerCase();

  if (looksLikeProgressOnlyMessage(trimmedMessage)) {
    return `${algorithmId} stopped before writing an edge result. The captured logs only contain progress updates, so BEELINE did not return the real runtime error. Try rerunning this algorithm once. If it fails again, contact us so we can check the server logs.`;
  }

  if (
    lowered.includes("rankededges.csv not found") ||
    (lowered.includes("rankededges.csv") && lowered.includes("no such file"))
  ) {
    return `${algorithmId} finished without producing an edge result file. This usually means the Docker container stopped before exporting the algorithm output. If this happened after changing a Docker image, restore or rebuild that image and rerun the algorithm. If the problem continues, contact us with this project.`;
  }

  return trimmedMessage
    .replace(/\/home\/[^ ]+\/GRNScope\/backend\/projects\/[^\s'"]+/g, "project runtime file")
    .replace(/\/Users\/[^ ]+\/GRNScope\/backend\/projects\/[^\s'"]+/g, "project runtime file");
}

function looksLikeProgressOnlyMessage(message: string): boolean {
  const lowered = message.toLowerCase();
  const hasProgressBar = /\d+%\|/.test(message) || lowered.includes("s/it") || lowered.includes("it/s");
  const hasRunCounter = /\b\d+\s*\/\s*\d+\b/.test(message);
  const hasRealErrorMarker =
    lowered.includes("error") ||
    lowered.includes("exception") ||
    lowered.includes("failed") ||
    lowered.includes("no such file") ||
    lowered.includes("not found") ||
    lowered.includes("killed") ||
    lowered.includes("out of memory");

  return hasProgressBar && hasRunCounter && !hasRealErrorMarker;
}
