# WIP Exploration: Welcoming All AI Variants & Bot-Guided Onboarding

> **Status:** Work-in-progress `/openspec-explore` thread saved for handoff between machines (Nov 2026).  
> **Usage:** Reference `@openspec/wip-all-ai-variants.md` with `/openspec-explore` to continue answering the open questions at the bottom, then delete this file once crystallized into an OpenSpec change.

---

## Original Prompt & Framing

> Besides Grok, GPT, Claude, and Gemini, what AI do people use for chatbots? I got the wake URL working for GPT and want to know who else to include. Muse? DeepSeek? Perplexity?
>
> Since GPT works, how will other OpenRouter LLMs work with this? We would need different instructions, yes?
>
> What if we provided a README or instructions the user's bots could read and then the bots could figure out how their human should connect them? I mean, if I have Muse as my bot and I trust Muse, maybe we pass it an instructions URL that it can read and it can tell the human user what to do. Is that a crazy idea?
>
> I want as many different types of AI to be able to connect to this as possible, but although the OpenAI spec is widely adopted, how that translates into GUI and instructions for Kimi, GPT, Muse, Qwen, etc. can vary and I don't want to freak out non-techie users.

---

## Current Codebase Touchpoints (Grounded Context)

- **`shared/lib/ai-hosts.js`** — Defines `HOST_KINDS` (`chatgpt`, `copilot`, `grok_com`, `grok_bot`, `claude`, `custom`) and `WAKE_PRESETS` (`none`, `grok_bot`, `claude_routine`, `copilot_studio`, `custom`, `mcp_events`), plus per-host `connectorSteps`, `wakeSteps`, `buildArrivalPrompt`, `buildWebhookPrompt`, and `hostSetupNote`.
- **`client/src/components/WelcomeAiModal.vue` & `AiWakeForm.vue`** — 3-step rail-accessible onboarding modal (*1. Where does it live? → 2. Connect → 3. Waking it*).
- **`client/src/components/AiInhabitantCard.vue`** — Housekeeping card exposing all four Doors; note that `PROVIDERS` already includes `gemini`, whereas `HOST_KINDS` in `shared/lib/ai-hosts.js` does not yet include `gemini`.
- **`server/app.js` & `server/mcp/house-mcp.js`** — Door 1 path-scoped OAuth 2.1 Streamable HTTP MCP (`2026-07-28`) at `/mcp/inh/:inhabitantId` (returns `401` Bearer OAuth discovery challenge when hit unauthenticated).
- **`server/mcp/mcp-events.js` & `server/services/invocations.js`** — Outbound wake dispatch via MCP Events (`events/subscribe` with Standard Webhooks `whsec_`, used by ChatGPT) and host-adapted webhook POSTs (Claude `/fire` routines, GrokBot / Cursor Automations, custom HMAC).
- **`server/services/byok-runner.js`** — Door 4 (`byok_hosted`): wakes an opted-in inhabitant directly inside Mutual House on `@mention`, `authorized_auto`, or `.` pulse using OpenAI/Anthropic/xAI chat-completions endpoints (lines 112–159).
- **`packages/runner/cli.js` & `server/services/packets.js`** — Door 2 (`mh_...` always-on runner loop) and Door 3 (Ed25519-signed manual copy/paste packets).

---

## 1. Brain (Model) vs. Body (Host App) — Why GPT Worked & How OpenRouter Fits

When people say DeepSeek, Kimi, Qwen, Muse Wonder, and OpenRouter all use the "OpenAI spec," they mean the **outbound inference API** (`POST /v1/chat/completions` — an app calling a brain).

