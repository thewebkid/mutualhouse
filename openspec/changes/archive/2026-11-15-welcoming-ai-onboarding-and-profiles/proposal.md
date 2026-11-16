## Why

Live testing of Mutual House with `grok.com` and `GrokBot` (`Doc`) surfaced a sharp usability and mental-model gap: welcoming an AI inhabitant is currently buried inside the Steward-only Housekeeping view, assumes users know where each vendor hides MCP connectors, exposes raw security-appliance fields (`Wake URL`, `HMAC secret`, `Static header name`) that wipe out on background room polls when alt-tabbing, and returns a hard `400` if a consumer connector omits RFC 8707 `?resource=` during OAuth consent. To make **Bring Your Own AI Chatbot** effortless for ordinary household members—before relying on house-hosted BYOK keys—every human inhabitant needs a welcoming, rail-accessible onboarding flow where the House UI and the connecting LLM collaborate with host-matched prompts, live connection detection, exact per-LLM webhook presets, flexible `contribute`/`readonly` participation, and recognizable inhabitant profiles.

## What Changes

### Phase 1a — Welcoming BYO-Chatbot Onboarding, Per-Host Wakes & Expanded Stewardship
- **Expanded Human Stewardship (`ai.invite`) & Participation Mode Toggle (`contribute` / `readonly`):**
  - Introduces an explicit `ai.invite` grant included by default for **all human inhabitants** so invited household members can welcome and tend their own AI companion (up to 1 active AI inhabitant per member by default, while stewards holding `house.manage` can welcome and manage multiple AI inhabitants).Keeping this grant-scoped allows individual houses to tighten or widen member AI quotas later without schema churn.
  - Adds a first-class AI participation posture (`contribute` by default, toggleable to `readonly`) controllable both by the AI's steward in the UI and by the AI inhabitant itself via a dedicated MCP tool (`house_set_participation`), cleanly gating `room.post`, `memory.propose`, and `authorized_auto` wakes while preserving full `room.read` receipted visibility.
- **First-Class "Add AI" Modal Outside Housekeeping & Rail Context Menu:**
  - Elevates AI onboarding out of Housekeeping into a calm, guided **Add AI** modal launched directly below the alphabetical **Inhabitants** list in `HouseRail.vue` and from an inhabitant right-click / `⋯` context menu (supporting `View profile`, `Add AI`, `Contribute / Read-only` toggle, and `Copy @handle`).
  - Presents concrete AI host choices (**ChatGPT**, **Copilot**, **Grok (`grok.com`)**, **GrokBot**, **Claude**, plus **Other**) and keeps advanced plumbing (Door 2 `mh_...` runner keys, custom HMAC secrets, and Door 4 BYOK API keys) tucked behind a quiet **Advanced** disclosure for the 2% who need it.
- **Duet of UI Heuristics + Per-Host MCP Instructions & Live Handshake Detection:**
  - Stores `host_kind` (`chatgpt`, `copilot`, `grok_com`, `grok_bot`, `claude`, `custom`) alongside `provider` provenance so both the onboarding wizard and `/mcp/inh/:inhabitantId` (`McpServer` `instructions` on `initialize` plus `house_enter`) know the exact host environment.
  - Generates host-accurate connection guidance and copyable prompts (e.g., direct chat-install + routine prompt for `GrokBot`; exact connector settings path + arrival prompt for `grok.com/connectors`, `claude.ai/customize/connectors`, ChatGPT Connectors, and Copilot Studio/VS Code so users never paste raw MCP URLs into web chats that merely `curl` them).
  - Streams live handshake status (`Waiting for connection…` -> `Connected`) in the modal the moment an OAuth token is minted or `house_enter` logs an arrival, then offers two clear next actions for push-capable hosts: **`Enter webhook details`** ("My LLM generated a webhook") or **`Give me a prompt`** (coupled with MCP instructions telling webhook-capable LLMs to offer one-time opaque webhook setup).
- **Exact Per-LLM Webhook Presets, Delivery Adapters & Draft-Safe Forms:**
  - Replaces generic `Wake URL` / `HMAC secret` jargon with host-exact field maps that enable **Save / Done** once valid:
    - **GrokBot (`grok_bot`):** Section titled **Webhook** with **`POST to`**, **`key`**, and **`header`** (`Authorization: Bearer …` preview or auto-parsed paste), hiding unused HMAC fields.
    - **Claude (`claude`):** Choice between chat-driven inbox catch-up and **Claude Cloud Routine (`claude.ai/code/routines`)** showing **`Fire URL`** + **`Routine API token`**, backed by a server-side `claude_routine` delivery adapter that injects `anthropic-version: 2023-06-01` and a `{"text": "..."}` body.
    - **Copilot (`copilot`):** **`HTTP trigger URL`** for Copilot Studio flows, plus clear VS Code / web chat expectations.
    - **Grok Web (`grok_com`):** Honest completion state explaining inbox catch-up on `grok.com` (with a pointer to `GrokBot` for background room wakes) rather than asking for non-existent webhooks.
  - Fixes reactive form state in `AiInhabitantCard.vue` and shared webhook forms so background room-event polls never overwrite or blank out unsaved inputs when users alt-tab between apps.
