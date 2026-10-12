-- ============================================================================
-- ai-service — schema DDL (Phase 5)
--
-- infra/init-db/ creates the `ai` schema and the least-privilege `ai_app`
-- role (search_path pinned to `ai`). This file owns the tables inside it.
--
-- Apply AS ai_app (role-level search_path lands everything in `ai`):
--   docker compose -f infra/docker-compose.yml exec -T postgres \
--     psql "postgresql://ai_app:ai_dev_pw@localhost:5432/hostel_marketplace" \
--     -f - < services/ai-service/db/schema.sql
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere).
--
-- SRS AI-suggestion entities: the service LOGS every suggestion it emits
-- (input snapshot, the suggestion, model_version) plus accepted_by_user —
-- ground truth for later model training. AI output is ASSISTIVE and
-- non-authoritative: nothing here feeds back into listing truth.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- suggestions — one row per AI suggestion emitted by /api/suggest/*
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS suggestions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,          -- seller who requested (JWT sub)
  kind              text NOT NULL CHECK (kind IN ('LISTING','PRICE')),
  input_snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- de-logged request input
  suggestion        jsonb NOT NULL,         -- clamped output exactly as returned
  model_version     text NOT NULL,          -- e.g. "template-v1" / "hf-blip-base+template-v1"
  fallback_used     boolean NOT NULL DEFAULT FALSE,      -- HF unavailable -> template-only?
  accepted_by_user  boolean NOT NULL DEFAULT FALSE,      -- PATCH /:id/accept flips this
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS suggestions_user_idx  ON suggestions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS suggestions_model_idx ON suggestions (model_version);

-- ---------------------------------------------------------------------------
-- interactions — cold-start behavior log (E7.11 baseline).
-- Other services / the frontend POST view/search events here; the baseline
-- recommender reads the user's most recent category signal from this table.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS interactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('VIEW','SEARCH')),
  category   text,                           -- nullable: searches may be uncategorized
  query      text,                           -- raw search string (SEARCH only)
  listing_id uuid,                           -- set on VIEW events
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interactions_user_idx ON interactions (user_id, created_at DESC);
