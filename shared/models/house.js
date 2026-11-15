import { buildDef, buildInstanceFromDef, cyrb53, getDef } from '../lib/model-util.js';
import { Inhabitant } from './inhabitant.js';
import { Room } from './room.js';
import { HouseMemory, Constitution } from './house-memory.js';

/**
 * Aggregate root for a sovereign Mutual House (`"The Now"`, `"Locality 0001"`, etc.).
 *
 * Modeled on `becise` (`Deck`):
 *  - `House.create(def)` hydrates the complete graph once before wrapping in `reactive()`.
 *  - `house.def` recursively serializes `static props` via `getDef()`.
 *  - Shared room mutations NEVER upload `house.def` wholesale; they dispatch discrete
 *    commands through `house-orchestration.js` and apply monotonic `room_events`.
 */
export class House {
  static props = [
    'id',
    'slug',
    'name',
    'coordinates',
    'purpose',
    'publicKeyEd25519',
    'fourSections',
    'createdAt',
    'updatedAt',
    'viewerInhabitantId',
    'inhabitants',
    'rooms',
    'memory',
    'constitutions',
  ];

  isHouse = true;
  inhabitants = [];
  rooms = [];
  memory = null;
  constitutions = [];
  fourSections = {
    authorship: '',
    provenance: '',
    categories: [],
    housekeepingNotes: '',
  };

  constructor(def = {}) {
    this.initialize(def);
  }

  static create(jsonDef = {}) {
    const parsed = typeof jsonDef === 'string' ? JSON.parse(jsonDef) : jsonDef;
    return new House(parsed ?? {});
  }

  initialize(def = {}) {
    buildInstanceFromDef(this, def);
    this.coordinates = def.coordinates ?? '';
    this.purpose = def.purpose ?? '';
    this.fourSections = {
      authorship: def.fourSections?.authorship ?? '',
      provenance: def.fourSections?.provenance ?? '',
      categories: Array.isArray(def.fourSections?.categories)
        ? [...def.fourSections.categories]
        : [],
      housekeepingNotes: def.fourSections?.housekeepingNotes ?? '',
    };

    this.inhabitants = Array.isArray(def.inhabitants)
      ? def.inhabitants.map((inh) => Inhabitant.create(inh, this))
      : [];

    this.memory = HouseMemory.create(def.memory ?? {}, this);

    this.constitutions = Array.isArray(def.constitutions)
      ? def.constitutions.map((c) => Constitution.create(c, this))
      : [];

    this.rooms = Array.isArray(def.rooms)
      ? def.rooms.map((r) => Room.create(r, this))
      : [];
  }

  /**
   * Optional hook invoked once after `reactive(House.create(def))` on the client.
   */
  proxyInit() {
    return this;
  }

  get viewer() {
    return this.getInhabitant(this.viewerInhabitantId);
  }

  get humanInhabitants() {
    return this.inhabitants.filter((i) => i.isHuman);
  }

  get aiInhabitants() {
    return this.inhabitants.filter((i) => i.isAi);
  }

  get activeRooms() {
    return this.rooms.filter((r) => !r.archivedAt);
  }

  get activeConstitution() {
    const ratified = this.constitutions
      .filter((c) => c.isRatified)
      .sort((a, b) => b.version - a.version);
    return ratified[0] ?? null;
  }

  get pendingConstitutionDraft() {
    const drafts = this.constitutions
      .filter((c) => !c.isRatified)
      .sort((a, b) => b.version - a.version);
    return drafts[0] ?? null;
  }

  getInhabitant(idOrHandle) {
    if (!idOrHandle) return null;
    return (
      this.inhabitants.find(
        (i) => i.id === idOrHandle || i.handle?.toLowerCase() === String(idOrHandle).toLowerCase()
      ) ?? null
    );
  }

  getRoom(idOrSlug) {
    if (!idOrSlug) return null;
    return (
      this.rooms.find((r) => r.id === idOrSlug || r.slug === idOrSlug) ?? null
    );
  }

  upsertInhabitant(inhDef) {
    const incoming = inhDef?.isInhabitant ? inhDef : Inhabitant.create(inhDef, this);
    incoming.house = this;
    const idx = this.inhabitants.findIndex((i) => i.id === incoming.id);
    if (idx >= 0) {
      this.inhabitants.splice(idx, 1, incoming);
    } else {
      this.inhabitants.push(incoming);
    }
    return incoming;
  }

  upsertRoom(roomDef) {
    const incoming = roomDef?.isRoom ? roomDef : Room.create(roomDef, this);
    incoming.house = this;
    const idx = this.rooms.findIndex((r) => r.id === incoming.id);
    if (idx >= 0) {
      this.rooms.splice(idx, 1, incoming);
    } else {
      this.rooms.push(incoming);
    }
    return incoming;
  }

  get def() {
    const base = buildDef(this);
    base.inhabitants = this.inhabitants.map(getDef);
    base.rooms = this.rooms.map(getDef);
    base.memory = getDef(this.memory);
    base.constitutions = this.constitutions.map(getDef);
    return base;
  }

  /**
   * Produces a deterministic portable bundle (`LLMRecursion`-shaped Markdown files
   * + full JSON graph) mirroring `deck.exportDef` in `becise`.
   */
  get exportDef() {
    const activeSummary = this.memory.activeConfirmedSummary;
    const files = {
      'HOUSE.md': [
        `# ${this.name}${this.coordinates ? ` (Locality ${this.coordinates})` : ''}`,
        '',
        this.purpose ? `> ${this.purpose}` : '_Blank purpose._',
        '',
        `- Slug: \`${this.slug}\``,
        `- Public Ed25519 Verification Key: \`${this.publicKeyEd25519 || 'none'}\``,
        `- Exported At: ${new Date().toISOString()}`,
        '',
        '## Four Sections',
        `### Authorship\n${this.fourSections.authorship || '_Blank._'}`,
        `### Provenance\n${this.fourSections.provenance || '_Blank._'}`,
        `### Categories\n${this.fourSections.categories.join(', ') || '_Blank._'}`,
        `### Housekeeping\n${this.fourSections.housekeepingNotes || '_Blank._'}`,
      ].join('\n'),
      'CONSTITUTION.md':
        this.activeConstitution?.body || '_No ratified constitution yet (blank by default)._',
      'conversations/LIVING-SUMMARY.md': activeSummary
        ? activeSummary.toMarkdown(this.memory.episodes)
        : '# Living Summary\n\n_No confirmed summary yet._',
      'conversations/INDEX.md': this.memory.toIndexMarkdown(),
    };

    for (const ep of this.memory.episodes) {
      files[`conversations/${ep.episodeDate}-${ep.slug}.md`] = ep.toMarkdown();
    }
    for (const room of this.rooms) {
      files[`conversations/full/room-${room.slug}-full.md`] = room.toTranscriptMarkdown();
    }

    return {
      house: this.def,
      files,
    };
  }

  get json() {
    return JSON.stringify(this.def);
  }

  get hash() {
    return cyrb53(this.json);
  }
}
