# .impeccable.md

Design context for the **diaetendeckel / gehaltsdeckel.jetzt** campaign.

---

## Design Context

### Users

Left-wing political activists and Die Linke party members and supporters — people who are already engaged with the cause and arrive with a sense of urgency. They want to sign an open letter fast, see the growing list of signatories, and feel part of a movement. Secondary users are curious visitors who need convincing. The interface is entirely German-language; no internationalisation is needed.

### Brand Personality

**Urgent · Uncompromising · Grassroots**

This is a campaign from the party base, not from official structures. The voice is direct, confrontational, and politically confident — it speaks like a poster on a lamppost, not a press release. The emotional goal is solidarity and momentum: visitors should feel the weight of collective action and be moved to join it.

### Aesthetic Direction

**Political-poster brutalism.**

- Heavy Work Sans 900 headlines with tight letter-spacing, rendered large enough to command attention
- A restricted palette: deep burgundy `#6f003c`, full red `#ff0000`, warm cream `#f4f1ec`, white — nothing extra
- Flat offset box shadows (`10px 10px 0 var(--rot)`) instead of soft elevation — deliberate, graphic, not UI-ish
- Diagonal clip-path accents (wedge shapes) as the primary decorative motif
- Uppercase tracking for labels and small captions; zero decorative gradients
- Inter for body/UI text at regular weight; Work Sans reserved for display, headings, and CTAs

**References implied by the code**: Swiss-style political typography, old-school activist flyers, German left newspaper layout.

**Anti-references**: Corporate SaaS, startup landing pages, party-official "institutional" design, soft pastel/neumorphic UI trends.

**Theme**: Light mode only. No dark mode.

### Accessibility

- `prefers-reduced-motion` already respected globally
- Skip link present; `focus-visible` outline uses `--rot` at 2px offset
- Touch targets at minimum 44px
- Target: WCAG 2.1 AA as a baseline

### Design Tokens

```
--rot: #ff0000          /* primary red accent, CTAs, highlights */
--rot-text: #cc0000     /* red in body text (contrast-safe) */
--akzent: #6f003c       /* deep burgundy — primary dark, borders, text */
--weiss: #ffffff
--fond: #f4f1ec         /* warm cream — section backgrounds */
--grau: #6b6b6b
--grau-hell: #e6e6e6
--erfolg: #0a7a3a       /* success / confirmed */
--fehler: #b00020       /* error */

Fonts:
  Display / headings / CTAs → "Work Sans" (300, 400, 700, 900)
  Body / UI / data          → "Inter" (400, 500, 700)

Shadows: flat offset — 10px 10px 0 [color], never blurred
Radius:  none (sharp corners throughout)
```

### Design Principles

1. **Poster first.** Every screen should look like it could be printed and stapled to a wall. Prefer bold over refined; graphic over decorative.

2. **The number is the hero.** The live signature count is the emotional core of the page. Give it the most visual weight of anything on screen.

3. **Red means action.** Red is reserved for interactive elements, primary CTAs, and emphasis. Never use it decoratively — it must always signal something.

4. **No softness.** No border-radius, no blur shadows, no gradients, no rounded pills. The visual language is sharp, angular, and deliberate.

5. **Motion earns its place.** Animation is only justified when it reinforces momentum (e.g. the pulse dot, new-signer fade-in). Never animate for decoration; always respect `prefers-reduced-motion`.
