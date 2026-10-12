# Bauhaus Design System — Appendix A (Authoritative)

> This document is the single source of truth for the frontend's visual language. It lives in the repo as `docs/design-system.md` so it survives outside the build brief.

## 1. Design Philosophy

The Bauhaus style embodies "form follows function" while celebrating pure geometric beauty and primary color theory. This is **constructivist modernism** — every element is composed from circles, squares, and triangles. The aesthetic should evoke 1920s Bauhaus posters: bold, asymmetric, architectural, and unapologetically graphic.

**Vibe**: Constructivist, Geometric, Modernist, Artistic-yet-Functional, Bold, Architectural.

**Core concept**: The interface is not merely a layout — it is a **geometric composition**. Every section is constructed rather than designed. Think of the page as a Bauhaus poster brought to life: shapes overlap, borders are thick and deliberate, colors are pure primaries (Red `#D02020`, Blue `#1040C0`, Yellow `#F0C020`), and everything is grounded by stark black (`#121212`) and clean white.

**Key characteristics**:
- **Geometric purity**: all decorative elements derive from circles, squares, and triangles.
- **Hard shadows**: 4px and 8px offset shadows (never soft/blurred) create depth through layering.
- **Color blocking**: entire sections use solid primary colors as backgrounds.
- **Thick borders**: 2px and 4px black borders define every major element.
- **Asymmetric balance**: grids are used but intentionally broken with overlapping elements.
- **Constructivist typography**: massive uppercase headlines (text-6xl to text-8xl) with tight tracking.
- **Functional honesty**: no gradients, no subtle effects — everything is direct and declarative.

## 2. Design Tokens (The DNA)

**Colors (single palette, light mode only)** — strictly limited to the Bauhaus primaries plus stark black and white:
- `background`: `#F0F0F0` (off-white canvas)
- `foreground`: `#121212` (stark black)
- `primary-red`: `#D02020` (Bauhaus Red)
- `primary-blue`: `#1040C0` (Bauhaus Blue)
- `primary-yellow`: `#F0C020` (Bauhaus Yellow)
- `border`: `#121212` (thick, distinct borders)
- `muted`: `#E0E0E0`

**Typography**
- Family: **Outfit** (geometric sans-serif from Google Fonts) — its circular letterforms and clean geometry embody Bauhaus principles.
- Import: `Outfit:wght@400;500;700;900`.
- Scaling: extreme contrast between display and body.
  - Display: `text-4xl` (mobile) → `text-6xl` (tablet) → `text-8xl` (desktop)
  - Subheadings: `text-2xl` → `text-3xl` → `text-4xl`
  - Body: `text-base` → `text-lg`
- Weights:
  - Headlines: `font-black` (900), uppercase, `tracking-tighter`
  - Subheadings: `font-bold` (700), uppercase
  - Body: `font-medium` (500) for readability
  - Labels: `font-bold` (700), uppercase, `tracking-widest`
- Line height: tight for headlines (`leading-[0.9]`), relaxed for body (`leading-relaxed`).

**Radius & border**
- Radius is binary: `rounded-none` (0px) for squares/rectangles, or `rounded-full` (9999px) for circles. No in-between.
- Border widths: mobile `border-2` (2px); desktop `border-4` (4px); navigation/major divisions `border-b-4`.
- Border color: always `#121212` for maximum contrast.

**Shadows / effects**
- Hard offset shadows (Bauhaus layering):
  - Small: `shadow-[3px_3px_0px_0px_black]` or `shadow-[4px_4px_0px_0px_black]`
  - Medium: `shadow-[6px_6px_0px_0px_black]`
  - Large: `shadow-[8px_8px_0px_0px_black]`
- Button press: `active:translate-x-[2px] active:translate-y-[2px] active:shadow-none` (simulates a physical press).
- Card hover: `hover:-translate-y-1` or `hover:-translate-y-2` (subtle lift).
- Patterns: CSS background patterns for texture.
  - Dot grid: `radial-gradient(#fff 2px, transparent 2px)` with `background-size: 20px 20px`
  - Opacity overlays: large geometric shapes at 10–20% opacity for background decoration
    (now carried by the hostel-motif scatter layer — see §5).

