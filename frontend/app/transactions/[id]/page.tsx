"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { AlertTriangle, Lock, ShieldCheck } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Modal,
  Select,
  Skeleton,
  Stepper,
  Tabs,
  Textarea,
  VerifiedResidentBadge,
} from "@/components/ui";
import { RequireAuth } from "@/lib/auth/auth-context";
import { useAuth } from "@/lib/auth/auth-context";
import { useHandoverCredential, usePublicProfile, useTransaction } from "@/lib/api/queries";
import {
  useConfirmHandover,
  useInitEscrow,
  useRaiseDispute,
} from "@/lib/api/mutations";
import {
  disputeFormSchema,
  pinFormSchema,
  type DisputeFormInput,
  type PinFormInput,
} from "@/lib/schemas/forms";
import { MotifScatter } from "@/components/ui/hostel-motif";
import { PinInput } from "@/components/transactions/pin-input";
import { QrScanner } from "@/components/transactions/qr-scanner";
import { loadRazorpay, openRazorpayCheckout } from "@/lib/cloudinary";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import type { Transaction } from "@/lib/api/types";
import { DISPUTE_REASONS } from "@/lib/schemas/forms";

const FLOW: { id: Transaction["status"]; label: string }[] = [
  { id: "DEAL_CONFIRMED", label: "Deal confirmed" },
  { id: "ESCROW_PENDING", label: "Escrow initiated" },
  { id: "HANDOVER_PENDING", label: "Escrow funded" },
  { id: "HANDOVER_VERIFIED", label: "Handover verified" },
  { id: "COMPLETED", label: "Completed" },
];

const EXCEPTION_STATES: Transaction["status"][] = ["DISPUTED", "ADMIN_REVIEW", "FROZEN", "REFUNDED", "CANCELLED"];

function buildSteps(status: Transaction["status"]) {
  const idx = FLOW.findIndex((s) => s.id === status);
  if (idx >= 0) {
    return FLOW.map((s, i) => ({
      label: s.label,
      state: i < idx ? ("completed" as const) : i === idx ? ("current" as const) : ("upcoming" as const),
    }));
  }
  if (EXCEPTION_STATES.includes(status)) {
    const flowIdx = status === "DISPUTED" || status === "ADMIN_REVIEW" ? 2 : FLOW.length - 1;
    return FLOW.map((s, i) => ({
      label: s.label,
      state:
        i < flowIdx
          ? ("completed" as const)
          : i === flowIdx
            ? ("exception" as const)
            : ("upcoming" as const),
    })).concat([
      {
        label: status === "ADMIN_REVIEW" ? "Admin review" : status === "FROZEN" ? "Frozen" : status === "REFUNDED" ? "Refunded" : status === "CANCELLED" ? "Cancelled" : "Disputed",
        state: "exception" as const,
      },
    ]);
  }
  return FLOW.map((s, i) => ({ label: s.label, state: i === 0 ? ("current" as const) : ("upcoming" as const) }));
}

