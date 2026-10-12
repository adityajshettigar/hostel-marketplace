"use client";

import { z } from "zod";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api/client";
import {
  listingKeys,
  offerKeys,
  conversationKeys,
  notificationKeys,
  txKeys,
  disputeKeys,
  auditKeys,
  userKeys,
} from "@/lib/api/keys";
import {
  listingPageSchema,
  listingSchema,
  offerListSchema,
  conversationSchema,
  messageListSchema,
  notificationListSchema,
  transactionListSchema,
  transactionSchema,
  handoverCredentialSchema,
  disputeListSchema,
  auditListSchema,
  userbaseListSchema,
  fulfillmentSchema,
  fulfillmentEntrySchema,
  purchaseListSchema,
  purchaseDetailSchema,
  meSchema,
} from "@/lib/api/schemas";
import {
  fulfillmentKeys,
  purchasesKeys,
} from "@/lib/api/keys";
import type { ListingCategory, HostelBlock } from "@/lib/api/types";

export type ListingFilters = {
  q?: string;
  category?: ListingCategory | "All";
  block?: HostelBlock | "All";
};

function buildQuery(filters: ListingFilters, page: number): string {
  const p = new URLSearchParams();
  if (filters.q) p.set("q", filters.q);
  if (filters.category && filters.category !== "All") p.set("category", filters.category);
  if (filters.block && filters.block !== "All") p.set("block", filters.block);
  p.set("page", String(page));
  p.set("limit", "12");
  return `?${p.toString()}`;
}

/** Infinite marketplace grid — GET /api/marketplace/listings (gateway JWT). */
export function useListings(filters: ListingFilters) {
  return useInfiniteQuery({
    queryKey: listingKeys.list(filters),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      request(`/api/marketplace/listings${buildQuery(filters, pageParam)}`, {
        schema: listingPageSchema,
      }),
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined,
  });
}

/**
 * Listing detail — GET /api/marketplace/listings/:id → { listing }.
 *
 * The detail endpoint returns the listing WRAPPED (same envelope as the list
 * route and as the create/PATCH responses: `{ listing: {...} }`), so the
 * response schema must describe the envelope — parsing the bare listing here
 * made every detail request fail shape validation, which the page reported as
 * "Listing not found" for every MH and LH listing.
 */
export function useListing(id: string) {
  return useQuery({
    queryKey: listingKeys.detail(id),
    queryFn: () =>
      request(`/api/marketplace/listings/${id}`, {
        schema: z.object({ listing: listingSchema }),
      }),
    retry: false,
  });
}

/** Seller's public profile (Verified Resident badge source). */
export function usePublicProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ["users", "public", userId],
    queryFn: () =>
      request<{
        fullName: string;
        hostelBlock: string | null;
        roomNumber: string | null;
        verificationStatus: string;
      }>(`/api/identity/users/${userId}/public`),
    enabled: Boolean(userId),
    retry: false,
  });
}

/** Offers on one listing — GET /api/marketplace/offers?listingId=… → { offers }. */
export function useListingOffers(listingId: string) {
  return useQuery({
    queryKey: offerKeys.listing(listingId),
    queryFn: () =>
      request(`/api/marketplace/offers?listingId=${listingId}`, { schema: offerListSchema }),
    retry: false,
  });
}

/** My offers (both directions) — GET /api/marketplace/offers → { offers }. */
export function useMyOffers() {
  return useQuery({
    queryKey: offerKeys.mine(),
    queryFn: () => request(`/api/marketplace/offers`, { schema: offerListSchema }),
  });
}

/** Conversations — GET /api/communication/conversations → { conversations }. */
export function useConversations() {
  return useQuery({
    queryKey: conversationKeys.all,
    queryFn: () =>
      request(`/api/communication/conversations`, {
        schema: z.object({ conversations: z.array(conversationSchema) }),
      }),
  });
}

/** One conversation. */
export function useConversation(id: string) {
  return useQuery({
    queryKey: conversationKeys.detail(id),
    queryFn: () => request(`/api/communication/conversations/${id}`, { schema: conversationSchema }),
    retry: false,
  });
}

/** Messages in one conversation — GET /api/communication/messages?conversation_id=…. */
export function useMessages(conversationId: string) {
  return useQuery({
    queryKey: conversationKeys.messages(conversationId),
    queryFn: () =>
      request(`/api/communication/messages?conversation_id=${conversationId}`, {
        schema: messageListSchema,
      }),
  });
}

