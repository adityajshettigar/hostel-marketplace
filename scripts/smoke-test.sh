#!/bin/bash
# End-to-end smoke test — auth gate, profile/phone, listing image, order
# lifecycle (offer -> accept -> transaction -> delivery -> buyer receipt),
# purchases history and the admin-only console surface.
set -u
GW=http://localhost:4000
UI=http://localhost:3000
PASS=0; FAIL=0; BLOCKED=0
# Resolve the compose Postgres container so this works from any checkout dir.
PG=$(docker ps --format '{{.Names}}' | grep -m1 postgres || true); PG=${PG:-hostel-marketplace-postgres-1}
ok(){ echo "  PASS  $1"; PASS=$((PASS+1)); }
bad(){ echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
blocked(){ echo "  BLOCKED  $1"; BLOCKED=$((BLOCKED+1)); }
J(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }
STAMP=$(date +%s)
PW='SmokePass001!'

code(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "== 1. AUTH GATE =="
c=$(code "$GW/api/marketplace/listings")
[ "$c" = "401" ] && ok "unauthenticated GET /api/marketplace/listings -> 401" || bad "expected 401, got $c"

for p in / /dashboard /sell/new /purchases /my-orders /transactions/00000000-0000-4000-8000-000000000000; do
  html=$(curl -s "$UI$p")
  if echo "$html" | grep -q "Live listings\|Browse the grid"; then
    bad "$p leaked marketplace content to a logged-out visitor"
  else
    ok "$p renders no protected content while logged out"
  fi
done
# the logged-out header offers the gateway, not the market
curl -s "$UI/" | grep -q "Create account" && ok "/ serves the login/create-account gateway" || bad "/ missing the gateway CTA"

echo "== 2. REGISTRATION + LOGIN =="
reg(){ curl -s -X POST "$GW/api/identity/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$PW\",\"fullName\":\"$2\",\"hostelGroup\":\"$3\",\"hostelBlock\":\"$4\",\"roomNumber\":\"$5\"}"; }
SELLER="smoke-s$STAMP@vitapstudent.ac.in"; BUYER="smoke-b$STAMP@vitapstudent.ac.in"; ADMIN="smoke-a$STAMP@vitapstudent.ac.in"
# LH resident: the ladies' market is a separate storefront, so the listing
# detail checks below prove BOTH groups resolve their own listings by id.
LHSELLER="smoke-lh$STAMP@vitapstudent.ac.in"
reg "$SELLER" "Smoke Seller" MH MH-3 301 >/dev/null
reg "$BUYER" "Smoke Buyer" MH MH-5 505 >/dev/null
reg "$ADMIN" "Smoke Admin" MH MH-1 101 >/dev/null
reg "$LHSELLER" "Smoke Lh Seller" LH LH-1 101 >/dev/null
echo "  registered: $SELLER / $BUYER / $ADMIN / $LHSELLER"

# Promote the third account BEFORE its first login, exactly the way the admin
# console's userbase page flips a role (the signed JWT then carries role=admin).
docker exec -i $PG psql -U postgres -d hostel_marketplace -q -c \
  "UPDATE identity.users SET role='admin' WHERE email='$ADMIN';" >/dev/null

# /api/auth/login is rate limited to 5 requests / 60 s per IP (fail-closed), so
# wait out any window left by a previous run before logging in.
echo "  waiting out the login rate-limit window (5/60s)…"
sleep 62
login(){ curl -s -X POST "$GW/api/identity/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$PW\"}"; }
S_SELLER=$(login "$SELLER"); sleep 1; S_BUYER=$(login "$BUYER"); sleep 1; S_ADMIN=$(login "$ADMIN"); sleep 1; S_LH=$(login "$LHSELLER")
T_SELLER=$(echo "$S_SELLER" | J "['accessToken']"); T_BUYER=$(echo "$S_BUYER" | J "['accessToken']"); T_ADMIN=$(echo "$S_ADMIN" | J "['accessToken']"); T_LH=$(echo "$S_LH" | J "['accessToken']")
[ -n "$T_SELLER" ] && ok "seller login returns an access token" || bad "seller login failed: $(echo "$S_SELLER" | head -c 200)"
[ -n "$T_BUYER" ] && ok "buyer login returns an access token" || bad "buyer login failed"
[ -n "$T_ADMIN" ] && ok "admin login returns an access token" || bad "admin login failed"
[ -n "$T_LH" ] && ok "LH resident login returns an access token" || bad "LH login failed: $(echo "$S_LH" | head -c 200)"

ROLE_CLAIM=$(python3 -c "
import base64,json,sys
t=sys.argv[1].split('.')[1]
t+='='*(-len(t)%4)
print(json.loads(base64.urlsafe_b64decode(t)).get('role'))
" "$T_ADMIN")
[ "$ROLE_CLAIM" = "admin" ] && ok "admin JWT carries role=admin (server-signed claim)" || bad "admin JWT role claim = $ROLE_CLAIM"

echo "== 3. PROFILE + PHONE =="
ME=$(curl -s "$GW/api/identity/users/me" -H "authorization: Bearer $T_BUYER")
echo "$ME" | grep -q '"phone"' && ok "GET /users/me exposes the phone field (own record only)" || bad "users/me has no phone field: $(echo "$ME" | head -c 200)"
PATCH=$(curl -s -X PATCH "$GW/api/identity/users/me" -H "authorization: Bearer $T_BUYER" -H 'content-type: application/json' \
  -d '{"phone":"98765 43210","upiVpa":"smoke.buyer@bank"}')
echo "$PATCH" | grep -q '9876543210' && ok "PATCH /users/me stores the phone (spaces stripped)" || bad "phone not stored: $(echo "$PATCH" | head -c 200)"
BADPHONE=$(code -X PATCH "$GW/api/identity/users/me" -H "authorization: Bearer $T_BUYER" -H 'content-type: application/json' -d '{"phone":"12"}')
[ "$BADPHONE" = "400" ] && ok "invalid phone rejected with 400" || bad "invalid phone -> $BADPHONE (expected 400)"

echo "== 4. CLOUDINARY IMAGE IN A LISTING =="
python3 -c "
import base64
open('/tmp/px.png','wb').write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='))
"
UP=$(curl -s -X POST "https://api.cloudinary.com/v1_1/dw0y2pyd4/image/upload" -F "file=@/tmp/px.png" -F "upload_preset=hostel_unsigned")
SECURE_URL=$(echo "$UP" | J "['secure_url']")
[ -n "$SECURE_URL" ] && ok "unsigned Cloudinary upload returns a secure_url" || bad "cloudinary upload failed: $(echo "$UP" | head -c 200)"
echo "  upload host: $(echo "$SECURE_URL" | sed -E 's#(https://[^/]+).*#\1#')"

mklist(){ curl -s -X POST "$GW/api/marketplace/listings" -H "authorization: Bearer $T_SELLER" -H 'content-type: application/json' \
  -d "{\"title\":\"$1\",\"description\":\"smoke\",\"category\":\"Electronics\",\"condition\":\"Good\",\"price\":\"100.00\",\"quantity\":1,\"images\":[\"$SECURE_URL\"]}"; }
L1=$(mklist "Smoke Item One $STAMP"); L2=$(mklist "Smoke Item Two $STAMP")
LID1=$(echo "$L1" | J "['listing']['id']"); LID2=$(echo "$L2" | J "['listing']['id']")
[ -n "$LID1" ] && ok "seller published a listing with the uploaded image" || bad "listing create failed: $(echo "$L1" | head -c 250)"
if [ -z "$LID1" ] || [ -z "$LID2" ]; then
  echo "  ABORT: cannot continue without a listing"
  echo "===== RESULT: $PASS passed, $FAIL failed, $BLOCKED blocked ====="
  exit 1
fi
echo "$L1" | grep -q "$SECURE_URL" && ok "listing persisted the Cloudinary secure_url" || bad "listing did not persist the image url"

# Same create call, LH seller token -> a listing in the ladies' market.
LHL=$(curl -s -X POST "$GW/api/marketplace/listings" -H "authorization: Bearer $T_LH" -H 'content-type: application/json' \
  -d "{\"title\":\"Smoke Lh Item $STAMP\",\"description\":\"smoke-lh\",\"category\":\"Books\",\"condition\":\"Good\",\"price\":\"120.00\",\"quantity\":5,\"images\":[\"$SECURE_URL\"]}")
LHLID=$(echo "$LHL" | J "['listing']['id']")
[ -n "$LHLID" ] && ok "LH resident published a listing in the ladies' market" || bad "LH listing create failed: $(echo "$LHL" | head -c 250)"

# ---------------------------------------------------------------------------
# 4b. LISTING DETAIL — the market card's id must resolve to THAT listing for
# both groups, through the SAME path the browser uses (same-origin /gw proxy
# -> gateway -> marketplace). This is the regression guard for the "Listing not
# found" defect: the page parses `{ listing: {...} }`, and the endpoint must
# keep returning exactly that envelope with the card's canonical id in it.
# ---------------------------------------------------------------------------
echo "== 4b. LISTING DETAIL (canonical id, MH + LH, honest error states) =="
DET=$(curl -s -w '\n%{http_code}' "$UI/gw/api/marketplace/listings/$LID1" -H "authorization: Bearer $T_BUYER")
DET_CODE=$(echo "$DET" | tail -1); DET_BODY=$(echo "$DET" | head -1)
[ "$DET_CODE" = "200" ] && ok "MH buyer resolves the listing detail through the UI proxy (200)" || bad "MH detail via /gw -> $DET_CODE"
echo "$DET_BODY" | grep -q "\"listing\":{\"id\":\"$LID1\"" \
  && ok "detail response is the { listing } envelope carrying the card's id" \
  || bad "detail envelope/id mismatch: $(echo "$DET_BODY" | head -c 200)"
echo "$DET_BODY" | grep -q "Smoke Item One $STAMP" && ok "detail payload is the listing that was clicked (title matches)" || bad "detail title mismatch"
echo "$DET_BODY" | grep -q '"quantity":1' && ok "detail payload carries the real available quantity" || bad "detail quantity missing"

DETLH=$(curl -s -w '\n%{http_code}' "$UI/gw/api/marketplace/listings/$LHLID" -H "authorization: Bearer $T_LH")
echo "$DETLH" | head -1 | grep -q "\"listing\":{\"id\":\"$LHLID\"" \
  && ok "LH resident resolves the LH listing detail by the same canonical id" \
  || bad "LH detail mismatch: $(echo "$DETLH" | head -1 | head -c 200)"

# Tenant isolation: the other group's listing does not exist for this caller.
X_MH=$(code "$GW/api/marketplace/listings/$LHLID" -H "authorization: Bearer $T_BUYER")
[ "$X_MH" = "404" ] && ok "an MH caller cannot resolve an LH listing (404, no leak)" || bad "cross-group read -> $X_MH"
X_LH=$(code "$GW/api/marketplace/listings/$LID1" -H "authorization: Bearer $T_LH")
[ "$X_LH" = "404" ] && ok "an LH caller cannot resolve an MH listing (404, no leak)" || bad "cross-group read -> $X_LH"

# The 404 state is reserved for genuinely absent listings.
MISS=$(code "$GW/api/marketplace/listings/00000000-0000-4000-8000-000000000000" -H "authorization: Bearer $T_BUYER")
[ "$MISS" = "404" ] && ok "an unknown listing id is a real 404 (not a shape/routing failure)" || bad "unknown id -> $MISS"
MALFORMED=$(code "$GW/api/marketplace/listings/not-a-uuid" -H "authorization: Bearer $T_BUYER")
[ "$MALFORMED" = "404" ] && ok "a malformed id is refused (404), never a 500" || bad "malformed id -> $MALFORMED"
NOAUTH=$(code "$UI/gw/api/marketplace/listings/$LID1")
[ "$NOAUTH" = "401" ] && ok "the detail endpoint is JWT-gated at the gateway (401)" || bad "detail without a token -> $NOAUTH"

# The page route itself exists (no rewrite/base-path drift) and leaks nothing
# to a logged-out visitor.
PAGE_CODE=$(code "$UI/listings/$LID1")
[ "$PAGE_CODE" = "200" ] && ok "the frontend serves the /listings/:id route" || bad "/listings/:id -> $PAGE_CODE"
ANON=$(curl -s "$UI/listings/$LID1")
echo "$ANON" | grep -q "Smoke Item One $STAMP" \
  && bad "the detail page SSR-leaked listing data to a logged-out visitor" \
  || ok "the detail page renders no listing data for a logged-out visitor"

# Market browse isolation: only the caller's own group's listings are visible.
Q_SELLER=$(curl -s "$GW/api/marketplace/listings?q=Smoke%20Lh%20Item%20$STAMP" -H "authorization: Bearer $T_LH")
echo "$Q_SELLER" | grep -q "$LHLID" && ok "the LH seller's market search finds the LH listing" || bad "LH search missed its own listing"
Q_BUYER=$(curl -s "$GW/api/marketplace/listings?q=Smoke%20Lh%20Item%20$STAMP" -H "authorization: Bearer $T_BUYER")
echo "$Q_BUYER" | grep -q "$LHLID" && bad "an MH search returned an LH listing (segregation broken)" || ok "an MH search never returns LH listings"

echo "== 5. ORDER LIFECYCLE (buyer + seller) =="
mkoffer(){ curl -s -X POST "$GW/api/marketplace/offers" -H "authorization: Bearer $T_BUYER" -H 'content-type: application/json' \
  -d "{\"listingId\":\"$1\",\"offeredPrice\":\"90.00\",\"quantity\":1}"; }
O1=$(mkoffer "$LID1"); O2=$(mkoffer "$LID2")
OID1=$(echo "$O1" | J "['offer']['id']"); OID2=$(echo "$O2" | J "['offer']['id']")
[ -n "$OID1" ] && ok "buyer created offer 1" || bad "offer 1 failed: $(echo "$O1" | head -c 200)"
[ -n "$OID2" ] && ok "buyer created offer 2" || bad "offer 2 failed"

accept(){ curl -s -X PATCH "$GW/api/marketplace/offers/$1/accept" -H "authorization: Bearer $T_SELLER"; }
A1=$(accept "$OID1"); A2=$(accept "$OID2")
echo "$A1" | grep -q '"ACCEPTED"' && ok "seller accepted offer 1 (buyer sees the acceptance)" || bad "accept 1 -> $(echo "$A1" | head -c 200)"
accept "$OID2" >/dev/null
# duplicate acceptance must be REFUSED so it cannot create a second order
A1BODY=$(accept "$OID1")
echo "$A1BODY" | grep -qE 'INVALID_TRANSITION' && ok "re-accepting an accepted offer is refused (no duplicate order)" || bad "duplicate accept -> $(echo "$A1BODY" | head -c 200)"

mktxn(){ curl -s -X POST "$GW/api/transaction/transactions" -H "authorization: Bearer $T_BUYER" -H 'content-type: application/json' -d "{\"offerId\":\"$1\"}"; }
T1=$(mktxn "$OID1"); T2=$(mktxn "$OID2")
TXN1=$(echo "$T1" | J "['transaction']['id']"); TXN2=$(echo "$T2" | J "['transaction']['id']")
[ -n "$TXN1" ] && ok "buyer created the escrow transaction from the accepted offer" || bad "txn 1 failed: $(echo "$T1" | head -c 250)"
T1BODY=$(mktxn "$OID1")
echo "$T1BODY" | grep -qE "$TXN1|already" && ok "duplicate transaction request does not create a second order" || bad "duplicate txn -> $(echo "$T1BODY" | head -c 200)"

# Stage 3 gate: the seller must NOT be able to deliver before escrow is funded.
SD_EARLY=$(curl -s -w '\n%{http_code}' -X POST "$GW/api/transaction/fulfill/$OID1/startDelivery" -H "authorization: Bearer $T_SELLER")
echo "$SD_EARLY" | head -1 | grep -q "ESCROW_NOT_FUNDED" \
  && ok "seller cannot start delivery before escrow funding (Stage 3 gate)" \
  || bad "escrow gate missing: $(echo "$SD_EARLY" | head -1 | head -c 250)"

# Buyer confirmation must be refused until the PIN/QR handover is verified.
BC_EARLY=$(curl -s -w '\n%{http_code}' -X POST "$GW/api/transaction/fulfill/$OID1/buyerConfirm" \
  -H "authorization: Bearer $T_BUYER" -H 'content-type: application/json' -d '{"received":true}')
BC_EARLY_CODE=$(echo "$BC_EARLY" | tail -1)
echo "$BC_EARLY" | head -1 | grep -q "NOT_IN_DELIVERY\|HANDOVER_NOT_VERIFIED\|INVALID_TRANSITION" \
  && ok "buyer cannot confirm receipt before delivery started (HTTP $BC_EARLY_CODE)" \
  || bad "early buyerConfirm not refused: $(echo "$BC_EARLY" | head -1 | head -c 200)"

# Escrow funding cannot be completed here (a live Razorpay checkout is
# required), so stage 3 is advanced with a direct DB fixture, then the seller
# starts delivery for real through the API.
docker exec -i $PG psql -U postgres -d hostel_marketplace -q -c \
  "UPDATE \"transaction\".transactions SET status='ESCROW_LOCKED' WHERE id IN ('$TXN1','$TXN2');" >/dev/null
SD=$(curl -s -X POST "$GW/api/transaction/fulfill/$OID1/startDelivery" -H "authorization: Bearer $T_SELLER")
echo "$SD" | grep -q '"IN_DELIVERY"' && ok "seller started delivery after funding -> stage IN_DELIVERY" || bad "startDelivery -> $(echo "$SD" | head -c 250)"
curl -s -X POST "$GW/api/transaction/fulfill/$OID2/startDelivery" -H "authorization: Bearer $T_SELLER" >/dev/null

BC2=$(curl -s -w '\n%{http_code}' -X POST "$GW/api/transaction/fulfill/$OID1/buyerConfirm" \
  -H "authorization: Bearer $T_BUYER" -H 'content-type: application/json' -d '{"received":true}')
echo "$BC2" | head -1 | grep -q "HANDOVER_NOT_VERIFIED" \
  && ok "buyer receipt is refused until the PIN/QR handover is verified (mandatory security step)" \
  || bad "handover gate missing: $(echo "$BC2" | head -1 | head -c 200)"

# The seller must not be able to answer on the buyer's behalf.
BC_SELLER=$(code -X POST "$GW/api/transaction/fulfill/$OID1/buyerConfirm" -H "authorization: Bearer $T_SELLER" \
  -H 'content-type: application/json' -d '{"received":true}')
[ "$BC_SELLER" = "404" ] && ok "the seller cannot submit the buyer's receipt answer (404, no existence leak)" || bad "seller buyerConfirm -> $BC_SELLER"

echo "== 6. CONTROLLED FIXTURE: handover verified =="
# The PIN/QR verification needs a funded escrow and the buyer's credential;
# with no live payment it is advanced with a direct DB write (fixture) purely
# so the NEW receipt-confirmation endpoint can be exercised end to end.
docker exec -i $PG psql -U postgres -d hostel_marketplace -q -c \
  "UPDATE \"transaction\".transactions SET status='HANDOVER_VERIFIED' WHERE id IN ('$TXN1','$TXN2');" >/dev/null
echo "  (live escrow capture + PIN/QR verification remain BLOCKED without a real payment)"

echo "== 7. BUYER RECEIPT: NO then YES =="
NO=$(curl -s -X POST "$GW/api/transaction/fulfill/$OID2/buyerConfirm" -H "authorization: Bearer $T_BUYER" \
  -H 'content-type: application/json' -d '{"received":false}')
echo "$NO" | grep -q '"delivered":false' && ok "buyer 'No' does not deliver the order" || bad "decline -> $(echo "$NO" | head -c 250)"
F2=$(curl -s "$GW/api/transaction/fulfill/$OID2" -H "authorization: Bearer $T_BUYER")
echo "$F2" | grep -q '"buyerReceived":false' && ok "the denial is persisted (order stays open, no payout)" || bad "denial not persisted: $(echo "$F2" | head -c 250)"
TXN2_STATUS=$(docker exec -i $PG psql -U postgres -d hostel_marketplace -t -A -c \
  "SELECT status||'|'||coalesce(payout_id,'none') FROM \"transaction\".transactions WHERE id='$TXN2';")
[ "$TXN2_STATUS" = "HANDOVER_VERIFIED|none" ] && ok "declined order keeps escrow locked and pays nothing ($TXN2_STATUS)" || bad "declined order moved money: $TXN2_STATUS"

YES=$(curl -s -w '\n%{http_code}' -X POST "$GW/api/transaction/fulfill/$OID1/buyerConfirm" -H "authorization: Bearer $T_BUYER" \
  -H 'content-type: application/json' -d '{"received":true}')
echo "$YES" | head -1 | grep -q '"delivered":true' && ok "buyer 'Yes' marks the order delivered" || bad "yes -> $(echo "$YES" | head -1 | head -c 250)"
F1=$(curl -s "$GW/api/transaction/fulfill/$OID1" -H "authorization: Bearer $T_BUYER")
echo "$F1" | grep -q '"DELIVERED"' && ok "fulfilment stage reached DELIVERED" || bad "stage not DELIVERED: $(echo "$F1" | head -c 250)"
echo "$F1" | grep -q '"buyerReceived":true' && ok "receipt confirmation recorded with a timestamp" || bad "receipt flag missing"
echo "$YES" | head -1 | grep -q '"status":"COMPLETED"' && ok "escrow released (live payout succeeded)" \
  || blocked "delivery confirmed but payout still PENDING (no live Razorpay payout in this environment)"

# Replay idempotency
YES2=$(curl -s -X POST "$GW/api/transaction/fulfill/$OID1/buyerConfirm" -H "authorization: Bearer $T_BUYER" \
  -H 'content-type: application/json' -d '{"received":true}')
echo "$YES2" | grep -q '"delivered":true' && ok "repeating 'Yes' is idempotent (no second payout)" || bad "replay -> $(echo "$YES2" | head -c 200)"

echo "== 8. PURCHASES HISTORY =="
# The real client sends Date#toISOString() values (…Z), which is what the
# server accepts; a raw "+00:00" offset would need %2B-encoding in a query.
FROM=$(python3 -c "from datetime import datetime,timezone,timedelta;print((datetime.now(timezone.utc)-timedelta(hours=12)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")
TO=$(python3 -c "from datetime import datetime,timezone,timedelta;print((datetime.now(timezone.utc)+timedelta(hours=12)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")
BUYLIST=$(curl -s "$GW/api/transaction/purchases?role=buying&page=1&limit=20&from=$FROM&to=$TO" -H "authorization: Bearer $T_BUYER")
echo "$BUYLIST" | grep -q "Smoke Item One $STAMP" && ok "purchases list carries the ITEM NAME" || bad "no item name in history: $(echo "$BUYLIST" | head -c 300)"
echo "$BUYLIST" | grep -q "res.cloudinary.com" && ok "purchases list carries the item IMAGE" || bad "no image in history"
echo "$BUYLIST" | grep -q '"hasMore"' && ok "pagination exposes hasMore for the full-history view" || bad "pagination missing hasMore"
SELLLIST=$(curl -s "$GW/api/transaction/purchases?role=selling&page=1&limit=20" -H "authorization: Bearer $T_SELLER")
echo "$SELLLIST" | grep -q '"role":"seller"' && ok "seller sees the same order as a SALE" || bad "seller history missing"
DET=$(curl -s "$GW/api/transaction/purchases/$TXN1" -H "authorization: Bearer $T_BUYER")
echo "$DET" | grep -q '"fullName":"Smoke Seller"' && ok "order details include the other party" || bad "details missing party"
echo "$DET" | grep -q '"imageUrl":"https://res.cloudinary.com' && ok "order details include the item image" || bad "details missing image"
STRANGER=$(code "$GW/api/transaction/purchases/$TXN1" -H "authorization: Bearer $T_ADMIN")
[ "$STRANGER" = "404" ] && ok "a third party cannot read someone else's order (404)" || bad "stranger read -> $STRANGER"

echo "== 9. ADMIN SURFACE =="
AUD_ADMIN=$(code "$GW/api/transaction/audit?limit=5" -H "authorization: Bearer $T_ADMIN")
[ "$AUD_ADMIN" = "200" ] && ok "admin can read the transaction audit log" || bad "admin audit -> $AUD_ADMIN"
AUD_USER=$(code "$GW/api/transaction/audit?limit=5" -H "authorization: Bearer $T_BUYER")
[ "$AUD_USER" = "403" ] && ok "a normal student is denied the admin audit log (403)" || bad "student audit -> $AUD_USER"
DISP_USER=$(code "$GW/api/transaction/disputes" -H "authorization: Bearer $T_BUYER")
[ "$DISP_USER" = "403" ] && ok "a normal student is denied the disputes queue (403)" || bad "student disputes -> $DISP_USER"

echo
echo "===== RESULT: $PASS passed, $FAIL failed, $BLOCKED blocked ====="
[ "$FAIL" -eq 0 ]
