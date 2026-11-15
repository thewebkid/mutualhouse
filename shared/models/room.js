import { buildDef, buildInstanceFromDef, getDef } from '../lib/model-util.js';
import { Turn } from './turn.js';
import { Seal, ReadReceipt } from './seal.js';
import { CallSession } from './call-session.js';

export const ROUTING_MODES = Object.freeze({
  MANUAL: 'manual',
  ASSISTED: 'assisted',
  AUTHORIZED_AUTO: 'authorized_auto',
});

/**
 * Shared or private household space (`common`, `project`, `council`, `private`).
 * Parent pointer `this.house` is omitted from `static props`.
 */
export class Room {
  static props = [
    'id',
    'houseId',
    'slug',
    'name',
    'kind',
    'purpose',
    'routingMode',
    'paused',
    'autoTurnCap',
    'consecutiveAiTurns',
    'lastTurnSeq',
    'eventCursor',
    'archivedAt',
    'createdAt',
    'turns',
    'seals',
    'receipts',
    'callSession',
  ];

  isRoom = true;
  house = null;
  kind = 'common';
  routingMode = ROUTING_MODES.ASSISTED;
  paused = false;
  autoTurnCap = 3;
  consecutiveAiTurns = 0;
  lastTurnSeq = 0;
  eventCursor = 0;
  turns = [];
  seals = [];
  receipts = [];
  callSession = null;

  constructor(def = {}, house = null) {
    this.house = house;
    buildInstanceFromDef(this, def);
    this.kind = def.kind ?? 'common';
    this.routingMode = def.routingMode ?? ROUTING_MODES.ASSISTED;
    this.paused = Boolean(def.paused);
    this.autoTurnCap = def.autoTurnCap ?? 3;
    this.consecutiveAiTurns = def.consecutiveAiTurns ?? 0;
    this.lastTurnSeq = def.lastTurnSeq ?? 0;
    this.eventCursor = def.eventCursor ?? 0;

    this.seals = Array.isArray(def.seals) ? def.seals.map((s) => Seal.create(s, this)) : [];
    this.receipts = Array.isArray(def.receipts)
      ? def.receipts.map((r) => ReadReceipt.create(r, this))
      : [];
    this.turns = Array.isArray(def.turns)
      ? def.turns.map((t) => Turn.create(t, this)).sort((a, b) => a.seq - b.seq)
      : [];
    this.callSession = def.callSession ? CallSession.create(def.callSession, this) : null;

    if (house?.id && !this.houseId) {
      this.houseId = house.id;
    }
  }

  static create(def = {}, house = null) {
    const parsed = typeof def === 'string' ? JSON.parse(def) : def;
    const kind = parsed?.kind ?? 'common';
    if (kind === 'project') return ProjectRoom.create(parsed, house);
    if (kind === 'council') return CouncilRoom.create(parsed, house);
    if (kind === 'private') return PrivateRoom.create(parsed, house);
    return CommonRoom.create(parsed, house);
  }

  getTurn(turnId) {
    return this.turns.find((t) => t.id === turnId) ?? null;
  }

  getSeal(sealId) {
    return this.seals.find((s) => s.id === sealId) ?? null;
  }

  getReceipt(receiptId) {
    return this.receipts.find((r) => r.id === receiptId) ?? null;
  }

  get activeSeals() {
    return this.seals.filter((s) => s.isSealed);
  }

  get latestActiveSeal() {
    const active = this.activeSeals;
    return active.length ? active[active.length - 1] : null;
  }

  /**
   * Turns since the most recent `MemoryEpisode` woven for this room.
   */
  get unwovenTurns() {
    const episodes = (this.house?.memory?.episodes ?? []).filter((e) => e.roomId === this.id);
    const maxWovenSeq = episodes.reduce((max, ep) => Math.max(max, Number(ep.toTurnSeq || 0)), 0);
    return this.turns.filter((t) => !t.sealedStub && t.seq > maxWovenSeq);
  }

