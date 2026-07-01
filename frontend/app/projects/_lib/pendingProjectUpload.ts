"use client";

export type PendingProjectUpload = {
  expressionFile: File;
  pseudotimeFile: File | null;
  clusterLabelsFile: File | null;
};

const pendingUploads = new Map<string, PendingProjectUpload>();

export function registerPendingProjectUpload(
  projectId: string,
  upload: PendingProjectUpload,
) {
  pendingUploads.set(projectId, upload);
}

export function consumePendingProjectUpload(projectId: string) {
  const upload = pendingUploads.get(projectId);
  if (upload) pendingUploads.delete(projectId);
  return upload ?? null;
}
