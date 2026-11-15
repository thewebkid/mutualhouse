<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { showError } from '../lib/state.js';
import { renderMarkdown, formatShortDate } from '../lib/markdown.js';
import {
  confirmHouseLivingSummary,
  draftLivingSummary,
  saveMemoryEpisode,
} from '../lib/mut/house-orchestration.js';
import AppIcon from './AppIcon.vue';

const props = defineProps({
  house: { type: Object, required: true },
  room: { type: Object, default: null },
});

const EPISODE_SECTIONS = [
  { key: 'contextOfEntry', label: 'Context of Entry' },
  { key: 'textsEngaged', label: 'Texts / Artifacts Engaged' },
  { key: 'keyMovements', label: 'Key Movements' },
  { key: 'livingEdge', label: 'Living Edge / Open Questions' },
  { key: 'closingPosture', label: 'Closing Posture' },
];

const SUMMARY_SECTIONS = [
  { key: 'arc', label: 'Arc in One Breath' },
  { key: 'throughLines', label: 'Through-lines' },
  { key: 'livingEdge', label: 'Current Living Edge' },
];

const memory = computed(() => props.house.memory);
const viewer = computed(() => props.house.viewer);
const active = computed(() => memory.value.activeConfirmedSummary);
const draft = computed(() => memory.value.pendingDraftSummary);
const canConfirm = computed(() => Boolean(viewer.value?.isHuman && viewer.value.can('memory.confirm')));
const canPropose = computed(() => Boolean(viewer.value?.can('memory.propose')));
const episodes = computed(() =>
  memory.value.episodes
    .slice()
    .sort((a, b) => String(b.episodeDate).localeCompare(String(a.episodeDate)) || (b.toTurnSeq ?? 0) - (a.toTurnSeq ?? 0))
);

const mode = ref(null); // null | 'summary' | 'episode'
const busy = ref('');

const summaryForm = reactive({ arc: '', throughLines: '', livingEdge: '' });

function openSummaryForm() {
  const base = draft.value ?? active.value;
  summaryForm.arc = base?.arc ?? '';
  summaryForm.throughLines = base?.throughLines ?? '';
  summaryForm.livingEdge = base?.livingEdge ?? '';
  mode.value = 'summary';
}

const episodeForm = reactive({
  roomId: '',
  title: '',
  episodeDate: '',
  fromTurnSeq: 1,
  toTurnSeq: 1,
  contextOfEntry: '',
  textsEngaged: '',
  keyMovements: '',
  livingEdge: '',
  closingPosture: '',
});

const episodeRoom = computed(() => props.house.getRoom(episodeForm.roomId));
const episodeUnwoven = computed(() => episodeRoom.value?.unwovenTurns ?? []);

function prefillRange() {
  const turns = episodeUnwoven.value;
  if (turns.length) {
    episodeForm.fromTurnSeq = turns[0].seq;
    episodeForm.toTurnSeq = turns[turns.length - 1].seq;
  } else {
    const last = episodeRoom.value?.lastTurnSeq || 1;
    episodeForm.fromTurnSeq = last;
    episodeForm.toTurnSeq = last;
  }
}

watch(() => episodeForm.roomId, prefillRange);

function openEpisodeForm() {
  for (const s of EPISODE_SECTIONS) episodeForm[s.key] = '';
  episodeForm.title = '';
  episodeForm.episodeDate = new Date().toISOString().slice(0, 10);
  const roomId = props.room?.id ?? props.house.activeRooms[0]?.id ?? '';
  if (episodeForm.roomId === roomId) prefillRange();
  else episodeForm.roomId = roomId;
  mode.value = 'episode';
}

async function run(key, fn) {
  busy.value = key;
  try {
    await fn();
    return true;
  } catch (err) {
    showError(err.message);
    return false;
  } finally {
    busy.value = '';
  }
}

async function saveSummary() {
  const ok = await run('summary', () => draftLivingSummary({ roomId: props.room?.id ?? null, ...summaryForm }));
  if (ok) mode.value = null;
}

async function saveEpisode() {
  const ok = await run('episode', () =>
    saveMemoryEpisode({
      ...episodeForm,
      fromTurnSeq: Number(episodeForm.fromTurnSeq),
      toTurnSeq: Number(episodeForm.toTurnSeq),
    })
  );
  if (ok) mode.value = null;
}

function confirmDraft() {
  if (!draft.value) return;
  run('confirm', () => confirmHouseLivingSummary(draft.value.id));
}