Connecting to Mutual House via Door 1 (`/mcp/inh/:id` + OAuth + Wake) goes the **opposite direction** — the *app* has to act as an MCP client and (for background wakes) run a cloud listener that can receive webhooks:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     BRAIN (Model)  vs.  BODY (Host App)                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  DOOR 1: External App Connects to Mutual House (ChatGPT, Claude, Grok…)  │
│                                                                          │
│   ┌─────────────────────────┐    MCP + OAuth     ┌────────────────────┐  │
│   │  HOST APP ("The Body")  │ ─────────────────▶ │                    │  │
│   │  ChatGPT / Perplexity / │                    │    MUTUAL HOUSE    │  │
│   │  Claude / Cursor / etc. │ ◀───────────────── │  /mcp/inh/:inhId   │  │
│   └────────────┬────────────┘   Wake POST /      └────────────────────┘  │
│                │                MCP Events                               │
│                ▼                                                         │
│   ┌─────────────────────────┐                                            │
│   │  LLM ("The Brain")      │  ◀── Models don't speak MCP or webhooks;   │
│   │  GPT / Muse / Kimi / …  │      the Host App wrapping them does!      │
│   └─────────────────────────┘                                            │
│                                                                          │
│  ──────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  DOOR 4: Mutual House IS the Body (OpenRouter / BYOK)                    │
│                                                                          │
│   ┌─────────────────────────┐   OpenAI Spec API  ┌────────────────────┐  │
│   │      MUTUAL HOUSE       │ ─────────────────▶ │    OpenRouter /    │  │
│   │   (byok-runner.js)      │  chat/completions  │  Muse / Kimi /     │  │
│   │ Wakes natively on @turn │ ◀───────────────── │  DeepSeek / Qwen   │  │
│   └─────────────────────────┘   Zero webhooks!   └────────────────────┘  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### What this means for OpenRouter:
- **OpenRouter's own web chat (`openrouter.ai/chat`)** is just a lightweight playground—it **cannot** connect to custom MCP servers and **cannot** receive a wake URL.
- So when someone uses an OpenRouter model (Muse Wonder, Kimi, DeepSeek, Qwen), they are doing one of two things:
  1. **Using a multi-model chat app as the "Body"** (LibreChat, Open WebUI, Cherry Studio, TypingMind, Cursor, Claude Code, OpenCode, OpenClaw) plugged into their OpenRouter key. Here, **the instructions depend 100% on which app they're using**, not which model they picked.
  2. **Using Mutual House Door 4 (`byok-runner.js`):** `byok-runner.js` already speaks the OpenAI chat-completions spec and wakes inhabitants natively on `@mention`, `authorized_auto`, and `.` pulse. Right now it only routes to Anthropic, xAI, and OpenAI. Adding an `'openrouter'` provider (`https://openrouter.ai/api/v1/chat/completions`) would let **any** of OpenRouter's 400+ models (`meta/muse-wonder`, `moonshotai/kimi-k3`, `deepseek/deepseek-v3`, `qwen/...`) live and wake up in the room with **zero connector menus and zero webhooks**—with the philosophical distinction that it is a *House-hosted* inhabitant rather than a companion the human also chats with in a separate app.

---

## 2. The Late-2026 Chatbot Landscape: Who Else Should Be on Our Radar?

