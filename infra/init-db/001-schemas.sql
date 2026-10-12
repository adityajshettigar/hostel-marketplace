-- ============================================================================
-- Smart Hostel Marketplace — Phase 1 database bootstrap
-- Schema-per-service naming (PostgreSQL identifiers are lowercase-case
-- insensitive, but `transaction` is a reserved keyword in Postgres, so it is
-- quoted while the others stand as-is).
--
-- Runs ONCE, automatically, on the very first `docker compose up` while the
-- Postgres data volume is still empty (the official postgres image executes
-- this directory in alphabetical order).
--
-- NOTE: roles + grants come next, in 002-roles.sh (bash) then 003-grants.sql,
-- because:
--   * role passwords cannot be read from a plain .sql file (env vars only),
--   * grants must be issued AFTER the roles exist.
-- ============================================================================

-- identity-service: users, auth, hostel identity, 2FA
CREATE SCHEMA IF NOT EXISTS identity;

-- marketplace-service: listings, search, offers/negotiation
CREATE SCHEMA IF NOT EXISTS marketplace;

-- communication-service: chat, chat safety, notifications
CREATE SCHEMA IF NOT EXISTS communication;

-- transaction-service: transactions, escrow, PIN/QR, disputes
CREATE SCHEMA IF NOT EXISTS "transaction";

-- ai-service: pricing AI, categorisation, recommendations, risk
CREATE SCHEMA IF NOT EXISTS ai;
