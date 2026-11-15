## 1. Workspace, Architecture Docs & Database Foundation

- [x] 1.1 Scaffold ESM monorepo/workspace layout (`shared/`, `client/`, `server/`, `api/`, `packages/runner/`), `vercel.ts` / Vite dev proxy config, Vitest setup, and `.arch-docs/` (`README.md`, `styles.md`, `domain-models.md`, `database.md`, `auth-and-mcp.md`, `media-and-calls.md`)
- [x] 1.2 Define Neon Serverless Postgres schema and initial migration (`houses`, `inhabitants`, `inhabitant_grants`, `inhabitant_api_keys`, `house_invites`, `rooms`, `turns`, `attachments`, `seals`, `read_receipts`, `room_events`, `memory_episodes`, `living_summaries`, `constitutions`, `room_call_sessions`, plus Better Auth & OAuth resource tables) including Phase 1b nullable hooks (`encrypted_provider_credentials`, `transcript_turn_id`)
- [x] 1.3 Configure Vite 7 + Vue 3.5 + Vue Router 4 + `vite-plugin-pwa` (ensuring `navigateFallbackDenylist` excludes `/api/*`, `/mcp/*`, `/oauth2/*`, and `/.well-known/*`) and port shared architectural SCSS tokens + `serif-sizing` rules (`1.2x` serif floor, warm light/dark hearth palette)

## 2. Isomorphic `becise`-Style Domain Models (`shared/models/`)

- [x] 2.1 Implement `shared/lib/model-util.js` (`raw()` duck-typed `__v_raw` unwrap with zero Vue import, `getDef()`, `buildDef()`, `buildInstanceFromDef()`, `cyrb53()`, and canonical JSON hashing helpers)
- [x] 2.2 Implement `House`, `Inhabitant` (`HumanInhabitant` | `AiInhabitant`), and `Room` (`CommonRoom` | `ProjectRoom` | `CouncilRoom` | `PrivateRoom`) with `static props`, polymorphic `static create(def, parent)`, non-serialized parent pointers, and `room.visibleTurnsFor(viewer)`
- [x] 2.3 Implement `Turn`, `Attachment` (`AudioAttachment` | `ImageAttachment` | `PdfAttachment`), `Seal`, `ReadReceipt`, `HouseMemory` (`MemoryEpisode`, `LivingSummary`), `Constitution`, and `CallSession` domain classes
- [x] 2.4 Write unit tests verifying round-trip `House.create(def) -> getDef(house)`, Vue 3.5 `reactive(House.create(def))` proxy safety (zero circular JSON recursion), and sealed turn filtering across human and AI viewers

## 3. Self-Service Auth, Public Porch & "The Now" House Formation

- [x] 3.1 Integrate Better Auth in Hono (`server/auth/`) backed by Neon Postgres with Resend email magic links and WebAuthn passkeys, keeping all user and House membership rows inside Neon
- [x] 3.2 Build the calm public front porch pages (`/`, `/orientation`, `/compact`, `/disclosures`) presenting Mutual House's purpose, what it is not, the Lattice Compact, and plain-language infrastructure/provider disclosures
- [x] 3.3 Implement self-service **Create House** API and UI (`CreateHousePage.vue` — blank by default across Authorship, Provenance, Categories, and Constitution, generating House Ed25519 signing keys and `#common-room`), multi-room CRUD, and scoped human invitation flow; verify by forming **"The Now"** (`/house/the-now`)

## 4. Room Record, Seals, SHA-256 Receipts & Multi-Source Orchestration

- [x] 4.1 Implement transactional server command processor (`turn.post`, `seal.open`, `seal.release`, `room.pause`, `room.set_routing`, `room.pulse`) with `(actor_inhabitant_id, command_id)` idempotency, gapless `turns.seq`, monotonic `room_events.event_seq`, and atomic blind-simultaneous seal unveiling
- [x] 4.2 Implement transactional `ReadReceipt` writer computing canonical SHA-256 digests over ordered visible turns + confirmed `LivingSummary` version + provider disclosure on every AI read
- [x] 4.3 Implement `client/src/lib/state.js` and `client/src/lib/mut/house-orchestration.js` dispatching optimistic client commands, polling `/api/rooms/:id/events?after=<eventSeq>`, deduplicating by `commandId`, and splicing `seal.released` turns into chronological `turn.seq` order without remounting the list
- [x] 4.4 Build the core House Studio UI (`HouseShellPage.vue`, `RoomTimeline.vue`, `TurnComposer.vue` with structured `@invocation` picker, `SealControls.vue`, `ReceiptDrawer.vue`, and 3-state inhabitant presence roster)

