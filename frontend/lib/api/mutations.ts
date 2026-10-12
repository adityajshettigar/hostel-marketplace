"use client";

import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { request, ApiError } from "@/lib/api/client";
import {
  listingKeys,
  offerKeys,
  conversationKeys,
  notificationKeys,
  txKeys,
  disputeKeys,
  userKeys,
  fulfillmentKeys,
  purchasesKeys,
} from "@/lib/api/keys";
import { disputeSchema, type TransactionDTO } from "@/lib/api/schemas";
import type {
  ListingFormInput,
  OfferFormInput,
  MessageFormInput,
  DisputeFormInput,
  ResolveDisputeFormInput,
  CounterOfferFormInput,
} from "@/lib/schemas/forms";
import { useToast } from "@/components/ui/toast";

function errMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "SOMETHING WENT WRONG — TRY AGAIN";
}

/** POST /api/marketplace/listings → { listing } */
export type CreateListingPayload = {
  title: string;
  description?: string;
  category: string;
  condition: string;
  price: string;
  quantity: number;
  images: string[];
};

export function useCreateListing() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: CreateListingPayload) =>
      request("/api/marketplace/listings", {
        method: "POST",
        body: {
          title: input.title,
          description: input.description || undefined,
          category: input.category,
          condition: input.condition,
          price: input.price,
          quantity: input.quantity,
          images: input.images,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listingKeys.all });
      toast({ tone: "success", title: "LISTING CREATED" });
    },
    onError: (err) => toast({ tone: "error", title: "COULD NOT CREATE LISTING", body: errMessage(err) }),
  });
}

/** PATCH /api/marketplace/listings/:id */
export function useUpdateListing(listingId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (patch: Partial<ListingFormInput>) =>
      request(`/api/marketplace/listings/${listingId}`, { method: "PATCH", body: patch }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listingKeys.detail(listingId) });
      void qc.invalidateQueries({ queryKey: listingKeys.mine() });
      toast({ tone: "success", title: "LISTING UPDATED" });
    },
    onError: (err) => toast({ tone: "error", title: "COULD NOT UPDATE", body: errMessage(err) }),
  });
}

