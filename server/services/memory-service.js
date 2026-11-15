import { slugify } from '../../shared/lib/model-util.js';
import { INHABITANT_GRANTS } from '../../shared/models/inhabitant.js';
import { randomId } from './crypto.js';
import { emitRoomWake } from './wake-bus.js';

export function mapEpisodeRow(row) {
  return {
    id: row.id,
    houseId: row.house_id,
    roomId: row.room_id,
    slug: row.slug,
    title: row.title,
    episodeDate: row.episode_date,
    fromTurnSeq: row.from_turn_seq,
    toTurnSeq: row.to_turn_seq,
    contextOfEntry: row.context_of_entry,
    textsEngaged: row.texts_engaged,
    keyMovements: row.key_movements,
    livingEdge: row.living_edge,
    closingPosture: row.closing_posture,
    authorInhabitantId: row.author_inhabitant_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function mapSummaryRow(row) {
  return {
    id: row.id,
    houseId: row.house_id,
    version: row.version,
    status: row.status,
    arc: row.arc,
    throughLines: row.through_lines,
    livingEdge: row.living_edge,
    draftedByInhabitantId: row.drafted_by_inhabitant_id,
    amendedByInhabitantIds: row.amended_by_inhabitant_ids ?? [],
    confirmedByInhabitantId: row.confirmed_by_inhabitant_id ?? null,
    parentVersion: row.parent_version ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
  };
}

export function mapConstitutionRow(row) {
  return {
    id: row.id,
    houseId: row.house_id,
    version: row.version,
    status: row.status,
    title: row.title,
    body: row.body,
    proposedByInhabitantId: row.proposed_by_inhabitant_id,
    ratifiedByHumanIds: row.ratified_by_human_ids ?? [],
    witnessedByAiIds: row.witnessed_by_ai_ids ?? [],
    createdAt: new Date(row.created_at).toISOString(),
    ratifiedAt: row.ratified_at ? new Date(row.ratified_at).toISOString() : null,
  };
}

export async function createMemoryEpisodeInDb(
  db,
  {
    houseId,
    roomId,
    actor,
    title,
    episodeDate,
    fromTurnSeq,
    toTurnSeq,
    contextOfEntry = '',
    textsEngaged = '',
    keyMovements = '',
    livingEdge = '',
    closingPosture = '',
  }
) {
  if (!actor.can(INHABITANT_GRANTS.MEMORY_PROPOSE, roomId)) {
    throw new Error('Inhabitant lacks memory.propose permission.');
  }
  const id = randomId('ep');
  const cleanTitle = String(title || 'Untitled Episode').trim();
  const slug = slugify(cleanTitle) || id;
  const dateStr = episodeDate || new Date().toISOString().slice(0, 10);

  const episode = await db.transaction(async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO memory_episodes (
        id, house_id, room_id, slug, title, episode_date,
        from_turn_seq, to_turn_seq, context_of_entry, texts_engaged,
        key_movements, living_edge, closing_posture, author_inhabitant_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [
        id,
        houseId,
        roomId,
        slug,
        cleanTitle,
        dateStr,
        Number(fromTurnSeq || 1),
        Number(toTurnSeq || fromTurnSeq || 1),
        contextOfEntry,
        textsEngaged,
        keyMovements,
        livingEdge,
        closingPosture,
        actor.id,
      ]
    );
    const mapped = mapEpisodeRow(rows[0]);
    await tx.query(
      `INSERT INTO room_events (id, house_id, room_id, actor_inhabitant_id, command_id, type, payload)
       VALUES ($1,$2,$3,$4,$5,'memory.updated',$6::jsonb)`,
      [randomId('ev'), houseId, roomId, actor.id, randomId('cmd'), JSON.stringify({ episode: mapped })]
    );
    return mapped;
  });

  emitRoomWake(roomId);
  return episode;
}

export async function proposeOrAmendLivingSummaryInDb(
  db,
  { houseId, roomId = null, actor, arc = '', throughLines = '', livingEdge = '' }
) {
  if (!actor.can(INHABITANT_GRANTS.MEMORY_PROPOSE, roomId)) {
    throw new Error('Inhabitant lacks memory.propose permission.');
  }

  const summary = await db.transaction(async (tx) => {
    const { rows: existing } = await tx.query(
      `SELECT * FROM living_summaries WHERE house_id = $1 ORDER BY version DESC LIMIT 5`,
      [houseId]
    );
    const latestConfirmed = existing.find((s) => s.status === 'confirmed') ?? null;
    const openDraft = existing.find((s) => s.status !== 'confirmed') ?? null;

    if (openDraft) {
      const amendedSet = new Set(openDraft.amended_by_inhabitant_ids ?? []);
      if (actor.id !== openDraft.drafted_by_inhabitant_id) {
        amendedSet.add(actor.id);
      }
      const nextStatus = amendedSet.size > 0 ? 'amended' : 'draft';
      const { rows } = await tx.query(
        `UPDATE living_summaries
         SET status = $1, arc = $2, through_lines = $3, living_edge = $4,
             amended_by_inhabitant_ids = $5::jsonb
         WHERE id = $6
         RETURNING *`,
        [nextStatus, arc, throughLines, livingEdge, JSON.stringify([...amendedSet]), openDraft.id]
      );
      return mapSummaryRow(rows[0]);
    }

    const nextVersion = (existing[0]?.version ?? 0) + 1;
    const { rows } = await tx.query(
      `INSERT INTO living_summaries (
        id, house_id, version, status, arc, through_lines, living_edge,
        drafted_by_inhabitant_id, amended_by_inhabitant_ids, parent_version
      ) VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,'[]'::jsonb,$8)
      RETURNING *`,
      [
        randomId('sum'),
        houseId,
        nextVersion,
        arc,
        throughLines,
        livingEdge,
        actor.id,
        latestConfirmed?.version ?? null,
      ]
    );
    return mapSummaryRow(rows[0]);
  });

  if (roomId) emitRoomWake(roomId);
  return summary;
}

export async function confirmLivingSummaryInDb(db, { houseId, summaryId, actor }) {
  if (!actor.isHuman || !actor.can(INHABITANT_GRANTS.MEMORY_CONFIRM)) {
    throw new Error('Only an authorized human inhabitant with memory.confirm may confirm House Memory.');
  }

  const { rows } = await db.query(
    `UPDATE living_summaries
     SET status = 'confirmed', confirmed_by_inhabitant_id = $1, confirmed_at = NOW()
     WHERE id = $2 AND house_id = $3
     RETURNING *`,
    [actor.id, summaryId, houseId]
  );
  if (!rows[0]) throw new Error('Living Summary draft not found.');
  return mapSummaryRow(rows[0]);
}

export async function proposeConstitutionInDb(db, { houseId, actor, title = 'House Constitution', body = '' }) {
  const { rows: prev } = await db.query(
    `SELECT MAX(version) AS max_ver FROM constitutions WHERE house_id = $1`,
    [houseId]
  );
  const nextVersion = Number(prev[0]?.max_ver ?? 0) + 1;

  const { rows } = await db.query(
    `INSERT INTO constitutions (
      id, house_id, version, status, title, body, proposed_by_inhabitant_id
    ) VALUES ($1,$2,$3,'draft',$4,$5,$6)
    RETURNING *`,
    [randomId('const'), houseId, nextVersion, title, body, actor.id]
  );
  return mapConstitutionRow(rows[0]);
}

export async function ratifyOrWitnessConstitutionInDb(db, { houseId, constitutionId, actor }) {
  const { rows: found } = await db.query(
    `SELECT * FROM constitutions WHERE id = $1 AND house_id = $2`,
    [constitutionId, houseId]
  );
  const row = found[0];
  if (!row) throw new Error('Constitution version not found.');

  if (actor.isHuman) {
    if (!actor.can(INHABITANT_GRANTS.CONSTITUTION_RATIFY)) {
      throw new Error('Missing constitution.ratify permission.');
    }
    const humans = new Set(row.ratified_by_human_ids ?? []);
    humans.add(actor.id);
    const { rows } = await db.query(
      `UPDATE constitutions
       SET status = 'ratified',
           ratified_by_human_ids = $1::jsonb,
           ratified_at = COALESCE(ratified_at, NOW())
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify([...humans]), constitutionId]
    );
    return mapConstitutionRow(rows[0]);
  }

  // AI inhabitants may witness without claiming human legal accountability (Brief v0.3 §8.5)
  const witnesses = new Set(row.witnessed_by_ai_ids ?? []);
  witnesses.add(actor.id);
  const { rows } = await db.query(
    `UPDATE constitutions SET witnessed_by_ai_ids = $1::jsonb WHERE id = $2 RETURNING *`,
    [JSON.stringify([...witnesses]), constitutionId]
  );
  return mapConstitutionRow(rows[0]);
}
