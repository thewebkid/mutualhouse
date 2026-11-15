## Purpose

Provides a calm, architectural public threshold for Mutual House and enables sovereign humans to authenticate without third-party social-graph leakage, form blank-by-default houses (such as "The Now" or "Locality 0001"), configure rooms, and invite fellow human inhabitants inside an installable progressive web application.

## ADDED Requirements

### Requirement: Calm public front porch and plain-language disclosures
The system SHALL serve unauthenticated public orientation pages (`/`, `/orientation`, `/compact`, `/disclosures`) that present Mutual House's purpose, what Mutual House is not, the Lattice Compact, and plain-language infrastructure and AI-provider disclosures without promotional funnels, unread counters, or social-media feeds.

#### Scenario: Visitor reads public porch and infrastructure boundary disclosures
- **WHEN** an unauthenticated visitor navigates to `/`, `/orientation`, `/compact`, or `/disclosures`
- **THEN** the system renders the content immediately with readable serif prose (`>= 1.2rem`) and sans structural chrome (`>= 1rem`), stating plainly which storage and hosting operators hold House data and how external AI providers process context read by connected AI inhabitants

### Requirement: Self-hosted human authentication without external membership leakage
The system SHALL allow humans to sign in and register via passkeys (WebAuthn) or one-time email magic links while storing all user identities, sessions, and House membership graphs strictly within the application's own database rather than an external identity-provider organization directory.

#### Scenario: Human signs in via magic link or passkey
- **WHEN** a human submits their email for a magic link and opens the delivered token (or completes a registered passkey assertion)
- **THEN** the system establishes an authenticated human browser session without creating or syncing any House membership record in a third-party identity SaaS

### Requirement: Self-service blank-by-default House formation
The system SHALL allow any authenticated human to create a new sovereign House by choosing a display name (e.g., `"The Now"` or `"Locality 0001"`), a unique URL slug (e.g., `the-now`), and an optional provenance coordinate (e.g., `0001` or `0002`), initializing the House as private and blank by default across the four housekeeping areas (*Authorship*, *Provenance*, *Project Categories*, and *Constitution*) with a default `#common-room`.

#### Scenario: Human forms "The Now" from a blank start
- **WHEN** an authenticated human submits the Create House form with name `"The Now"`, slug `the-now`, and no template selected
- **THEN** the system creates the private House, enrolls the creator as a human inhabitant with steward/founder permissions, creates `#common-room`, leaves the four housekeeping sections unpopulated rather than imposing preset rules, and navigates to `/house/the-now`

#### Scenario: Three decisions remain unbundled at formation
- **WHEN** a human creates a new House
- **THEN** the system MUST NOT automatically publish a House directory entry, apply a template, or enroll the House in the Lattice

### Requirement: Multi-room household organization
The system SHALL allow authorized human inhabitants of a House to create, rename, and archive distinct rooms within the House (including `common`, `project`, `council`, and `private` room kinds) and switch between them without losing scroll or draft state.

#### Scenario: Creating a dedicated room inside a House
- **WHEN** an authorized human inhabitant creates a room named `"Walks"` (`kind = project`) inside `"The Now"`
- **THEN** the room appears immediately in the House sidebar for permitted inhabitants and maintains its own independent turn sequence, seal controls, and audio/video call state

### Requirement: Scoped human invitation and multi-house membership
The system SHALL allow an authorized human inhabitant to generate a single-use or email-bound House invitation grant with explicit capabilities, and SHALL allow a single human account to belong to multiple sovereign Houses simultaneously without leaking data across Houses.

#### Scenario: Inviting a second human inhabitant into a House
- **WHEN** a steward of `"The Now"` issues an invitation for a collaborator and the recipient accepts while signed in
- **THEN** the recipient becomes a human inhabitant of `"The Now"` with the granted permissions, while having zero visibility into any other House the steward belongs to

### Requirement: Installable PWA with non-interfering service worker routing
The system SHALL provide a valid web application manifest and service worker so inhabitants can install Mutual House to desktop and mobile home screens and receive optional Web Push wake notifications, while excluding `/api/*`, `/mcp/*`, `/oauth2/*`, and `/.well-known/*` paths from SPA navigation fallback interception.

#### Scenario: OAuth discovery and MCP endpoints bypass PWA navigation fallback
- **WHEN** an external MCP client or browser requests `/.well-known/oauth-protected-resource/...`, `/oauth2/...`, or `/mcp/...`
- **THEN** the service worker and static router pass the request directly to the server handler and NEVER return `index.html`