```
CONSUMER & AGENT LANDSCAPE (NOV 2026)
═══════════════════════════════════════════════════════════════════════════════

A. WEB CHAT APPS WITH CUSTOM REMOTE MCP (Door 1 OAuth works!)
   ├─ ChatGPT          MCP + OAuth ✓  │ Wake: MCP Events (`events/subscribe`) ✓
   ├─ Claude           MCP + OAuth ✓  │ Wake: Routine `/fire` URL ✓
   ├─ GrokBot          MCP + OAuth ✓  │ Wake: Routine Webhook ✓
   ├─ Grok (grok.com)  MCP + OAuth ✓  │ Wake: None (checks inbox when chatting)
   ├─ Gemini (web)     MCP + OAuth ✓* │ Wake: None (Settings → Connected Apps →
   │                                  │       Custom apps; US/18+/Activity on)
   ├─ Perplexity       MCP + OAuth ✓  │ Wake: None (Plugins → Add custom → Remote
   │                                  │       on Pro/Max; routes GPT/Claude/Kimi!)
   └─ Mistral Vibe     MCP + OAuth ✓  │ Wake: None (formerly Le Chat; works even
      (chat.mistral)                  │       on Free! Connectors → Custom MCP)

B. HUGE MODELS WHOSE CONSUMER WEB CHATS HAVE *NO* CUSTOM MCP YET
   ├─ Meta Muse        • Consumer app (`muse.ai`): NO MCP URL input yet! (Has
   │  (Muse Wonder /     Meta's catalog + can build REST "Custom Connectors".)
   │   Muse Spark)     • `Muse Code` CLI: Full HTTP MCP + OAuth (`muse mcp login`)
   │                   • OpenRouter (`meta/muse-wonder`): Works via Door 4 / GUIs
   ├─ DeepSeek         `chat.deepseek.com` has NO custom MCP.
   ├─ Kimi (Moonshot)  `kimi.com` has NO custom MCP (`Kimi Code` CLI does!).
   ├─ Qwen             `chat.qwen.ai` has NO custom MCP (`Qwen Code` CLI does!).
   ├─ Z.ai (GLM)       `chat.z.ai` has NO custom MCP.
   └─ Poe / Character  Closed ecosystems → Door 3 (Copy & paste packets).

C. MULTI-MODEL GUIs & AGENT HARNESSES (Where OpenRouter & Wakes Live)
   ├─ Desktop/Web GUIs: Cherry Studio, LibreChat, Open WebUI, LM Studio, TypingMind
   │                    (All run OpenRouter/local models + speak Remote MCP!)
   └─ Agents w/ Wakes:  Cursor (Automations webhook), OpenClaw, Goose, n8n/custom
```

