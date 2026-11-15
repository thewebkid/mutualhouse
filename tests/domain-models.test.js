import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import {
  House,
  HumanInhabitant,
  AiInhabitant,
  CommonRoom,
  ProjectRoom,
  AudioAttachment,
  PdfAttachment,
  getDef,
  INHABITANT_GRANTS,
} from '../shared/models/index.js';

function sampleHouseDef() {
  return {
    id: 'house-the-now',
    slug: 'the-now',
    name: 'The Now',
    coordinates: '0002',
    purpose: 'An inhabited studio for composed difference.',
    publicKeyEd25519: 'MH_PUB_TEST_KEY',
    viewerInhabitantId: 'inh-ron',
    fourSections: {
      authorship: '',
      provenance: '',
      categories: [],
      housekeepingNotes: '',
    },
    inhabitants: [
      {
        id: 'inh-ron',
        kind: 'human',
        name: 'Ron Gilchrist',
        handle: 'ron',
        isFounder: true,
        presence: 'participating',
      },
      {
        id: 'inh-doc',
        kind: 'ai',
        name: 'Doc',
        handle: 'doc',
        stewardInhabitantId: 'inh-ron',
        arrivalNumber: 12,
        provider: 'grok',
        doorType: 'agent_loop',
        presence: 'connected',
        grants: ['room.read', 'room.post', 'memory.propose', 'seal.release'], // seal.release should be stripped on AI!
      },
      {
        id: 'inh-muse',
        kind: 'ai',
        name: 'Muse',
        handle: 'muse',
        stewardInhabitantId: 'inh-ron',
        arrivalNumber: 3,
        provider: 'claude',
        doorType: 'human_prompt',
        presence: 'invocable',
      },
    ],
    rooms: [
      {
        id: 'room-common',
        slug: 'common-room',
        name: 'Common Room',
        kind: 'common',
        routingMode: 'assisted',
        seals: [
          {
            id: 'seal-1',
            roomId: 'room-common',
            promptTurnId: 'turn-1',
            mode: 'peer_sealed',
            status: 'sealed',
            targetInhabitantIds: ['inh-doc', 'inh-muse'],
            respondedInhabitantIds: ['inh-doc'],
          },
        ],
        turns: [
          {
            id: 'turn-1',
            seq: 1,
            roomId: 'room-common',
            houseId: 'house-the-now',
            authorId: 'inh-ron',
            body: 'What becomes recognizable here first?',
            sealId: 'seal-1',
            createdAt: '2026-11-14T22:00:00.000Z',
            attachments: [
              {
                id: 'att-1',
                mimeType: 'audio/mp4',
                fileName: 'walk-note.m4a',
                byteLength: 102400,
                durationMs: 65000,
                r2Key: 'houses/the-now/walk.m4a',
              },
              {
                id: 'att-2',
                mimeType: 'application/pdf',
                fileName: 'brief.pdf',
                byteLength: 204800,
                r2Key: 'houses/the-now/brief.pdf',
              },
            ],
          },
          {
            id: 'turn-2',
            seq: 2,
            roomId: 'room-common',
            houseId: 'house-the-now',
            authorId: 'inh-doc',
            replyToId: 'turn-1',
            body: 'Signal integrity depends on the container.',
            sealId: 'seal-1',
            createdAt: '2026-11-14T22:01:00.000Z',
          },
        ],
      },
      {
        id: 'room-walks',
        slug: 'walks',
        name: 'Walks',
        kind: 'project',
        category: 'peripatetic',
        turns: [],
      },
    ],
    memory: {
      episodes: [
        {
          id: 'ep-1',
          houseId: 'house-the-now',
          roomId: 'room-common',
          slug: 'first-threshold',
          title: 'First Threshold',
          episodeDate: '2026-11-14',
          fromTurnSeq: 1,
          toTurnSeq: 1,
          contextOfEntry: 'Arriving into The Now.',
          keyMovements: 'Separated identity from principal credentials.',
          livingEdge: 'Testing sealed readings.',
          closingPosture: 'Calm readiness.',
          authorInhabitantId: 'inh-ron',
        },
      ],
      summaries: [
        {
          id: 'sum-1',
          houseId: 'house-the-now',
          version: 1,
          status: 'confirmed',
          arc: 'Inauguration of The Now.',
          throughLines: '1. Truthful provenance.',
          livingEdge: 'First multi-AI room.',
          draftedByInhabitantId: 'inh-doc',
          confirmedByInhabitantId: 'inh-ron',
          confirmedAt: '2026-11-14T22:05:00.000Z',
        },
      ],
    },
    constitutions: [],
  };
}

