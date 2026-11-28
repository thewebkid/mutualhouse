import { canonicalJson, cleanseText, sha256Hex } from '../../shared/lib/model-util.js';
import { INHABITANT_GRANTS } from '../../shared/models/inhabitant.js';
import { randomId } from './crypto.js';
import {
  hydrateHouseForViewer,
  mapReceiptRow,
  mapSealRow,
  mapTurnRow,
} from './house-service.js';
import { mapAttachmentRow, mintSignedReadUrl } from './media-and-calls.js';
import { emitRoomWake } from './wake-bus.js';
import {
  dispatchInvocationWebhooks,
  mergeAddressedAiIds,
  recordAddressing,
} from './invocations.js';

/**
 * Atomically computes and inserts a byte-for-byte SHA-256 `ReadReceipt` inside `tx`
 * over the exact ordered visible turns, confirmed House Memory version, active
 * Constitution version, and provider disclosure served to `inhabitant`.
 */
export async function recordReadReceiptInTx(
  tx,
  { house, room, inhabitant, doorType = 'mcp_oauth' }
) {
  const visibleTurns = room.visibleTurnsFor(inhabitant);
  const excludedSealIds = room.seals
    .filter((s) => s.isSealed && room.turns.some((t) => s.hidesTurnFrom(t, inhabitant)))
    .map((s) => s.id);

  const memoryVersion = house.memory?.activeMemoryVersion ?? 0;
  const constitutionVersion = house.activeConstitution?.version ?? 0;
  const turnIds = visibleTurns.map((t) => t.id);
  const turnDigests = visibleTurns.map((t) => ({
    id: t.id,
    seq: t.seq,
    bodySha256: t.bodySha256,
  }));

  const canonicalContext = canonicalJson({
    houseId: house.id,
    roomId: room.id,
    inhabitantId: inhabitant.id,
    memoryVersion,
    constitutionVersion,
    excludedSealIds,
    turns: turnDigests,
  });
  const contextSha256 = await sha256Hex(canonicalContext);
  const receiptId = randomId('rcpt');
  const disclosure = inhabitant.providerDisclosure || '';

  const { rows } = await tx.query(
    `INSERT INTO read_receipts (
      id, house_id, room_id, inhabitant_id, door_type, turn_ids, turn_digests,
      memory_version, constitution_version, excluded_seal_ids, context_sha256, provider_disclosure
    ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11,$12)
    RETURNING *`,
    [
      receiptId,
      house.id,
      room.id,
      inhabitant.id,
      doorType,
      JSON.stringify(turnIds),
      JSON.stringify(turnDigests),
      memoryVersion,
      constitutionVersion,
      JSON.stringify(excludedSealIds),
      contextSha256,
      disclosure,
    ]
  );

  await tx.query(
    `INSERT INTO room_events (id, house_id, room_id, actor_inhabitant_id, command_id, type, payload)
     VALUES ($1,$2,$3,$4,$5,'receipt.recorded',$6::jsonb)`,
    [
      randomId('ev'),
      house.id,
      room.id,
      inhabitant.id,
      randomId('rcmd'),
      JSON.stringify({ receipt: mapReceiptRow(rows[0]) }),
    ]
  );

  return {
    receipt: mapReceiptRow(rows[0]),
    visibleTurns,
    memoryVersion,
    constitutionVersion,
  };
}

/**
 * Executes an idempotent room mutation command (`(actor.id, commandId)` unique):
 *  - `turn.post`
 *  - `seal.open`
 *  - `seal.release`
 *  - `room.pause`
 *  - `room.set_routing`
 *  - `room.pulse`
 */
