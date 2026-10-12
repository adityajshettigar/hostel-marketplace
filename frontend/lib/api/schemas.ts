import { z } from "zod";
import { LISTING_CATEGORIES, LISTING_CONDITIONS } from "@/lib/api/types";

/** Runtime validators for gateway responses — shapes match verified serializers. */

export const paginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

export const listingSchema = z.object({
  id: z.string().uuid(),
  sellerId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.enum(LISTING_CATEGORIES),
  condition: z.enum(LISTING_CONDITIONS),
  price: z.string(),
  quantity: z.number().int(),
  images: z.array(z.string()),
  status: z.enum(["ACTIVE", "SOLD", "PAUSED", "DELETED"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ListingDTO = z.infer<typeof listingSchema>;

export const listingPageSchema = z.object({
  listings: z.array(listingSchema),
  pagination: paginationSchema,
});

export const offerSchema = z.object({
  id: z.string().uuid(),
  listingId: z.string().uuid(),
  buyerId: z.string().uuid(),
  offeredPrice: z.string(),
  quantity: z.number().int(),
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "COUNTERED", "WITHDRAWN", "EXPIRED"]),
  counterOf: z.string().uuid().nullable(),
  createdAt: z.string(),
  listing: z
    .object({
      id: z.string().uuid(),
      title: z.string(),
      sellerId: z.string().uuid(),
      price: z.string(),
      status: z.string(),
    })
    .optional(),
});
export type OfferDTO = z.infer<typeof offerSchema>;

export const offerListSchema = z.object({ offers: z.array(offerSchema) });

export const conversationSchema = z.object({
  id: z.string().uuid(),
  listingId: z.string().uuid(),
  buyerId: z.string().uuid(),
  sellerId: z.string().uuid(),
  createdAt: z.string(),
});
export type ConversationDTO = z.infer<typeof conversationSchema>;

export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderId: z.string().uuid(),
  body: z.string(),
  safetyResult: z.string(),
  delivered: z.boolean(),
  createdAt: z.string(),
  pending: z.boolean().optional(),
});
export type MessageDTO = z.infer<typeof messageSchema>;

export const messageListSchema = z.object({ messages: z.array(messageSchema) });

export const notificationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

export const notificationListSchema = z.object({
  notifications: z.array(notificationSchema),
});

