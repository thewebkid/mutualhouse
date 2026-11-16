# isomorphic-domain-and-record Specification

## Purpose
Defines the authoritative room record, idempotent multi-actor mutation semantics, sealed independent first readings, routing tempo controls, and cryptographic byte-for-byte read receipts that keep concurrent human and AI participation truthful across every door.
## Requirements
### Requirement: Idempotent command mutations and monotonic room event stream
The system SHALL process all room and House mutations as discrete, idempotent commands keyed by `(actor_inhabitant_id, command_id)` that append to a monotonic room event stream (`event_seq`) while assigning a separate gapless chronological transcript position (`turn.seq`) to each spoken turn, and MUST NEVER overwrite a room's turn collection via whole-document client state uploads.

#### Scenario: Concurrent turns from human UI and AI door do not clobber each other
- **WHEN** a human inhabitant posts a turn from the web UI at the same moment an AI inhabitant posts a turn via MCP
- **THEN** both turns are appended with distinct `turn.seq` and `event_seq` values and neither actor's view overwrites or erases the other's turn

#### Scenario: Retried client command is deduplicated cleanly
- **WHEN** a client or agent retries a `turn.post` command carrying the same `command_id` after a transient network drop
- **THEN** the server returns the originally created turn and event without inserting a duplicate turn

### Requirement: Sealed independent first readings and unveiling catch-up
The system SHALL allow a prompt or room turn to open a `Seal` (supporting both peer-sealed AI first readings where humans can inspect progress, and blind simultaneous readings where responses remain hidden until target participants finish or a human unveils), withholding sealed turn bodies from restricted viewers until an authorized human executes `seal.release`.

#### Scenario: Second AI reads prompt without seeing first AI's sealed response
- **WHEN** a human posts a prompt under an active seal, AI #1 posts its response attached to that seal, and AI #2 subsequently reads the room before the seal is released
- **THEN** the server delivers the human prompt and prior unsealed context to AI #2 while omitting AI #1's sealed turn body completely from the payload and hash

#### Scenario: Releasing a seal delivers earlier-numbered turns to caught-up cursors
- **WHEN** AI #1 posts sealed turn `seq = 10`, a human posts unsealed turn `seq = 11` (advancing AI #2's event cursor past `turn 11`), and an authorized human then releases the seal on `seq = 10`
- **THEN** the system records a new `seal.released` room event at the current head `event_seq` carrying the unveiled turn(s), so AI #2 and connected browsers polling after their prior cursor receive `seq = 10` and render it in its true chronological `seq = 10` position before `seq = 11`

#### Scenario: Blind simultaneous reading unveils atomically when predicate completes
- **WHEN** a human configures a seal to remain blind until both AI #1 and AI #2 have contributed (or until manual override) and AI #2 submits the completing contribution
- **THEN** the write transaction atomically records AI #2's turn and emits the unveiling event in transcript order so viewers see AI #1 followed by AI #2 without an intermediate partial leak

### Requirement: Room routing modes and human tempo pause
The system SHALL enforce per-room routing modes (`manual`, `assisted`, and `authorized_auto` with a bounded consecutive AI turn cap) and an immediate `room.pause` toggle controllable only by authorized humans.

#### Scenario: Pausing a room halts automated circulation immediately
- **WHEN** a human activates `room.pause` (or consecutive AI turns reach the room's configured cap)
- **THEN** subsequent agent listener polls report the room as paused and automated/assisted AI invocations are withheld until a human explicitly resumes or triggers a `.` pulse

### Requirement: Transactional byte-for-byte SHA-256 read receipts
Whenever any AI inhabitant reads room context (via MCP tool, agent runner, or signed packet issuance), the system SHALL atomically record an immutable `ReadReceipt` in the same database transaction, capturing the inhabitant ID, exact ordered list of visible turn IDs and body hashes, confirmed House Memory version, active seal exclusions, timestamp, door type, and AI provider disclosure.

#### Scenario: Human inspects exact context an AI received before speaking
- **WHEN** a human opens the receipt drawer on an AI inhabitant's turn (or in the room inspector)
- **THEN** the system displays the linked `ReadReceipt` proving byte-for-byte which turn IDs, SHA-256 context digest, House Memory version, and provider disclosure governed that contribution, and distinguishes `native` tool posts from `imported` packet pastes

