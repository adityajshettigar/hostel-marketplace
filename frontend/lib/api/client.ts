/**
 * Gateway client — the ONLY network module in the frontend.
 * The gateway (:4000) is the only service ingress. Because it sends no CORS
 * headers, the browser calls the same-origin `/gw/...` proxy, which Next.js
 * rewrites server-side to NEXT_PUBLIC_GATEWAY_URL (see next.config.mjs).
 * No service is ever contacted directly.
 *
 * Integration note (documented, frontend-side only): the identity service
 * issues its refresh cookie with path=/api/auth/refresh, which does not match
 * the gateway path (/api/identity/auth/refresh), so the cookie does not flow
 * through the gateway. Sessions are therefore held in memory only (a
 * module-scoped variable — never localStorage/sessionStorage, brief §1) and
 * replayed as an Authorization header, exactly like every other
 * identity-service client. When the backend later sets a cookie that survives
 * proxying, only this file's token plumbing needs to change.
 */
import type { ZodType } from "zod";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Browser-visible API base: same-origin `/gw` (proxied to the gateway).
 * GATEWAY_URL remains the real gateway origin — used for the socket and any
 * server-side callers.
 */
export const API_BASE = "/gw";

export const GATEWAY_URL = (
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Memory-only session token (never persisted, never logged)
// ---------------------------------------------------------------------------

let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setSessionTokens(input: { accessToken: string; refreshToken: string } | null): void {
  accessToken = input?.accessToken ?? null;
  refreshToken = input?.refreshToken ?? null;
}

export function getAccessToken(): string | null {
  return accessToken;
}

type SessionHook = (tokens: { accessToken: string; refreshToken: string } | null) => void;
let sessionClearedHook: SessionHook | null = null;

/** Registered by the auth context so the client can report dead sessions. */
export function registerSessionClearedHook(fn: SessionHook): void {
  sessionClearedHook = fn;
}

type RefreshOnce = () => Promise<boolean>;
let refreshHook: RefreshOnce | null = null;

/** Registered by the auth context so client.ts can trigger one refresh on 401. */
export function registerRefreshHook(fn: RefreshOnce): void {
  refreshHook = fn;
}

export class RedirectedError extends Error {
  next: string;
  constructor(next: string) {
    super("redirected to login");
    this.name = "RedirectedError";
    this.next = next;
  }
}

export type RequestOptions<T = unknown> = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Optional Zod schema — validates AND types the response as T. */
  schema?: ZodType<T>;
  /** Internal: prevents infinite refresh loops. */
  isRetry?: boolean;
};

export async function request<T = unknown>(
  path: string,
  options: RequestOptions<T> = {},
): Promise<T> {
  const { method = "GET", body, schema, isRetry = false } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: "include", // future-proof: if the backend cookie path is fixed, this picks it up
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "GATEWAY UNREACHABLE — IS THE STACK RUNNING?");
  }

  if (res.status === 401 && !isRetry && refreshHook && !path.startsWith("/api/identity/auth")) {
    const refreshed = await refreshHook();
    if (refreshed) {
      return request<T>(path, { ...options, isRetry: true });
    }
    setSessionTokens(null);
    sessionClearedHook?.(null);
    if (typeof window !== "undefined") {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
      throw new RedirectedError(next);
    }
  }

  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!res.ok) {
    const err = (json ?? {}) as { error?: string; message?: string; details?: unknown };
    throw new ApiError(
      res.status,
      err.error ?? "ERROR",
      friendlyMessage(res.status, err.error ?? "ERROR", err.message ?? "Request failed"),
      err.details,
    );
  }

  if (schema) {
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(500, "BAD_SHAPE", "GATEWAY RETURNED AN UNEXPECTED RESPONSE SHAPE");
    }
    return parsed.data as T;
  }
  return json as T;
}

function friendlyMessage(status: number, code: string, fallback: string): string {
  switch (status) {
    case 400:
      return fallback.toUpperCase();
    case 401:
      return "YOUR SESSION EXPIRED — LOG IN AGAIN";
    case 403:
      return "YOU DO NOT HAVE ACCESS TO DO THAT";
    case 404:
      return "NOT FOUND";
    case 409:
      return fallback.toUpperCase();
    case 429:
      return "TOO MANY REQUESTS — SLOW DOWN AND TRY AGAIN SHORTLY";
    case 502:
      return "THE SERVICE IS TEMPORARILY UNREACHABLE";
    case 503:
      return fallback.toUpperCase();
    default:
      return fallback.toUpperCase();
  }
}
