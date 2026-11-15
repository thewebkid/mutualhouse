# Database — Neon Serverless Postgres & Local PGlite

**Production:** Neon Serverless Postgres (`DATABASE_URL` / `POSTGRES_URL`) via `pg` Pool + Drizzle ORM.  
**Local Dev / Tests (zero-config):** When `DATABASE_URL` is unset, `server/db/index.js` initializes an embedded PostgreSQL 16 engine (`@electric-sql/pglite`) persisted at `./.data/pglite` (or in-memory during Vitest runs), running the exact same SQL migrations and ACID transactions.

## Core Tables

- **Auth (`better-auth` + OAuth):** `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_passkeys`, `oauth_clients`, `oauth_tokens`.
- **Household & Identity:** `houses` (includes encrypted Ed25519 signing keypair), `inhabitants` (`human` | `ai`, arrival number, provider disclosure, presence state, optional encrypted BYOK credentials), `inhabitant_grants` (`room.read`, `room.post`, `memory.propose`), `inhabitant_api_keys` (SHA-256 `mh_...` hashes), `house_invites`.
- **Rooms, Dual Sequences & Provenance:**
  - `rooms` (`last_turn_seq`, `routing_mode`, `paused`, `auto_turn_cap`).
  - `seals` (`mode`: `peer_sealed` | `blind_simultaneous`, `target_inhabitant_ids`, `status`: `sealed` | `released`).
  - `turns` (`seq` chronological per room, `origin`: `native` | `imported`, `seal_id`, `body`, `body_sha256`, `memory_version`, `read_receipt_id`, `transcript_of_turn_id`).
  - `attachments` (`kind`: `audio` | `image` | `pdf`, `r2_key`, `mime_type`, `byte_length`, `sha256`, `duration_ms`).
  - `read_receipts` (immutable SHA-256 audit of ordered visible `turn_ids`, `memory_version`, `sealed_exclusions`, `door_type`, `provider_disclosure`).
  - `room_events` (`event_seq bigserial` monotonic cursor; `seal.released` appends a fresh event carrying unveiled turns so caught-up cursors never miss earlier-numbered sealed turns).
- **Continuity & Calls:** `memory_episodes`, `living_summaries` (`draft` | `amended` | `confirmed`), `constitutions`, `arrival_logs`, `room_call_sessions`.
