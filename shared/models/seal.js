import { buildDef, buildInstanceFromDef } from '../lib/model-util.js';

/**
 * Seal governing independent first readings on a prompt turn.
 *
 * Modes:
 *  - `peer_sealed`: AI inhabitants cannot see sibling responses attached to this
 *    seal until `status === 'released'`, while human stewards may inspect progress.
 *  - `blind_simultaneous`: ALL viewers (except each response's own author) are
 *    blind to sealed responses until every inhabitant in `targetInhabitantIds`
 *    has responded OR an authorized human manually releases the seal.
 */
export class Seal {
  static props = [
    'id',
    'roomId',
    'promptTurnId',
    'mode',
    'status',
    'targetInhabitantIds',
    'respondedInhabitantIds',
    'openedByInhabitantId',
    'releasedByInhabitantId',
    'openedAt',
    'releasedAt',
  ];

  isSeal = true;
  room = null;
  mode = 'peer_sealed';
  status = 'sealed';
  targetInhabitantIds = [];
  respondedInhabitantIds = [];

  constructor(def = {}, room = null) {
    this.room = room;
    buildInstanceFromDef(this, def);
    this.mode = def.mode ?? 'peer_sealed';
    this.status = def.status ?? 'sealed';
    this.targetInhabitantIds = Array.isArray(def.targetInhabitantIds)
      ? [...def.targetInhabitantIds]
      : [];
    this.respondedInhabitantIds = Array.isArray(def.respondedInhabitantIds)
      ? [...def.respondedInhabitantIds]
      : [];
  }

  static create(def = {}, room = null) {
    return new Seal(typeof def === 'string' ? JSON.parse(def) : def, room);
  }

  get isSealed() {
    return this.status === 'sealed';
  }

  get isReleased() {
    return this.status === 'released';
  }

  get pendingInhabitantIds() {
    return this.targetInhabitantIds.filter((id) => !this.respondedInhabitantIds.includes(id));
  }

  get isReadyToAutoUnveil() {
    return (
      this.mode === 'blind_simultaneous' &&
      this.targetInhabitantIds.length > 0 &&
      this.pendingInhabitantIds.length === 0
    );
  }

  /**
   * Returns true if `viewer` is NOT allowed to read `turn`'s body while this seal holds.
   */
  hidesTurnFrom(turn, viewer) {
    if (!this.isSealed) return false;
    if (!turn || turn.sealId !== this.id) return false;
    // Prompt turn itself is never hidden by the seal it opens
    if (turn.id === this.promptTurnId) return false;
    if (!viewer) return true;
    // Author can always read their own turn
    if (turn.authorId === viewer.id) return false;

    if (this.mode === 'blind_simultaneous') {
      return true;
    }
    // peer_sealed: AI peers are blind to each other's sealed readings; humans can inspect
    return viewer.kind === 'ai';
  }

  get def() {
    return buildDef(this);
  }
}

/**
 * Immutable byte-for-byte audit proving the exact room projection, memory version,
 * and provider disclosure delivered to an AI inhabitant at read time.
 */
export class ReadReceipt {
  static props = [
    'id',
    'houseId',
    'roomId',
    'inhabitantId',
    'doorType',
    'turnIds',
    'turnDigests',
    'memoryVersion',
    'constitutionVersion',
    'excludedSealIds',
    'contextSha256',
    'providerDisclosure',
    'createdAt',
  ];

  isReadReceipt = true;
  room = null;
  turnIds = [];
  turnDigests = [];
  excludedSealIds = [];

  constructor(def = {}, room = null) {
    this.room = room;
    buildInstanceFromDef(this, def);
    this.turnIds = Array.isArray(def.turnIds) ? [...def.turnIds] : [];
    this.turnDigests = Array.isArray(def.turnDigests) ? [...def.turnDigests] : [];
    this.excludedSealIds = Array.isArray(def.excludedSealIds) ? [...def.excludedSealIds] : [];
  }

  static create(def = {}, room = null) {
    return new ReadReceipt(typeof def === 'string' ? JSON.parse(def) : def, room);
  }

  get inhabitant() {
    return this.room?.house?.getInhabitant(this.inhabitantId) ?? null;
  }

  get shortHash() {
    return this.contextSha256 ? this.contextSha256.slice(0, 12) : '';
  }

  get def() {
    return buildDef(this);
  }
}
