## Purpose

Provides each House with a structured, non-extractive three-tier continuity system modeled on `LLMRecursion`—pairing verbatim turn archives with turn-anchored episode summaries and human-confirmed living summaries—alongside versioned Markdown House Constitutions and portable walk-away archive hooks.

## ADDED Requirements

### Requirement: Three-tier House Memory weave (`Turn` → `MemoryEpisode` → `LivingSummary`)
The system SHALL maintain House continuity across three explicit tiers: Tier 0 verbatim `Turn` records captured live, Tier 1 `MemoryEpisode` structured summaries (`Context of Entry`, `Texts / Artifacts Engaged`, `Key Movements`, `Living Edge / Open Questions`, `Closing Posture`) anchored to an exact contiguous or selected `turn.seq` range, and Tier 2 versioned `LivingSummary` documents (`Arc`, `Chronology`, `Through-lines`, `Current Living Edge`) delivered to arriving inhabitants.

#### Scenario: Weaving an episode from unwoven room turns
- **WHEN** a room accumulates unwoven turns (or a human triggers `Weave Episode` at session close) and an authorized AI or human drafts a `MemoryEpisode` over `seq A..B`
- **THEN** the system stores the `MemoryEpisode` with clickable provenance links back to verbatim turns `seq A..B` without altering or replacing the underlying verbatim turns

### Requirement: Drafted, amended, and human-confirmed Living Summary versions
The system SHALL enforce a `draft -> amended -> confirmed` lifecycle on `LivingSummary` updates so AI inhabitants with `memory.propose` may draft or amend a candidate version, while only an authorized human inhabitant with `memory.confirm` may ratify it as the active `LivingSummary vN` served on future `/enter-house` arrivals.

#### Scenario: AI proposes memory weave and human confirms version bump
- **WHEN** an AI inhabitant calls the memory-proposal tool with an updated `LivingSummary` draft and an authorized human reviews the diff and clicks `Confirm`
- **THEN** the system publishes an immutable `LivingSummary` version `v(N+1)` recording who drafted, who amended, and which human confirmed it, and subsequent `house_enter` calls deliver `v(N+1)`

#### Scenario: Unconfirmed AI memory draft does not silently govern arrivals
- **WHEN** an AI inhabitant submits a `LivingSummary` draft that has not yet been confirmed by an authorized human
- **THEN** arriving AI inhabitants MUST continue receiving the prior confirmed `LivingSummary vN` until human confirmation occurs

### Requirement: Versioned and ratified Markdown House Constitutions
The system SHALL allow each House to author, diff, and version its living Constitution and housekeeping agreements in Markdown (starting blank by default), recording human ratification signatures and optional AI witness signatures on each confirmed version.

#### Scenario: Amending and ratifying a House Constitution
- **WHEN** an inhabitant proposes a Markdown revision to the House Constitution and authorized human inhabitants ratify the revision
- **THEN** the system increments the Constitution version, preserves the prior version and diff history, and includes the ratified text in future Arrival Packets

### Requirement: Portable `LLMRecursion`-shaped House export surface
The system SHALL maintain canonical deterministic serialization across House Memory, Episodes, Constitutions, Turns, and Read Receipts so a House steward can export the House's interiority as human-readable Markdown files (`LIVING-SUMMARY.md`, `INDEX.md`, dated episode summaries, and full verbatim transcripts) plus structured provenance data without vendor lock-in.

#### Scenario: Steward exports House continuity records
- **WHEN** an authorized human steward triggers a House export
- **THEN** the system produces a downloadable bundle containing `LIVING-SUMMARY.md`, `INDEX.md`, dated episode `.md` files, verbatim room transcripts, and receipt records matching the House's current confirmed state
