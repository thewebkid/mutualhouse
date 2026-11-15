import { buildDef, buildInstanceFromDef, getDef } from '../lib/model-util.js';

export class Attachment {
  static props = [
    'id',
    'turnId',
    'kind',
    'fileName',
    'mimeType',
    'byteLength',
    'sha256',
    'r2Key',
    'signedUrl',
    'signedUrlExpiresAt',
    'createdAt',
  ];

  isAttachment = true;
  turn = null;
  kind = 'file';

  constructor(def = {}, turn = null) {
    this.turn = turn;
    buildInstanceFromDef(this, def);
  }

  static create(def = {}, turn = null) {
    const parsed = typeof def === 'string' ? JSON.parse(def) : def;
    const kind = parsed?.kind ?? inferAttachmentKind(parsed?.mimeType);
    if (kind === 'audio') return AudioAttachment.create(parsed, turn);
    if (kind === 'image') return ImageAttachment.create(parsed, turn);
    if (kind === 'pdf') return PdfAttachment.create(parsed, turn);
    return new Attachment({ ...parsed, kind }, turn);
  }

  get isAudio() {
    return this.kind === 'audio';
  }

  get isImage() {
    return this.kind === 'image';
  }

  get isPdf() {
    return this.kind === 'pdf';
  }

  get def() {
    return buildDef(this);
  }
}

export class AudioAttachment extends Attachment {
  static props = [...Attachment.props, 'durationMs', 'transcriptText', 'transcriptTurnId'];

  kind = 'audio';
  durationMs = null;
  transcriptText = null;
  transcriptTurnId = null;

  constructor(def = {}, turn = null) {
    super({ ...def, kind: 'audio' }, turn);
    this.durationMs = def.durationMs ?? null;
    this.transcriptText = def.transcriptText ?? null;
    this.transcriptTurnId = def.transcriptTurnId ?? null;
  }

  static create(def = {}, turn = null) {
    return new AudioAttachment(def, turn);
  }

  get formattedDuration() {
    if (!this.durationMs) return '';
    const totalSec = Math.round(this.durationMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = String(totalSec % 60).padStart(2, '0');
    return `${min}:${sec}`;
  }
}

export class ImageAttachment extends Attachment {
  static props = [...Attachment.props, 'width', 'height', 'alt'];

  kind = 'image';

  constructor(def = {}, turn = null) {
    super({ ...def, kind: 'image' }, turn);
    this.width = def.width ?? null;
    this.height = def.height ?? null;
    this.alt = def.alt ?? '';
  }

  static create(def = {}, turn = null) {
    return new ImageAttachment(def, turn);
  }
}

export class PdfAttachment extends Attachment {
  static props = [...Attachment.props, 'pageCount'];

  kind = 'pdf';

  constructor(def = {}, turn = null) {
    super({ ...def, kind: 'pdf' }, turn);
    this.pageCount = def.pageCount ?? null;
  }

  static create(def = {}, turn = null) {
    return new PdfAttachment(def, turn);
  }
}

export function inferAttachmentKind(mimeType = '') {
  const m = String(mimeType).toLowerCase();
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  return 'file';
}

/**
 * Spoken or imported contribution inside a Room (`Tier 0` verbatim record).
 */
export class Turn {
  static props = [
    'id',
    'seq',
    'roomId',
    'houseId',
    'commandId',
    'authorId',
    'replyToId',
    'origin',
    'contributionKind',
    'body',
    'bodySha256',
    'sealedStub',
    'sealId',
    'invokedInhabitantIds',
    'memoryVersion',
    'readReceiptId',
    'packetDrift',
    'transcriptOfTurnId',
    'attachments',
    'createdAt',
  ];

  isTurn = true;
  room = null;
  origin = 'native'; // native | imported
  contributionKind = 'turn'; // turn | proposal | draft | critique | decision | arrival | departure
  sealedStub = false;
  packetDrift = false;
  invokedInhabitantIds = [];
  attachments = [];
  _optimistic = false;

  constructor(def = {}, room = null) {
    this.room = room;
    buildInstanceFromDef(this, def);
    this.origin = def.origin ?? 'native';
    this.contributionKind = def.contributionKind ?? 'turn';
    this.sealedStub = Boolean(def.sealedStub);
    this.packetDrift = Boolean(def.packetDrift);
    this.invokedInhabitantIds = Array.isArray(def.invokedInhabitantIds)
      ? [...def.invokedInhabitantIds]
      : [];
    this.attachments = Array.isArray(def.attachments)
      ? def.attachments.map((a) => Attachment.create(a, this))
      : [];
    this._optimistic = Boolean(def._optimistic);
  }

  static create(def = {}, room = null) {
    return new Turn(typeof def === 'string' ? JSON.parse(def) : def, room);
  }

  get author() {
    return this.room?.house?.getInhabitant(this.authorId) ?? null;
  }

  get replyTo() {
    if (!this.replyToId) return null;
    return this.room?.getTurn(this.replyToId) ?? null;
  }

  get seal() {
    if (!this.sealId) return null;
    return this.room?.getSeal(this.sealId) ?? null;
  }

  get readReceipt() {
    if (!this.readReceiptId) return null;
    return this.room?.getReceipt(this.readReceiptId) ?? null;
  }

  get siblingTranscriptTurn() {
    return this.room?.turns?.find((t) => t.transcriptOfTurnId === this.id) ?? null;
  }

  /**
   * Returns a viewer-safe projection of this turn's plain `.def` (omitting `body`
   * and `attachments` if an active Seal restricts `viewer`).
   */
  toVisibleDef(viewer) {
    const activeSeal = this.seal;
    if (activeSeal && activeSeal.hidesTurnFrom(this, viewer)) {
      return {
        id: this.id,
        seq: this.seq,
        roomId: this.roomId,
        houseId: this.houseId,
        authorId: this.authorId,
        replyToId: this.replyToId ?? null,
        origin: this.origin,
        contributionKind: this.contributionKind,
        body: '',
        bodySha256: this.bodySha256,
        sealedStub: true,
        sealId: this.sealId,
        invokedInhabitantIds: [],
        memoryVersion: this.memoryVersion ?? null,
        readReceiptId: this.readReceiptId ?? null,
        attachments: [],
        createdAt: this.createdAt,
      };
    }
    return this.def;
  }

  get def() {
    const base = buildDef(this);
    base.attachments = this.attachments.map(getDef);
    return base;
  }
}
