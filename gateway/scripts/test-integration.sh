#!/usr/bin/env bash
# One-command gateway integration suite (Phase 7).
# 1. starts stub identity + 5 stub downstreams (one per service),
# 2. starts the gateway against the stubs on TEST_PORT (14000),
# 3. waits for the gateway root, runs vitest, ALWAYS kills everything.
set -u
cd "$(dirname "$0")/.."   # gateway root

TEST_PORT="${TEST_PORT:-14000}"          # compose gateway occupies host 4000
STUB_ID_PORT="${STUB_ID_PORT:-14101}"
STUB_MKT_PORT="${STUB_MKT_PORT:-14102}"
STUB_COM_PORT="${STUB_COM_PORT:-14103}"
STUB_TXN_PORT="${STUB_TXN_PORT:-14104}"
STUB_AI_PORT="${STUB_AI_PORT:-14105}"
BASE_URL="http://localhost:$TEST_PORT"

KEYS_DIR="${TMPDIR:-/tmp}/gateway-test-keys"
mkdir -p "$KEYS_DIR"
if [ ! -f "$KEYS_DIR/jwt.pem" ]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KEYS_DIR/jwt.pem" 2>/dev/null
  openssl rsa -in "$KEYS_DIR/jwt.pem" -pubout -out "$KEYS_DIR/jwt.pub.pem" 2>/dev/null
fi
export TEST_JWT_PRIVATE_KEY="$(cat "$KEYS_DIR/jwt.pem")"
export TEST_JWT_PUBLIC_KEY="$(cat "$KEYS_DIR/jwt.pub.pem")"

export TEST_BASE_URL="$BASE_URL"
export TEST_STUB_ID_URL="http://localhost:$STUB_ID_PORT"
export TEST_STUB_MKT_URL="http://localhost:$STUB_MKT_PORT"
export TEST_STUB_COM_URL="http://localhost:$STUB_COM_PORT"
export TEST_STUB_TXN_URL="http://localhost:$STUB_TXN_PORT"
export TEST_STUB_AI_URL="http://localhost:$STUB_AI_PORT"
export TEST_INTERNAL_SERVICE_KEY="${TEST_INTERNAL_SERVICE_KEY:-test-gateway-service-key}"

# 0. Pre-clean stale processes on our ports (npx wrapper kills can leave orphans).
fuser -k -9 "$TEST_PORT/tcp" "$STUB_ID_PORT/tcp" "$STUB_MKT_PORT/tcp" "$STUB_COM_PORT/tcp" "$STUB_TXN_PORT/tcp" "$STUB_AI_PORT/tcp" 2>/dev/null || true
pkill -9 -f "next dev -p $TEST_PORT" 2>/dev/null || true
pkill -9 -f "next-server.*$TEST_PORT" 2>/dev/null || true
sleep 1

# 1. Stubs.
STUB_JWT_PUBLIC_KEY="$TEST_JWT_PUBLIC_KEY" STUB_PORT="$STUB_ID_PORT" \
  node scripts/stub-identity.js > /tmp/gw-stub-id.log 2>&1 &
STUB_ID_PID=$!
for spec in "marketplace:$STUB_MKT_PORT" "communication:$STUB_COM_PORT" "transaction:$STUB_TXN_PORT" "ai:$STUB_AI_PORT"; do
  NAME="${spec%%:*}"; PORT="${spec##*:}"
  STUB_NAME="$NAME" STUB_PORT="$PORT" STUB_REQUIRE_KEY=1 STUB_SERVICE_KEY="$TEST_INTERNAL_SERVICE_KEY" \
    node scripts/stub-downstream.js > "/tmp/gw-stub-$NAME.log" 2>&1 &
  eval "STUB_${NAME}_PID=$!"
done

PIDS=""
trap 'kill $PIDS 2>/dev/null; fuser -k -9 "$TEST_PORT/tcp" "$STUB_ID_PORT/tcp" "$STUB_MKT_PORT/tcp" "$STUB_COM_PORT/tcp" "$STUB_TXN_PORT/tcp" "$STUB_AI_PORT/tcp" 2>/dev/null; wait $PIDS 2>/dev/null' EXIT
PIDS="$STUB_ID_PID $STUB_marketplace_PID $STUB_communication_PID $STUB_transaction_PID $STUB_ai_PID"

# 2. Gateway under test.
env SERVICE_IDENTITY_URL="$TEST_STUB_ID_URL" \
  SERVICE_MARKETPLACE_URL="$TEST_STUB_MKT_URL" \
  SERVICE_COMMUNICATION_URL="$TEST_STUB_COM_URL" \
  SERVICE_TRANSACTION_URL="$TEST_STUB_TXN_URL" \
  SERVICE_AI_URL="$TEST_STUB_AI_URL" \
  INTERNAL_SERVICE_KEY="$TEST_INTERNAL_SERVICE_KEY" \
  JWT_PUBLIC_KEY="$TEST_JWT_PUBLIC_KEY" \
  JWT_ISSUER=identity-service JWT_AUDIENCE=hostel-marketplace \
  PORT="$TEST_PORT" \
  npx next dev -p "$TEST_PORT" > /tmp/gw-server.log 2>&1 &
SERVER_PID=$!
PIDS="$PIDS $SERVER_PID"

# 3. Wait for gateway + stubs.
READY=0
for _ in $(seq 1 60); do
  if curl -s -m 2 "$BASE_URL/api" | grep -q '"status":"ok"'; then READY=1; break; fi
  sleep 1
done
STUBS_OK=0
for _ in $(seq 1 20); do
  if curl -s -m 2 "$TEST_STUB_ID_URL/.well-known/jwks.json" | grep -q '"keys"' \
     && curl -s -m 2 "$TEST_STUB_MKT_URL/api/health" | grep -q '"ok":true'; then
    STUBS_OK=1; break
  fi
  sleep 1
done
if [ "$READY" != "1" ] || [ "$STUBS_OK" != "1" ]; then
  echo "servers failed to become healthy"; tail -n 15 /tmp/gw-server.log; exit 1
fi
echo "gateway healthy at $BASE_URL; stubs: id $STUB_ID_PORT mkt $STUB_MKT_PORT com $STUB_COM_PORT txn $STUB_TXN_PORT ai $STUB_AI_PORT"

# 4. Tests (trap kills everything on exit).
npx vitest run
RC=$?
exit $RC
