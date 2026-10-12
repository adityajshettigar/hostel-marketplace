#!/usr/bin/env bash
# Audit 3e: one-command marketplace integration suite.
# 1. starts the stub identity-service (JWKS + verification statuses),
# 2. starts marketplace against the real compose Postgres (marketplace_test
#    schema) + the stub,
# 3. waits for /api/health, runs vitest, ALWAYS kills both processes.
set -u
cd "$(dirname "$0")/.."   # marketplace-service root

TEST_PORT="${TEST_PORT:-14002}"          # compose marketplace occupies host 4002
STUB_PORT="${STUB_PORT:-14101}"
BASE_URL="http://localhost:$TEST_PORT"
STUB_URL="http://localhost:$STUB_PORT"

KEYS_DIR="${TMPDIR:-/tmp}/marketplace-test-keys"
mkdir -p "$KEYS_DIR"
if [ ! -f "$KEYS_DIR/jwt.pem" ]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KEYS_DIR/jwt.pem" 2>/dev/null
  openssl rsa -in "$KEYS_DIR/jwt.pem" -pubout -out "$KEYS_DIR/jwt.pub.pem" 2>/dev/null
fi
export TEST_JWT_PRIVATE_KEY="$(cat "$KEYS_DIR/jwt.pem")"
export TEST_JWT_PUBLIC_KEY="$(cat "$KEYS_DIR/jwt.pub.pem")"

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres:postgres@localhost:15432/hostel_marketplace}"
export TEST_MARKETPLACE_DB_URL="${TEST_MARKETPLACE_DB_URL:-postgresql://marketplace_app:mkt_dev_pw@localhost:15432/hostel_marketplace}"
export TEST_BASE_URL="$BASE_URL"
export TEST_STUB_URL="$STUB_URL"

# 1. Stub identity.
STUB_JWT_PUBLIC_KEY="$TEST_JWT_PUBLIC_KEY" STUB_PORT="$STUB_PORT" \
  node scripts/stub-identity.js > /tmp/mkt-stub.log 2>&1 &
STUB_PID=$!
trap 'kill $SERVER_PID $STUB_PID 2>/dev/null; wait $SERVER_PID $STUB_PID 2>/dev/null' EXIT

# 2. Marketplace server under test.
env MARKETPLACE_DATABASE_URL="$TEST_MARKETPLACE_DB_URL?options=--search_path%3Dmarketplace_test" \
  JWT_PUBLIC_KEY="$TEST_JWT_PUBLIC_KEY" \
  IDENTITY_SERVICE_URL="$STUB_URL" \
  JWT_ISSUER=identity-service JWT_AUDIENCE=hostel-marketplace \
  INTERNAL_SERVICE_API_KEY="${TEST_INTERNAL_KEY:-test-internal-key}" \
  PORT="$TEST_PORT" \
  npx next dev -p "$TEST_PORT" > /tmp/mkt-server.log 2>&1 &
SERVER_PID=$!

# 3. Wait for health (server) and stub readiness.
READY=0
for _ in $(seq 1 60); do
  if curl -s -m 2 "$BASE_URL/api/health" | grep -q '"ok"'; then READY=1; break; fi
  sleep 1
done
STUB_READY=0
for _ in $(seq 1 20); do
  if curl -s -m 2 "$STUB_URL/.well-known/jwks.json" | grep -q '"keys"'; then STUB_READY=1; break; fi
  sleep 1
done
if [ "$READY" != "1" ] || [ "$STUB_READY" != "1" ]; then
  echo "servers failed to become healthy"; tail -15 /tmp/mkt-server.log /tmp/mkt-stub.log; exit 1
fi
echo "marketplace healthy at $BASE_URL; stub identity at $STUB_URL"

# 4. Tests (trap kills both processes on exit).
npx vitest run
RC=$?
exit $RC