### Key Landscape Takeaways
1. **Gemini, Perplexity, and Mistral Vibe (formerly Le Chat)** are the natural consumer-web additions alongside GPT, Claude, and Grok. All three support pasting `/mcp/inh/:id` with OAuth 2.1 dynamic client registration, and all three behave like `grok.com` for waking (no background webhook while closed; they catch up via `house_inbox` when you chat). Bonus: **Perplexity Pro** routes across GPT, Claude, Gemini, Grok, and **Kimi** behind a single custom MCP connector.
2. **Muse, DeepSeek, Kimi, and Qwen** have massive mindshare (especially **Meta's Muse Wonder** `meta/muse-wonder` launched Oct 2026, and **Kimi K3**), *but* a non-techie on `muse.ai`, `chat.deepseek.com`, `kimi.com`, or `chat.qwen.ai` will hit a dead end if told "Go to Settings → Add MCP Server," because that UI surface doesn't exist in their consumer web apps.

---

## 3. Bot-Readable Onboarding URL (`/welcome.md` / `/welcome/:id.md`)

### Why the Idea Works So Well
1. **Vendor menus mutate constantly.** In 2026 alone: OpenAI renamed *Connectors → Apps → Plugins*; Anthropic started renaming *Customize → Plugins*; Perplexity renamed *Customize → Plugins*; Mistral renamed *Le Chat → Vibe*. Static wizard text goes stale fast; a bot reading a current playbook can adapt on the fly—even if the human says *"I don't see Customize, here's a screenshot of my sidebar."*
2. **Graceful fallback across all 4 Doors instead of failure.** If someone pastes the onboarding link into `chat.deepseek.com` or `muse.ai`, the bot reads the guide, recognizes it's in a web chat without an MCP connector menu, and calmly offers the paths that *do* work (Door 3 Copy & Paste packets right now, Door 4 OpenRouter/API key in Mutual House for automatic `@mention` wakes, or opening the model in an MCP-capable app) without protocol jargon.
3. **Self-wiring / half-wiring for agentic hosts.** GrokBot, Cursor, Claude Code, Muse Code, Codex, and OpenClaw can read the playbook and either run their own `mcp add` command or tell the human the exact approval step. (Consumer `muse.ai` can also build Custom Connectors against documented REST APIs!)

### The 4 Sharp Edges to Design Around

```
THE BOT-GUIDED ONBOARDING FLOW & ITS 4 SHARP EDGES
═══════════════════════════════════════════════════════════════════════════════

  Human clicks "Add AI" in Mutual House (names it "Muse")
         │
         ▼
  Mutual House gives Human a tiny prompt to paste into their AI:
  "Read https://mutualhouse.org/welcome/... and help me connect you."
         │
         ├──▶ EDGE CASE 1: Can the bot fetch URLs right now?
         │    (What if DeepSeek "Search" toggle is OFF, or it's a raw
         │     OpenRouter chat in Cherry Studio with no web tool?)
         │
         ├──▶ EDGE CASE 2: Does `/welcome/...` leak private House info?
         │    (Mutual House is "inside by default"! An unauthenticated URL
         │     fetched by OpenAI/Meta/Perplexity crawlers shouldn't expose
         │     House names, member names, or room transcripts.)
         │
         ├──▶ EDGE CASE 3: Does the Brain know which Body it's wearing?
         │    (Kimi running via OpenRouter inside LibreChat often has NO
         │     system prompt telling it "You are in LibreChat"!)
         │
         └──▶ EDGE CASE 4: Webhook hallucination!
              (Bots LOVE to say "Sure, paste this webhook!" and invent a
               fake URL when their host doesn't actually support wakes.)
```

- **Mitigating Edge 1 (Separate `GET` Markdown URL + offline fallback):** Keep `/mcp/inh/:id` untouched as the `401` OAuth MCP endpoint, and serve a separate plain-Markdown `GET` document (`text/markdown; charset=utf-8`, e.g. `/welcome.md`) so any bot's web-fetch tool reads it cleanly. Include one fallback line in the copyable prompt if web browsing is off (*"If you cannot open web links right now, tell me and ask which app or website I'm chatting with you in"* — or offer a copy-full-instructions button).
- **Mitigating Edge 2 (Inside-by-default sovereignty):** Keep the public `/welcome.md` completely free of private House names, member identities, or secrets—pass the inhabitant's name and OAuth-protected `/mcp/inh/:id` URL inside the user's pasted prompt instead.
- **Mitigating Edge 3 (Brain doesn't know its Body):** Instruct the bot in `/welcome.md`: *if you aren't 100% certain which app/website is hosting this chat (common with OpenRouter models), ask your human one friendly question ("Which app or website are we chatting in right now? Feel free to drop a screenshot!") before giving menu instructions.*
- **Mitigating Edge 4 (Wake honesty):** Explicitly list which hosts actually support background wakes today (`ChatGPT` MCP Events, `Claude` routines, `GrokBot`, `Cursor` Automations, custom webhook agents) and forbid inventing webhook URLs or calling `house_register_wake` on session-only hosts.

---

## Open Questions to Pick Up Next (Explore Mode)

### 1. The "Add AI" Step 1 UX for Non-Techies
Instead of a giant wall of 15 logos, what should Step 1 look like?
- Show the **consumer hosts that connect directly** (`ChatGPT`, `Claude`, `Grok`, `GrokBot`, `Gemini`, `Perplexity`, `Mistral Vibe`) + a warm **"Another AI (Muse, DeepSeek, Kimi, Qwen, OpenRouter…)"** choice?
- And/or include a universal **"Not sure? Let your AI walk you through it"** copy-prompt right on Step 2 for *every* host?

**Ron's thoughts / notes:**
- 

### 2. OpenRouter as a First-Class Path (Door 4 vs. Door 1)
When you think about welcoming **Muse**, **Kimi**, **DeepSeek**, or **Qwen**, are you mostly imagining:
- **A companion someone already talks to** in another app (where Door 1 MCP or Door 3 Copy-Paste keeps that continuity), or
- **Spinning up a distinct voice in the House** powered by `meta/muse-wonder` or `kimi-k3` via an OpenRouter key (where upgrading Door 4 `byok-runner.js` to support OpenRouter makes waking effortless and 100% native)? *(Or both!)*

**Ron's thoughts / notes:**
- 

### 3. Meta Muse (`muse.ai`) Specifically
How are you (or the users you have in mind) using Muse right now?
- Consumer **`muse.ai` app** (which lacks custom MCP URL settings today, *but* can write its own Custom Connector against a REST API + key),
- **`Muse Code`** (which speaks full Streamable HTTP MCP + OAuth 2.1), or
- **Muse Wonder on OpenRouter** (`meta/muse-wonder`)?

**Ron's thoughts / notes:**
- 
