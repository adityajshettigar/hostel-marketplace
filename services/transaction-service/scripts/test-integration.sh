#!/usr/bin/env bash
# One-command transaction-service integration suite (Phase 6).
# 1. starts stub identity + stub marketplace + stub Razorpay,
# 2. starts transaction-service against the real compose Postgres
#    (transaction_test schema) + compose Redis + the stubs,
# 3. waits for /api/health, runs vitest, ALWAYS kills everything.
set -u
cd "$(dirname "$0")/.."   # transaction-service root

TEST_PORT="${TEST_PORT:-14004}"            # compose transaction-service occupies 4004
STUB_ID_PORT="${STUB_ID_PORT:-14101}"
STUB_MKT_PORT="${STUB_MKT_PORT:-14102}"
STUB_RZP_PORT="${STUB_RZP_PORT:-14104}"
BASE_URL="http://localhost:$TEST_PORT"
STUB_ID_URL="http://localhost:$STUB_ID_PORT"
STUB_MKT_URL="http://localhost:$STUB_MKT_PORT"
STUB_RZP_URL="http://localhost:$STUB_RZP_PORT"

KEYS_DIR="${TMPDIR:-/tmp}/txn-test-keys"
mkdir -p "$KEYS_DIR"
if [ ! -f "$KEYS_DIR/jwt.pem" ]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KEYS_DIR/jwt.pem" 2>/dev/null
  openssl rsa -in "$KEYS_DIR/jwt.pem" -pubout -out "$KEYS_DIR/jwt.pub.pem" 2>/dev/null
fi
export TEST_JWT_PRIVATE_KEY="$(cat "$KEYS_DIR/jwt.pem")"
export TEST_JWT_PUBLIC_KEY="$(cat "$KEYS_DIR/jwt.pub.pem")"

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres:postgres@localhost:15432/hostel_marketplace}"
export TEST_TXN_DB_URL="${TEST_TXN_DB_URL:-postgresql://transaction_app:txn_dev_pw@localhost:15432/hostel_marketplace}"
export TEST_BASE_URL="$BASE_URL"
export TEST_STUB_IDENTITY_URL="$STUB_ID_URL"
export TEST_STUB_MARKETPLACE_URL="$STUB_MKT_URL"
export TEST_STUB_RAZORPAY_URL="$STUB_RZP_URL"
export TEST_RZP_WEBHOOK_SECRET="${TEST_RZP_WEBHOOK_SECRET:-test-webhook-secret}"
export TEST_QR_ENCRYPTION_KEY="${TEST_QR_ENCRYPTION_KEY:-$(printf 'A%.0s' {1..32} | base64)}"
export TEST_ADMIN_USER_IDS="${TEST_ADMIN_USER_IDS:-a1000000-0000-4000-8000-000000000001,a2000000-0000-4000-8000-000000000002}"
export TEST_BUYER_ID="${TEST_BUYER_ID:-b1000000-0000-4000-8000-000000000001}"
export TEST_SELLER_ID="${TEST_SELLER_ID:-b2000000-0000-4000-8000-000000000002}"

# 0. Pre-clean any stale processes on our ports (npx wrapper kills do not
# always reach the next-server child; a surviving old server would consume
# BullMQ jobs with stale code).
fuser -k -9 "$TEST_PORT/tcp" "$STUB_ID_PORT/tcp" "$STUB_MKT_PORT/tcp" "$STUB_RZP_PORT/tcp" 2>/dev/null || true
pkill -9 -f "next dev -p $TEST_PORT" 2>/dev/null || true
pkill -9 -f "next-server.*$TEST_PORT" 2>/dev/null || true
sleep 1
if curl -s -m 2 "$BASE_URL/api" | grep -q '"ok":true'; then
  echo "FATAL: something still answers on $BASE_URL after pre-clean"; exit 1
fi

# 1. Stubs.
STUB_JWT_PUBLIC_KEY="$TEST_JWT_PUBLIC_KEY" STUB_PORT="$STUB_ID_PORT" \
  node scripts/stub-identity.js > /tmp/txn-stub-id.log 2>&1 &
