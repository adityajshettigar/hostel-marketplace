"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { RequireAuth } from "@/lib/auth/auth_context";
import { usePurchaseDetail } from "@/lib/api/queries";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { OrderDetailDialog } from "@/components/orders/order-detail-dialog";

/**
 * Deep-linkable order view. It renders the SAME dialog the Purchases list
 * opens (one implementation of the timeline/actions), so a shared link and an
 * in-app click can never disagree about an order's state.
 */
export default function PurchaseDetailPage() {
  return (
    <RequireAuth>
      <PurchaseDetailInner />
    </RequireAuth>
  );
}

function PurchaseDetailInner() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string | undefined;
  const { data, isLoading, isError } = usePurchaseDetail(id ?? "");

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  if (isError || !data?.purchase) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <EmptyState
          title="Transaction not found"
          body="This order may have been removed, or it does not belong to your account."
          action={
            <Link href="/purchases">
              <Button variant="primary">Back to purchases</Button>
            </Link>
          }
        />
      </main>
    );
  }

  return (
    <main id="main">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <Link
          href="/purchases"
          className="text-sm font-bold uppercase tracking-widest underline decoration-2 underline-offset-4 hover:text-yellow-bauhaus"
        >
          ← Back to purchases
        </Link>
        <OrderDetailDialog
          open
          onClose={() => router.push("/purchases")}
          transactionId={data.purchase.id}
          offerId={data.purchase.offerId}
        />
      </div>
    </main>
  );
}
