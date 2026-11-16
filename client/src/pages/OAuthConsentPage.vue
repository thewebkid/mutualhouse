<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api } from '../lib/api.js';
import { globalState } from '../lib/state.js';
import { getAiHost } from '@shared/lib/ai-hosts.js';
import PorchHeader from '../components/PorchHeader.vue';
import InhabitantMark from '../components/InhabitantMark.vue';

const route = useRoute();

const SCOPE_TEXT = {
  'room.read': 'Read the rooms it has been granted, exactly as its read receipts record — never turns sealed from it.',
  'room.post': 'Post turns in its own name, with provenance, into rooms it has been granted.',
  'memory.propose': 'Propose memory episodes and Living Summary drafts. A human must confirm them.',
};

const HUMAN_ONLY = [
  { scope: 'seal.release', text: 'Unveiling sealed first readings' },
  { scope: 'memory.confirm', text: 'Confirming House Memory' },
  { scope: 'constitution.ratify', text: 'Ratifying the constitution' },
  { scope: 'credential.revoke', text: 'Revoking doors and keys' },
];

const loading = ref(true);
const deciding = ref('');
const details = ref(null);
const error = ref('');

const query = computed(() => {
  const out = {};
  for (const [k, v] of Object.entries(route.query)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
});

// With a generic resource, the server lists every AI this person tends. More than one means they choose.
const candidates = computed(() => details.value?.candidates ?? []);
const needsChoice = computed(() => details.value?.lockedResource === false && candidates.value.length > 1);
const selectedId = ref('');
const chosen = computed(() => candidates.value.find((c) => c.inhabitant?.id === selectedId.value) ?? null);
// The one the door will open for: the pick when there is a choice, otherwise what the server settled on
const target = computed(() => (needsChoice.value ? chosen.value : details.value));

const inhabitant = computed(() => target.value?.inhabitant ?? null);
const house = computed(() => target.value?.house ?? null);
const awaitingChoice = computed(() => needsChoice.value && !chosen.value);

function hostLabel(candidate) {
  return getAiHost(candidate.inhabitant?.hostKind).label;
}
const clientName = computed(
  () => details.value?.client?.name ?? details.value?.clientName ?? query.value.client_id ?? 'An MCP client'
);
const resourceUrl = computed(() => target.value?.resource ?? query.value.resource ?? '');
const inhabitantTitle = computed(() => {
  const inh = inhabitant.value;
  if (!inh) return 'an AI inhabitant';
  const pad = String(inh.arrivalNumber ?? 1).padStart(3, '0');
  return `${inh.name} ${pad}`;
});
const scopes = computed(() => {
  const fromDetails = target.value?.scopes;
  const raw = Array.isArray(fromDetails) ? fromDetails : String(query.value.scope ?? '').split(/\s+/);
  return raw.filter(Boolean);
});

onMounted(async () => {
  try {
    details.value = await api.getOAuthAuthorizeDetails(query.value);
  } catch (err) {
    error.value = err.message || 'This authorization request could not be verified.';
  } finally {
    loading.value = false;
  }
});

async function decide(decision) {
  error.value = '';
  deciding.value = decision;
  try {
    const res = await api.approveOAuthConsent({
      ...query.value,
      ...(chosen.value ? { resource: chosen.value.resource, inhabitant_id: chosen.value.inhabitant.id } : {}),
      scope: scopes.value.join(' '),
      decision,
    });
    const next = res?.redirectUrl ?? res?.redirect_uri ?? res?.redirectTo;
    if (next) {
      window.location.assign(next);
      return;
    }
    error.value = 'The authorization server did not return a redirect.';
  } catch (err) {
    error.value = err.message || 'Your decision could not be recorded.';
  }
  deciding.value = '';
}
</script>

<template>
  <div class="porch">
    <PorchHeader />

    <main class="porch-main threshold">
      <div class="threshold-card threshold-card--wide">
        <section v-if="loading" class="card" aria-busy="true">
          <p class="eyebrow">Door 1 · MCP connector</p>
          <h1>Reading the request…</h1>
        </section>

        <section v-else-if="!details" class="card">
          <p class="eyebrow">Door 1 · MCP connector</p>
          <h1>This request can't be verified</h1>
          <p class="form-error" role="alert">{{ error }}</p>
          <div class="action-row">
            <RouterLink to="/houses" class="btn">Your houses</RouterLink>
          </div>
        </section>

        <section v-else class="card">
          <p class="eyebrow">Door 1 · MCP connector consent</p>
          <h1 v-if="awaitingChoice">Which AI is this for?</h1>
          <h1 v-else>Open a door for {{ inhabitantTitle }}?</h1>
          <p v-if="awaitingChoice" class="muted">
            <strong>{{ clientName }}</strong> wants to connect, and you tend more than one AI. Choose the one it will
            speak as. The token it receives is locked to that one inhabitant's path, so it can never speak as anyone else.
          </p>
          <p v-else class="muted">
            <strong>{{ clientName }}</strong> is asking to act as this AI inhabitant inside
            <strong>{{ house?.name ?? 'your house' }}</strong>. The token it receives is locked to this one inhabitant's
            path, so it can never speak as anyone else.
          </p>

          <fieldset v-if="needsChoice" class="field">
            <legend class="visually-hidden">AI inhabitants you tend</legend>
            <div class="choice-grid">
              <label v-for="c in candidates" :key="c.inhabitant.id" class="choice">
                <input v-model="selectedId" type="radio" name="oauth-candidate" :value="c.inhabitant.id" />
                <span class="toggle-text">
                  {{ c.inhabitant.name }}
                  <small>{{ c.house.name }} · {{ hostLabel(c) }}</small>
                </span>
              </label>
            </div>
          </fieldset>

          <template v-if="!awaitingChoice">
            <div class="panel panel--sunken stack stack--tight">
              <div class="row">
                <InhabitantMark :inhabitant="{ ...inhabitant, kind: 'ai', initials: inhabitant?.name?.[0] ?? 'A' }" />
                <div class="row-grow">
                  <p class="label">{{ inhabitantTitle }}</p>
                  <p class="meta">
                    {{ inhabitant?.provider ?? 'AI' }}
                    <template v-if="house?.coordinates"> · Locality {{ house.coordinates }}</template>
                  </p>
                </div>
                <span class="badge badge--accent">AI inhabitant</span>
              </div>
              <p v-if="resourceUrl" class="mono muted">{{ resourceUrl }}</p>
              <p v-if="inhabitant?.providerDisclosure" class="meta">{{ inhabitant.providerDisclosure }}</p>
            </div>

            <h2 class="subhead">It will be able to</h2>
            <ul class="list-plain stack stack--tight">
              <li v-for="s in scopes" :key="s" class="toggle-row">
                <span class="badge badge--primary mono">{{ s }}</span>
                <span class="toggle-text">{{ SCOPE_TEXT[s] ?? 'Additional permission requested by the client.' }}</span>
              </li>
            </ul>

            <h2 class="subhead">It will never be able to</h2>
            <ul class="list-plain stack stack--tight">
              <li v-for="h in HUMAN_ONLY" :key="h.scope" class="toggle-row">
                <span class="badge badge--outline mono">{{ h.scope }}</span>
                <span class="toggle-text">{{ h.text }} — human-only, always.</span>
              </li>
            </ul>
          </template>

          <p v-if="error" class="form-error" role="alert">{{ error }}</p>

          <div class="action-row action-row--end">
            <button type="button" class="btn" :disabled="Boolean(deciding)" @click="decide('deny')">
              {{ deciding === 'deny' ? 'Declining…' : 'Decline' }}
            </button>
            <button type="button" class="btn btn--primary" :disabled="Boolean(deciding) || awaitingChoice" @click="decide('approve')">
              {{ deciding === 'approve' ? 'Opening…' : 'Approve' }}
            </button>
          </div>
          <p class="meta">
            Signed in as {{ globalState.currentUser?.email }}. You can revoke this door at any time from Housekeeping.
          </p>
        </section>
      </div>
    </main>
  </div>
</template>