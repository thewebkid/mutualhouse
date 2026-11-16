/**
 * Complete PostgreSQL DDL for Mutual House (`mutualhouse.org`).
 * Runs identically on Neon Serverless Postgres 16/17 and embedded PGlite 16.
 */
export const INITIAL_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS mh_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mh_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES mh_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mh_magic_links (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  redirect_to TEXT,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mh_passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES mh_users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key_spki TEXT NOT NULL,
  algorithm INTEGER NOT NULL DEFAULT -7,
  counter BIGINT NOT NULL DEFAULT 0,
  transports JSONB NOT NULL DEFAULT '[]'::jsonb,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mh_webauthn_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS houses (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  coordinates TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  four_sections JSONB NOT NULL DEFAULT '{"authorship":"","provenance":"","categories":[],"housekeepingNotes":""}'::jsonb,
  public_key_ed25519 TEXT NOT NULL,
  encrypted_private_key_ed25519 TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES mh_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inhabitants (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'ai')),
  user_id TEXT REFERENCES mh_users(id) ON DELETE SET NULL,
  steward_inhabitant_id TEXT REFERENCES inhabitants(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  role_label TEXT NOT NULL DEFAULT '',
  signature_notes TEXT NOT NULL DEFAULT '',
  is_founder BOOLEAN NOT NULL DEFAULT FALSE,
  arrival_number INTEGER NOT NULL DEFAULT 1,
  provider TEXT NOT NULL DEFAULT 'human',
  provider_disclosure TEXT NOT NULL DEFAULT '',
  model_slug TEXT,
  door_type TEXT NOT NULL DEFAULT 'web',
  handoff_note TEXT NOT NULL DEFAULT '',
  encrypted_provider_credentials TEXT,
  grants JSONB NOT NULL DEFAULT '[]'::jsonb,
  presence TEXT NOT NULL DEFAULT 'invocable',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (house_id, handle)
);

CREATE TABLE IF NOT EXISTS inhabitant_grants (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id) ON DELETE CASCADE,
  room_id TEXT,
  scope TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (inhabitant_id, room_id, scope)
);

CREATE TABLE IF NOT EXISTS inhabitant_api_keys (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Runner Key',
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes JSONB NOT NULL DEFAULT '["room.read","room.post","memory.propose"]'::jsonb,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT,
  client_name TEXT NOT NULL,
  redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  token_endpoint_auth_methods_supported JSONB,
  grant_types JSONB NOT NULL DEFAULT '["authorization_code","refresh_token"]'::jsonb,
  metadata_url TEXT,
  jwks_uri TEXT,
  jwks JSONB,
  metadata_fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_client_assertions (
  jti_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES mh_users(id) ON DELETE CASCADE,
  inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  scopes JSONB NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY,
  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT UNIQUE,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES mh_users(id) ON DELETE CASCADE,
  inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  scopes JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  rotated_from_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS house_invites (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  invited_by_inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id) ON DELETE CASCADE,
  email TEXT,
  role_label TEXT NOT NULL DEFAULT 'Inhabitant',
  grants JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_hash TEXT NOT NULL UNIQUE,
  accepted_by_inhabitant_id TEXT REFERENCES inhabitants(id),
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'common' CHECK (kind IN ('common', 'project', 'council', 'private')),
  purpose TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  owner_inhabitant_id TEXT REFERENCES inhabitants(id) ON DELETE SET NULL,
  routing_mode TEXT NOT NULL DEFAULT 'assisted' CHECK (routing_mode IN ('manual', 'assisted', 'authorized_auto')),
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  auto_turn_cap INTEGER NOT NULL DEFAULT 3,
  consecutive_ai_turns INTEGER NOT NULL DEFAULT 0,
  last_turn_seq INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (house_id, slug)
);

CREATE TABLE IF NOT EXISTS seals (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  prompt_turn_id TEXT,
  mode TEXT NOT NULL DEFAULT 'peer_sealed' CHECK (mode IN ('peer_sealed', 'blind_simultaneous')),
  status TEXT NOT NULL DEFAULT 'sealed' CHECK (status IN ('sealed', 'released')),
  target_inhabitant_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  responded_inhabitant_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  opened_by_inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id),
  released_by_inhabitant_id TEXT REFERENCES inhabitants(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS read_receipts (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id) ON DELETE CASCADE,
  door_type TEXT NOT NULL,
  turn_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  turn_digests JSONB NOT NULL DEFAULT '[]'::jsonb,
  memory_version INTEGER NOT NULL DEFAULT 0,
  constitution_version INTEGER NOT NULL DEFAULT 0,
  excluded_seal_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_sha256 TEXT NOT NULL,
  packet_signature TEXT,
  provider_disclosure TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES inhabitants(id),
  reply_to_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  origin TEXT NOT NULL DEFAULT 'native' CHECK (origin IN ('native', 'imported')),
  contribution_kind TEXT NOT NULL DEFAULT 'turn',
  body TEXT NOT NULL DEFAULT '',
  body_sha256 TEXT NOT NULL,
  seal_id TEXT REFERENCES seals(id) ON DELETE SET NULL,
  invoked_inhabitant_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  memory_version INTEGER NOT NULL DEFAULT 0,
  read_receipt_id TEXT REFERENCES read_receipts(id) ON DELETE SET NULL,
  packet_drift BOOLEAN NOT NULL DEFAULT FALSE,
  transcript_of_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, seq),
  UNIQUE (author_id, command_id)
);

