"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  ArrowRight,
  CheckCircle2,
  MessageSquare,
  Package,
  ShieldCheck,
  Tag,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Skeleton,
  Textarea,
  VerifiedResidentBadge,
} from "@/components/ui";
import { ListingCard } from "@/components/listings/listing-card";
import { ApiError } from "@/lib/api/client";
import { useAuth, RequireAuth } from "@/lib/auth/auth-context";
import { useListing, useListingOffers, usePublicProfile, useListings } from "@/lib/api/queries";
import {
  useMakeOffer,
  useRespondToOffer,
  useStartConversation,
  useCreateTransaction,
} from "@/lib/api/mutations";
import { offerFormSchema, type OfferFormInput } from "@/lib/schemas/forms";
import { ageLabel, formatCurrency, formatDate } from "@/lib/utils";
import type { PublicProfile } from "@/lib/api/types";

function SellerBadge({ sellerId }: { sellerId: string }) {
  const { data } = usePublicProfile(sellerId);
  const profile = data as PublicProfile | undefined;
  return (
    <VerifiedResidentBadge
      block={profile?.hostelBlock ?? null}
      room={profile?.roomNumber ?? null}
      verified={profile?.verificationStatus === "VERIFIED"}
    />
  );
}

function OfferForm({ listingId, price }: { listingId: string; price: string }) {
  const { user, status } = useAuth();
  const makeOffer = useMakeOffer(listingId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<OfferFormInput>({ resolver: zodResolver(offerFormSchema), mode: "onBlur" });

  if (status === "unauthenticated") {
    return (
      <div className="border-2 border-black bg-background p-4">
        <p className="text-sm font-bold uppercase tracking-wide">Log in to make an offer</p>
        <Link href={`/login?next=${encodeURIComponent(`/listings/${listingId}`)}`}>
          <Button variant="secondary" className="mt-3 w-full">
            Log in
          </Button>
        </Link>
      </div>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    await makeOffer.mutateAsync(values);
    reset();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <Input
        label="Your offer (₹)"
        type="number"
        min="1"
        step="1"
        placeholder={price.split(".")[0]}
        {...register("amount")}
      />
      {errors.amount ? (
        <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.amount.message}</p>
      ) : null}
      <Button type="submit" variant="primary" loading={makeOffer.isPending}>
        Make offer
      </Button>
    </form>
  );
}

function StartChat({ listingId, disabled }: { listingId: string; disabled?: boolean }) {
  const start = useStartConversation();
  const [error, setError] = React.useState<string | null>(null);

  const go = async () => {
    setError(null);
    try {
      const res = await start.mutateAsync(listingId);
      window.location.href = `/chat/${res.conversation.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message.toUpperCase() : "COULD NOT START CHAT");
    }
  };

  return (
    <div>
      <Button variant="outline" className="w-full" disabled={disabled} loading={start.isPending} onClick={() => void go()} leftIcon={<MessageSquare className="h-4 w-4" aria-hidden="true" />}>
        Message seller
      </Button>
      {error ? <p role="alert" className="mt-2 text-xs font-bold uppercase text-red-bauhaus">{error}</p> : null}
    </div>
  );
}

function SellerControls({ listingId }: { listingId: string }) {
  const { data } = useListingOffers(listingId);
  const respond = useRespondToOffer();
  const createTx = useCreateTransaction();
  const offers = (data?.offers ?? []).filter((o) => o.status === "PENDING");
  const accepted = (data?.offers ?? []).find((o) => o.status === "ACCEPTED");

  return (
    <div className="flex flex-col gap-4">
      <p className="border-2 border-black bg-yellow-bauhaus px-3 py-2 text-xs font-bold uppercase tracking-widest">
        This is your listing
      </p>
      {offers.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-widest">Pending offers</p>
          {offers.map((o) => (
            <div key={o.id} className="flex items-center justify-between border-2 border-black bg-white p-3 shadow-sm">
              <span className="font-black tabular-nums">{formatCurrency(o.offeredPrice)}</span>
              <span className="flex gap-2">
                <Button size="sm" variant="primary" loading={respond.isPending} onClick={() => respond.mutate({ offerId: o.id, action: "accept" })}>
                  Accept
                </Button>
                <Button size="sm" variant="outline" loading={respond.isPending} onClick={() => respond.mutate({ offerId: o.id, action: "reject" })}>
                  Reject
                </Button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm font-medium text-foreground/70">No pending offers yet.</p>
      )}
      {accepted ? (
        <div className="border-2 border-black bg-background p-3">
          <p className="text-xs font-bold uppercase tracking-widest">Accepted offer</p>
          <p className="mt-1 font-black tabular-nums">{formatCurrency(accepted.offeredPrice)}</p>
          <Button
            className="mt-3 w-full"
            variant="secondary"
            loading={createTx.isPending}
            onClick={() => createTx.mutate(accepted.id)}
            leftIcon={<Package className="h-4 w-4" aria-hidden="true" />}
          >
            Confirm deal → escrow
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TrustBand() {
  return (
    <section aria-label="Trust and safety" className="border-y-4 border-black bg-red-bauhaus text-white">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-3 lg:px-8">
        {[
          { icon: <ShieldCheck className="h-6 w-6" strokeWidth={3} aria-hidden="true" />, text: "Every seller is a verified hostel resident." },
          { icon: <CheckCircle2 className="h-6 w-6" strokeWidth={3} aria-hidden="true" />, text: "Money sits in escrow until the PIN confirms handover." },
          { icon: <Tag className="h-6 w-6" strokeWidth={3} aria-hidden="true" />, text: "Meet in the block. Pay through escrow. Never in advance." },
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-4">
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-4 border-black bg-yellow-bauhaus text-black">
              {item.icon}
            </span>
            <p className="pt-1 text-sm font-bold uppercase leading-snug tracking-wide">{item.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Gated: a pasted listing URL is a protected route, not a public page. */
export default function ListingDetailPage() {
  return (
    <RequireAuth>
      <ListingDetailInner />
    </RequireAuth>
  );
}

function ListingDetailInner() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useAuth();
  const { data, error, isLoading, isError, refetch } = useListing(id);
  // Declared BEFORE the early returns: a hook may not be called after a
  // conditional return, or the loading→loaded render switch adds a hook and
  // React bails out with "rendered more hooks than during the previous render".
  const [activeImage, setActiveImage] = React.useState(0);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <Skeleton className="aspect-[4/3] w-full" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </main>
    );
  }

  if (isError || !data?.listing) {
    // Only a genuine 404 is "not found". A permission problem, a timeout or a
    // service error must say so and offer the right next step, never claim the
    // listing does not exist.
    const status = error instanceof ApiError ? error.status : 0;

    // 400 = the id in the URL is not a listing id at all; 404 = it is, but the
    // listing is gone or not visible to this caller. Both mean "this link does
    // not resolve", so they share the same state.
    if (status === 404 || status === 400) {
      return (
        <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <EmptyState
            title="Listing not found"
            body="It may have been sold, removed, or the link is wrong."
            action={
              <Link href="/">
                <Button variant="outline" rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
                  Back to market
                </Button>
              </Link>
            }
          />
        </main>
      );
    }

    if (status === 401 || status === 403) {
      return (
        <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <EmptyState
            title="This listing is not available to you"
            body="It belongs to a hostel market your account does not have access to."
            action={
              <Link href="/">
                <Button variant="outline" rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
                  Back to market
                </Button>
              </Link>
            }
          />
        </main>
      );
    }

    return (
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <EmptyState
          title="Could not load this listing"
          body="The service did not answer in time. Your connection is fine — try again."
          action={
            <Button variant="primary" onClick={() => void refetch()} rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
              Try again
            </Button>
          }
        />
      </main>
    );
  }

  const listing = data.listing;
  const isSeller = user?.id === listing.sellerId;
  const days = Math.max(0, Math.round((Date.now() - new Date(listing.createdAt).getTime()) / 86_400_000));
  const active = listing.images.filter(Boolean);

  return (
    <main id="main">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-xs font-bold uppercase tracking-widest">
          <Link href="/" className="underline decoration-2 underline-offset-4 hover:text-red-bauhaus">
            Market
          </Link>
          <span aria-hidden="true" className="mx-2">/</span>
          <span>{listing.category}</span>
        </nav>

        <div className="grid gap-10 lg:grid-cols-3">
          {/* Gallery + description */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            <div className="border-4 border-black bg-surface shadow-xl">
              <div className="aspect-[4/3] border-b-4 border-black bg-muted">
                {active[activeImage] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={active[activeImage]} alt={listing.title} className="h-full w-full object-cover" />
                ) : (
                  <div aria-hidden="true" className="flex h-full items-center justify-center">
                    <span className="shape-triangle h-24 w-24 bg-blue-bauhaus" />
                  </div>
                )}
              </div>
              {active.length > 1 ? (
                <div className="flex gap-3 overflow-x-auto p-3">
                  {active.map((src, i) => (
                    <button
                      key={src + i}
                      type="button"
                      onClick={() => setActiveImage(i)}
                      aria-label={`Image ${i + 1} of ${active.length}`}
                      aria-pressed={i === activeImage}
                      className={`h-20 w-20 shrink-0 border-2 ${i === activeImage ? "border-blue-bauhaus" : "border-black"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-foreground/60">
                {listing.category} · {listing.condition} · {listing.quantity} available · listed{" "}
                {formatDate(listing.createdAt)} ({ageLabel(days)})
              </p>
              <h1 className="mt-2 text-3xl font-black uppercase leading-[0.95] tracking-tighter sm:text-4xl">
                {listing.title}
              </h1>
              <div className="mt-3">
                <SellerBadge sellerId={listing.sellerId} />
              </div>
              {listing.description ? (
                <p className="mt-6 max-w-2xl whitespace-pre-line text-base font-medium leading-relaxed">
                  {listing.description}
                </p>
              ) : (
                <p className="mt-6 text-sm font-medium uppercase tracking-wide text-foreground/60">
                  No description provided.
                </p>
              )}
            </div>
          </div>

          {/* Sticky purchase panel */}
          <aside>
            <Card className="sticky top-24 shadow-xl">
              <CardHeader>
                <p className="bg-yellow-bauhaus px-3 py-2 text-3xl font-black tabular-nums tracking-tight">
                  {formatCurrency(listing.price)}
                </p>
                <CardTitle className="mt-3 text-xl">Deal with {isSeller ? "your buyer" : "the seller"}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {isSeller ? (
                  <SellerControls listingId={listing.id} />
                ) : (
                  <>
                    <OfferForm listingId={listing.id} price={listing.price} />
                    <StartChat listingId={listing.id} />
                  </>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>

      <TrustBand />
    </main>
  );
}
