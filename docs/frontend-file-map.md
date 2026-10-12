# Frontend file map — where to hand-change what

Every frontend file in `frontend/`, grouped by module, with what it owns and
whether it is safe to hand-edit. **Bold** paths are the ones you will normally
want. All of these are ordinary source files — edit, then rebuild the image
(`docker compose -f infra/docker-compose.yml --env-file .env build frontend`)
and `up -d frontend`.

Conventions used below:

- **Page** = a route (`app/**/page.tsx`).
- **Guard** = the auth boundary for that route.
- **Session** = anything touching the in-memory token/session state.
- ⚠️ = read the notes before changing; several files are shared by many pages.

---

## 1. Application shell (every page)

| Path | What it owns |
| --- | --- |
| **`app/layout.tsx`** | The HTML shell: fonts, `<Providers>`, header, main, footer. |
| **`app/providers.tsx`** | Provider stack: React Query → Auth → Toast → Socket. Order matters. |
| `app/globals.css` | Tailwind layers + the Bauhaus tokens (`--primary-blue`, …). |
| `app/not-found.tsx` | The 404 page. |
| `app/api/health/route.ts` | Container liveness endpoint used by the Docker healthcheck. Do not remove. |

## 2. Authentication & the access gate (users + admins)

| Path | What it owns |
| --- | --- |
| `app/login/page.tsx` | Login form + post-login routing (admin → `/admin`, student → `?next=` or `/dashboard`). |
| `app/register/page.tsx` | Create-account form (college email, hostel group/block, room). |
| **`lib/auth/auth-context.tsx`** | The ONE auth implementation: in-memory session, `login/register/logout/refresh`, `useAuth()`, and **`RequireAuth`** (the route guard every protected page wraps itself in). |
| `lib/auth/auth_context.ts` | Alias so `@/lib/auth/auth_context` also resolves to the file above. |
| `lib/schemas/forms.ts` | Zod schemas for every form (login, register, listing, offer, dispute, PIN, counter-offer). |
| `lib/auth/authcontext.tsx` ⚠️ | **Dead duplicate** of `auth-context.tsx` (nothing imports it). Left in place; delete when convenient. |
| `lib/auth/authcontext.ts` ⚠️ | Same dead duplicate, re-export form. |

Where the gate is applied:

| Route | Guard |
| --- | --- |
| `/` (market grid) | `RequireAuth` — logged-out visitors are sent to `/login?next=/`. |
| `/dashboard`, `/sell/new`, `/my-orders`, `/purchases`, `/purchases/[id]` | `RequireAuth`. |
| `/listings/[id]`, `/chat/[conversationId]`, `/transactions/[id]` | `RequireAuth` (deep links included). |
| `/admin`, `/admin/userbase` | `RequireAuth` **plus** an admin-role check (403 panel for students). |
| `/login`, `/register`, `/not-found` | Public by design. |

## 3. Navigation & shared layout

| Path | What it owns |
| --- | --- |
| **`components/layout/site-header.tsx`** | Authenticated-only nav (Market / Dashboard / Orders / Sell), the **Purchases** button, the **Profile** button, notifications, logout — and, **for admins only**, the *Admin Console* return button. Logged-out visitors see only Log in / Create account. |
| `components/layout/site-footer.tsx` | The centred tagline only. |
| `components/layout/geometric-logo.tsx` | Brand mark. |

## 4. Profile module (authenticated users)

| Path | What it owns |
| --- | --- |
| **`components/profile/profile-dialog.tsx`** | The profile dialog: name, college email, phone, hostel type/block, room, UPI + inline edit for phone/UPI + the **Purchases** shortcut. Reads `/api/identity/users/me`. |

## 5. Marketplace & listings (users)

| Path | What it owns |
| --- | --- |
| `app/page.tsx` | The market grid at `/`: hero, stats, block toggle, filters, infinite grid. Gated. |
| `app/dashboard/page.tsx` | Seller dashboard: my listings, offers received/sent, transactions, alerts. |
| `app/listings/[id]/page.tsx` | Listing detail: images, seller card, offer form, chat entry. |
| `app/sell/new/page.tsx` | Create-listing form + AI title/price assist + image upload. |
| `components/listings/listing-card.tsx` | Grid card. |
| `components/listings/listing-hover-overlay.tsx` | Hover overlay for the card. |
| `components/listings/filters.tsx` | Search bar, category filter, MH/LH block toggle. |
| **`components/listings/image-upload.tsx`** | Drag/drop upload zone + preview grid + progress UI. |
| **`lib/cloudinary.ts`** | Unsigned Cloudinary upload, thumbnail URLs, Razorpay checkout loader. |

