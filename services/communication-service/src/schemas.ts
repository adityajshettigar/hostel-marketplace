import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request validation (SRS Phase 4). All bodies are strict: unknown keys
// rejected, sizes/lengths bounded before anything touches the DB.
// ---------------------------------------------------------------------------

export const conversationCreateSchema = z
  .object({
    listing_id: z.uuid('listing_id must be a UUID'),
  })
  .strict();

export const messagePostSchema = z
  .object({
    conversation_id: z.uuid('conversation_id must be a UUID'),
    body: z.string().trim().min(1, 'body must not be empty').max(2000, 'body must be at most 2000 characters'),
  })
  .strict();

export const notificationCreateSchema = z
  .object({
    user_id: z.uuid('user_id must be a UUID'),
    type: z.string().trim().min(1, 'type must not be empty').max(100, 'type must be at most 100 characters'),
    payload: z.record(z.string(), z.unknown()).refine((o) => Object.keys(o).length <= 50, 'payload must have at most 50 keys').optional(),
  })
  .strict();

export const notificationListQuery = z.object({
  unread_only: z
    .enum(['true', 'false'])
    .default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
