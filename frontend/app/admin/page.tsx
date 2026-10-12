"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Gavel, ScrollText, ShieldAlert, Users, ArrowRight } from "lucide-react";
import { MotifScatter } from "@/components/ui/hostel-motif";
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
  Tabs,
  Textarea,
} from "@/components/ui";
import { RequireAuth, useAuth } from "@/lib/auth/auth-context";
import { useAuditLog, useDisputes } from "@/lib/api/queries";
import { useResolveDispute } from "@/lib/api/mutations";
import {
  resolveDisputeFormSchema,
  type ResolveDisputeFormInput,
} from "@/lib/schemas/forms";
import { z } from "zod";
import { formatCurrency, formatDateTime } from "@/lib/utils";

type AdminTab = "disputes" | "audit";

// Below this paise amount a single admin may resolve; above it the backend
// demands secondAdminToken ("admin:<userId>") from a DIFFERENT admin.
const DUAL_AUTH_THRESHOLD_PAISE = 50_000_00;

function AdminGate({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();
  if (status !== "authenticated") {
    return <RequireAuth>{null}</RequireAuth>;
  }
  if (user?.role !== "admin") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <EmptyState
          title="403 — Admins only"
          body="This console requires an administrator account. If you believe this is wrong, log in with the admin credentials."
        />
      </main>
    );
  }
  return <>{children}</>;
}

