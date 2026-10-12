#!/usr/bin/env bash
set -euo pipefail

# Live demo harness for SIMULATION MODE path.
# Reuses the same API shapes the frontend and real services speak, so the
# adapter is proven against real endpoints under env-gated isolation.
# No money moves: this exercises the demo/simulation adapter surface only.

cd "$(dirname "$0")/.."

: "${GATEWAY_URL:=http://localhost:8080}"
: "${TRANSACTION_API:=http://localhost:3001}"
: "${MARKETPLACE_API:=http://localhost:3002}"
: "${IDENTITY_API:=http://localhost:3003}"
: "${DM_SELLER_MOBILE:=8888801000}"
: "${DM_BUYER_MOBILE:=9999902000}"
: "${DM_ADMIN_MOBILE:=7777703000}"
: "${LISTING_TITLE:=RedMi Phone Charger}"
: "${LISTING_CATEGORY:=chargers}"
: "${SIMULATION_MODE:=true}"
: "${ADMIN_EMAIL:=admin@example.invalid}"

api_get() { curl -sS "$@" -H 'Accept: application/json'; }
api_post() { curl -sS "$@" -H 'Accept: application/json' -H 'Content-Type: application/json' -d "$3"; }

echo "==> identity handbook configured: IDENTITY_DOC_URL=${IDENTITY_DOC_URL:-<unset>}"
if [ -n "${IDENTITY_DOC_URL:-}" ]; then
  echo "    (pending) fetch + encode identity doc for offline verification"
else
  echo "    (pending) IDENTITY_DOC_URL unset; auth uses live identity service only"
fi

echo "==> seller login"
SELLER_TOKEN=$(api_get "$IDENTITY_API/api/login" \
  -H 'Content-Type: application/json' \
  -d "{\"mobile\":\"$DM_SELLER_MOBILE\",\"password\":\"demo-seller-123\"}" \
  | jq -r '.token // .accessToken // empty')
echo "    seller token=${SELLER_TOKEN:0:20}... (${#SELLER_TOKEN} chars)"
[ -n "$SELLER_TOKEN" ] || { echo "ABORT: seller login failed"; exit 1; }

echo "==> buyer login"
BUYER_TOKEN=$(api_get "$IDENTITY_API/api/login" \
  -H 'Content-Type: application/json' \
  -d "{\"mobile\":\"$DM_BUYER_MOBILE\",\"password\":\"demo-buyer-123\"}" \
  | jq -r '.token // .accessToken // empty')
echo "    buyer token=${BUYER_TOKEN:0:20}... (${#BUYER_TOKEN} chars)"
[ -n "$BUYER_TOKEN" ] || { echo "ABORT: buyer login failed"; exit 1; }

echo "==> admin login"
ADMIN_TOKEN=$(api_get "$IDENTITY_API/api/login" \
  -H 'Content-Type: application/json' \
  -d "{\"mobile\":\"$DM_ADMIN_MOBILE\",\"password\":\"demo-admin-123\",\"email\":\"$ADMIN_EMAIL\"}" \
  | jq -r '.token // .accessToken // empty')
echo "    admin token=${ADMIN_TOKEN:0:20}... (${#ADMIN_TOKEN} chars)"
[ -n "$ADMIN_TOKEN" ] || { echo "ABORT: admin login failed"; exit 1; }

echo "==> register / verify seller identity (MHBOI)"
api_post "$IDENTITY_API/api/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"mobile\":\"$DM_SELLER_MOBILE\",\"phone\":\"$DM_SELLER_MOBILE\",\"otpCode\":\"654321\",\"method\":\"postman-verify\"}" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
| jq '{verified:(.verified // (.verified_phone // false)), phone_bearer: .phone_bearer}'

echo "==> register / verify buyer identity (MHBOI)"
api_post "$IDENTITY_API/api/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"mobile\":\"$DM_BUYER_MOBILE\",\"phone\":\"$DM_BUYER_MOBILE\",\"otpCode\":\"654321\",\"method\":\"postman-verify\"}" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
| jq '{verified:(.verified // (.verified_phone // false)), phone_bearer: .phone_bearer}'

echo "==> create RedMi Phone Charger listing (real listing API, seller auth)"
LISTING=$(api_post "$MARKETPLACE_API/api/listings" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -d "{\"title\":\"$LISTING_TITLE\",\"category\":\"$LISTING_CATEGORY\",\"condition\":\"used\",\"pricePaise\":24900,\"location\":{\"city\":\"Bangalore\",\"state\":\"KA\"},\"description\":\"Demo seed listing for the simulated lifecycle.\"}")
echo "$LISTING" | jq '{id,title,category,pricePaise,status}'
LISTING_ID=$(echo "$LISTING" | jq -r '.id // .data.id // empty')
[ -n "$LISTING_ID" ] || { echo "ABORT: listing create failed"; exit 1; }

echo "==> buyer creates offer on listing (real marketplace offer API)"
OFFER=$(api_post "$MARKETPLACE_API/api/offers" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
  -d "{\"listingId\":\"$LISTING_ID\",\"offeredPrice\":\"849.00\",\"quantity\":1,\"message\":\"Demo offer, take it.\"}")
echo "$OFFER" | jq '{id,listingId,buyerId,amountPaise,status}'
OFFER_ID=$(echo "$OFFER" | jq -r '.id // .data.id // empty')
[ -n "$OFFER_ID" ] || { echo "ABORT: offer create failed"; exit 1; }

echo "==> seller accepts offer (real marketplace API)"
api_post "$MARKETPLACE_API/api/offers/$OFFER_ID/accept" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
| jq '{id,status}'

echo "==> transaction service starts escrow for accepted offer"
ESCROW=$(api_post "$TRANSACTION_API/api/transactions" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -d "{\"offerId\":\"$OFFER_ID\",\"cashoutAccount\":\"demo-seller-cashout\"}")
echo "$ESCROW" | jq '{id,offerId,status,amountPaise,currentHolder,buyerId,sellerId}'
TXN_ID=$(echo "$ESCROW" | jq -r '.id // .data.id // empty')
[ -n "$TXN_ID" ] || { echo "ABORT: escrow start failed"; exit 1; }

echo "==> release funds to seller via demo/simulation release path (env-gated)"
echo "    TRANSACTION_RELEASE_MODE=${TRANSACTION_RELEASE_MODE:-<unset>}"
echo "    SIMULATION_MODE=${SIMULATION_MODE}"
RELEASE=$(api_post "$TRANSACTION_API/api/release" \
  -H "Authorization: Bearer $SELLER_TOKEN" \
  -d "{\"transactionId\":\"$TXN_ID\",\"holder\":\"seller\"}")
echo "$RELEASE" | jq '{ok:(.ok // .success // false), status:.status, releasedTo:.releasedTo, finalHolder:.finalHolder, mode:.mode}'

echo "==> mark handover received / buyer confirms (timeline + purchase history)"
api_post "$TRANSACTION_API/api/transactions/$TXN_ID/confirm-received" \
  -H "Authorization: Bearer $BUYER_TOKEN" \
| jq '{status,buyerConfirmedAt}'

echo "==> admin view of demo transaction + audit trail"
api_get "$TRANSACTION_API/api/admin/transactions/$TXN_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
| jq '{id,status,amountPaise,buyerId,sellerId,currentHolder}'
api_get "$TRANSACTION_API/api/admin/audit?transactionId=$TXN_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
| jq '{auditCount:(.audit | length), sample:(.audit | if length then .[0] else null end)}'

echo "==> done. Seeded demo: listing=$LISTING_ID offer=$OFFER_ID txn=$TXN_ID"
