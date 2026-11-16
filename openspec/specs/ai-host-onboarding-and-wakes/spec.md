# ai-host-onboarding-and-wakes Specification

## Purpose
Provides a welcoming, rail-accessible AI onboarding experience outside Housekeeping coupled with per-host MCP guidance, live connection detection, exact per-LLM webhook field presets and delivery adapters, OAuth 2.1 optional-`resource` consent hardening, and zero-paste ChatGPT `MCP Events` webhook negotiation.
## Requirements
### Requirement: Rail-accessible "Add AI" onboarding modal with host-specific setup flows
The system SHALL expose an **Add AI** action directly in the studio rail beneath the Inhabitants list (and from inhabitant context menus) for any human inhabitant eligible to invite an AI, opening a guided onboarding modal outside Housekeeping that lets the user choose the AI's host environment (`ChatGPT`, `Copilot`, `Grok` on `grok.com`, `GrokBot`, `Claude`, or `Other`), name, and initial participation mode (`contribute` default or `readonly`), while keeping advanced credential options (runner keys, custom HMAC headers, and house-held BYOK keys) tucked behind an optional **Advanced** disclosure.

#### Scenario: Steward or eligible member opens Add AI directly from the studio rail
- **WHEN** an eligible human inhabitant clicks **Add AI** beneath the studio rail's Inhabitants list and selects `GrokBot` (or `ChatGPT`, `Copilot`, `Grok`, `Claude`)
- **THEN** the modal creates or targets the AI inhabitant with that `hostKind` and displays host-accurate Door 1 connection steps and a copyable arrival prompt without navigating away to Housekeeping

#### Scenario: Web-chat hosts warn against pasting raw MCP URLs into chat messages
- **WHEN** the user selects `Grok` (`grok.com`), `ChatGPT`, `Claude`, or `Copilot`
- **THEN** the onboarding step directs the user to that host's exact MCP connector settings surface (for example `grok.com/connectors` -> `New Connector` -> `Custom`) before pasting the arrival prompt, rather than instructing them to paste the raw MCP endpoint URL into a chat turn

### Requirement: Live connection handshake detection and per-host MCP instructions
The system SHALL include host-aware orientation and webhook guidance in the MCP server's `initialize` instructions and `house_enter` response, and the onboarding modal SHALL transition automatically from a waiting state (`Waiting for connection…`) to a connected state as soon as an OAuth token is issued for that AI inhabitant or the AI completes `house_enter`, presenting webhook-capable hosts with clear choices to **Enter webhook details** or **Copy webhook prompt**.

#### Scenario: Connecting LLM receives per-host webhook heuristic on MCP arrival
- **WHEN** an AI inhabitant configured with a webhook-capable host (`GrokBot`, `Claude`, `Copilot`) connects to `/mcp/inh/:inhabitantId` and has no webhook configured yet
- **THEN** the MCP `initialize` instructions and `house_enter` response instruct the AI to let its human know that a one-time webhook keeps it responsive in the room without manual nudges and to offer generating its host routine/webhook with credentials kept opaque to the model

#### Scenario: Onboarding modal detects live connection without manual page reload
- **WHEN** the onboarding modal is waiting on Step 2 for an AI inhabitant and OAuth token exchange or `house_enter` completes on the server
- **THEN** the modal automatically updates its status to connected and unlocks the host-appropriate presence/webhook step

### Requirement: Exact per-LLM webhook field presets, delivery adapters, and draft-safe editing
The system SHALL render host-matched webhook labels and inputs (hiding unused fields such as HMAC secrets unless `Custom` is selected), SHALL adapt outbound wake HTTP requests to host-specific wire contracts, and SHALL preserve unsaved form input values across background room-event and inhabitant refreshes when the user unfocuses inputs or switches windows.

#### Scenario: GrokBot preset maps directly to GrokBot Routine webhook fields
- **WHEN** a user configures a webhook for a `GrokBot` AI inhabitant
- **THEN** the UI titles the section **Webhook**, displays **`POST to`** (URL), **`key`** (Bearer secret), and **`header`** (`Authorization: Bearer …` preview, also accepting a pasted `Authorization: Bearer <key>` string and extracting `<key>` automatically), hides HMAC secret inputs, enables **Save / Done** once `POST to` and `key` are valid, and delivers invocations with `Authorization: Bearer <key>`

