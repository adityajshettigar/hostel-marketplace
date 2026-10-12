# System Architecture — Graphviz

State: post closeout pass (audit N1–N7 + G1–G3). Ports match `infra/docker-compose.yml`.
Render with: `dot -Tsvg architecture.dot -o architecture.svg` (copy the block below into `architecture.dot`), or paste into https://dreampuf.github.io/GraphvizOnline

```dot
digraph hostel_marketplace {
  rankdir=TB;
  compound=true;
  newrank=true;
  fontname="Helvetica";
  label="Smart Hostel Marketplace — architecture as built";
  labelloc=t; fontsize=16;

  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=11, margin="0.15,0.08"];
  edge [fontname="Helvetica", fontsize=9, color="#555555"];

  subgraph cluster_clients {
    label="Clients"; style="dashed"; color="#999999"; fontsize=12;
    browser     [label="Browser / mobile user", fillcolor="#e8e8e8"];
    rzp_servers [label="Razorpay servers\n(webhook callbacks)", fillcolor="#e8e8e8"];
  }

  frontend [label="frontend (Next.js)\n:3000 · built, not yet wired to API", fillcolor="#d5f5d5"];
  gateway  [label="gateway (Next.js)\n:4000 — ONLY public ingress\n· per-IP rate limit\n· JWT gate (public key), bypass\n  ONLY /api/identity/auth/*\n· injects x-service-key\n· 5 mounts, NO /api/webhooks/*", fillcolor="#cfe2ff"];

  subgraph cluster_services {
    label="Services (Next.js) — all gated by shared middleware:\nSHA-256 compare of x-service-key; exempt: /api, /api/health,\n/.well-known/*, /api/webhooks/*, /api/internal/*";
    style="rounded"; color="#4477aa"; fontsize=11;

    identity      [label="identity-service :4001\n· register/login/2FA/refresh rotation\n· RS256 mint (role claim) + JWKS\n· argon2 hashes, sessions in PG\n· login rate limit (Redis)\n· Resend emails (disabled in dev)", fillcolor="#cfe2ff"];
    marketplace   [label="marketplace-service :4002\n· listings CRUD + FTS search\n· offers lifecycle (offer TTL)\n· GET /stats/sold (for ai)\n· PATCH /api/internal/listings/:id/status\n  (x-internal-api-key, N1 sold write)", fillcolor="#cfe2ff"];
    communication [label="communication-service :4003\n· conversations / messages\n· notifications\n· socket.io attach (/api/socketio)", fillcolor="#cfe2ff"];
    transaction   [label="transaction-service :4004\n· transactions, escrow (Razorpay orders)\n· webhook: HMAC verify → PIN +\n  QR (AES-256-GCM) → BullMQ payout\n· handover verify (N1: marks SOLD\n  BEFORE payout), disputes", fillcolor="#cfe2ff"];
    ai            [label="ai-service :4005\n· recommendations, price suggestions\n· HF captions w/ template fallback", fillcolor="#cfe2ff"];
  }

  subgraph cluster_data {
    label="Data stores"; style="rounded"; color="#aa8800"; fontsize=12;
    postgres [label="Postgres :15432\n5 schemas (identity, marketplace,\ncommunication, transaction, ai)\n· least-privilege role per service\n· tables applied per db/schema.sql", shape=cylinder, fillcolor="#fff3c4"];
    redis    [label="Redis :16379\n· identity login rate limit\n· transaction BullMQ payout queue", shape=cylinder, fillcolor="#fff3c4"];
  }

  subgraph cluster_external {
    label="External providers"; style="dashed"; color="#cc6600"; fontsize=12;
    razorpay_api [label="Razorpay API\n(orders · NOT yet working:\nkeys invalid → regen)", fillcolor="#ffe0cc"];
    resend       [label="Resend (email)\n(placeholder key in dev)", fillcolor="#ffe0cc"];
    hf           [label="Hugging Face API\n(token valid: adi515)", fillcolor="#ffe0cc"];
  }

  stubs [label="integration-test stubs (test runs only)\nmarketplace stub :14101 · razorpay stub :14102\n+ per-service vitest harnesses :140xx",
         shape=note, fillcolor="#f0f0f0"];

  /* ---- client traffic ---- */
  browser     -> frontend      [label="UI"];
  frontend    -> gateway       [label="NEXT_PUBLIC_GATEWAY_URL\n(wiring pending)", style=dashed];
  browser     -> gateway       [label="REST + Bearer JWT\n:4000"];
  rzp_servers -> transaction   [label="POST /api/webhooks/razorpay\nDIRECT port :4004 — bypasses gateway\nby design (Q1a); HMAC-verified,\nfail-closed 400 on bad signature", color="#cc6600", penwidth=1.6];
  gateway     -> transaction   [label="/api/transaction/*\n→ webhook path 404s here", style=dashed, color="#cc6600"];

  /* ---- gateway routing ---- */
  gateway -> identity      [label="/api/identity/*\nauth/* is keyless"];
  gateway -> marketplace   [label="/api/marketplace/*"];
  gateway -> communication  [label="/api/communication/*"];
  gateway -> transaction    [label="/api/transaction/*"];
  gateway -> ai             [label="/api/ai/*"];

  /* ---- JWT verification path ---- */
  marketplace   -> identity [label="GET /.well-known/jwks.json", style=dotted];
  communication -> identity [style=dotted];
  transaction   -> identity [style=dotted];
  ai            -> identity [style=dotted];

  /* ---- service-to-service ---- */
  marketplace   -> identity   [label="users/:id/public\n(seller block denorm.)"];
  transaction   -> marketplace [label="GET /api/offers/:id (JWT)\n+ PATCH internal sold (N1)"];
  communication -> marketplace [label="GET /api/listings/:id"];
  ai            -> marketplace [label="/api/listings + /api/stats/sold"];

  /* ---- data ---- */
  identity      -> postgres;
  marketplace   -> postgres;
  communication -> postgres;
  transaction   -> postgres;
  ai            -> postgres;
  identity      -> redis    [label="rate limit"];
  transaction   -> redis    [label="BullMQ payouts"];

  /* ---- external ---- */
  transaction -> razorpay_api [label="orders create\n(502 ORDER_FAILED\nw/ current keys)"];
  identity    -> resend       [label="verify + OTP emails\n(dev: DB-simulated)"];
  ai          -> hf           [label="caption model"];

  /* ---- test harness ---- */
  stubs -> transaction [label="suites point\nMARKETPLACE_SERVICE_URL\nat stub", style=dashed, color="#999999"];
}
```

## Legend

| Edge style | Meaning |
|---|---|
| solid | runtime request/data path |
| dotted | JWT verification (JWKS fetch) |
| dashed | planned, test-only, or documentation edge |
| bold orange | Razorpay webhook — the one deliberate gateway bypass |

## Facts this diagram encodes (all verified live in the closeout pass)

- **Single public ingress:** gateway `:4000` gates every route with a JWT except `/api/identity/auth/*`; direct service ports reject traffic without `x-service-key` (403).
- **No `/api/webhooks/*` on the gateway (G2/F6, Q1a):** Razorpay must reach transaction-service's port `4004` directly; the route self-authenticates via HMAC and fails closed (400).
- **Browse requires login (Q2):** marketplace `GET /api/listings` is service-layer-public but gateway-JWT-gated.
- **N1 invariant:** on handover verification, transaction marks the listing SOLD in marketplace (internal key) *before* payout; payout failures can't leave a sold listing ACTIVE.
- **Escrow boundary:** with unset/invalid Razorpay keys, escrow-init returns 503 `RAZORPAY_NOT_CONFIGURED` (unset) or 502 `RAZORPAY_ORDER_FAILED` (set but rejected by Razorpay — current state).
