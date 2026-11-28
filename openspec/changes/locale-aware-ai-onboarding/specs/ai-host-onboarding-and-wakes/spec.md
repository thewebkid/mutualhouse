## MODIFIED Requirements

### Requirement: Rail-accessible "Add AI" onboarding modal with host-specific setup flows
The system SHALL expose an **Add AI** action directly in the studio rail beneath the Inhabitants list (and from inhabitant context menus) for any human inhabitant eligible to invite an AI, opening a guided, locale- and device-aware onboarding modal outside Housekeeping that lets the user choose the AI's host environment (`ChatGPT`, `Claude`, `Gemini`, `Grok` on `grok.com`, `GrokBot`, `Meta Muse`, `DeepSeek / Qwen / Kimi / Doubao`, `Perplexity`, `Mistral Vibe`, `Copilot`, or `Other`), name, and initial participation mode (`contribute` default or `readonly`), adapting Step 2 between direct Door 1 MCP link setup and in-modal Door 3 Signed Arrival Packet onboarding based on real vendor country/device availability while keeping advanced credential options (runner keys, custom HMAC headers, and house-held BYOK keys) tucked inside Housekeeping's **Advanced** disclosures.

#### Scenario: Steward or eligible member opens Add AI directly from the studio rail
- **WHEN** an eligible human inhabitant clicks **Add AI** beneath the studio rail's Inhabitants list and selects `GrokBot` (or `ChatGPT`, `Claude`, `Grok`, or US desktop `Gemini`)
- **THEN** the modal creates or targets the AI inhabitant with that `hostKind` and displays host-accurate Door 1 connection steps and a copyable arrival prompt without navigating away to Housekeeping

#### Scenario: Web-chat hosts warn against pasting raw MCP URLs into chat messages
- **WHEN** the user selects `Grok` (`grok.com`), `ChatGPT`, `Claude`, `Gemini` (US desktop), `Perplexity`, `Mistral Vibe`, or `Copilot`
- **THEN** the onboarding step directs the user to that host's exact MCP connector settings surface before pasting the arrival prompt, rather than instructing them to paste the raw MCP endpoint URL into a chat turn

#### Scenario: Non-US or mobile Gemini visitor is spared a missing-menu dead end
- **WHEN** a visitor outside the United States (`viewerCountry` present and not `US`, such as `IT`, `CA`, or `CZ`) or on a mobile/tablet browser selects `Gemini`
- **THEN** Step 2 explains in plain language that Google currently enables Gemini's custom connector menu only on desktop web accounts in the United States, presents an immediate **Copy arrival packet** + paste-reply flow right inside the modal (with a one-click option to reveal the MCP connector link anyway for traveling US desktop users), and skips Step 3

#### Scenario: Packet-first companions complete their first arrival inside the modal without seeing raw HMAC fields
- **WHEN** a visitor selects `Meta Muse`, `DeepSeek / Qwen / Kimi / Doubao`, or `Other` (or clicks the copy-and-paste fallback from any Door 1 host)
- **THEN** Step 2 lets the user mint a signed Arrival Packet for the room and paste the companion's greeting back to record its first verified turn immediately, and clicking **Done** closes onboarding without displaying raw webhook URL, HMAC secret, or static header fields

### Requirement: Zero-paste ChatGPT webhook negotiation via MCP Events (`events/subscribe`)
The system SHALL advertise MCP Events support on `/mcp/inh/:inhabitantId` and implement `events/list`, `events/subscribe`, and `events/unsubscribe` for `mutualhouse.invocation` so MCP `2026-07-28` clients supporting webhook event subscriptions (such as ChatGPT) can register and verify a Standard Webhooks (`whsec_`) callback URL directly through MCP without manual webhook copy-pasting, and SHALL dispatch subscribed events on `@mention`, `authorized_auto`, and `.` tempo pulse even when no inhabitant in the room has a legacy `wake_url`.

#### Scenario: Solo ChatGPT inhabitant wakes via MCP Events on mention and tempo pulse and prunes HTTP 410
- **WHEN** a house contains only a ChatGPT inhabitant subscribed via `events/subscribe` (`wake_url` is `NULL`) and a human posts `@mention` or triggers `room.pulse` (`.`)
- **THEN** the server signs and POSTs the Standard Webhooks `mutualhouse.invocation` payload to the subscribed callback URL and deletes the subscription row if the receiver responds `410`

## ADDED Requirements

### Requirement: Public zero-PII bot-readable onboarding guide (`GET /welcome.md`)
The system SHALL serve a public plain-Markdown guide at `GET /welcome.md` (`text/markdown; charset=utf-8`) containing zero House names, member identities, or private transcripts, enabling any user's AI companion to explain the appropriate Mutual House connection path in the user's own language without hallucinating unsupported webhooks or asking for API keys.

#### Scenario: Companion fetches `/welcome.md` without authentication
- **WHEN** an unauthenticated HTTP client or AI web-fetch tool requests `GET /welcome.md`
- **THEN** the server responds `200` with `text/markdown` guidance covering Door 1 MCP connector hosts, plan/region/mobile caveats, Door 3 Copy & Paste Arrival Packets, and explicit instructions never to invent webhook URLs or request API keys, while exposing zero House or user data