/** Notifications — GET /api/communication/notifications → { notifications }. */
export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.all,
    queryFn: () => request(`/api/communication/notifications`, { schema: notificationListSchema }),
    enabled,
  });
}

/** My transactions, either side — GET /api/transaction/transactions?role=…. */
export function useMyTransactions(role: "buying" | "selling" = "buying") {
  return useQuery({
    queryKey: [...txKeys.mine(), role],
    queryFn: () =>
      request(`/api/transaction/transactions?role=${role}`, { schema: transactionListSchema }),
  });
}

/** Transaction detail — GET /api/transaction/transactions/:id → { transaction }. */
export function useTransaction(id: string) {
  return useQuery({
    queryKey: txKeys.detail(id),
    queryFn: () =>
      request(`/api/transaction/transactions/${id}`, {
        schema: z.object({ transaction: transactionSchema }),
      }),
    retry: false,
  });
}

/** Buyer-only handover credential — GET /api/transaction/transactions/:id/handover-credential. */
export function useHandoverCredential(transactionId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...txKeys.detail(transactionId), "handover-credential"],
    queryFn: () =>
      request(`/api/transaction/transactions/${transactionId}/handover-credential`, {
        schema: handoverCredentialSchema,
      }),
    enabled,
    // 401/403/409 are meaningful states here (not buyer / not available), not
    // transient errors — show them, don't retry.
    retry: false,
  });
}

/** H2: seller's own listings in ANY status — GET /api/marketplace/listings/mine. */
export function useMyListings() {
  return useQuery({
    queryKey: listingKeys.mine(),
    queryFn: () =>
      request(`/api/marketplace/listings/mine?limit=50`, { schema: listingPageSchema }),
  });
}

/** Admin: disputes queue — GET /api/transaction/disputes (typed). */
export function useDisputes() {
  return useQuery({
    queryKey: disputeKeys.all,
    queryFn: () => request(`/api/transaction/disputes`, { schema: disputeListSchema }),
  });
}

/** Admin: audit log (enabled when the tab opens) — typed. */
export function useAuditLog(enabled: boolean) {
  return useQuery({
    queryKey: auditKeys.list({}),
    queryFn: () => request(`/api/transaction/audit?limit=50`, { schema: auditListSchema }),
    enabled,
  });
}

/** Admin userbase — GET /api/identity/users: accounts that logged in + role. */
export function useUserbase() {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: () => request(`/api/identity/users`, { schema: userbaseListSchema }),
    retry: false,
  });
}

// ── fulfilment (Post-Phase-9 buyer timeline) ──────────────────────────

export function useFulfillment(offerId: string) {
  return useQuery({
    queryKey: fulfillmentKeys.detail(offerId),
    queryFn: () =>
      request(`/api/transaction/fulfill/${offerId}`, { schema: fulfillmentEntrySchema }),
    enabled: Boolean(offerId),
    retry: false,
  });
}

/**
 * Today's local-day boundaries as ISO instants for the purchase-history filter.
 * The browser owns the timezone, so "today" is computed here and the server
 * simply compares its own timestamps against the range.
 */
export function localDayRange(day: Date = new Date()): { from: string; to: string } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

// ── purchases (Post-Phase-9 transaction history) ──────────────────────

/**
 * Purchase history for ONE side ("buying" = you bought, "selling" = you sold).
 * `range` narrows it to an arbitrary window — the Purchases page defaults to
 * today's local day and offers the full history on demand.
 */
export function usePurchases(
  role: 'buying' | 'selling' = 'buying',
  range?: { from?: string; to?: string },
) {
  const from = range?.from;
  const to = range?.to;
  return useInfiniteQuery({
    queryKey: [...purchasesKeys.list(role), from ?? "all", to ?? "all"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ role, page: String(pageParam), limit: "20" });
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      return request(`/api/transaction/purchases?${p.toString()}`, {
        schema: purchaseListSchema,
      });
    },
    getNextPageParam: (last) =>
      last.pagination.hasMore ? last.pagination.page + 1 : undefined,
  });
}

/** The authenticated user's own identity record (profile dialog). */
export function useMyProfile(enabled = true) {
  return useQuery({
    queryKey: ["me", "profile"],
    queryFn: () => request(`/api/identity/users/me`, { schema: meSchema }),
    enabled,
    retry: false,
  });
}

export function usePurchaseDetail(id: string) {
  return useQuery({
    queryKey: purchasesKeys.detail(id),
    queryFn: () => request(`/api/transaction/purchases/${id}`, { schema: purchaseDetailSchema }),
    enabled: Boolean(id),
    retry: false,
  });
}
