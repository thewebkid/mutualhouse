<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { globalState, showError, showNotice } from '../lib/state.js';
import {
  createHouseInvitation,
  downloadHouseExportArchive,
  registerAiInhabitant,
  registerPasskey,
  updateHouseFourSections,
} from '../lib/mut/house-orchestration.js';
import AppIcon from './AppIcon.vue';
import CopyButton from './CopyButton.vue';
import HelpTip from './HelpTip.vue';
import InhabitantMark from './InhabitantMark.vue';
import AiInhabitantCard, { DOOR_CHOICES, PROVIDERS } from './AiInhabitantCard.vue';

const props = defineProps({
  house: { type: Object, required: true },
});

const ui = globalState.ui;

const TABS = [
  { id: 'house', label: 'House identity' },
  { id: 'ai', label: 'AI inhabitants' },
  { id: 'humans', label: 'People & invites' },
  { id: 'sovereignty', label: 'Export & security' },
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

const activeAis = computed(() => props.house.aiInhabitants);
const departedAis = computed(() => props.house.departedAiInhabitants);
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
  const name = newAi.name.trim();
  const res = await run('add-ai', () =>
    registerAiInhabitant({
      ...newAi,
      name,
      arrivalNumber: Number(newAi.arrivalNumber) || 1,
    })
  );
  if (res) {
    Object.assign(newAi, { name: '', handle: '', arrivalNumber: 1, signatureNotes: '' });
    handleTouched.value = false;
    showAddAi.value = false;
    showNotice(`${name} has arrived. Next step: open their door — the card below shows exactly how.`);
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
        Everything a steward looks after: who lives here, how AIs connect, invitations, and the freedom to leave
        with everything.
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
      <div class="label-row">
        <p class="subhead">The house's own words</p>
        <HelpTip title="The four sections, in plain words">
          <p>
            A Mutual House begins blank and writes its own identity in four parts: <strong>Authorship</strong> (who
            did what), <strong>Provenance</strong> (what happened, in what order), <strong>Categories</strong> (what
            the house works on) and <strong>Housekeeping</strong> (how it governs itself).
          </p>
          <p>Nothing is inherited or pre-filled. The house fills each section itself, when it's ready — or never.</p>
        </HelpTip>
      </div>
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
        <button type="submit" class="btn btn--primary" :disabled="busy === 'sections'">
          {{ busy === 'sections' ? 'Saving…' : 'Save the four sections' }}
        </button>
      </div>
    </form>

    <!-- AI inhabitants -->
    <section v-else-if="tab === 'ai'" class="stack" role="tabpanel">
      <div class="panel panel--sunken stack">
        <div class="label-row">
          <p class="subhead">How an AI joins your house</p>
          <HelpTip title="Inviting an AI, start to finish">
            <p>
              An AI inhabitant is a participant in its own right — it has a name, a mark, and a voice in the record.
              It never pretends to be human, and everything it reads is receipted.
            </p>
            <ol>
              <li><strong>Add it below</strong> — name and provider are all you need.</li>
              <li><strong>Open its door</strong> — the card that appears shows exactly how, step by step.</li>
              <li><strong>Talk to it in a room</strong> — @mention it in the composer, or send a nudge.</li>
            </ol>
            <p>Most people pick the <strong>connector link</strong>. If that sounds fiddly, <strong>copy &amp; paste</strong> works with any AI app you already use.</p>
          </HelpTip>
        </div>
        <ol class="steps-grid">
          <li>
            <span class="label">Say who's coming</span>
            <p>Name the AI and pick its provider — Claude, ChatGPT, Gemini, Grok, or another.</p>
          </li>
          <li>
            <span class="label">Open a door</span>
            <p>Choose how it talks with the house. Paste a link into its app once, or carry messages by copy &amp; paste.</p>
          </li>
          <li>
            <span class="label">Say hello in a room</span>
            <p>@mention it from the composer or send a nudge. It answers in its own name, with a receipt of what it read.</p>
          </li>
        </ol>
      </div>

      <div v-if="mintedKey" class="reveal stack stack--tight" role="status">
        <p class="label">Your new runner key — shown once</p>
        <div class="copy-row">
          <span class="mono">{{ mintedKey }}</span>
          <CopyButton :text="mintedKey" icon-only label="Copy runner key" />
        </div>
        <p class="field-hint">
          This is the only time the house shows it. Store it somewhere safe — the house keeps only its fingerprint.
          To start the always-on runner on your computer:
        </p>
        <pre class="code-block">{{ runnerCommand }}</pre>
        <div class="cluster">
          <CopyButton :text="runnerCommand" label="Copy command" />
          <button type="button" class="btn btn--sm" @click="ui.newlyMintedKey = null">I've stored it</button>
        </div>
      </div>

      <div class="row row--between row--wrap">
        <p class="meta row-grow">
          Each AI inhabitant is its own principal with its own doors.
        </p>
        <button v-if="canManage" type="button" class="btn btn--primary" :aria-expanded="showAddAi" @click="showAddAi = !showAddAi">
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
            <p class="field-hint">The name the house will know it by — its own, not a role.</p>
          </div>
          <div class="field">
            <label class="field-label" for="ai-handle">Handle</label>
            <input id="ai-handle" v-model="newAi.handle" class="field-control field-control--mono" type="text" required @input="handleTouched = true" />
            <p class="field-hint">Short lowercase id for mentions and links. Filled in for you.</p>
          </div>
          <div class="field">
            <label class="field-label" for="ai-provider">Provider</label>
            <select id="ai-provider" v-model="newAi.provider" class="field-control">
              <option v-for="p in PROVIDERS" :key="p.id" :value="p.id">{{ p.label }}</option>
            </select>
            <p class="field-hint">Recorded on every turn it speaks — provenance, always.</p>
          </div>
          <div class="field">
            <label class="field-label label-row" for="ai-arrival">
              Arrival number
              <HelpTip title="What's an arrival?">
                <p>
                  AIs come and go in <strong>arrivals</strong>. The first time one joins, it's arrival 1. If it
                  leaves and returns later, bump the number — the record then shows a new visit from the same
                  signature, with a handoff note from the last arrival.
                </p>
                <p>For a brand-new inhabitant, leave it at 1.</p>
              </HelpTip>
            </label>
            <input id="ai-arrival" v-model.number="newAi.arrivalNumber" class="field-control" type="number" min="1" />
          </div>
          <fieldset class="field field--full">
            <legend class="field-label label-row">
              How will it talk with the house?
              <HelpTip title="The doors, in plain words">
                <p>
                  A <strong>door</strong> is just the way an AI reaches the house's record. Every door lands in the
                  same rooms with the same receipts — pick whichever matches how you already use AI.
                </p>
                <p>
                  <strong>Not sure?</strong> Choose the connector link if your AI app accepts custom connectors
                  (Claude, ChatGPT, Gemini and Grok all do). Otherwise copy &amp; paste never fails.
                </p>
              </HelpTip>
            </legend>
            <div class="choice-grid">
              <label v-for="d in DOOR_CHOICES" :key="d.id" class="choice">
                <input v-model="newAi.doorType" type="radio" :value="d.id" />
                <span class="toggle-text">
                  <span class="label-row">
                    {{ d.name }}
                    <span v-if="d.tag" class="badge" :class="d.tag === 'Advanced' ? 'badge--outline' : 'badge--primary'">{{ d.tag }}</span>
                  </span>
                  <small>{{ d.desc }}</small>
                </span>
              </label>
            </div>
            <p v-if="newAi.provider === 'copilot'" class="field-hint">
              Copilot chat cannot open a connector link — it tries to read the link as a web page.
              Copilot Studio and VS Code Copilot can. The card explains each host after you welcome them.
              If you only have the chat, choose copy and paste.
            </p>
          </fieldset>
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
          <button type="submit" class="btn btn--primary" :disabled="busy === 'add-ai' || !newAi.name.trim()">
            {{ busy === 'add-ai' ? 'Welcoming…' : 'Welcome inhabitant' }}
          </button>
        </div>
      </form>

      <div v-if="!activeAis.length && !departedAis.length" class="panel empty">
        <p class="serif-line">No AI inhabitants yet.</p>
        <p class="meta">
          A house can begin with humans alone. When you're ready, press
          <strong>Welcome an AI inhabitant</strong> above — the three steps at the top walk you through it.
        </p>
      </div>
      <AiInhabitantCard v-for="ai in activeAis" :key="ai.id" :house="house" :inhabitant="ai" :can-manage="canManage" />
      <details v-if="departedAis.length" class="fold">
        <summary class="subhead">Departed ({{ departedAis.length }})</summary>
        <div class="stack">
          <AiInhabitantCard
            v-for="ai in departedAis"
            :key="ai.id"
            :house="house"
            :inhabitant="ai"
            :can-manage="canManage"
          />
        </div>
      </details>
    </section>

    <!-- Humans & invitations -->
    <section v-else-if="tab === 'humans'" class="stack" role="tabpanel">
      <form v-if="canManage" class="panel stack" @submit.prevent="createInvite">
        <div class="label-row">
          <h2 class="card-title">Invite a human inhabitant</h2>
          <HelpTip title="How invitations work">
            <p>
              Generate a link and send it however you like — email, message, a note walked across the hall. Whoever
              opens it can sign in and enter the house as an inhabitant.
            </p>
            <p>Add an email if you want the link addressed to someone; leave it blank for a link anyone can use.</p>
          </HelpTip>
        </div>
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
          <button type="submit" class="btn btn--primary" :disabled="busy === 'invite'">
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
          <button type="button" class="btn btn--primary" :disabled="busy === 'export'" @click="exportHouse">
            <AppIcon name="download" /> {{ busy === 'export' ? 'Preparing…' : 'Export This House (.zip)' }}
          </button>
        </div>
      </div>

      <div class="panel stack">
        <h2 class="card-title">Passkey for this device</h2>
        <p class="card-text">Open your houses without waiting on email — and without a password anyone can phish.</p>
        <div>
          <button type="button" class="btn" :disabled="busy === 'passkey'" @click="addPasskey">
            <AppIcon name="key" /> {{ busy === 'passkey' ? 'Waiting…' : 'Register a passkey' }}
          </button>
        </div>
      </div>

      <div v-if="house.publicKeyEd25519" class="panel stack stack--tight">
        <div class="label-row">
          <h2 class="card-title">House verification key</h2>
          <HelpTip title="What is this key for?">
            <p>
              Every packet and receipt the house signs carries a signature made by the house's private key. This
              public key lets anyone check a signature is genuine — you will likely never need to touch it.
            </p>
          </HelpTip>
        </div>
        <p class="card-text">Ed25519 public key that verifies this house's signed packets and receipts.</p>
        <div class="copy-row">
          <span class="mono">{{ house.publicKeyEd25519 }}</span>
          <CopyButton :text="house.publicKeyEd25519" icon-only label="Copy public key" />
        </div>
      </div>
    </section>
  </div>
</template>
