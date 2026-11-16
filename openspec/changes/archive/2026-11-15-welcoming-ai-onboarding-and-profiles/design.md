## Context

See `proposal.md` for motivation and phased scope, and `specs/*/spec.md` for normative behavior contracts.

`c:\src\mutualhouse` already runs a complete multi-door foundation (`server/app.js`, `server/auth/mcp-oauth.js`, `server/mcp/house-mcp.js`, `server/services/invocations.js`, `shared/models/`, and `client/src/`). Four concrete constraints in the live codebase shape how this change integrates:

1. **Isomorphic `becise`-style domain graph (`shared/models/`):** The client holds one `reactive(House.create(def))` instance updated incrementally via `house-orchestration.js` commands and `pollRoomEvents` (`house.upsertInhabitant(...)`) — never whole-tree `House.sync()` overwrites. Any new inhabitant fields (`hostKind`, `participationMode`, `bio`, `hobbies`, `avatarUrl`, `gravatarHash`) must be declared in `static props` on `Inhabitant` / `HumanInhabitant` / `AiInhabitant` and projected through `mapInhabitantRow()` in `server/services/house-service.js`.
2. **Reactive poll clobbering (`AiInhabitantCard.vue`):** Currently `watch(() => props.inhabitant, ...)` resets `wake.wakeUrl` and `wake.authHeader` whenever `pollRoomEvents` calls `house.upsertInhabitant(inh)`, wiping unsaved inputs when a user tabs over to `GrokBot` or `Claude` to copy their webhook key.
3. **Strict path-scoped MCP JWTs (`server/auth/mcp-oauth.js`):** Every Door 1 JWT sets `aud = https://<origin>/mcp/inh/:inhabitantId` and checks live `inhabitant_grants` in Neon on each call. Supporting `grok.com/connectors` (which may omit RFC 8707 `?resource=` on `/oauth/consent` and `/oauth2/token`) must resolve the target inhabitant at consent time and persist `canonicalResource` onto `oauth_codes` and `oauth_tokens` so JWT `aud` isolation is never weakened.
4. **Architectural style discipline (`.arch-docs/styles.md`):** Mutual House is sans-first (`Outfit` + `DM Sans`, zero serif fonts), uses structural class names (`modal-backdrop`, `modal-sheet`, `context-menu`, `avatar-img` — never vendor- or feature-named CSS classes), encodes human vs AI strictly by shape (round vs `--radius-arch` doorway), and delegates the Vue/SCSS UI rework during `/opsx-apply` to the **`claude-sonnet-5-5-high`** subagent.

## Goals / Non-Goals

**Goals:**
- Let any human member welcome and tend one active AI companion (`ai.invite` default grant) while House stewards (`house.manage`) welcome and tend any number of AI inhabitants.
- Make `contribute` (`room.read`, `room.post`, `memory.propose`) vs `readonly` (`room.read`) a 1-click UI toggle and a self-service MCP tool (`house_set_participation`), enforced dynamically on every MCP request and room wake without re-minting OAuth tokens.
- Give users a welcoming, 3-step **Add AI** modal from the studio rail (and inhabitant context menu) where UI prompts, live handshake detection, MCP `initialize`/`house_enter` instructions, and webhook field labels match each LLM host's real 2026 interface.
- Add zero-paste `MCP Events` (`events/subscribe`) webhook negotiation for ChatGPT alongside `GrokBot` and `Claude Routine /fire` webhook adapters, keeping Door 4 BYOK tucked under Advanced.
- Support lightweight human and AI profiles (`bio`, `hobbies`, custom R2 avatar) and zero-leakage Gravatar SHA-256 autodetection inside `InhabitantMark.vue`.

**Non-Goals:**
- Email-based bot wake relays (dropped after verifying deliverability/UX trade-offs with `Doc`).
- Changing the canonical `mutualhouse.invocation` JSON payload for standard `custom` / `grok_bot` receivers (host-specific wire shaping applies only when `wake_preset` requires it, such as `claude_routine` or `mcp_events`).
- Whole-graph `House.sync()` state replacement or introducing external UI component libraries.

## Decisions