## 6. Orders, purchases & escrow (users)

| Path | What it owns |
| --- | --- |
| `app/purchases/page.tsx` | **Purchases**: Today / All-history switch, All·Bought·Sold·Failed tabs, item name + image + real escrow status per row. |
| `app/purchases/[id]/page.tsx` | Deep-linkable order view — renders the shared dialog below. |
| `app/my-orders/page.tsx` | Live orders with the six-stage timeline and role-specific actions. |
| `app/transactions/[id]/page.tsx` | Full escrow flow: Razorpay funding, buyer PIN/QR credential, seller handover verification, dispute. |
| `components/orders/order-detail-dialog.tsx` ⚠️ shared | The one order dialog (item, buyer, seller, status, timeline, actions). Used by Purchases, Purchases/[id] and My Orders. |
| `components/orders/party-details.tsx` | One party's delivery details (name, hostel, room, phone). |
| `components/transactions/pin-input.tsx` | 4-digit handover PIN entry. |
| `components/transactions/qr-scanner.tsx` | QR scan for handover. |
| **`lib/orders.ts`** | The six-stage order derivation from authoritative backend state + status labels. Single source of truth for the timeline. |

## 7. Chat

| Path | What it owns |
| --- | --- |
| `app/chat/[conversationId]/page.tsx` | Conversation thread, blocked-message warnings, typing indicator. |
| `lib/socket/socket-provider.tsx` | Socket.IO connection + `onBlockedMessage` hook. |

## 8. Administration

| Path | What it owns |
| --- | --- |
| `app/admin/page.tsx` | Admin console: gateway gate (`AdminGate`), **View Market Grid** action, disputes queue + resolve modal, audit log. |
| `app/admin/userbase/page.tsx` | Userbase list + role toggle (user ⇄ admin). |

## 9. API layer (talk to the gateway)

| Path | What it owns |
| --- | --- |
| **`lib/api/client.ts`** | The only network module: `/gw` proxy base, memory-only tokens, 401 → login redirect, error mapping. |
| `lib/api/queries.ts` | Every read hook (listings, offers, chat, notifications, transactions, fulfilment, purchases, profile, admin lists). |
| `lib/api/mutations.ts` | Every write hook (listing CRUD, offers, messages, escrow, handover, dispute, delivery start, **buyer receipt confirmation**, profile update, role change). |
| `lib/api/schemas.ts` | Zod validators for gateway responses (runtime shape checking). |
| `lib/api/types.ts` | DTO types + hostel/category constants. |
| `lib/api/keys.ts` | React Query key factories. |
| `lib/utils.ts` | `cn`, currency/date formatting. |

## 10. Shared UI kit (design system)

`components/ui/` — `index.ts` is the barrel every page imports from.

`button.tsx`, `input.tsx` (Input/Textarea/Select/Checkbox), `card.tsx`,
`badge.tsx`, `modal.tsx` (focus trap + Esc), `stepper.tsx`, `skeleton.tsx`
(Skeleton/EmptyState/Tabs/Section), `toast.tsx`, `geometric-decoration.tsx`,
`hostel-motif.tsx`.

⚠️ Changing these touches every page. `Modal`, `Stepper` and `Badge` are used
by the order dialogs; `Input`/`Button` by every form.

## 11. Build & configuration

| Path | What it owns |
| --- | --- |
| `Dockerfile` | Multi-stage build; **build args** `GATEWAY_ORIGIN`, `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET`. |
| `next.config.mjs` | `/gw/*` → gateway rewrite, Cloudinary image allow-list, security headers. |
| `scripts/check-env.mjs` | Startup guard: refuses to boot when a required env var is missing. |
| `package.json`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.js`, `.dockerignore` | Project config. |

`infra/docker-compose.yml` (repo root) supplies the frontend `build.args` and
`env_file`. `NEXT_PUBLIC_*` values are inlined into the client bundle **at build
time**, so they must be present when the image is built — use
`--env-file .env`, and rebuild (not just restart) after changing them.
