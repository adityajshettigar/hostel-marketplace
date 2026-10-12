export const LISTING_CATEGORIES = [
  "Books",
  "Electronics",
  "Furniture",
  "Appliances",
  "Other",
] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export const LISTING_CONDITIONS = ["New", "Like New", "Good", "Fair"] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

/**
 * Hostels SRS 5.2.2 + MH/LH segregation feature.
 * MH-* = men's hostels (7), LH-* = ladies' hostels (3). Each resident picks
 * ONE at registration and only ever trades inside their own group — the
 * backend enforces this on every marketplace read/write.
 */
export const MH_HOSTELS = [
  "MH-1",
  "MH-2",
  "MH-3",
  "MH-4",
  "MH-5",
  "MH-6",
  "MH-7",
] as const;
export const LH_HOSTELS = ["LH-1", "LH-2", "LH-3"] as const;
export const HOSTEL_BLOCKS = [...MH_HOSTELS, ...LH_HOSTELS] as const;
export type HostelBlock = (typeof HOSTEL_BLOCKS)[number];
export type HostelGroup = "MH" | "LH";

/** Group of a hostel block — mirrors the backend derivation (prefix = LH ⇒ LH, anything else ⇒ MH). */
export function hostelGroup(block: string | null | undefined): HostelGroup {
  return block && block.toUpperCase().startsWith("LH") ? "LH" : "MH";
}

/** The block toggle only ever lists the caller's own group's hostels. */
export function hostelsOfGroup(group: HostelGroup): readonly HostelBlock[] {
  return group === "LH" ? LH_HOSTELS : MH_HOSTELS;
}

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

/** marketplace-service serializeListing output (verified). */
export type Listing = {
  id: string;
  sellerId: string;
  title: string;
  description: string | null;
  category: ListingCategory;
  condition: ListingCondition;
  price: string; // rupees as decimal string, e.g. "850.00"
  quantity: number;
  images: string[];
  status: "ACTIVE" | "SOLD" | "PAUSED" | "DELETED";
  createdAt: string;
  updatedAt: string;
};

export type ListingPage = { listings: Listing[]; pagination: Pagination };

export type OfferStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "COUNTERED"
  | "WITHDRAWN"
  | "EXPIRED";

/** marketplace-service serializeOffer output (verified — counterOf, no sellerId). */
export type Offer = {
  id: string;
  listingId: string;
  buyerId: string;
  offeredPrice: string;
  quantity: number;
  status: OfferStatus;
  counterOf: string | null;
  createdAt: string;
  /** Present when the server embedded the listing summary. */
  listing?: {
    id: string;
    title: string;
    sellerId: string;
    price: string;
    status: string;
  };
};

/** transaction-service status machine (verified full union). */
export type TransactionStatus =
  | "DEAL_CONFIRMED"
  | "ESCROW_PENDING"
  | "ESCROW_LOCKED"
  | "HANDOVER_PENDING"
  | "HANDOVER_VERIFIED"
  | "COMPLETED"
  | "DISPUTED"
  | "ADMIN_REVIEW"
  | "FROZEN"
  | "REFUNDED"
  | "CANCELLED";

/** transaction-service serializeTransaction output (verified — paise integer). */
export type Transaction = {
  id: string;
  offerId: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  amountPaise: number;
  quantity: number;
  currency: string;
  status: TransactionStatus;
  razorpayOrderId: string | null;
  payoutId: string | null;
  releaseDeadline: string | null;
  handoverLocked: boolean;
  failedAttempts: number;
  disputeId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

/** communication-service serializeMessage output (verified — safetyResult). */
export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  safetyResult: "SAFE" | "CONTACT_INFO" | "UPI_INFO" | "PAYMENT_REQUEST" | string;
  delivered: boolean;
  createdAt: string;
  /** Frontend-only: optimistic send marker. */
  pending?: boolean;
};

/** communication-service serializeConversation output (verified). */
export type Conversation = {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  createdAt: string;
};

/** communication-service serializeNotification output (verified — payload/readAt). */
export type NotificationItem = {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

/**
 * Session user as the login response carries it (camelCase). The
 * /users/me endpoint returns snake_case DB rows; authcontext maps it.
 */
export type SessionUser = {
  id?: string;
  email: string;
  fullName: string;
  hostelBlock: string | null;
  hostelGroup: 'MH' | 'LH' | null;
  roomNumber: string | null;
  upiVpa: string | null;
  /**
   * Contact number for the physical handover. Private: sent to the seller of an
   * accepted order only (never in the public profile or listing payloads).
   */
  phone?: string | null;
  verificationStatus: string;
  role?: "admin" | "user";
};

/** identity-service public profile (verified fields). */
export type PublicProfile = {
  fullName: string;
  hostelBlock: string | null;
  roomNumber: string | null;
  verificationStatus: string;
};

/** fulfilment tracking row (Post-Phase-9 buyer timeline). */
export type Fulfillment = {
  id: string;
  offerId: string;
  transactionId: string | null;
  status: 'ORDER_PLACED' | 'ORDER_ACCEPTED' | 'IN_DELIVERY' | 'DELIVERED';
  /** NULL = never answered, true = buyer confirmed receipt, false = buyer denied. */
  buyerReceived: boolean | null;
  buyerConfirmedAt: string | null;
  buyerDeclinedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

/** fulfilment list entry (My Orders / order details dialog). */
export type FulfillmentEntry = {
  fulfill: Fulfillment | null;
  transaction: Transaction | null;
  /** The caller's side of this order (authoritative, from the marketplace offer). */
  role: 'buyer' | 'seller';
  /** Authoritative marketplace offer status (ACCEPTED once the seller accepts). */
  offerStatus: string;
};

/** purchase history entry (Post-Phase-9 Purchases module). */
export type PurchaseEntry = {
  id: string;
  offerId: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  amountPaise: number;
  quantity: number;
  currency: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  role: 'buyer' | 'seller';
  category: 'PURCHASE' | 'SALE' | 'FAILURE';
  /** Item name, resolved server-side from marketplace-service. */
  listingTitle?: string | null;
  /** First listing image (server-selected), used by the history cards. */
  imageUrl?: string | null;
};

export type PurchaseList = {
  purchases: PurchaseEntry[];
  pagination: { page: number; limit: number };
};

/** purchase detail (modal) with buyer, seller, item, first image. */
export type PurchaseDetail = {
  id: string;
  offerId: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  amountPaise: number;
  quantity: number;
  currency: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  role: 'buyer' | 'seller';
  category: 'PURCHASE' | 'SALE' | 'FAILURE';
  buyer: {
    id: string;
    fullName: string;
    hostelBlock: string | null;
    roomNumber: string | null;
    phone: string | null;
  } | null;
  seller: {
    id: string;
    fullName: string;
    hostelBlock: string | null;
    roomNumber: string | null;
    phone: string | null;
  } | null;
  listing: {
    id: string;
    title: string;
    sellerId: string;
    price: string;
    status: string;
  } | null;
  imageUrl: string | null;
};

/** purchase detail dialog response. */
export type PurchaseDetailResponse = {
  purchase: PurchaseDetail;
};

/** transaction-service dispute creation response (verified subset). */
export type Dispute = {
  id: string;
  transactionId: string;
  status: string;
  evidenceCount: number;
  reason: string;
  createdAt: string;
};