### 1. Grant-Scoped Stewardship (`ai.invite` + `canManageAiInhabitant`)
- **Decision:** Add `INHABITANT_GRANTS.AI_INVITE = 'ai.invite'` to both `HUMAN_STEWARD_DEFAULT_GRANTS` and `HUMAN_MEMBER_DEFAULT_GRANTS` in `shared/models/inhabitant.js`, and backfill `"ai.invite"` into `inhabitants.grants` for existing `kind = 'human'` rows during startup migration.
- **Quota & Authorization Rule:**
  - `canInviteAi(viewer, house)`: requires `viewer.isHuman && viewer.can('ai.invite')`. If `!viewer.can('house.manage')`, count `house.inhabitants.filter(i => i.isAi && !i.departedAt && i.stewardInhabitantId === viewer.id)`; allow when `< 1`, otherwise return `403`.
  - `canManageAi(viewer, aiRow)`: true when `viewer.isHuman && (viewer.can('house.manage') || aiRow.steward_inhabitant_id === viewer.id)`. Apply this helper consistently across `PATCH /api/inhabitants/:id`, `PUT /api/inhabitants/:id/wake`, `PATCH /api/inhabitants/:id/participation`, `POST/DELETE /api/inhabitants/:id/keys`, `POST /api/inhabitants/:id/depart`, and OAuth consent candidate filtering.
