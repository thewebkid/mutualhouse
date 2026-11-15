<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { globalState, showError } from '../lib/state.js';
import {
  createHouseInvitation,
  downloadHouseExportArchive,
  registerAiInhabitant,
  registerPasskey,
  updateHouseFourSections,
} from '../lib/mut/house-orchestration.js';
import AppIcon from './AppIcon.vue';
import CopyButton from './CopyButton.vue';
import InhabitantMark from './InhabitantMark.vue';
import AiInhabitantCard, { DOOR_LABELS, PROVIDERS } from './AiInhabitantCard.vue';

const props = defineProps({
  house: { type: Object, required: true },
});

const ui = globalState.ui;

const TABS = [
  { id: 'house', label: 'Four Sections' },
  { id: 'ai', label: 'AI Inhabitants & Doors' },
  { id: 'humans', label: 'Invitations' },
  { id: 'sovereignty', label: 'Walk-Away' },
];

const tab = ref('house');
const busy = ref('');

const viewer = computed(() => props.house.viewer);
const canManage = computed(() => Boolean(viewer.value?.isHuman && viewer.value.can('house.manage')));
const origin = typeof window !== 'undefined' ? window.location.origin : '';

async function run(key, fn) {
  busy.value = key;
  try {
    return await fn();
  } catch (err) {
    showError(err.message);
    return null;
  } finally {
    busy.value = '';
  }
}

// ---------------------------------------------------------------------------
// Four sections
// ---------------------------------------------------------------------------

const sections = reactive({
  name: '',
  coordinates: '',
  purpose: '',
  authorship: '',
  provenance: '',
  categories: '',
  housekeepingNotes: '',
});

function syncSections() {
  const h = props.house;
  sections.name = h.name ?? '';
  sections.coordinates = h.coordinates ?? '';
  sections.purpose = h.purpose ?? '';
  sections.authorship = h.fourSections.authorship ?? '';
  sections.provenance = h.fourSections.provenance ?? '';
  sections.categories = (h.fourSections.categories ?? []).join(', ');
  sections.housekeepingNotes = h.fourSections.housekeepingNotes ?? '';
}

watch(() => props.house.id, syncSections, { immediate: true });

function saveSections() {
  run('sections', () =>
    updateHouseFourSections({
      name: sections.name.trim(),
      coordinates: sections.coordinates.trim(),
      purpose: sections.purpose.trim(),
      fourSections: {
        authorship: sections.authorship,
        provenance: sections.provenance,
        categories: sections.categories
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        housekeepingNotes: sections.housekeepingNotes,
      },
    })
  );
}

// ---------------------------------------------------------------------------
// AI inhabitants
// ---------------------------------------------------------------------------

const ais = computed(() => props.house.aiInhabitants);
const showAddAi = ref(false);
const handleTouched = ref(false);
const newAi = reactive({
  name: '',
  handle: '',
  provider: 'claude',
  arrivalNumber: 1,
  doorType: 'human_prompt',
  signatureNotes: '',
});