STUB_ID_PID=$!
STUB_MARKETPLACE_PORT="$STUB_MKT_PORT" STUB_INTERNAL_KEY="${TEST_INTERNAL_KEY:-test-internal-key}" \
  node scripts/stub-marketplace.js > /tmp/txn-stub-mkt.log 2>&1 &
STUB_MKT_PID=$!
STUB_RZP_PORT="$STUB_RZP_PORT" STUB_PAYOUT_MODE="${STUB_PAYOUT_MODE:-ok}" \
  node scripts/stub-razorpay.js > /tmp/txn-stub-rzp.log 2>&1 &
STUB_RZP_PID=$!
trap 'kill $SERVER_PID $STUB_ID_PID $STUB_MKT_PID $STUB_RZP_PID 2>/dev/null; fuser -k -9 "$TEST_PORT/tcp" "$STUB_ID_PORT/tcp" "$STUB_MKT_PORT/tcp" "$STUB_RZP_PORT/tcp" 2>/dev/null; wait $SERVER_PID $STUB_ID_PID $STUB_MKT_PID $STUB_RZP_PID 2>/dev/null' EXIT

# 2. Server under test (transaction_test schema, real compose Redis).
# SIMULATION MODE (demo task): this harness opts in via DEMO_MODE=enabled so
# the demo adapter can be exercised end to end. It is empty by default in every
# other environment and is a hard no under NODE_ENV=production
# (src/demo-policy.ts); the DISABLED branch is covered by the demo-policy unit
# tests rather than by standing up a second server instance.
# Redis DB 1 (not the compose stack's DB 0): the live container also runs a
# BullMQ worker on the SAME queue name, and it would steal the harness's
# release jobs and fail them against its own (absent) Razorpay stub URLs.
env TRANSACTION_DATABASE_URL="$TEST_TXN_DB_URL?options=--search_path%3Dtransaction_test" \
  JWT_PUBLIC_KEY="$TEST_JWT_PUBLIC_KEY" \
  IDENTITY_SERVICE_URL="$STUB_ID_URL" \
  MARKETPLACE_SERVICE_URL="$STUB_MKT_URL" \
  INTERNAL_SERVICE_API_KEY="${TEST_INTERNAL_KEY:-test-internal-key}" \
  RAZORPAY_API_BASE="$STUB_RZP_URL" \
  RAZORPAY_KEY_ID="rzp_test_stub" RAZORPAY_KEY_SECRET="stub-secret" \
  RAZORPAY_WEBHOOK_SECRET="$TEST_RZP_WEBHOOK_SECRET" \
  RAZORPAY_FUND_ACCOUNT_ID="fund_stub_0001" \
  QR_ENCRYPTION_KEY="$TEST_QR_ENCRYPTION_KEY" \
  DUAL_AUTH_THRESHOLD="500000" \
  ADMIN_USER_IDS="$TEST_ADMIN_USER_IDS" \
  DEMO_MODE="${TEST_DEMO_MODE:-enabled}" \
  REDIS_URL="redis://localhost:16379/1" \
  PORT="$TEST_PORT" \
  npx next dev -p "$TEST_PORT" > /tmp/txn-server.log 2>&1 &
SERVER_PID=$!

# 3. Wait for health + stubs.
READY=0
for _ in $(seq 1 60); do
  if curl -s -m 2 "$BASE_URL/api" | grep -q '"ok":true'; then READY=1; break; fi
  sleep 1
done
STUBS_OK=0
for _ in $(seq 1 20); do
  if curl -s -m 2 "$STUB_ID_URL/.well-known/jwks.json" | grep -q '"keys"' \
     && curl -s -m 2 "$STUB_RZP_URL/health" | grep -q '"ok":true'; then
    STUBS_OK=1; break
  fi
  sleep 1
done
if [ "$READY" != "1" ] || [ "$STUBS_OK" != "1" ]; then
  echo "servers failed to become healthy"; tail -15 /tmp/txn-server.log /tmp/txn-stub-id.log /tmp/txn-stub-mkt.log /tmp/txn-stub-rzp.log; exit 1
fi
echo "transaction-service healthy at $BASE_URL; stubs: identity $STUB_ID_URL, marketplace $STUB_MKT_URL, razorpay $STUB_RZP_URL"

# 4. Tests (trap kills everything on exit).
npx vitest run
RC=$?
exit $RC
