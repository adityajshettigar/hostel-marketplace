"use client";

/**
 * One side of an order — name plus the delivery details the other party needs
 * to physically hand the item over. Rendered from the transaction record the
 * server returned, which only ever contains these values for a party of that
 * transaction (strangers get 404, so this can never leak a phone number).
 */
export function PartyDetails({
  label,
  name,
  hostelBlock,
  roomNumber,
  phone,
}: {
  label: string;
  name?: string | null;
  hostelBlock?: string | null;
  roomNumber?: string | null;
  phone?: string | null;
}) {
  return (
    <div className="border-2 border-black bg-white p-3 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-widest text-black/60">{label}</p>
      <p className="mt-1 text-sm font-black uppercase tracking-tight">{name ?? "—"}</p>
      <dl className="mt-1 space-y-0.5 text-xs font-medium text-black/70">
        <div className="flex gap-2">
          <dt className="font-bold uppercase tracking-wide">Hostel</dt>
          <dd>{hostelBlock ?? "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-bold uppercase tracking-wide">Room</dt>
          <dd>{roomNumber ?? "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-bold uppercase tracking-wide">Phone</dt>
          <dd>{phone ?? "Not provided"}</dd>
        </div>
      </dl>
    </div>
  );
}