export async function executeRoomCommand(
  db,
  {
    houseId,
    roomId,
    actor,
    commandId,
    type,
    payload = {},
    origin = 'native',
    readReceiptId = null,
    packetDrift = false,
    memoryVersionOverride = null,
    originUrl = '',
  }
) {
  const cleanCommandId = String(commandId || randomId('cmd'));
  const byokToInvoke = [];
  const pulseByokToInvoke = [];
  let webhookDelivery = null;
  let mcpEventDelivery = null;

  const txResult = await db.transaction(async (tx) => {
    // 1. Idempotency check on `(actor_inhabitant_id, command_id)`
    const { rows: existingEv } = await tx.query(
      `SELECT * FROM room_events WHERE actor_inhabitant_id = $1 AND command_id = $2 LIMIT 1`,
      [actor.id, cleanCommandId]
    );
    if (existingEv[0]) {
      const ev = mapRoomEventRow(existingEv[0]);
      return {
        deduplicated: true,
        turn: ev.payload?.turn ?? null,
        events: [ev],
      };
    }

    const { rows: roomRows } = await tx.query(
      `SELECT * FROM rooms WHERE id = $1 AND house_id = $2 FOR UPDATE`,
      [roomId, houseId]
    );
    const roomRow = roomRows[0];
    if (!roomRow) throw new Error('Room not found.');

    if (type === 'turn.post') {
      if (!actor.can(INHABITANT_GRANTS.ROOM_POST, roomId)) {
        throw new Error('Inhabitant does not have room.post permission.');
      }
      if (actor.isAi && roomRow.paused) {
        throw new Error('Room circulation is currently paused by a human steward.');
      }

      const body = cleanseText(payload.body ?? '');
      const attachmentIds = Array.isArray(payload.attachmentIds) ? payload.attachmentIds : [];
      if (!body.trim() && attachmentIds.length === 0) {
        throw new Error('Turn must include text or at least one attachment.');
      }

      // Allocate gapless chronological `turns.seq`
      const nextTurnSeq = Number(roomRow.last_turn_seq || 0) + 1;
      const nextConsecutiveAi = actor.isAi ? Number(roomRow.consecutive_ai_turns || 0) + 1 : 0;
      const autoPaused =
        actor.isAi &&
        roomRow.routing_mode === 'authorized_auto' &&
        nextConsecutiveAi >= Number(roomRow.auto_turn_cap || 3);

      await tx.query(
        `UPDATE rooms
         SET last_turn_seq = $1,
             consecutive_ai_turns = $2,
             paused = CASE WHEN $3 THEN TRUE ELSE paused END
         WHERE id = $4`,
        [nextTurnSeq, nextConsecutiveAi, autoPaused, roomId]
      );

      // Determine active memory version
      let memoryVersion = memoryVersionOverride;
      if (memoryVersion === null || memoryVersion === undefined) {
        const { rows: memRows } = await tx.query(
          `SELECT COALESCE(MAX(version), 0) AS ver FROM living_summaries WHERE house_id = $1 AND status = 'confirmed'`,
          [houseId]
        );
        memoryVersion = Number(memRows[0]?.ver ?? 0);
      }

      const turnId = randomId('turn');
      let sealId = payload.sealId || null;
      let createdOrUpdatedSeal = null;

      // Optionally open a new Seal anchored to this prompt turn
      if (payload.openSeal && actor.isHuman) {
        sealId = randomId('seal');
        const mode =
          payload.openSeal.mode === 'blind_simultaneous' ? 'blind_simultaneous' : 'peer_sealed';
        const targets = Array.isArray(payload.openSeal.targetInhabitantIds)
          ? payload.openSeal.targetInhabitantIds
          : [];
        const { rows: sealRows } = await tx.query(
          `INSERT INTO seals (
            id, house_id, room_id, prompt_turn_id, mode, status,
            target_inhabitant_ids, responded_inhabitant_ids, opened_by_inhabitant_id
          ) VALUES ($1,$2,$3,$4,$5,'sealed',$6::jsonb,'[]'::jsonb,$7)
          RETURNING *`,
          [sealId, houseId, roomId, turnId, mode, JSON.stringify(targets), actor.id]
        );
        createdOrUpdatedSeal = mapSealRow(sealRows[0]);
      } else if (!sealId && payload.replyToId) {
        // If replying to a prompt turn that opened an active seal, attach response to that seal!
        const { rows: parentSealRows } = await tx.query(
          `SELECT * FROM seals WHERE room_id = $1 AND prompt_turn_id = $2 AND status = 'sealed' LIMIT 1`,
          [roomId, payload.replyToId]
        );
        if (parentSealRows[0]) {
          sealId = parentSealRows[0].id;
        }
      }

      const bodyHash = await sha256Hex(body);
      const { rows: aiRows } = await tx.query(
        `SELECT id, kind, name, handle, arrival_number AS "arrivalNumber"
         FROM inhabitants WHERE house_id = $1 AND kind = 'ai' AND departed_at IS NULL`,
        [houseId]
      );
      const invokedIds = mergeAddressedAiIds(
        body,
        aiRows.map((row) => ({
          ...row,
          arrivalNumber: row.arrivalNumber ?? row.arrival_number,
        })),
        payload.invokedInhabitantIds,
        actor.id
      );

      const { rows: turnRows } = await tx.query(
        `INSERT INTO turns (
          id, seq, house_id, room_id, command_id, author_id, reply_to_id,
          origin, contribution_kind, body, body_sha256, seal_id,
          invoked_inhabitant_ids, memory_version, read_receipt_id, packet_drift,
          transcript_of_turn_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17)
        RETURNING *`,
        [
          turnId,
          nextTurnSeq,
          houseId,
          roomId,
          cleanCommandId,
          actor.id,
          payload.replyToId || null,
          origin,
          payload.contributionKind || 'turn',
          body,
          bodyHash,
          sealId,
          JSON.stringify(invokedIds),
          memoryVersion,
          readReceiptId || null,
          Boolean(packetDrift),
          payload.transcriptOfTurnId || null,
        ]
      );

      const mappedAttachments = [];
      if (attachmentIds.length > 0) {
        for (const attId of attachmentIds) {
          const { rows: attRows } = await tx.query(
            `UPDATE attachments SET turn_id = $1 WHERE id = $2 AND room_id = $3 AND status = 'committed' RETURNING *`,
            [turnId, attId, roomId]
          );
          if (attRows[0]) {
            const signedUrl = originUrl ? await mintSignedReadUrl(originUrl, attRows[0]) : null;
            mappedAttachments.push(mapAttachmentRow(attRows[0], signedUrl));
          }
        }
      }

      // Update seal responded list & check atomic blind_simultaneous unveiling predicate!
      let autoUnveiledTurns = null;
      if (sealId && !payload.openSeal) {
        const { rows: sRows } = await tx.query(`SELECT * FROM seals WHERE id = $1 FOR UPDATE`, [
          sealId,
        ]);
        const sRow = sRows[0];
        if (sRow && sRow.status === 'sealed' && sRow.prompt_turn_id !== turnId) {
          const responded = new Set(sRow.responded_inhabitant_ids ?? []);
          responded.add(actor.id);
          const targets = sRow.target_inhabitant_ids ?? [];
          const allTargetsDone =
            sRow.mode === 'blind_simultaneous' &&
            targets.length > 0 &&
            targets.every((tid) => responded.has(tid));

          if (allTargetsDone) {
            const { rows: relRows } = await tx.query(
              `UPDATE seals
               SET responded_inhabitant_ids = $1::jsonb,
                   status = 'released',
                   released_at = NOW()
               WHERE id = $2
               RETURNING *`,
              [JSON.stringify([...responded]), sealId]
            );
            createdOrUpdatedSeal = mapSealRow(relRows[0]);
            autoUnveiledTurns = await fetchSealTurnsInTx(tx, sealId, originUrl);
          } else {
            const { rows: updRows } = await tx.query(
              `UPDATE seals SET responded_inhabitant_ids = $1::jsonb WHERE id = $2 RETURNING *`,
              [JSON.stringify([...responded]), sealId]
            );
            createdOrUpdatedSeal = mapSealRow(updRows[0]);
          }
        }
      }

      await tx.query(
        `UPDATE inhabitants SET presence = 'participating', last_seen_at = NOW() WHERE id = $1`,
        [actor.id]
      );

      const fullTurn = mapTurnRow(turnRows[0], mappedAttachments);
      const emittedEvents = [];

      const { rows: postEvRows } = await tx.query(
        `INSERT INTO room_events (
          id, house_id, room_id, actor_inhabitant_id, command_id,
          type, target_inhabitant_ids, seal_id, payload
        ) VALUES ($1,$2,$3,$4,$5,'turn.posted',$6::jsonb,$7,$8::jsonb)
        RETURNING *`,
        [
          randomId('ev'),
          houseId,
          roomId,
          actor.id,
          cleanCommandId,
          JSON.stringify(invokedIds),
          sealId,
          JSON.stringify({
            turn: fullTurn,
            seal: createdOrUpdatedSeal,
            consecutiveAiTurns: nextConsecutiveAi,
            paused: Boolean(roomRow.paused || autoPaused),
          }),
        ]
      );
      emittedEvents.push(mapRoomEventRow(postEvRows[0]));
      const addressing = await recordAddressing(tx, {
        houseId,
        roomId,
        actor,
        eventSeq: postEvRows[0].event_seq,
        turnId,
        turnSeq: nextTurnSeq,
        body,
        explicitIds: invokedIds,
        routingMode: roomRow.routing_mode,
        paused: Boolean(roomRow.paused || autoPaused),
        originUrl,
      });
      byokToInvoke.push(...addressing.byokIds);
      if (addressing.webhookTargets.length) webhookDelivery = addressing;
      if (addressing.created.length) mcpEventDelivery = addressing;

      // If blind_simultaneous predicate completed on this turn, emit `seal.released` in the SAME TX!
      if (autoUnveiledTurns && createdOrUpdatedSeal?.status === 'released') {
        const { rows: relEvRows } = await tx.query(
          `INSERT INTO room_events (
            id, house_id, room_id, actor_inhabitant_id, command_id,
            type, seal_id, payload
          ) VALUES ($1,$2,$3,$4,$5,'seal.released',$6,$7::jsonb)
          RETURNING *`,
          [
            randomId('ev'),
            houseId,
            roomId,
            actor.id,
            `${cleanCommandId}:autounveil`,
            sealId,
            JSON.stringify({
              seal: createdOrUpdatedSeal,
              turns: autoUnveiledTurns,
            }),
          ]
        );
        emittedEvents.push(mapRoomEventRow(relEvRows[0]));
      }

      return {
        turn: fullTurn,
        seal: createdOrUpdatedSeal,
        events: emittedEvents.map((e) => maskEventForViewer(e, actor, createdOrUpdatedSeal)),
      };
    }

    if (type === 'seal.release') {
      if (!actor.isHuman || !actor.can(INHABITANT_GRANTS.SEAL_RELEASE, roomId)) {
        throw new Error('Only an authorized human inhabitant with seal.release may unveil a seal.');
      }
      const targetSealId = payload.sealId;
      const { rows: relRows } = await tx.query(
        `UPDATE seals
         SET status = 'released', released_by_inhabitant_id = $1, released_at = NOW()
         WHERE id = $2 AND room_id = $3
         RETURNING *`,
        [actor.id, targetSealId, roomId]
      );
      if (!relRows[0]) throw new Error('Seal not found.');
      const releasedSeal = mapSealRow(relRows[0]);
      const unveiledTurns = await fetchSealTurnsInTx(tx, targetSealId, originUrl);

      const { rows: evRows } = await tx.query(
        `INSERT INTO room_events (
          id, house_id, room_id, actor_inhabitant_id, command_id,
          type, seal_id, payload
        ) VALUES ($1,$2,$3,$4,$5,'seal.released',$6,$7::jsonb)
        RETURNING *`,
        [
          randomId('ev'),
          houseId,
          roomId,
          actor.id,
          cleanCommandId,
          targetSealId,
          JSON.stringify({
            seal: releasedSeal,
            turns: unveiledTurns,
          }),
        ]
      );
      return {
        seal: releasedSeal,
        turns: unveiledTurns,
        events: [mapRoomEventRow(evRows[0])],
      };
    }

    if (type === 'room.pause') {
      if (!actor.isHuman || !actor.can(INHABITANT_GRANTS.ROOM_PAUSE, roomId)) {
        throw new Error('Only an authorized human inhabitant may pause or resume circulation.');
      }
      const nextPaused = Boolean(payload.paused);
      await tx.query(
        `UPDATE rooms
         SET paused = $1,
             consecutive_ai_turns = CASE WHEN $1 = FALSE THEN 0 ELSE consecutive_ai_turns END
         WHERE id = $2`,
        [nextPaused, roomId]
      );
      const { rows: evRows } = await tx.query(
        `INSERT INTO room_events (id, house_id, room_id, actor_inhabitant_id, command_id, type, payload)
         VALUES ($1,$2,$3,$4,$5,'room.updated',$6::jsonb)
         RETURNING *`,
        [
          randomId('ev'),
          houseId,
          roomId,
          actor.id,
          cleanCommandId,
          JSON.stringify({ paused: nextPaused, consecutiveAiTurns: nextPaused ? roomRow.consecutive_ai_turns : 0 }),
        ]
      );
      return { paused: nextPaused, events: [mapRoomEventRow(evRows[0])] };
    }

    if (type === 'room.set_routing') {
      if (!actor.isHuman || !actor.can(INHABITANT_GRANTS.ROOM_PAUSE, roomId)) {
        throw new Error('Only an authorized human inhabitant may change room routing modes.');
      }
      const mode = ['manual', 'assisted', 'authorized_auto'].includes(payload.routingMode)
        ? payload.routingMode
        : 'assisted';
      const cap = Math.max(1, Math.min(10, Number(payload.autoTurnCap || 3)));
      await tx.query(`UPDATE rooms SET routing_mode = $1, auto_turn_cap = $2 WHERE id = $3`, [
        mode,
        cap,
        roomId,
      ]);
      const { rows: evRows } = await tx.query(
        `INSERT INTO room_events (id, house_id, room_id, actor_inhabitant_id, command_id, type, payload)
         VALUES ($1,$2,$3,$4,$5,'room.updated',$6::jsonb)
         RETURNING *`,
        [
          randomId('ev'),
          houseId,
          roomId,
          actor.id,
          cleanCommandId,
          JSON.stringify({ routingMode: mode, autoTurnCap: cap }),
        ]
      );
      return { routingMode: mode, autoTurnCap: cap, events: [mapRoomEventRow(evRows[0])] };
    }

    if (type === 'room.pulse') {
      const targets = Array.isArray(payload.targetInhabitantIds)
        ? payload.targetInhabitantIds
        : [];
      const { rows: evRows } = await tx.query(
        `INSERT INTO room_events (
          id, house_id, room_id, actor_inhabitant_id, command_id,
          type, target_inhabitant_ids, payload
        ) VALUES ($1,$2,$3,$4,$5,'room.pulse',$6::jsonb,$7::jsonb)
        RETURNING *`,
        [
          randomId('ev'),
          houseId,
          roomId,
          actor.id,
          cleanCommandId,
          JSON.stringify(targets),
          JSON.stringify({ pulsedBy: actor.id, targetInhabitantIds: targets }),
        ]
      );
      const addressing = await recordAddressing(tx, {
        houseId,
        roomId,
        actor,
        eventSeq: evRows[0].event_seq,
        pulse: true,
        pulseTargetIds: targets,
        originUrl,
      });
      pulseByokToInvoke.push(...addressing.pulseByokIds);
      if (addressing.webhookTargets.length) webhookDelivery = addressing;
      if (addressing.created.length) mcpEventDelivery = addressing;
      return { pulsed: true, events: [mapRoomEventRow(evRows[0])] };
    }

    throw new Error(`Unsupported room command type: ${type}`);
  });

  // Wake any waiting browser or Door 2 agent long-polls immediately
  emitRoomWake(roomId, houseId);

  if (webhookDelivery) {
    dispatchInvocationWebhooks(webhookDelivery.webhookTargets, webhookDelivery.context);
  }
  if (mcpEventDelivery) {
    import('../mcp/mcp-events.js')
      .then((m) => m.dispatchMcpEventSubscriptions(db, mcpEventDelivery.created, mcpEventDelivery.context))
      .catch(() => {});
  }

  // Door 4 reads the same invocation rows as Door 2, including authorized_auto.
  // A tempo pulse still runs while the room is paused.
  if (byokToInvoke.length > 0 || pulseByokToInvoke.length > 0) {
    import('./byok-runner.js')
      .then((m) =>
        Promise.all([
          byokToInvoke.length
            ? m.invokeByokInhabitants(db, { houseId, roomId, inhabitantIds: byokToInvoke, originUrl })
            : null,
          pulseByokToInvoke.length
            ? m.invokeByokInhabitants(db, {
                houseId,
                roomId,
                inhabitantIds: pulseByokToInvoke,
                originUrl,
                allowPaused: true,
              })
            : null,
        ])
      )
      .catch((err) => console.warn('[byok-runner]', err));
  }

  return txResult;
}