CREATE INDEX IF NOT EXISTS idx_turns_room_seq ON turns(room_id, seq);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
  uploaded_by_inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id),
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL UNIQUE,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  transcript_text TEXT,
  transcript_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'committed', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_events (
  event_seq BIGSERIAL PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  actor_inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id),
  command_id TEXT NOT NULL,
  type TEXT NOT NULL,
  target_inhabitant_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  seal_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (actor_inhabitant_id, command_id)
);

CREATE INDEX IF NOT EXISTS idx_room_events_room_seq ON room_events(room_id, event_seq);
CREATE INDEX IF NOT EXISTS idx_room_events_house_seq ON room_events(house_id, event_seq);

CREATE TABLE IF NOT EXISTS memory_episodes (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  episode_date TEXT NOT NULL,
  from_turn_seq INTEGER NOT NULL,
  to_turn_seq INTEGER NOT NULL,
  context_of_entry TEXT NOT NULL DEFAULT '',
  texts_engaged TEXT NOT NULL DEFAULT '',
  key_movements TEXT NOT NULL DEFAULT '',
  living_edge TEXT NOT NULL DEFAULT '',
  closing_posture TEXT NOT NULL DEFAULT '',
  author_inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS living_summaries (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'amended', 'confirmed')),
  arc TEXT NOT NULL DEFAULT '',
  through_lines TEXT NOT NULL DEFAULT '',
  living_edge TEXT NOT NULL DEFAULT '',
  drafted_by_inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id),
  amended_by_inhabitant_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed_by_inhabitant_id TEXT REFERENCES inhabitants(id),
  parent_version INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  UNIQUE (house_id, version)
);

CREATE TABLE IF NOT EXISTS constitutions (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ratified')),
  title TEXT NOT NULL DEFAULT 'House Constitution',
  body TEXT NOT NULL DEFAULT '',
  proposed_by_inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id),
  ratified_by_human_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  witnessed_by_ai_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ratified_at TIMESTAMPTZ,
  UNIQUE (house_id, version)
);

CREATE TABLE IF NOT EXISTS arrival_logs (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id) ON DELETE CASCADE,
  arrival_number INTEGER NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('enter', 'leave')),
  memory_version INTEGER NOT NULL DEFAULT 0,
  prior_memory_version INTEGER,
  memory_version_delta INTEGER NOT NULL DEFAULT 0,
  constitution_version INTEGER NOT NULL DEFAULT 0,
  handoff_note TEXT NOT NULL DEFAULT '',
  read_receipt_id TEXT REFERENCES read_receipts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_call_sessions (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'active', 'ended')),
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_room_call
  ON room_call_sessions(room_id)
  WHERE status IN ('ringing', 'active');

-- Wake URLs are per AI inhabitant. The HMAC secret and optional static bearer
-- are AES-GCM sealed. Existing databases gain the columns on the next boot.
ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS wake_url TEXT;
ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS encrypted_wake_secret TEXT;
ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS wake_auth_header TEXT;
ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS encrypted_wake_bearer TEXT;
ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS departed_at TIMESTAMPTZ;
ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS host_kind TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS wake_preset TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS participation_mode TEXT NOT NULL DEFAULT 'contribute';
ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS participation_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS hobbies JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS avatar_r2_key TEXT;
ALTER TABLE inhabitants ADD COLUMN IF NOT EXISTS use_gravatar BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS mcp_event_subscriptions (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  callback_url TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (inhabitant_id, event_name, callback_url)
);

UPDATE inhabitants
SET grants = grants || '["ai.invite"]'::jsonb
WHERE kind = 'human' AND NOT (grants ? 'ai.invite');

UPDATE inhabitants
SET host_kind = CASE
      WHEN wake_url ILIKE '%api.anthropic.com%' THEN 'claude'
      WHEN wake_url ILIKE '%api2.cursor.sh%' OR wake_url ILIKE '%cursor.sh%' THEN 'grok_bot'
      WHEN provider = 'openai' THEN 'chatgpt'
      WHEN provider = 'claude' THEN 'claude'
      WHEN provider = 'grok' THEN 'grok_com'
      WHEN provider = 'copilot' THEN 'copilot'
      ELSE host_kind
    END,
    wake_preset = CASE
      WHEN wake_url ILIKE '%api.anthropic.com%' THEN 'claude_routine'
      WHEN wake_url ILIKE '%cursor.sh%' THEN 'grok_bot'
      WHEN provider = 'openai' THEN 'mcp_events'
      WHEN provider = 'grok' AND wake_url IS NULL THEN 'none'
      ELSE wake_preset
    END
WHERE kind = 'ai' AND host_kind = 'custom';

CREATE TABLE IF NOT EXISTS inhabitant_invocations (
  id TEXT PRIMARY KEY,
  house_id TEXT NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  inhabitant_id TEXT NOT NULL REFERENCES inhabitants(id) ON DELETE CASCADE,
  source_event_seq BIGINT NOT NULL REFERENCES room_events(event_seq) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('invoked', 'authorized_auto', 'pulse')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acked_at TIMESTAMPTZ,
  UNIQUE (inhabitant_id, source_event_seq)
);

CREATE INDEX IF NOT EXISTS idx_invocations_pending
  ON inhabitant_invocations (inhabitant_id, source_event_seq)
  WHERE acked_at IS NULL;

ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS token_endpoint_auth_methods_supported JSONB;
ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS jwks_uri TEXT;
ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS jwks JSONB;
ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS metadata_fetched_at TIMESTAMPTZ;
`;