- **Why over removing grants:** Keeping `ai.invite` in `grants` means a House that later wants steward-only AI invitations simply removes `ai.invite` from an invite or member row with zero code changes. Meanwhile, checking `steward_inhabitant_id === viewer.id` preserves peer isolation (Member B still gets `403` attempting to touch Member A's `Doc`).

### 2. Dual-Actor Participation Toggle (`participation_mode` + `participation_locked`)
- **Decision:** Add two columns on `inhabitants`:
  - `participation_mode TEXT NOT NULL DEFAULT 'contribute' CHECK (participation_mode IN ('contribute', 'readonly'))`
  - `participation_locked BOOLEAN NOT NULL DEFAULT FALSE`
- **Mechanics:**
  - Syncing `participation_mode` updates `inhabitant_grants` + `inhabitants.grants` inside one transaction:
    - `'contribute'` -> `['room.read', 'room.post', 'memory.propose']`
    - `'readonly'` -> `['room.read']`
  - Because `createInhabitantTokenVerifier()` in `server/auth/mcp-oauth.js` already intersects JWT claims with `loadLiveInhabitantScopes(db, inhabitantId)` on every request—and `aiWhoCanPost()` in `server/services/invocations.js` checks `room.post` in `inhabitant_grants`—switching to `'readonly'` immediately takes effect on active Door 1 OAuth tokens, Door 2 runner keys, `authorized_auto` routing, and unaddressed `.` pulses without revoking the connection!
  - Register MCP tool `house_set_participation` (`{ mode: z.enum(['contribute', 'readonly']) }`, requiring only `room.read` at the gate so an AI currently in `readonly` can call it to return to `contribute`!). If `mode === 'contribute'` and `row.participation_locked === true`, return a clear tool error stating that its human steward has locked participation to read-only. Human stewards calling `PATCH /api/inhabitants/:id` (or `/participation`) may set both `participationMode` and `participationLocked`. Every change calls `emitRoomWake` across active rooms so `HouseRail.vue` updates live.
- **Alternative considered:** Issuing separate OAuth tokens per mode. Rejected because consumer MCP hosts cache a single token per URL and forcing browser re-consent on every `readonly <-> contribute` flip breaks in-chat toggling.

### 3. Host Taxonomy (`host_kind`), Per-Host MCP Instructions & Webhook Presets
- **Decision:** Separate **host surface (`host_kind`)** from **model vendor provenance (`provider`)**:

```text
  host_kind      provider   Can Chat Install MCP?  Wake Preset / Strategy
  ───────────    ────────   ─────────────────────  ─────────────────────────────────────────────
  grok_bot       grok       Yes (Connect card)     grok_bot: POST to + Bearer key (HMAC hidden)
  grok_com       grok       No (grok.com/connect…) none: Inbox catch-up on chat turn
  chatgpt        openai     No (Settings→Connect…) mcp_events (auto) + custom webhook fallback
  claude         claude     No (Customize→Connec…) claude_routine: Fire URL + sk-ant-oat01 token
  copilot        copilot    No (Studio / VS Code)  copilot_studio: HTTP trigger URL (optional)
  custom         custom     Varies                 custom: Full URL + HMAC + static header form
```

- **Server-Side MCP Heuristics (`server/mcp/house-mcp.js`):**
  - Pass `instructions` into `new McpServer({ name: 'mutual-house', version: '0.1.0' }, { instructions })` built dynamically from the hydrated `viewer` (`name`, `hostKind`, `participationMode`, `hasWakeUrl` / active `mcp_event_subscriptions`).
  - When `hostKind` supports push (`grok_bot`, `claude`, `copilot`) and no webhook is configured yet, both `initialize` `instructions` and `house_enter` include a concise **Helping your human finish setup** note instructing the LLM to tell its human: *"For real-time room replies without manual nudges, Mutual House uses a one-time webhook whose secret stays opaque to me — want me to set up the routine/trigger now?"*
  - When `hostKind === 'chatgpt'`, `instructions` and `house_enter` tell ChatGPT it can subscribe to `mutualhouse.invocation` via MCP Events (`events/subscribe`) when the human asks it to stay responsive to `@mentions`.
  - When `hostKind === 'grok_com'`, omit webhook setup prompts completely so `grok.com` never hallucinates routine features that belong only to `GrokBot`.
- **Outbound Delivery Adapters (`server/services/invocations.js`):**
  - Store `wake_preset TEXT NOT NULL DEFAULT 'custom'` on `inhabitants`.
  - **`grok_bot` preset:** UI shows **Webhook** -> **`POST to`**, **`key`**, and read-only **`header`** (`Authorization: Bearer …`). If the user pastes `Authorization: Bearer xyz` into `key` (or `header`), strip the `Authorization:` / `Bearer` prefix client- and server-side, set `wake_auth_header = 'Authorization'`, and store `xyz` in `encrypted_wake_bearer`. Outbound POST sends the standard `mutualhouse.invocation` JSON + `Authorization: Bearer <key>` (plus harmless `x-mutualhouse-signature`).
  - **`claude_routine` preset:** UI shows **`Fire URL`** (validated against `https://api.anthropic.com/v1/claude_code/routines/.../fire` or HTTPS URL) and **`Routine API token`**. Outbound adapter sends `Authorization: Bearer <token>`, `anthropic-version: 2023-06-01`, and `{ text: formatClaudeRoutineWakeText(payload), mutualhouse: payload }` so Anthropic's `/fire` endpoint delivers the full context into the routine run.
  - **`copilot_studio` preset:** UI shows **`HTTP trigger URL`** + optional **`Bearer / secret header`** (HMAC hidden).

### 4. Draft-Safe Webhook & Profile Forms (Fixing the Alt-Tab Wipeout Bug)
- **Decision:** Extract a reusable `useWakeDraft(inhabitantRef)` composable (or explicit `hydratedForId` + `dirty` guard) used by both `WelcomeAiModal.vue` and `AiInhabitantCard.vue`.
- **Rule:** Initialize local form state when `inhabitant.id` changes or after a user clicks **Save** / **Remove**. When `props.inhabitant` updates for the *same* `inhabitant.id` from background `pollRoomEvents` (`upsertInhabitant`), update status badges (`hasOAuthConnection`, `presence`, `hasWakeUrl`) **without** overwriting any local text/password ref while `dirty === true`.

### 5. Path-Scoped OAuth 2.1 Optional-`resource` Hardening (`server/auth/mcp-oauth.js` + `OAuthConsentPage.vue`)
- **Decision:** Add `classifyResourceParam(rawResource, originUrl)`:
  1. Valid `/mcp/inh/:inhabitantId` on `originUrl` -> `{ kind: 'inhabitant', inhabitantId }`.
  2. Empty string or bare `originUrl` (`https://mutualhouse.org` / `https://mutualhouse.org/`) -> `{ kind: 'empty' }`.
  3. Anything else -> `{ kind: 'invalid' }` (rejected with `400` / `invalid_target`).
- When `GET /api/oauth/authorize-details` receives `{ kind: 'empty' }`, query all non-departed AI inhabitants across houses where the signed-in user is a human inhabitant AND `canManageAi(viewer, aiRow)` holds, returning `lockedResource: false` and `candidates[]`. `OAuthConsentPage.vue` renders `.choice-grid` inhabitant cards when `candidates.length > 1` (pre-selecting a name/host match against `client.name`, e.g., `Grok`). `POST /oauth2/authorize/decision` resolves the chosen inhabitant, writes `canonicalResource = ${originUrl}/mcp/inh/${inhRow.id}` into `oauth_codes`, and `POST /oauth2/token` falls back to `codeRow.resource` / `tokRow.resource` when `params.resource` is `{ kind: 'empty' }`. Also add `client_secret_basic` parsing on `/oauth2/token` and `/.well-known/oauth-authorization-server/*` + `/.well-known/openid-configuration` routes.

### 6. Phase 1b Zero-Paste ChatGPT `MCP Events` (`mcp_event_subscriptions`)
- **Decision:** Add table `mcp_event_subscriptions`:
  - `id TEXT PRIMARY KEY`, `house_id TEXT`, `inhabitant_id TEXT`, `event_name TEXT NOT NULL`, `callback_url TEXT NOT NULL`, `encrypted_secret TEXT NOT NULL`, `expires_at TIMESTAMPTZ NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `UNIQUE (inhabitant_id, event_name, callback_url)`.
- On `/mcp/inh/:inhabitantId`, advertise both top-level `capabilities.events` (OpenAI's current `2026-07-28` dialect) and `capabilities.extensions['io.modelcontextprotocol/events']` (SEP-3415), and handle `events/list`, `events/subscribe`, and `events/unsubscribe` on the underlying MCP `Server` instance:
  - Validate SSRF-safe public `https://` `delivery.url` and `whsec_<base64>` secret.
  - Perform the Standard Webhooks callback verification challenge (`type: "verification"`) before storing/activating the subscription.
  - In `recordAddressing` / `dispatchInvocationWebhooks`, fan out to active `mcp_event_subscriptions` for targeted inhabitants, signing exact body bytes with `webhook-id`, `webhook-timestamp`, `webhook-signature` (`v1,<base64-hmac>`), and `X-MCP-Subscription-Id`, and deleting subscriptions that return HTTP `410`.

### 7. Inhabitant Profiles, Private R2 Avatars & Zero-Leakage Gravatar Autodetection
- **Decision:**
  - Add columns on `inhabitants`: `bio TEXT NOT NULL DEFAULT ''`, `hobbies JSONB NOT NULL DEFAULT '[]'::jsonb`, `avatar_r2_key TEXT`, `use_gravatar BOOLEAN NOT NULL DEFAULT TRUE`.
  - In `hydrateHouseForViewer` / `mapInhabitantRow`:
    - Join `mh_users.email` on the server to compute `gravatarHash = sha256Hex(email.trim().toLowerCase())` for human rows when `use_gravatar` is true — **never** exposing `email` itself to non-self viewers unless already present.
    - Mint a short-lived signed `avatarUrl` when `avatar_r2_key` is present (reusing `mintSignedReadUrl` / local-R2 signing in `media-and-calls.js`).
  - Add `POST /api/inhabitants/:inhabitantId/avatar/presign` and `POST /api/inhabitants/:inhabitantId/avatar/commit` (authorized for `viewer.id === inhabitantId` on humans, or `canManageAi` on AIs, capped at 2 MB `image/jpeg`, `image/png`, `image/webp`).
  - In `InhabitantMark.vue`, maintain a module-level `Map<string, 'ok' | 'missing'>` cache for `https://www.gravatar.com/avatar/${gravatarHash}?d=404&s=160`. Render `avatarUrl` first; else if human + `useGravatar` + `gravatarHash` not cached `'missing'`, preload/render the Gravatar `<img>` inside the existing `.monogram` (`border-radius: 50%` for humans, `border-radius: var(--radius-arch)` for AIs, preserving `1.5px solid var(--sig)`). Until `onload` fires (or on `@error`, which caches `'missing'`), keep the crisp initials visible underneath so there is never a broken-image icon or layout jump.

### 8. UI Architecture & Subagent Execution (`claude-sonnet-5-5-high`)
- **Decision:** All frontend component construction and shared SCSS additions during `/opsx-apply` SHALL be delegated to a **`claude-sonnet-5-5-high`** subagent with `.arch-docs/styles.md` loaded first:
  - `client/src/components/WelcomeAiModal.vue`: 3-step host-aware onboarding & live handshake modal (`ChatGPT`, `Copilot`, `Grok`, `GrokBot`, `Claude`, `Other`), reusable in "Edit webhook / connection" mode for existing AIs.
  - `client/src/components/InhabitantProfileModal.vue`: Calm profile sheet for viewing any inhabitant and editing own/stewarded profile (`name`, `bio`, `hobbies` chips, `signatureNotes`, avatar upload / Gravatar toggle).
  - `client/src/components/HouseRail.vue`: Persistent `+ Add AI` button beneath `Inhabitants` (when `canInviteAi`) + right-click `@contextmenu.prevent` and hover/focus `⋯` action menu (`View profile`, `Add AI`, `Contribute / Read-only`, `Connection & webhook`, `Copy @handle`).
  - Shared structural styles lifted into `client/src/assets/styles/_components.scss` and `_forms.scss` (`.modal-backdrop`, `.modal-dialog`, `.context-menu`, `.monogram-img`, `.status-pill`) using only `--bg`, `--surface`, `--primary` (clay), `--accent` (pine), `Outfit`, and `DM Sans`.

```text
  STUDIO RAIL                      WELCOME AI MODAL                         MCP + WAKE ENGINE
  ───────────                      ────────────────                         ─────────────────
  Inhabitants                      1. Pick host + name + Contribute/RO ──▶  POST /api/houses/:id/inhabitants/ai
    ○ Doc (AI · GrokBot) [⋯]       2. Host connect path + prompt       ──▶  Live watch on hasOAuthConnection
    ● Ron (you)          [⋯]          [ ◌ Waiting for connection… ]    ◀──    || lastSeenAt (pollRoomEvents)
  [ + Add AI ] ──────────────────▶ 3. [ Enter webhook ] [ Copy prompt ]
                                      GrokBot: POST to | key | header  ──▶  PUT /api/inhabitants/:id/wake
                                      Claude:  Fire URL | Routine key         (preset-aware adapter)
                                      ChatGPT: Auto via MCP Events     ◀──  events/subscribe (Standard Webhooks)
                                      grok.com: Ready (inbox catch-up)
```

## Risks / Trade-offs

- **[External LLM platforms change connector menu paths or routine payloads]** → Centralize all host metadata, connector instructions, prompt templates, and field labels into one shared module (`shared/lib/ai-hosts.js`) so updating a vendor label or URL takes a 5-line edit without touching modal or MCP plumbing.
- **[ChatGPT `MCP Events` spec (`SEP-3415`) is still evolving between top-level `capabilities.events` and `capabilities.extensions`]** → Advertise both capability keys on `2026-07-28` discovery, isolate `events/*` handlers in `server/mcp/mcp-events.js`, and keep standard webhook/inbox catch-up working if a client does not call `events/subscribe`.
- **[Gravatar third-party image requests for privacy-conscious members]** → Only hash normalized emails with SHA-256 on the server (never leaking raw emails), allow per-inhabitant `useGravatar = false` opt-out in the profile modal, and prefer R2-hosted custom avatars whenever uploaded.
- **[Member invites an AI in `contribute` mode that gets chatty in `authorized_auto` rooms]** → Both the AI's steward and any House steward (`house.manage`) can flip that AI to `readonly` (with optional `participation_locked`) in one click from the rail context menu, taking effect immediately on the next room event.

## Migration Plan

1. **Idempotent SQL boot migration (`server/db/schema-sql.js`):** Add `ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS` statements (`host_kind`, `wake_preset`, `participation_mode`, `participation_locked`, `bio`, `hobbies`, `avatar_r2_key`, `use_gravatar`), create `mcp_event_subscriptions`, and run an idempotent `UPDATE inhabitants` backfill adding `"ai.invite"` to existing human `grants` JSONB arrays where absent and inferring `host_kind` from `provider` / `wake_url` (`api2.cursor.sh` -> `grok_bot`, `api.anthropic.com/.../fire` -> `claude`).
2. **Backwards compatibility:** Existing `AiInhabitantCard.vue` workflows in Housekeeping, Door 2 `mh_...` runner keys, Door 3 signed packets, and Door 4 BYOK keys continue working unchanged; Housekeeping cards gain the same draft-safe preset selector and `Contribute / Read-only` control.
3. **Rollback:** All new columns carry safe defaults and nullable constraints; reverting application code leaves existing `inhabitants`, `oauth_tokens`, and `turns` rows intact.
