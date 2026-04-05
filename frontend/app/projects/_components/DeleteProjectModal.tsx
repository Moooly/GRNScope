import { Project } from "../_types/project";

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

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 px-6 py-10 backdrop-blur-sm ${
        isClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
    >
      <div
        className={`w-full max-w-md rounded-[2rem] border border-white/10 bg-slate-900 p-6 shadow-2xl shadow-cyan-950/20 ${
          isClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
      >
        <p className="text-sm font-medium uppercase tracking-[0.22em] text-rose-300">
          Delete project
        </p>
        <h3 className="mt-4 text-2xl font-semibold text-white">
          Remove {project.name}?
        </h3>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          This will permanently remove the project record, uploaded files, and
          job history from the backend.
        </p>

        <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-4">
          <p className="text-sm font-medium text-white">{project.name}</p>
          <p className="mt-2 text-xs text-slate-400">Created {project.createdAt}</p>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-5 py-3 text-sm font-medium text-rose-200 transition hover:border-rose-400/35 hover:bg-rose-400/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeleting ? "Deleting..." : "Delete project"}
          </button>
        </div>
      </div>
    </div>
  );
}