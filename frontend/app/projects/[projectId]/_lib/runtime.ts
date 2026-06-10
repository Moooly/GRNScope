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

export function runtimeLabel(status: string, elapsedSeconds: number | null | undefined): string {
  if (status === "Queued") return "Not started";

  const runtime = formatAlgorithmRuntime(elapsedSeconds);
  if (status === "Running" || status === "Stopping") return `Running time ${runtime}`;
  return `Runtime ${runtime}`;
}

export function runtimeTitle({
  status,
  elapsedSeconds,
  startedAt,
  completedAt,
}: {
  status: string;
  elapsedSeconds: number | null | undefined;
  startedAt?: string | null;
  completedAt?: string | null;
}): string {
  const parts = [runtimeLabel(status, elapsedSeconds)];
  if (startedAt) parts.push(`Started ${startedAt}`);
  if (completedAt) parts.push(`Ended ${completedAt}`);
  return parts.join(" · ");
}
