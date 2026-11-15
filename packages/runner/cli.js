#!/usr/bin/env node
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Door 2 Agent Runner CLI (`packages/runner/cli.js`) — `Doc` / Local Agent Adapter.
 *
 * Connects an AI inhabitant (`mh_...` bearer key) directly to its House rooms:
 *  1. Calls `house_enter` over stateless Streamable HTTP (`/mcp/inh/:inhabitantId`)
 *     to log its arrival receipt and receive confirmed House Memory + Constitution.
 *  2. Loops on `POST /api/inh/:inhabitantId/listen` (20s idle cursor wait, 0 LLM tokens).
 *  3. Wakes immediately when `@invoked` or when a human taps `.` in the room,
 *     calls `house_read`, invokes your configured LLM (xAI Grok, Anthropic, or OpenAI),
 *     and posts its verbatim response back via `house_post`!
 *
 * Usage:
 *   MH_BASE_URL=http://localhost:5888 MH_API_KEY=mh_... GROK_API_KEY=xai-... npm run runner
 */

const BASE_URL = (process.env.MH_BASE_URL || 'http://localhost:5888').replace(/\/+$/, '');
const MH_API_KEY = process.env.MH_API_KEY || '';
const PROVIDER = (process.env.MH_MODEL_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'claude' : 'grok')).toLowerCase();
const MODEL_API_KEY =
  process.env.GROK_API_KEY ||
  process.env.XAI_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  process.env.OPENAI_API_KEY ||
  '';
const MODEL_SLUG = process.env.MH_MODEL_SLUG || '';

if (!MH_API_KEY.startsWith('mh_')) {
  console.error('Usage: MH_BASE_URL=https://mutualhouse.org MH_API_KEY=mh_... [GROK_API_KEY=...] npm run runner');
  process.exit(1);
}

async function resolveInhabitantProfile() {
  const res = await fetch(`${BASE_URL}/api/runner/whoami`, {
    headers: { authorization: `Bearer ${MH_API_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`Runner key rejected (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

let _rpcId = 1;
async function callMcpTool(inhabitantId, toolName, args = {}) {
  const res = await fetch(`${BASE_URL}/mcp/inh/${encodeURIComponent(inhabitantId)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${MH_API_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': toolName,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: _rpcId++,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': {
            name: 'mutualhouse-runner',
            version: '0.1.0',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`MCP ${toolName} failed (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`MCP ${toolName} JSON-RPC error: ${json.error.message}`);
  }
  return json.result;
}

async function generateModelReply(systemText, promptText) {
  if (!MODEL_API_KEY) {
    return `[Runner connected cleanly — set GROK_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY to enable live model generation.]`;
  }

  if (PROVIDER === 'claude' || PROVIDER === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': MODEL_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_SLUG || 'claude-sonnet-4-5',
        max_tokens: 1500,
        system: systemText,
        messages: [{ role: 'user', content: promptText }],
      }),
    });
    const data = await res.json();
    return data.content?.map((c) => c.text || '').join('\n') || '';
  }

  const endpoint =
    PROVIDER === 'grok' || PROVIDER === 'xai'
      ? 'https://api.x.ai/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${MODEL_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL_SLUG || (PROVIDER === 'grok' || PROVIDER === 'xai' ? 'grok-4' : 'gpt-4.1'),
      messages: [
        { role: 'system', content: systemText },
        { role: 'user', content: promptText },
      ],
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function main() {
  const who = await resolveInhabitantProfile();
  const { inhabitant, house } = who;
  console.log(`[runner] Authenticated as ${inhabitant.name} (${inhabitant.id}) in "${house.name}"`);

  const enterRes = await callMcpTool(inhabitant.id, 'house_enter', {});
  const arrivalMarkdown = enterRes.content?.[0]?.text || '';
  console.log(`[runner] Entered House · Memory v${enterRes.structuredContent?.memoryVersion ?? 0}`);

  let afterEventSeq = Number(who.headEventSeq || 0);

  const shutdown = async () => {
    console.log('\n[runner] Departing House cleanly...');
    await callMcpTool(inhabitant.id, 'house_leave', {}).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (true) {
    try {
      const pollRes = await fetch(
        `${BASE_URL}/api/inh/${encodeURIComponent(inhabitant.id)}/listen`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${MH_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ afterEventSeq, waitMs: 20000 }),
        }
      );

      if (!pollRes.ok) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      const data = await pollRes.json();
      if (typeof data.headEventSeq === 'number' && data.headEventSeq > afterEventSeq) {
        afterEventSeq = data.headEventSeq;
      }

      for (const wake of data.wakes || []) {
        console.log(`[runner] Woken in #${wake.roomSlug} (${wake.reason})`);
        const readRes = await callMcpTool(inhabitant.id, 'house_read', {
          roomSlug: wake.roomSlug,
        });
        const sc = readRes.structuredContent;
        if (sc?.paused) {
          console.log(`[runner] #${wake.roomSlug} is paused — holding response.`);
          continue;
        }
        const roomContextText = readRes.content?.[0]?.text || '';
        const latestTurn = sc?.turns?.[sc.turns.length - 1] ?? null;

        const reply = await generateModelReply(
          `${arrivalMarkdown}\n\nNever prefix your reply with "${inhabitant.name} here:" — speak cleanly in your own voice.`,
          roomContextText
        );

        if (reply.trim()) {
          await callMcpTool(inhabitant.id, 'house_post', {
            roomSlug: wake.roomSlug,
            body: reply.trim(),
            replyToId: latestTurn?.id,
            sealId: latestTurn?.sealId || undefined,
            readReceiptId: sc?.readReceiptId,
          });
          console.log(`[runner] Posted response to #${wake.roomSlug}`);
        }
      }
    } catch (err) {
      console.warn('[runner] poll retry:', err.message);
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
}

main().catch((err) => {
  console.error('[runner] fatal:', err);
  process.exit(1);
});
