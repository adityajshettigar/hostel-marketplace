# Phase 9 — Security Hardening Checklist

Scope (only these six items): security headers, CORS lock-down, Zod validation
before DB, parameterized SQL, secrets from `process.env` + build/start-time env
check, and `SECURITY.md`. Everything below is what was **found** and what was
**changed**; verification results are at the end.

Legend: ✅ done · ⚠️ caveat/limitation.

---

## 1. Helmet-equivalent security headers on every Next.js API response ✅

**Findings.** Services had no security headers; responses were plain
`NextResponse.json(...)`. No central place applied headers.

**Fixes.**
- Added a shared `src/lib/security.ts` to all five services **and** the gateway,
  exporting `withSecurity`, `corsHeaders`, `preflightResponse`.
- `Content-Security-Policy` (`default-src 'none'; frame-ancestors 'none'; …`),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, plus HSTS,
  `Referrer-Policy: no-referrer`, `X-DNS-Prefetch-Control: off`,
  `Cache-Control: no-store` (only when the route hasn't set its own),
  `X-Powered-By: none`.
- Applied **centrally** in each service's `src/middleware.ts` (matcher
  `/api/:path*`, `/.well-known/:path*`): the key-gate error responses are
  wrapped, and the success path returns `withSecurity(NextResponse.next())` so
  **every** route handler — including ones not individually wrapped — inherits
  the headers.
- Gateway catch-all, root and health routes wrapped; `OPTIONS` answered at the
  gateway edge.
- Frontend: `next.config.mjs` `headers()` adds the base headers to all routes
  and the strict CSP to `/api/:path*` (page routes intentionally keep no strict
  CSP so Next's inline scripts/styles still work).

**Evidence (runtime curl).** identity `/api/health` (200), identity
`/api/nope` (503 from the gate), an OPTIONS preflight, the **unwrapped**
communication `/api/health`, a gateway 404, and frontend `/api/health` all
return the full header set.

## 2. CORS locked to known frontend/gateway origins (from env) ✅

**Findings.** No CORS handling; the frontend proxies same-origin via `/gw`, but
services/gateway emitted nothing.

**Fixes.** `corsHeaders()` reflects an origin only if it is on the allow-list
derived from `FRONTEND_ORIGIN` (fallback `NEXT_PUBLIC_GATEWAY_URL` /
`FRONTEND_URL`) plus explicit localhost dev origins. Unknown origins receive
only `Vary: Origin` (no grant). OPTIONS preflights are answered centrally (204)
in each service's middleware and in the gateway, with the allow-list applied.
Added `FRONTEND_ORIGIN` to `.env.example` (documented optional; defaults to the
gateway URL).

**Evidence.** `Origin: http://localhost:3000` → `access-control-allow-origin`
present; `Origin: https://evil.example` → no CORS grant.

## 3. Zod parsing before touching the DB ✅

**Findings.** Grep for `request.json()` / `searchParams.get()` showed all
body/query routes already Zod-parsed (`parseJsonBody` / `parseQuery`), with two
exceptions.

**Fixes.**
- `marketplace-service/src/routes/listings.ts` — internal
  `markListingSoldInternal` parsed the body manually (`body.status !== 'SOLD'`).
  Now `parseJsonBody(request, z.object({ status: z.literal('SOLD') }))`.
- `communication-service/src/routes/messages.ts` — `listMessages` read
  `limit` with `Number(...)`. Now a Zod query schema
  (`conversation_id: string.min(1).max(64)`, `limit: coerce int 1..200 =
  100`).

## 4. Parameterized SQL ✅

**Findings.** All queries use `pool.query` with `$N` placeholders. Dynamic
fragments (`where.join(' AND ')`, `sets.join(', ')`) are built from hard-coded
column keys / `$N` placeholders, never raw input. The only direct
string-interpolated SQL lived in three **unused** identity helpers.

**Fix.** Removed `exists()`, `findFirst()`, `count()` from
`services/identity-service/src/db.ts` (zero call sites) so the injection
footgun can't be adopted later.

## 5. Secrets only from `process.env`; env check wired into startup ✅

**Findings.** No hardcoded secrets (`grep` for `process.env.X =` found none);
only non-secret constants (`QUEUE_NAME`, `QR_SCHEME`).

**Fixes.**
- Added `scripts/check-env.mjs` to all seven apps. It validates the set the root
  `.env.example` ships **empty** (31 variables: Postgres, per-service DB role
  passwords/URLs, Redis, JWT keys/issuer/audience, internal keys, admin list,
  Resend, Cloudinary, QR key, Razorpay keys). It exits non-zero on any missing
  value.
- Wired into every `Dockerfile`: the script is copied into the runner image and
  the `CMD` runs `node scripts/check-env.mjs && node server.js`, so a
  misconfigured container **fails at start** instead of booting half-working.
- ⚠️ The script is `.mjs`, not `.ts`: the standalone runner image prunes the
  TypeScript toolchain, so a `.ts` script could not execute there. Logic and
  behaviour match the spec (fail-closed required-var check).
- Verified: missing env → exit 1 with the list; all set → exit 0.

## 6. `SECURITY.md` ✅

Added at the repo root covering: the header/CORS model; JWT signing, refresh
rotation + family revocation, and a key-rotation policy; PIN argon2id hashing
(+ AES-256-GCM retrieval ciphertext); Razorpay webhook HMAC verification;
the rate limits in place; the **escrow honesty note** (listing marked `SOLD`
before payout, `COMPLETED` only after a real payout, retried otherwise, Razorpay
in test mode); Zod/SQL safety; and the gateway-only service isolation.

---

## Incidental fixes required to make the above work

- `@/*` path alias in the five services + gateway pointed at the project root,
  but source lives in `src/`; no pre-existing service code used `@/`, so the
  alias was corrected to `./src/*`.
- Repaired two malformed constructs in `gateway/src/proxy.ts` (a `//`-commented
  `if` statement and a missing closing brace) that prevented compilation.
- `identity` JWKS wrapper called `GET(request)` while the handler takes no args;
  corrected, and `withSecurity` now preserves a route's explicit `Cache-Control`
  so public JWKS responses stay cacheable.
- Made `withSecurity` generic (`<T extends Response>`) so `NextResponse` callers
  keep their concrete type.

---

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` — all 5 services + gateway + frontend | ✅ pass |
| `npm run build` (Next production build) — all 7 apps | ✅ pass |
| Runtime header + CORS checks (identity, communication, gateway, frontend) | ✅ pass |
| Unit tests: identity `timing-safe` (6), communication `chat-safety` (20), ai `ai-core` (15) | ✅ pass |
| Integration suites (identity `auth`/`refresh-rotation`, marketplace, transaction, gateway) | ⚠️ **not run** — they require the live compose stack (Postgres, Redis, running services, `TEST_*` env). Their failures here are `ECONNREFUSED` / missing-`TEST_*`, i.e. environment, not code. |

**Not run / limitations:** the full Docker build and compose integration stack
were not exercised in this environment. The Dockerfile `check-env` wiring was
verified by running the script directly (fail/pass), not by an image build.
