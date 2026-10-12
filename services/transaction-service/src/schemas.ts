import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request schemas — zod v4 API (z.uuid(), .strict() objects). No .max() on
// records. Money is integer paise, never floats.
// ---------------------------------------------------------------------------

export const createTransactionSchema = z
  .object({
    offerId: z.uuid(),
  })
  .strict();

export const disputeCreateSchema = z
  .object({
    reason: z.string().min(3).max(2000),
    evidenceUrls: z.array(z.url()).min(1).max(10),
  })
  .strict();

export const disputeResolveSchema = z
  .object({
    resolution: z.enum(['COMPLETED', 'REFUNDED']),
    note: z.string().min(3).max(2000),
    secondAdminToken: z.string().min(1).optional(),
  })
  .strict();

export const verifyHandoverSchema = z
  .object({
    pin: z.string().regex(/^\d{4}$/).optional(),
    qr: z.string().min(20).max(8000).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.pin || v.qr), { message: 'pin or qr required' })
  .refine((v) => !(v.pin && v.qr), { message: 'provide only one of pin / qr' });
