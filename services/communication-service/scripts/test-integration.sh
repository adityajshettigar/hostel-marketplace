#!/usr/bin/env bash
# One-command communication-service integration suite.
# 1. starts stub identity-service + stub marketplace-service,
# 2. starts communication against the real compose Postgres (communication_test
#    schema) + the stubs,
# 3. waits for /api/health, runs vitest, ALWAYS kills all processes.
set -u
cd "$(dirname "$0")/.."   # communication-service root

TEST_PORT="${TEST_PORT:-14003}"           # compose communication occupies host 4003
STUB_ID_PORT="${STUB_ID_PORT:-14101}"
STUB_MKT_PORT="${STUB_MKT_PORT:-14102}"
BASE_URL="http://localhost:$TEST_PORT"
STUB_ID_URL="http://localhost:$STUB_ID_PORT"
STUB_MKT_URL="http://localhost:$STUB_MKT_PORT"

KEYS_DIR="${TMPDIR:-/tmp}/communication-test-keys"
mkdir -p "$KEYS_DIR"
if [ ! -f "$KEYS_DIR/jwt.pem" ]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KEYS_DIR/jwt.pem" 2>/dev/null
  openssl rsa -in "$KEYS_DIR/jwt.pem" -pubout -out "$KEYS_DIR/jwt.pub.pem" 2>/dev/null
fi
export TEST_JWT_PRIVATE_KEY="$(cat "$KEYS_DIR/jwt.pem")"
export TEST_JWT_PUBLIC_KEY="$(cat "$KEYS_DIR/jwt.pub.pem")"

export STUB_SELLER_ID="${STUB_SELLER_ID:-99999999-9999-4999-8999-999999999999}"

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres:postgres@localhost:15432/hostel_marketplace}"
export TEST_COMMUNICATION_DB_URL="${TEST_COMMUNICATION_DB_URL:-postgresql://communication_app:com_dev_pw@localhost:15432/hostel_marketplace}"
export TEST_BASE_URL="$BASE_URL"
export TEST_STUB_IDENTITY_URL="$STUB_ID_URL"
export TEST_STUB_MARKETPLACE_URL="$STUB_MKT_URL"
export TEST_INTERNAL_KEY="test-internal-key"

# 1. Stubs.
STUB_JWT_PUBLIC_KEY="$TEST_JWT_PUBLIC_KEY" STUB_PORT="$STUB_ID_PORT" \
  node scripts/stub-identity.js > /tmp/com-stub-id.log 2>&1 &
STUB_ID_PID=$!
STUB_SELLER_ID="$STUB_SELLER_ID" STUB_MARKETPLACE_PORT="$STUB_MKT_PORT" \
  node scripts/stub-marketplace.js > /tmp/com-stub-mkt.log 2>&1 &
STUB_MKT_PID=$!
trap 'kill $SERVER_PID $STUB_ID_PID $STUB_MKT_PID 2>/dev/null; wait $SERVER_PID $STUB_ID_PID $STUB_MKT_PID 2>/dev/null' EXIT

# 2. Server under test (dev server on 14003; socket attached via /api/socketio).
env COMMUNICATION_DATABASE_URL="$TEST_COMMUNICATION_DB_URL?options=--search_path%3Dcommunication_test" \
  JWT_PUBLIC_KEY="$TEST_JWT_PUBLIC_KEY" \
  IDENTITY_SERVICE_URL="$STUB_ID_URL" \
  MARKETPLACE_SERVICE_URL="$STUB_MKT_URL" \
  INTERNAL_SERVICE_API_KEY="$TEST_INTERNAL_KEY" \
  JWT_ISSUER=identity-service JWT_AUDIENCE=hostel-marketplace \
  PORT="$TEST_PORT" \
  npx next dev -p "$TEST_PORT" > /tmp/com-server.log 2>&1 &
SERVER_PID=$!

# 3. Wait for health + stubs.
READY=0
for _ in $(seq 1 60); do
  if curl -s -m 2 "$BASE_URL/api/health" | grep -q '"ok":true'; then READY=1; break; fi
  sleep 1
done
STUB_ID_READY=0
for _ in $(seq 1 20); do
  if curl -s -m 2 "$STUB_ID_URL/.well-known/jwks.json" | grep -q '"keys"'; then STUB_ID_READY=1; break; fi
  sleep 1
done
STUB_MKT_READY=0
for _ in $(seq 1 20); do
  if curl -s -m 2 "$STUB_MKT_URL/api/listings/00000000-0000-4000-8000-000000000000" | grep -q 'sellerId'; then STUB_MKT_READY=1; break; fi
  sleep 1
done
if [ "$READY" != "1" ] || [ "$STUB_ID_READY" != "1" ] || [ "$STUB_MKT_READY" != "1" ]; then
  echo "servers failed to become healthy"; tail -15 /tmp/com-server.log /tmp/com-stub-id.log /tmp/com-stub-mkt.log; exit 1
fi
echo "communication healthy at $BASE_URL; stub identity at $STUB_ID_URL; stub marketplace at $STUB_MKT_URL"

# Attach Socket.IO once (websocket upgrade now live on the same port).
# Audit Step 2a: /api/socketio is behind the service-key gate like every other
# API route, so the attach request must present the header.
curl -s -m 5 -H "x-service-key: ${TEST_SERVICE_KEY:-test-internal-key}" "$BASE_URL/api/socketio" > /dev/null

# 4. Tests (trap kills everything on exit).
npx vitest run
RC=$?
exit $RC
