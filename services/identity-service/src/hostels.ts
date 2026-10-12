// ---------------------------------------------------------------------------
// Hostel allow-list (feature: MH = men's hostel, LH = ladies' hostel).
// Registration may only pick one of these; the group (MH|LH) is derived from
// the prefix and is what marketplace-service enforces for trade segregation.
// ---------------------------------------------------------------------------

export const HOSTELS = [
  'MH-1', 'MH-2', 'MH-3', 'MH-4', 'MH-5', 'MH-6', 'MH-7', // men's hostels
  'LH-1', 'LH-2', 'LH-3', // ladies' hostels
] as const;

export type Hostel = (typeof HOSTELS)[number];
export type HostelGroup = 'MH' | 'LH';

export function isHostel(value: string): value is Hostel {
  return (HOSTELS as readonly string[]).includes(value);
}

/**
 * Group of a hostel block. Anything not prefixed LH (including legacy values
 * such as 'A', 'MH-A') belongs to the men's side — legacy accounts keep
 * seeing the pre-segregation data instead of silently losing the market.
 */
export function hostelGroup(block: string | null | undefined): HostelGroup {
  return block && block.toUpperCase().startsWith('LH') ? 'LH' : 'MH';
}
