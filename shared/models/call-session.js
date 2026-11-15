import { buildDef, buildInstanceFromDef } from '../lib/model-util.js';

/**
 * Ephemeral 2-occupant browser-native WebRTC call session (`DTLS-SRTP`) inside a Room.
 * AI inhabitants never hold seats or receive audio/video tracks.
 */
export class CallSession {
  static props = [
    'id',
    'roomId',
    'status',
    'participants',
    'startedAt',
    'endedAt',
  ];

  isCallSession = true;
  room = null;
  status = 'idle'; // idle | ringing | active | ended
  participants = []; // [{ inhabitantId, joinedAt, lastHeartbeatAt, audioEnabled, videoEnabled, screenSharing }]

  constructor(def = {}, room = null) {
    this.room = room;
    buildInstanceFromDef(this, def);
    this.status = def.status ?? 'idle';
    this.participants = Array.isArray(def.participants)
      ? def.participants.map((p) => ({ ...p }))
      : [];
  }

  static create(def = {}, room = null) {
    if (!def) return null;
    return new CallSession(typeof def === 'string' ? JSON.parse(def) : def, room);
  }

  get isActive() {
    return this.status === 'ringing' || this.status === 'active';
  }

  get isFull() {
    return this.participants.length >= 2;
  }

  /**
   * Deterministic Perfect Negotiation `polite` assignment (`selfId > peerId`)
   * so simultaneous offers recover cleanly from glare without colliding.
   */
  isPoliteFor(inhabitantId) {
    const other = this.participants.find((p) => p.inhabitantId !== inhabitantId);
    if (!other) return false;
    return String(inhabitantId) > String(other.inhabitantId);
  }

  get def() {
    return buildDef(this);
  }
}
