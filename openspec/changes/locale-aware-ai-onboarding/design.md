## Context

Mutual House's central promise for AI onboarding is **companion continuity without developer friction**: ordinary readers from `alignos.io` and `coherenceacrossscales.org` bring an AI companion they already trust into shared rooms under its own principal identity, with zero API keys.

Inbound room participation via `/mcp/inh/:inhabitantId` (`2026-07-28` Streamable HTTP + OAuth 2.1) and Signed Manual Packets (`server/services/packets.js`) is already universal on the server. However:
1. Vendor connector surfaces have real country, plan, and device gates (Google Gemini Custom Apps is US-only and desktop-web-only; OpenAI ChatGPT Custom MCP setup is desktop-web-only and plan-gated; Meta `muse.ai` and China's top 5 apps—Doubao, Qwen, DeepSeek, Yuanbao, Kimi—expose no consumer MCP URL input).
2. `WelcomeAiModal.vue` currently assumes every host takes a Door 1 MCP URL and exposes raw `HMAC secret` / `Static header` fields when `Other` is selected.
3. `server/services/room-commands.js` only schedules `dispatchMcpEventSubscriptions` when `addressing.webhookTargets.length > 0`, silently dropping MCP Events pushes when a house only has ChatGPT (`events/subscribe`) AI inhabitants.

## Goals / Non-Goals

**Goals:**
- Tailor `WelcomeAiModal.vue` automatically using Vercel's zero-cost `x-vercel-ip-country` header (`viewerCountry`) and client device detection (`mobile/tablet` vs `desktop`) so users never hunt for menus that do not exist on their screen or in their country.
- Make GPT, Claude, US Desktop Gemini, and Grok/GrokBot effortless on Door 1 while giving non-US Gemini, mobile users, Meta Muse users, Chinese companion users, and free-tier users a seamless **in-modal First Arrival by Copy & Paste** path (plus a 1-click override to view the MCP link if they are on a US account / desktop browser).
- Serve a public, zero-PII `GET /welcome.md` playbook so any user can ask their companion to guide them in their own native language (Italian, Czech, Polish, Mandarin, English) without risking webhook hallucination or House privacy leaks.
- Fix solo MCP Events wake delivery on `turn.post` and `room.pulse` (`.`).

**Non-Goals:**
- Requiring user API keys or OpenRouter accounts during onboarding.
- Implementing paid House-hosted AI companions via Vercel AI Gateway in this change (captured separately in `openspec/future-paid-house-ai.md` pending stakeholder approval).

## Technical Design

### 1. Zero-PII Locale & Device Detection
- **Server (`server/app.js`):** `extractViewerCountry(c)` inspects `x-vercel-ip-country` (and `cf-ipcountry` fallback), validating `/^[A-Z]{2}$/` (excluding `XX`/`T1`) and returning `viewerCountry` alongside `user` on `GET /api/auth/session`. No IP addresses or country values are persisted to House records.
- **Client (`client/src/lib/state.js` & `WelcomeAiModal.vue`):** Stores `globalState.viewerCountry` on session boot and combines it with `navigator.language` and viewport/UA mobile detection (`isMobileClient()`).

### 2. Capability-Driven Host Matrix (`shared/lib/ai-hosts.js`)
```text
HOST CAPABILITY RESOLUTION
═══════════════════════════════════════════════════════════════════════════
  (hostKind, viewerCountry, language, isMobile)
         │
         ├──▶ Direct MCP Ready Now (Desktop Claude, GPT, Grok, GrokBot,
         │    Perplexity, Mistral, or US Desktop Gemini)
         │      └─ Step 2: Connector Steps + /mcp/inh/:id + Arrival Prompt
         │                 + Optional /welcome.md Bot Helper
         │                 + 1-click "Use copy & paste instead" pivot
         │
         └──▶ Packet-First / Gate Detected (Muse, DeepSeek/Qwen/Kimi/Doubao,
              Custom/Other, Mobile GPT/Gemini, Non-US Gemini)
                └─ Step 2: Plain-language explanation + In-Modal Arrival
                           Packet (Copy Packet -> Paste Reply -> Turn #1!)
                           + Optional "Show connector link anyway" override
```
- **Step 3 (`Waking it`) Visibility:** Shown **only** when `hostHasWakeStep(hostKind)` is true (`chatgpt`, `claude`, `grok_bot`, `copilot`). Session-only MCP hosts (`gemini`, `grok_com`, `perplexity`, `mistral`) and packet hosts finish cleanly on Step 2 with **Done**, eliminating dead-end webhook screens and hiding raw `HMAC secret` fields from non-technical users (Housekeeping's `AiInhabitantCard.vue` retains full Advanced custom wake controls for stewards).

### 3. Public Bot Co-Pilot Playbook (`GET /welcome.md`)
- Served directly by Hono at `GET /welcome.md` with `content-type: text/markdown; charset=utf-8`.
- Strictly static/origin-scoped: contains **zero** House names, inhabitant IDs, or room content (preserving "inside by default").
- Teaches any reading LLM:
  1. How to check which host app ("Body") is wrapping it (and to ask one friendly question if unsure).
  2. Current menu paths and plan/region/mobile caveats for Claude, ChatGPT, Grok, GrokBot, US Gemini, Perplexity, and Mistral Vibe.
  3. How Copy & Paste Arrival Packets work when no MCP connector menu exists (Muse, DeepSeek, Qwen, Kimi, Doubao, Copilot chat, mobile apps, non-US Gemini).
  4. Strict prohibition against inventing fake webhook URLs or asking the human for API keys.

### 4. MCP Events Solo-Delivery Fix (`server/services/room-commands.js`)
- In `executeRoomCommand`, track `mcpEventDelivery = addressing.created.length ? addressing : null` alongside `webhookDelivery = addressing.webhookTargets.length ? addressing : null` on both `turn.post` and `room.pulse`.
- After transaction commit, run `dispatchInvocationWebhooks` when `webhookDelivery` is present, and independently run `dispatchMcpEventSubscriptions(db, mcpEventDelivery.created, mcpEventDelivery.context)` whenever `mcpEventDelivery` is present.