function PinBanner() {
  return (
    <section aria-label="PIN safety warning" className="relative overflow-hidden border-b-4 border-black bg-red-bauhaus text-white">
      <MotifScatter variant="transactions" />
      <div className="relative mx-auto flex max-w-7xl items-start gap-5 px-4 py-8 sm:px-6 lg:px-8">
        <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center border-4 border-black bg-white text-black">
          <AlertTriangle className="h-9 w-9" strokeWidth={3} />
        </span>
        <div>
          <h2 className="text-2xl font-black uppercase leading-[0.95] tracking-tighter sm:text-3xl">
            Do not share your PIN before receiving the item
          </h2>
          <p className="mt-2 max-w-2xl text-sm font-bold uppercase tracking-wide">
            The PIN releases the escrow. Sharing it early forfeits your protection — no
            legitimate buyer needs it before handover. Verify the item in person first.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Buyer-side handover credential (H1 closeout): fetches the buyer's PIN/QR
 * from GET /api/transaction/transactions/:id/handover-credential and renders
 * them. Only enabled while the transaction is HANDOVER_PENDING and unlocked —
 * the backend is the authority; this panel surfaces its states honestly.
 */
function BuyerCredentialPanel({ txn }: { txn: Transaction }) {
  const isHandoverPending = txn.status === "HANDOVER_PENDING";
  const cred = useHandoverCredential(txn.id, isHandoverPending);

  if (!isHandoverPending) {
    return (
      <div className="border-2 border-black bg-background p-4">
        <p className="text-xs font-bold uppercase tracking-widest">
          {txn.status === "COMPLETED" || txn.status === "HANDOVER_VERIFIED" ? "Handover completed" : "Handover not active"}
        </p>
        <p className="mt-2 text-sm font-medium leading-relaxed text-foreground/80">
          The handover credential is only available while escrow is funded and handover is pending.
        </p>
      </div>
    );
  }

  if (txn.handoverLocked) {
    return (
      <div className="border-2 border-black bg-background p-4">
        <p className="text-xs font-bold uppercase tracking-widest">Handover locked</p>
        <p className="mt-2 text-sm font-medium leading-relaxed text-foreground/80">
          Three wrong PIN attempts locked this handover. An administrator must unlock it before the sale can proceed.
        </p>
      </div>
    );
  }

  if (cred.isLoading) return <Skeleton className="h-32 w-full" />;

  if (cred.isError || !cred.data) {
    return (
      <div className="border-2 border-black bg-background p-4">
        <p className="text-xs font-bold uppercase tracking-widest">Waiting for the seller to verify handover</p>
        <p className="mt-2 text-sm font-medium leading-relaxed text-foreground/80">
          Your handover PIN/QR is not available right now (the handover window may have expired).
        </p>
        {txn.failedAttempts > 0 ? (
          <p className="mt-3 border-2 border-black bg-yellow-soft px-3 py-2 text-xs font-bold uppercase tracking-wide">
            Failed attempts: {txn.failedAttempts} of 3 — lockout at 3
          </p>
        ) : null}
      </div>
    );
  }

  const { pin, qr } = cred.data.credential;
  return (
    <div className="border-2 border-black bg-background p-4">
      <p className="text-xs font-bold uppercase tracking-widest">Your handover credential</p>
      <div className="mt-3 flex flex-wrap items-center gap-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">Show this PIN to the seller</p>
          <p
            aria-label="Your 4-digit handover PIN"
            className="mt-1 border-4 border-black bg-white px-6 py-3 text-4xl font-black tabular-nums tracking-[0.3em] shadow-md"
          >
            {pin}
          </p>
        </div>
        {qr ? <QrPayloadCard value={qr} /> : null}
      </div>
      <p className="mt-3 text-xs font-medium leading-relaxed text-foreground/80">
        Meet in the block, inspect the item, THEN show the PIN. Sharing it early forfeits your escrow protection.
      </p>
      {txn.failedAttempts > 0 ? (
        <p className="mt-3 border-2 border-black bg-yellow-soft px-3 py-2 text-xs font-bold uppercase tracking-wide">
          Failed attempts: {txn.failedAttempts} of 3 — lockout at 3
        </p>
      ) : null}
    </div>
  );
}

/**
 * The QR credential as its raw payload string. Honest limitation: this app
 * ships a QR DECODER (the seller's scanner), not an encoder, and adding a
 * QR-encoding dependency was out of scope for this pass — so the buyer sees
 * the exact payload string a QR image would encode (the seller's scanner
 * accepts this format when scanned from any QR generator). The PIN remains
 * the primary credential.
 */
function QrPayloadCard({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">
        QR payload — the string a QR image would encode
      </p>
      <code className="mt-1 block max-w-[22rem] break-all border-2 border-dashed border-black bg-white p-3 font-mono text-[10px] leading-relaxed">
        {value}
      </code>
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Copied" : "Copy payload"}
        </Button>
        <span className="text-[10px] font-medium text-foreground/60">
          Generate a QR image from it (any generator) for the seller to scan.
        </span>
      </div>
    </div>
  );
}

function HandoverPanel({ txn }: { txn: Transaction }) {
  const { user } = useAuth();
  const confirm = useConfirmHandover(txn.id);
  const [mode, setMode] = React.useState<"pin" | "qr">("pin");
  const [pin, setPin] = React.useState("");
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PinFormInput>({ resolver: zodResolver(pinFormSchema) });

  const isSeller = txn.sellerId === user?.id;

  const submitPin = handleSubmit(async () => {
    await confirm.mutateAsync({ pin });
  });

  if (!isSeller) {
    // Buyer: the actual handover credential (H1). PIN/QR submission is
    // seller-only per the backend; the buyer fetches THEIR PIN/QR from the
    // buyer-only credential route and shows it to the seller in person.
    return <BuyerCredentialPanel txn={txn} />;
  }

  return (
    <div>
      <Tabs
        tabs={[
          { id: "pin", label: "PIN" },
          { id: "qr", label: "QR" },
        ]}
        active={mode}
        onChange={setMode}
      />
      {txn.handoverLocked ? (
        <p role="alert" className="mt-4 border-2 border-black bg-red-bauhaus px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">
          Handover locked after 3 failed attempts — admin unlock required.
        </p>
      ) : null}
      {mode === "pin" ? (
        <form onSubmit={submitPin} className="mt-4 flex flex-col items-start gap-4">
          <PinInput value={pin} onChange={setPin} disabled={confirm.isPending} />
          {pin.length === 4 ? null : (
            <p className="text-xs font-medium text-foreground/60">Enter the 4-digit PIN the buyer shows you.</p>
          )}
          {errors.pin ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.pin.message}</p> : null}
          <Button type="submit" variant="primary" loading={confirm.isPending} disabled={pin.length !== 4} leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />}>
            Verify handover
          </Button>
        </form>
      ) : (
        <div className="mt-4">
          <QrScanner
            onScan={(code) => {
              void confirm.mutate({ qr: code });
            }}
            onError={() => undefined}
          />
        </div>
      )}
    </div>
  );
}

