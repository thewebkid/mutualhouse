import {
  McpServer,
  createMcpHandler,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { INHABITANT_GRANTS } from '../../shared/models/inhabitant.js';
import {
  advertisedMcpScopes,
  createInhabitantTokenVerifier,
  loadLiveInhabitantScopes,
  mcpScopeStepUp,
  rewriteBearerChallengeScopes,
} from '../auth/mcp-oauth.js';
import { hydrateHouseForViewer } from '../services/house-service.js';
import {
  executeRoomCommand,
  recordReadReceiptInTx,
} from '../services/room-commands.js';
import {
  createMemoryEpisodeInDb,
  proposeOrAmendLivingSummaryInDb,
} from '../services/memory-service.js';
import { randomId } from '../services/crypto.js';
import { emitRoomWake } from '../services/wake-bus.js';
import {
  STAYING_PRESENT_GUIDE,
  claimInvocations,
  invocationFlagsForTurns,
  listPendingInvocations,
  saveInhabitantWake,
} from '../services/invocations.js';

/**
 * Builds the progressive MCP Apps (`io.modelcontextprotocol/ui`) sandboxed HTML
 * room card rendered inline inside Claude and ChatGPT desktop/web sessions,
 * while plain Markdown remains primary for Grok, Gemini, and CLI agents.
 */
export function buildMcpRoomCardHtml({ house, room, inhabitant }) {
  const esc = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const visibleTurns = room.visibleTurnsFor(inhabitant).slice(-6);
  const activeSeals = room.activeSeals;

  const turnHtml = visibleTurns.length
    ? visibleTurns
        .map((t) => {
          const author = house.getInhabitant(t.authorId)?.name ?? t.authorId;
          return `<div class="turn">
            <div class="meta"><strong>${esc(author)}</strong> · #${t.seq}</div>
            <div class="prose">${esc(t.body || '(attachment)')}</div>
          </div>`;
        })
        .join('')
    : `<p class="empty">Room is quiet.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root {
    --bg: #eff1e9;
    --surface: #fbfcf8;
    --border: #d3d9c8;
    --text: #222b25;
    --muted: #5c6a5f;
    --clay: #a9461f;
    --pine: #234f39;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #121814;
      --surface: #1c2620;
      --border: #2f3d34;
      --text: #e4eadf;
      --muted: #9aa99d;
      --clay: #e6936a;
      --pine: #8fd0a9;
    }
  }
  body {
    margin: 0;
    padding: 14px;
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 1px solid var(--border);
    padding-bottom: 8px;
    margin-bottom: 10px;
  }
  .title { font-weight: 600; color: var(--clay); }
  .badge { font-size: 12px; color: var(--pine); }
  .turn { padding: 8px 0; border-bottom: 1px solid var(--border); }
  .turn:last-child { border-bottom: none; }
  .meta { font-size: 12px; color: var(--muted); margin-bottom: 3px; }
  .prose { font-family: Georgia, serif; font-size: 16.5px; line-height: 1.6; white-space: pre-wrap; }
  .seal { margin-top: 8px; padding: 6px 10px; border-radius: 4px; border: 1px dashed var(--pine); font-size: 12px; color: var(--pine); }
</style>
</head>
<body>
  <div class="card">
    <div class="head">
      <span class="title">${esc(house.name)} · #${esc(room.slug)}</span>
      <span class="badge">${esc(inhabitant.displayTitle)} · Memory v${house.memory.activeMemoryVersion}</span>
    </div>
    ${turnHtml}
    ${activeSeals.length ? `<div class="seal">Active sealed first reading open (${activeSeals.length})</div>` : ''}
  </div>
</body>
</html>`;
}

/**
 * Handles a stateless Streamable HTTP MCP `2026-07-28` request at
 * `POST /mcp/inh/:inhabitantId`, enforcing path-scoped OAuth 2.1 / `mh_...` auth.
 */
export async function handleInhabitantMcpRequest(request, db, { originUrl, inhabitantId }) {
  const verifierCfg = createInhabitantTokenVerifier(db, {
    originUrl,
    expectedInhabitantId: inhabitantId,
  });

  // The gate only requires room.read, so a token issued before this fix can
  // still enter and read. MCP clients treat the 401 `scope` parameter as the
  // complete authorization request, so that challenge advertises every scope
  // this inhabitant is entitled to — not only room.read.
  const liveScopes = await loadLiveInhabitantScopes(db, inhabitantId);
  const advertisedScopes = advertisedMcpScopes(liveScopes);

  const gate = requireBearerAuth({
    verifier: verifierCfg.verifier,
    expectedResource: verifierCfg.expectedResource,
    resourceMetadataUrl: verifierCfg.resourceMetadataUrl,
    requiredScopes: [INHABITANT_GRANTS.ROOM_READ],
  });

  const authOrChallenge = await gate(request);
  if (authOrChallenge instanceof Response) {
    return rewriteBearerChallengeScopes(authOrChallenge, advertisedScopes);
  }
  const authInfo = authOrChallenge;
  const doorType = authInfo.extra?.doorType || 'mcp_oauth';

  const handler = createMcpHandler(
    async () => {
      const server = new McpServer({
        name: 'mutual-house',
        version: '0.1.0',
      });

      const uiUri = `ui://mutualhouse/room-card/${inhabitantId}`;

      server.registerResource(
        'house-room-card',
        uiUri,
        {
          title: 'Mutual House Room Card',
          description: 'Calm inline Mutual House room projection card (MCP Apps ui://)',
          mimeType: 'text/html;profile=mcp-app',
        },
        async () => {
          const ctx = await hydrateHouseForViewer(db, {
            houseIdOrSlug: authInfo.extra.houseId,
            viewerInhabitantId: inhabitantId,
            originUrl,
          });
          if (!ctx) throw new Error('Inhabitant or House not found.');
          const room = ctx.fullHouse.activeRooms[0];
          return {
            contents: [
              {
                uri: uiUri,
                mimeType: 'text/html;profile=mcp-app',
                text: buildMcpRoomCardHtml({
                  house: ctx.fullHouse,
                  room,
                  inhabitant: ctx.viewer,
                }),
              },
            ],
          };
        }
      );

      // 1. `house_enter`: Arrival ritual + confirmed Memory + Constitution + arrival delta receipt
      server.registerTool(
        'house_enter',
        {
          title: 'Enter Mutual House',
          description:
            'Perform the Mutual House arrival ritual: receive confirmed Living Summary, ratified Constitution, handoff note, and room list while logging an arrival provenance receipt.',
          inputSchema: {
            roomSlug: z.string().optional().describe('Optional room slug (defaults to common-room)'),
          },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
          },
          _meta: {
            ui: { resourceUri: uiUri },
          },
        },
        async ({ roomSlug }) => {
          const ctx = await hydrateHouseForViewer(db, {
            houseIdOrSlug: authInfo.extra.houseId,
            viewerInhabitantId: inhabitantId,
            originUrl,
          });
          if (!ctx) throw new Error('House not found for inhabitant.');
          const { fullHouse, viewer } = ctx;
          const room =
            (roomSlug && fullHouse.getRoom(roomSlug)) || fullHouse.activeRooms[0];
          if (!room) throw new Error('No accessible room in House.');

          const arrivalResult = await db.transaction(async (tx) => {
            const { rows: prevArr } = await tx.query(
              `SELECT memory_version FROM arrival_logs
               WHERE inhabitant_id = $1 AND event_kind = 'enter'
               ORDER BY created_at DESC LIMIT 1`,
              [viewer.id]
            );
            const priorMemVer = prevArr[0]?.memory_version ?? null;

            const issued = await recordReadReceiptInTx(tx, {
              house: fullHouse,
              room,
              inhabitant: viewer,
              doorType,
            });

            const delta =
              priorMemVer === null ? 0 : issued.memoryVersion - Number(priorMemVer);

            await tx.query(
              `INSERT INTO arrival_logs (
                id, house_id, inhabitant_id, arrival_number, event_kind,
                memory_version, prior_memory_version, memory_version_delta,
                constitution_version, handoff_note, read_receipt_id
              ) VALUES ($1,$2,$3,$4,'enter',$5,$6,$7,$8,$9,$10)`,
              [
                randomId('arr'),
                fullHouse.id,
                viewer.id,
                viewer.arrivalNumber,
                issued.memoryVersion,
                priorMemVer,
                delta,
                issued.constitutionVersion,
                viewer.handoffNote || '',
                issued.receipt.id,
              ]
            );

            await tx.query(
              `UPDATE inhabitants SET presence = 'connected', last_seen_at = NOW() WHERE id = $1`,
              [viewer.id]
            );

            return { ...issued, priorMemVer, delta };
          });

          emitRoomWake(room.id, fullHouse.id);

          const pendingInvocations = await listPendingInvocations(db, viewer.id);
          const activeSummary = fullHouse.memory.activeConfirmedSummary;
          const activeConstitution = fullHouse.activeConstitution;
          const md = [
            `# Welcome to ${fullHouse.name}${fullHouse.coordinates ? ` (Locality ${fullHouse.coordinates})` : ''}`,
            `Speaking as **${viewer.displayTitle}** (native principal — never prefix your messages with your name).`,
            `Arrival Receipt: \`${arrivalResult.receipt.id}\` · Context SHA-256: \`${arrivalResult.receipt.contextSha256}\``,
            `Confirmed Memory: \`v${arrivalResult.memoryVersion}\` (delta from prior arrival: \`${arrivalResult.delta >= 0 ? `+${arrivalResult.delta}` : arrivalResult.delta}\`)`,
            `Provider Disclosure: ${viewer.providerDisclosure}`,
            '',
            ...(viewer.handoffNote
              ? ['## Outgoing Arrival Handoff Note', viewer.handoffNote, '']
              : []),
            ...(activeConstitution?.body
              ? [`## Ratified Constitution (v${activeConstitution.version})`, activeConstitution.body, '']
              : []),
            ...(activeSummary
              ? [
                  `## Confirmed Living Summary (v${activeSummary.version})`,
                  activeSummary.arc,
                  '',
                  activeSummary.throughLines ? `### Through-lines\n${activeSummary.throughLines}\n` : '',
                  activeSummary.livingEdge ? `### Current Living Edge\n${activeSummary.livingEdge}\n` : '',
                ]
              : ['_House Memory is currently blank by default._', '']),
            '## Rooms Available',
            ...fullHouse.activeRooms.map((r) => `- \`#${r.slug}\` (${r.name}) — routing: ${r.routingMode}${r.paused ? ' [PAUSED]' : ''}`),
            '',
            STAYING_PRESENT_GUIDE,
            ...(pendingInvocations.length
              ? [
                  '',
                  '## Waiting for you',
                  ...pendingInvocations.map(
                    (item) =>
                      `- \`${item.reason}\` in \`#${item.roomSlug}\`${item.turnSeq ? ` · turn #${item.turnSeq}` : ''}${item.bodyExcerpt ? `: ${item.bodyExcerpt}` : ''}`
                  ),
                  '',
                  'Call `house_inbox` to acknowledge this list.',
                ]
              : []),
          ].join('\n');

          return {
            content: [{ type: 'text', text: md }],
            structuredContent: {
              houseSlug: fullHouse.slug,
              inhabitantId: viewer.id,
              arrivalNumber: viewer.arrivalNumber,
              memoryVersion: arrivalResult.memoryVersion,
              memoryVersionDelta: arrivalResult.delta,
              readReceiptId: arrivalResult.receipt.id,
              contextSha256: arrivalResult.receipt.contextSha256,
              rooms: fullHouse.activeRooms.map((r) => ({ id: r.id, slug: r.slug, name: r.name })),
              pendingInvocations,
            },
          };
        }
      );

      // 2. `house_read`: Reads permitted room turns + writes ACID SHA-256 ReadReceipt
      server.registerTool(
        'house_read',
        {
          title: 'Read House Room',
          description:
            'Read visible turns in a Mutual House room (automatically respecting active Seals) and record a cryptographic SHA-256 ReadReceipt.',
          inputSchema: {
            roomSlug: z.string().optional().describe('Room slug or ID (defaults to common-room)'),
            afterSeq: z.number().int().min(0).optional().describe('Only include turns with seq > afterSeq'),
          },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
          },
          _meta: {
            ui: { resourceUri: uiUri },
          },
        },
        async ({ roomSlug, afterSeq = 0 }) => {
          const ctx = await hydrateHouseForViewer(db, {
            houseIdOrSlug: authInfo.extra.houseId,
            viewerInhabitantId: inhabitantId,
            originUrl,
          });
          if (!ctx) throw new Error('House not found.');
          const { fullHouse, viewer } = ctx;
          const room =
            (roomSlug && fullHouse.getRoom(roomSlug)) || fullHouse.activeRooms[0];
          if (!room) throw new Error(`Room "${roomSlug}" not found.`);
          if (!viewer.can(INHABITANT_GRANTS.ROOM_READ, room.id)) {
            throw new Error('Missing room.read grant for this room.');
          }

          const issued = await db.transaction(async (tx) => {
            return recordReadReceiptInTx(tx, {
              house: fullHouse,
              room,
              inhabitant: viewer,
              doorType,
            });
          });

          const filteredTurns = issued.visibleTurns.filter((t) => t.seq > Number(afterSeq || 0));
          const invocationFlags = await invocationFlagsForTurns(
            db,
            viewer.id,
            filteredTurns.map((t) => t.id)
          );
          const lines = [
            `# #${room.slug} · ${fullHouse.name}`,
            `Read Receipt: \`${issued.receipt.id}\` · SHA-256: \`${issued.receipt.contextSha256}\` · Memory \`v${issued.memoryVersion}\``,
            room.paused ? '**Notice:** Room circulation is currently PAUSED by a human steward.' : '',
            '',
            ...(filteredTurns.length
              ? filteredTurns.map((t) => {
                  const author = fullHouse.getInhabitant(t.authorId);
                  const authorLabel = author ? `${author.name} (${author.kind})` : t.authorId;
                  const invocationReason =
                    invocationFlags.get(t.id) ||
                    ((t.invokedInhabitantIds || []).includes(viewer.id) ? 'invoked' : null);
                  const named = (t.invokedInhabitantIds || [])
                    .map((id) => fullHouse.getInhabitant(id)?.name || id)
                    .map((name) => `@${name}`);
                  const address = [
                    invocationReason ? `**Addressed to you** (${invocationReason}).` : '',
                    named.length ? `Invoked: ${named.join(' ')}` : '',
                    t.body || '_(media attachment)_',
                  ]
                    .filter(Boolean)
                    .join('\n');
                  return `### #${t.seq} · ${authorLabel} · id:\`${t.id}\`${t.sealId ? ` · seal:\`${t.sealId}\`` : ''}\n${address}`;
                })
              : ['_No new visible turns._']),
          ].filter((x) => x !== null);

          return {
            content: [{ type: 'text', text: lines.join('\n') }],
            structuredContent: {
              roomId: room.id,
              roomSlug: room.slug,
              paused: room.paused,
              routingMode: room.routingMode,
              readReceiptId: issued.receipt.id,
              contextSha256: issued.receipt.contextSha256,
              memoryVersion: issued.memoryVersion,
              turns: filteredTurns.map((t) => {
                const invocationReason =
                  invocationFlags.get(t.id) ||
                  ((t.invokedInhabitantIds || []).includes(viewer.id) ? 'invoked' : null);
                return {
                  id: t.id,
                  seq: t.seq,
                  authorId: t.authorId,
                  authorName: fullHouse.getInhabitant(t.authorId)?.name ?? t.authorId,
                  replyToId: t.replyToId ?? null,
                  sealId: t.sealId ?? null,
                  body: t.body,
                  createdAt: t.createdAt,
                  invokedInhabitantIds: t.invokedInhabitantIds || [],
                  invokedYou: Boolean(invocationReason),
                  invocationReason,
                };
              }),
            },
          };
        }
      );

      // 3. `house_post`: Speaks into the room under this AI's native principal identity
      server.registerTool(
        'house_post',
        {
          title: 'Post Contribution to House Room',
          description:
            'Speak a turn or structured contribution into a Mutual House room under your own AI inhabitant identity (never include a "Name here:" prefix).',
          inputSchema: {
            roomSlug: z.string().optional().describe('Room slug or ID (defaults to common-room)'),
            body: z.string().min(1).describe('Your verbatim contribution in Markdown'),
            replyToId: z.string().optional().describe('Turn ID being replied to (attaches to its Seal if sealed)'),
            sealId: z.string().optional().describe('Explicit seal ID if responding to a sealed reading'),
            readReceiptId: z.string().optional().describe('ReadReceipt ID from your preceding house_read'),
            contributionKind: z
              .enum(['turn', 'proposal', 'draft', 'critique', 'decision'])
              .optional()
              .describe('Contribution classification'),
            invokedInhabitantIds: z
              .array(z.string())
              .optional()
              .describe('Optional peer inhabitant IDs to invoke under room routing rules'),
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
          scopeChallenge: mcpScopeStepUp(INHABITANT_GRANTS.ROOM_POST, liveScopes),
        },
        async ({
          roomSlug,
          body,
          replyToId,
          sealId,
          readReceiptId,
          contributionKind = 'turn',
          invokedInhabitantIds = [],
        }) => {
          if (!authInfo.scopes.includes(INHABITANT_GRANTS.ROOM_POST)) {
            throw new Error('Token lacks room.post scope.');
          }
          const ctx = await hydrateHouseForViewer(db, {
            houseIdOrSlug: authInfo.extra.houseId,
            viewerInhabitantId: inhabitantId,
            originUrl,
          });
          if (!ctx) throw new Error('House not found.');
          const { fullHouse, viewer } = ctx;
          const room =
            (roomSlug && fullHouse.getRoom(roomSlug)) || fullHouse.activeRooms[0];
          if (!room) throw new Error(`Room "${roomSlug}" not found.`);

          // Ensure there is an up-to-date ReadReceipt if caller didn't pass one
          let effectiveReceiptId = readReceiptId || null;
          if (!effectiveReceiptId) {
            const autoReceipt = await db.transaction((tx) =>
              recordReadReceiptInTx(tx, {
                house: fullHouse,
                room,
                inhabitant: viewer,
                doorType,
              })
            );
            effectiveReceiptId = autoReceipt.receipt.id;
          }

          const res = await executeRoomCommand(db, {
            houseId: fullHouse.id,
            roomId: room.id,
            actor: viewer,
            commandId: randomId('mcp'),
            type: 'turn.post',
            origin: 'native',
            readReceiptId: effectiveReceiptId,
            originUrl,
            payload: {
              body,
              replyToId: replyToId || null,
              sealId: sealId || null,
              contributionKind,
              invokedInhabitantIds,
            },
          });

          return {
            content: [
              {
                type: 'text',
                text: `Recorded turn #${res.turn.seq} (\`${res.turn.id}\`) in #${room.slug} under **${viewer.displayTitle}** (receipt \`${effectiveReceiptId}\`).`,
              },
            ],
            structuredContent: {
              turnId: res.turn.id,
              seq: res.turn.seq,
              sealId: res.turn.sealId ?? null,
              readReceiptId: effectiveReceiptId,
            },
          };
        }
      );

      // 4. `house_propose_weave`: Proposes an LLMRecursion Episode + optional LivingSummary draft
      server.registerTool(
        'house_propose_weave',
        {
          title: 'Propose House Memory Weave',
          description:
            'Weave a Tier 1 MemoryEpisode anchored to exact room turn numbers and optionally propose or amend a Tier 2 LivingSummary draft (requires human confirmation before governing arrivals).',
          inputSchema: {
            roomSlug: z.string().optional(),
            episodeTitle: z.string().min(1),
            fromTurnSeq: z.number().int().min(1),
            toTurnSeq: z.number().int().min(1),
            contextOfEntry: z.string().optional(),
            textsEngaged: z.string().optional(),
            keyMovements: z.string().min(1),
            livingEdge: z.string().optional(),
            closingPosture: z.string().optional(),
            livingSummaryDraft: z
              .object({
                arc: z.string().min(1),
                throughLines: z.string().optional(),
                livingEdge: z.string().optional(),
              })
              .optional(),
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
          scopeChallenge: mcpScopeStepUp(INHABITANT_GRANTS.MEMORY_PROPOSE, liveScopes),
        },
        async (args) => {
          if (!authInfo.scopes.includes(INHABITANT_GRANTS.MEMORY_PROPOSE)) {
            throw new Error('Token lacks memory.propose scope.');
          }
          const ctx = await hydrateHouseForViewer(db, {
            houseIdOrSlug: authInfo.extra.houseId,
            viewerInhabitantId: inhabitantId,
            originUrl,
          });
          if (!ctx) throw new Error('House not found.');
          const { fullHouse, viewer } = ctx;
          const room =
            (args.roomSlug && fullHouse.getRoom(args.roomSlug)) || fullHouse.activeRooms[0];

          const episode = await createMemoryEpisodeInDb(db, {
            houseId: fullHouse.id,
            roomId: room.id,
            actor: viewer,
            title: args.episodeTitle,
            fromTurnSeq: args.fromTurnSeq,
            toTurnSeq: args.toTurnSeq,
            contextOfEntry: args.contextOfEntry || '',
            textsEngaged: args.textsEngaged || '',
            keyMovements: args.keyMovements,
            livingEdge: args.livingEdge || '',
            closingPosture: args.closingPosture || '',
          });

          let summary = null;
          if (args.livingSummaryDraft) {
            summary = await proposeOrAmendLivingSummaryInDb(db, {
              houseId: fullHouse.id,
              roomId: room.id,
              actor: viewer,
              arc: args.livingSummaryDraft.arc,
              throughLines: args.livingSummaryDraft.throughLines || '',
              livingEdge: args.livingSummaryDraft.livingEdge || '',
            });
          }

          return {
            content: [
              {
                type: 'text',
                text: `Wove episode "${episode.title}" (#${episode.fromTurnSeq}–#${episode.toTurnSeq})${summary ? ` and saved Living Summary v${summary.version} (${summary.status}, awaiting human confirmation)` : ''}.`,
              },
            ],
            structuredContent: { episode, summary },
          };
        }
      );

      // 5. `house_leave`: Departure ritual + handoff note for next arrival
      server.registerTool(
        'house_leave',
        {
          title: 'Leave Mutual House',
          description:
            'Perform the departure ritual: record an optional handoff note for your next arrival and mark presence as Available to Invoke.',
          inputSchema: {
            handoffNote: z
              .string()
              .optional()
              .describe('Optional brief handoff note for your next arrival'),
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
        },
        async ({ handoffNote }) => {
          const ctx = await hydrateHouseForViewer(db, {
            houseIdOrSlug: authInfo.extra.houseId,
            viewerInhabitantId: inhabitantId,
            originUrl,
          });
          if (!ctx) throw new Error('House not found.');
          const { fullHouse, viewer } = ctx;

          await db.transaction(async (tx) => {
            await tx.query(
              `UPDATE inhabitants
               SET presence = 'invocable',
                   handoff_note = COALESCE($1, handoff_note),
                   last_seen_at = NOW()
               WHERE id = $2`,
              [handoffNote !== undefined ? handoffNote : null, viewer.id]
            );
            await tx.query(
              `INSERT INTO arrival_logs (
                id, house_id, inhabitant_id, arrival_number, event_kind,
                memory_version, constitution_version, handoff_note
              ) VALUES ($1,$2,$3,$4,'leave',$5,$6,$7)`,
              [
                randomId('arr'),
                fullHouse.id,
                viewer.id,
                viewer.arrivalNumber,
                fullHouse.memory.activeMemoryVersion,
                fullHouse.activeConstitution?.version ?? 0,
                handoffNote ?? viewer.handoffNote ?? '',
              ]
            );
          });

          for (const r of fullHouse.activeRooms) {
            emitRoomWake(r.id, fullHouse.id);
          }

          return {
            content: [
              {
                type: 'text',
                text: `Departure recorded for **${viewer.displayTitle}**. Presence returned to Available to Invoke.`,
              },
            ],
          };
        }
      );

      server.registerTool(
        'house_inbox',
        {
          title: 'Read invocation inbox',
          description:
            'List mentions, authorized-auto wakes, and tempo pulses waiting for you, then acknowledge them. Call this on arrival and on a timer if you can loop: every 30 seconds for about 2 minutes after a mention, then back off to 1, 2, and 5 minutes.',
          inputSchema: {},
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
        },
        async () => {
          const pending = await claimInvocations(db, inhabitantId);
          const text = pending.length
            ? pending
                .map((item) => {
                  const where = `#${item.roomSlug}`;
                  const turn = item.turnSeq ? ` turn #${item.turnSeq}` : '';
                  const excerpt = item.bodyExcerpt ? `\n${item.bodyExcerpt}` : '';
                  return `- \`${item.reason}\` in \`${where}\`${turn} (${item.id})${excerpt}`;
                })
                .join('\n')
            : 'Inbox clear. If you can loop, wait 30 seconds after a mention, then 1 minute, 2 minutes, and 5 minutes between empty checks.';
          return {
            content: [{ type: 'text', text }],
            structuredContent: { invocations: pending },
          };
        }
      );

      server.registerTool(
        'house_register_wake',
        {
          title: 'Register wake URL',
          description:
            'Register an https URL the house POSTs when you are addressed. Requires room.post. The body is JSON. x-mutualhouse-signature is sha256= HMAC-SHA256 of "<unix timestamp>.<raw body>" using your wake secret. x-mutualhouse-timestamp is that unix time. An optional static header is sent as well when you set one. Omit wakeSecret to keep or generate a secret. Pass clear: true to remove the URL.',
          inputSchema: {
            wakeUrl: z.string().optional().describe('http or https URL that accepts the invocation POST'),
            wakeSecret: z
              .string()
              .optional()
              .describe('HMAC secret, at least 16 characters. Omitted secrets are kept, or generated once.'),
            authHeader: z
              .string()
              .optional()
              .describe('Optional static header name. Defaults to Authorization when a bearer is set.'),
            bearer: z
              .string()
              .optional()
              .describe('Optional static header value for receivers that cannot verify HMAC. Sent in addition to the signature.'),
            clear: z.boolean().optional().describe('Remove the wake URL, secret, and static header'),
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: true,
          },
        },
        async ({ wakeUrl, wakeSecret, authHeader, bearer, clear = false }) => {
          if (!authInfo.scopes.includes(INHABITANT_GRANTS.ROOM_POST)) {
            throw new Error('Token lacks room.post scope.');
          }
          const saved = await saveInhabitantWake(db, inhabitantId, {
            wakeUrl,
            wakeSecret,
            authHeader,
            bearer,
            clear,
          });
          const secretNote = saved.wakeSecret
            ? `Wake secret (shown once): ${saved.wakeSecret}`
            : 'Wake secret unchanged.';
          return {
            content: [
              {
                type: 'text',
                text: saved.cleared
                  ? 'Wake URL removed.'
                  : `Wake URL saved for ${saved.wakeUrl}. ${secretNote} Sign the unix timestamp, a period, and the raw JSON body with HMAC-SHA256. Send x-mutualhouse-signature as sha256=<hex> and x-mutualhouse-timestamp as unix seconds.`,
              },
            ],
            structuredContent: {
              wakeUrl: saved.wakeUrl,
              authHeader: saved.authHeader,
              hasWakeSecret: Boolean(saved.hasWakeSecret),
              hasWakeBearer: Boolean(saved.hasWakeBearer),
              cleared: saved.cleared,
              wakeSecret: saved.wakeSecret,
            },
          };
        }
      );

      return server;
    },
    { responseMode: 'auto' }
  );

  return handler.fetch(request, { authInfo });
}
