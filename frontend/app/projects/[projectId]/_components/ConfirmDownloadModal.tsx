

"use client";

import { apiFetch } from "../../../_lib/clientIdentity";

type PendingDownload = {
  label: string;
  href: string;
  filename: string;
};

type ConfirmDownloadModalProps = {
  pendingDownload: PendingDownload | null;
  isClosing: boolean;
  onClose: () => void;
};

export default function ConfirmDownloadModal({
  pendingDownload,
  isClosing,
  onClose,
}: ConfirmDownloadModalProps) {
  if (!pendingDownload) return null;

  const downloadFile = async () => {
    try {
      const response = await apiFetch(pendingDownload.href);
      if (!response.ok) return;

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = pendingDownload.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      onClose();
    } catch {
      return;
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 px-6 py-10 backdrop-blur-sm ${
        isClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 ${
          isClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
            Confirm download
          </p>
          <h3 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
            {pendingDownload.label}
          </h3>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            This will download the selected file to your device.
          </p>
        </div>

        <div className="mt-6 rounded-[1.25rem] border border-slate-200 bg-slate-50 px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
            File name
          </p>
          <p className="mt-2 break-words text-sm font-bold text-slate-800">
            {pendingDownload.filename}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={downloadFile}
            className="rounded-full bg-[#1b75a6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#155f87]"
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