  /**
   * Returns ordered Turn projections permitted for `viewer` under active seals.
   * For AI inhabitants (`viewer.kind === 'ai'`), sealed sibling turns are omitted
   * completely so neither their text nor existence biases independent first readings.
   */
  visibleTurnsFor(viewer) {
    const result = [];
    for (const turn of this.turns) {
      const seal = turn.seal;
      if (seal && seal.hidesTurnFrom(turn, viewer)) {
        if (viewer?.kind === 'human') {
          result.push(Turn.create(turn.toVisibleDef(viewer), this));
        }
        continue;
      }
      result.push(turn);
    }
    return result.sort((a, b) => a.seq - b.seq);
  }

  /**
   * Upserts a Turn (deduplicating optimistic `commandId` or matching `id`) and
   * keeps `this.turns` sorted by chronological `turn.seq` without replacing the array.
   */
  upsertTurn(turnDef) {
    const incoming = turnDef?.isTurn ? turnDef : Turn.create(turnDef, this);
    incoming.room = this;

    const existingIdx = this.turns.findIndex(
      (t) =>
        (incoming.id && t.id === incoming.id) ||
        (incoming.commandId && t.commandId && t.commandId === incoming.commandId)
    );

    if (existingIdx >= 0) {
      this.turns.splice(existingIdx, 1, incoming);
    } else {
      // Insert in chronological `seq` order so unveiled sealed turns land in place
      const insertAt = this.turns.findIndex((t) => t.seq > incoming.seq);
      if (insertAt === -1) {
        this.turns.push(incoming);
      } else {
        this.turns.splice(insertAt, 0, incoming);
      }
    }
    if (incoming.seq > this.lastTurnSeq) {
      this.lastTurnSeq = incoming.seq;
    }
    return incoming;
  }

  upsertSeal(sealDef) {
    const incoming = sealDef?.isSeal ? sealDef : Seal.create(sealDef, this);
    incoming.room = this;
    const idx = this.seals.findIndex((s) => s.id === incoming.id);
    if (idx >= 0) {
      this.seals.splice(idx, 1, incoming);
    } else {
      this.seals.push(incoming);
    }
    return incoming;
  }

  upsertReceipt(receiptDef) {
    const incoming = receiptDef?.isReadReceipt
      ? receiptDef
      : ReadReceipt.create(receiptDef, this);
    incoming.room = this;
    const idx = this.receipts.findIndex((r) => r.id === incoming.id);
    if (idx >= 0) {
      this.receipts.splice(idx, 1, incoming);
    } else {
      this.receipts.push(incoming);
    }
    return incoming;
  }

  toTranscriptMarkdown() {
    const lines = [`# Room Transcript — #${this.slug} (${this.name})`, ''];
    for (const turn of this.turns) {
      if (turn.sealedStub) continue;
      const authorName = turn.author?.name ?? turn.authorId;
      const originNote = turn.origin === 'imported' ? ' *(imported packet)*' : '';
      lines.push(`## ${authorName} · #${turn.seq} · ${turn.createdAt}${originNote}`);
      lines.push('');
      lines.push(turn.body || '*(attachment)*');
      for (const att of turn.attachments) {
        lines.push(`- Attachment [${att.kind}]: \`${att.fileName || att.r2Key}\``);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  get def() {
    const base = buildDef(this);
    base.turns = this.turns.map(getDef);
    base.seals = this.seals.map(getDef);
    base.receipts = this.receipts.map(getDef);
    base.callSession = this.callSession ? getDef(this.callSession) : null;
    return base;
  }
}

export class CommonRoom extends Room {
  kind = 'common';
  static create(def = {}, house = null) {
    return new CommonRoom({ ...def, kind: 'common' }, house);
  }
}

export class ProjectRoom extends Room {
  static props = [...Room.props, 'category'];
  kind = 'project';
  constructor(def = {}, house = null) {
    super({ ...def, kind: 'project' }, house);
    this.category = def.category ?? '';
  }
  static create(def = {}, house = null) {
    return new ProjectRoom(def, house);
  }
}

export class CouncilRoom extends Room {
  kind = 'council';
  static create(def = {}, house = null) {
    return new CouncilRoom({ ...def, kind: 'council' }, house);
  }
}

export class PrivateRoom extends Room {
  static props = [...Room.props, 'ownerInhabitantId'];
  kind = 'private';
  constructor(def = {}, house = null) {
    super({ ...def, kind: 'private' }, house);
    this.ownerInhabitantId = def.ownerInhabitantId ?? null;
  }
  static create(def = {}, house = null) {
    return new PrivateRoom(def, house);
  }
}