function ResolveModal({
  disputeId,
  amountPaise,
  lockId = false,
  onClose,
}: {
  disputeId: string;
  amountPaise: number;
  /** True when opened as "resolve by id" (the disputes queue endpoint is unavailable). */
  lockId?: boolean;
  onClose: () => void;
}) {
  const resolve = useResolveDispute();
  const needsDual = amountPaise > DUAL_AUTH_THRESHOLD_PAISE;
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResolveDisputeFormInput & { disputeIdInput?: string }>({
    resolver: zodResolver(resolveDisputeFormSchema.extend({ disputeIdInput: z.string().optional() })),
    mode: "onBlur",
    defaultValues: { secondAdminToken: "", disputeIdInput: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    const id = lockId ? values.disputeIdInput?.trim() : disputeId;
    if (!id) return;
    await resolve.mutateAsync({ ...values, disputeId: id });
    onClose();
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Resolve dispute"
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={resolve.isPending} onClick={() => void onSubmit()}>Submit resolution</Button>
        </div>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {needsDual ? (
          <p role="alert" className="border-2 border-black bg-yellow-soft px-3 py-2 text-xs font-bold uppercase tracking-widest">
            Amount exceeds the dual-authorization threshold — a second admin token is required.
          </p>
        ) : null}
        {!lockId ? null : (
          <Input label="Dispute id" placeholder="00000000-0000-0000-0000-000000000000" {...register("disputeIdInput")} />
        )}
        <Select label="Resolution" defaultValue="" {...register("resolution")}>
          <option value="" disabled>Release or refund?</option>
          <option value="COMPLETED">RELEASE — complete the sale, pay the seller</option>
          <option value="REFUNDED">REFUND — return the money to the buyer</option>
        </Select>
        {errors.resolution ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.resolution.message}</p> : null}
        <Textarea label="Note for the audit log" rows={3} {...register("note")} />
        {errors.note ? <p role="alert" className="text-xs font-bold uppercase text-red-bauhaus">{errors.note.message}</p> : null}
        {needsDual ? (
          <Input label="Second admin token (admin:<userId>)" placeholder="admin:00000000-0000-0000-0000-000000000000" {...register("secondAdminToken")} />
        ) : null}
      </form>
    </Modal>
  );
}

function DisputesPanel() {
  const { data, isLoading, isError } = useDisputes();
  const [active, setActive] = React.useState<{ id: string; amountPaise: number } | null>(null);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  // H3: real admin disputes list (GET /api/transaction/disputes).
  const rows = data?.disputes ?? [];

  if (isError || rows.length === 0) {
    return (
      <EmptyState
        title={isError ? "Disputes queue unavailable" : "No open disputes"}
        body={
          isError
            ? "The disputes list endpoint did not answer. You can still resolve by dispute id."
            : "The queue is clear. Long may it last."
        }
        action={
          <Button size="sm" variant="outline" onClick={() => setActive({ id: "", amountPaise: 0 })}>
            Resolve by dispute id
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((d) => {
        const id = d.id;
        const status = d.status;
        const reason = d.reason;
        const amount = d.amountPaise;
        return (
          <div key={id} className="flex flex-wrap items-center justify-between gap-3 border-2 border-black bg-white p-4 shadow-sm">
            <div className="min-w-0">
              <p className="font-mono text-sm font-black tabular-nums">{id.slice(0, 8).toUpperCase()}</p>
              <p className="truncate text-sm font-medium text-foreground/80">{reason.slice(0, 120)}</p>
            </div>
            <div className="flex items-center gap-3">
              {amount ? <span className="font-black tabular-nums">{formatCurrency(amount / 100)}</span> : null}
              <Badge tone={status === "DISPUTED" ? "red" : status === "ADMIN_REVIEW" ? "yellow" : "black"}>{status}</Badge>
              <Button size="sm" variant="secondary" onClick={() => setActive({ id, amountPaise: amount })}>
                Review
              </Button>
            </div>
          </div>
        );
      })}
      {active ? (
        <ResolveModal
          disputeId={active.id}
          amountPaise={active.amountPaise}
          lockId={isError}
          onClose={() => setActive(null)}
        />
      ) : null}
    </div>
  );
}

function AuditPanel() {
  const { data, isLoading, isError } = useAuditLog(true);
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  // H3: real admin audit list (GET /api/transaction/audit).
  const rows = data?.audit ?? [];

  if (isError || rows.length === 0) {
    return (
      <EmptyState
        title={isError ? "Audit endpoint unavailable" : "No audit entries"}
        body={
          isError
            ? "The audit list endpoint did not answer. Every action stays recorded insert-only in the transaction DB."
            : "Actions on transactions land here, insert-only."
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.id} className="border-2 border-black bg-white p-3 shadow-sm odd:bg-background">
          <p className="font-mono text-xs font-bold tabular-nums">
            {r.createdAt} · {r.action} · {(r.actorId ?? "system").slice(0, 8)}
          </p>
          {Object.keys(r.detail).length > 0 ? (
            <p className="mt-1 truncate font-mono text-xs text-foreground/70">{JSON.stringify(r.detail)}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AdminConsole() {
  const [tab, setTab] = React.useState<AdminTab>("disputes");

  return (
    <div className="min-h-[60vh] bg-foreground">
      <div className="relative overflow-hidden border-b-4 border-black bg-foreground text-white">
        <MotifScatter variant="admin" tone="white" className="hidden sm:block" />
        <div className="relative mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-8 sm:px-6 lg:px-8">
          <ShieldAlert className="h-10 w-10" strokeWidth={3} aria-hidden="true" />
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-widest text-white/70">Restricted area</p>
            <h1 className="text-3xl font-black uppercase tracking-tighter sm:text-4xl">Admin console</h1>
          </div>
          <Link href="/admin/userbase">
            <Button variant="secondary" size="sm" leftIcon={<Users className="h-4 w-4" aria-hidden="true" />}>
              userbase
            </Button>
          </Link>
          <span className="border-2 border-black bg-yellow-bauhaus px-3 py-1 text-xs font-black uppercase tracking-widest text-black">
            Frozen escrows: see disputes
          </span>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <Tabs<AdminTab>
          tabs={[
            { id: "disputes", label: "Disputes" },
            { id: "audit", label: "Audit log" },
          ]}
          active={tab}
          onChange={setTab}
          className="bg-white p-1"
        />
        <div className="mt-6 bg-background p-4 sm:p-6">
          {tab === "disputes" ? <DisputesPanel /> : <AuditPanel />}
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Gavel className="h-5 w-5" aria-hidden="true" /> Freeze policy</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium leading-relaxed">
                Freezing happens automatically when a dispute is filed; the auto-release job is
                cancelled at once. Unfreezing requires resolution — release or refund — and
                amounts above the threshold demand a second administrator.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><ScrollText className="h-5 w-5" aria-hidden="true" /> Audit trail</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium leading-relaxed">
                Every handover attempt, dispute action and resolution is written insert-only
                to the audit table with its actor and payload.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <main id="main">
      <AdminGate>
        <MarketGridButton />
        <AdminConsole />
      </AdminGate>
    </main>
  );
}

function MarketGridButton() {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t-4 border-black pt-4">
      <Link
        href="/"
        className="inline-flex items-center gap-2 border-2 border-black bg-white px-4 py-2 text-sm font-bold uppercase tracking-widest shadow-sm transition-transform duration-200 hover:-translate-y-0.5"
      >
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
        View Market Grid
      </Link>
      <span className="border-2 border-black px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-background">
        Market
      </span>
    </div>
  );
}
