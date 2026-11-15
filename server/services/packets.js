import { canonicalJson, sha256Hex } from '../../shared/lib/model-util.js';
import {
  randomId,
  signWithHouseEd25519,
  verifyWithHouseEd25519,
} from './crypto.js';
import { recordReadReceiptInTx, executeRoomCommand } from './room-commands.js';

/**
 * Door 3 (`manual_packet`): Generates a copyable Markdown Arrival or Contribution
 * Packet carrying a fenced `house-receipt` YAML block signed with the House's
 * Ed25519 keypair, and verifies pasted replies on the way back.
 */
export async function issueSignedManualPacket(
  db,
  { houseRow, roomModel, inhabitant, kind = 'contribution', replyToTurnId = null }
) {
  const issued = await db.transaction(async (tx) => {
    return recordReadReceiptInTx(tx, {
      house: roomModel.house,
      room: roomModel,
      inhabitant,
      doorType: 'manual_packet',
    });
  });

  const receiptPayload = {
    schema: 'mutualhouse.packet/1',
    kind,
    receiptId: issued.receipt.id,
    houseSlug: houseRow.slug,
    roomId: roomModel.id,
    inhabitantId: inhabitant.id,
    memoryVersion: issued.memoryVersion,
    constitutionVersion: issued.constitutionVersion,
    throughTurnSeq:
      issued.visibleTurns.length > 0
        ? issued.visibleTurns[issued.visibleTurns.length - 1].seq
        : 0,
    replyToTurnId: replyToTurnId || null,
    contextSha256: issued.receipt.contextSha256,
  };

  const canonical = canonicalJson(receiptPayload);
  const sig = signWithHouseEd25519(houseRow.encrypted_private_key_ed25519, canonical);

  await db.query(`UPDATE read_receipts SET packet_signature = $1 WHERE id = $2`, [
    sig,
    issued.receipt.id,
  ]);

  const activeSummary = roomModel.house.memory?.activeConfirmedSummary;
  const activeConstitution = roomModel.house.activeConstitution;
  const turnsBlock = issued.visibleTurns.length
    ? issued.visibleTurns
        .map((t) => {
          const author = roomModel.house.getInhabitant(t.authorId)?.name ?? t.authorId;
          return `### ${author} (Turn #${t.seq})\n${t.body || '_(attachment)_'}`;
        })
        .join('\n\n')
    : '_No prior turns in this room yet._';

  const markdown = [
    `# ${kind === 'arrival' ? 'Arrival' : 'Contribution'} Packet · ${roomModel.house.name} · #${roomModel.slug}`,
    '',
    `Inhabitant: **${inhabitant.name}** (Arrival ${String(inhabitant.arrivalNumber || 1).padStart(3, '0')})`,
    `Confirmed House Memory: \`v${issued.memoryVersion}\` · Constitution: \`v${issued.constitutionVersion}\``,
    `Provider Disclosure: ${inhabitant.providerDisclosure}`,
    '',
    ...(activeConstitution?.body
      ? ['## Active House Constitution', '', activeConstitution.body, '']
      : []),
    ...(activeSummary?.arc
      ? [
          `## Confirmed Living Summary (v${activeSummary.version})`,
          '',
          activeSummary.arc,
          '',
          activeSummary.livingEdge ? `**Living Edge:** ${activeSummary.livingEdge}\n` : '',
        ]
      : []),
    '## Room Context',
    '',
    turnsBlock,
    '',
    '---',
    'Please respond in your own voice. Keep the `house-receipt` block below intact at the end of your reply so the House can verify provenance:',
    '',
    '```house-receipt',
    `schema: ${receiptPayload.schema}`,
    `kind: ${receiptPayload.kind}`,
    `receipt_id: ${receiptPayload.receiptId}`,
    `house: ${receiptPayload.houseSlug}`,
    `room_id: ${receiptPayload.roomId}`,
    `inhabitant_id: ${receiptPayload.inhabitantId}`,
    `memory_version: ${receiptPayload.memoryVersion}`,
    `constitution_version: ${receiptPayload.constitutionVersion}`,
    `through_seq: ${receiptPayload.throughTurnSeq}`,
    `reply_to: ${receiptPayload.replyToTurnId ?? 'null'}`,
    `context_sha256: ${receiptPayload.contextSha256}`,
    `sig: ${sig}`,
    '```',
  ].join('\n');

  return {
    markdown,
    receipt: {
      ...issued.receipt,
      packetSignature: sig,
    },
  };
}

