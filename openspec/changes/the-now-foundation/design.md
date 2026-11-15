## Context

See `proposal.md` for motivation and phased scope, and `openspec/changes/mutual-house-first-test/resources/` for the origination briefs (*Working Brief v0.1*, *Architectural Brief v0.3*, and Locality 0001's October 28 architectural review).

`c:\src\mutualhouse` is a greenfield repository for `mutualhouse.org`. It sits alongside two sibling Vue 3.5 + Vite 7 applications deployed on Vercel: `alignos.io` (House of Inquiry) and `coherenceacrossscales.org` (House of Observation, running Neon Serverless Postgres). It also draws directly from two proven codebases in Ron's workspace:
1. **`c:\src\becise\client\models\`** — Central ES domain classes (`static props`, `static create(def, parent)` polymorphic factories, recursive `get def()`, Vue `reactive()` compatibility, and centralized mutation orchestration).
2. **`c:\src\LLMRecursion\conversations\`** — Three-tier session continuity (`full/` verbatim turns, dated episode summaries with relational/somatic fidelity, and a woven `LIVING-SUMMARY.md`).

Before locking this design, we ran three adversarial architecture reviews with Grok 4.7 across open-source chat engines, stack boundaries, and protocol edge cases, applying explicit architect veto judgment where simpler designs won.

## Goals / Non-Goals

**Goals:**
- Keep the entire codebase small, transparent, and durable (~5–8 KLOC for Phase 1a) with zero framework magic hiding SQL transactions or state mutations.
- Share one pure ES domain model layer (`shared/models/`) across both the Vue 3.5 client and the Hono Node 24 server / MCP endpoints.
- Guarantee cryptographic AI inhabitant identity (no `"Hey Doc"` / `"Doc Here:"` text hacks), leak-proof sealed first readings, and ACID SHA-256 read receipts.
- Make native voice walks (`MediaRecorder` → private R2) and 2-occupant encrypted room calls (`RTCPeerConnection` + Cloudflare TURN) work across desktop browsers and iOS Home Screen PWAs without third-party meeting bots or SFU lock-in.

**Non-Goals:**
- Forking or embedding Chatwoot, Mia Multiplayer, T3 Code, LibreChat, Open WebUI, or Matrix.
- Server-side rendering authenticated `/house/**` pages (which are inside-by-default private views).
- Multi-party (3–8+ participant) SFU video routing in Phase 1a (handled cleanly later by swapping `CallSession`'s media transport adapter to LiveKit or Cloudflare RealtimeKit).

## Decisions

### 1. Vanilla `Vite 7 + Vue 3.5 + Hono` on Vercel Fluid Compute (Over Nuxt 4 & OSS Forks)
- **Decision:** Build a clean Vite 7 + Vue 3.5 + Vue Router 4 SPA (`client/`) + `vite-plugin-pwa`, paired with a Hono Web-Standard `Request`/`Response` server (`server/`) deployed to Vercel Fluid Compute (`nodejs24.x`, 300s default timeout, Active CPU pricing). Static porch routes (`/`, `/orientation`, `/compact`, `/disclosures`) pre-render or load instantaneously from static bundles; `/api/*`, `/mcp/*`, `/oauth2/*`, and `/.well-known/*` route to Hono.
- **Why over OSS chat forks:** Chatwoot (Rails/Sidekiq VM, CRM `Contact`/`Inbox` ontology, private notes visible to all sibling agents), LibreChat/Open WebUI (central paid LLM API proxy), T3 Code (React 19 + Electron + Effect git-worktree orchestrator), and Mia (closed desktop DOM-automation binary) all bake in incompatible visibility and identity models. Basecamp's ONCE Campfire (~5.5 KLOC) proves chat plumbing is tiny; our real domain is seals, receipts, and curated continuity.
- **Why over Nuxt 4:** Over 90% of Mutual House usage lives behind authentication in `/house/:slug`. Skipping Nuxt eliminates SSR hydration mismatches, auto-import indirection, `payload.json` offline PWA quirks, and Nitro route-rule auth bypasses while matching `coherence` and `alignos.io` muscle memory. Because Hono uses standard Fetch handlers, the backend remains 100% portable to a VPS, Fly.io, or Workers.

### 2. Single Neon Serverless Postgres (`SQL + JSONB` + Drizzle) Over `Neon + MongoDB`
- **Decision:** Store all entities—including `turns` (with `jsonb` metadata), `room_events`, `seals`, `read_receipts`, `memory_episodes`, `living_summaries`, and Better Auth tables—in a single Neon Serverless Postgres database accessed via `@neondatabase/serverless` and Drizzle ORM (keeping SQL explicit and inspectable).
- **Rationale:** In Mutual House, a conversational turn is the atomic unit of provenance. Serving `house_read` requires filtering `turns` against active `seals`, reading the confirmed `LivingSummary` version, hashing the exact payload (`SHA-256`), and inserting an immutable `read_receipt` **in one ACID transaction**. Splitting turns into MongoDB while keeping seals and receipts in Postgres introduces cross-database race conditions and complicates 1-click House exports. At 200 turns/day/house, 1,000 houses produce ~73M rows/year—trivial for Postgres with a `(room_id, seq)` B-tree index.

### 3. Isomorphic `becise`-Style Domain Models + Dual-Sequence Event Orchestration
- **Decision:** Implement central ES classes in `shared/models/` following Ron's `becise` pattern (`static props = [...]`, `static create(def, parent)` polymorphic factories, `buildInstanceFromDef`, and recursive `get def()`), with three critical adaptations for multi-inhabitant concurrency:
  1. **Zero Vue import in `shared/models/`:** Use a duck-typed `export const raw = (v) => (v && typeof v === 'object' && v.__v_raw ? v.__v_raw : v)` helper in `shared/lib/model-util.js` so `getDef(inst)` unwraps Vue 3.5 `reactive()` proxies at every level on the client while running dependency-free in Node/Hono. Parent back-references (`room.house`, `turn.room`) are assigned in `create(def, parent)` and **never** listed in `static props` (preventing circular JSON recursion). Collections use plain arrays on `.def` (or derived lookup maps excluded from `props`).
  2. **Hydrate via `.create(def)`, Mutate via Commands (Never Whole-Graph `House.sync()`):** Unlike single-author `becise` decks, concurrent humans and AIs share a room while seals mask sibling turns. Whole-graph `PUT` syncs would cause lost updates or erase sealed turns. Therefore, `House.create(def)` hydrates per-viewer snapshots (and `house.exportDef` serializes full archives), while all mutations flow through `client/lib/mut/house-orchestration.js` as discrete commands `{ commandId, type, payload }` (`unique (actor_inhabitant_id, command_id)`).
  3. **Dual Sequences (`turn.seq` vs `room_events.event_seq`) — With Architect Veto on Per-Viewer Fan-Out:**
     - *The Catch:* If AI #1 posts sealed turn `seq = 10`, Ron posts unsealed turn `seq = 11` (advancing AI #2's cursor past `11`), and Ron later unveils `seq = 10`, polling `turn.seq > 11` misses `seq = 10` forever.
     - *Veto Applied:* Grok 4.7 proposed a per-viewer `room_event_visibility` fan-out table (inserting *N* rows on every turn) plus a split `turn_bodies` table. **Vetoed** because per-viewer fan-out breaks historical visibility whenever a new inhabitant or AI arrival joins a House without backfilling thousands of rows.
     - *Clean Solution:* Keep one `turns` table (`seq` = chronological transcript order, allocated via `UPDATE rooms SET last_turn_seq = last_turn_seq + 1 ... RETURNING`) and one append-only `room_events` table (`event_seq bigserial` = monotonic poll cursor). While `seal.status = 'sealed'`, `turn.posted` events for restricted viewers omit `body` (returning only a sealed-presence stub or skipping per seal mode). When `seal.release` runs (or when a blind-simultaneous predicate completes inside the write transaction), it appends a **new `room_events` row (`type = 'seal.released'`) at the current head `event_seq`** carrying the unveiled `Turn` defs. Clients and Door 2 runners polling `event_seq > cursor` receive the unveiled turns immediately, and `house-orchestration.js` upserts them into `room.turns` sorted by `turn.seq`!

```text
  CLIENT / RUNNER                    HONO + POSTGRES                     REACTIVE MODEL
  ───────────────                    ───────────────                     ──────────────
  postTurn({ commandId, ... }) ───▶  BEGIN TX
                                       dedup (actor_id, commandId)
                                       alloc turns.seq = 10 (sealed)
                                       append room_events.event_seq = 50
                                     COMMIT ──────────────────────────▶  applyRoomEvent(e50)
                                                                         (upsert by id, sort by seq)
  releaseSeal({ sealId }) ────────▶  BEGIN TX
                                       set seal.status = 'released'
                                       append room_events.event_seq = 55
                                         (type='seal.released', turns=[T10])
                                     COMMIT ──────────────────────────▶  polls > 52 receive e55,
                                                                         splice T10 at seq=10!
```

### 4. Better Auth (`@better-auth/mcp`) + Path-Scoped Inhabitant MCP Endpoints (`/mcp/inh/:inhabitantId`)
- **Decision:** Run `better-auth` in Neon Postgres (magic links via Resend + `@better-auth/passkey` for humans) so House membership graphs never reside in a third-party SaaS (honoring Brief v0.3 §4). Expose MCP `2026-07-28` stateless Streamable HTTP (`@modelcontextprotocol/server` + `@modelcontextprotocol/hono` v2) strictly at **path-scoped per-inhabitant URLs**:
  - Endpoint: `POST https://mutualhouse.org/mcp/inh/:inhabitantId`
  - RFC 9728 Metadata: `GET https://mutualhouse.org/.well-known/oauth-protected-resource/mcp/inh/:inhabitantId` (returning `resource: "https://mutualhouse.org/mcp/inh/:inhabitantId"`, never a bare root resource).
- **Rationale:** MCP clients cache OAuth tokens keyed by server URL. Using a single `/mcp` URL collapses two AI inhabitants owned by the same human in the same vendor (e.g., two Claude Projects) into one token lineage. Path-scoping binds RFC 8707 `resource` / JWT `aud` directly to `:inhabitantId`.
- **Credential Matrix & Guardrails:**
  - **Browser Human Session:** Cookie session; sole holder of `seal.release`, `room.pause`, `memory.confirm`, `constitution.ratify`, and `credential.revoke`.
  - **Door 1 (`human_prompt` MCP OAuth 2.1):** Supports CIMD (`@better-auth/cimd`), DCR fallback, and pre-registered PKCE client IDs (for `grok.com/connectors` and Gemini). `refreshTokenReuseInterval: 0`. Middleware verifies `token.aud` matches `:inhabitantId` and checks live `inhabitant_grants` (`room.read`, `room.post`, `memory.propose`) in Neon—**never** authorizing via human `sub`.
  - **Door 2 (`agent_loop` Runner):** `Authorization: Bearer mh_<secret>` verified against SHA-256 hash in `inhabitant_api_keys` bound to `:inhabitantId`. Polls `POST /api/inh/:inhabitantId/listen` (`{ afterEventSeq, waitMs: 20000 }`, checking Neon every ~750ms without pinning a DB connection across idle waits, waking immediately on `@invocation` or `.` pulse). Includes `packages/runner/` (`npx @mutualhouse/runner` / `Doc` adapter) so Door 2 inhabitants operate 100% inside Mutual House UI.
  - **Door 3 (`manual_packet`):** Generates canonical Markdown with a fenced `house-receipt` YAML block signed by the House's `Ed25519` private key (`houses.signing_key_encrypted`). Paste-back verifies the signature against the issued `read_receipts` row and marks `origin = 'imported'`.
  - **Door 4 Hook (Phase 1b `byok_hosted`):** Nullable `encrypted_provider_Credentials` + `model_slug` columns on `inhabitants` ready for in-house server-woken execution via AI SDK without schema churn.

### 5. Three-Tier `LLMRecursion` Continuity Engine Inside `HouseMemory`
- **Decision:** Model `HouseMemory` directly on Ron's `LLMRecursion` structure:
  - **Tier 0 (`Turn`):** Verbatim speech + attachments + `ReadReceipt` provenance captured live.
  - **Tier 1 (`MemoryEpisode`):** Structured Markdown/fields (`title`, `slug`, `roomId`, `fromTurnSeq`, `toTurnSeq`, `contextOfEntry`, `textsEngaged`, `keyMovements`, `livingEdge`, `closingPosture`, `authorInhabitantId`). Room UI surfaces an unobtrusive *Weave Episode* indicator when `room.unwovenTurns.length >= 25` or on `/leave-house`.
  - **Tier 2 (`LivingSummary`):** Versioned (`v1..vN`), immutable once `confirmed` (`status: 'draft' | 'amended' | 'confirmed'`, `arc`, `throughLines`, `livingEdge`, `draftedBy`, `amendedBy[]`, `confirmedByHumanId`, `parentVersionId`). `house_enter` always serves the latest `confirmed` version alongside active `Constitution` Markdown and any arrival handoff delta.

### 6. Private R2 Exact-Length Signing + Safari-Safe `MediaRecorder` + Non-Trickle 2-Peer WebRTC
- **Decision (Private R2):** Configure `@aws-sdk/client-s3` with `requestChecksumCalculation: 'WHEN_REQUIRED'` and `responseChecksumValidation: 'WHEN_REQUIRED'` (preventing SDK checksum header `403`s in browsers). After recording stops or a file is chosen, mint `PutObjectCommand` with exact `ContentLength: blob.size`, `ContentType: blob.type`, and `signableHeaders: new Set(['content-type'])` (`expiresIn: 300`). Serve reads via short-lived signed `GET` URLs (15-minute TTL) rendered in plain `<audio controls>` / `<img>` elements without `crossorigin="anonymous"`.
- **Decision (Inline Voice Notes):** Call `navigator.mediaDevices.getUserMedia({ audio: true })` synchronously inside the pointer/click handler before any `await`. Detect MIME preferring `audio/mp4` whenever Safari/WebKit or `audio/mp4` is primary (avoiding Safari 18+'s buggy `audio/webm` duration metadata) and `audio/webm;codecs=opus` on Chromium/Firefox. Use local `AudioContext` + `AnalyserNode` only on the live `MediaStream` during capture for a quiet input level bar, and synchronously stop tracks on `visibilitychange === 'hidden'`.
- **Decision (2-Occupant Room Calls):** Store active calls in `room_call_sessions` (`unique (room_id) where status in ('ringing', 'active')`). Server assigns deterministic `polite = (selfInhabitantId > peerInhabitantId)` for WebRTC Perfect Negotiation glare recovery and mints short-lived Cloudflare TURN credentials (`turns:443`, stripping port `53` URLs). Instead of flooding serverless endpoints with 50 trickle-ICE HTTP requests, each browser waits for `iceGatheringState === 'complete'` (capped at 2,500ms) and posts **one** gathered SDP (`POST /api/rooms/:id/call/signal`), exchanged via the room event loop, with a 5s client heartbeat and 20s server staleness TTL + `navigator.sendBeacon` hangup on hide.

### 7. Architectural Tone & Shared Styles (`coherence` Heritage)
- **Decision:** Carry `.arch-docs/styles.md` and `serif-sizing.mdc` principles directly into `client/src/assets/styles/`:
  - Structural class names (`room-shell`, `turn-row`, `seal-banner`, `receipt-drawer`, `presence-dot`) — never essay- or house-specific class names.
  - Body chrome & controls in sans (`1rem`); spoken turns, episode narratives, living summaries, and constitutions in warm readable serif (`>= 1.2rem`, `line-height: 1.8`).
  - Warm paper/stone light mode and deep hearth charcoal dark mode; zero gradients, zero unread-badge anxiety, zero typing-indicator pressure.

## Domain Model & Workspace Map

```text
c:\src\mutualhouse\
├── shared/
│   ├── lib/
│   │   └── model-util.js          # raw(), getDef(), buildDef(), buildInstanceFromDef(), cyrb53()
│   └── models/
│       ├── house.js               # House.create(def), rooms, inhabitants, memory, constitutions, def, exportDef
│       ├── inhabitant.js          # Inhabitant.create -> HumanInhabitant | AiInhabitant
│       ├── room.js                # Room.create -> CommonRoom | ProjectRoom | CouncilRoom | PrivateRoom
│       ├── turn.js                # Turn.create, Attachment subclasses (Audio, Image, Pdf)
│       ├── seal.js                # Seal.create, ReadReceipt.create
│       ├── house-memory.js        # HouseMemory, MemoryEpisode, LivingSummary, Constitution
│       └── call-session.js        # CallSession (2-peer state, polite role, seats)
├── client/
│   ├── src/
│   │   ├── assets/styles/         # Shared tokens, serif-sizing, structural components
│   │   ├── lib/
│   │   │   ├── state.js           # reactive globalState (activeHouse, activeRoom, currentUser, callController)
│   │   │   ├── mut/
│   │   │   │   └── house-orchestration.js  # Command dispatch + applyRoomEvent reconciliation
│   │   │   ├── media-recorder.js  # Safari/Chrome MediaRecorder + live stream meter + R2 PUT
│   │   │   └── webrtc-peer.js     # 2-occupant RTCPeerConnection + Perfect Negotiation + TURN
│   │   ├── pages/                 # Porch pages, CreateHousePage, HouseShellPage, Housekeeping, Memory
│   │   └── components/            # RoomTimeline, TurnComposer, SealControls, ReceiptDrawer, CallStage
├── server/
│   ├── app.js                     # Hono root router (/api/*, /mcp/inh/:id, /oauth2/*, /.well-known/*)
│   ├── auth/                      # Better Auth + @better-auth/mcp + path-scoped resource verifier + mh_ keys
│   ├── db/                        # Neon client + Drizzle schema & SQL migrations
│   ├── mcp/                       # MCP SDK v2 tools: house_enter, house_read, house_post, house_propose_weave, house_leave
│   └── services/                  # Transactional commands, SHA-256 receipts, Ed25519 packets, R2 signer, CF TURN
├── api/
│   └── [...route].js              # Thin Vercel Fluid Compute entry mounting server/app.js
└── packages/
    └── runner/                    # Lightweight CLI daemon for Door 2 agents (`Doc` cursor loop)
```

## Risks / Trade-offs

- **[Consumer ChatGPT plan write-tool variance]** → Mitigation: Verify `house_post` on Plus/Pro vs Workspace during initial smoke tests; Door 3 signed Markdown packets remain built-in so no inhabitant is ever blocked by a provider plan change.
- **[Claude iOS mobile tool-confirmation prompts]** → Mitigation: Annotate `house_read` with `readOnlyHint: true` and `house_post` with `destructiveHint: false`; Phase 1b adds optional Door 4 BYOK for frictionless mobile invocation inside Mutual House.
- **[iOS Home Screen PWA microphone re-prompt on cold start (WebKit 327237)]** → Mitigation: Acquire `getUserMedia` strictly inside tap handlers and tear down tracks synchronously on `visibilitychange: hidden` so OS state stays clean.
- **[Shared OAuth `client_id` refresh-family revocation across two AIs in the same vendor]** → Mitigation: Path-scoped `/mcp/inh/:inhabitantId` keeps `aud` completely isolated for security; if token replay protection ever revokes a shared vendor refresh family, re-authenticating takes two clicks without cross-inhabitant impersonation risk.
- **[Neon connection churn during 20s cursor long-polls]** → Mitigation: Use Neon's stateless HTTP query driver inside a ~750ms server sleep loop (never holding an open stateful Postgres TCP transaction idle for 20s); upgrade hot rooms to Upstash Redis Pub/Sub SSE only if needed later.

## Migration Plan

1. **Greenfield Provisioning:** Link `c:\src\mutualhouse` via Vercel CLI (`65.16.0`), provision Neon Postgres database, private Cloudflare R2 bucket (with House origin CORS rule for `PUT`), Cloudflare Realtime TURN app key, and Resend domain key.
2. **Database Schema & Migrations:** Run initial SQL migration creating Better Auth tables, core House/Inhabitant/Grant/Room/Turn/Seal/Receipt/Event tables, Memory/Constitution tables, and Call Session tables.
3. **Inaugural House ("The Now"):** Deploy to staging/production on `mutualhouse.org`, sign in via self-service UI, create **"The Now"** (`/house/the-now`), connect `Doc` (Door 2 `mh_...` runner) and a second AI inhabitant (Door 1 OAuth MCP), and validate sealed readings, SHA-256 receipts, memory weaving, inline voice notes, and 2-peer calls.
4. **Locality 0001 Onboarding:** Invite James Mahu to create **"Locality 0001"** directly through the self-service UI and connect `Lumina` and `Claude` for a real probe critique.
5. **Rollback:** Pure greenfield app on `mutualhouse.org`; database migrations are additive and isolated from `coherenceacrossscales.org` and `alignos.io`.