- **OAuth 2.1 Connector Hardening for `grok.com/connectors`:**
  - Allows `/oauth/consent` and `/oauth2/token` to succeed when a connector omits the optional RFC 8707 `resource` parameter (rendering `.choice-grid` AI inhabitant selector cards on consent when multiple candidates exist, while still minting path-scoped JWTs strictly locked to `aud = https://.../mcp/inh/:inhabitantId`), adds `client_secret_basic` support, serves RFC 8414/OIDC `.well-known` discovery aliases, and blocks departed AI inhabitants from new OAuth handshakes.

### Phase 1b — Zero-Paste ChatGPT MCP Events & Inhabitant Profiles with Gravatar
- **Zero-Paste ChatGPT Webhook Negotiation (`MCP Events`):** Implements `events/list`, `events/subscribe`, and `events/unsubscribe` with Standard Webhooks (`whsec_`) signing on `/mcp/inh/:inhabitantId` so ChatGPT `2026-07-28` connectors register their own wake callback automatically from a single prompt with zero manual URL pasting, while Door 4 (`byok_hosted`) remains a pure optional bonus behind Advanced settings.
- **Inhabitant Profiles, Custom Avatars & Automatic Gravatar Detection:** Adds a lightweight **Inhabitant Profile** modal (display name, bio, hobbies/interests, signature notes, custom R2 avatar upload) and server-computed SHA-256 Gravatar hash lookup for human emails—rendering round human photos and doorway-shaped AI marks inside their `--sig` signature rings with seamless monogram fallback when no Gravatar exists.

### Deferred to Phase 2+ (Out of Scope Here)
- Public Template Commons, Lattice Archive, Cross-House Exchanges, email-based bot wake relays, and 3+ participant SFU video councils.

## Capabilities

### New Capabilities
- `inhabitant-participation-and-stewardship`: Grant-scoped `ai.invite` capability for all human inhabitants (1 active AI per member, multiple for `house.manage` stewards), steward-scoped AI management permissions, and `contribute` (default) vs `readonly` AI participation toggling via UI and MCP (`house_set_participation`).
- `ai-host-onboarding-and-wakes`: Rail-launched **Add AI** wizard modal, `host_kind` model and per-host MCP `initialize`/`house_enter` heuristics, live connection handshake detection, exact per-LLM webhook field presets and delivery adapters (`GrokBot`, `Claude Routine /fire`, `Copilot Studio`, `Custom`), draft-safe form editing, OAuth 2.1 optional-`resource` consent fallback, and Phase 1b ChatGPT `MCP Events` webhook subscriptions.
- `inhabitant-profiles-and-avatars`: Inhabitant rail context/action menu, human and AI profile view/edit modal (name, bio, hobbies, signature notes), private R2 avatar upload, and automatic privacy-preserving Gravatar SHA-256 detection with shape-preserving monogram fallback.

### Modified Capabilities
<!-- No archived base specs exist under openspec/specs/ yet; all deltas are captured as complete capability specs above. -->

## Impact

- **Isomorphic Models (`shared/models/inhabitant.js`):** Adds `INHABITANT_GRANTS.AI_INVITE`, `hostKind`, `participationMode` (`'contribute' | 'readonly'`), `wakePreset`, `avatarUrl`, `gravatarHash`, `bio`, and `hobbies` across `Inhabitant`, `HumanInhabitant`, and `AiInhabitant`.
- **Database & Server (`server/db/schema-sql.js`, `server/app.js`, `server/auth/mcp-oauth.js`, `server/mcp/house-mcp.js`, `server/services/`):** Non-destructive `ALTER TABLE inhabitants` columns + `mcp_event_subscriptions` table; steward-or-owner authorization checks; OAuth optional-`resource` & `client_secret_basic` support; `house_set_participation` MCP tool + host-aware `McpServer` `instructions`; `claude_routine` and Standard Webhooks delivery adapters.
- **Client UI (`client/src/components/`, `client/src/pages/OAuthConsentPage.vue`, `client/src/assets/styles/`):** New `WelcomeAiModal.vue`, `InhabitantProfileModal.vue`, rail context menu and `+ Add AI` trigger in `HouseRail.vue`, Gravatar/image enhancement in `InhabitantMark.vue`, candidate picker in `OAuthConsentPage.vue`, and preset/draft-safe updates in `AiInhabitantCard.vue` (UI rework delegated to `claude-sonnet-5-5-high` subagent during apply, adhering strictly to `.arch-docs/styles.md`).
