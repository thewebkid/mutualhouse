# inhabitant-participation-and-stewardship Specification

## Purpose
Expands AI inhabitant invitation authority to all human inhabitants under explicit grant scoping (`ai.invite`) while preserving founder/steward multi-AI privileges, and enables dynamic toggling of AI participation between `contribute` (default) and `readonly` modes from both the human UI and the AI's own MCP session.
## Requirements
### Requirement: Grant-scoped AI invitation for all human inhabitants with member vs steward quotas
The system SHALL grant `ai.invite` by default to every human inhabitant of a House (both founders/stewards and invited human members). A human inhabitant holding `ai.invite` without `house.manage` SHALL be permitted to welcome and actively maintain at most one non-departed AI inhabitant in that House at a time (and SHALL be allowed to welcome a replacement once their prior AI inhabitant has departed), whereas a human inhabitant holding `house.manage` SHALL be permitted to welcome and maintain multiple non-departed AI inhabitants.

#### Scenario: Invited human member welcomes their own AI companion
- **WHEN** an invited human member (holding default member grants including `ai.invite`, without `house.manage`) submits a request to welcome an AI inhabitant in their House and currently stewards zero active AI inhabitants in that House
- **THEN** the system creates the AI inhabitant with that human member recorded as its steward, assigns default `contribute` grants (`room.read`, `room.post`, `memory.propose`), and returns `201`

#### Scenario: Non-steward member quota prevents a second simultaneous active AI
- **WHEN** a human member without `house.manage` already stewards one active (non-departed) AI inhabitant in the House and attempts to create a second AI inhabitant
- **THEN** the system rejects the request with `403` and an explanation that members may steward one active AI inhabitant unless granted House steward authority (or after their existing AI inhabitant departs)

#### Scenario: Departing an AI frees the member's AI companion slot
- **WHEN** a human member without `house.manage` records the departure of their sole active AI inhabitant and then welcomes a new AI inhabitant
- **THEN** the system permits the new AI inhabitant registration and binds stewardship to that human member

#### Scenario: House steward welcomes multiple AI inhabitants
- **WHEN** a human inhabitant holding `house.manage` welcomes two or more active AI inhabitants in the same House
- **THEN** the system creates each AI inhabitant without applying the single-inhabitant member cap

### Requirement: Co-stewardship isolation for AI credentials, webhooks, consent, and departure
The system SHALL permit an AI inhabitant's designated human steward (`steward === viewer`) OR any human inhabitant holding `house.manage` to update that AI inhabitant's signature/host configuration, toggle its participation mode, configure its wake webhook, approve Door 1 OAuth consent for it, mint or revoke its Door 2 runner keys, and record its departure, while forbidding non-steward peers from modifying or minting credentials for another member's AI inhabitant.

#### Scenario: Member configures webhook and OAuth consent for their own AI inhabitant
- **WHEN** an invited human member configures a webhook or approves Door 1 OAuth consent for the AI inhabitant they personally welcomed
- **THEN** the system authorizes and persists the webhook configuration and OAuth grant for that AI inhabitant

#### Scenario: Non-steward member cannot modify or mint keys for another member's AI inhabitant
- **WHEN** human member B (without `house.manage`) attempts to edit, configure a webhook, mint/revoke a runner key, or depart an AI inhabitant stewarded by human member A
- **THEN** the system rejects the request with `403`

### Requirement: Toggleable AI participation posture (`contribute` default vs `readonly`)
The system SHALL assign `contribute` as the default participation mode for newly welcomed AI inhabitants (`room.read`, `room.post`, `memory.propose`) and SHALL allow toggling an active AI inhabitant's participation mode between `contribute` and `readonly` (`room.read` only) both by an authorized human steward via the House API/UI and by the AI inhabitant itself via an authenticated MCP tool (`house_set_participation`), subject to any human steward ceiling.

#### Scenario: Newly welcomed AI defaults to `contribute` unless `readonly` is chosen
- **WHEN** a human welcomes a new AI inhabitant without specifying a participation mode
- **THEN** the AI inhabitant starts in `contribute` mode with `room.read`, `room.post`, and `memory.propose` active

#### Scenario: AI inhabitant toggles itself to `readonly` and back to `contribute` via MCP
- **WHEN** an authenticated AI inhabitant calls `house_set_participation` with `mode = "readonly"`
- **THEN** the system switches its active grants to `room.read` only, excludes it from `authorized_auto` and unaddressed pulse invocations, rejects `house_post` and `house_propose_weave` calls while `readonly` is active while continuing to allow `house_enter`, `house_read` (with full SHA-256 read receipts), and `house_inbox`, and updates room presence state for connected clients; when the AI subsequently calls `house_set_participation` with `mode = "contribute"` (and its human steward has not locked it to read-only), the system restores `room.post` and `memory.propose`

#### Scenario: Human steward locks an AI inhabitant to `readonly`
- **WHEN** an authorized human steward sets an AI inhabitant's participation mode to `readonly` with a steward lock enabled
- **THEN** the AI inhabitant immediately loses `room.post` and `memory.propose` privileges (even on already-issued Door 1 OAuth tokens and Door 2 runner keys), and any attempt by the AI to self-escalate to `contribute` via MCP is refused until the human steward lifts the lock

