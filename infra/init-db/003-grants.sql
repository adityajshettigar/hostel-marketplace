-- ============================================================================
-- Smart Hostel Marketplace — Phase 1 grant bootstrap (idempotent)
--
-- Runs AFTER 002-roles.sh has created the five service roles, in the same
-- /docker-entrypoint-initdb.d pass (alphabetical order 001 < 002 < 003).
--
-- Least privilege: each service role can use and create objects ONLY inside
-- its own schema, and a role cannot see or touch the other four schemas.
-- ============================================================================

-- identity_app  -> identity schema
GRANT USAGE, CREATE ON SCHEMA identity TO identity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT ALL ON TABLES TO identity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT ALL ON SEQUENCES TO identity_app;
ALTER ROLE identity_app SET search_path = identity;

-- marketplace_app -> marketplace schema
GRANT USAGE, CREATE ON SCHEMA marketplace TO marketplace_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace GRANT ALL ON TABLES TO marketplace_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace GRANT ALL ON SEQUENCES TO marketplace_app;
ALTER ROLE marketplace_app SET search_path = marketplace;

-- communication_app -> communication schema
GRANT USAGE, CREATE ON SCHEMA communication TO communication_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA communication GRANT ALL ON TABLES TO communication_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA communication GRANT ALL ON SEQUENCES TO communication_app;
ALTER ROLE communication_app SET search_path = communication;

-- transaction_app -> transaction schema
GRANT USAGE, CREATE ON SCHEMA "transaction" TO transaction_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA "transaction" GRANT ALL ON TABLES TO transaction_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA "transaction" GRANT ALL ON SEQUENCES TO transaction_app;
ALTER ROLE transaction_app SET search_path = "transaction";

-- ai_app -> ai schema
GRANT USAGE, CREATE ON SCHEMA ai TO ai_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT ALL ON TABLES TO ai_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT ALL ON SEQUENCES TO ai_app;
ALTER ROLE ai_app SET search_path = ai;