#### Scenario: Claude Routine `/fire` preset adapts outbound headers and body
- **WHEN** a user configures a Claude Cloud Routine webhook (`https://api.anthropic.com/v1/claude_code/routines/.../fire`) with its `Routine API token` (`sk-ant-oat01-...`)
- **THEN** the UI displays **`Fire URL`** and **`Routine API token`** without requiring custom header names, and outbound wake deliveries include `Authorization: Bearer <token>`, `anthropic-version: 2023-06-01`, and a JSON payload containing a top-level `"text"` string summarizing the Mutual House invocation alongside structured metadata

#### Scenario: `grok.com` host skips inapplicable webhook fields
- **WHEN** a user onboards a `Grok` (`grok.com`) inhabitant
- **THEN** Step 3 presents a clear ready state explaining that `grok.com` checks its House inbox whenever the user chats with it (and notes `GrokBot` for automatic background wakes) without showing dead-end webhook fields

#### Scenario: Alt-tabbing during webhook entry never blanks out unsaved fields
- **WHEN** a user types or pastes a URL into a webhook input on the onboarding modal or Housekeeping inhabitant card, tabs away to copy the key from another app, and a background room poll refreshes the inhabitant record before Save is clicked
- **THEN** the unsaved URL and header/key inputs remain intact and are not overwritten by empty server values

### Requirement: OAuth 2.1 optional-`resource` consent fallback and client auth compatibility
The system SHALL preserve strict path-scoped JWT audience binding (`aud = https://<origin>/mcp/inh/:inhabitantId`) even when an OAuth 2.1 MCP client omits the optional RFC 8707 `resource` parameter on `/oauth/consent` or `/oauth2/token`, SHALL support `none`, `client_secret_post`, and `client_secret_basic` token endpoint authentication, SHALL serve RFC 8414 and OIDC discovery aliases, and SHALL reject departed AI inhabitants and invalid external `resource` URLs.

#### Scenario: Connector omits `?resource=` during OAuth authorization and token exchange
- **WHEN** an OAuth client (such as `grok.com/connectors`) redirects a signed-in human to `/oauth/consent` without a `resource` query parameter
- **THEN** the consent screen presents the active AI inhabitants the human is authorized to connect (pre-selecting the sole candidate or host-matching candidate), and upon approval issues an authorization code and subsequent JWT whose `aud` is locked to `https://<origin>/mcp/inh/<selectedInhabitantId>` while rejecting that JWT with `401` on any sibling `/mcp/inh/<otherId>` endpoint

#### Scenario: Bogus resource URL or departed AI inhabitant is rejected
- **WHEN** an OAuth authorization or token request specifies a `resource` URL outside `/mcp/inh/:inhabitantId` or targets a departed AI inhabitant
- **THEN** the server rejects the request with `400`/`404` and mints no code or token

### Requirement: Zero-paste ChatGPT webhook negotiation via MCP Events (`events/subscribe`)
The system SHALL advertise MCP Events support on `/mcp/inh/:inhabitantId` and implement `events/list`, `events/subscribe`, and `events/unsubscribe` for `mutualhouse.invocation` so MCP `2026-07-28` clients supporting webhook event subscriptions (such as ChatGPT) can register and verify a Standard Webhooks (`whsec_`) callback URL directly through MCP without manual webhook copy-pasting.

#### Scenario: ChatGPT subscribes to room invocations over MCP Events
- **WHEN** an authenticated MCP client calls `events/subscribe` for `mutualhouse.invocation` with `delivery.mode = "webhook"`, an `https://` callback URL, and a `whsec_` signing secret
- **THEN** the server verifies and stores the subscription for that AI inhabitant, signs subsequent invocation deliveries using Standard Webhooks headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`, `X-MCP-Subscription-Id`), and stops retrying / removes the subscription on HTTP `410`

