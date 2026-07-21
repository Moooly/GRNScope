import { Project } from "../_types/project";
import { formatProjectCreatedAt } from "../_lib/time";

interface DeleteProjectModalProps {
  project: Project | null;
  isDeleting: boolean;
  isClosing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeleteProjectModal({
  project,
  isDeleting,
  isClosing,
  onCancel,
  onConfirm,
}: DeleteProjectModalProps) {
  if (!project) {
    return null;
  }

  const createdAtLabel = formatProjectCreatedAt(
    project.createdAtTimestamp,
    project.createdAt
  );

  const tasks = project.latestJob?.tasks ?? [];
  const isRunning = tasks.some(
    (task) =>
      task.status === "Running" ||
      task.status === "Queued" ||
      task.status === "Stopping",
  );

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-6 py-10 backdrop-blur-sm ${
        isClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
    >
      <div
        className={`w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 ${
          isClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
      >
        <p className="text-sm font-bold uppercase tracking-[0.22em] text-rose-600">
          Delete project
        </p>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          This will permanently remove the project record, uploaded files, and
          job history from the backend.
        </p>

        <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
          <p className="min-w-0 max-w-full break-words font-bold leading-5 text-slate-900 [overflow-wrap:anywhere]">{project.name}</p>
          <p className="mt-2 text-xs font-medium text-slate-500">
            Created {createdAtLabel}
          </p>
        </div>

        {isRunning ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
            <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" aria-hidden="true">
              <path d="M8 1.75 L14.5 13.5 H1.5 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M8 6 v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="8" cy="11.5" r="0.85" fill="currentColor" />
            </svg>
            <p className="text-xs leading-5 text-amber-700">
              This project is currently running. Deleting it will stop all running algorithms first.
            </p>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-3 border-t border-[#213f54]/15 pt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="rounded-full border border-rose-200 bg-rose-50 px-5 py-3 text-sm font-bold text-rose-600 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeleting ? "Deleting..." : "Delete project"}
          </button>
        </div>
      </div>
    </div>
  );
}
