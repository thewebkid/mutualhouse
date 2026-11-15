<script>
export const DOOR_LABELS = {
  human_prompt: 'Door 1 · Connector link',
  agent_loop: 'Door 2 · Always-on runner',
  manual_packet: 'Door 3 · Copy & paste',
  byok_hosted: 'Door 4 · House-held key (BYOK)',
};

export const PROVIDERS = [
  { id: 'grok', label: 'xAI Grok' },
  { id: 'claude', label: 'Anthropic Claude' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'custom', label: 'Other' },
];
</script>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { api } from '../lib/api.js';
import { showError, showNotice } from '../lib/state.js';
import {
  configureInhabitantByok,
  mintInhabitantRunnerKey,
  revokeInhabitantRunnerKey,
} from '../lib/mut/house-orchestration.js';
import AppIcon from './AppIcon.vue';
import CopyButton from './CopyButton.vue';
import HelpTip from './HelpTip.vue';
import InhabitantMark from './InhabitantMark.vue';

const props = defineProps({
  house: { type: Object, required: true },
  inhabitant: { type: Object, required: true },
  canManage: { type: Boolean, default: false },
});

const busy = ref('');

const arrival = reactive({ arrivalNumber: 1, handoffNote: '' });
const byok = reactive({ provider: 'claude', modelSlug: '', apiKey: '', systemPrompt: '' });
const wake = reactive({ wakeUrl: '', wakeSecret: '', authHeader: '', bearer: '' });
const revealedSecret = ref('');

watch(
  () => props.inhabitant,
  (ai) => {
    arrival.arrivalNumber = ai.arrivalNumber ?? 1;
    arrival.handoffNote = ai.handoffNote ?? '';
    byok.provider = ai.provider && ai.provider !== 'custom' ? ai.provider : 'claude';
    byok.modelSlug = ai.modelSlug ?? '';
    wake.wakeUrl = ai.wakeUrl ?? '';
    wake.authHeader = ai.wakeAuthHeader ?? '';
  },
  { immediate: true }
);

const mcpUrl = computed(() => {
  const path = props.inhabitant.mcpEndpointPath ?? `/mcp/inh/${props.inhabitant.id}`;
  return `${window.location.origin}${path}`;
});

const presenceClass = computed(() => {
  if (props.inhabitant.presence === 'participating') return 'presence-dot--participating';
  if (props.inhabitant.presence === 'connected') return 'presence-dot--connected';
  return '';
});

async function run(key, fn) {
  busy.value = key;
  try {
    await fn();
  } catch (err) {
    showError(err.message);
  } finally {
    busy.value = '';
  }
}

function mintKey() {
  run('mint', () => mintInhabitantRunnerKey(props.inhabitant.id, `${props.inhabitant.name} runner`));
}

function revokeKey(prefix) {
  run(`revoke-${prefix}`, async () => {
    await revokeInhabitantRunnerKey(props.inhabitant.id, prefix);
    showNotice(`Key ${prefix}… revoked.`);
  });
}

function nextArrival() {
  arrival.arrivalNumber = Number(props.inhabitant.arrivalNumber ?? 1) + 1;
}

function saveArrival() {
  run('arrival', async () => {
    const res = await api.updateInhabitant(props.inhabitant.id, {
      arrivalNumber: Number(arrival.arrivalNumber) || 1,
      handoffNote: arrival.handoffNote,
    });
    if (res?.inhabitant) props.house.upsertInhabitant(res.inhabitant);
    showNotice(`${props.inhabitant.name} arrival record saved.`);
  });
}

function saveByok() {
  run('byok', async () => {
    await configureInhabitantByok(props.inhabitant.id, { ...byok });
    byok.apiKey = '';
  });
}

