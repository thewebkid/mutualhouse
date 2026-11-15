import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { strToU8, zipSync } from 'fflate';
import { readRawAttachmentBytes } from './media-and-calls.js';

/**
 * Phase 1b Task 8.4: 1-Click Walk-Away Sovereignty Export (`.zip`).
 *
 * Streams an archive containing:
 *  - `HOUSE.md`, `CONSTITUTION.md`
 *  - `conversations/LIVING-SUMMARY.md`, `conversations/INDEX.md`
 *  - `conversations/YYYY-MM-DD-slug.md` (every Tier 1 Episode)
 *  - `conversations/full/room-<slug>-full.md` (every Room's verbatim transcript)
 *  - `provenance/house-graph.json` (`house.exportDef.house`)
 *  - `provenance/provenance.sqlite` (real SQLite 3 database via `node:sqlite` holding turns, seals, receipts, episodes, summaries)
 *  - `media/<r2Key>` (all committed audio/image/PDF blobs belonging to this House)
 */
export async function buildHouseExportZipBytes(db, { fullHouse }) {
  const bundle = fullHouse.exportDef;
  const zipEntries = {};

  for (const [relPath, markdownText] of Object.entries(bundle.files)) {
    zipEntries[relPath] = strToU8(markdownText);
  }

  zipEntries['provenance/house-graph.json'] = strToU8(
    JSON.stringify(bundle.house, null, 2)
  );

  // Build self-contained SQLite provenance snapshot using Node 24's built-in `node:sqlite`
  const sqliteBytes = buildSqliteProvenanceSnapshot(fullHouse);
  if (sqliteBytes) {
    zipEntries['provenance/provenance.sqlite'] = sqliteBytes;
  }

  // Include committed R2 / local media blobs so no House media is stranded
  const { rows: attRows } = await db.query(
    `SELECT * FROM attachments WHERE house_id = $1 AND status = 'committed'`,
    [fullHouse.id]
  );
  for (const att of attRows) {
    try {
      const rawBytes = await readRawAttachmentBytes(att.r2_key);
      if (rawBytes) {
        zipEntries[`media/${att.id}-${att.file_name}`] = rawBytes;
      }
    } catch {
      // Skip missing blob gracefully without aborting text/provenance export
    }
  }

  return zipSync(zipEntries, { level: 6 });
}

function buildSqliteProvenanceSnapshot(house) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-export-'));
  const sqlitePath = path.join(tmpDir, 'provenance.sqlite');
  try {
    const sqlite = new DatabaseSync(sqlitePath);
    sqlite.exec(`
      CREATE TABLE house_meta (
        id TEXT PRIMARY KEY,
        slug TEXT,
        name TEXT,
        coordinates TEXT,
        public_key_ed25519 TEXT,
        exported_at TEXT
      );
      CREATE TABLE inhabitants (
        id TEXT PRIMARY KEY,
        kind TEXT,
        name TEXT,
        handle TEXT,
        arrival_number INTEGER,
        provider TEXT,
        provider_disclosure TEXT
      );
      CREATE TABLE turns (
        id TEXT PRIMARY KEY,
        room_slug TEXT,
        seq INTEGER,
        author_id TEXT,
        reply_to_id TEXT,
        origin TEXT,
        contribution_kind TEXT,
        body TEXT,
        body_sha256 TEXT,
        seal_id TEXT,
        memory_version INTEGER,
        read_receipt_id TEXT,
        packet_drift INTEGER,
        created_at TEXT
      );
      CREATE TABLE read_receipts (
        id TEXT PRIMARY KEY,
        room_slug TEXT,
        inhabitant_id TEXT,
        door_type TEXT,
        memory_version INTEGER,
        constitution_version INTEGER,
        context_sha256 TEXT,
        turn_ids_json TEXT,
        provider_disclosure TEXT,
        created_at TEXT
      );
      CREATE TABLE living_summaries (
        id TEXT PRIMARY KEY,
        version INTEGER,
        status TEXT,
        arc TEXT,
        through_lines TEXT,
        living_edge TEXT,
        confirmed_at TEXT
      );
    `);

    sqlite
      .prepare(
        `INSERT INTO house_meta (id, slug, name, coordinates, public_key_ed25519, exported_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        house.id,
        house.slug,
        house.name,
        house.coordinates || '',
        house.publicKeyEd25519 || '',
        new Date().toISOString()
      );

    const insInh = sqlite.prepare(
      `INSERT INTO inhabitants (id, kind, name, handle, arrival_number, provider, provider_disclosure)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const inh of house.inhabitants) {
      insInh.run(
        inh.id,
        inh.kind,
        inh.name,
        inh.handle,
        inh.arrivalNumber ?? 1,
        inh.provider || '',
        inh.providerDisclosure || ''
      );
    }

    const insTurn = sqlite.prepare(
      `INSERT INTO turns (
        id, room_slug, seq, author_id, reply_to_id, origin, contribution_kind,
        body, body_sha256, seal_id, memory_version, read_receipt_id, packet_drift, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insRcpt = sqlite.prepare(
      `INSERT INTO read_receipts (
        id, room_slug, inhabitant_id, door_type, memory_version, constitution_version,
        context_sha256, turn_ids_json, provider_disclosure, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const room of house.rooms) {
      for (const t of room.turns) {
        if (t.sealedStub) continue;
        insTurn.run(
          t.id,
          room.slug,
          t.seq,
          t.authorId,
          t.replyToId ?? null,
          t.origin,
          t.contributionKind,
          t.body,
          t.bodySha256,
          t.sealId ?? null,
          t.memoryVersion ?? 0,
          t.readReceiptId ?? null,
          t.packetDrift ? 1 : 0,
          t.createdAt
        );
      }
      for (const r of room.receipts) {
        insRcpt.run(
          r.id,
          room.slug,
          r.inhabitantId,
          r.doorType,
          r.memoryVersion ?? 0,
          r.constitutionVersion ?? 0,
          r.contextSha256,
          JSON.stringify(r.turnIds ?? []),
          r.providerDisclosure || '',
          r.createdAt
        );
      }
    }

    const insSum = sqlite.prepare(
      `INSERT INTO living_summaries (id, version, status, arc, through_lines, living_edge, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of house.memory.summaries) {
      insSum.run(
        s.id,
        s.version,
        s.status,
        s.arc,
        s.throughLines,
        s.livingEdge,
        s.confirmedAt ?? null
      );
    }

    sqlite.close();
    return new Uint8Array(fs.readFileSync(sqlitePath));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