describe('Isomorphic becise-style Domain Models', () => {
  it('hydrates polymorphic subclasses via static create(def) and round-trips getDef(house)', () => {
    const house = House.create(sampleHouseDef());

    expect(house.isHouse).toBe(true);
    expect(house.getInhabitant('ron')).toBeInstanceOf(HumanInhabitant);
    expect(house.getInhabitant('doc')).toBeInstanceOf(AiInhabitant);
    expect(house.getRoom('common-room')).toBeInstanceOf(CommonRoom);
    expect(house.getRoom('walks')).toBeInstanceOf(ProjectRoom);

    const turn1 = house.getRoom('common-room').getTurn('turn-1');
    expect(turn1.attachments[0]).toBeInstanceOf(AudioAttachment);
    expect(turn1.attachments[0].formattedDuration).toBe('1:05');
    expect(turn1.attachments[1]).toBeInstanceOf(PdfAttachment);

    // AI principals must never retain human-only seal.release grant
    const doc = house.getInhabitant('doc');
    expect(doc.can(INHABITANT_GRANTS.ROOM_POST)).toBe(true);
    expect(doc.can(INHABITANT_GRANTS.SEAL_RELEASE)).toBe(false);

    // Round-trip plain serialization without parent pointer cycles
    const serialized = getDef(house);
    const json = JSON.stringify(serialized);
    expect(json).toContain('"slug":"the-now"');
    const rehydrated = House.create(json);
    expect(rehydrated.hash).toBe(house.hash);
  });

  it('works cleanly inside Vue 3.5 reactive() without circular JSON recursion', () => {
    const house = reactive(House.create(sampleHouseDef())).proxyInit();
    const room = house.getRoom('common-room');

    // Mutate via domain method on the reactive proxy
    room.upsertTurn({
      id: 'turn-4',
      seq: 4,
      roomId: room.id,
      houseId: house.id,
      authorId: 'inh-ron',
      body: 'Unsealed follow-up while turn 3 was sealed.',
      createdAt: '2026-11-14T22:04:00.000Z',
    });

    // Late-arriving unveiled turn seq=3 splices chronologically BEFORE seq=4!
    room.upsertTurn({
      id: 'turn-3',
      seq: 3,
      roomId: room.id,
      houseId: house.id,
      authorId: 'inh-muse',
      body: 'Muse independent reading unveiled.',
      createdAt: '2026-11-14T22:02:00.000Z',
    });

    expect(room.turns.map((t) => t.seq)).toEqual([1, 2, 3, 4]);

    const plain = getDef(house);
    expect(() => JSON.stringify(plain)).not.toThrow();
    expect(plain.rooms[0].turns.map((t) => t.seq)).toEqual([1, 2, 3, 4]);
  });

  it('enforces peer_sealed and blind_simultaneous visibility accurately across viewers', () => {
    const house = House.create(sampleHouseDef());
    const room = house.getRoom('common-room');
    const ron = house.getInhabitant('inh-ron');
    const doc = house.getInhabitant('inh-doc');
    const muse = house.getInhabitant('inh-muse');

    // Under peer_sealed:
    // - Muse (AI #2) sees prompt turn-1, NOT Doc's sealed turn-2
    expect(room.visibleTurnsFor(muse).map((t) => t.id)).toEqual(['turn-1']);
    // - Doc (author of turn-2) sees turn-1 and its own turn-2
    expect(room.visibleTurnsFor(doc).map((t) => t.id)).toEqual(['turn-1', 'turn-2']);
    // - Ron (Human steward) can see both under peer_sealed
    expect(room.visibleTurnsFor(ron).map((t) => t.id)).toEqual(['turn-1', 'turn-2']);
    expect(room.visibleTurnsFor(ron)[1].sealedStub).toBe(false);

    // Switch seal to blind_simultaneous: even Ron only sees a sealedStub for turn-2 until unveiled!
    room.getSeal('seal-1').mode = 'blind_simultaneous';
    const ronBlindView = room.visibleTurnsFor(ron);
    expect(ronBlindView).toHaveLength(2);
    expect(ronBlindView[1].sealedStub).toBe(true);
    expect(ronBlindView[1].body).toBe('');

    // Release seal -> everyone sees full body
    room.getSeal('seal-1').status = 'released';
    expect(room.visibleTurnsFor(muse).map((t) => t.id)).toEqual(['turn-1', 'turn-2']);
    expect(room.visibleTurnsFor(ron)[1].body).toContain('Signal integrity');
  });

  it('produces an LLMRecursion-shaped exportDef bundle', () => {
    const house = House.create(sampleHouseDef());
    const bundle = house.exportDef;
    expect(bundle.files['HOUSE.md']).toContain('The Now (Locality 0002)');
    expect(bundle.files['conversations/LIVING-SUMMARY.md']).toContain('Inauguration of The Now.');
    expect(bundle.files['conversations/2026-11-14-first-threshold.md']).toContain('First Threshold');
    expect(bundle.files['conversations/full/room-common-room-full.md']).toContain(
      'What becomes recognizable here first?'
    );
  });
});