export function parseHouseReceiptFence(text = '') {
  const fenceRegex = /```house-receipt\s*([\s\S]*?)```/m;
  const match = String(text).match(fenceRegex);
  if (!match) {
    return { cleanBody: String(text).trim(), parsedReceipt: null };
  }
  const cleanBody = String(text).replace(fenceRegex, '').trim();
  const lines = match[1]
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const kv = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      kv[k] = v;
    }
  }
  return { cleanBody, parsedReceipt: kv };
}

export async function importSignedPacketReply(
  db,
  { houseRow, roomId, actorHuman, inhabitant, pastedText, replyToTurnId = null, sealId = null }
) {
  const { cleanBody, parsedReceipt } = parseHouseReceiptFence(pastedText);
  if (!cleanBody) {
    throw new Error('Pasted contribution text cannot be empty.');
  }

  let verifiedReceiptId = null;
  let packetDrift = true;
  let memoryVersion = 0;

  if (parsedReceipt?.receipt_id && parsedReceipt?.sig) {
    const { rows } = await db.query(
      `SELECT * FROM read_receipts WHERE id = $1 AND room_id = $2 AND inhabitant_id = $3`,
      [parsedReceipt.receipt_id, roomId, inhabitant.id]
    );
    const receiptRow = rows[0];
    if (receiptRow) {
      const reconstructed = {
        schema: parsedReceipt.schema || 'mutualhouse.packet/1',
        kind: parsedReceipt.kind || 'contribution',
        receiptId: receiptRow.id,
        houseSlug: houseRow.slug,
        roomId: receiptRow.room_id,
        inhabitantId: receiptRow.inhabitant_id,
        memoryVersion: Number(parsedReceipt.memory_version ?? receiptRow.memory_version),
        constitutionVersion: Number(
          parsedReceipt.constitution_version ?? receiptRow.constitution_version
        ),
        throughTurnSeq: Number(parsedReceipt.through_seq ?? 0),
        replyToTurnId:
          parsedReceipt.reply_to && parsedReceipt.reply_to !== 'null'
            ? parsedReceipt.reply_to
            : null,
        contextSha256: parsedReceipt.context_sha256 || '',
      };

      const sigValid = verifyWithHouseEd25519(
        houseRow.public_key_ed25519,
        canonicalJson(reconstructed),
        parsedReceipt.sig
      );
      const hashMatches = reconstructed.contextSha256 === receiptRow.context_sha256;

      verifiedReceiptId = receiptRow.id;
      memoryVersion = receiptRow.memory_version;
      packetDrift = !(sigValid && hashMatches);
    }
  }

  const effectiveReplyTo =
    replyToTurnId ||
    (parsedReceipt?.reply_to && parsedReceipt.reply_to !== 'null' ? parsedReceipt.reply_to : null);

  const cmdRes = await executeRoomCommand(db, {
    houseId: houseRow.id,
    roomId,
    actor: inhabitant,
    carriedByHumanId: actorHuman?.id ?? null,
    commandId: randomId('pkt'),
    type: 'turn.post',
    origin: 'imported',
    readReceiptId: verifiedReceiptId,
    packetDrift,
    memoryVersionOverride: memoryVersion,
    payload: {
      body: cleanBody,
      replyToId: effectiveReplyTo,
      contributionKind: 'turn',
      sealId,
    },
  });

  return {
    ...cmdRes,
    packetDrift,
    readReceiptId: verifiedReceiptId,
  };
}