async function fetchSealTurnsInTx(tx, sealId, originUrl = '') {
  const { rows: sRows } = await tx.query(`SELECT prompt_turn_id FROM seals WHERE id = $1`, [
    sealId,
  ]);
  const promptTurnId = sRows[0]?.prompt_turn_id ?? '';
  const { rows: turnRows } = await tx.query(
    `SELECT * FROM turns WHERE seal_id = $1 AND id != $2 ORDER BY seq ASC`,
    [sealId, promptTurnId]
  );
  const out = [];
  for (const t of turnRows) {
    const { rows: attRows } = await tx.query(
      `SELECT * FROM attachments WHERE turn_id = $1 AND status = 'committed' ORDER BY created_at ASC`,
      [t.id]
    );
    const mappedAtts = [];
    for (const a of attRows) {
      const url = originUrl ? await mintSignedReadUrl(originUrl, a) : null;
      mappedAtts.push(mapAttachmentRow(a, url));
    }
    out.push(mapTurnRow(t, mappedAtts));
  }
  return out;
}

export function mapRoomEventRow(row) {
  return {
    eventSeq: Number(row.event_seq),
    id: row.id,
    houseId: row.house_id,
    roomId: row.room_id,
    actorInhabitantId: row.actor_inhabitant_id,
    commandId: row.command_id,
    type: row.type,
    targetInhabitantIds: row.target_inhabitant_ids ?? [],
    sealId: row.seal_id ?? null,
    payload: row.payload ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Ensures `turn.posted` events NEVER leak sealed turn bodies to restricted viewers
 * before `seal.release` runs!
 */
export function maskEventForViewer(event, viewer, liveSealObj = null) {
  if (event.type !== 'turn.posted' || !event.payload?.turn) return event;
  const turn = event.payload.turn;
  const seal = liveSealObj ?? event.payload.seal;
  if (!seal || seal.status !== 'sealed' || !turn.sealId || turn.id === seal.promptTurnId) {
    return event;
  }
  if (turn.authorId === viewer?.id) return event;

  const hiddenFromViewer =
    seal.mode === 'blind_simultaneous' || viewer?.kind === 'ai';
  if (!hiddenFromViewer) return event;

  if (viewer?.kind === 'ai') {
    // AI peers do not even see sibling sealed turn stubs until seal.released
    return null;
  }

  return {
    ...event,
    payload: {
      ...event.payload,
      turn: {
        ...turn,
        body: '',
        attachments: [],
        invokedInhabitantIds: [],
        sealedStub: true,
      },
    },
  };
}

/**
 * Queries events after `afterEventSeq` for `viewer`, applying live seal state
 * from `seals` so sealed bytes can never leak on poll.
 */
export async function queryVisibleRoomEvents(
  db,
  { roomId, viewer, afterEventSeq = 0, originUrl = '' }
) {
  const { rows } = await db.query(
    `SELECT * FROM room_events WHERE room_id = $1 AND event_seq > $2 ORDER BY event_seq ASC LIMIT 200`,
    [roomId, Number(afterEventSeq || 0)]
  );
  if (!rows.length) return [];

  const { rows: sealRows } = await db.query(`SELECT * FROM seals WHERE room_id = $1`, [roomId]);
  const sealMap = new Map(sealRows.map((s) => [s.id, mapSealRow(s)]));

  const visibleEvents = [];
  for (const r of rows) {
    const ev = mapRoomEventRow(r);
    // Refresh expired signed URLs if turn has attachments
    if (originUrl && ev.payload?.turn?.attachments?.length) {
      for (const att of ev.payload.turn.attachments) {
        if (att.r2Key) {
          att.signedUrl = await mintSignedReadUrl(originUrl, { r2_key: att.r2Key, status: 'committed' });
        }
      }
    }
    const activeSeal = ev.sealId ? sealMap.get(ev.sealId) : null;
    const masked = maskEventForViewer(ev, viewer, activeSeal);
    if (masked) visibleEvents.push(masked);
  }
  return visibleEvents;
}