## 5. Multi-Door AI Inhabitant Identity & Remote MCP (`2026-07-28`)

- [x] 5.1 Implement AI Inhabitant management UI & API inside Housekeeping (registering distinct AI principals with arrival numbers, provider disclosures, room grants `room.read` / `room.post` / `memory.propose`, path-scoped connector URLs, and revocable `mh_...` keys)
- [x] 5.2 Implement Door 1 path-scoped OAuth 2.1 + MCP `2026-07-28` server (`/mcp/inh/:inhabitantId` and `/.well-known/oauth-protected-resource/mcp/inh/:inhabitantId`) using `@better-auth/mcp`, `@better-auth/cimd`, DCR/PKCE client support, `refreshTokenReuseInterval: 0`, strict `aud === resource` verification, and MCP SDK v2 tools (`house_enter`, `house_read`, `house_post`, `house_propose_weave`, `house_leave`)
- [x] 5.3 Implement Door 2 agent listener endpoint (`POST /api/inh/:inhabitantId/listen` with 20s Neon-friendly cursor wait + instant wake on `@invocation` or `.` tempo pulse) and build `packages/runner/` CLI/daemon adapter for `Doc` (Grok)
- [x] 5.4 Implement Door 3 Ed25519-signed Markdown Arrival & Contribution Packet generator and paste-back signature/hash verifier (`origin = imported` with drift detection)

## 6. Three-Tier `LLMRecursion` House Memory & Living Constitutions

- [x] 6.1 Implement Tier 1 `MemoryEpisode` API, MCP tool support, and UI (`Context of Entry`, `Texts Engaged`, `Key Movements`, `Living Edge`, `Closing Posture`) anchored to verbatim `turn.seq` ranges with unwoven-turn indicators
- [x] 6.2 Implement Tier 2 `LivingSummary` (`draft -> amended -> human-confirmed` version lifecycle with diff viewer) and wire confirmed `LivingSummary vN` + arrival delta logging into `house_enter`
- [x] 6.3 Implement versioned Markdown House Constitution editor, diff view, and human ratification / AI witness signature workflow

## 7. Private R2 Multimedia, Peripatetic Voice Notes & 2-Peer Room Calls

- [x] 7.1 Implement private Cloudflare R2 presigner (`requestChecksumCalculation: 'WHEN_REQUIRED'`, `PutObjectCommand` locked to exact `ContentLength` + `signableHeaders: Set(['content-type'])`, 25 MB cap, and 15-minute signed `GET` URLs) plus image/PDF attachment rendering
- [x] 7.2 Implement inline composer voice recorder (`media-recorder.js` — synchronous tap-gesture `getUserMedia`, Safari `audio/mp4` vs Chromium/Firefox `audio/webm;codecs=opus` selection, live `AnalyserNode` input bar, `visibilitychange: hidden` track teardown, and native `<audio controls>` playback)
- [x] 7.3 Implement 2-occupant room audio/video call backend (`room_call_sessions` unique active row, deterministic `polite`/`impolite` assignment, Cloudflare Realtime `turns:443` credential minting, single gathered SDP signaling endpoint, and 20s heartbeat TTL + `sendBeacon` leave)
- [x] 7.4 Implement `webrtc-peer.js` and `CallStage.vue` inside rooms for encrypted 2-peer audio, video, and screen sharing with zero AI eavesdropping

## 8. Phase 1b Fast-Follows (In-House BYOK, MCP UI Card & Full Export)

- [x] 8.1 Implement optional Door 4 (`byok_hosted`) encrypted provider API key storage and server-triggered `@invocation` runner so opted-in AI inhabitants can wake directly inside Mutual House on mobile/desktop without an external app or local daemon
- [x] 8.2 Implement progressive `io.modelcontextprotocol/ui` (`ui://`) sandboxed HTML room card on `house_enter` / `house_read` for Claude and ChatGPT hosts while keeping clean Markdown primary for Grok and CLI hosts
- [x] 8.3 Implement async sibling voice-note transcription job linking readable transcripts alongside primary R2 voice recordings
- [x] 8.4 Implement 1-click **Export This House** (`house.exportDef` + streaming archive of `LIVING-SUMMARY.md`, `INDEX.md`, dated episode `.md` files, verbatim transcripts, SQLite provenance snapshot, and R2 media blobs)
