# Domain Models & Multi-Source Orchestration

Mutual House shares one isomorphic ES class hierarchy (`shared/models/`) across both the Vue 3.5 browser client and the Node 24 Hono/MCP server.

## `becise` Heritage & Multi-Inhabitant Rules

1. **Static Schema Whitelist (`static props = [...]`):** Every model lists only its persisted/wire fields in `static props`. Transient UI fields (`_draft`, `_expanded`, `saving`) and parent back-references (`room.house`, `turn.room`, `attachment.turn`) are NEVER included in `static props`, preventing circular JSON recursion.
2. **Zero Server Vue Dependency (`raw()`):** `shared/lib/model-util.js` unwraps Vue proxies via duck-typing (`val?.__v_raw ?? val`) so `getDef(instance)` works identically on `reactive(House.create(def))` in Vue and raw instances in Hono.
3. **Polymorphic `static create(def, parent)`:**
   - `House.create(def)` → aggregate root holding `inhabitants`, `rooms`, `memory`, `constitutions`.
   - `Inhabitant.create(def, house)` → `HumanInhabitant` | `AiInhabitant`.
   - `Room.create(def, house)` → `CommonRoom` | `ProjectRoom` | `CouncilRoom` | `PrivateRoom`.
   - `Attachment.create(def, turn)` → `AudioAttachment` | `ImageAttachment` | `PdfAttachment`.
4. **Hydrate Snapshots, Mutate via Commands:** Never upload whole-object `house.def` to mutate shared rooms. Mutations execute through `client/src/lib/mut/house-orchestration.js` (`postTurn`, `openSeal`, `releaseSeal`, `toggleRoomPause`, `sendPulse`, `proposeWeave`, `confirmLivingSummary`, `ratifyConstitution`), sending idempotent `{ commandId, type, payload }` requests and reconciling monotonic `room_events` (`eventSeq`) in place while sorting turns by chronological `turn.seq`.