export const transactionSchema = z.object({
  id: z.string().uuid(),
  offerId: z.string().uuid(),
  listingId: z.string().uuid(),
  buyerId: z.string().uuid(),
  sellerId: z.string().uuid(),
  amountPaise: z.number(),
  quantity: z.number().int(),
  currency: z.string(),
  status: z.enum([
    "DEAL_CONFIRMED",
    "ESCROW_PENDING",
    "ESCROW_LOCKED",
    "HANDOVER_PENDING",
    "HANDOVER_VERIFIED",
    "COMPLETED",
    "DISPUTED",
    "ADMIN_REVIEW",
    "FROZEN",
    "REFUNDED",
    "CANCELLED",
  ]),
  razorpayOrderId: z.string().nullable(),
  payoutId: z.string().nullable(),
  releaseDeadline: z.string().nullable(),
  handoverLocked: z.boolean(),
  failedAttempts: z.number().int(),
  disputeId: z.string().uuid().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type TransactionDTO = z.infer<typeof transactionSchema>;

export const transactionListSchema = z.object({
  transactions: z.array(transactionSchema),
  pagination: z.object({ page: z.number(), limit: z.number() }),
});

/** transaction-service createDispute response. */
export const disputeSchema = z.object({
  id: z.string().uuid(),
  transactionId: z.string().uuid(),
  status: z.string(),
  evidenceCount: z.number().int(),
  reason: z.string(),
  createdAt: z.string(),
});

/** GET /api/transaction/transactions/:id/handover-credential (buyer-only). */
export const handoverCredentialSchema = z.object({
  transactionId: z.string().uuid(),
  status: z.string(),
  releaseDeadline: z.string().nullable(),
  credential: z.object({
    pin: z.string(),
    qr: z.string().nullable(),
  }),
});
export type HandoverCredentialDTO = z.infer<typeof handoverCredentialSchema>;

/** Admin GET /api/transaction/disputes → { disputes, pagination }. */
export const disputeRowSchema = z.object({
  id: z.string().uuid(),
  transactionId: z.string().uuid(),
  raisedBy: z.string().uuid(),
  reason: z.string(),
  status: z.string(),
  resolution: z.string().nullable(),
  resolvedBy: z.string().uuid().nullable(),
  resolvedAt: z.string().nullable(),
  amountPaise: z.number(),
  buyerId: z.string().uuid(),
  sellerId: z.string().uuid(),
  createdAt: z.string(),
});
export const disputeListSchema = z.object({
  disputes: z.array(disputeRowSchema),
  pagination: paginationSchema,
});
export type DisputeRowDTO = z.infer<typeof disputeRowSchema>;

/** Admin GET /api/transaction/audit → { audit, pagination }. */
export const auditRowSchema = z.object({
  id: z.string(),
  transactionId: z.string().uuid().nullable(),
  actorId: z.string().uuid().nullable(),
  action: z.string(),
  detail: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export const auditListSchema = z.object({
  audit: z.array(auditRowSchema),
  pagination: paginationSchema,
});
export type AuditRowDTO = z.infer<typeof auditRowSchema>;

/** fulfilment tracking row (Post-Phase-9 buyer timeline + buyer receipt). */
export const fulfillmentSchema = z.object({
  id: z.string().uuid(),
  offerId: z.string().uuid(),
  transactionId: z.string().uuid().nullable(),
  status: z.enum(['ORDER_PLACED', 'ORDER_ACCEPTED', 'IN_DELIVERY', 'DELIVERED']),
  buyerReceived: z.boolean().nullable(),
  buyerConfirmedAt: z.string().nullable(),
  buyerDeclinedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
/**
 * GET /api/transaction/fulfill/:offerId — the buyer/seller order view. `fulfill`
 * is null until the seller starts delivery; `role` and `offerStatus` come from
 * the authoritative marketplace offer so the client never guesses its side.
 */
export const fulfillmentEntrySchema = z.object({
  fulfill: fulfillmentSchema.nullable(),
  transaction: transactionSchema.nullable(),
  role: z.enum(['buyer', 'seller']),
  offerStatus: z.string(),
});
export type FulfillmentDTO = z.infer<typeof fulfillmentSchema>;
export type FulfillmentEntryDTO = z.infer<typeof fulfillmentEntrySchema>;

export const purchaseEntrySchema = z.object({
  id: z.string().uuid(),
  offerId: z.string().uuid(),
  listingId: z.string().uuid(),
  buyerId: z.string().uuid(),
  sellerId: z.string().uuid(),
  amountPaise: z.number(),
  quantity: z.number().int(),
  currency: z.string(),
  status: z.string(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  role: z.enum(['buyer', 'seller']),
  category: z.enum(['PURCHASE', 'SALE', 'FAILURE']),
  listingTitle: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
});
export const purchaseListSchema = z.object({
  purchases: z.array(purchaseEntrySchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    hasMore: z.boolean().optional(),
  }),
});
export const purchaseDetailSchema = z.object({
  purchase: z.object({
    id: z.string().uuid(),
    offerId: z.string().uuid(),
    listingId: z.string().uuid(),
    buyerId: z.string().uuid(),
    sellerId: z.string().uuid(),
    amountPaise: z.number(),
    quantity: z.number().int(),
    currency: z.string(),
    status: z.string(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    role: z.enum(['buyer', 'seller']),
    category: z.enum(['PURCHASE', 'SALE', 'FAILURE']),
    buyer: z.object({
      id: z.string().uuid(),
      fullName: z.string(),
      hostelBlock: z.string().nullable(),
      roomNumber: z.string().nullable(),
      phone: z.string().nullable(),
    }).nullable(),
    seller: z.object({
      id: z.string().uuid(),
      fullName: z.string(),
      hostelBlock: z.string().nullable(),
      roomNumber: z.string().nullable(),
      phone: z.string().nullable(),
    }).nullable(),
    listing: z.object({
      id: z.string().uuid(),
      title: z.string(),
      sellerId: z.string().uuid(),
      price: z.string(),
      status: z.string(),
    }).nullable(),
    imageUrl: z.string().nullable(),
  }),
});
export type PurchaseDetailDTO = z.infer<typeof purchaseDetailSchema>;

export const fulfillmentEntryResponseSchema = z.object({
  fulfill: fulfillmentSchema,
  transaction: transactionSchema.nullable(),
});
export type FulfillmentEntryResponseDTO = z.infer<typeof fulfillmentEntryResponseSchema>;
export const purchaseDetailResponseSchema = z.object({
  purchase: z.object({
    id: z.string().uuid(),
    offerId: z.string().uuid(),
    listingId: z.string().uuid(),
    buyerId: z.string().uuid(),
    sellerId: z.string().uuid(),
    amountPaise: z.number(),
    quantity: z.number().int(),
    currency: z.string(),
    status: z.string(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    role: z.enum(['buyer', 'seller']),
    category: z.enum(['PURCHASE', 'SALE', 'FAILURE']),
    buyer: z.object({
      id: z.string().uuid(),
      fullName: z.string(),
      hostelBlock: z.string().nullable(),
      roomNumber: z.string().nullable(),
      phone: z.string().nullable(),
    }).nullable(),
    seller: z.object({
      id: z.string().uuid(),
      fullName: z.string(),
      hostelBlock: z.string().nullable(),
      roomNumber: z.string().nullable(),
      phone: z.string().nullable(),
    }).nullable(),
    listing: z.object({
      id: z.string().uuid(),
      title: z.string(),
      sellerId: z.string().uuid(),
      price: z.string(),
      status: z.string(),
    }).nullable(),
    imageUrl: z.string().nullable(),
  }),
});
export type PurchaseDetailResponseDTO = z.infer<typeof purchaseDetailResponseSchema>;

/** Admin userbase: identity GET /api/identity/users → { users }. */
export const userbaseRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  fullName: z.string(),
  hostelBlock: z.string().nullable(),
  role: z.enum(["user", "admin"]),
  lastLoginAt: z.string(),
});
export type UserbaseRowDTO = z.infer<typeof userbaseRowSchema>;

export const userbaseListSchema = z.object({
  users: z.array(userbaseRowSchema),
});

/** identity /users/me returns snake_case DB rows; map to camelCase. */
export const meSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  full_name: z.string(),
  hostel_block: z.string().nullable(),
  hostel_group: z.enum(['MH', 'LH']).nullable(),
  room_number: z.string().nullable(),
  upi_vpa: z.string().nullable(),
  phone: z.string().nullable().optional(),
  verification_status: z.string(),
  role: z.enum(['user', 'admin']).optional(),
});

/** identity login response user section (camelCase). */
export const loginResponseSchema = z.object({
  email: z.string(),
  fullName: z.string(),
  hostelBlock: z.string().nullable(),
  roomNumber: z.string().nullable(),
  upiVpa: z.string().nullable(),
  verificationStatus: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.string(),
});
