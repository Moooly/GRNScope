const DEFAULT_API_BASE = "/api";
const ALLOW_CROSS_ORIGIN_API =
  process.env.NEXT_PUBLIC_ALLOW_CROSS_ORIGIN_API === "true";

function withoutTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function configuredApiBase() {
  return withoutTrailingSlash(process.env.NEXT_PUBLIC_API_URL?.trim() || "");
}

export function getApiBase() {
  const configured = configuredApiBase();
  if (!configured) return DEFAULT_API_BASE;

  if (typeof window !== "undefined" && !ALLOW_CROSS_ORIGIN_API) {
    try {
      const configuredUrl = new URL(configured, window.location.origin);
      if (configuredUrl.origin !== window.location.origin) {
        return DEFAULT_API_BASE;
      }
    } catch {
      return DEFAULT_API_BASE;
    }
  }

  return configured;
}

export function getApiRoot(apiBase = getApiBase()) {
  return apiBase.replace(/\/api\/?$/, "");
}

export const API_BASE = getApiBase();
export const API_ROOT = getApiRoot(API_BASE);
