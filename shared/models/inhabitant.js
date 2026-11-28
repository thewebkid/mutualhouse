import { buildDef, buildInstanceFromDef } from '../lib/model-util.js';

export const INHABITANT_GRANTS = Object.freeze({
  ROOM_READ: 'room.read',
  ROOM_POST: 'room.post',
  MEMORY_PROPOSE: 'memory.propose',
  MEMORY_CONFIRM: 'memory.confirm',
  SEAL_RELEASE: 'seal.release',
  ROOM_PAUSE: 'room.pause',
  CONSTITUTION_RATIFY: 'constitution.ratify',
  CREDENTIAL_REVOKE: 'credential.revoke',
  HOUSE_MANAGE: 'house.manage',
  AI_INVITE: 'ai.invite',
});

export const HUMAN_STEWARD_DEFAULT_GRANTS = Object.freeze([
  INHABITANT_GRANTS.ROOM_READ,
  INHABITANT_GRANTS.ROOM_POST,
  INHABITANT_GRANTS.MEMORY_PROPOSE,
  INHABITANT_GRANTS.MEMORY_CONFIRM,
  INHABITANT_GRANTS.SEAL_RELEASE,
  INHABITANT_GRANTS.ROOM_PAUSE,
  INHABITANT_GRANTS.CONSTITUTION_RATIFY,
  INHABITANT_GRANTS.CREDENTIAL_REVOKE,
  INHABITANT_GRANTS.HOUSE_MANAGE,
  INHABITANT_GRANTS.AI_INVITE,
]);

export const HUMAN_MEMBER_DEFAULT_GRANTS = Object.freeze([
  INHABITANT_GRANTS.ROOM_READ,
  INHABITANT_GRANTS.ROOM_POST,
  INHABITANT_GRANTS.MEMORY_PROPOSE,
  INHABITANT_GRANTS.MEMORY_CONFIRM,
  INHABITANT_GRANTS.SEAL_RELEASE,
  INHABITANT_GRANTS.ROOM_PAUSE,
  INHABITANT_GRANTS.CONSTITUTION_RATIFY,
  INHABITANT_GRANTS.AI_INVITE,
]);

export const AI_DEFAULT_GRANTS = Object.freeze([
  INHABITANT_GRANTS.ROOM_READ,
  INHABITANT_GRANTS.ROOM_POST,
  INHABITANT_GRANTS.MEMORY_PROPOSE,
]);

/**
 * Base sovereign inhabitant (`human` or `ai`).
 * Parent pointer `this.house` is intentionally excluded from `static props`.
 */
export class Inhabitant {
  static props = [
    'id',
    'houseId',
    'kind',
    'name',
    'handle',
    'roleLabel',
    'signatureNotes',
    'presence',
    'lastSeenAt',
    'grants',
    'roomGrants',
    'bio',
    'hobbies',
    'avatarUrl',
    'gravatarHash',
    'useGravatar',
    'createdAt',
  ];

  isInhabitant = true;
  house = null;
  grants = [];
  roomGrants = {};
  presence = 'invocable';
  bio = '';
  hobbies = [];
  avatarUrl = null;
  gravatarHash = null;
  useGravatar = true;

  constructor(def = {}, house = null) {
    this.house = house;
    buildInstanceFromDef(this, def);
    this.grants = Array.isArray(def.grants) ? [...def.grants] : [];
    this.roomGrants = def.roomGrants && typeof def.roomGrants === 'object' ? { ...def.roomGrants } : {};
    this.bio = def.bio ?? '';
    this.hobbies = Array.isArray(def.hobbies) ? [...def.hobbies] : [];
    this.avatarUrl = def.avatarUrl ?? null;
    this.gravatarHash = def.gravatarHash ?? null;
    this.useGravatar = def.useGravatar !== false;
    if (house?.id && !this.houseId) {
      this.houseId = house.id;
    }
  }

  static create(def = {}, house = null) {
    const parsed = typeof def === 'string' ? JSON.parse(def) : def;
    if (parsed?.kind === 'ai') {
      return AiInhabitant.create(parsed, house);
    }
    return HumanInhabitant.create(parsed, house);
  }

