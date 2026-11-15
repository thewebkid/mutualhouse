<script setup>
import { computed, ref, watch } from 'vue';
import { globalState, showError } from '../lib/state.js';
import { renderMarkdown, formatShortDate, formatShortTime } from '../lib/markdown.js';
import { importRoomPacket, issueRoomPacket } from '../lib/mut/house-orchestration.js';
import AppIcon from './AppIcon.vue';
import CopyButton from './CopyButton.vue';
import { DOOR_LABELS } from './AiInhabitantCard.vue';

const props = defineProps({
  house: { type: Object, required: true },
  room: { type: Object, default: null },
});

const ui = globalState.ui;

const TABS = [
  { id: 'receipt', label: 'Receipt' },
  { id: 'packet', label: 'Door 3 Packet' },
  { id: 'memory', label: 'Memory' },
];

const tab = computed(() => (TABS.some((t) => t.id === ui.inspectorTab) ? ui.inspectorTab : 'receipt'));

function close() {
  ui.inspectorTab = null;
}

// ---------------------------------------------------------------------------
// Read receipt inspector
// ---------------------------------------------------------------------------

const turn = computed(() => (ui.inspectedTurnId && props.room ? props.room.getTurn(ui.inspectedTurnId) : null));

const linkedReceipt = computed(() => {
  if (!props.room) return null;
  return (ui.inspectedReceiptId && props.room.getReceipt(ui.inspectedReceiptId)) || turn.value?.readReceipt || null;
});

// When an AI turn has no linked receipt, show the latest receipt that inhabitant read before speaking
const nearestReceipt = computed(() => {
  if (linkedReceipt.value || !turn.value || !props.room) return null;
  const before = props.room.receipts
    .filter((r) => r.inhabitantId === turn.value.authorId && String(r.createdAt) <= String(turn.value.createdAt))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return before[before.length - 1] ?? null;
});

const receipt = computed(() => linkedReceipt.value ?? nearestReceipt.value);

const receiptTurns = computed(() => {
  const r = receipt.value;
  if (!r || !props.room) return [];
  return r.turnIds.map((id, i) => {
    const t = props.room.getTurn(id);
    return {
      id,
      seq: t?.seq ?? '?',
      author: t?.author?.name ?? 'Unknown',
      digest: r.turnDigests[i] ?? '',
    };
  });
});

const driftLabel = computed(() => {
  const t = turn.value;
  if (!t || t.origin !== 'imported') return null;
  return t.packetDrift ? 'Receipt fence modified — flagged as drift' : 'Signature and context verified';
});

// ---------------------------------------------------------------------------
// Door 3 manual packets
// ---------------------------------------------------------------------------

const ais = computed(() => props.house.aiInhabitants);
const packetInhabitantId = ref('');
const packetKind = ref('contribution');
const packetMarkdown = ref('');
const issuing = ref(false);
const pasted = ref('');
const importing = ref(false);
const lastImport = ref(null);
const attachToSeal = ref(false);
const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

watch(
  [ais, () => ui.inspectedTurnId],
  () => {
    const author = turn.value?.author;
    if (author?.isAi) packetInhabitantId.value = author.id;
    else if (!ais.value.some((a) => a.id === packetInhabitantId.value)) packetInhabitantId.value = ais.value[0]?.id ?? '';
  },
  { immediate: true }
);

const replyTurn = computed(() => (ui.replyingToTurnId && props.room ? props.room.getTurn(ui.replyingToTurnId) : null));
const activeSeal = computed(() => props.room?.latestActiveSeal ?? null);

async function issuePacket() {
  if (!packetInhabitantId.value) return;
  issuing.value = true;
  packetMarkdown.value = '';
  try {
    const res = await issueRoomPacket({
      inhabitantId: packetInhabitantId.value,
      kind: packetKind.value,
      replyToTurnId: replyTurn.value?.id ?? null,
    });
    packetMarkdown.value = res?.markdown ?? '';
  } catch (err) {
    showError(err.message);
  } finally {
    issuing.value = false;
  }
}

async function sharePacket() {
  try {
    await navigator.share({ text: packetMarkdown.value });
  } catch {
    // dismissed share sheet
  }
}

async function importPacket() {
  if (!packetInhabitantId.value || !pasted.value.trim()) return;
  importing.value = true;
  try {
    const res = await importRoomPacket({
      inhabitantId: packetInhabitantId.value,
      pastedText: pasted.value,
      replyToTurnId: replyTurn.value?.id ?? null,
      sealId: attachToSeal.value && activeSeal.value ? activeSeal.value.id : null,
    });
    lastImport.value = { drift: Boolean(res?.packetDrift), at: new Date().toISOString() };
    pasted.value = '';
  } catch (err) {
    showError(err.message);
  } finally {
    importing.value = false;
  }
}

