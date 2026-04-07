export function boolText(value: boolean | string | undefined) {
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (value === "true") return "Enabled";
  if (value === "false") return "Disabled";
  return "-";
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}