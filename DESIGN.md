---
name: gehaltsdeckel.jetzt
description: Campaign design system for the Diätendeckel open letter: political-poster brutalism for a grassroots left movement.
colors:
  signal-red: "#ff0000"
  signal-red-text: "#cc0000"
  deep-wine: "#6f003c"
  parchment: "#f4f1ec"
  white: "#ffffff"
  graphite: "#6b6b6b"
  graphite-dark: "#4a4a4a"
  graphite-light: "#e6e6e6"
  success-green: "#0a7a3a"
  error-red: "#b00020"
  warning-amber: "#e6a817"
typography:
  display:
    fontFamily: "Work Sans, Inter, sans-serif"
    fontSize: "clamp(56px, 9vw, 144px)"
    fontWeight: 900
    lineHeight: 0.92
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Work Sans, Inter, sans-serif"
    fontSize: "clamp(34px, 4.2vw, 56px)"
    fontWeight: 900
    lineHeight: 0.95
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Work Sans, Inter, sans-serif"
    fontSize: "clamp(28px, 3vw, 40px)"
    fontWeight: 900
    lineHeight: 1.02
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16.5px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "-0.01em"
  label:
    fontFamily: "Work Sans, Inter, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.12em"
rounded:
  none: "0px"
spacing:
  xs: "6px"
  sm: "14px"
  md: "28px"
  lg: "48px"
  xl: "96px"
components:
  button-primary:
    backgroundColor: "{colors.deep-wine}"
    textColor: "{colors.white}"
    rounded: "{rounded.none}"
    padding: "18px 24px"
  button-primary-hover:
    backgroundColor: "{colors.signal-red}"
    textColor: "{colors.white}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.deep-wine}"
    rounded: "{rounded.none}"
    padding: "14px 20px"
  button-ghost-hover:
    backgroundColor: "{colors.deep-wine}"
    textColor: "{colors.white}"
  input-default:
    backgroundColor: "{colors.white}"
    textColor: "{colors.deep-wine}"
    rounded: "{rounded.none}"
    padding: "14px"
  input-focus:
    backgroundColor: "{colors.white}"
    textColor: "{colors.deep-wine}"
    rounded: "{rounded.none}"
    padding: "14px"
  chip-filter:
    backgroundColor: "transparent"
    textColor: "{colors.deep-wine}"
    rounded: "{rounded.none}"
    padding: "8px 14px"
  chip-filter-active:
    backgroundColor: "{colors.deep-wine}"
    textColor: "{colors.white}"
    rounded: "{rounded.none}"
    padding: "8px 14px"
---

# Design System: gehaltsdeckel.jetzt

## 1. Overview

**Creative North Star: "The Strike Broadsheet"**

This is a campaign printed in two colors on cheap paper, folded in thirds, and stuffed into letterboxes. Every surface assumes that the reader is already half-convinced; the job of the interface is to remove friction between conviction and signature, not to persuade through decoration. Typography dominates. Color is reserved for signal, not atmosphere. White space is earned, not given.