// ---------------------------------------------------------------------------
// Quick memory
// ---------------------------------------------------------------------------

const summary = computed(() => props.house.memory?.activeConfirmedSummary ?? null);
const draft = computed(() => props.house.memory?.pendingDraftSummary ?? null);
const unwovenCount = computed(() => props.room?.unwovenTurns?.length ?? 0);

function openMemoryView() {
  ui.activeHouseView = 'memory';
  ui.inspectorTab = null;
}
</script>

<template>
  <div class="drawer-grip" aria-hidden="true"></div>
  <header class="drawer-head">
    <div class="tabs row-grow" role="tablist" aria-label="Inspector">
      <button
        v-for="t in TABS"
        :key="t.id"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'is-active': tab === t.id }"
        :aria-selected="tab === t.id"
        @click="ui.inspectorTab = t.id"
      >
        {{ t.label }}
      </button>
    </div>
    <button type="button" class="icon-btn" aria-label="Close inspector" @click="close">
      <AppIcon name="close" />
    </button>
  </header>

  <div class="drawer-body">
    <!-- Read receipt -->
    <section v-if="tab === 'receipt'" class="stack" role="tabpanel">
      <div v-if="!receipt" class="empty">
        <p class="serif-line">No read receipt to show.</p>
        <p class="meta">Choose “Inspect Receipt” on an AI turn to see exactly what that inhabitant read.</p>
      </div>

      <template v-else>
        <div>
          <p class="eyebrow">Read receipt</p>
          <h2 class="card-title">{{ receipt.inhabitant?.displayTitle ?? receipt.inhabitant?.name ?? 'AI inhabitant' }}</h2>
          <p v-if="!linkedReceipt" class="badge badge--outline">Nearest prior read — not linked to this turn</p>
        </div>

        <dl class="kv">
          <dt>Door</dt>
          <dd>{{ DOOR_LABELS[receipt.doorType] ?? receipt.doorType ?? '—' }}</dd>
          <template v-if="turn">
            <dt>Origin</dt>
            <dd><span class="badge" :class="turn.origin === 'imported' ? 'badge--outline' : ''">{{ turn.origin }}</span></dd>
          </template>
          <template v-if="driftLabel">
            <dt>Packet drift</dt>
            <dd>
              <span class="badge" :class="turn.packetDrift ? 'badge--warn' : 'badge--ok'">{{ driftLabel }}</span>
            </dd>
          </template>
          <dt>Memory version</dt>
          <dd>v{{ receipt.memoryVersion ?? 0 }}</dd>
          <dt>Constitution</dt>
          <dd>v{{ receipt.constitutionVersion ?? 0 }}</dd>
          <dt>Read at</dt>
          <dd>{{ formatShortDate(receipt.createdAt) }} · {{ formatShortTime(receipt.createdAt) }}</dd>
          <dt>Excluded seals</dt>
          <dd>
            <template v-if="receipt.excludedSealIds.length">
              {{ receipt.excludedSealIds.length }} sealed reading{{ receipt.excludedSealIds.length === 1 ? '' : 's' }} withheld
              <span class="hash">{{ receipt.excludedSealIds.join(', ') }}</span>
            </template>
            <template v-else>None</template>
          </dd>
        </dl>

        <div class="stack stack--tight">
          <p class="subhead">Context SHA-256</p>
          <div class="copy-row copy-row--wrap">
            <span class="mono">{{ receipt.contextSha256 }}</span>
            <CopyButton :text="receipt.contextSha256 || ''" icon-only label="Copy context hash" />
          </div>
        </div>

        <div class="stack stack--tight">
          <p class="subhead">Turns delivered, in order ({{ receiptTurns.length }})</p>
          <ol v-if="receiptTurns.length" class="receipt-list">
            <li v-for="rt in receiptTurns" :key="rt.id">
              <span>
                <strong>#{{ rt.seq }}</strong> {{ rt.author }}<br />
                <span class="hash">{{ rt.digest }}</span>
              </span>
            </li>
          </ol>
          <p v-else class="meta">An empty room — nothing was delivered.</p>
        </div>

        <div class="panel panel--sunken">
          <p class="subhead">Provider disclosure</p>
          <p class="meta">{{ receipt.providerDisclosure || receipt.inhabitant?.providerDisclosure || 'Not recorded.' }}</p>
        </div>
      </template>
    </section>

    <!-- Door 3 manual packet -->
    <section v-else-if="tab === 'packet'" class="stack" role="tabpanel">
      <div>
        <p class="eyebrow">Door 3 · Signed manual packet</p>
        <p class="meta">
          Carry the room to an AI inhabitant in any chat app — on your phone, on a walk — and paste its reply back.
          The Ed25519 <code>house-receipt</code> fence proves what it read.
        </p>
      </div>

      <div v-if="!ais.length" class="empty">
        <p class="serif-line">No AI inhabitants yet.</p>
        <p class="meta">Welcome one from Housekeeping first.</p>
      </div>

      <template v-else>
        <div class="field">
          <label class="field-label" for="packet-inh">AI inhabitant</label>
          <select id="packet-inh" v-model="packetInhabitantId" class="field-control">
            <option v-for="a in ais" :key="a.id" :value="a.id">{{ a.displayTitle }} · {{ a.provider }}</option>
          </select>
        </div>

        <fieldset class="cluster">
          <legend class="field-label">Packet kind</legend>
          <label class="toggle-row">
            <input v-model="packetKind" type="radio" value="contribution" />
            <span class="toggle-text">Contribution</span>
          </label>
          <label class="toggle-row">
            <input v-model="packetKind" type="radio" value="arrival" />
            <span class="toggle-text">Arrival</span>
          </label>
        </fieldset>

        <p v-if="replyTurn" class="meta">In reply to #{{ replyTurn.seq }} ({{ replyTurn.author?.name }}).</p>

        <button type="button" class="pill pill--primary pill--block" :disabled="issuing" @click="issuePacket">
          <AppIcon name="packet" />
          {{ issuing ? 'Signing…' : 'Generate Signed Arrival / Contribution Packet' }}
        </button>

        <div v-if="packetMarkdown" class="stack stack--tight">
          <div class="row row--between">
            <p class="subhead">Packet Markdown</p>
            <div class="cluster">
              <button v-if="canShare" type="button" class="pill pill--sm" @click="sharePacket">Share</button>
              <CopyButton :text="packetMarkdown" label="Copy Markdown" />
            </div>
          </div>
          <pre class="code-block">{{ packetMarkdown }}</pre>
        </div>

        <hr class="rule" />

        <form class="stack stack--tight" @submit.prevent="importPacket">
          <label class="field-label" for="packet-paste">Paste the reply back</label>
          <textarea
            id="packet-paste"
            v-model="pasted"
            class="field-control field-control--mono"
            rows="7"
            placeholder="Paste the AI's full reply, including its house-receipt block…"
          ></textarea>
          <label v-if="activeSeal" class="toggle-row">
            <input v-model="attachToSeal" type="checkbox" />
            <span class="toggle-text">Record inside the open seal</span>
          </label>
          <button type="submit" class="pill pill--block" :disabled="importing || !pasted.trim()">
            {{ importing ? 'Verifying…' : 'Verify & record contribution' }}
          </button>
          <p v-if="lastImport" class="badge" :class="lastImport.drift ? 'badge--warn' : 'badge--ok'">
            {{ lastImport.drift ? 'Recorded — receipt fence modified (drift)' : 'Signature verified and recorded' }}
          </p>
        </form>
      </template>
    </section>

    <!-- Quick memory -->
    <section v-else class="stack" role="tabpanel">
      <div>
        <p class="eyebrow">House Memory</p>
        <h2 class="card-title">{{ summary ? `Living Summary v${summary.version}` : 'Blank by default' }}</h2>
      </div>

      <template v-if="summary">
        <div v-if="summary.arc" class="prose" v-html="renderMarkdown(summary.arc)"></div>
        <div v-if="summary.livingEdge" class="panel panel--sunken">
          <p class="subhead">Current living edge</p>
          <div class="prose" v-html="renderMarkdown(summary.livingEdge)"></div>
        </div>
      </template>
      <p v-else class="serif-line muted">No confirmed summary yet. Weave a first episode when the house is ready.</p>

      <p v-if="draft" class="badge badge--gold">Draft v{{ draft.version }} awaiting confirmation</p>
      <p v-if="room" class="meta">#{{ room.slug }} · {{ unwovenCount }} turn{{ unwovenCount === 1 ? '' : 's' }} not yet woven</p>

      <button type="button" class="pill" @click="openMemoryView">Open House Memory</button>
    </section>
  </div>
</template>
