import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod validation — marketplace-service (SRS categories/conditions).
// ---------------------------------------------------------------------------

export const LISTING_CATEGORIES = [
  'Books',
  'Electronics',
  'Furniture',
  'Appliances',
  'Food',
] as const;

export const LISTING_CONDITIONS = [
  'New',
  'Like New',
  'Good',
  'Fair',
  'Worn',
] as const;

export const OFFER_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'COUNTERED',
  'WITHDRAWN',
  'EXPIRED',
] as const;

const priceString = z
  .string()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, 'price must be a decimal like "249.99" (max 2 dp)');

// --- Listings ---------------------------------------------------------------

export const listingCreateSchema = z.object({
  title: z.string().trim().min(3, 'title must be at least 3 characters').max(140),
  description: z.string().trim().max(4000).optional(),
  category: z.enum(LISTING_CATEGORIES),
  condition: z.enum(LISTING_CONDITIONS),
  price: priceString,
  quantity: z.number().int().min(1, 'quantity must be at least 1').max(999),
  // Cloudinary URLs uploaded by the frontend; we only validate + store them.
  images: z
    .array(z.string().url('each image must be a URL'))
    .max(6, 'at most 6 images per listing'),
});

export const listingUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(140).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    category: z.enum(LISTING_CATEGORIES).optional(),
    condition: z.enum(LISTING_CONDITIONS).optional(),
    price: priceString.optional(),
    quantity: z.number().int().min(1).max(999).optional(),
    images: z.array(z.string().url()).max(6).optional(),
  });

// QA3 closeout: the single seller-facing status transition. The DB CHECK
// constraint is ('ACTIVE','DELETED','SOLD'); DELETED is the soft-delete path
// and SOLD is settlement, so the only valid owner action here is ACTIVE→SOLD.
export const listingStatusSchema = z.object({ status: z.literal('SOLD') });

export const listingListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.enum(LISTING_CATEGORIES).optional(),
  block: z.string().trim().min(1).max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// --- Offers -----------------------------------------------------------------

export const offerCreateSchema = z.object({
  listingId: z.string().uuid('listingId must be a uuid'),
  offeredPrice: priceString,
  quantity: z.number().int().min(1).max(999),
});

export const offerCounterSchema = z.object({
  offeredPrice: priceString,
  quantity: z.number().int().min(1).max(999),
});

// --- Sold stats (Phase 5: consumed by ai-service price suggestions) ---------

export const soldStatsQuery = z.object({
  category: z.enum(LISTING_CATEGORIES).optional(),
  condition: z.enum(LISTING_CONDITIONS).optional(),
});
