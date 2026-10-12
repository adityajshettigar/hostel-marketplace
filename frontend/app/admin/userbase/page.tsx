"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import { MotifScatter } from "@/components/ui/hostel-motif";
import { Badge, Button, EmptyState, Skeleton } from "@/components/ui";
import { RequireAuth, useAuth } from "@/lib/auth/auth-context";
import { useUserbase } from "@/lib/api/queries";
import { useChangeUserRole } from "@/lib/api/mutations";
import { formatDateTime } from "@/lib/utils";

// Same admin gate as the admin console: authenticated + signed admin claim.
function UserbaseGate({ children }: { children: React.ReactNode }) {
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

function UserbaseList() {
  const { user } = useAuth();
  const { data, isLoading, isError } = useUserbase();
  const changeRole = useChangeUserRole();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const rows = data?.users ?? [];
  if (isError || rows.length === 0) {
    return (
      <EmptyState
        title={isError ? "Userbase unavailable" : "No accounts yet"}
        body={
          isError
            ? "The user list endpoint did not answer. Roles can only be changed once this list loads."
            : "Accounts appear here the first time their owner logs in."
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((u) => {
        const isSelf = u.id === user?.id;
        const promoting = u.role === "user";
        const pendingThisRow =
          changeRole.isPending && changeRole.variables?.userId === u.id;
        // Backend forbids self-demotion (it would lock the last admin out).
        const selfLocked = isSelf && !promoting;
        return (
          <div
            key={u.id}
            className="flex flex-wrap items-center justify-between gap-3 border-2 border-black bg-white p-4 shadow-sm odd:bg-background"
          >
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-black">{u.email}</p>
              <p className="mt-1 truncate text-xs font-medium text-foreground/70">
                {u.fullName} · {u.hostelBlock ? `Hostel ${u.hostelBlock}` : "No hostel"} ·
                Last login: {formatDateTime(u.lastLoginAt)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Role mention + the toggle right beside it. */}
              <Badge tone={u.role === "admin" ? "red" : "white"}>{u.role}</Badge>
              <Button
                size="sm"
                variant={promoting ? "secondary" : "outline"}
                loading={pendingThisRow}
                disabled={selfLocked}
                title={selfLocked ? "You cannot demote your own admin account" : undefined}
                onClick={() =>
                  changeRole.mutate({ userId: u.id, role: promoting ? "admin" : "user" })
                }
              >
                {promoting ? "Make admin" : "Make user"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UserbaseView() {
  const { data } = useUserbase();
  const count = data?.users.length;

  return (
    <div className="min-h-[60vh] bg-foreground">
      <div className="relative overflow-hidden border-b-4 border-black bg-foreground text-white">
        <MotifScatter variant="admin" tone="white" className="hidden sm:block" />
        <div className="relative mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-8 sm:px-6 lg:px-8">
          <Users className="h-10 w-10" strokeWidth={3} aria-hidden="true" />
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-widest text-white/70">
              Restricted area
            </p>
            <h1 className="text-3xl font-black uppercase tracking-tighter sm:text-4xl">
              Userbase
            </h1>
          </div>
          <span className="border-2 border-black bg-yellow-bauhaus px-3 py-1 text-xs font-black uppercase tracking-widest text-black">
            {typeof count === "number" ? `${count} account${count === 1 ? "" : "s"}` : "Roles: user / admin"}
          </span>
          <Link href="/admin">
            <Button variant="outline" size="sm" leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}>
              Back to console
            </Button>
          </Link>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="bg-background p-4 sm:p-6">
          <UserbaseList />
        </div>
      </div>
    </div>
  );
}

export default function UserbasePage() {
  return (
    <main id="main">
      <UserbaseGate>
        <UserbaseView />
      </UserbaseGate>
    </main>
  );
}
