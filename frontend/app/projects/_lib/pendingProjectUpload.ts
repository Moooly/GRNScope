"use client";

import { apiFetch, getClientId } from "../../_lib/clientIdentity";

export type PendingProjectUpload = {
  expressionFile: File;
  pseudotimeFile: File | null;
  groundTruthFile: File | null;
  clusterLabelsFile: File | null;
  geneOrderingFile: File | null;
  customTfListFile: File | null;
};

type PendingProjectUploadRecord = {
  upload: PendingProjectUpload;
  promise?: Promise<void>;
};

const PENDING_UPLOAD_STORE_KEY = "__grnscopePendingProjectUploads";

declare global {
  interface Window {
    __grnscopePendingProjectUploads?: Map<string, PendingProjectUploadRecord>;
  }
}

function pendingUploadStore() {
  if (typeof window === "undefined") {
    return new Map<string, PendingProjectUploadRecord>();
  }

  window[PENDING_UPLOAD_STORE_KEY] ??= new Map<string, PendingProjectUploadRecord>();
  return window[PENDING_UPLOAD_STORE_KEY];
}

export function registerPendingProjectUpload(
  projectId: string,
  upload: PendingProjectUpload,
) {
  pendingUploadStore().set(projectId, { upload });
}

function uploadProjectFilesWithXhr(
  apiBase: string,
  projectId: string,
  upload: PendingProjectUpload,
) {
  return new Promise<void>((resolve, reject) => {
    const formData = new FormData();
    formData.append("expression_matrix", upload.expressionFile);
    if (upload.pseudotimeFile) {
      formData.append("pseudotime", upload.pseudotimeFile);
    }
    if (upload.groundTruthFile) {
      formData.append("ground_truth", upload.groundTruthFile);
    }
    if (upload.clusterLabelsFile) {
      formData.append("cluster_labels", upload.clusterLabelsFile);
    }
    if (upload.geneOrderingFile) {
      formData.append("gene_ordering", upload.geneOrderingFile);
    }
    if (upload.customTfListFile) {
      formData.append("custom_tf_list", upload.customTfListFile);
    }

    const request = new XMLHttpRequest();
    request.open("POST", `${apiBase}/projects/${projectId}/upload-and-start`);
    request.withCredentials = true;
    request.setRequestHeader("X-GRNScope-Client-ID", getClientId());

    request.onload = () => {
      let payload: { ok?: boolean; errors?: string[] } | null = null;
      try {
        payload = request.responseText
          ? JSON.parse(request.responseText) as { ok?: boolean; errors?: string[] }
          : null;
      } catch {
        payload = null;
      }

      if (request.status >= 200 && request.status < 300 && payload?.ok) {
        resolve();
        return;
      }

      reject(
        new Error(
          payload?.errors?.length
            ? payload.errors.join("\n")
            : `Could not upload project files. HTTP ${request.status}`,
        ),
      );
    };

    request.onerror = () => reject(new Error("Dataset upload failed."));
    request.onabort = () => reject(new Error("Dataset upload was interrupted."));
    request.ontimeout = () => reject(new Error("Dataset upload timed out."));
    request.send(formData);
  });
}

async function markProjectUploadFailed(
  apiBase: string,
  projectId: string,
  message: string,
) {
  const formData = new FormData();
  formData.append("message", message);
  await apiFetch(`${apiBase}/projects/${projectId}/upload-failed`, {
    method: "POST",
    body: formData,
  });
}

export function startPendingProjectUpload(projectId: string, apiBase: string) {
  const uploads = pendingUploadStore();
  const record = uploads.get(projectId);
  if (!record) return null;
  if (record.promise) return record.promise;

  record.promise = uploadProjectFilesWithXhr(apiBase, projectId, record.upload)
    .then(() => {
      uploads.delete(projectId);
    })
    .catch(async (error) => {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Dataset upload failed before analysis could start.";
      await markProjectUploadFailed(apiBase, projectId, message).catch((markError) => {
        console.error("Could not mark project upload as failed:", markError);
      });
      console.error("Project file upload failed after navigation:", error);
      throw error;
    });

  return record.promise;
}
