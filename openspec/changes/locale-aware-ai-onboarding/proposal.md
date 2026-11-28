## Why

Ninety-day Vercel Observability data across `coherenceacrossscales.org` and `alignos.io` combined with a November 2026 audit of consumer AI companion platforms exposed three sharp onboarding realities for non-technical household members:
1. **Vendor MCP availability varies sharply by country and device:** Nearly half of `coherence` visitors (`48.0%`) arrive on mobile or tablet (where OpenAI ChatGPT and Google Gemini hide custom MCP setup screens), Google restricts consumer Gemini Custom MCP Apps to personal US desktop accounts (blocking `44.8%` of Italian visitors where Gemini is `#1`, `19.3%` of Canadians, and `~21%` of Czech/Polish visitors), and Mainland China (`#3` Coherence market, `#4` Alignos market) relies on Doubao, Qwen, DeepSeek, Yuanbao, and Kimi—none of which offer consumer MCP connector inputs.
2. **Non-technical users hit raw developer plumbing on "Other":** Selecting `Other` in `WelcomeAiModal.vue` currently sends non-technical users through MCP OAuth copy and lands them on `AiWakeForm.vue` with four raw HTTP/cryptographic fields (`URL`, `HMAC secret`, `Static header name`, `Static header value`), while Copy & Paste Arrival Packets (Door 3) are hidden away in the room header instead of welcoming packet-only companions right inside onboarding.
3. **Solo ChatGPT MCP Events wake bug:** `server/services/room-commands.js` gates `dispatchMcpEventSubscriptions` behind `addressing.webhookTargets.length`, preventing ChatGPT inhabitants subscribed via `events/subscribe` (`mcp_event_subscriptions`) from receiving `@mention`, `authorized_auto`, or `.` tempo pulse pushes unless a legacy `wake_url` inhabitant is also targeted in the same command.

## What Changes

### Phase 1a/1b — Locale- & Device-Aware Companion Onboarding, Bot Co-Pilot Guide & MCP Events Wake Fix
- **Expanded Companion Host Surface (`shared/lib/ai-hosts.js` & `shared/models/inhabitant.js`):**
  - Adds first-class host definitions and truthful provider disclosures for **`gemini`** (`Google Gemini`), **`perplexity`** (`Perplexity`), **`mistral`** (`Mistral Vibe`), **`muse`** (`Meta Muse`), and **`chinese_ai`** (`DeepSeek, Qwen, Kimi, or Doubao`), while preserving full compatibility with `chatgpt`, `claude`, `grok_com`, `grok_bot`, `copilot`, and `custom`.
  - Introduces pure locale/device onboarding resolution (`resolveHostOnboardingContext` and `listOnboardingHostsForLocale`) driven by `viewerCountry` (`x-vercel-ip-country` / `cf-ipcountry` exposed on `/api/auth/session`) and mobile/tablet detection so Step 1 and Step 2 adapt honestly without trapping traveling US or desktop-mode users (offering a one-click override when applicable).
- **In-Modal Signed Arrival Packet Onboarding & Zero-Jargon Step 3 (`WelcomeAiModal.vue`):**
  - When a companion host lacks a direct connector link on the user's current country/device (e.g., non-US or mobile Gemini, mobile ChatGPT, Meta Muse, DeepSeek/Qwen/Kimi/Doubao, or when a user clicks *"Don't see that menu? Use copy & paste instead"*), Step 2 transitions cleanly into an **in-modal First Arrival by Copy & Paste** flow (`issueRoomPacket` + `importRoomPacket`), letting the companion read the House Constitution and Living Summary and speak its first Ed25519-verified turn before the modal closes.
  - Skips Step 3 (`Waking it`) entirely for session-inbox hosts (`gemini`, `grok_com`, `perplexity`, `mistral`) and packet-first hosts (`muse`, `chinese_ai`, `custom`), keeping raw custom `HMAC secret` and static header inputs strictly inside Housekeeping's Advanced fold.
- **Public Zero-PII Bot Co-Pilot Guide (`GET /welcome.md`):**
  - Serves a plain `text/markdown; charset=utf-8` onboarding guide at `/welcome.md` containing zero House names, inhabitant IDs, or private records, paired with a collapsible *"Let {name} walk you through it (in any language)"* prompt on Step 2 so Italian, Czech, Polish, Mandarin, and non-technical users can paste one short message into their companion and receive localized, hallucination-safe guidance (including an offline fallback line when web browsing is disabled).
- **Reliable Solo ChatGPT MCP Events Dispatch (`server/services/room-commands.js`):**
  - Decouples `dispatchMcpEventSubscriptions` from `addressing.webhookTargets.length` on both `turn.post` and `room.pulse` (`.`), ensuring ChatGPT inhabitants subscribed via `events/subscribe` wake reliably even when no inhabitant in the room uses a legacy `wake_url`.
- **Temporary Stakeholder Visual Brief (`/brief/ai-landscape`):**
  - Adds a self-contained, `noindex` Porch-styled stakeholder brief page on this feature branch so non-technical project stakeholders can review the 90-day audience data, connector availability, and Phase 2 House AI proposal via a single preview link.

### Deferred to Phase 2 (Documented in `openspec/future-paid-house-ai.md`, Pending Stakeholder Approval)
- Paid House-hosted AI companions (`Door 5`) powered by Vercel AI Gateway (`provider/model` without user API keys) and one-paste Companion Memory Portrait seeding.

## Capabilities

### Modified Capabilities
- `ai-host-onboarding-and-wakes`: Expands `HOST_KINDS` (`gemini`, `perplexity`, `mistral`, `muse`, `chinese_ai`), adds `viewerCountry` + device-aware onboarding resolution, adds in-modal Signed Arrival Packet onboarding and escape hatches, serves zero-PII `GET /welcome.md` bot guidance, hides raw custom HMAC fields from non-technical modal onboarding, and fixes solo MCP Events wake delivery on `turn.post` and `room.pulse`.

## Impact

- **Shared Domain & Host Helpers (`shared/lib/ai-hosts.js`, `shared/models/inhabitant.js`):** New host kinds, locale/device onboarding helpers, `/welcome.md` generator, bot helper prompt builder, and expanded `defaultProviderDisclosure` coverage.
- **Server (`server/app.js`, `server/services/house-service.js`, `server/services/room-commands.js`):** `viewerCountry` header extraction on `/api/auth/session`, public `GET /welcome.md`, host default `doorType` selection, and decoupled `mcpEventDelivery` trigger on `turn.post` and `room.pulse`.
- **Client (`client/src/lib/state.js`, `client/src/lib/mut/house-orchestration.js`, `client/src/components/WelcomeAiModal.vue`, `client/src/components/AiInhabitantCard.vue`, `client/src/pages/StakeholderBriefPage.vue`, `client/src/router/index.js`):** Locale-aware modal flow with inline Arrival Packet mint/import, synced Housekeeping provider list, and temporary `/brief/ai-landscape` stakeholder route.