/** DELETE /api/marketplace/listings/:id (soft-delete). */
export function useDeleteListing(listingId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: () => request(`/api/marketplace/listings/${listingId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listingKeys.all });
      void qc.invalidateQueries({ queryKey: listingKeys.mine() });
      toast({ tone: "success", title: "LISTING REMOVED" });
    },
    onError: (err) => toast({ tone: "error", title: "COULD NOT REMOVE", body: errMessage(err) }),
  });
}

/** PATCH /api/marketplace/listings/:id/status — seller marks own ACTIVE listing SOLD. */
export function useMarkListingSold(listingId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: () =>
      request(`/api/marketplace/listings/${listingId}/status`, {
        method: "PATCH",
        body: { status: "SOLD" },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listingKeys.all });
      void qc.invalidateQueries({ queryKey: listingKeys.mine() });
      toast({ tone: "success", title: "MARKED AS SOLD" });
    },
    onError: (err) => toast({ tone: "error", title: "COULD NOT MARK SOLD", body: errMessage(err) }),
  });
}

/** POST /api/marketplace/offers → { offer } (201 PENDING). */
export function useMakeOffer(listingId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: OfferFormInput) =>
      request("/api/marketplace/offers", {
        method: "POST",
        body: { listingId, offeredPrice: String(input.amount), quantity: 1 },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: offerKeys.listing(listingId) });
      void qc.invalidateQueries({ queryKey: offerKeys.mine() });
      toast({ tone: "success", title: "OFFER SENT" });
    },
    onError: (err) => toast({ tone: "error", title: "OFFER NOT SENT", body: errMessage(err) }),
  });
}

/** PATCH /api/marketplace/offers/:id/{accept,reject,withdraw}. */
export function useRespondToOffer() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: { offerId: string; action: "accept" | "reject" | "withdraw" }) =>
      request(`/api/marketplace/offers/${input.offerId}/${input.action}`, { method: "PATCH" }),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: offerKeys.all });
      void qc.invalidateQueries({ queryKey: listingKeys.all });
      void qc.invalidateQueries({ queryKey: txKeys.all });
      toast({
        tone: "success",
        title:
          input.action === "accept"
            ? "OFFER ACCEPTED — NOW CREATE THE TRANSACTION"
            : `OFFER ${input.action.toUpperCase()}ED`,
      });
    },
    onError: (err) => toast({ tone: "error", title: "ACTION FAILED", body: errMessage(err) }),
  });
}

/** PATCH /api/marketplace/offers/:id/counter → new child PENDING offer (201). */
export function useCounterOffer() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: CounterOfferFormInput & { offerId: string }) =>
      request(`/api/marketplace/offers/${input.offerId}/counter`, {
        method: "PATCH",
        body: { offeredPrice: String(input.amount), quantity: input.quantity },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: offerKeys.all });
      toast({ tone: "info", title: "COUNTER PROPOSED" });
    },
    onError: (err) => toast({ tone: "error", title: "COUNTER FAILED", body: errMessage(err) }),
  });
}

/** POST /api/communication/conversations { listing_id } → { conversation }. */
export function useStartConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (listingId: string) =>
      request<{ conversation: { id: string } }>(`/api/communication/conversations`, {
        method: "POST",
        body: { listing_id: listingId },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}

/** POST /api/communication/messages { conversation_id, body } — strict backend schema. */
export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: MessageFormInput) =>
      request<{
        message: MessageShape;
        delivered: boolean;
        warning?: { code: string; text: string };
      }>(`/api/communication/messages`, {
        method: "POST",
        body: { conversation_id: conversationId, body: input.body },
      }),
    onSuccess: (res) => {
      if (res.warning) {
        // SRS 5.7.2 — blocked message: stored, never delivered; persistent toast.
        toast({ tone: "error", title: "MESSAGE BLOCKED", body: res.warning.text, persistent: true });
      }
      void qc.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) });
    },
    onError: (err) =>
      toast({ tone: "error", title: "MESSAGE NOT SENT", body: errMessage(err), persistent: true }),
  });
}

type MessageShape = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  safetyResult: string;
  delivered: boolean;
  createdAt: string;
};

/** PATCH /api/communication/notifications/:id/read (+ read-all fallback). */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: "all" | string) =>
      request(`/api/communication/notifications/${id}/read`, { method: "PATCH" }).catch(() =>
        request(`/api/communication/notifications/read-all`, { method: "PATCH" }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/** POST /api/transaction/transactions { offerId } → { transaction } (201 DEAL_CONFIRMED). */
export function useCreateTransaction() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (offerId: string) =>
      request(`/api/transaction/transactions`, {
        method: "POST",
        body: { offerId },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: txKeys.all });
      toast({ tone: "success", title: "DEAL CONFIRMED — TIME FOR ESCROW" });
    },
    onError: (err) => toast({ tone: "error", title: "COULD NOT CREATE TRANSACTION", body: errMessage(err) }),
  });
}

/**
 * POST /api/transaction/transactions/:id/escrow/init → Razorpay order.
 * Returns { transaction, razorpayOrder: { id, amount, currency } }.
 * 503 RAZORPAY_NOT_CONFIGURED / 502 RAZORPAY_ORDER_FAILED surface as toasts.
 */
export function useInitEscrow(transactionId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: () =>
      request<{
        transaction: TransactionDTO;
        razorpayOrder: { id: string; amount: number; currency: string };
      }>(`/api/transaction/transactions/${transactionId}/escrow/init`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: txKeys.detail(transactionId) });
    },
    onError: (err) =>
      toast({ tone: "error", title: "ESCROW COULD NOT BE INITIALISED", body: errMessage(err) }),
  });
}

/** POST /api/transaction/transactions/:id/verify-handover — seller only, { pin } or { qr }. */
export function useConfirmHandover(transactionId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (secret: { pin?: string; qr?: string }) =>
      request<{
        transactionId: string;
        status: string;
        retriable?: boolean;
        message?: string;
      }>(`/api/transaction/transactions/${transactionId}/verify-handover`, {
        method: "POST",
        body: secret,
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: txKeys.detail(transactionId) });
      toast({
        tone: res.status === "COMPLETED" ? "success" : "info",
        title:
          res.status === "COMPLETED"
            ? "HANDOVER VERIFIED — FUNDS RELEASED"
            : res.message ?? "HANDOVER VERIFIED — PAYOUT RETRYING",
      });
    },
    onError: (err) =>
      toast({ tone: "error", title: "PIN OR QR REJECTED", body: errMessage(err), persistent: true }),
  });
}

/** POST /api/transaction/transactions/:id/dispute { reason, evidenceUrls }. */
export function useRaiseDispute(transactionId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: DisputeFormInput) =>
      request(`/api/transaction/transactions/${transactionId}/dispute`, {
        method: "POST",
        body: {
          reason: `[${input.reason}] ${input.description}`.slice(0, 2000),
          evidenceUrls: input.evidence,
        },
        schema: z.object({ dispute: disputeSchema }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: txKeys.detail(transactionId) });
      void qc.invalidateQueries({ queryKey: disputeKeys.all });
      toast({ tone: "info", title: "DISPUTE FILED — ESCROW FROZEN PENDING REVIEW" });
    },
    onError: (err) => toast({ tone: "error", title: "COULD NOT FILE DISPUTE", body: errMessage(err) }),
  });
}

/** PATCH /api/transaction/disputes/:id/resolve — admin, { resolution, note, secondAdminToken? }. */
export function useResolveDispute() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: ResolveDisputeFormInput & { disputeId: string }) =>
      request(`/api/transaction/disputes/${input.disputeId}/resolve`, {
        method: "PATCH",
        body: {
          resolution: input.resolution,
          note: input.note,
          secondAdminToken: input.secondAdminToken || undefined,
        },
      }),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: disputeKeys.all });
      void qc.invalidateQueries({ queryKey: txKeys.all });
      toast({ tone: "success", title: `DISPUTE RESOLVED — ${input.resolution}` });
    },
    onError: (err) => toast({ tone: "error", title: "RESOLUTION FAILED", body: errMessage(err) }),
  });
}

/** Admin userbase — PATCH /api/identity/users/:id/role, { role: "user" | "admin" }. */
export function useChangeUserRole() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: { userId: string; role: "user" | "admin" }) =>
      request(`/api/identity/users/${input.userId}/role`, {
        method: "PATCH",
        body: { role: input.role },
      }),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: userKeys.all });
      toast({
        tone: "success",
        title: "ROLE UPDATED",
        body: `Account is now ${input.role === "admin" ? "an admin" : "a regular user"}.`,
      });
    },
    onError: (err) => toast({ tone: "error", title: "COULD NOT CHANGE ROLE", body: errMessage(err) }),
  });
}

/** AI assist — POST /api/ai/suggest/listing (strict { imageUrl, category?, condition? }). */
export function useAiListingSuggestion() {
  return useMutation({
    mutationFn: (input: { imageUrl: string; category?: string; condition?: string }) =>
      request<{
        suggestion: { suggestedTitle: string; suggestedCategory: string; suggestedDescription: string };
        modelVersion: string;
        fallbackUsed: boolean;
        aiSuggestion: true;
      }>(`/api/ai/suggest/listing`, { method: "POST", body: input }),
  });
}

/** AI assist — POST /api/ai/suggest/price (strict { category, condition? }). */
export function useAiPriceSuggestion() {
  return useMutation({
    mutationFn: (input: { category: string; condition?: string }) =>
      request<{
        suggestion: { low: number; mid: number; high: number };
        basis: string;
        sampleSize: number;
        modelVersion: string;
        fallbackUsed: boolean;
        aiSuggestion: true;
      }>(`/api/ai/suggest/price`, { method: "POST", body: input }),
  });
}

// ── fulfilment / purchases (Post-Phase-9) ──────────────────────────────

export function useStartDelivery(offerId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: () =>
      request(`/api/transaction/fulfill/${offerId}/startDelivery`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fulfillmentKeys.detail(offerId) });
      toast({ tone: "success", title: "Delivery started — item is on its way to your room." });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Delivery start failed.";
      toast({ tone: "error", title: "Delivery start failed", body: msg });
    },
  });
}

/**
 * POST /api/transaction/fulfill/:offerId/buyerConfirm { received }
 *
 * The BUYER's receipt decision — the only thing that closes the order now.
 * `received: true` requires the seller's PIN/QR handover verification to have
 * succeeded and then runs the existing settlement path; `received: false`
 * changes nothing financial and points at the dispute flow. The server owns
 * all of that: this hook only reports what really happened.
 */
export function useConfirmReceipt(offerId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (received: boolean) =>
      request<{
        received: boolean;
        delivered: boolean;
        payout?: { status: string; reason?: string; payoutId?: string | null };
        message?: string;
      }>(`/api/transaction/fulfill/${offerId}/buyerConfirm`, {
        method: "POST",
        body: { received },
      }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: fulfillmentKeys.detail(offerId) });
      void qc.invalidateQueries({ queryKey: purchasesKeys.all });
      const paid = data?.payout?.status === "COMPLETED";
      if (data?.received) {
        toast({
          tone: paid ? "success" : "info",
          title: paid
            ? "ORDER DELIVERED — SELLER PAID"
            : "ORDER DELIVERED — PAYOUT PENDING",
          body: paid
            ? "Escrow released to the seller."
            : "Delivery is confirmed; the payout to the seller is still pending and will be retried.",
        });
      } else {
        toast({
          tone: "info",
          title: "RECEIPT NOT CONFIRMED",
          body: "The order stays open and the escrow stays locked. Raise a dispute if the item never arrives.",
          persistent: true,
        });
      }
    },
    onError: (err) =>
      toast({ tone: "error", title: "COULD NOT RECORD YOUR ANSWER", body: errMessage(err) }),
  });
}

/** PATCH /api/identity/users/me — the user's own profile fields (phone/UPI/room). */
export function useUpdateProfile() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (patch: {
      fullName?: string;
      roomNumber?: string;
      upiVpa?: string;
      phone?: string;
    }) => request(`/api/identity/users/me`, { method: "PATCH", body: patch }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["me", "profile"] });
      toast({ tone: "success", title: "PROFILE UPDATED" });
    },
    onError: (err) =>
      toast({ tone: "error", title: "COULD NOT UPDATE PROFILE", body: errMessage(err) }),
  });
}

export function useAcceptOffer() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (offerId: string) =>
      request(`/api/marketplace/offers/${offerId}/accept`, { method: "PATCH" }),
    onSuccess: (_data: unknown, offerId: string) => {
      void qc.invalidateQueries({ queryKey: ["offers", "listing", offerId] });
      void qc.invalidateQueries({ queryKey: ["offers", "mine"] });
      void qc.invalidateQueries({ queryKey: ["listings", "mine"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      toast({ tone: "success", title: "Offer accepted — the buyer will now receive the item." });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Offer acceptance failed.";
      toast({ tone: "error", title: "Offer acceptance failed", body: msg });
    },
  });
}
