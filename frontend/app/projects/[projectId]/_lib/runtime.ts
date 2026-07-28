export function formatAlgorithmRuntime(seconds: number | null | undefined): string {
  const numeric = Number(seconds ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0s";

  const totalSeconds = Math.floor(numeric);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secondsRemainder = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return `${minutes}m ${secondsRemainder.toString().padStart(2, "0")}s`;
  }

  return `${secondsRemainder}s`;
}

function queuedLabel(progressLabel?: string | null): string {
  const normalized = progressLabel?.trim();
  if (normalized && normalized.toLowerCase() !== "queued") return normalized;
  return "Not started";
}

export function runtimeLabel(
  status: string,
  elapsedSeconds: number | null | undefined,
  progressLabel?: string | null,
): string {
  if (status === "Queued" || status === "NotStarted") return queuedLabel(progressLabel);

  const runtime = formatAlgorithmRuntime(elapsedSeconds);
  if (status === "Running" || status === "Stopping") return `${status} ${runtime}`;
  if (status === "Stopped") {
    return Number(elapsedSeconds ?? 0) > 0 ? `Stopped after ${runtime}` : "Stopped";
  }
  if (status === "Failed") {
    return Number(elapsedSeconds ?? 0) > 0 ? `Failed after ${runtime}` : "Failed";
  }
  if (status === "Skipped") return "Skipped";
  return `Runtime ${runtime}`;
}

function runtimeTitleLabel(
  status: string,
  elapsedSeconds: number | null | undefined,
  progressLabel?: string | null,
): string {
  if (status === "Queued" || status === "NotStarted") return queuedLabel(progressLabel);

  const runtime = formatAlgorithmRuntime(elapsedSeconds);
  if (status === "Running" || status === "Stopping") return `Running time ${runtime}`;
  if (status === "Stopped") {
    return Number(elapsedSeconds ?? 0) > 0 ? `Stopped after ${runtime}` : "Stopped";
  }
  if (status === "Failed") {
    return Number(elapsedSeconds ?? 0) > 0 ? `Failed after ${runtime}` : "Failed";
  }
  if (status === "Skipped") return "Skipped";
  return `Runtime ${runtime}`;
}

export function runtimeTitle({
  status,
  elapsedSeconds,
  progressLabel,
  startedAt,
  completedAt,
}: {
  status: string;
  elapsedSeconds: number | null | undefined;
  progressLabel?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}): string {
  const parts = [runtimeTitleLabel(status, elapsedSeconds, progressLabel)];
  if (startedAt) parts.push(`Started ${startedAt}`);
  if (completedAt) parts.push(`Ended ${completedAt}`);
  return parts.join(" · ");
}
