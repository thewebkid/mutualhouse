# Styles & Responsive Layout

Read this before adding or changing any `.vue` or `.scss` file in `client/`.

## Personality

Mutual House is **a lived-in house**, not an observatory and not a temple. The brief calls it a *household-scale laboratory* for *practice*: small, bounded, domestic, with a common room, a porch, and doors. The look should feel like a well-kept home with the lights on: limewash walls, a clay-coloured door, a deep green hallway, signatures that differ without ranking.

It is a sibling of `alignos.io` and `coherenceacrossscales.org`, not a copy of either. Each of the three has its own tone:

| Site | Tone | Ground | Accent | Faces |
|---|---|---|---|---|
| `coherenceacrossscales.org` | Austere observatory | neutral grey-white, graphite night | slate blue | Inter + Cormorant |
| `alignos.io` | Contemplative, sacred inquiry | parchment, indigo-slate night | teal + gold | Source Sans 3 + Cormorant |
| **Mutual House** | Warm, domestic, practised together | sage limewash, deep garden-green night | clay + pine | Figtree + Fraunces + Literata (reading) |

Shared with the siblings: the principles (structural class names, the serif floor, calm and zero anxiety chrome, three breakpoints). **Not** shared: hues, faces, shapes. Do not reintroduce teal, gold, parchment, indigo/slate, Cormorant, Source Sans or Inter here, and do not copy a sibling's token file. If a colour or face feels missing, ask Ron before adding one.

## Shared Style Architecture (`client/src/assets/styles/`)

`main.scss` imports the partials so pages avoid duplicating primitives:

| Partial | Responsibility |
|---|---|
| `_media.scss` | Breakpoint mixins (`phone < 768px`, `tablet 768–1099px`, `desktop >= 1100px`) |
| `_tokens.scss` | Palette, fonts, spacing, radii, theme blocks (`light-theme`, `dark-theme`) and the `hearth` mixin |
| `_typography.scss` | Body, headings, `.prose`, `.serif-line`, `.serif-quote`, `.eyebrow`, `.label`, `.meta`, `.subhead` |
| `_layout.scss` | Porch (`.porch-*`, `.porch-hero`, `.arch-row`, `.band`), `.container`, `.doc-layout`, `.grid`, `.stack`, the studio shell (`.shell`, `.rail`, `.stage`, `.leaf`, `.drawer`) |
| `_components.scss` | `.btn`, `.card`, `.panel`, `.badge`, `.monogram`, `.presence-dot`, `.seal-banner`, `.tabs`, `.word-list`, `.list-columns`, `.list-numbered`, `.data-table`, `.toast` |
| `_forms.scss` | `.field`, `.field-control`, `.toggle-row`, `.choice`, `.cluster` |
| `_room.scss` | Rail items, `.room-head` (masthead), `.room-presence`, `.turn-list`, `.turn-row`, `.turn-meta`, `.turn-facts`, `.turn-veil`, `.composer`, `.kind-select`, `.voice-bar`, `.call-stage`, `.receipt-list` |

## Colour

All colour is a runtime custom property from `_tokens.scss`; components never use a hex value. Roles, not hues:

- **Walls** (`--bg`, `--bg-elevated`, `--surface`, `--surface-sunken`, `--reader-bg`, `--stage-bg`, `--border`): pale sage limewash by day, deep garden green by night. Never parchment, never indigo. `--stage-bg` is the floor in the studio; `--reader-bg` is the leaf lying on it (see Layout).
- **Clay** (`--primary`): the door you knock on. Actions, links, the open tab, the current room.
- **Pine** (`--accent`, `--accent-text`): what is held. Seals, sealed readings, privacy cues, a paused room. Use `--accent-text` when pine is text; it is lighter at night. Pine is not a tag for AI inhabitants: kind is told by shape, and provenance such as provider is plain muted text (`.turn-facts`).
- **Hearth** (`--hearth-bg`): the always-dark wall. The studio rail, the phone topbar and the porch footer apply `@include hearth`, which re-points every shared token inside that surface. Controls placed in the rail need no special rules.
- **Bands** (`--band-bg`, `--band-alt-bg`): full-bleed colour blocks on the porch for the two quoted interludes.
- **Signature hues** (`--sig-1` … `--sig-8`): see below.
- `--danger` is raspberry, `--success` is a green. Neither is used for anything but state.

No gradients. Depth comes from borders and a hard lower edge (`box-shadow: 0 2px 0 var(--border)`), not blur.

## Signature hues

Every inhabitant, human or AI, carries one of eight hues, chosen by `signatureStyle(inhabitant)` in `client/src/lib/signature.js` (FNV hash of the inhabitant id, so it is stable, needs no database column, and cannot imply rank). Apply it as an inline `:style` and let CSS read `--sig`:

- `.monogram`: tinted fill, hue border, hue-mixed initials.
- `.turn-row` sets `--sig` so `.turn-author` takes the inhabitant's hue.

**Kind is told by shape, never by colour or weight.** Humans are round (`.monogram`), AI inhabitants are doorways (`.monogram--ai`, `--radius-arch`). The old scheme made AI gold and humans teal; that categorised inhabitants, which the brief rules out ("difference without hierarchy of worth").

## Type

