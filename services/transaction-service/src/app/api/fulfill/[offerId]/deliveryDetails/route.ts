import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  jsonError,
  notFound,
  internalError,
} from '@/handlers';
import { bearerToken } from '@/auth';
import { fetchOfferFromMarketplace } from '@/marketplace';
import { fetchUsersByIds } from '@/identity';

export async function GET(request: NextRequest, ctx: { params: { offerId: string } }) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;
    const user = auth.auth;
    const offerId = decodeURIComponent(ctx.params.offerId);
    const token = bearerToken(request) ?? '';

    const offerResult = await fetchOfferFromMarketplace(offerId, token);
    if (!offerResult.ok) {
      if (offerResult.status === 404 || offerResult.status === undefined) return notFound();
      return jsonError(502, 'MARKETPLACE_RESPONSE_FAILED', 'Could not verify the offer from marketplace');
    }
    const offer = offerResult.offer;
    if (!offer || !offer.listing) return notFound();
    const sellerId = offer.listing.sellerId;
    if (!sellerId || sellerId !== user.sub) return notFound();
    if (offer.status !== 'ACCEPTED') {
      return jsonError(409, 'OFFER_NOT_ACCEPTED', 'Delivery details require an accepted offer');
    }

    // Only the seller of the accepted offer may retrieve the buyer's delivery
    // details; buyer / other seller / cross-hostel user get 404 (no existence
    // leak). The buyer profile is read from identity-service over the internal
    // API — transaction_app owns no cross-schema grant on identity.users.
    const buyerResult = await fetchUsersByIds([offer.buyerId]);
    if (!buyerResult.ok) {
      return jsonError(502, 'IDENTITY_UNAVAILABLE', buyerResult.error);
    }
    const buyer = buyerResult.users[0];
    if (!buyer) return notFound();

    return NextResponse.json({
      buyer: {
        id: buyer.id,
        fullName: buyer.fullName,
        hostelBlock: buyer.hostelBlock,
        roomNumber: buyer.roomNumber,
        hostelGroup: buyer.hostelGroup,
        email: buyer.email,
        // Contact number for the physical handover. Only ever returned to the
        // seller of THIS accepted offer (the guard above), never in public
        // profile or listing payloads.
        phone: buyer.phone,
      },
      offerId,
      offerStatus: offer.status,
    });
  } catch (err) {
    return internalError('deliveryDetails', err);
  }
}
