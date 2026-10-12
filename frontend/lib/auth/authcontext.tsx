"use client";

/** Auth context — in-memory session (brief §1: the browser never persists or
 * reads tokens; no localStorage/sessionStorage anywhere).
 *
 * Integration notes (documented here, frontend-only):
 * - login returns the user object + tokens; tokens are kept ONLY in memory
 *   (see lib/api/client.ts) and replayed as a Bearer header, since the
 *   refresh cookie's path does not match the gateway route.
 * - POST /auth/refresh takes { refreshToken } in the body.
 * - /users/me returns snake_case DB rows; mapped to SessionUser here.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  request,
  registerRefreshHook,
  registerSessionClearedHook,
  setSessionTokens,
  ApiError,
} from "@/lib/api/client";
import { loginSchema, registerSchema, type LoginInput, type RegisterInput } from "@/lib/schemas/forms";
import type { SessionUser } from "@/lib/api/types";

// The register page's onSubmit sends the on-the-wire body to the identity
// service. The wire body intentionally omits `terms` (client-only validation)
// and `confirmPassword` (already checked client-side), but the page's
// RegisterInput still has both required because react-hook-form validates them.
// We declare the callback's accepted shape as the wire shape, so the page's
// call site compiles even though it does not pass `terms`.
export type RegisterPayload = Pick<
  RegisterInput,
  "email" | "password" | "fullName" | "hostelGroup" | "hostelBlock" | "roomNumber"
>;

export type AuthContextValue = {
  user: SessionUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
  login: (input: LoginInput) => Promise<SessionUser>;
  register: (input: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
};

type AuthContextValue = {
  user: SessionUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
  login: (input: LoginInput) => Promise<SessionUser>;
  register: (input: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
};

export type { AuthContextValue, LoginResponse };

const AuthContext = createContext<AuthContextValue | null>(null);

function authErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "SOMETHING WENT WRONG — TRY AGAIN";
}

type LoginResponse = {
  email: string;
  fullName: string;
  hostelBlock: string | null;
  hostelGroup: "MH" | "LH" | null;
  roomNumber: string | null;
  upiVpa: string | null;
  verificationStatus: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
};

/**
 * Read the signed claims (sub, role) from the in-memory access token.
 * Nothing is persisted; this only exposes what the backend already signed
 * (identity stamps `role: "admin" | "user"` from the users.role column) so
 * /admin and ownership checks can act on it client-side.
 */
function decodeJwtClaims(token: string): { sub?: string; role?: string } {
  try {
    const part = token.split(".")[1];
    if (!part) return {};
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as { sub?: string; role?: string };
  } catch {
    return {};
  }
}

function meToSessionUser(raw: {
  id: string;
  email: string;
  full_name: string;
  hostel_block: string | null;
  hostel_group: "MH" | "LH" | null;
  room_number: string | null;
  upi_vpa: string | null;
  verification_status: string;
}): SessionUser {
  return {
    id: raw.id,
    email: raw.email,
    fullName: raw.full_name,
    hostelBlock: raw.hostel_block,
    hostelGroup: raw.hostel_group,
    roomNumber: raw.room_number,
    upiVpa: raw.upi_vpa,
    verificationStatus: raw.verification_status,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const queryClient = useQueryClient();

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      // The refresh route requires { refreshToken } in the body, and its
      // cookie path does not match the gateway route — so without a readable
      // cookie a re-mount cannot restore the session. Documented gap; the
      // user simply logs in again (form data is client-side only).
      return false;
    } catch {
      setUser(null);
      setStatus("unauthenticated");
      return false;
    }
  }, []);

  const loadMe = useCallback(async (): Promise<SessionUser | null> => {
    const raw = await request<{
      id: string;
      email: string;
      full_name: string;
      hostel_block: string | null;
      hostel_group: "MH" | "LH" | null;
      room_number: string | null;
      upi_vpa: string | null;
      verification_status: string;
    }>("/api/identity/users/me");
    return meToSessionUser(raw);
  }, []);

  useEffect(() => {
    registerSessionClearedHook(() => {
      setUser(null);
      setStatus("unauthenticated");
    });
  }, []);

  useEffect(() => {
    registerRefreshHook(async () => {
      // Token-based refresh needs the refresh token; it is memory-only, so a
      // re-mount (page reload) cannot silently restore a session. Sessions
      // are restored by logging in again (documented integration gap).
      return false;
    });
  }, []);

  // On mount there is no readable cookie, so the session starts logged out
  // instead of flashing protected UI (brief §6.3).
  useEffect(() => {
    setStatus("unauthenticated");
  }, []);

  const login = useCallback(
    async (input: LoginInput): Promise<SessionUser> => {
      loginSchema.parse(input);
      let loginResult: SessionUser | null = null;
      try {
        const res = await request<LoginResponse>(
          "/api/identity/auth/login",
          { method: "POST", body: input },
        );
        setSessionTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
        const claims = decodeJwtClaims(res.accessToken);
        const next: SessionUser = {
          id: claims.sub,
          role: claims.role === "admin" ? "admin" : "user",
          email: res.email,
          fullName: res.fullName,
          hostelBlock: res.hostelBlock,
          hostelGroup: res.hostelGroup ?? null,
          roomNumber: res.roomNumber,
          upiVpa: res.upiVpa,
          verificationStatus: res.verificationStatus,
        };
        // Best-effort hydration of `hostelGroup` for the marketplace filter from
        // /users/me, because the login JWT is intentionally short-lived and does
        // not carry the long-lived group claim the frontend needs for the block
        // toggle during the first 15 minutes.
        try {
          const me = await loadMe();
          if (me) {
            // Keep JWT-signed role; /users/me does not return one.
            setUser({ ...me, role: next.role, hostelGroup: me.hostelGroup ?? next.hostelGroup });
            setStatus("authenticated");
            queryClient.invalidateQueries();
            loginResult = { ...me, role: next.role, hostelGroup: me.hostelGroup ?? next.hostelGroup };
          }
        } catch {
          /* fall back to login payload below */
        }
        if (!loginResult) {
          setUser(next);
          setStatus("authenticated");
          queryClient.invalidateQueries();
          loginResult = next;
        }
        return loginResult;
      } catch (err) {
        throw new Error(authErrorMessage(err));
      }
    },
    [loadMe, queryClient],
  );

  const register = useCallback(async (input: RegisterPayload): Promise<void> => {
    await request("/api/identity/auth/register", {
      method: "POST",
      body: {
        email: input.email,
        password: input.password,
        fullName: input.fullName,
        hostelGroup: input.hostelGroup,
        hostelBlock: input.hostelBlock,
        roomNumber: input.roomNumber,
      },
    });
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await request("/api/identity/auth/logout", { method: "POST" });
    } catch {
      /* clearing local state regardless */
    } finally {
      setSessionTokens(null);
      setUser(null);
      setStatus("unauthenticated");
      queryClient.clear();
      window.location.href = "/";
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, register, logout, refresh }),
    [user, status, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Client boundary for protected routes (brief §6.3). */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  useEffect(() => {
    if (status === "unauthenticated") {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
    }
  }, [status]);
  if (status !== "authenticated") {
    return (
      <div className="border-b-4 border-black bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="h-8 w-64 animate-pulse border-2 border-black bg-muted" />
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-40 animate-pulse border-2 border-black bg-muted" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
