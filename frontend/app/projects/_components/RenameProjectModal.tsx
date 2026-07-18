"use client";

import { useEffect, useRef, useState } from "react";
import { Project } from "../_types/project";

interface RenameProjectModalProps {
  project: Project | null;
  isSaving: boolean;
  isClosing: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (newName: string) => void;
}

export default function RenameProjectModal({
  project,
  isSaving,
  isClosing,
  error,
  onCancel,
  onConfirm,
}: RenameProjectModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (project) {
      // Sync form input with the currently-opened project.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(project.name ?? "");
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [project]);

  if (!project) return null;

  const trimmed = name.trim();
  const hasChanged = trimmed !== (project.name ?? "").trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 200 && hasChanged && !isSaving;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    onConfirm(trimmed);
  };

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-6 py-10 backdrop-blur-sm ${
        isClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      onMouseDown={onCancel}
    >
      <form
        onSubmit={handleSubmit}
        onMouseDown={(event) => event.stopPropagation()}
        className={`w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 ${
          isClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
      >
        <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
          Rename project
        </p>
        <h3 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
          Give it a new name
        </h3>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Renaming only affects how the project is displayed. Uploaded files and
          results are untouched.
        </p>

        <label className="mt-6 block">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
            Project name
          </span>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            disabled={isSaving}
            aria-invalid={Boolean(error)}
            className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-[#087ead] focus:ring-4 focus:ring-[#087ead]/10 disabled:opacity-60"
          />
        </label>

        {error ? (
          <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>
        ) : null}

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-[#1b75a6]/30 hover:bg-[#f2f9fc] hover:text-[#1b75a6] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-full bg-[#1b75a6] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#155f87] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          >
            {isSaving ? "Saving..." : "Save name"}
          </button>
        </div>
      </form>
    </div>
  );
}
