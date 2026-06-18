

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

  const isMatrixValidationError = task.errorType === "matrix_validation";
  const errorMessage = isMatrixValidationError
    ? normalizeMatrixErrorMessage(task.errorMessage)
    : normalizeAlgorithmErrorMessage(task.errorMessage, task.algorithmId);
  const eyebrow = isMatrixValidationError ? "Matrix upload error" : "Algorithm error";
  const title = isMatrixValidationError
    ? "Uploaded matrix could not be prepared"
    : `${task.algorithmId} failed`;
  const description = isMatrixValidationError
    ? "GRNScope accepted the quick upload check, but found this matrix issue while preparing the project for algorithms. Fix the CSV and start a new project with the corrected file."
    : "GRNScope could not finish this algorithm. The message below explains what happened. If it is still unclear, contact us with this project.";
  const openContactSupport = () => {
    const pageUrl = typeof window !== "undefined" ? window.location.href : "";
    const projectId = pageUrl.match(/\/projects\/([^/?#]+)/)?.[1];
    const question = isMatrixValidationError
      ? `Uploaded matrix validation failed after project start.\n\nReason shown by GRNScope:\n${errorMessage}`
      : `Algorithm ${task.algorithmId} failed.\n\nReason shown by GRNScope:\n${errorMessage}`;

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
            {eyebrow}
          </p>
          <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950">
            {title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {description}
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

function normalizeMatrixErrorMessage(message: string): string {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return "GRNScope found a problem in the uploaded expression matrix while preparing the project.";
  }

  return trimmedMessage
    .replace(/\/home\/[^ ]+\/GRNScope\/backend\/projects\/[^\s'"]+/g, "project runtime file")
    .replace(/\/Users\/[^ ]+\/GRNScope\/backend\/projects\/[^\s'"]+/g, "project runtime file")
    .replace(/\/private\/var\/[^\s'"]+/g, "temporary runtime file");
}

function normalizeAlgorithmErrorMessage(message: string, algorithmId: string): string {
  const trimmedMessage = message.trim();
  const lowered = trimmedMessage.toLowerCase();

  if (looksLikeProgressOnlyMessage(trimmedMessage)) {
    return `${algorithmId} stopped before creating a network result. GRNScope could not identify a specific reason from the captured output. Try running the algorithm again. If it fails again, contact us with this project.`;
  }

  if (
    lowered.includes("rankededges.csv not found") ||
    (lowered.includes("rankededges.csv") && lowered.includes("no such file"))
  ) {
    return `${algorithmId} did not return a network result. This can happen when the algorithm stops early or cannot save its output. Try running the algorithm again. If it fails again, contact us with this project.`;
  }

  const cleanedMessage = trimmedMessage
    .replace(/\/home\/[^ ]+\/GRNScope\/backend\/projects\/[^\s'"]+/g, "project runtime file")
    .replace(/\/Users\/[^ ]+\/GRNScope\/backend\/projects\/[^\s'"]+/g, "project runtime file");

  if (containsInternalDetails(cleanedMessage)) {
    return `${algorithmId} could not complete the analysis. GRNScope received an internal execution error instead of a usable network result. Try running the algorithm again. If it fails again, contact us with this project.`;
  }

  return cleanedMessage;
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

function containsInternalDetails(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("beeline") ||
    lowered.includes("docker") ||
    lowered.includes("container") ||
    lowered.includes("server log") ||
    lowered.includes("runtime log") ||
    lowered.includes("runtime file") ||
    lowered.includes("rankededges.csv") ||
    lowered.includes("/home/") ||
    lowered.includes("/users/") ||
    lowered.includes("/private/var/")
  );
}
