"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Receipt, Pencil } from "lucide-react";
import { Button, Input, Modal, Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth/auth-context";
import { useMyProfile } from "@/lib/api/queries";
import { useUpdateProfile } from "@/lib/api/mutations";
import { hostelGroup } from "@/lib/api/types";

/**
 * Profile — the logged-in user's OWN record, read from identity-service
 * (/api/identity/users/me) rather than from the UI or the JWT. Everything here
 * is private: name, college email, phone, hostel group/block, room and UPI.
 * Phone and UPI can be supplied/edited in place; a phone number is required for
 * the physical handover, so a missing one is called out.
 *
 * The Purchases shortcut opens the same page as the top-right Purchases button
 * — there is only one purchase history.
 */
export function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const profile = useMyProfile(open);
  const update = useUpdateProfile();
  const [editing, setEditing] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [upiVpa, setUpiVpa] = React.useState("");

  const raw = profile.data;
  const phoneValue = raw?.phone ?? user?.phone ?? null;
  const upiValue = raw?.upi_vpa ?? user?.upiVpa ?? null;
  const block = raw?.hostel_block ?? user?.hostelBlock ?? null;
  const group = raw?.hostel_group ?? user?.hostelGroup ?? hostelGroup(block);

  React.useEffect(() => {
    if (!open) {
      setEditing(false);
      return;
    }
    setPhone(raw?.phone ?? user?.phone ?? "");
    setUpiVpa(raw?.upi_vpa ?? user?.upiVpa ?? "");
  }, [open, raw?.phone, raw?.upi_vpa, user?.phone, user?.upiVpa]);

  const rows: { label: string; value: string }[] = [
    { label: "Name", value: raw?.full_name ?? user?.fullName ?? "—" },
    { label: "College email", value: raw?.email ?? user?.email ?? "—" },
    { label: "Phone", value: phoneValue ?? "Not provided" },
    { label: "Hostel type", value: group ? `${group} (${group === "LH" ? "Ladies'" : "Men's"})` : "—" },
    { label: "Hostel block", value: block ?? "—" },
    { label: "Room number", value: (raw?.room_number ?? user?.roomNumber) ?? "—" },
    { label: "UPI details", value: upiValue ?? "Not provided" },
  ];

  return (
    <Modal open={open} onClose={onClose} title="My profile">
      {profile.isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <>
          {profile.isError ? (
            <p role="alert" className="mb-3 border-2 border-black bg-yellow-soft px-3 py-2 text-xs font-bold uppercase tracking-wide">
              Could not refresh your record — showing the session copy.
            </p>
          ) : null}

          <dl className="divide-y-2 divide-black/10">
            {rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-[10px] font-black uppercase tracking-widest text-black/60">
                  {r.label}
                </dt>
                <dd className="text-right text-sm font-bold">{r.value}</dd>
              </div>
            ))}
          </dl>

          {!phoneValue ? (
            <p role="alert" className="mt-4 border-2 border-black bg-yellow-soft px-3 py-2 text-xs font-bold uppercase tracking-wide">
              Add a phone number — the seller needs it to bring your order to your room.
            </p>
          ) : null}

          {editing ? (
            <div className="mt-4 flex flex-col gap-3 border-t-4 border-black pt-4">
              <Input
                label="Phone number"
                placeholder="9876543210"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <Input
                label="UPI ID"
                placeholder="name@bank"
                value={upiVpa}
                onChange={(e) => setUpiVpa(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={update.isPending}
                  onClick={() =>
                    update.mutate(
                      { phone, upiVpa },
                      { onSuccess: () => setEditing(false) },
                    )
                  }
                >
                  Save
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              leftIcon={<Pencil className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setEditing(true)}
            >
              Edit phone / UPI
            </Button>
          )}

          {/* PURCHASES SHORTCUT — same page as the top-right Purchases button */}
          <div className="mt-5 border-t-4 border-black pt-4">
            <Button
              variant="primary"
              className="w-full"
              leftIcon={<Receipt className="h-4 w-4" aria-hidden="true" />}
              onClick={() => {
                onClose();
                router.push("/purchases");
              }}
            >
              Purchases
            </Button>
            <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-widest text-black/60">
              Today&apos;s orders, and the full history
            </p>
          </div>
        </>
      )}
    </Modal>
  );
}
