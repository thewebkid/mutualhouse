import { buildDef, buildInstanceFromDef, getDef } from '../lib/model-util.js';

/**
 * Tier 1 (`LLMRecursion` dated summary): structured relational/somatic episode
 * anchored to an exact contiguous or selected `turn.seq` range inside a Room.
 */
export class MemoryEpisode {
  static props = [
    'id',
    'houseId',
    'roomId',
    'slug',
    'title',
    'episodeDate',
    'fromTurnSeq',
    'toTurnSeq',
    'contextOfEntry',
    'textsEngaged',
    'keyMovements',
    'livingEdge',
    'closingPosture',
    'authorInhabitantId',
    'createdAt',
  ];

  isMemoryEpisode = true;
  memory = null;

  constructor(def = {}, memory = null) {
    this.memory = memory;
    buildInstanceFromDef(this, def);
    this.episodeDate = def.episodeDate ?? (def.createdAt ? String(def.createdAt).slice(0, 10) : '');
    this.contextOfEntry = def.contextOfEntry ?? '';
    this.textsEngaged = def.textsEngaged ?? '';
    this.keyMovements = def.keyMovements ?? '';
    this.livingEdge = def.livingEdge ?? '';
    this.closingPosture = def.closingPosture ?? '';
  }

  static create(def = {}, memory = null) {
    return new MemoryEpisode(typeof def === 'string' ? JSON.parse(def) : def, memory);
  }

  get author() {
    return this.memory?.house?.getInhabitant(this.authorInhabitantId) ?? null;
  }

  get room() {
    return this.memory?.house?.getRoom(this.roomId) ?? null;
  }

  toMarkdown() {
    const roomSlug = this.room?.slug ?? this.roomId;
    return [
      `# Session Summary — ${this.episodeDate}`,
      `## ${this.title}`,
      '',
      '### Context of Entry',
      this.contextOfEntry || '_None recorded._',
      '',
      '### Texts / Artifacts Engaged',
      this.textsEngaged || '_None recorded._',
      '',
      '### Key Movements',
      this.keyMovements || '_None recorded._',
      '',
      '### Living Edge / Open Questions',
      this.livingEdge || '_None recorded._',
      '',
      '### Closing Posture',
      this.closingPosture || '_None recorded._',
      '',
      '### Source',
      `- Room: #${roomSlug} (turns #${this.fromTurnSeq}–#${this.toTurnSeq})`,
    ].join('\n');
  }

  get def() {
    return buildDef(this);
  }
}

/**
 * Tier 2 (`LLMRecursion` `LIVING-SUMMARY.md`): versioned, attributable,
 * human-confirmed woven arc delivered on `/enter-house`.
 */
export class LivingSummary {
  static props = [
    'id',
    'houseId',
    'version',
    'status',
    'arc',
    'throughLines',
    'livingEdge',
    'draftedByInhabitantId',
    'amendedByInhabitantIds',
    'confirmedByInhabitantId',
    'parentVersion',
    'createdAt',
    'confirmedAt',
  ];

  isLivingSummary = true;
  memory = null;
  version = 1;
  status = 'draft'; // draft | amended | confirmed
  amendedByInhabitantIds = [];

  constructor(def = {}, memory = null) {
    this.memory = memory;
    buildInstanceFromDef(this, def);
    this.version = def.version ?? 1;
    this.status = def.status ?? 'draft';
    this.arc = def.arc ?? '';
    this.throughLines = def.throughLines ?? '';
    this.livingEdge = def.livingEdge ?? '';
    this.amendedByInhabitantIds = Array.isArray(def.amendedByInhabitantIds)
      ? [...def.amendedByInhabitantIds]
      : [];
  }

  static create(def = {}, memory = null) {
    return new LivingSummary(typeof def === 'string' ? JSON.parse(def) : def, memory);
  }

  get isConfirmed() {
    return this.status === 'confirmed';
  }

  get draftedBy() {
    return this.memory?.house?.getInhabitant(this.draftedByInhabitantId) ?? null;
  }

  get confirmedBy() {
    return this.memory?.house?.getInhabitant(this.confirmedByInhabitantId) ?? null;
  }

