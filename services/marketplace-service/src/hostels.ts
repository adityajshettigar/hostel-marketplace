// ---------------------------------------------------------------------------
// MH/LH trade segregation (feature).
//
// The men's hostel (MH-1..MH-7) and ladies' hostel (LH-1..LH-3) are two
// separate markets: a listing's group comes from its denormalised
// `seller_block`, and the caller's group from the `hostelBlock` JWT claim
// (login AND refresh both stamp it). Anything not LH-prefixed — including
// legacy block values like 'A' or 'MH-A' — counts as MH, matching
// identity-service's derivation so both services always agree.
// ---------------------------------------------------------------------------

export type HostelGroup = 'MH' | 'LH';

export function hostelGroup(block: string | null | undefined): HostelGroup {
  return block && block.toUpperCase().startsWith('LH') ? 'LH' : 'MH';
}

/**
 * SQL predicate that keeps only one group's rows in `column` (alias-free,
 * safe to interpolate: the value is our own constant, never user input).
 */
export function groupSql(group: HostelGroup, column: string): string {
  return group === 'LH' ? `${column} LIKE 'LH%'` : `${column} NOT LIKE 'LH%'`;
}