## 3. Component Stylings

**Buttons**
- Variants:
  - Primary (Red): `bg-[#D02020] text-white border-2 border-black shadow-[4px_4px_0px_0px_black]`
  - Secondary (Blue): `bg-[#1040C0] text-white border-2 border-black shadow-[4px_4px_0px_0px_black]`
  - Yellow: `bg-[#F0C020] text-black border-2 border-black shadow-[4px_4px_0px_0px_black]`
  - Outline: `bg-white text-black border-2 border-black shadow-[4px_4px_0px_0px_black]`
  - Ghost: `border-none text-black hover:bg-gray-200`
- Shapes: `rounded-none` (square) or `rounded-full` (pill). Use shape variants deliberately.
- States:
  - Hover: slight opacity change (`hover:bg-[color]/90`)
  - Active: presses down (`active:translate-x-[2px] active:translate-y-[2px] active:shadow-none`)
  - Focus: 2px offset ring
- Typography: uppercase, `font-bold`, `tracking-wider`.

**Cards**
- Base: white background, `border-4 border-black`, `shadow-[8px_8px_0px_0px_black]`.
- Decoration: small geometric shape in the top-right corner (8px × 8px):
  - Circle: `rounded-full bg-[primary-color]`
  - Square: `rounded-none bg-[primary-color]`
  - Triangle: CSS `clip-path: polygon(50% 0%, 0% 100%, 100% 100%)`
- Hover: `hover:-translate-y-1` (subtle lift).
- Content hierarchy: large bold titles, medium body text, generous padding.

**Accordion (FAQ)**
- Closed: white background, `border-4 border-black`, `shadow-[4px_4px_0px_0px_black]`.
- Open: red background (`bg-[#D02020]`), white header text.
- Expanded content: light yellow background (`bg-[#FFF9C4]`), black text, `border-t-4 border-black`.
- Icon: `ChevronDown` with `rotate-180` when open.

## 4. Layout & Spacing

- Container width: `max-w-7xl` for main content sections (poster-like breadth).
- Section padding: mobile `py-12 px-4`; tablet `py-16 px-6`; desktop `py-24 px-8`.
- Grid systems:
  - Stats: 1 col (mobile) → 2 col (tablet) → 4 col (desktop) with `divide-y` and `divide-x` borders.
  - Features: 1 col → 2 col → 3 col with 8px gaps.
  - Pricing: 1 col → 3 col (center elevated on desktop).
- Spacing scale: consistent use of 4px, 8px, 12px, 16px, 24px.
- Section dividers: every section has `border-b-4 border-black`, creating strong horizontal rhythm.

## 5. Non-Genericness (Bold Choices)

This design must not look like generic Tailwind or Bootstrap. The following are **mandatory**:

- **Color blocking** — entire sections use solid primary backgrounds:
  - Hero right panel: Blue (`bg-[#1040C0]`)
  - Stats section: Yellow (`bg-[#F0C020]`)
  - Blog section: Blue (`bg-[#1040C0]`)
  - Benefits section: Red (`bg-[#D02020]`)
  - Final CTA: Yellow (`bg-[#F0C020]`)
  - Footer: Near-black (`bg-[#121212]`)
