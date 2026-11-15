# Styles & Responsive Layout

Read this before adding or changing any `.vue` or `.scss` file in `client/`.

## Aesthetic Lineage

Mutual House is the **Inhabited Hearth & Studio** alongside `alignos.io` (House of Inquiry) and `coherenceacrossscales.org` (House of Observation). Unlike CAS (which is an austere, account-free static observatory), Mutual House is a warm, living relational studio that borrows its tactile warmth, sacred teal, gold accents, and parchment/indigo-slate polarity from `alignos.io`—without importing Bootstrap.

## Shared Style Architecture (`client/src/assets/styles/`)

`client/src/assets/styles/main.scss` imports shared partials so pages avoid duplicating primitives:

| Partial | Responsibility |
|---|---|
| `_media.scss` | Responsive breakpoint mixins (`phone < 768px`, `tablet 768–1099px`, `desktop >= 1100px`) |
| `_tokens.scss` | Warm parchment (`#f8f6f3`, `#fdfcfa`), sacred teal (`#4a7c7e` / `#5da3a5`), muted gold (`#c9a227` / `#e5c254`), indigo-slate dark mode (`#1a1f2e`, `#252a3d`), spacing, radii, shadows, breakpoints |
| `_typography.scss` | `'Source Sans 3'` / system sans for UI chrome (`1rem`); `'Cormorant Garamond'` for headings and spoken/literary prose; `.section-head`, `.subhead`, `.view-head` |
| `_layout.scss` | Porch container, `.doc-layout`, 3-zone responsive Studio shell (`--rail-width`, `--drawer-width`), phone/tablet drawers, `100dvh` + `safe-area-inset` handling |
| `_components.scss` | `.pill`, `.chip`, `.quiet-btn`, `.back-link`, `.card`, `.panel`, `.badge`, `.presence-dot`, `.seal-banner`, `.drawer`, `.fold`, `.list-columns`, `.list-numbered`, `.data-table`, `.copy-row`, `.copy-row--wrap` |
| `_forms.scss` | `.field`, `.field-label`, `.field-control`, `.toggle-row`, `.cluster`, `.action-row` |
| `_room.scss` | `.turn-list`, `.turn-row`, `.composer`, `.voice-bar`, `.call-stage`, `.receipt-list` |

## Naming & Serif Rules

1. **Name for structure, never for subject:** Use `.shell`, `.rail`, `.turn-row`, `.seal-banner`, `.receipt-drawer`, `.pill`, `.panel`—never essay- or house-specific names (`.the-now-header`, `.compact-paragraph`).
2. **Serif Sizing Floor (`serif-sizing`):** UI chrome and metadata stay sans (`1rem` / `0.875rem`). Whenever `'Cormorant Garamond'` (`var(--font-serif)`) is used for readable text—spoken turns, episode narratives, living summaries, constitutions, invitations—its size MUST be at least `1.2rem` (`1.2 × 1rem`, with `font-size-adjust: none` and `line-height: 1.75–1.85`), and never below `1rem`.
3. **Zero anxiety chrome:** No red unread badge counters, no `"is typing..."` pressure indicators, no social-media feed chrome.
4. **Responsive Breakpoints:**
   - **Phone (`< 768px`):** Compact sticky top bar, slide-over left navigation drawer for Rooms & Inhabitants, full-width readable turn stream, thumb-friendly bottom composer respecting `env(safe-area-inset-bottom)`, bottom-sheet drawers for Receipts & Packet tools.
   - **Tablet (`768px–1099px`):** Persistent or collapsible room rail + fluid main column + slide-over right inspector drawer.
   - **Desktop (`>= 1100px`):** Three-zone studio layout (Left Rail: House switcher, Rooms, Inhabitants with 3-state presence; Center Stage: Header, active CallStage, SealBanner, RoomTimeline, TurnComposer; Right Contextual Drawer when inspecting Receipts, Packets, or Memory diffs).
