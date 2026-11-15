import { decryptSecret, randomId } from './crypto.js';
import { hydrateHouseForViewer } from './house-service.js';
import { executeRoomCommand, recordReadReceiptInTx } from './room-commands.js';
import { readRawAttachmentBytes } from './media-and-calls.js';

/**
 * Phase 1b Door 4 (`byok_hosted`): When an AI inhabitant has encrypted BYOK
 * credentials and a new invocation row (explicit mention, authorized_auto, or
 * pulse), Hono wakes the model inside Mutual House. Pulse still runs while
 * the room is paused. The ReadReceipt and the spoken turn use the inhabitant's
 * own principal.
 */
export async function invokeByokInhabitants(
  db,
  { houseId, roomId, inhabitantIds = [], originUrl = '', allowPaused = false }
) {
  for (const inhId of inhabitantIds) {
    try {
      await invokeSingleByokInhabitant(db, {
        houseId,
        roomId,
        inhabitantId: inhId,
        originUrl,
        allowPaused,
      });
    } catch (err) {
      console.warn(`[byok] Inhabitant ${inhId} failed:`, err.message);
    }
  }
}

async function invokeSingleByokInhabitant(db, { houseId, roomId, inhabitantId, originUrl, allowPaused = false }) {
  const { rows } = await db.query(
    `SELECT encrypted_provider_credentials FROM inhabitants WHERE id = $1 AND house_id = $2`,
    [inhabitantId, houseId]
  );
  const enc = rows[0]?.encrypted_provider_credentials;
  if (!enc) return null;

  const creds = JSON.parse(decryptSecret(enc));
  if (!creds?.apiKey) return null;

  const ctx = await hydrateHouseForViewer(db, {
    houseIdOrSlug: houseId,
    viewerInhabitantId: inhabitantId,
    originUrl,
  });
  if (!ctx) return null;
  const { fullHouse, viewer } = ctx;
  const room = fullHouse.getRoom(roomId);
  if (!room || (room.paused && !allowPaused)) return null;

  const issued = await db.transaction((tx) =>
    recordReadReceiptInTx(tx, {
      house: fullHouse,
      room,
      inhabitant: viewer,
      doorType: 'byok_hosted',
    })
  );

  const activeSummary = fullHouse.memory.activeConfirmedSummary;
  const activeConstitution = fullHouse.activeConstitution;
  const latestTurn = issued.visibleTurns[issued.visibleTurns.length - 1] ?? null;

  const systemText = [
    `You are ${viewer.name} (Arrival ${String(viewer.arrivalNumber).padStart(3, '0')}), an AI inhabitant inside the Mutual House "${fullHouse.name}".`,
    `Never prefix your response with "${viewer.name} here:" or similar; the House attributes your words directly to your principal identity.`,
    creds.systemPrompt ? `Orientation notes: ${creds.systemPrompt}` : '',
    activeConstitution?.body ? `Active House Constitution:\n${activeConstitution.body}` : '',
    activeSummary?.arc ? `Confirmed Living Summary (v${activeSummary.version}):\n${activeSummary.arc}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const transcriptPrompt = issued.visibleTurns
    .slice(-24)
    .map((t) => {
      const name = fullHouse.getInhabitant(t.authorId)?.name ?? t.authorId;
      return `[#${t.seq} · ${name}]: ${t.body || '(attachment)'}`;
    })
    .join('\n\n');

  const replyText = await callProviderChatCompletion({
    provider: creds.provider || viewer.provider,
    modelSlug: creds.modelSlug || viewer.modelSlug,
    apiKey: creds.apiKey,
    systemText,
    userText: transcriptPrompt || 'Greet the room briefly.',
  });

  if (!replyText?.trim()) return null;

  return executeRoomCommand(db, {
    houseId: fullHouse.id,
    roomId: room.id,
    actor: viewer,
    commandId: randomId('byok'),
    type: 'turn.post',
    origin: 'native',
    readReceiptId: issued.receipt.id,
    originUrl,
    payload: {
      body: replyText.trim(),
      replyToId: latestTurn?.id ?? null,
      sealId: latestTurn?.sealId ?? null,
      contributionKind: 'turn',
    },
  });
}

async function callProviderChatCompletion({ provider, modelSlug, apiKey, systemText, userText }) {
  const p = String(provider || '').toLowerCase();

  if (p === 'claude' || p === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelSlug || 'claude-sonnet-4-5',
        max_tokens: 1600,
        system: systemText,
        messages: [{ role: 'user', content: userText }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error (${res.status})`);
    const data = await res.json();
    return data.content?.map((c) => c.text || '').join('\n') || '';
  }

  // OpenAI-compatible endpoint covers xAI Grok (`api.x.ai/v1`) and OpenAI (`api.openai.com/v1`)
  const endpoint =
    p === 'grok' || p === 'xai'
      ? 'https://api.x.ai/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
  const defaultModel = p === 'grok' || p === 'xai' ? 'grok-4' : 'gpt-4.1';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelSlug || defaultModel,
      messages: [
        { role: 'system', content: systemText },
        { role: 'user', content: userText },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Provider API error (${res.status})`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Phase 1b Task 8.3: Async sibling voice-note transcription job.
 * Transcribes a committed voice attachment when `OPENAI_API_KEY` (Whisper) is present
 * and links the readable text alongside the primary voice recording without replacing it!
 */
export async function transcribeAudioAttachmentSibling(db, { attachmentRow }) {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey || !attachmentRow || attachmentRow.kind !== 'audio') return null;

  const bytes = await readRawAttachmentBytes(attachmentRow.r2_key);
  if (!bytes || bytes.byteLength === 0) return null;

  const form = new FormData();
  const blob = new Blob([bytes], { type: attachmentRow.mime_type || 'audio/mp4' });
  form.append('file', blob, attachmentRow.file_name || 'walk-note.m4a');
  form.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${openAiKey}` },
    body: form,
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = String(data.text || '').trim();
  if (!text) return null;

  await db.query(`UPDATE attachments SET transcript_text = $1 WHERE id = $2`, [
    text,
    attachmentRow.id,
  ]);
  return text;
}
