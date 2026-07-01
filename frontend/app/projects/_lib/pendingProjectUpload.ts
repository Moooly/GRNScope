"use client";

export type PendingProjectUpload = {
  expressionFile: File;
  pseudotimeFile: File | null;
  clusterLabelsFile: File | null;
};

const PENDING_UPLOAD_STORE_KEY = "__grnscopePendingProjectUploads";

declare global {
  interface Window {
    __grnscopePendingProjectUploads?: Map<string, PendingProjectUpload>;
  }
}

function pendingUploadStore() {
  if (typeof window === "undefined") {
    return new Map<string, PendingProjectUpload>();
  }

  window[PENDING_UPLOAD_STORE_KEY] ??= new Map<string, PendingProjectUpload>();
  return window[PENDING_UPLOAD_STORE_KEY];
}

export function registerPendingProjectUpload(
  projectId: string,
  upload: PendingProjectUpload,
) {
  pendingUploadStore().set(projectId, upload);
}

export function consumePendingProjectUpload(projectId: string) {
  const uploads = pendingUploadStore();
  const upload = uploads.get(projectId);
  if (upload) uploads.delete(projectId);
  return upload ?? null;
}
