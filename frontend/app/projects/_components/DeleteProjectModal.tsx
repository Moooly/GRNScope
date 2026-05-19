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
        <h3 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
          Remove {project.name}?
        </h3>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          This will permanently remove the project record, uploaded files, and
          job history from the backend.
        </p>

        <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-bold text-slate-950">{project.name}</p>
          <p className="mt-2 text-xs font-medium text-slate-500">
            Created {createdAtLabel}
          </p>
        </div>

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