- **Geometric logo** — navigation features three geometric shapes (circle, square, triangle) in primary colors forming the brand identity.
- **Hostel motif compositions** (visual patch — replaces the old abstract
  geometric compositions for DECORATIVE contexts only): faded line-art icons of
  everyday hostel/college items (books, backpack, headphones, soda cup, keys,
  calculator…) rendered via lucide-react through
  `components/ui/hostel-motif.tsx` (`HostelMotif` + `MotifScatter`). Same
  Bauhaus bones as before — black stroke-only art, no fill, very low opacity,
  scattered placement with organic rotations, absolute behind content,
  `aria-hidden`, `pointer-events-none`, never animated:
  - Stroke 1.25–1.5 (a lighter layer than the UI's 2–4px borders).
  - Opacity 6–12% on light backgrounds, 10–16% on solid color bands; the
    black footer/admin-shell exception stays (white strokes at 15–20%).
  - Rotations from the scattered −12/6/−24/18/−6/30 family — never the
    structural 0/45/90 grid; static, like every background pattern.
  - Sizes 32–96px; at most 4–7 icons per composition; icons never overlap
    headlines, body text, or interactive elements (compositions hide on
    narrow viewports rather than crowd the content).
  - Scatter recipes per context: hero (blue band: BookOpen, Backpack,
    Headphones, CupSoda, Pencil), sell/new listing (Ruler, Calculator,
    ShoppingBag, Pencil, Lamp), chat/empty thread (Coffee, Headphones,
    CupSoda), dashboard stat strip (Calculator, Laptop, AlarmClock, Key),
    transactions/escrow PIN banner (Key, AlarmClock, Glasses), admin console
    (Ruler, Key, BookOpen in white), empty states (12–16%, caller-tunable via
    `motifIcons`), 404 (Backpack, BookOpen, CupSoda, Umbrella), footer corner
    (Key, BookOpen, Headphones, white).
  - Where a motif scatter is present it replaces the dot-grid overlay on that
    band — one decorative layer per band (patch decision M3).
  - NOT motifs: the GeometricLogo brand mark, the Stepper's circle → square →
    rotated-square nodes, functional nav bullets, select dropdown markers, and
    the 8–16px card/listing-card corner marks (kept as colored shapes, M1).
- **Rotated elements** — deliberate 45° rotation on:
  - every third shape in repeating patterns,
  - step numbers in "How It Works" (counter-rotate inner content),
  - decorative background shapes.
- **Image treatments**:
  - Blog images alternate between `rounded-full` and `rounded-none`, grayscale filter with `hover:grayscale-0`.
  - Testimonial avatars: circular crop, `rounded-full`, grayscale filter.
- **Unique decorations** — small geometric shapes (8–16px) as corner decorations on cards, using the three primary colors in rotation.

## 6. Icons & Imagery

- Icon library: `lucide-react` (Circle, Square, Triangle, Check, Quote, ArrowRight, ChevronDown).
- Icon style: stroke width 2px default or 3px for emphasis; size `h-6 w-6` to `h-8 w-8`; color matches the section accent or white on colored backgrounds.
- Icon integration: icons sit inside bordered geometric containers:
  - Features: icon in a white bordered box with shadow.
  - Benefits: check icon in a yellow circular badge.
  - Stats: numbers in geometric shapes (circle / square / rotated square).
- Image treatment: all images grayscale by default, color on hover.

## 7. Responsive Strategy

- Mobile-first: start with single-column layouts, expand to grids on larger screens.
- Breakpoints: mobile `<640px` (sm); tablet `640–1024px` (sm to lg); desktop `>1024px` (lg+).
- Typography scaling: all text uses responsive classes (`text-4xl sm:text-6xl lg:text-8xl`).
- Border/shadow scaling: reduce on mobile (`border-2 → border-4`, `shadow-[3px] → shadow-[8px]`).
- Navigation: hamburger below `768px`, full nav on desktop.
- Grid adaptations:
  - Stats: 1 col → 2 col (sm) → 4 col (lg)
  - Features: 1 col → 2 col (md) → 3 col (lg)
  - How It Works: 1 col → 2 col (sm) → 4 col (md); hide the connecting line on mobile.

## 8. Animation & Micro-Interactions

- Feel: mechanical, snappy, geometric — no soft organic movement.
- Duration: `duration-200` or `duration-300` (fast and decisive).
- Easing: `ease-out` (mechanical feel).
- Interactions:
  - Button press: translate and remove shadow.
  - Card hover: lift upward.
  - Accordion: `ChevronDown` rotation (`rotate-180`) with max-height content reveal.
  - Icon hover: scale up on grouped shapes (`group-hover:scale-110`).
  - Link hover: color change to accent color.
- Background patterns: static — never animate them.