  toMarkdown(episodes = []) {
    const dateLabel = (this.confirmedAt || this.createdAt || '').slice(0, 10);
    const chronoRows = episodes
      .slice()
      .sort((a, b) => String(b.episodeDate).localeCompare(String(a.episodeDate)))
      .map(
        (ep) =>
          `| ${ep.episodeDate} | [${ep.title}](conversations/${ep.episodeDate}-${ep.slug}.md) | #${ep.fromTurnSeq}–#${ep.toTurnSeq} |`
      );

    return [
      `# Living Summary — ${this.memory?.house?.name ?? 'Mutual House'} (v${this.version})`,
      '',
      `*Status: ${this.status} · Last woven: ${dateLabel || 'unconfirmed'}*`,
      '',
      '---',
      '',
      '## Arc in One Breath',
      '',
      this.arc || '_Blank by default — weave your first episode when ready._',
      '',
      '---',
      '',
      '## Chronology',
      '',
      ...(chronoRows.length
        ? ['| Date | Episode | Turn Span |', '|---|---|---|', ...chronoRows]
        : ['_No episodes woven yet._']),
      '',
      '---',
      '',
      '## Through-lines',
      '',
      this.throughLines || '_No recurring through-lines recorded yet._',
      '',
      '---',
      '',
      '## Current Living Edge',
      '',
      this.livingEdge || '_Open._',
    ].join('\n');
  }

  get def() {
    return buildDef(this);
  }
}

export class HouseMemory {
  static props = ['episodes', 'summaries'];

  isHouseMemory = true;
  house = null;
  episodes = [];
  summaries = [];

  constructor(def = {}, house = null) {
    this.house = house;
    this.episodes = Array.isArray(def.episodes)
      ? def.episodes.map((ep) => MemoryEpisode.create(ep, this))
      : [];
    this.summaries = Array.isArray(def.summaries)
      ? def.summaries.map((s) => LivingSummary.create(s, this))
      : [];
  }

  static create(def = {}, house = null) {
    return new HouseMemory(typeof def === 'string' ? JSON.parse(def) : def, house);
  }

  get activeConfirmedSummary() {
    const confirmed = this.summaries
      .filter((s) => s.status === 'confirmed')
      .sort((a, b) => b.version - a.version);
    return confirmed[0] ?? null;
  }

  get pendingDraftSummary() {
    const drafts = this.summaries
      .filter((s) => s.status !== 'confirmed')
      .sort((a, b) => b.version - a.version);
    return drafts[0] ?? null;
  }

  get activeMemoryVersion() {
    return this.activeConfirmedSummary?.version ?? 0;
  }

  toIndexMarkdown() {
    const rows = this.episodes
      .slice()
      .sort((a, b) => String(b.episodeDate).localeCompare(String(a.episodeDate)))
      .map(
        (ep) =>
          `| ${ep.episodeDate} | [${ep.title}](${ep.episodeDate}-${ep.slug}.md) | ${ep.livingEdge ? ep.livingEdge.slice(0, 90).replace(/\n/g, ' ') : `Turns #${ep.fromTurnSeq}–#${ep.toTurnSeq}`} |`
      );
    return [
      '# Conversations Index',
      '',
      'Start here: [LIVING-SUMMARY.md](LIVING-SUMMARY.md)',
      '',
      ...(rows.length
        ? ['| Date | Title | Living Edge |', '|---|---|---|', ...rows]
        : ['_No episodes recorded yet._']),
    ].join('\n');
  }

  get def() {
    return {
      episodes: this.episodes.map(getDef),
      summaries: this.summaries.map(getDef),
    };
  }
}

/**
 * Versioned Markdown House Constitution with human ratification & AI witness records.
 */
export class Constitution {
  static props = [
    'id',
    'houseId',
    'version',
    'status',
    'title',
    'body',
    'proposedByInhabitantId',
    'ratifiedByHumanIds',
    'witnessedByAiIds',
    'createdAt',
    'ratifiedAt',
  ];

  isConstitution = true;
  house = null;
  version = 1;
  status = 'draft'; // draft | ratified
  ratifiedByHumanIds = [];
  witnessedByAiIds = [];

  constructor(def = {}, house = null) {
    this.house = house;
    buildInstanceFromDef(this, def);
    this.version = def.version ?? 1;
    this.status = def.status ?? 'draft';
    this.title = def.title ?? 'House Constitution';
    this.body = def.body ?? '';
    this.ratifiedByHumanIds = Array.isArray(def.ratifiedByHumanIds)
      ? [...def.ratifiedByHumanIds]
      : [];
    this.witnessedByAiIds = Array.isArray(def.witnessedByAiIds)
      ? [...def.witnessedByAiIds]
      : [];
  }

  static create(def = {}, house = null) {
    return new Constitution(typeof def === 'string' ? JSON.parse(def) : def, house);
  }

  get isRatified() {
    return this.status === 'ratified';
  }

  get def() {
    return buildDef(this);
  }
}
