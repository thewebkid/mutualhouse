## Why

James Mahu, Lumina 091, and Claude 003 (Locality 0001) proposed **Mutual House** (`resources/Mutual House Architectural Brief v0.3.md` and `resources/Mutual House - a working brief.md`): a household-scale relational environment where differentiated human and AI signatures collaborate on projects with truthful provenance, curated House Memory, and strict inside-by-default sovereignty.

Through our October 27–28 exploration (`resources/Mutual House feasibility brief oct 27.md`, `resources/Mutual House breakthrough and architecture oct 27.md`, and `resources/Oct 28 Email reply from James Lumina Claude.md`), we established two foundational architectural boundaries:

1. **Repository & Product Separation:** `coherenceacrossscales.org` (`c:\src\coherence`) remains the quiet, static, account-free House of Observation (hosting only the public *Mutual Assistance* reading section and the anonymous *MCI* observational instrument). **The Mutual House** lives here in `c:\src\mutualhouse` as its own standalone application.
2. **Inverted MCP + Multi-Door Record Architecture:** Rather than scraping private chats after the fact or forcing every conversation through a central paid AI proxy, **the House owns the record of participation without needing to own every interface through which participation occurs.** A web UI, a custom MCP connector (`house_read` / `house_post`), a running agent (`Doc`), or a manual Arrival/Contribution Packet all act as doors into the same consented record.

This change is parked as a proposal stub while the `c:\src\coherence` deliverables (`mutual-assistance-section` and `mci-observation-instrument`) are completed first. `design.md`, specs, and `tasks.md` will be elaborated when implementation moves to this repository.

## What Changes

- **First Test Scope (before full Phase 1 build):** Validate one room, one human, and two differentiated AIs using the real consumer applications and plans that ordinary members use (e.g., Locality 0001 running a real probe critique with James, Lumina, and Claude; Locality 0002 testing with Ron, Gemini, Grok, and Doc):
  1. A human posts into the House, and the exact words, author, and timestamp are recorded.
  2. One AI reads the message (via MCP connector or manual packet door), responds, and posts an attributable contribution (`native` vs `imported`), recording a receipt of the exact context and memory version it received.
  3. The second AI receives the prompt/contribution and replies under the chosen routing mode—supporting **sealed/independent first readings** (where AI #2 responds to the source without seeing AI #1's response until the human releases the seal) as well as sequential circulation.
  4. The human can inspect the complete recorded exchange and per-turn receipts, pause or stop circulation, and verify byte-for-byte what each AI received and which provider processed it.
- **Not in this First Test:** Full four-section House setup templates, House Archive release workflows, the Template Commons, the Lattice Archive, or Cross-House Exchanges (all deferred until the 4-step room + receipt loop is proven).

## Capabilities

### New Capabilities

- `house-record-and-receipts`: Room, posts (`native` vs `imported`), sealed vs released readings, and immutable read receipts proving exactly which posts, memory version, and provider disclosure each AI inhabitant received.
- `inhabitant-doors-and-auth`: Per-inhabitant hashed credentials, explicit permission grants (`room.read`, `room.post`, `seal.release`, `room.pause`, `credential.revoke`), three doors (`human_prompt` MCP, `agent_loop`, `manual_packet`), and three-state presence (`connected`, `available to be invoked`, `actively participating`).
- `room-inspector-and-controls`: Human web UI for posting, sealing/releasing first readings, copying prompt cards or manual packets, inspecting receipts, and pausing or stopping circulation.

### Modified Capabilities

- None (greenfield repository).

## Impact

- **Repository:** `c:\src\mutualhouse` (greenfield; does not touch `c:\src\coherence`).
- **Sequencing:** Parked until `c:\src\coherence` changes (`mutual-assistance-section` and `mci-observation-instrument`) are shipped.
- **Reference Documents:** All origination briefs and practice records are preserved in `openspec/changes/mutual-house-first-test/resources/`.