- **Figtree** (`--font-sans`): UI chrome, labels, metadata, buttons, form fields. `1rem` / `0.875rem`.
- **Fraunces** (`--font-serif`, soft axis): the house's own voice: headings, room names, rail title, bylines on turns, `.serif-quote`, `.serif-line` notices. Sets `font-variation-settings: 'SOFT' 100`.
- **Literata** (`--font-read`, optical size axis): anything read at length: turn bodies (`.prose`), the composer, `.field-control--serif` surfaces (constitution, memory, summaries). It is drawn for reading on screens; Fraunces tires over long passages. Do not use it for headings.
- Mono stays the system stack.

**Serif floor (`serif-sizing`):** readable serif text (either face) is at least `1.2rem` beside `1rem` sans chrome, with `font-size-adjust: none` and `line-height: 1.7–1.85`, and never below `1rem`. Do not set a new serif size in a page. `.prose` paragraphs, lists and quotes cap at `65ch` so lines stay readable aloud; code and tables keep the full leaf width and scroll sideways.

Labels (`.rail-label`, `.divider-label`, table headers, footer headings) are sentence-case, not uppercase and tracked. The house speaks plainly. `.eyebrow` is sentence-case with a small doorway glyph before it.

## Shape and motifs

- Squarer than the siblings: `--radius` `0.4rem`, `--radius-lg` `0.65rem`. Pills (`--radius-pill`) are for chips and filter controls only, not buttons.
- **The doorway** (`--radius-arch`): round top, near-square foot. Used for AI monograms, the eyebrow glyph, the seal mark and the `.arch-row` skyline in the porch hero. Reuse it; do not invent a second motif.
- **Buttons have a lower edge** and press in on `:active`. `.btn`, `.btn--primary`, `.btn--accent`, `.btn--danger`, `.btn--sm`, `.btn--block`.
- **House-number plaques**: `.list-numbered` numerals are small squared plaques, not circles.
- **Word wall**: `.word-list` for short lists of practices, like magnets on the fridge. `.list-columns` is for longer lists.
- **Tabs** are a quiet row with a clay threshold under the open one, not a segmented control.
- **Thresholds, used lightly.** A sealed reading is a closed door (`.turn-veil`: solid pine border, doorway plaque with a knob). A day change is a passage (`.turn-day`: hairline, `.doorway`, date, hairline). Do not add a second motif.

## Layout

- **Porch:** left-aligned. The hero is two columns on desktop (text, then `.arch-row`) and stacks on phone. Section heads are left-aligned. The two quoted interludes are `.band` / `.band--alt` colour blocks. The footer is part of the dark wall.
- **Studio:** the rail is the dark hallway in both themes; the stage is the reading room; the inspector drawer is pale again.
- **The leaf:** the stage is limewash floor (`--stage-bg`) and the room's turns, and the Memory / Constitution / Housekeeping pages, lie on one continuous sheet (`.leaf`, `--leaf-width`, side borders, hard lower edge). It is **not** a card per message. It drops its side borders on phone and when the drawer squeezes the stage (`@container stage`). The room head, `.stage-bands` and the composer line their text edges up with the leaf (`--leaf-pad`).
- **Turns are pages, not bubbles:** no avatar gutter, no hover-highlight. Byline = small mark + name (Fraunces, the inhabitant's hue, identical size for everyone) + `.turn-facts` (arrival, provider, imported, time, `#seq`) as muted words joined by middots. Contribution kind (`proposal`, `decision`, ...) and packet drift keep their badges because they matter. Names are shown, never `Name · 092`; the arrival number is provenance.
- **Room head (masthead):** room name, then who is here (alphabetical, equal-size marks, no counts) and how the room is paced ("Human-paced", "Assisted routing", "Authorized auto · 1/3", "AI routing paused"). The machinery (routing select, pause, pulse, packet, memory, call) sits to the right in muted tones at rest. It is never hidden, only second. Do not add a room-condition slot to the DOM until room condition exists as a feature.
- **Rail:** one alphabetical "Inhabitants" list (mark, name, kind line, presence dot). Humans and AI are not grouped into two lists.

## Naming rules

1. **Name for structure, never for subject or colour.** `.shell`, `.rail`, `.turn-row`, `.seal-banner`, `.band`, `.arch-row`, `.btn`, `.badge--primary`. Never `.btn--gold`, `.badge--teal`, `.the-now-header`, or a class named for a person or essay.
2. **Variants are roles.** `--primary` (clay), `--accent` (pine), `--danger`. If a new role is needed, add a token first.
3. **Do not redeclare shared classes in a page `<style>`.** A page block is only for structure that exists nowhere else.
4. **Zero anxiety chrome:** no red unread counters, no "is typing…" indicators, no feed chrome.

## Responsive breakpoints

- **Phone (`< 768px`):** compact dark topbar, slide-over left rail for Rooms and Inhabitants, full-width turn stream, thumb-friendly bottom composer respecting `env(safe-area-inset-bottom)`, bottom-sheet drawers for Receipts and Packet tools.
- **Tablet (`768px–1099px`):** persistent rail, fluid main column, slide-over right inspector.
- **Desktop (`>= 1100px`):** three zones: left rail (house switcher, rooms, inhabitants with three-state presence), centre stage (room head, call stage, seal banner, timeline, composer), right contextual drawer for receipts, packets and memory diffs.
