-- ============================================================================
-- communication-service — schema DDL (Phase 4)
--
-- infra/init-db/ creates the `communication` schema and the least-privilege
-- `communication_app` role (search_path pinned to `communication`). This file
-- owns the tables that live inside that schema.
--
-- Apply once against the shared Postgres:
--   docker compose -f infra/docker-compose.yml exec -T postgres \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -f - < services/communication-service/db/schema.sql
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere).
--
-- NOTE on cross-service references: buyer_id/seller_id reference
-- identity.users, listing_id references marketplace.listings — all LOGICALLY
-- (no cross-schema FOREIGN KEY, same rationale as marketplace-service: each
-- service has least-privilege rights on its own schema only). Integrity is
-- enforced at the API boundary: POST /api/conversations fetches seller_id
-- from marketplace-service's GET /api/listings/:id and never trusts the
-- client, and participant checks use the verified JWT sub.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- conversations — one per (buyer, listing) pair; seller comes from marketplace
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL,       -- logically references marketplace.listings
  buyer_id    uuid NOT NULL,       -- logically references identity.users (JWT sub)
  seller_id   uuid NOT NULL,       -- fetched from marketplace-service, never client-supplied
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- A buyer has at most one conversation thread per listing (SRS 5.7.1).
  CONSTRAINT conversations_listing_buyer_unique UNIQUE (listing_id, buyer_id),
  -- Degenerate case: a seller starting a "conversation" on their own listing
  -- would have buyer_id = seller_id; rejected at the API layer, guarded here.
  CONSTRAINT conversations_participants_differ CHECK (buyer_id <> seller_id)
);

CREATE INDEX IF NOT EXISTS conversations_buyer_idx  ON conversations (buyer_id);
CREATE INDEX IF NOT EXISTS conversations_seller_idx ON conversations (seller_id);
CREATE INDEX IF NOT EXISTS conversations_listing_idx ON conversations (listing_id);

-- ---------------------------------------------------------------------------
-- messages — persisted for BOTH participants; delivery gating per SRS 5.7.2:
-- verdict <> 'SAFE' rows are stored with safety_result but NEVER emitted to
-- the recipient over the socket.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id      uuid NOT NULL,    -- JWT sub of the poster (buyer or seller only)
  body           text NOT NULL,
  safety_result  text NOT NULL DEFAULT 'SAFE'
                 CHECK (safety_result IN ('SAFE','CONTACT_INFO','UPI_INFO','OFF_PLATFORM_REQUEST')),
  delivered      boolean NOT NULL DEFAULT FALSE,  -- emitted to recipient over socket?
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- notifications — created by OTHER services via POST /api/notifications
-- (internal-only, shared API key); consumed by the owner via GET + PATCH read.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,        -- recipient (logically references identity.users)
  type       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- service-defined context (offer id, listing title, ...)
  read_at    timestamptz,          -- NULL = unread; PATCH /:id/read stamps it
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);
-- Fast unread badge count per user.
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