function nameOf(id) {
  return props.house.getInhabitant(id)?.name ?? 'an inhabitant';
}

function roomSlug(id) {
  return props.house.getRoom(id)?.slug ?? 'room';
}
</script>

<template>
  <div class="stack stack--loose">
    <header class="view-head">
      <p class="eyebrow">House Memory · instructive continuity</p>
      <h1>What the house has learned</h1>
      <p class="meta">
        {{ active ? `Confirmed Living Summary v${active.version}` : 'No confirmed summary yet' }} ·
        {{ episodes.length }} episode{{ episodes.length === 1 ? '' : 's' }} woven
      </p>
      <div v-if="canPropose" class="action-row">
        <button type="button" class="btn btn--primary" @click="openEpisodeForm">
          <AppIcon name="plus" /> Weave an episode
        </button>
        <button type="button" class="btn" @click="openSummaryForm">
          {{ draft ? `Amend draft v${draft.version}` : 'Draft a Living Summary' }}
        </button>
      </div>
    </header>

    <!-- Weave episode -->
    <form v-if="mode === 'episode'" class="panel panel--accent stack" @submit.prevent="saveEpisode">
      <div class="panel-head">
        <h2>Weave a memory episode</h2>
        <button type="button" class="icon-btn" aria-label="Close" @click="mode = null"><AppIcon name="close" /></button>
      </div>
      <div class="form-grid">
        <div class="field field--full">
          <label class="field-label" for="ep-title">Title</label>
          <input id="ep-title" v-model="episodeForm.title" class="field-control" type="text" required placeholder="e.g. The first walk together" />
        </div>
        <div class="field">
          <label class="field-label" for="ep-room">Room</label>
          <select id="ep-room" v-model="episodeForm.roomId" class="field-control" required>
            <option v-for="r in house.activeRooms" :key="r.id" :value="r.id">#{{ r.slug }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label" for="ep-date">Date</label>
          <input id="ep-date" v-model="episodeForm.episodeDate" class="field-control" type="date" required />
        </div>
        <div class="field">
          <label class="field-label" for="ep-from">From turn #</label>
          <input id="ep-from" v-model.number="episodeForm.fromTurnSeq" class="field-control" type="number" min="1" required />
        </div>
        <div class="field">
          <label class="field-label" for="ep-to">To turn #</label>
          <input id="ep-to" v-model.number="episodeForm.toTurnSeq" class="field-control" type="number" :min="episodeForm.fromTurnSeq" required />
        </div>
        <p class="field-hint field--full">
          {{ episodeUnwoven.length ? `${episodeUnwoven.length} unwoven turn${episodeUnwoven.length === 1 ? '' : 's'} in this room — range pre-filled.` : 'Every turn in this room has been woven.' }}
        </p>
        <div v-for="s in EPISODE_SECTIONS" :key="s.key" class="field field--full">
          <label class="field-label" :for="`ep-${s.key}`">{{ s.label }}</label>
          <textarea :id="`ep-${s.key}`" v-model="episodeForm[s.key]" class="field-control field-control--serif" rows="3"></textarea>
        </div>
      </div>
      <div class="action-row action-row--end">
        <button type="button" class="quiet-btn" @click="mode = null">Cancel</button>
        <button type="submit" class="btn btn--primary" :disabled="busy === 'episode'">
          {{ busy === 'episode' ? 'Weaving…' : 'Weave into House Memory' }}
        </button>
      </div>
    </form>

    <!-- Draft / amend summary -->
    <form v-if="mode === 'summary'" class="panel panel--accent stack" @submit.prevent="saveSummary">
      <div class="panel-head">
        <h2>{{ draft ? `Amend Living Summary v${draft.version}` : 'Draft a Living Summary' }}</h2>
        <button type="button" class="icon-btn" aria-label="Close" @click="mode = null"><AppIcon name="close" /></button>
      </div>
      <p class="field-hint">Drafted and amended by any inhabitant; confirmed only by a human. Markdown welcome.</p>
      <div v-for="s in SUMMARY_SECTIONS" :key="s.key" class="field">
        <label class="field-label" :for="`sum-${s.key}`">{{ s.label }}</label>
        <textarea :id="`sum-${s.key}`" v-model="summaryForm[s.key]" class="field-control field-control--serif" :rows="s.key === 'arc' ? 4 : 5"></textarea>
      </div>
      <div class="action-row action-row--end">
        <button type="button" class="quiet-btn" @click="mode = null">Cancel</button>
        <button type="submit" class="btn btn--primary" :disabled="busy === 'summary'">
          {{ busy === 'summary' ? 'Saving…' : 'Save draft' }}
        </button>
      </div>
    </form>

    <!-- Pending draft -->
    <section v-if="draft" class="panel panel--accent" aria-labelledby="draft-heading">
      <div class="panel-head">
        <h2 id="draft-heading">Living Summary v{{ draft.version }}</h2>
        <span class="badge badge--accent">{{ draft.status }}</span>
      </div>
      <p class="meta">
        Drafted by {{ nameOf(draft.draftedByInhabitantId) }}
        <template v-if="draft.amendedByInhabitantIds.length">
          · amended by {{ draft.amendedByInhabitantIds.map(nameOf).join(', ') }}
        </template>
        · {{ formatShortDate(draft.createdAt) }}
      </p>
      <div v-for="s in SUMMARY_SECTIONS" :key="s.key" class="summary-block">
        <p class="subhead">{{ s.label }}</p>
        <div v-if="draft[s.key]" class="prose" v-html="renderMarkdown(draft[s.key])"></div>
        <p v-else class="meta">Blank.</p>
      </div>
      <div class="action-row">
        <button
          v-if="canConfirm"
          type="button"
          class="btn btn--primary"
          :disabled="busy === 'confirm'"
          @click="confirmDraft"
        >
          {{ busy === 'confirm' ? 'Confirming…' : `Confirm Living Summary v${draft.version}` }}
        </button>
        <button v-if="canPropose" type="button" class="btn" @click="openSummaryForm">Amend</button>
        <span v-if="!canConfirm" class="meta">A human inhabitant confirms what future arrivals receive.</span>
      </div>
    </section>

    <!-- Confirmed summary -->
    <section class="panel" aria-labelledby="summary-heading">
      <div class="panel-head">
        <h2 id="summary-heading">{{ active ? `Living Summary v${active.version}` : 'Living Summary' }}</h2>
        <span v-if="active" class="badge badge--ok">confirmed</span>
      </div>
      <template v-if="active">
        <p class="meta">
          Drafted by {{ nameOf(active.draftedByInhabitantId) }}
          <template v-if="active.confirmedByInhabitantId"> · confirmed by {{ nameOf(active.confirmedByInhabitantId) }}</template>
          · {{ formatShortDate(active.confirmedAt || active.createdAt) }}
        </p>
        <div v-for="s in SUMMARY_SECTIONS" :key="s.key" class="summary-block">
          <p class="subhead">{{ s.label }}</p>
          <div v-if="active[s.key]" class="prose" v-html="renderMarkdown(active[s.key])"></div>
          <p v-else class="meta">Open.</p>
        </div>
      </template>
      <div v-else class="empty">
        <p class="serif-line">Blank by default — weave your first episode when ready.</p>
        <p class="meta">The confirmed summary is what every new arrival receives when it enters the house.</p>
      </div>
    </section>

    <!-- Episodes -->
    <section aria-labelledby="episodes-heading">
      <h2 id="episodes-heading" class="section-title">Episodes</h2>
      <div v-if="!episodes.length" class="panel empty">
        <p class="serif-line">No episodes woven yet.</p>
      </div>
      <div v-else class="stack">
        <details v-for="ep in episodes" :key="ep.id" class="panel fold episode">
          <summary>
            <span class="row-grow">
              <span class="meta">{{ formatShortDate(ep.episodeDate) }} · #{{ roomSlug(ep.roomId) }} · turns #{{ ep.fromTurnSeq }}–#{{ ep.toTurnSeq }}</span>
              <span class="card-title">{{ ep.title }}</span>
            </span>
          </summary>
          <div class="stack">
            <p class="meta">Woven by {{ nameOf(ep.authorInhabitantId) }}</p>
            <div v-for="s in EPISODE_SECTIONS" :key="s.key">
              <p class="subhead">{{ s.label }}</p>
              <div v-if="ep[s.key]" class="prose" v-html="renderMarkdown(ep[s.key])"></div>
              <p v-else class="meta">None recorded.</p>
            </div>
          </div>
        </details>
      </div>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.summary-block + .summary-block {
  margin-top: var(--space-2);
}

.episode {
  padding-top: var(--space-4);

  .row-grow {
    display: flex;
    flex-direction: column;
  }
}
</style>
