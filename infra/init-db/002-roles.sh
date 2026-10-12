#!/bin/bash
# ============================================================================
# Smart Hostel Marketplace — Phase 1 database roles
#
# Runs on first Postgres boot (mounted into /docker-entrypoint-initdb.d, after
# 001-schemas.sql which created the schemas). It is a shell script because
# role passwords must come from the environment, and plain .sql cannot read
# environment variables.
#
# Result: five least-privilege, one-schema roles, each owning exactly one
# schema and nothing else. The scripts must run as the Postgres superuser
# (docker-entrypoint does exactly that); env values come from the root
# .env mounted via env_file on the postgres service.
#
# Idempotency: initdb.d runs only on a fresh data volume, so CREATE ROLE
# below cannot collide in normal operation. Re-run from scratch with
#   docker compose down -v
# ============================================================================
set -euo pipefail

# Fail loudly if any required password is missing from .env.
: "${POSTGRES_USER:?POSTGRES_USER is not set (root .env)}"
: "${POSTGRES_DB:?POSTGRES_DB is not set (root .env)}"
: "${IDENTITY_DB_PASSWORD:?IDENTITY_DB_PASSWORD is not set (root .env)}"
: "${MARKETPLACE_DB_PASSWORD:?MARKETPLACE_DB_PASSWORD is not set (root .env)}"
: "${COMMUNICATION_DB_PASSWORD:?COMMUNICATION_DB_PASSWORD is not set (root .env)}"
: "${TRANSACTION_DB_PASSWORD:?TRANSACTION_DB_PASSWORD is not set (root .env)}"
: "${AI_DB_PASSWORD:?AI_DB_PASSWORD is not set (root .env)}"

DB_URL="postgresql://${POSTGRES_USER}@localhost/${POSTGRES_DB}"

echo ">> Creating per-service roles and granting each its own schema..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$roles\$
  BEGIN
    -- identity_app
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'identity_app') THEN
      CREATE ROLE identity_app WITH LOGIN PASSWORD '${IDENTITY_DB_PASSWORD}';
      ALTER ROLE identity_app SET search_path = identity;
      GRANT ALL ON SCHEMA identity TO identity_app;
      GRANT USAGE, CREATE ON SCHEMA identity TO identity_app;
    ELSE
      ALTER ROLE identity_app PASSWORD '${IDENTITY_DB_PASSWORD}';
      ALTER ROLE identity_app SET search_path = identity;
    END IF;

    -- marketplace_app
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'marketplace_app') THEN
      CREATE ROLE marketplace_app WITH LOGIN PASSWORD '${MARKETPLACE_DB_PASSWORD}';
      ALTER ROLE marketplace_app SET search_path = marketplace;
      GRANT ALL ON SCHEMA marketplace TO marketplace_app;
      GRANT USAGE, CREATE ON SCHEMA marketplace TO marketplace_app;
    ELSE
      ALTER ROLE marketplace_app PASSWORD '${MARKETPLACE_DB_PASSWORD}';
      ALTER ROLE marketplace_app SET search_path = marketplace;
    END IF;

    -- communication_app
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'communication_app') THEN
      CREATE ROLE communication_app WITH LOGIN PASSWORD '${COMMUNICATION_DB_PASSWORD}';
      ALTER ROLE communication_app SET search_path = communication;
      GRANT ALL ON SCHEMA communication TO communication_app;
      GRANT USAGE, CREATE ON SCHEMA communication TO communication_app;
    ELSE
      ALTER ROLE communication_app PASSWORD '${COMMUNICATION_DB_PASSWORD}';
      ALTER ROLE communication_app SET search_path = communication;
    END IF;

    -- transaction_app
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'transaction_app') THEN
      CREATE ROLE transaction_app WITH LOGIN PASSWORD '${TRANSACTION_DB_PASSWORD}';
      ALTER ROLE transaction_app SET search_path = "transaction";
      GRANT ALL ON SCHEMA "transaction" TO transaction_app;
      GRANT USAGE, CREATE ON SCHEMA "transaction" TO transaction_app;
    ELSE
      ALTER ROLE transaction_app PASSWORD '${TRANSACTION_DB_PASSWORD}';
      ALTER ROLE transaction_app SET search_path = "transaction";
    END IF;

    -- ai_app
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_app') THEN
      CREATE ROLE ai_app WITH LOGIN PASSWORD '${AI_DB_PASSWORD}';
      ALTER ROLE ai_app SET search_path = ai;
      GRANT ALL ON SCHEMA ai TO ai_app;
      GRANT USAGE, CREATE ON SCHEMA ai TO ai_app;
    ELSE
      ALTER ROLE ai_app PASSWORD '${AI_DB_PASSWORD}';
      ALTER ROLE ai_app SET search_path = ai;
    END IF;
  END
  \$roles\$;

  -- Make sure no other role can read or write these schemas (least privilege).
  REVOKE ALL ON SCHEMA identity FROM PUBLIC;
  REVOKE ALL ON SCHEMA marketplace FROM PUBLIC;
  REVOKE ALL ON SCHEMA communication FROM PUBLIC;
  REVOKE ALL ON SCHEMA "transaction" FROM PUBLIC;
  REVOKE ALL ON SCHEMA ai FROM PUBLIC;

  -- Default privileges: future tables/sequences created in a schema by the
  -- postgres superuser belong to that schema's owner, so nobody else can use them.
  ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT ALL ON TABLES TO identity_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT ALL ON SEQUENCES TO identity_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace GRANT ALL ON TABLES TO marketplace_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace GRANT ALL ON SEQUENCES TO marketplace_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA communication GRANT ALL ON TABLES TO communication_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA communication GRANT ALL ON SEQUENCES TO communication_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA "transaction" GRANT ALL ON TABLES TO transaction_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA "transaction" GRANT ALL ON SEQUENCES TO transaction_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT ALL ON TABLES TO ai_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT ALL ON SEQUENCES TO ai_app;
EOSQL

echo ">> Done. Schemas + roles + least-privilege grants created."