function DisputeForm({ txn }: { txn: Transaction }) {
  const raise = useRaiseDispute(txn.id);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pending, setPending] = React.useState<DisputeFormInput | null>(null);
  const [files, setFiles] = React.useState<string[]>([]);
  const [evidenceError, setEvidenceError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DisputeFormInput>({ resolver: zodResolver(disputeFormSchema), mode: "onBlur" });

  const onSubmit = handleSubmit((values) => {
    setPending(values);
    setConfirmOpen(true);
  });

  const confirmDispute = async () => {
    if (!pending) return;
    await raise.mutateAsync({ ...pending, evidence: files });
    setConfirmOpen(false);
  };

  const onFiles = async (list: FileList | null) => {
    setEvidenceError(null);
    if (!list?.length) return;
    if (files.length + list.length > 5) {
      setEvidenceError("AT MOST 5 EVIDENCE FILES");
      return;
    }
    const { uploadToCloudinary } = await import("@/lib/cloudinary");
    const urls: string[] = [];
    for (const f of Array.from(list)) {
      try {
        const res = await uploadToCloudinary(f);
        urls.push(res.secureUrl);
      } catch (err) {
        setEvidenceError(err instanceof Error ? err.message : "UPLOAD FAILED");
      }
    }
    setFiles((prev) => [...prev, ...urls].slice(0, 5));
  };

  return (
    <div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div>
          <Select label="Reason" defaultValue="" {...register("reason")}>
            <option value="" disabled>What went wrong?</option>
            {DISPUTE_REASONS.map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
            ))}
          </Select>
          {errors.reason ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.reason.message}</p> : null}
        </div>
        <div>
          <Textarea label="What happened" rows={4} {...register("description")} />
          {errors.description ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.description.message}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-widest">Evidence (photos, max 5)</label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => void onFiles(e.target.files)}
            className="w-full border-2 border-black bg-white p-2 text-sm shadow-sm"
            aria-label="Upload evidence files"
          />
          {files.length > 0 ? <p className="mt-1 text-xs font-bold uppercase tracking-wide">{files.length} file(s) attached</p> : null}
          {evidenceError ? <p role="alert" className="mt-1 text-xs font-bold uppercase text-red-bauhaus">{evidenceError}</p> : null}
          {errors.evidence ? <p role="alert" className="mt-1 text-xs font-bold uppercase text-red-bauhaus">{errors.evidence.message}</p> : null}
        </div>
        <Button type="submit" variant="primary">File dispute</Button>
      </form>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm dispute"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={raise.isPending} onClick={() => void confirmDispute()}>Freeze escrow</Button>
          </div>
        }
      >
        <p className="font-medium leading-relaxed">
          Disputing freezes the escrow immediately: the auto-release is cancelled and an
          admin reviews the evidence. Only the buyer can raise a dispute, and it should be a
          last resort — try chat first.
        </p>
      </Modal>
    </div>
  );
}