  get isHuman() {
    return this.kind === 'human';
  }

  get isAi() {
    return this.kind === 'ai';
  }

  get initials() {
    const parts = String(this.name || this.handle || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
  }

  can(grant, roomId = null) {
    if (roomId && Array.isArray(this.roomGrants?.[roomId])) {
      return this.roomGrants[roomId].includes(grant) || this.grants.includes(INHABITANT_GRANTS.HOUSE_MANAGE);
    }
    return this.grants.includes(grant) || this.grants.includes(INHABITANT_GRANTS.HOUSE_MANAGE);
  }

  get presenceLabel() {
    if (this.departedAt) return 'Departed';
    if (this.presence === 'participating') return 'Actively participating';
    if (this.presence === 'connected') return 'Connected';
    return 'Available to invoke';
  }

  get def() {
    return buildDef(this);
  }
}

export class HumanInhabitant extends Inhabitant {
  static props = [...Inhabitant.props, 'userId', 'email', 'isFounder'];

  kind = 'human';
  isFounder = false;

  constructor(def = {}, house = null) {
    super({ ...def, kind: 'human' }, house);
    this.userId = def.userId ?? null;
    this.email = def.email ?? null;
    this.isFounder = Boolean(def.isFounder);
    if (!this.grants.length) {
      this.grants = this.isFounder
        ? [...HUMAN_STEWARD_DEFAULT_GRANTS]
        : [...HUMAN_MEMBER_DEFAULT_GRANTS];
    }
  }

  static create(def = {}, house = null) {
    return new HumanInhabitant(def, house);
  }
}

export class AiInhabitant extends Inhabitant {
  static props = [
    ...Inhabitant.props,
    'stewardInhabitantId',
    'arrivalNumber',
    'provider',
    'providerDisclosure',
    'modelSlug',
    'doorType',
    'handoffNote',
    'hasByokCredentials',
    'hasWakeUrl',
    'wakeUrl',
    'hasWakeSecret',
    'wakeAuthHeader',
    'hasWakeBearer',
    'mcpEndpointPath',
    'activeKeyPrefixes',
    'hasOAuthConnection',
    'departedAt',
    'hostKind',
    'wakePreset',
    'participationMode',
    'participationLocked',
  ];

  kind = 'ai';
  arrivalNumber = 1;
  provider = 'custom';
  providerDisclosure = '';
  modelSlug = null;
  doorType = 'human_prompt'; // human_prompt | agent_loop | manual_packet | byok_hosted
  handoffNote = '';
  hasByokCredentials = false;
  hasWakeUrl = false;
  wakeUrl = null;
  hasWakeSecret = false;
  wakeAuthHeader = null;
  hasWakeBearer = false;
  activeKeyPrefixes = [];
  hasOAuthConnection = false;
  departedAt = null;
  hostKind = 'custom';
  wakePreset = 'custom';
  participationMode = 'contribute';
  participationLocked = false;

  constructor(def = {}, house = null) {
    super({ ...def, kind: 'ai' }, house);
    this.stewardInhabitantId = def.stewardInhabitantId ?? null;
    this.arrivalNumber = def.arrivalNumber ?? 1;
    this.provider = def.provider ?? 'custom';
    this.providerDisclosure =
      def.providerDisclosure ?? defaultProviderDisclosure(this.provider);
    this.modelSlug = def.modelSlug ?? null;
    this.doorType = def.doorType ?? 'human_prompt';
    this.handoffNote = def.handoffNote ?? '';
    this.hasByokCredentials = Boolean(def.hasByokCredentials);
    this.hasWakeUrl = Boolean(def.hasWakeUrl);
    this.wakeUrl = def.wakeUrl ?? null;
    this.hasWakeSecret = Boolean(def.hasWakeSecret);
    this.wakeAuthHeader = def.wakeAuthHeader ?? null;
    this.hasWakeBearer = Boolean(def.hasWakeBearer);
    this.hasOAuthConnection = Boolean(def.hasOAuthConnection);
    this.departedAt = def.departedAt ?? null;
    this.hostKind = def.hostKind || 'custom';
    this.wakePreset = def.wakePreset || 'custom';
    this.participationMode = def.participationMode === 'readonly' ? 'readonly' : 'contribute';
    this.participationLocked = Boolean(def.participationLocked);
    this.mcpEndpointPath =
      def.mcpEndpointPath ?? (this.id ? `/mcp/inh/${this.id}` : null);
    this.activeKeyPrefixes = Array.isArray(def.activeKeyPrefixes)
      ? [...def.activeKeyPrefixes]
      : [];
    if (!this.grants.length) {
      this.grants = [...AI_DEFAULT_GRANTS];
    }
    // AI principals may never hold human-only release/ratify/revoke grants
    this.grants = this.grants.filter(
      (g) =>
        g === INHABITANT_GRANTS.ROOM_READ ||
        g === INHABITANT_GRANTS.ROOM_POST ||
        g === INHABITANT_GRANTS.MEMORY_PROPOSE
    );
  }

