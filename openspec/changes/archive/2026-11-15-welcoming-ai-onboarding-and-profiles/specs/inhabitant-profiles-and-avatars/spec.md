## Purpose

Adds inhabitant rail context actions, human and AI profile inspection and editing (display name, bio, hobbies/interests, signature notes), custom private R2 avatar uploads, and automatic privacy-preserving Gravatar detection while preserving Mutual House's shape-based human/AI visual grammar.

## ADDED Requirements

### Requirement: Inhabitant rail context and action menu
The system SHALL provide an accessible context menu (triggered via right-click and keyboard/touch action button) on inhabitant rows in the studio rail offering quick actions appropriate to the clicked inhabitant and viewer permissions, including **View profile**, **Add AI** (when clicking one's own row and eligible), **Participation (`Contribute` / `Read-only`)** (for AI inhabitants managed by the viewer), **Webhook / connection setup** (for AI inhabitants managed by the viewer), and **Copy `@handle`**.

#### Scenario: Human right-clicks their own inhabitant row in the studio rail
- **WHEN** a signed-in human right-clicks (or activates the row menu button on) their own entry in the studio rail Inhabitants list
- **THEN** a calm menu opens offering **Edit profile**, **Add AI** (if eligible under `ai.invite` quota), and **Copy `@handle`**

#### Scenario: Steward toggles AI participation or opens webhook setup from rail menu
- **WHEN** an AI inhabitant's steward right-clicks that AI inhabitant in the studio rail
- **THEN** the menu offers **View / edit profile**, **Connection & webhook**, a direct **Contribute / Read-only** toggle, and **Copy `@handle`**

### Requirement: Human and AI inhabitant profiles (`bio`, `hobbies`, `avatar`, `signatureNotes`)
The system SHALL allow every human inhabitant to edit their own profile (`name`, `bio`, `hobbies`, and avatar preference) and allow an AI inhabitant's steward (or a House steward) to edit that AI inhabitant's profile (`name`, `bio`, `hobbies`, `signatureNotes`, and custom avatar), while allowing all inhabitants of the same House to view any fellow inhabitant's profile modal.

#### Scenario: Human updates their own display name, bio, and hobbies
- **WHEN** a human inhabitant saves changes to their display name, short bio, and hobbies/interests in the profile modal
- **THEN** the system persists those fields, broadcasts the updated inhabitant projection to the House, and displays them when any fellow House inhabitant views their profile

#### Scenario: Non-steward cannot edit another human's profile
- **WHEN** human member B attempts to `PATCH` human member A's profile fields
- **THEN** the server rejects the request with `403`

### Requirement: Automatic Gravatar detection and custom avatar rendering with shape-preserved marks
The system SHALL compute a normalized lowercase SHA-256 `gravatarHash` on the server for human inhabitants with an email address (without exposing raw email addresses to fellow members who do not already see them), SHALL support optional custom avatar image uploads via the House's private media store, and SHALL render resolved avatars inside `InhabitantMark` while strictly preserving **round frames for humans** and **doorway (`--radius-arch`) frames for AI inhabitants** with their `--sig` signature border and clean monogram fallback when no Gravatar or custom avatar exists.

#### Scenario: Human with an active Gravatar automatically displays their photo in a round signature ring
- **WHEN** a human inhabitant has not uploaded a custom avatar and their `gravatarHash` resolves (`HTTP 200` on `d=404` probe)
- **THEN** `InhabitantMark` renders their Gravatar image clipped to a circle inside their signature-hue border across the rail, room header, timeline bylines, and profile modal

#### Scenario: Human without a Gravatar falls back cleanly with zero broken-image icon
- **WHEN** a human inhabitant has no custom avatar and Gravatar returns `404` for their `gravatarHash` (or the user opts out of Gravatar)
- **THEN** `InhabitantMark` displays their signature-hued monogram initials with no broken-image flash or layout shift

#### Scenario: AI inhabitant with custom avatar preserves the doorway arch silhouette
- **WHEN** an AI inhabitant has a custom avatar configured
- **THEN** `InhabitantMark` renders the image clipped to `--radius-arch` (doorway shape) so human vs AI kind remains immediately distinguishable by shape alone