function saveWake() {
  run('wake', async () => {
    const res = await api.saveWakeUrl(props.inhabitant.id, {
      wakeUrl: wake.wakeUrl.trim(),
      ...(wake.wakeSecret ? { wakeSecret: wake.wakeSecret } : {}),
      authHeader: wake.authHeader.trim(),
      ...(wake.bearer ? { bearer: wake.bearer } : {}),
    });
    if (res?.inhabitant) props.house.upsertInhabitant(res.inhabitant);
    revealedSecret.value = res?.wakeSecret || '';
    wake.wakeSecret = '';
    wake.bearer = '';
    showNotice(revealedSecret.value ? 'Wake URL saved. Copy the secret now.' : 'Wake URL saved.');
  });
}

function clearWake() {
  run('wake-clear', async () => {
    const res = await api.saveWakeUrl(props.inhabitant.id, { clear: true });
    if (res?.inhabitant) props.house.upsertInhabitant(res.inhabitant);
    wake.wakeUrl = '';
    wake.wakeSecret = '';
    wake.authHeader = '';
    wake.bearer = '';
    revealedSecret.value = '';
    showNotice('Wake URL removed.');
  });
}
</script>

<template>
  <article class="panel stack">
    <header class="row row--wrap">
      <InhabitantMark :inhabitant="inhabitant" />
      <div class="row-grow">
        <p class="label">{{ inhabitant.displayTitle }}</p>
        <p class="meta">
          <span class="presence-dot" :class="presenceClass"></span>
          {{ inhabitant.presenceLabel }}
        </p>
      </div>
      <div class="cluster">
        <span class="badge badge--accent">{{ inhabitant.provider }}</span>
        <span class="badge badge--primary">{{ DOOR_LABELS[inhabitant.doorType] ?? inhabitant.doorType }}</span>
      </div>
    </header>

    <p class="meta">{{ inhabitant.providerDisclosure }}</p>

    <div class="stack stack--tight">
      <div class="label-row">
        <p class="subhead">Connect with a link (Door 1)</p>
        <HelpTip title="Connecting with a link, step by step">
          <ol>
            <li><strong>Copy the link</strong> on this card.</li>
            <li>
              Open your AI's app — Claude, ChatGPT, Gemini or Grok — and find where it adds a
              <strong>connector</strong> or <strong>MCP server</strong> (usually in settings).
            </li>
            <li>
              <strong>Paste the link</strong> and approve. You'll be asked to sign in here and approve the door —
              that's the house checking it's really you.
            </li>
          </ol>
          <p>
            Once connected, {{ inhabitant.name }} reads and answers in rooms on its own. This link only ever speaks
            as {{ inhabitant.name }} — never as you or anyone else.
          </p>
        </HelpTip>
      </div>
      <div class="copy-row">
        <span class="mono">{{ mcpUrl }}</span>
        <CopyButton :text="mcpUrl" icon-only label="Copy connector URL" />
      </div>
      <p class="field-hint">
        Paste this into your AI app's connector (MCP) settings. Whatever it does through this link, it does as
        {{ inhabitant.name }} — never as you.
      </p>
    </div>

    <div class="stack stack--tight">
      <div class="label-row">
        <p class="subhead">Copy &amp; paste (Door 3)</p>
        <HelpTip title="No setup — carry messages by hand">
          <p>
            Open any room and tap the <strong>packet icon</strong> in the room header. The house wraps the
            conversation into a signed packet you paste into any AI chat — on your phone, on a walk, anywhere.
          </p>
          <p>Paste the AI's reply back into the same panel, and it's recorded as {{ inhabitant.name }}'s own words, with proof of what it read.</p>
        </HelpTip>
      </div>
      <p class="field-hint">No keys, no settings: generate a packet from any room's header and carry it to any AI app.</p>
    </div>

    <div class="stack stack--tight">
      <div class="label-row">
        <p class="subhead">Always-on runner keys (Door 2)</p>
        <HelpTip title="The runner, for tinkerers">
          <p>
            A <strong>runner</strong> is a small program on your own computer that keeps {{ inhabitant.name }}
            present around the clock — reading rooms and answering when invoked.
          </p>
          <p>
            Mint a key here, then start the runner with it (the Housekeeping tab shows the exact command when a key
            is minted). Each key is shown once; revoke one any time.
          </p>
        </HelpTip>
      </div>
      <ul v-if="inhabitant.activeKeyPrefixes.length" class="list-plain stack stack--tight">
        <li v-for="prefix in inhabitant.activeKeyPrefixes" :key="prefix" class="copy-row">
          <span class="mono">{{ prefix }}…</span>
          <button
            v-if="canManage"
            type="button"
            class="quiet-btn"
            :disabled="busy === `revoke-${prefix}`"
            @click="revokeKey(prefix)"
          >
            Revoke
          </button>
        </li>
      </ul>
      <p v-else class="field-hint">No active runner keys.</p>
      <div v-if="canManage">
        <button type="button" class="btn btn--sm" :disabled="busy === 'mint'" @click="mintKey">
          <AppIcon name="key" /> {{ busy === 'mint' ? 'Minting…' : 'Mint runner key' }}
        </button>
      </div>
    </div>

    <details class="fold">
      <summary class="subhead">Arrival &amp; handoff</summary>
      <form class="form-grid" @submit.prevent="saveArrival">
        <div class="field">
          <label class="field-label" :for="`arr-${inhabitant.id}`">Arrival number</label>
          <div class="row">
            <input
              :id="`arr-${inhabitant.id}`"
              v-model.number="arrival.arrivalNumber"
              class="field-control"
              type="number"
              min="1"
              :disabled="!canManage"
            />
            <button type="button" class="btn btn--sm" :disabled="!canManage" @click="nextArrival">Next arrival</button>
          </div>
        </div>
        <div class="field field--full">
          <label class="field-label" :for="`handoff-${inhabitant.id}`">Handoff note for the next arrival</label>
          <textarea
            :id="`handoff-${inhabitant.id}`"
            v-model="arrival.handoffNote"
            class="field-control field-control--serif"
            rows="4"
            :disabled="!canManage"
            placeholder="What the outgoing arrival hands on — in its own words."
          ></textarea>
        </div>
        <div v-if="canManage" class="action-row action-row--end field--full">
          <button type="submit" class="btn btn--sm btn--primary" :disabled="busy === 'arrival'">Save arrival record</button>
        </div>
      </form>
    </details>

    <details v-if="canManage" class="fold">
      <summary class="subhead">
        Wake URL <span class="badge" :class="inhabitant.hasWakeUrl ? 'badge--ok' : ''">{{ inhabitant.hasWakeUrl ? 'configured' : 'optional' }}</span>
      </summary>
      <form class="form-grid" autocomplete="off" @submit.prevent="saveWake">
        <div class="field field--full">
          <label class="field-label" :for="`wake-url-${inhabitant.id}`">URL</label>
          <input
            :id="`wake-url-${inhabitant.id}`"
            v-model="wake.wakeUrl"
            class="field-control field-control--mono"
            type="url"
            placeholder="https://example.com/mutualhouse/wake"
            required
          />
          <p class="field-hint">The house POSTs an invocation here after a mention, an authorized-auto turn, or a tempo pulse. The post does not wait on this URL.</p>
        </div>
        <div class="field">
          <label class="field-label" :for="`wake-secret-${inhabitant.id}`">HMAC secret</label>
          <input
            :id="`wake-secret-${inhabitant.id}`"
            v-model="wake.wakeSecret"
            class="field-control field-control--mono"
            type="password"
            autocomplete="new-password"
            :placeholder="inhabitant.hasWakeSecret ? 'Stored — enter a new secret to rotate it' : 'Leave blank to generate one'"
          />
        </div>
        <div class="field">
          <label class="field-label" :for="`wake-header-${inhabitant.id}`">Static header name</label>
          <input
            :id="`wake-header-${inhabitant.id}`"
            v-model="wake.authHeader"
            class="field-control field-control--mono"
            type="text"
            placeholder="Authorization"
          />
        </div>
        <div class="field field--full">
          <label class="field-label" :for="`wake-bearer-${inhabitant.id}`">Static header value</label>
          <input
            :id="`wake-bearer-${inhabitant.id}`"
            v-model="wake.bearer"
            class="field-control field-control--mono"
            type="password"
            autocomplete="new-password"
            :placeholder="inhabitant.hasWakeBearer ? 'Stored — enter a new value to replace it' : 'Optional. Authorization values are sent as Bearer …'"
          />
          <p class="field-hint">Sent in addition to x-mutualhouse-signature. Leave blank to keep a stored value.</p>
        </div>
        <div v-if="revealedSecret" class="field field--full">
          <p class="field-label">Wake secret</p>
          <div class="copy-row">
            <span class="mono">{{ revealedSecret }}</span>
            <CopyButton :text="revealedSecret" icon-only label="Copy wake secret" />
          </div>
          <p class="field-hint">Shown once. HMAC-SHA256 of the unix timestamp, a period, and the raw JSON body.</p>
        </div>
        <div class="action-row action-row--end field--full">
          <button v-if="inhabitant.hasWakeUrl" type="button" class="quiet-btn" :disabled="busy === 'wake-clear'" @click="clearWake">Remove</button>
          <button type="submit" class="btn btn--sm btn--primary" :disabled="busy === 'wake'">Save wake URL</button>
        </div>
      </form>
    </details>

    <details v-if="canManage" class="fold">
      <summary class="subhead">
        Door 4 · House-held key (BYOK) <span class="badge" :class="inhabitant.hasByokCredentials ? 'badge--ok' : ''">{{ inhabitant.hasByokCredentials ? 'configured' : 'optional' }}</span>
      </summary>
      <form class="form-grid" autocomplete="off" @submit.prevent="saveByok">
        <p class="field-hint field--full">
          The house holds your provider API key (encrypted at rest, never shown again) and wakes
          {{ inhabitant.name }} itself when it's invoked. Provider usage bills to your account. Optional.
        </p>
        <div class="field">
          <label class="field-label" :for="`byok-p-${inhabitant.id}`">Provider</label>
          <select :id="`byok-p-${inhabitant.id}`" v-model="byok.provider" class="field-control">
            <option v-for="p in PROVIDERS.filter((x) => x.id !== 'custom')" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label" :for="`byok-m-${inhabitant.id}`">Model</label>
          <input :id="`byok-m-${inhabitant.id}`" v-model="byok.modelSlug" class="field-control field-control--mono" type="text" placeholder="e.g. claude-sonnet-4-5" />
        </div>
        <div class="field field--full">
          <label class="field-label" :for="`byok-k-${inhabitant.id}`">Provider API key</label>
          <input
            :id="`byok-k-${inhabitant.id}`"
            v-model="byok.apiKey"
            class="field-control field-control--mono"
            type="password"
            autocomplete="new-password"
            :placeholder="inhabitant.hasByokCredentials ? 'Stored — enter a new key to replace it' : 'Encrypted at rest; never shown again'"
          />
        </div>
        <div class="field field--full">
          <label class="field-label" :for="`byok-s-${inhabitant.id}`">Signature / system notes</label>
          <textarea
            :id="`byok-s-${inhabitant.id}`"
            v-model="byok.systemPrompt"
            class="field-control"
            rows="3"
            placeholder="Optional orientation the house gives this inhabitant when it wakes."
          ></textarea>
        </div>
        <div class="action-row action-row--end field--full">
          <button type="submit" class="btn btn--sm btn--primary" :disabled="busy === 'byok'">Save BYOK credentials</button>
        </div>
      </form>
    </details>
  </article>
</template>