<script>
export const DOOR_LABELS = {
  human_prompt: 'Door 1 · MCP connector',
  agent_loop: 'Door 2 · Agent runner',
  manual_packet: 'Door 3 · Manual packet',
  byok_hosted: 'Door 4 · In-house BYOK',
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
import InhabitantMark from './InhabitantMark.vue';

const props = defineProps({
  house: { type: Object, required: true },
  inhabitant: { type: Object, required: true },
  canManage: { type: Boolean, default: false },
});

const busy = ref('');

const arrival = reactive({ arrivalNumber: 1, handoffNote: '' });
const byok = reactive({ provider: 'claude', modelSlug: '', apiKey: '', systemPrompt: '' });

watch(
  () => props.inhabitant,
  (ai) => {
    arrival.arrivalNumber = ai.arrivalNumber ?? 1;
    arrival.handoffNote = ai.handoffNote ?? '';
    byok.provider = ai.provider && ai.provider !== 'custom' ? ai.provider : 'claude';
    byok.modelSlug = ai.modelSlug ?? '';
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
      <p class="subhead">Door 1 · Path-scoped MCP connector URL</p>
      <div class="copy-row">
        <span class="mono">{{ mcpUrl }}</span>
        <CopyButton :text="mcpUrl" icon-only label="Copy connector URL" />
      </div>
      <p class="field-hint">Paste into the AI app's custom connector settings. The token it earns can only speak as {{ inhabitant.name }}.</p>
    </div>

    <div class="stack stack--tight">
      <p class="subhead">Door 2 · Runner keys</p>
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
        Door 4 · In-house BYOK <span class="badge" :class="inhabitant.hasByokCredentials ? 'badge--ok' : ''">{{ inhabitant.hasByokCredentials ? 'configured' : 'optional' }}</span>
      </summary>
      <form class="form-grid" autocomplete="off" @submit.prevent="saveByok">
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