#!/usr/bin/env bash
# One-command ai-service integration suite (Phase 5).
# 1. starts stub identity + stub marketplace + stub Hugging Face,
# 2. starts ai-service against the real compose Postgres (ai_test schema)
#    and the stubs,
# 3. waits for /api/health, runs vitest, ALWAYS kills everything.
set -u
cd "$(dirname "$0")/.."   # ai-service root

TEST_PORT="${TEST_PORT:-14005}"            # compose ai-service occupies host 4005
STUB_ID_PORT="${STUB_ID_PORT:-14101}"
STUB_MKT_PORT="${STUB_MKT_PORT:-14102}"
STUB_HF_PORT="${STUB_HF_PORT:-14103}"
BASE_URL="http://localhost:$TEST_PORT"
STUB_ID_URL="http://localhost:$STUB_ID_PORT"
STUB_MKT_URL="http://localhost:$STUB_MKT_PORT"
STUB_HF_URL="http://localhost:$STUB_HF_PORT/models"

KEYS_DIR="${TMPDIR:-/tmp}/ai-test-keys"
mkdir -p "$KEYS_DIR"
if [ ! -f "$KEYS_DIR/jwt.pem" ]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KEYS_DIR/jwt.pem" 2>/dev/null
  openssl rsa -in "$KEYS_DIR/jwt.pem" -pubout -out "$KEYS_DIR/jwt.pub.pem" 2>/dev/null
fi
export TEST_JWT_PRIVATE_KEY="$(cat "$KEYS_DIR/jwt.pem")"
export TEST_JWT_PUBLIC_KEY="$(cat "$KEYS_DIR/jwt.pub.pem")"

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres:postgres@localhost:15432/hostel_marketplace}"
export TEST_AI_DB_URL="${TEST_AI_DB_URL:-postgresql://ai_app:ai_dev_pw@localhost:15432/hostel_marketplace}"
export TEST_BASE_URL="$BASE_URL"
export TEST_STUB_IDENTITY_URL="$STUB_ID_URL"
export TEST_STUB_MARKETPLACE_URL="$STUB_MKT_URL"
export TEST_STUB_HF_URL="$STUB_HF_URL"

# 1. Stubs.
STUB_JWT_PUBLIC_KEY="$TEST_JWT_PUBLIC_KEY" STUB_PORT="$STUB_ID_PORT" \
  node scripts/stub-identity.js > /tmp/ai-stub-id.log 2>&1 &
STUB_ID_PID=$!
STUB_MARKETPLACE_PORT="$STUB_MKT_PORT" \
  node scripts/stub-marketplace.js > /tmp/ai-stub-mkt.log 2>&1 &
STUB_MKT_PID=$!
STUB_HF_MODE=ok STUB_HF_PORT="$STUB_HF_PORT" \
  node scripts/stub-hf.js > /tmp/ai-stub-hf.log 2>&1 &
STUB_HF_PID=$!
trap 'kill $SERVER_PID $STUB_ID_PID $STUB_MKT_PID $STUB_HF_PID 2>/dev/null; wait $SERVER_PID $STUB_ID_PID $STUB_MKT_PID $STUB_HF_PID 2>/dev/null' EXIT

# 2. Server under test.
env AI_DATABASE_URL="$TEST_AI_DB_URL?options=--search_path%3Dai_test" \
  JWT_PUBLIC_KEY="$TEST_JWT_PUBLIC_KEY" \
  IDENTITY_SERVICE_URL="$STUB_ID_URL" \
  MARKETPLACE_SERVICE_URL="$STUB_MKT_URL" \
  HF_API_TOKEN="test-hf-token" \
  HF_API_URL="$STUB_HF_URL" \
  JWT_ISSUER=identity-service JWT_AUDIENCE=hostel-marketplace \
  INTERNAL_SERVICE_API_KEY="${TEST_SERVICE_KEY:-test-internal-key}" \
  PORT="$TEST_PORT" \
  npx next dev -p "$TEST_PORT" > /tmp/ai-server.log 2>&1 &
SERVER_PID=$!

# 3. Wait for health + stubs.
READY=0
for _ in $(seq 1 60); do
  if curl -s -m 2 "$BASE_URL/api/health" | grep -q '"ok":true'; then READY=1; break; fi
  sleep 1
done
STUBS_OK=0
for _ in $(seq 1 20); do
  if curl -s -m 2 "$STUB_ID_URL/.well-known/jwks.json" | grep -q '"keys"' \
     && curl -s -m 2 "$STUB_MKT_URL/api/stats/sold?category=Books" | grep -q '"median"' \
     && curl -s -m 2 -X POST "$STUB_HF_URL/test-model" -H 'content-type: application/json' -d '{"inputs":"x"}' | grep -q 'generated_text'; then
    STUBS_OK=1; break
  fi
  sleep 1
done
if [ "$READY" != "1" ] || [ "$STUBS_OK" != "1" ]; then
  echo "servers failed to become healthy"; tail -15 /tmp/ai-server.log /tmp/ai-stub-id.log /tmp/ai-stub-mkt.log /tmp/ai-stub-hf.log; exit 1
fi
echo "ai-service healthy at $BASE_URL; stubs: identity $STUB_ID_URL, marketplace $STUB_MKT_URL, HF $STUB_HF_URL"

# 4. Tests (trap kills everything on exit).
npx vitest run
RC=$?
exit $RC