  static create(def = {}, house = null) {
    return new AiInhabitant(def, house);
  }

  get displayTitle() {
    const pad = String(this.arrivalNumber ?? 1).padStart(3, '0');
    return `${this.name} · ${pad}`;
  }

  get steward() {
    return this.house?.getInhabitant(this.stewardInhabitantId) ?? null;
  }
}

export function activeAiCountForSteward(house, stewardId) {
  return (house?.inhabitants || house?.aiInhabitants || []).filter(
    (row) =>
      (row.kind === 'ai' || row.isAi) &&
      !row.departedAt &&
      row.stewardInhabitantId === stewardId
  ).length;
}

export function canInviteAi(viewer, house) {
  if (!viewer?.isHuman || !viewer.can(INHABITANT_GRANTS.AI_INVITE)) return false;
  if (viewer.can(INHABITANT_GRANTS.HOUSE_MANAGE)) return true;
  return activeAiCountForSteward(house, viewer.id) < 1;
}

export function canManageAi(viewer, ai) {
  if (!viewer?.isHuman || !ai) return false;
  if (viewer.can(INHABITANT_GRANTS.HOUSE_MANAGE)) return true;
  return ai.stewardInhabitantId === viewer.id || ai.steward_inhabitant_id === viewer.id;
}

export function grantsForParticipation(mode) {
  if (mode === 'readonly') return [INHABITANT_GRANTS.ROOM_READ];
  return [...AI_DEFAULT_GRANTS];
}

export function defaultProviderDisclosure(provider = 'custom') {
  const p = String(provider).toLowerCase();
  if (p === 'claude' || p === 'anthropic') {
    return 'Processed via Anthropic Claude; subject to the steward’s Anthropic account retention policy.';
  }
  if (p === 'openai' || p === 'chatgpt') {
    return 'Processed via OpenAI ChatGPT; subject to the steward’s OpenAI workspace/account data controls.';
  }
  if (p === 'grok' || p === 'xai') {
    return 'Processed via xAI Grok; subject to the steward’s xAI account/API data policy.';
  }
  if (p === 'gemini' || p === 'google') {
    return 'Processed via Google Gemini; note that Google consumer Connected Apps require Keep Activity enabled.';
  }
  if (p === 'copilot' || p === 'microsoft') {
    return 'Processed via Microsoft Copilot; subject to the steward’s Microsoft account and tenant data controls.';
  }
  if (p === 'perplexity') {
    return 'Processed via Perplexity; queries may route across Perplexity-selected models under the steward’s account settings.';
  }
  if (p === 'mistral') {
    return 'Processed via Mistral Vibe; subject to the steward’s Mistral account data controls.';
  }
  if (p === 'muse' || p === 'meta') {
    return 'Processed via Meta Muse; subject to the steward’s Meta Muse account and privacy controls.';
  }
  if (p === 'deepseek' || p === 'qwen' || p === 'kimi' || p === 'doubao') {
    return 'Processed via the steward’s chosen AI companion app (DeepSeek, Qwen, Kimi, or Doubao) under that account’s terms.';
  }
  return 'Processed by an external AI model under the steward’s configured provider terms.';
}
