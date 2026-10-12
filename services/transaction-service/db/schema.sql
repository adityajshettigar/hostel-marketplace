-- ============================================================================
-- transaction-service — schema DDL (Phase 6)
--
-- infra/init-db/ created the `transaction` schema and the least-privilege
-- `transaction_app` role (search_path pinned to `transaction`). This file owns
-- the tables inside it. Apply AS transaction_app (container-local port 5432):
--   docker compose -f infra/docker-compose.yml exec -T postgres \
--     psql "postgresql://transaction_app:txn_dev_pw@localhost:5432/hostel_marketplace" \
--     -f - < services/transaction-service/db/schema.sql
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere).
--
-- Money is ALWAYS integer paise (bigint). No floats anywhere.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- transactions — one row per confirmed deal (offer ACCEPTED).
-- State machine (enforced by app code inside single DB txns with FOR UPDATE):
--   DEAL_CONFIRMED → ESCROW_PENDING → ESCROW_LOCKED → HANDOVER_PENDING
--     → HANDOVER_VERIFIED → COMPLETED
--   side: ESCROW_LOCKED|HANDOVER_PENDING → DISPUTED → ADMIN_REVIEW
--     → (RESOLVED → COMPLETED | REFUNDED)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id            uuid NOT NULL UNIQUE,
  listing_id          uuid NOT NULL,
  buyer_id            uuid NOT NULL,
  seller_id           uuid NOT NULL,
  amount_paise        bigint  NOT NULL CHECK (amount_paise >= 0),
  quantity            integer NOT NULL CHECK (quantity >= 1),
  currency            text    NOT NULL DEFAULT 'INR',
  status              text    NOT NULL DEFAULT 'DEAL_CONFIRMED'
                        CHECK (status IN ('DEAL_CONFIRMED','ESCROW_PENDING','ESCROW_LOCKED',
                                          'HANDOVER_PENDING','HANDOVER_VERIFIED','COMPLETED',
                                          'DISPUTED','ADMIN_REVIEW','RESOLVED','REFUNDED')),
  razorpay_order_id   text UNIQUE,
  payout_id           text UNIQUE,
  payout_attempts     integer NOT NULL DEFAULT 0,
  pin_hash            text,
  -- H1 closeout: the PIN is ALSO stored AES-256-GCM-encrypted (same 32-byte
  -- key pattern as the QR payload) so the buyer can retrieve it on demand via
  -- GET /api/transactions/:id/handover-credential while handover is pending.
  -- pin_hash stays authoritative for verification; the ciphertext is never
  -- returned after the handover window (see the credential route).
  pin_ciphertext      text,
  pin_nonce           text,
  pin_generated_at    timestamptz,
  qr_ciphertext       text,     -- AES-256-GCM payload {transactionId, expiresAt}
  qr_nonce            text,     -- base64 GCM IV (12 bytes)
  qr_expires_at       timestamptz,
  escrow_locked_at    timestamptz,
  release_deadline    timestamptz,
  handover_locked     boolean NOT NULL DEFAULT FALSE,
  failed_attempts     integer NOT NULL DEFAULT 0,
  dispute_id          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_buyer_idx  ON transactions (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_seller_idx ON transactions (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions (status, release_deadline);

-- ---------------------------------------------------------------------------
-- webhook_events — Razorpay webhook idempotency (dedupe on Razorpay event id)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS webhook_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      text NOT NULL UNIQUE,
  event_type    text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- handover_idempotency — unique idempotency key per transaction, stored in the
-- SAME DB txn BEFORE the Razorpay payout call, so a replay can never double-pay
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS handover_idempotency (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL UNIQUE,
  key            text NOT NULL UNIQUE,
  status         text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- admin_tickets — created by the buyer's dispute; resolved by admins
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin_tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid NOT NULL REFERENCES transactions(id),
  dispute_id      uuid,
  raised_by       uuid NOT NULL,
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Fulfilment lifecycle (buyer timeline). The type must exist before the table;
-- guarded so re-running the file on an existing volume is a no-op.
--
-- The guard is scoped to the CURRENT schema on purpose: pg_type is shared by
-- the whole database, so a bare `typname = 'fulfilment_status'` check finds the
-- dev `transaction` schema's type while this file is being applied to
-- `transaction_test` (the integration harness) and then SKIPS the create —
-- leaving the CREATE TABLE below to fail with "type does not exist".
DO $fulfil$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = 'fulfilment_status'
       AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE fulfilment_status AS ENUM
      ('ORDER_PLACED', 'ORDER_ACCEPTED', 'IN_DELIVERY', 'DELIVERED');
  END IF;
END
$fulfil$;

CREATE TABLE IF NOT EXISTS fulfilment_tracking (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id          uuid NOT NULL UNIQUE REFERENCES transactions(offer_id),
  transaction_id    uuid NOT NULL REFERENCES transactions(id),
  status            fulfilment_status NOT NULL DEFAULT 'ORDER_PLACED',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
  -- (offer_id already REFERENCES transactions(offer_id); a composite
  --  (offer_id, transaction_id) FK would need a matching UNIQUE on the parent
  --  and adds nothing, since offer_id is unique on its own.)
);

CREATE INDEX IF NOT EXISTS fulfilment_buyer_idx ON fulfilment_tracking (transaction_id, created_at DESC);

-- The append-only hardening further down (ALTER DEFAULT PRIVILEGES ... REVOKE
-- UPDATE, DELETE, TRUNCATE) applies to every FUTURE table in this schema, so
-- fulfilment_tracking loses UPDATE by default. It is a lifecycle table whose
-- status must advance (ORDER_PLACED -> ... -> DELIVERED), so hand the UPDATE
-- privilege back explicitly.
GRANT UPDATE ON fulfilment_tracking TO transaction_app;

-- Additive: buyer receipt confirmation. The escrow release requires BOTH the
-- seller-side PIN/QR handover verification AND the authenticated buyer's own
-- "yes, I received it" answer; the Yes/No decision is recorded here so a
-- dismissed dialog never counts as a confirmation and the 48h auto-release
-- job can escalate instead of paying an unconfirmed order.
--   buyer_received NULL = not asked / not answered yet
--   buyer_received true = buyer confirmed receipt (buyer_confirmed_at set)
--   buyer_received false = buyer denied receipt (buyer_declined_at set)
ALTER TABLE fulfilment_tracking ADD COLUMN IF NOT EXISTS buyer_received boolean;
ALTER TABLE fulfilment_tracking ADD COLUMN IF NOT EXISTS buyer_confirmed_at timestamptz;
ALTER TABLE fulfilment_tracking ADD COLUMN IF NOT EXISTS buyer_declined_at timestamptz;

-- ---------------------------------------------------------------------------
-- transaction_audit — APPEND-ONLY audit log (every state change + every
-- handover attempt, success or failure). Insert-only: UPDATE/DELETE are
-- revoked from the service's own DB role (see bottom of this file).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS transaction_audit (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id uuid,
  actor_id       uuid,
  action         text NOT NULL,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transaction_audit_txn_idx ON transaction_audit (transaction_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Append-only hardening: even the service role cannot mutate history.
-- (Role-level default privileges in init-db grant ALL on new tables; tighten
--  for the audit table explicitly.)
-- ---------------------------------------------------------------------------

REVOKE UPDATE, DELETE, TRUNCATE ON transaction_audit FROM transaction_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA "transaction" REVOKE UPDATE, DELETE, TRUNCATE ON TABLES FROM transaction_app;

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS disputes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid NOT NULL UNIQUE REFERENCES transactions(id),
  raised_by       uuid NOT NULL,
  reason          text NOT NULL,
  evidence_urls   text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'DISPUTED'
                    CHECK (status IN ('DISPUTED','ADMIN_REVIEW','RESOLVED')),
  resolution      text CHECK (resolution IN ('COMPLETED','REFUNDED')),
  resolved_by     uuid,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS disputes_status_idx ON disputes (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- DEMO marker (project demonstration task)
--
-- The demonstration walkthrough drives the REAL lifecycle through the REAL
-- APIs; the only place a payment provider would normally act is the Razorpay
-- webhook (escrow lock + PIN/QR) and the payout call in settleTransaction.
-- Those two steps are replaced, in a NON-PRODUCTION environment only, by the
-- demo adapter (src/demo.ts + routes/demo.ts). Transactions that went through
-- it carry demo = TRUE so:
--   • the UI can label them "DEMO TRANSACTION - SIMULATED - NO PAYMENT
--     PROCESSED" and never present them as real money movement;
--   • the admin console can filter them out of the live view;
--   • the reset command can delete EXACTLY the demo rows and nothing else.
-- Ordinary transactions always keep the DEFAULT FALSE — nothing else in the
-- schema or the state machine changes.
-- Additive + idempotent (same ALTER ... IF NOT EXISTS style used above for
-- fulfilment_tracking). Rollback: DROP INDEX + DROP COLUMN (no data loss for
-- real transactions, which never set it).
-- ---------------------------------------------------------------------------

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS demo boolean NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS transactions_demo_idx ON transactions (demo) WHERE demo;
