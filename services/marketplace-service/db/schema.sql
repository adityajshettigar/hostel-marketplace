-- ============================================================================
-- marketplace-service — schema DDL (Phase 3)
--
-- infra/init-db/ creates the `marketplace` schema and the least-privilege
-- `marketplace_app` role (search_path pinned to `marketplace`). This file owns
-- the tables that live inside that schema.
--
-- Apply once against the shared Postgres:
--   docker compose -f infra/docker-compose.yml up -d postgres
--   docker compose -f infra/docker-compose.yml exec -T postgres \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -f - < services/marketplace-service/db/schema.sql
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere).
--
-- NOTE on cross-service references: buyer_id/seller_id reference
-- identity.users logically, but NOT via FOREIGN KEY — each service only has
-- least-privilege rights on its own schema, and a cross-schema FK would both
-- violate that boundary and couple table lifetimes across services. Integrity
-- is enforced at the API boundary (JWT sub) instead.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- listings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS listings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    uuid NOT NULL,
  seller_block text NOT NULL, -- denormalised from seller's JWT at creation (block-wise search, SRS 5.2.2)
  title        text NOT NULL,
  description  text,
  category     text NOT NULL CHECK (category IN ('Books','Electronics','Furniture','Appliances','Food')),
  condition    text NOT NULL CHECK (condition IN ('New','Like New','Good','Fair','Worn')),
  price        numeric(10,2) NOT NULL CHECK (price >= 0),
  quantity     integer NOT NULL CHECK (quantity > 0),
  image_urls   text[] NOT NULL DEFAULT '{}', -- Cloudinary URLs uploaded by the frontend
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DELETED','SOLD')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Full-text search over title (weight A) + description (weight B).
-- Generated column so queries can use `tsv @@ plainto_tsquery(...)` directly.
ALTER TABLE listings DROP COLUMN IF EXISTS tsv;
ALTER TABLE listings
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS listings_fts_idx    ON listings USING gin (tsv);
CREATE INDEX IF NOT EXISTS listings_seller_idx ON listings (seller_id);
CREATE INDEX IF NOT EXISTS listings_block_idx  ON listings (seller_block);
CREATE INDEX IF NOT EXISTS listings_category_idx ON listings (category);

-- ---------------------------------------------------------------------------
-- DEMO marker (project demonstration task)
--
-- A listing created for the SIMULATED walkthrough carries demo = TRUE so the
-- UI can label it ("DEMO TRANSACTION - SIMULATED - NO PAYMENT PROCESSED") and
-- the demo reset command can identify exactly the listing it created without
-- touching any other student's listing. Every ordinary listing keeps the
-- DEFAULT FALSE; nothing else about listing behaviour changes.
-- Additive + idempotent. Rollback: DROP COLUMN (no effect on real listings).
-- ---------------------------------------------------------------------------

ALTER TABLE listings ADD COLUMN IF NOT EXISTS demo boolean NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- offers — negotiation state machine
--   PENDING → ACCEPTED | REJECTED | COUNTERED | WITHDRAWN | EXPIRED
-- Only ACCEPTED counts as "deal confirmed" for transaction-service.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS offers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id      uuid NOT NULL,
  offered_price numeric(10,2) NOT NULL CHECK (offered_price >= 0),
  quantity      integer NOT NULL CHECK (quantity > 0),
  status        text NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','ACCEPTED','REJECTED','COUNTERED','WITHDRAWN','EXPIRED')),
  counter_of    uuid REFERENCES offers(id) ON DELETE SET NULL, -- set when this row is a seller's counter-proposal
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offers_listing_idx ON offers (listing_id);
CREATE INDEX IF NOT EXISTS offers_buyer_idx   ON offers (buyer_id);
-- Partial index for the 48h auto-expire sweep (only PENDING rows matter).
CREATE INDEX IF NOT EXISTS offers_pending_expiry_idx ON offers (created_at) WHERE status = 'PENDING';
