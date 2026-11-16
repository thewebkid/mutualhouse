<script>
// What the wake section is called for each host. Plain words; the protocol stays underneath.
export function wakeSectionTitle(hostKind) {
  if (hostKind === 'grok_bot') return 'Webhook';
  if (hostKind === 'claude') return 'Routine trigger';
  if (hostKind === 'copilot') return 'HTTP trigger';
  return 'Wake URL';
}

// The hosts that have fields of their own (the rest only have the custom form, or none at all).
export function hostHasWakeFields(hostKind) {
  return ['grok_bot', 'claude', 'copilot'].includes(hostKind);
}
</script>

<script setup>
import { computed, ref, useId } from 'vue';
import { getAiHost, normalizeBearerSecret, wakeHostFor } from '@shared/lib/ai-hosts.js';
import { api } from '../lib/api.js';
import { showError, showNotice } from '../lib/state.js';
import { useWakeDraft } from '../lib/use-wake-draft.js';
import CopyButton from './CopyButton.vue';

// One wake form for every host. `custom` forces the HMAC form (any host may point at its own URL).
const props = defineProps({
  house: { type: Object, required: true },
  inhabitant: { type: Object, required: true },
  custom: { type: Boolean, default: false },
});
const emit = defineEmits(['saved']);

const uid = useId();
const source = computed(() => props.inhabitant);
const { draft, markDirty, saved } = useWakeDraft(source);

const busy = ref(false);
const revealedSecret = ref('');

const host = computed(() => wakeHostFor(props.inhabitant));
const isCustom = computed(() => props.custom || !hostHasWakeFields(host.value.id));
const fields = computed(() => (isCustom.value ? getAiHost('custom') : host.value).webhookFields);
const preset = computed(() => (isCustom.value ? 'custom' : host.value.defaultWakePreset));

const HINTS = {
  grok_bot: {
    wakeUrl: 'The POST to address in the GrokBot webhook window.',
    bearer: 'The key in the GrokBot webhook window. A pasted “Authorization: Bearer …” line is trimmed to the key.',
  },
  claude: {
    wakeUrl: 'The Fire URL from the routine’s API trigger.',
    bearer: 'Shown once by Claude when you create the trigger.',
  },
  copilot: {
    wakeUrl: 'Optional. Only if your Copilot agent exposes an HTTP trigger.',
    bearer: 'Optional. Sent as a Bearer key.',
  },
  custom: {
    wakeUrl:
      'The house POSTs an invocation here after a mention, an authorized-auto turn, or a tempo pulse. The post does not wait on this URL.',
    wakeSecret: 'Leave blank to have one generated.',
    authHeader: 'Sent in addition to x-mutualhouse-signature.',
    bearer: 'Leave blank to keep a stored value. Authorization values are sent as Bearer …',
  },
};

function hint(id) {
  return HINTS[isCustom.value ? 'custom' : host.value.id]?.[id] ?? '';
}

function label(f) {
  return f.label.charAt(0).toUpperCase() + f.label.slice(1);
}

function fieldRequired(f) {
  if (!f.required) return false;
  if (f.id === 'bearer' && props.inhabitant.hasWakeBearer) return false;
  return true;
}

function placeholder(f) {
  if (f.id === 'wakeUrl') return isCustom.value ? 'https://example.com/mutualhouse/wake' : 'https://';
  if (f.id === 'wakeSecret') {
    return props.inhabitant.hasWakeSecret ? 'Stored — enter a new secret to rotate it' : 'Leave blank to generate one';
  }
  if (f.id === 'authHeader') return 'Authorization';
  if (f.id === 'bearer') {
    return props.inhabitant.hasWakeBearer
      ? 'Stored — enter a new value to replace it'
      : f.required
        ? ''
        : 'Optional';
  }
  return '';
}

function buildBody() {
  const url = draft.wakeUrl.trim();
  if (isCustom.value) {
    return {
      wakeUrl: url,
      ...(draft.wakeSecret ? { wakeSecret: draft.wakeSecret } : {}),
      authHeader: draft.authHeader.trim(),
      ...(draft.bearer ? { bearer: draft.bearer } : {}),
      wakePreset: 'custom',
    };
  }
  const key = normalizeBearerSecret(draft.bearer);
  return {
    wakeUrl: url,
    authHeader: 'Authorization',
    ...(key ? { bearer: key } : {}),
    wakePreset: preset.value,
  };
}

async function save() {
  busy.value = true;
  try {
    // An optional trigger left empty means "none": clear what was stored, or do nothing
    if (!draft.wakeUrl.trim() && !isCustom.value && !host.value.webhookFields.find((f) => f.id === 'wakeUrl')?.required) {
      if (props.inhabitant.hasWakeUrl) await clear();
      return;
    }
    const res = await api.saveWakeUrl(props.inhabitant.id, buildBody());
    if (res?.inhabitant) props.house.upsertInhabitant(res.inhabitant);
    // Host presets generate the HMAC on the server. The person never sees it.
    revealedSecret.value = isCustom.value ? res?.wakeSecret || '' : '';
    saved();
    showNotice(revealedSecret.value ? 'Saved. Copy the secret now.' : 'Saved.');
    emit('saved');
  } catch (err) {
    showError(err.message);
  } finally {
    busy.value = false;
  }
}

async function clear() {
  busy.value = true;
  try {
    const res = await api.saveWakeUrl(props.inhabitant.id, { clear: true });
    if (res?.inhabitant) props.house.upsertInhabitant(res.inhabitant);
    draft.wakeUrl = '';
    draft.authHeader = '';
    saved();
    revealedSecret.value = '';
    showNotice('Removed.');
    emit('saved');
  } catch (err) {
    showError(err.message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="form-grid" autocomplete="off" @submit.prevent="save">
    <div v-for="f in fields" :key="f.id" class="field" :class="{ 'field--full': f.id === 'wakeUrl' || f.id === 'bearer' || f.kind === 'readonly' }">
      <label class="field-label" :for="`${uid}-${f.id}`">{{ label(f) }}</label>
      <input
        v-if="f.kind === 'readonly'"
        :id="`${uid}-${f.id}`"
        class="field-control field-control--mono"
        type="text"
        value="Authorization: Bearer …"
        readonly
      />
      <input
        v-else
        :id="`${uid}-${f.id}`"
        v-model="draft[f.id]"
        class="field-control field-control--mono"
        :type="f.kind === 'url' ? 'url' : f.kind === 'secret' ? 'password' : 'text'"
        :autocomplete="f.kind === 'secret' ? 'new-password' : 'off'"
        :placeholder="placeholder(f)"
        :required="fieldRequired(f)"
        @input="markDirty"
      />
      <p v-if="hint(f.id)" class="field-hint">{{ hint(f.id) }}</p>
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
      <button v-if="inhabitant.hasWakeUrl" type="button" class="quiet-btn" :disabled="busy" @click="clear">Clear webhook</button>
      <button type="submit" class="btn btn--sm btn--primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save' }}</button>
    </div>
  </form>
</template>
