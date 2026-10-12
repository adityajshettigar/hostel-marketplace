import { expireOffers } from '../../../../routes/offers';

// POST /api/offers/expire — cron/scheduled entrypoint: auto-EXPIRE PENDING
// offers older than the TTL (default 48h). Idempotent.
export const dynamic = 'force-dynamic';

export const POST = expireOffers;
