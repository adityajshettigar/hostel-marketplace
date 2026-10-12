export const listingKeys = {
  all: ["listings"] as const,
  list: (f: { q?: string; category?: string; block?: string }) =>
    ["listings", "list", f] as const,
  detail: (id: string) => ["listings", "detail", id] as const,
  mine: () => ["listings", "mine"] as const,
  related: (id: string) => ["listings", "related", id] as const,
};

export const offerKeys = {
  all: ["offers"] as const,
  listing: (id: string) => ["offers", "listing", id] as const,
  mine: () => ["offers", "mine"] as const,
};

export const conversationKeys = {
  all: ["conversations"] as const,
  detail: (id: string) => ["conversations", "detail", id] as const,
  messages: (id: string) => ["conversations", "messages", id] as const,
};

export const notificationKeys = {
  all: ["notifications"] as const,
};

export const txKeys = {
  all: ["transactions"] as const,
  detail: (id: string) => ["transactions", "detail", id] as const,
  mine: () => ["transactions", "mine"] as const,
};

export const disputeKeys = {
  all: ["disputes"] as const,
};

export const auditKeys = {
  all: ["audit"] as const,
  list: (f: Record<string, unknown>) => ["audit", "list", f] as const,
};

export const fulfillmentKeys = {
  all: ["fulfillment"] as const,
  list: () => ["fulfillment", "list"] as const,
  detail: (offerId: string) => ["fulfillment", "detail", offerId] as const,
};

export const purchasesKeys = {
  all: ["purchases"] as const,
  list: (role: 'buying' | 'selling') => ["purchases", "list", role] as const,
  detail: (id: string) => ["purchases", "detail", id] as const,
};

// Admin userbase (separate from the public ["users", "public", id] profile key).
export const userKeys = {
  all: ["admin-users"] as const,
  list: () => ["admin-users", "list"] as const,
};
