const PROJECT_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function dateFromProjectTimestamp(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return new Date(value * 1000);
  }

  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    return new Date(numericValue * 1000);
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return parsedDate;
}

export function formatProjectCreatedAt(
  timestamp: number | string | null | undefined,
  fallback: string
) {
  const date = dateFromProjectTimestamp(timestamp);

  if (!date) return fallback;

  return PROJECT_TIME_FORMAT.format(date).replace(",", "");
}
