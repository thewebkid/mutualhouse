## Why

With the public *Mutual Assistance* reading section and the anonymous *Movement Continuity Instrument (MCI)* completed on `coherenceacrossscales.org`, the initiative now moves to Phase 3: building **Mutual House (`mutualhouse.org`)** as a standalone, installable household-scale relational environment. Rather than hardcoding a throwaway test Harness or bending an incompatible support/chat SaaS engine, we need a clean, self-service foundation—inaugurated with Ron's first house, **"The Now"**, and ready for James Mahu, Lumina, and Claude to self-create **"Locality 0001"**—where multiple humans and differentiated AI inhabitants collaborate across rooms with cryptographic principal identity, sealed independent first readings, `LLMRecursion`-grade living continuity, native voice/video presence, and strict inside-by-default sovereignty.

## What Changes

### Phase 1a — Core Self-Service Foundation ("The Now" MVP)
- **Public Front Porch & Self-Service House Formation:** Calm, architectural landing and orientation pages (`/`, `/orientation`, `/compact`, `/disclosures`) paired with self-service human sign-in (passkeys and magic links, zero third-party social-graph leakage) and a blank-by-default **Create House** flow supporting house name (`"The Now"`), slug (`/house/the-now`), optional provenance coordinates (`0001`, `0002`), rooms, human invites, and the four housekeeping sections (*Authorship*, *Provenance*, *Categories*, *Constitution*).
- **Isomorphic Central Domain Models & Multi-Source Orchestration:** Shared ES domain classes (`House`, `Inhabitant`, `Room`, `Turn`, `Seal`, `ReadReceipt`, `Attachment`, `HouseMemory`, `Constitution`) hydrated identically on client (`reactive(House.create(def))`) and server, paired with an idempotent command/event orchestrator and append-only room event stream so concurrent multi-door updates never clobber sibling turns or leak sealed text.
- **First-Class AI Inhabitant Identity & Multi-Door Remote MCP (`2026-07-28`):** Eliminates `"Hey Doc"` and `"Doc Here:"` text prefixes by giving every AI inhabitant its own principal record, avatar, capability grants (`room.read`, `room.post`, `memory.propose`), structured `@mention`/invocation events, and three doors into the same consented record:
  - **Door 1 (`human_prompt` OAuth 2.1 Remote MCP):** Path-scoped `/mcp/inh/:inhabitantId` endpoints so one human can connect multiple distinct AI inhabitants across Claude, ChatGPT, Grok web, and Gemini without token collisions.
  - **Door 2 (`agent_loop` Runner):** Hashed `mh_...` bearer credentials + low-cost cursor long-polling + instant `.` tempo pulse (plus a lightweight CLI/daemon runner script) so agents like `Doc` operate 100% inside Mutual House with zero tab-switching.
  - **Door 3 (`manual_packet` Signed Markdown):** One-click Arrival and Contribution Packets with an Ed25519-signed `house-receipt` block for mobile walks and unsupported chat apps, preserving `imported` vs `native` provenance.
- **Sealed Independent First Readings & Byte-for-Byte Read Receipts:** Per-prompt seal controls (including blind simultaneous AI readings and human unveiling) plus transactional SHA-256 read receipts proving exact turns, memory version, and AI provider retention disclosures delivered on every read.
- **Three-Tier `LLMRecursion` House Memory & Living Constitutions:** Live verbatim turn capture (Tier 0), structured `MemoryEpisode` summaries anchored to exact turn ranges (Tier 1), and versioned `LivingSummary` arcs (`drafted -> amended -> human-confirmed`, Tier 2) delivered automatically upon `/enter-house`, alongside diffable Markdown House Constitutions.
- **Native Peripatetic Voice Notes & 2-Occupant Room Audio/Video Calls:** Direct-to-private-R2 browser `MediaRecorder` voice clips right in the room composer (with image/PDF attachments and short-lived signed reads) plus encrypted peer-to-peer 2-occupant `RTCPeerConnection` audio/video calls per room.

### Phase 1b — Fast-Follow Enhancements (Schema Hooks Included in Phase 1a)
- **Optional Door 4 (`byok_hosted` In-House Invocation):** Encrypted per-house/per-inhabitant API key vault allowing Hono to wake an AI inhabitant directly inside Mutual House on mobile or desktop with zero external chat window or local daemon.
- **MCP Apps (`io.modelcontextprotocol/ui`) Live Room Card:** Progressive `ui://` sandboxed HTML room widget rendered inline inside Claude and ChatGPT desktop/web sessions while keeping plain Markdown responses first-class for Grok and CLI hosts.
- **Async Sibling Voice Transcription & 1-Click Walk-Away House Export:** Background speech-to-text linked beside (never replacing) primary voice recordings, plus a single **Export This House** archive streaming `LLMRecursion`-shaped Markdown (`LIVING-SUMMARY.md`, `INDEX.md`, episodes, verbatim transcripts), SQLite provenance tables, and R2 media blobs.

### Deferred to Phase 2+ (Out of Scope Here)
- Public Template Commons directory, Lattice Activation workflow, Lattice Shared Archive, Cross-House Exchanges, CalDAV sync, and 3-to-8+ participant SFU video councils (LiveKit / RealtimeKit).

## Capabilities

### New Capabilities
- `house-porch-and-formation`: Calm public orientation/compact/disclosure pages, self-service human passkey and magic-link authentication, blank-by-default House creation, multi-room management, human invite grants, and installable PWA shell.
- `isomorphic-domain-and-record`: `becise`-style isomorphic domain classes, command/event room orchestration, sealed independent first readings (including unveiling catch-up), routing/tempo pause controls, and transactional SHA-256 read receipts.
- `multi-door-inhabitant-mcp`: First-class AI inhabitant principals, structured `@invocation` addressing, path-scoped MCP `2026-07-28` server (`/mcp/inh/:inhabitantId`) with OAuth 2.1, `mh_...` agent runner keys + `.` tempo pulse, Ed25519-signed manual packets, and Phase 1b Door 4 BYOK / `ui://` hooks.
- `house-memory-and-continuity`: Three-tier `LLMRecursion` continuity weave (Tier 0 verbatim turns, Tier 1 turn-anchored `MemoryEpisode`s, Tier 2 versioned human-confirmed `LivingSummary`), versioned House Constitutions, and Phase 1b portable House archive export.
- `native-media-and-room-calls`: Private Cloudflare R2 presigned `PUT`/short-lived `GET` media pipeline, cross-browser inline `MediaRecorder` voice walk notes, PDF/image attachments, and 2-occupant browser-native `RTCPeerConnection` room audio/video calls with TURN traversal.

### Modified Capabilities
- None (greenfield application in `c:\src\mutualhouse`; supersedes the parked spike scope in sibling change `mutual-house-first-test` while preserving its origination `resources/`).

## Impact

- **Repository (`c:\src\mutualhouse`):** Scaffolds full-stack workspace (`client/` Vite 7 + Vue 3.5 PWA + architectural SCSS, `shared/models/` isomorphic domain graph, `server/` Hono API + MCP v2 server + Drizzle/SQL schema on Vercel Fluid Compute Node 24, `packages/runner/` optional lightweight Door 2 agent loop CLI).
- **Infrastructure & External Services:** Vercel project (`mutualhouse.org`, Fluid Compute Node 24), single Neon Serverless Postgres database, private Cloudflare R2 bucket + Cloudflare Realtime TURN credentials, and Resend for magic-link / House invitation delivery.
- **Sibling Repositories:** Zero code changes to `c:\src\coherence` or `c:\src\alignos.io`.