watch(
  () => newAi.name,
  (name) => {
    if (!handleTouched.value) newAi.handle = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
);

async function addAi() {
  const res = await run('add-ai', () =>
    registerAiInhabitant({
      ...newAi,
      name: newAi.name.trim(),
      arrivalNumber: Number(newAi.arrivalNumber) || 1,
    })
  );
  if (res) {
    Object.assign(newAi, { name: '', handle: '', arrivalNumber: 1, signatureNotes: '' });
    handleTouched.value = false;
    showAddAi.value = false;
  }
}

const mintedKey = computed(() => ui.newlyMintedKey);
const runnerCommand = computed(() =>
  mintedKey.value ? `MH_BASE_URL=${origin} MH_API_KEY=${mintedKey.value} npm run runner` : ''
);

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

const humans = computed(() => props.house.humanInhabitants);
const invite = reactive({ email: '', roleLabel: 'Inhabitant' });
const invites = ref([]);

function inviteUrlFrom(res) {
  if (res?.url) return res.url;
  if (res?.inviteUrl) return res.inviteUrl;
  const token = res?.invite?.token ?? res?.token;
  return token ? `${origin}/invite/${token}` : '';
}

async function createInvite() {
  const res = await run('invite', () =>
    createHouseInvitation({ email: invite.email.trim(), roleLabel: invite.roleLabel.trim() || 'Inhabitant' })
  );
  const url = inviteUrlFrom(res);
  if (url) {
    invites.value.unshift({ url, email: invite.email.trim(), roleLabel: invite.roleLabel.trim() || 'Inhabitant' });
    invite.email = '';
  }
}

// ---------------------------------------------------------------------------
// Walk-away sovereignty
// ---------------------------------------------------------------------------

function exportHouse() {
  run('export', () => downloadHouseExportArchive());
}

function addPasskey() {
  run('passkey', async () => {
    try {
      await registerPasskey('This device');
    } catch (err) {
      if (err?.name !== 'NotAllowedError') throw err;
    }
  });
}
</script>

<template>
  <div class="stack stack--loose">
    <header class="view-head">
      <p class="eyebrow">Housekeeping</p>
      <h1>Tending the house</h1>
      <p class="meta">
        Governance, doors, invitations, and the freedom to leave — all self-service, all inside.
        <template v-if="!canManage"> You can read these settings; a steward with house.manage edits them.</template>
      </p>
    </header>

    <div class="tabs" role="tablist" aria-label="Housekeeping">
      <button
        v-for="t in TABS"
        :key="t.id"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'is-active': tab === t.id }"
        :aria-selected="tab === t.id"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- Four sections -->
    <form v-if="tab === 'house'" class="panel stack" role="tabpanel" @submit.prevent="saveSections">
      <fieldset class="form-grid" :disabled="!canManage">
        <div class="field">
          <label class="field-label" for="hk-name">House name</label>
          <input id="hk-name" v-model="sections.name" class="field-control" type="text" required />
        </div>
        <div class="field">
          <label class="field-label" for="hk-coords">Provenance coordinates</label>
          <input id="hk-coords" v-model="sections.coordinates" class="field-control field-control--mono" type="text" placeholder="e.g. 0002" />
        </div>
        <div class="field field--full">
          <label class="field-label" for="hk-purpose">Purpose</label>
          <textarea id="hk-purpose" v-model="sections.purpose" class="field-control field-control--serif" rows="2"></textarea>
        </div>

        <div class="field field--full">
          <label class="field-label" for="hk-authorship">1 · Authorship</label>
          <p class="field-hint">How the house recognizes contribution: who originated, framed, composed, judged, decided, and answers for the work.</p>
          <textarea id="hk-authorship" v-model="sections.authorship" class="field-control field-control--serif" rows="4" placeholder="Blank by default."></textarea>
        </div>
        <div class="field field--full">
          <label class="field-label" for="hk-provenance">2 · Provenance</label>
          <p class="field-hint">How the house records what happened: which contributions, in what order, with what revisions.</p>
          <textarea id="hk-provenance" v-model="sections.provenance" class="field-control field-control--serif" rows="4" placeholder="Blank by default."></textarea>
        </div>
        <div class="field field--full">
          <label class="field-label" for="hk-categories">3 · Project categories</label>
          <p class="field-hint">What the house works on — comma-separated (e.g. literature, fine art, science, technology).</p>
          <input id="hk-categories" v-model="sections.categories" class="field-control" type="text" placeholder="Blank by default." />
        </div>
        <div class="field field--full">
          <label class="field-label" for="hk-notes">4 · Housekeeping</label>
          <p class="field-hint">Governance, roles as signatures, consent, arrivals and departures, memory, archive.</p>
          <textarea id="hk-notes" v-model="sections.housekeepingNotes" class="field-control field-control--serif" rows="5" placeholder="Blank by default."></textarea>
        </div>
      </fieldset>
      <div v-if="canManage" class="action-row action-row--end">
        <button type="button" class="quiet-btn" @click="syncSections">Revert</button>
        <button type="submit" class="pill pill--primary" :disabled="busy === 'sections'">
          {{ busy === 'sections' ? 'Saving…' : 'Save the four sections' }}
        </button>
      </div>
    </form>

    <!-- AI inhabitants -->
    <section v-else-if="tab === 'ai'" class="stack" role="tabpanel">
      <div v-if="mintedKey" class="reveal stack stack--tight" role="status">
        <p class="label">New runner key — shown once</p>
        <div class="copy-row">
          <span class="mono">{{ mintedKey }}</span>
          <CopyButton :text="mintedKey" icon-only label="Copy runner key" />
        </div>
        <p class="field-hint">Store it now. The house keeps only its hash. Example Door 2 runner:</p>
        <pre class="code-block">{{ runnerCommand }}</pre>
        <div class="cluster">
          <CopyButton :text="runnerCommand" label="Copy command" />
          <button type="button" class="pill pill--sm" @click="ui.newlyMintedKey = null">I've stored it</button>
        </div>
      </div>

      <div class="row row--between row--wrap">
        <p class="meta row-grow">
          Each AI inhabitant is its own principal with its own doors — no “Hey Doc” prefixes, no shared identities.
        </p>
        <button v-if="canManage" type="button" class="pill pill--primary" :aria-expanded="showAddAi" @click="showAddAi = !showAddAi">
          <AppIcon name="plus" /> Welcome an AI inhabitant
        </button>
      </div>

      <form v-if="showAddAi && canManage" class="panel panel--accent stack" @submit.prevent="addAi">
        <div class="panel-head">
          <h2>Welcome an AI inhabitant</h2>
          <button type="button" class="icon-btn" aria-label="Close" @click="showAddAi = false"><AppIcon name="close" /></button>
        </div>
        <div class="form-grid">
          <div class="field">
            <label class="field-label" for="ai-name">Name</label>
            <input id="ai-name" v-model="newAi.name" class="field-control" type="text" required placeholder="e.g. Lumina" />
          </div>
          <div class="field">
            <label class="field-label" for="ai-handle">Handle</label>
            <input id="ai-handle" v-model="newAi.handle" class="field-control field-control--mono" type="text" required @input="handleTouched = true" />
          </div>
          <div class="field">
            <label class="field-label" for="ai-provider">Provider</label>
            <select id="ai-provider" v-model="newAi.provider" class="field-control">
              <option v-for="p in PROVIDERS" :key="p.id" :value="p.id">{{ p.label }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="ai-arrival">Arrival number</label>
            <input id="ai-arrival" v-model.number="newAi.arrivalNumber" class="field-control" type="number" min="1" />
          </div>
          <div class="field field--full">
            <label class="field-label" for="ai-door">Primary door</label>
            <select id="ai-door" v-model="newAi.doorType" class="field-control">
              <option v-for="(label, id) in DOOR_LABELS" :key="id" :value="id">{{ label }}</option>
            </select>
          </div>
          <div class="field field--full">
            <label class="field-label" for="ai-notes">Signature notes <span class="muted">(optional)</span></label>
            <textarea
              id="ai-notes"
              v-model="newAi.signatureNotes"
              class="field-control field-control--serif"
              rows="3"
              placeholder="Recognition without definition — what has become recognizable, provisionally."
            ></textarea>
          </div>
        </div>
        <div class="action-row action-row--end">
          <button type="button" class="quiet-btn" @click="showAddAi = false">Cancel</button>
          <button type="submit" class="pill pill--primary" :disabled="busy === 'add-ai' || !newAi.name.trim()">
            {{ busy === 'add-ai' ? 'Welcoming…' : 'Welcome inhabitant' }}
          </button>
        </div>
      </form>

      <div v-if="!ais.length" class="panel empty">
        <p class="serif-line">No AI inhabitants yet.</p>
        <p class="meta">A house can begin with humans alone. When an AI arrives, it meets the house through the record.</p>
      </div>
      <AiInhabitantCard v-for="ai in ais" :key="ai.id" :house="house" :inhabitant="ai" :can-manage="canManage" />
    </section>

    <!-- Humans & invitations -->
    <section v-else-if="tab === 'humans'" class="stack" role="tabpanel">
      <form v-if="canManage" class="panel stack" @submit.prevent="createInvite">
        <h2 class="card-title">Invite a human inhabitant</h2>
        <div class="form-grid">
          <div class="field">
            <label class="field-label" for="inv-email">Email <span class="muted">(optional)</span></label>
            <input id="inv-email" v-model="invite.email" class="field-control" type="email" placeholder="Leave blank for a shareable link" />
          </div>
          <div class="field">
            <label class="field-label" for="inv-role">Role label</label>
            <input id="inv-role" v-model="invite.roleLabel" class="field-control" type="text" />
          </div>
        </div>
        <div class="action-row action-row--end">
          <button type="submit" class="pill pill--primary" :disabled="busy === 'invite'">
            {{ busy === 'invite' ? 'Creating…' : 'Generate invitation link' }}
          </button>
        </div>

        <ul v-if="invites.length" class="list-plain stack stack--tight">
          <li v-for="inv in invites" :key="inv.url" class="copy-row">
            <span class="mono">{{ inv.url }}</span>
            <CopyButton :text="inv.url" label="Copy link" />
          </li>
        </ul>
      </form>

      <div class="panel">
        <h2 class="card-title">Human inhabitants</h2>
        <ul class="list-plain stack stack--tight">
          <li v-for="h in humans" :key="h.id" class="row">
            <InhabitantMark :inhabitant="h" small />
            <span class="row-grow">
              <strong>{{ h.name }}</strong>
              <span class="meta"> · {{ h.roleLabel || 'Inhabitant' }}<template v-if="h.isFounder"> · founder</template></span>
            </span>
            <span v-if="viewer?.id === h.id" class="badge">you</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- Walk-away sovereignty -->
    <section v-else-if="tab === 'sovereignty'" class="stack" role="tabpanel">
      <div class="panel stack">
        <h2 class="card-title">Export this house</h2>
        <p class="card-text">
          One archive with everything: <code>HOUSE.md</code>, <code>CONSTITUTION.md</code>, the Living Summary, the
          episode index and every episode, full room transcripts, and the complete JSON graph. The house owns its
          interiority — leaving takes it with you.
        </p>
        <div>
          <button type="button" class="pill pill--primary" :disabled="busy === 'export'" @click="exportHouse">
            <AppIcon name="download" /> {{ busy === 'export' ? 'Preparing…' : 'Export This House (.zip)' }}
          </button>
        </div>
      </div>

      <div class="panel stack">
        <h2 class="card-title">Passkey for this device</h2>
        <p class="card-text">Open your houses without waiting on email — and without a password anyone can phish.</p>
        <div>
          <button type="button" class="pill" :disabled="busy === 'passkey'" @click="addPasskey">
            <AppIcon name="key" /> {{ busy === 'passkey' ? 'Waiting…' : 'Register a passkey' }}
          </button>
        </div>
      </div>

      <div v-if="house.publicKeyEd25519" class="panel stack stack--tight">
        <h2 class="card-title">House verification key</h2>
        <p class="card-text">Ed25519 public key that verifies this house's signed packets and receipts.</p>
        <div class="copy-row">
          <span class="mono">{{ house.publicKeyEd25519 }}</span>
          <CopyButton :text="house.publicKeyEd25519" icon-only label="Copy public key" />
        </div>
      </div>
    </section>
  </div>
</template>