function TransactionInner() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useTransaction(id);
  const initEscrow = useInitEscrow(id);
  const [escrowError, setEscrowError] = React.useState<string | null>(null);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <Skeleton className="h-24 w-full" />
        <div className="mt-6 grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <EmptyState
          title="Transaction not found"
          body="You may not be a party to this deal."
          action={<Button variant="outline" onClick={() => void refetch()}>Retry</Button>}
        />
      </main>
    );
  }

  const txn: Transaction = data.transaction;
  const isSeller = txn.sellerId === user?.id;
  const counterpartyId = isSeller ? txn.buyerId : txn.sellerId;
  const { data: profile } = usePublicProfile(counterpartyId);
  const showPinBanner = isSeller && txn.status === "HANDOVER_PENDING";
  const canFund = txn.status === "DEAL_CONFIRMED";

  const fundEscrow = async () => {
    setEscrowError(null);
    try {
      const ok = await loadRazorpay();
      if (!ok) throw new Error("RAZORPAY CHECKOUT FAILED TO LOAD");
      const res = await initEscrow.mutateAsync();
      await openRazorpayCheckout({
        orderId: res.razorpayOrder.id,
        amount: res.razorpayOrder.amount / 100,
        keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? "",
        prefill: { name: user?.fullName, email: user?.email },
      });
      void refetch();
    } catch (err) {
      setEscrowError(err instanceof Error ? err.message : "PAYMENT COULD NOT START");
    }
  };

  return (
    <main id="main">
      {showPinBanner ? <PinBanner /> : null}

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-xs font-bold uppercase tracking-widest">
          <Link href="/dashboard" className="underline decoration-2 underline-offset-4 hover:text-red-bauhaus">Dashboard</Link>
          <span aria-hidden="true" className="mx-2">/</span>
          <span>Transaction</span>
        </nav>

        <div className="border-4 border-black bg-surface shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b-4 border-black p-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-foreground/60">Transaction</p>
              <p className="font-mono text-lg font-black tabular-nums">{txn.id.slice(0, 8).toUpperCase()}</p>
            </div>
            <p className="bg-yellow-bauhaus px-4 py-2 text-3xl font-black tabular-nums tracking-tight">
              {formatCurrency(txn.amountPaise / 100)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-b-4 border-black p-6">
            <VerifiedResidentBadge
              block={profile?.hostelBlock ?? null}
              room={profile?.roomNumber ?? null}
              verified={profile?.verificationStatus === "VERIFIED"}
            />
            <span className="text-sm font-bold uppercase tracking-wide">{profile?.fullName ?? "Counterparty"}</span>
            <Badge tone={isSeller ? "blue" : "red"}>{isSeller ? "You are the seller" : "You are the buyer"}</Badge>
            {txn.releaseDeadline ? (
              <span className="text-xs font-bold uppercase tracking-widest text-foreground/60">
                Auto-release {formatDateTime(txn.releaseDeadline)}
              </span>
            ) : null}
          </div>
          <div className="p-6">
            <Stepper steps={buildSteps(txn.status)} />
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            {canFund ? (
              <Card>
                <CardHeader>
                  <CardTitle>Fund escrow</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="font-medium leading-relaxed">
                    Your money is held by Razorpay until the handover PIN is verified. It
                    never touches the seller directly.
                  </p>
                  <Button variant="primary" size="lg" loading={initEscrow.isPending} onClick={() => void fundEscrow()}>
                    Fund escrow — {formatCurrency(txn.amountPaise / 100)}
                  </Button>
                  {escrowError ? (
                    <p role="alert" className="border-2 border-black bg-red-bauhaus px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">
                      {escrowError}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {txn.status === "HANDOVER_PENDING" ? (
              <Card>
                <CardHeader>
                  <CardTitle>Verify handover</CardTitle>
                </CardHeader>
                <CardContent>
                  <HandoverPanel txn={txn} />
                </CardContent>
              </Card>
            ) : null}

            {txn.status === "COMPLETED" ? (
              <Card>
                <CardContent className="flex items-center gap-4">
                  <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-black bg-yellow-bauhaus">
                    <ShieldCheck className="h-6 w-6" strokeWidth={3} />
                  </span>
                  <div>
                    <p className="text-lg font-black uppercase tracking-tight">Deal complete</p>
                    <p className="text-sm font-medium text-foreground/70">The seller has been paid out. Thanks for keeping it on-platform.</p>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <aside className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Details</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm font-medium">
                <p className="flex justify-between"><span className="uppercase tracking-wide text-foreground/60">Created</span><span>{formatDate(txn.createdAt ?? "")}</span></p>
                <p className="flex justify-between"><span className="uppercase tracking-wide text-foreground/60">Quantity</span><span className="tabular-nums">{txn.quantity}</span></p>
                <p className="flex justify-between"><span className="uppercase tracking-wide text-foreground/60">Attempts used</span><span className="tabular-nums">{txn.failedAttempts}/3</span></p>
                <p className="flex justify-between"><span className="uppercase tracking-wide text-foreground/60">Escrow order</span><span className="truncate font-mono text-xs">{txn.razorpayOrderId ?? "—"}</span></p>
              </CardContent>
            </Card>

            {!EXCEPTION_STATES.includes(txn.status) && txn.status !== "COMPLETED" ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Something wrong?</CardTitle>
                </CardHeader>
                <CardContent>
                  <DisputeForm txn={txn} />
                </CardContent>
              </Card>
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}

export default function TransactionPage() {
  return (
    <RequireAuth>
      <TransactionInner />
    </RequireAuth>
  );
}
