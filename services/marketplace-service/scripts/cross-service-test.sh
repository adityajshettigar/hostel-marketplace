#!/usr/bin/env bash
# Audit 3f: TRUE cross-service test with a real identity token.
# identity (14001) + marketplace (14002) against the real compose Postgres.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
KEYS=/tmp/identity-test-keys
ID=14001; MK=14002

# 1. Start identity + marketplace (fresh dev servers).
(cd "$ROOT/services/identity-service" && JWT_PRIVATE_KEY="$(cat "$KEYS/jwt.pem")" JWT_PUBLIC_KEY="$(cat "$KEYS/jwt.pub.pem")" IDENTITY_DATABASE_URL='postgresql://identity_app:id_dev_pw@localhost:15432/hostel_marketplace' REDIS_URL='redis://localhost:16379' COLLEGE_EMAIL_DOMAINS=college.edu exec npx next dev -p "$ID" > /tmp/id-curl.log 2>&1) &
PID1=$!
(cd "$ROOT/services/marketplace-service" && MARKETPLACE_DATABASE_URL='postgresql://marketplace_app:mkt_dev_pw@localhost:15432/hostel_marketplace?options=--search_path%3Dmarketplace' JWT_PUBLIC_KEY="$(cat "$KEYS/jwt.pub.pem")" IDENTITY_SERVICE_URL="http://localhost:$ID" JWT_ISSUER=identity-service JWT_AUDIENCE=hostel-marketplace exec npx next dev -p "$MK" > /tmp/mkt-curl.log 2>&1) &
PID2=$!
trap 'kill $PID1 $PID2 2>/dev/null; wait $PID1 $PID2 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  curl -s -m 2 "http://localhost:$ID/api/health" 2>/dev/null | grep -q ok && break; sleep 1
done
for _ in $(seq 1 60); do
  curl -s -m 2 "http://localhost:$MK/api/health" 2>/dev/null | grep -q marketplace && break; sleep 1
done
echo "identity: $(curl -s http://localhost:$ID/api/health)"
echo "marketplace: $(curl -s http://localhost:$MK/api/health)"

id_flow() {  # register -> plant+verify -> login(2FA) -> tokens; echoes ACCESS<TAB>REFRESH
  local email=$1 ip=$2 raw="xsvc-$(date +%s%N)-$3"
  local hash=$(printf %s "$raw" | sha256sum | cut -d' ' -f1)
  curl -s -X POST "http://localhost:$ID/api/auth/register" -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"Str0ng!pass1\",\"fullName\":\"Svc User $3\",\"hostelBlock\":\"MH-A\",\"roomNumber\":\"10$3\"}" > /dev/null
  docker exec hostel-marketplace-postgres-1 psql -U postgres -d hostel_marketplace -qtc \
    "UPDATE identity.users SET verification_tokens=ARRAY['$hash'] WHERE email='$email'"
  curl -s "http://localhost:$ID/api/auth/verify?token=$raw" > /dev/null
  local resp=$(curl -s -X POST "http://localhost:$ID/api/auth/login" -H 'content-type: application/json' \
    -H "x-forwarded-for: $ip" -d "{\"email\":\"$email\",\"password\":\"Str0ng!pass1\",\"fingerprint\":\"svc$3\"}")
  local sid=$(echo "$resp" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("sessionId",""))')
  local oth=$(docker exec hostel-marketplace-postgres-1 psql -U postgres -d hostel_marketplace -tAc \
    "SELECT challenge_hash FROM identity.otp_challenges WHERE session_id='$sid'")
  local otp=$(python3 -c "
import hashlib
h='$oth'
for i in range(1000000):
    c=str(i).zfill(6)
    if hashlib.sha256(c.encode()).hexdigest()==h: print(c); break")
  curl -s -X POST "http://localhost:$ID/api/auth/2fa/verify" -H 'content-type: application/json' \
    -H "x-forwarded-for: $ip" -d "{\"sessionId\":\"$sid\",\"otp\":\"$otp\"}" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["accessToken"]+"\t"+d["refreshToken"])'
}

echo "== user A (seller) =="
A=$(id_flow svc.seller.$(date +%s)@college.edu 203.0.113.21 1)
AT=$(echo "$A" | cut -f1)
echo "seller accessToken: ${AT:0:36}..."
echo "== user B (buyer) =="
B=$(id_flow svc.buyer.$(date +%s)@college.edu 203.0.113.22 2)
BT=$(echo "$B" | cut -f1)
echo "buyer accessToken: ${BT:0:36}..."

echo "== POST /api/listings with REAL identity token =="
LISTING=$(curl -s -X POST "http://localhost:$MK/api/listings" -H 'content-type: application/json' \
  -H "authorization: Bearer $AT" \
  -d '{"title":"Cross-service Laptop","description":"Real token test","category":"Electronics","condition":"Good","price":"500.00","quantity":1,"images":["https://res.cloudinary.com/demo/image/upload/sample.jpg"]}')
echo "$LISTING" | head -c 200; echo
LID=$(echo "$LISTING" | python3 -c 'import json,sys; print(json.load(sys.stdin)["listing"]["id"])')

echo "== buyer offers =="
OFFER=$(curl -s -X POST "http://localhost:$MK/api/offers" -H 'content-type: application/json' \
  -H "authorization: Bearer $BT" -d "{\"listingId\":\"$LID\",\"offeredPrice\":\"420.00\",\"quantity\":1}")
echo "$OFFER" | head -c 160; echo
OID=$(echo "$OFFER" | python3 -c 'import json,sys; print(json.load(sys.stdin)["offer"]["id"])')

echo "== seller accepts =="
curl -s -X PATCH "http://localhost:$MK/api/offers/$OID/accept" -H "authorization: Bearer $AT" | head -c 160; echo

echo "== deal confirmation via GET /api/offers/:id =="
curl -s "http://localhost:$MK/api/offers/$OID" -H "authorization: Bearer $BT" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("offer status:", d["offer"]["status"])'