The system is anchored by Work Sans 900 at sizes that would be legible from across a union hall. Deep Wine (#6f003c) sets the dominant tone: authoritative, politically serious, not corporate. Signal Red (#ff0000) appears only where action is required: CTAs, emphasis, live indicators. Parchment (#f4f1ec) provides the section-background warmth of aged newsprint without slipping into nostalgia. Flat offset shadows (8–14px, no blur) replace elevation with graphic weight: every shadow reads as a deliberate stamp, not a soft glow.

This system explicitly rejects: corporate SaaS softness, rounded corners, gradient accents, modal-first thinking, and anything that could be described as "institutional." If a component could appear on a party's official government website, it has no place here. The source of the design authority is the street, not the party office.

**Key Characteristics:**

- Zero border-radius throughout
- Flat offset box-shadows only (`N px N px 0 [color]`), never blurred
- Work Sans 900 for all headings, CTAs, and display copy
- Inter for body text and data
- Signal Red reserved exclusively for interactive states and live signals
- Diagonal clip-path keil (wedge) as the primary decorative motif
- `prefers-reduced-motion` respected globally; animations are structural, never decorative

## 2. Colors: The Broadsheet Palette

A two-color printer's discipline: Deep Wine and Signal Red do all the work; Parchment and White provide the paper; graphite neutrals handle metadata.

### Primary

- **Signal Red** (`#ff0000`): The action color. Appears on primary CTAs, focus rings, live pulse indicators, counter-card goal bars, and any element that demands immediate attention. Never used decoratively. On body text, the contrast-safe variant Signal Red Text (`#cc0000`) replaces it.
- **Signal Red Text** (`#cc0000`): Body-safe red. Used for inline emphasis, section numbers (e.g. `01`), and the `h1` `.rot` span. Never on buttons or interactive elements.

### Secondary

- **Deep Wine** (`#6f003c`): The system's dominant dark. Used as the primary text color on white backgrounds, border color throughout, the fill for dark surfaces (topbar CTA, counter card, demands strip, signer avatars), and the offset shadow color on form cards and the brief paper. Think: the ink in the barrel, not the headline.

### Neutral

- **Parchment** (`#f4f1ec`): Warm off-white. Section backgrounds for the hero, form card, signers list, and the open-letter paper. Reads as newsprint without being sepia.
- **White** (`#ffffff`): The base page background. Also: field backgrounds, modal bodies, ghost button fills.
- **Graphite** (`#6b6b6b`): Secondary metadata, timestamps, helper text, and form legal copy.
- **Graphite Dark** (`#4a4a4a`): Definition list terms and slightly elevated metadata.
- **Graphite Light** (`#e6e6e6`): Dividers and the empty state of the counter-card goal bar.

### Semantic

- **Success Green** (`#0a7a3a`): Confirmation modal header only.
- **Error Red** (`#b00020`): Field validation errors and inline error messages. The error background is a 7% tint mixed with white.
- **Warning Amber** (`#e6a817`): Mail delivery warnings (e.g. spam folder notices). Background `#fff3cd`, text `#6b4200`.

### Named Rules

**The One Signal Rule.** Signal Red appears only where something is happening or about to happen. It marks the CTA, the live dot, the goal bar, and the section accent stripe. Applying it elsewhere dilutes the signal. When in doubt, use Deep Wine.

## 3. Typography: Two Weights, One Family

**Display / Headlines / CTAs:** Work Sans (weights 300, 400, 700, 900): `"Work Sans", "Inter", sans-serif`
**Body / UI / Data:** Inter (weights 400, 500, 700): `"Inter", system-ui, sans-serif`
**Mono (inline):** `ui-monospace, "SFMono-Regular", Menlo, monospace` (email addresses, code snippets only)

**Character:** Work Sans 900 is the voice of the campaign: compressed, confrontational, poster-ready. Inter is the accountant sitting next to the activist: precise, legible, emotionally neutral. The pairing avoids elegance; it reads like something that had to be done fast and correctly.

### Hierarchy

- **Display** (900, `clamp(56px, 9vw, 144px)`, line-height 0.92, tracking −0.02em): The main h1 on the hero. One instance per page. At maximum size it bleeds past the viewport edge. The number is the hero.
- **Headline** (900, `clamp(34px, 4.2vw, 56px)`, line-height 0.95, tracking −0.02em): Section h2s. Matches the broadsheet's section-header convention: no decorative weight variation, no italics.
- **Title** (900, `clamp(28px, 3vw, 40px)`, line-height 1.02, tracking −0.02em): Sub-headers within sections (brief paper h2, sign section h2). Also used for the counter card number at `clamp(48px, 13vw, 72px)`.
- **Sub / Lead** (Work Sans 300, `clamp(20px, 2.2vw, 28px)`, line-height 1.25): Hero sub-headline. The light weight against the 900 display creates the broadsheet two-weight contrast.
- **Body** (Inter 400/500, 16.5px, line-height 1.65, tracking −0.01em): Open-letter body copy, section prose. Max line length 65ch; enforced via `max-width` on text containers.
- **Label** (Work Sans 700, 11–13px, tracking 0.12em, uppercase): Form field labels, section number prefixes (e.g. `01`), demand card metadata. Capslock tracking at 0.12em is the system's only decorative typography move.
- **Small** (Inter 400/500, 12–14px): Timestamps, helper text, form legal, filter chip counts.

### Named Rules

**The Weight Cliff Rule.** Weight contrast in headings is Work Sans 900 versus Work Sans 300, with no intermediate stops. Using 700 as a "large heading" weight collapses the visual hierarchy. Reserve 700 for labels and UI chrome only.

## 4. Elevation

This system does not use blurred shadows. Depth is conveyed exclusively through flat offset box-shadows, border layering, and surface-color contrast. The vocabulary is structural, not atmospheric: a shadow here means "this box is important," not "this box is floating."

### Shadow Vocabulary

- **Shadow SM** (`8px 8px 0 [color]`): Störer (event sticker), success check mark. Used for elements that should feel stamped onto the surface.
- **Shadow MD** (`10px 10px 0 var(--rot)`): Sub-headline box, counter card. The hero-level signal shadow, offset in Signal Red.
- **Shadow ML** (`12px 12px 0 var(--akzent)`): Brief paper (the open letter). Deep Wine shadow marks the letter as the content anchor of the page.
- **Shadow LG** (`14px 14px 0 var(--rot)`): Form card. The largest shadow in the system is on the primary conversion surface.
- **Modal** (`16px 16px 0 var(--akzent)`): Modals only. Heaviest shadow = highest interrupt priority.

Shadow color alternates between Signal Red and Deep Wine as a functional signal: Red shadows appear on the conversion surfaces (form card, counter card, modal confirmation CTA), Deep Wine shadows on content containers (brief paper, modal overlay).

### Named Rules

**The No-Blur Rule.** The blur radius of every `box-shadow` in this system is `0`. Any blurred shadow is a design error. Rework with tonal background contrast instead.

## 5. Components

Components in this system feel **confrontational but precise**: sharp corners, declared borders, bold weight, flat shadows. Every component is typographically driven; decoration is structural (borders, shadows, clip paths) rather than cosmetic (gradients, rounded shapes, icons).

### Buttons

- **Shape:** No border-radius. Hard corners throughout.
- **Primary (`.submit`, `.topbar .cta`):** Deep Wine fill, white text, Work Sans 900. Padding 18px vertical / 24px horizontal. On hover: Signal Red fill, translate(−2px, −2px), flat red/wine shadow; the button visibly "stamps" toward the reader.
- **Ghost (`.scrollcta`, `.resend-btn`, `.signers-foot button`):** Transparent fill, Deep Wine border 1.5px, Deep Wine text. On hover: fills Deep Wine, text flips white.
- **Disabled state:** 0.5 opacity, `cursor: not-allowed`. No style changes beyond opacity.
- **Focus:** `outline: 2px solid var(--rot)` at 2px offset.

### Filter Chips (`.filter-chip`)

- Flat: transparent fill, Deep Wine border 1.5px, 700-weight Work Sans at 13px.
- Active: Deep Wine fill, white text. No transition except background and color at 0.12s ease.
- No border-radius. No hover shadows.

### Occupation Chips (`.occupation-chip`)

- White fill, Deep Wine border 1.5px, 500-weight Inter.
- Hover: translate(−1px, −1px), `box-shadow: 3px 3px 0 var(--rot)`.
- Count badge: Deep Wine fill, white text, Work Sans 900, no radius.

### Cards / Containers

- **Corner Style:** None (0px radius throughout)
- **Brief Paper:** Parchment fill, Deep Wine border 1px, Shadow ML (`12px 12px 0 var(--akzent)`). Red 6px top-stripe via `::before`. Padding 56px/64px desktop → 36px/28px mobile.
- **Form Card:** Parchment fill, Deep Wine border 1px, Shadow LG (`14px 14px 0 var(--rot)`). Position-absolute badge floats above the top edge.
- **Counter Card:** Deep Wine fill, white text, Shadow MD in Signal Red. The only dark-filled card in the system.
- **Internal Padding:** `spacing.md` (28px) to `spacing.lg` (48px), varied deliberately for rhythm.

### Inputs / Fields

- **Style:** White fill, Deep Wine border 1.5px, no radius. Inter 400 at 15px. Padding 14px.
- **Focus:** `box-shadow: 4px 4px 0 var(--rot)`: the input "stamps" into its shadow on focus.
- **Error:** Deep Wine border replaced by Error Red, background tinted via `color-mix(in srgb, #b00020 7%, white)`.
- **Checkbox:** 20×20px, Deep Wine border 1.5px. Checked: Signal Red fill, white checkmark. Focus: compound ring (Parchment ring at 3px, Signal Red at 5px).
- **Labels:** Work Sans 700, 12px, tracking 0.12em, uppercase.

### Navigation (Topbar)

- White background, Deep Wine `border-bottom: 1px solid`. Sticky at `z-index: 30`.
- Desktop: Work Sans 900 wordmark at 18px + a 14px-wide Deep Wine square rotated 8deg (the brand mark). Nav links in Inter 500 at 14px. CTA button: Deep Wine → Signal Red on hover.
- Mobile: hamburger (44×44px touch target) toggles Deep Wine panel with red bottom border.

### Signer Items (`.signer`)

- Parchment background, separated by the 1px Deep Wine grid gap. Avatar square 44×44px, Deep Wine fill.
- New-signer animation: Signal Red background fades from opacity 1 → 0 over 2s (structural animation; communicates live momentum).

### Modal

- White body, Deep Wine border 1px, Shadow (`16px 16px 0 var(--akzent)`). Signal Red header bar for standard states, Success Green for confirmed state.
- Entry animation: `translateY(20px) scale(0.97)` → natural, at `cubic-bezier(0.2, 0.7, 0.2, 1)`.

### Demand Grid (`.demands-grid`) / Stats Row (`.stats-row`)

- Dark burgundy strip. Items share a 1px Deep Wine grid gap as a visible structural rule. No individual card borders: the gap IS the border.

## 6. Do's and Don'ts

**Do** use `clip-path: polygon(...)` wedge shapes (`.keil`) as the primary large-scale decorative element; it is the system's signature spatial motif.

**Do** keep the offset shadow color alternation deliberate: Signal Red shadows on conversion surfaces, Deep Wine shadows on content containers.

**Do** use `clamp()` for all heading `font-size` values. Fluid typography is structural, not a nicety: the display headline loses coherence if it falls below 56px or exceeds 144px.

**Do** keep red elements at the right density. Signal Red should occupy no more than 10–15% of any given screen surface. Its scarcity is the signal.

**Don't** add border-radius anywhere. Not 2px. Not 4px. Not `rounded-sm`. Zero, everywhere.

**Don't** use blurred box-shadows. If you need to add a new shadow, use `N px N px 0 [color]`.

**Don't** use Signal Red for decoration. No red section backgrounds, no red dividers, no red typography that doesn't indicate an interactive element or live state.

**Don't** use Work Sans below 700 in UI chrome. Work Sans 300 is reserved for display subheadings where the light-weight contrast against 900 is intentional. In buttons, labels, and navigation, 700 is the floor.

**Don't** add gradients. Not for backgrounds, not for text, not for borders.

**Don't** nest shadows. A component either has a flat offset shadow or it doesn't. A hovered state may shift or grow the shadow, but never add a second layer.
