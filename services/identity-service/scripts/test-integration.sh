#!/usr/bin/env bash
# Audit 2e/2f: one-command identity integration suite.
# Starts identity against the real compose PG+Redis (host ports 15432/16379),
# waits for /api/health, runs vitest, ALWAYS kills the server.
set -u
cd "$(dirname "$0")/.."   # identity-service root

PG_URL="${TEST_IDENTITY_DB_URL:-postgresql://identity_app:id_dev_pw@localhost:15432/hostel_marketplace}"
REDIS_URL="${TEST_REDIS_URL:-redis://localhost:16379}"
BASE_URL="${TEST_BASE_URL:-http://localhost:14001}"
TEST_PORT="${TEST_PORT:-14001}"   # compose identity occupies host 4001
KEYS_DIR="${TMPDIR:-/tmp}/identity-test-keys"

# 1. Stable JWT key pair (generated once, reused across runs).
mkdir -p "$KEYS_DIR"
if [ ! -f "$KEYS_DIR/jwt.pem" ]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KEYS_DIR/jwt.pem" 2>/dev/null
  openssl rsa -in "$KEYS_DIR/jwt.pem" -pubout -out "$KEYS_DIR/jwt.pub.pem" 2>/dev/null
fi
JWT_PRIVATE_KEY="$(cat "$KEYS_DIR/jwt.pem")"
JWT_PUBLIC_KEY="$(cat "$KEYS_DIR/jwt.pub.pem")"
export JWT_PRIVATE_KEY JWT_PUBLIC_KEY

# 2. Env for the server under test.
export IDENTITY_DATABASE_URL="$PG_URL"
export REDIS_URL="$REDIS_URL"
export JWT_ISSUER="identity-service"
export JWT_AUDIENCE="hostel-marketplace"
export COLLEGE_EMAIL_DOMAINS="college.edu,students.example.edu"
# Audit Step 2a: the service-key gate under test — tests present the header.
export INTERNAL_SERVICE_API_KEY="${TEST_SERVICE_KEY:-test-internal-key}"
export PORT="$TEST_PORT"

# 3. Start the server, wait for health.
npx next dev -p "$TEST_PORT" > /tmp/identity-test-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null' EXIT

READY=0
for _ in $(seq 1 60); do
  if curl -s -m 2 "$BASE_URL/api/health" | grep -q '"ok"'; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  echo "identity server failed to become healthy; log:"; tail -20 /tmp/identity-test-server.log
  exit 1
fi
echo "identity server healthy at $BASE_URL"

# 4. Run the suite (always traps-kill the server on exit).
TEST_BASE_URL="$BASE_URL" npx vitest run
RC=$?
exit $RC
