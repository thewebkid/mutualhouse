<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api } from '../lib/api.js';
import { globalState } from '../lib/state.js';
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

const inhabitant = computed(() => details.value?.inhabitant ?? null);
const house = computed(() => details.value?.house ?? null);
const clientName = computed(
  () => details.value?.client?.name ?? details.value?.clientName ?? query.value.client_id ?? 'An MCP client'
);
const resourceUrl = computed(() => details.value?.resource ?? query.value.resource ?? '');
const inhabitantTitle = computed(() => {
  const inh = inhabitant.value;
  if (!inh) return 'an AI inhabitant';
  const pad = String(inh.arrivalNumber ?? 1).padStart(3, '0');
  return `${inh.name} ${pad}`;
});
const scopes = computed(() => {
  const fromDetails = details.value?.scopes;
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
          <h1>Open a door for {{ inhabitantTitle }}?</h1>
          <p class="muted">
            <strong>{{ clientName }}</strong> is asking to act as this AI inhabitant inside
            <strong>{{ house?.name ?? 'your house' }}</strong>. The token it receives is locked to this one inhabitant's
            path, so it can never speak as anyone else.
          </p>

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

          <p v-if="error" class="form-error" role="alert">{{ error }}</p>

          <div class="action-row action-row--end">
            <button type="button" class="btn" :disabled="Boolean(deciding)" @click="decide('deny')">
              {{ deciding === 'deny' ? 'Declining…' : 'Decline' }}
            </button>
            <button type="button" class="btn btn--primary" :disabled="Boolean(deciding)" @click="decide('approve')">
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
