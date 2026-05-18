"use client";

const CLIENT_COOKIE_NAME = "grnscope_client_id";
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function createClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function readCookie(name: string) {
  if (typeof document === "undefined") return null;

  const prefix = `${name}=`;
  const value = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));

  return value ? decodeURIComponent(value.slice(prefix.length)) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;

  document.cookie = [
    `${name}=${encodeURIComponent(value)}`,
    "Max-Age=31536000",
    "Path=/",
    "SameSite=Lax",
  ].join("; ");
}

export function getClientId() {
  const existing = readCookie(CLIENT_COOKIE_NAME);
  if (existing && CLIENT_ID_PATTERN.test(existing)) {
    return existing;
  }

  const next = createClientId();
  writeCookie(CLIENT_COOKIE_NAME, next);
  return next;
}

export function withClientIdentity(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("X-GRNScope-Client-ID", getClientId());

  return {
    ...init,
    credentials: "include",
    headers,
  };
}

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, withClientIdentity(init));
}
