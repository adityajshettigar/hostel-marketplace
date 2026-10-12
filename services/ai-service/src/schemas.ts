import { z } from 'zod';
import { LISTING_CATEGORIES, LISTING_CONDITIONS } from './categories';

// ---------------------------------------------------------------------------
// Request validation — ai-service (Phase 5). Strict bodies, bounded lengths.
// ---------------------------------------------------------------------------

export const suggestListingSchema = z
  .object({
    imageUrl: z.url('imageUrl must be a valid URL').max(2048),
    category: z.enum(LISTING_CATEGORIES).optional(),
    condition: z.enum(LISTING_CONDITIONS).optional(),
  })
  .strict();

export const suggestPriceSchema = z
  .object({
    category: z.enum(LISTING_CATEGORIES),
    condition: z.enum(LISTING_CONDITIONS).optional(),
  })
  .strict();

export const interactionCreateSchema = z
  .object({
    kind: z.enum(['VIEW', 'SEARCH']),
    category: z.enum(LISTING_CATEGORIES).optional(),
    query: z.string().trim().min(1).max(200).optional(),
    listingId: z.uuid().optional(),
  })
  .strict()
  .refine((v) => v.kind !== 'SEARCH' || typeof v.query === 'string', {
    message: 'SEARCH interactions require a query',
    path: ['query'],
  });

export const recommendationsQuery = z.object({
  userId: z.uuid('userId must be a UUID'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
