<script setup>
import { computed, ref, watch } from 'vue';
import { showError } from '../lib/state.js';
import { renderMarkdown, formatShortDate } from '../lib/markdown.js';
import { proposeHouseConstitution, ratifyHouseConstitution } from '../lib/mut/house-orchestration.js';
import AppIcon from './AppIcon.vue';

const props = defineProps({
  house: { type: Object, required: true },
});

const viewer = computed(() => props.house.viewer);
const active = computed(() => props.house.activeConstitution);
const draft = computed(() => props.house.pendingConstitutionDraft);
const history = computed(() => props.house.constitutions.slice().sort((a, b) => b.version - a.version));
const canRatifyRole = computed(() => Boolean(viewer.value?.isHuman && viewer.value.can('constitution.ratify')));

const tab = ref('current');
const compareMode = ref('changes');
const busy = ref('');

const TABS = computed(() => {
  const list = [{ id: 'current', label: active.value ? `Current · v${active.value.version}` : 'Current' }];
  if (draft.value) list.push({ id: 'draft', label: `Draft · v${draft.value.version}` });
  if (draft.value && active.value) list.push({ id: 'compare', label: 'Compare' });
  list.push({ id: 'propose', label: 'Propose' });
  list.push({ id: 'history', label: 'History' });
  return list;
});

watch(
  () => draft.value?.id,
  (id, prev) => {
    if (id && id !== prev && tab.value === 'current' && !active.value) tab.value = 'draft';
  },
  { immediate: true }
);

const form = ref({ title: '', body: '' });
const preview = ref(false);

function openPropose() {
  const base = draft.value ?? active.value;
  form.value = { title: base?.title ?? 'House Constitution', body: base?.body ?? '' };
  preview.value = false;
  tab.value = 'propose';
}

function namesOf(ids = []) {
  return ids.map((id) => props.house.getInhabitant(id)?.name ?? 'an inhabitant').join(', ');
}

function hasRatified(c) {
  return Boolean(viewer.value && c?.ratifiedByHumanIds.includes(viewer.value.id));
}

async function ratify(c) {
  busy.value = `ratify-${c.id}`;
  try {
    await ratifyHouseConstitution(c.id);
    tab.value = 'current';
  } catch (err) {
    showError(err.message);
  } finally {
    busy.value = '';
  }
}

async function propose() {
  busy.value = 'propose';
  try {
    await proposeHouseConstitution({ title: form.value.title.trim() || 'House Constitution', body: form.value.body });
    tab.value = 'draft';
  } catch (err) {
    showError(err.message);
  } finally {
    busy.value = '';
  }
}

// Line-level LCS diff between the ratified constitution and the pending draft
const diffRows = computed(() => {
  if (!active.value || !draft.value) return [];
  const a = String(active.value.body || '').split(/\r?\n/);
  const b = String(draft.value.body || '').split(/\r?\n/);
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', text: a[i++] });
    } else {
      rows.push({ type: 'add', text: b[j++] });
    }
  }
  while (i < m) rows.push({ type: 'del', text: a[i++] });
  while (j < n) rows.push({ type: 'add', text: b[j++] });
  return rows;
});

const diffStats = computed(() => ({
  added: diffRows.value.filter((r) => r.type === 'add').length,
  removed: diffRows.value.filter((r) => r.type === 'del').length,
}));
</script>

<template>
  <div class="stack stack--loose">
    <header class="view-head">
      <p class="eyebrow">Living constitution</p>
      <h1>{{ active?.title ?? 'House Constitution' }}</h1>
      <p class="meta">
        Ratified by humans, witnessed by AI inhabitants. It governs how this house lives inside — and only this house.
      </p>
    </header>

    <div class="tabs" role="tablist" aria-label="Constitution">
      <button
        v-for="t in TABS"
        :key="t.id"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'is-active': tab === t.id }"
        :aria-selected="tab === t.id"
        @click="t.id === 'propose' ? openPropose() : (tab = t.id)"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- Current -->
    <section v-if="tab === 'current'" class="panel" role="tabpanel">
      <template v-if="active">
        <div class="panel-head">
          <h2>v{{ active.version }}</h2>
          <span class="badge badge--ok">ratified {{ formatShortDate(active.ratifiedAt) }}</span>
        </div>
        <div class="prose" v-html="renderMarkdown(active.body)"></div>
        <hr class="rule" />
        <dl class="kv">
          <dt>Ratified by</dt>
          <dd>{{ namesOf(active.ratifiedByHumanIds) || '—' }}</dd>
          <dt>Witnessed by</dt>
          <dd>{{ namesOf(active.witnessedByAiIds) || 'No AI witnesses yet' }}</dd>
        </dl>
        <div v-if="canRatifyRole && !hasRatified(active)" class="action-row">
          <button type="button" class="btn btn--primary" :disabled="busy === `ratify-${active.id}`" @click="ratify(active)">
            Add my ratification
          </button>
        </div>
      </template>
      <div v-else class="empty">
        <p class="serif-line">Blank by default.</p>
        <p class="meta">The house writes its constitution when it is ready — or never. Nothing is inherited.</p>
        <div class="section-foot">
          <button type="button" class="btn btn--primary" @click="openPropose">Propose a first draft</button>
        </div>
      </div>
    </section>

    <!-- Draft -->
    <section v-else-if="tab === 'draft' && draft" class="panel panel--accent" role="tabpanel">
      <div class="panel-head">
        <h2>{{ draft.title }} · v{{ draft.version }}</h2>
        <span class="badge badge--accent">draft</span>
      </div>
      <p class="meta">
        Proposed by {{ namesOf([draft.proposedByInhabitantId]) }} · {{ formatShortDate(draft.createdAt) }}
        <template v-if="draft.witnessedByAiIds.length"> · witnessed by {{ namesOf(draft.witnessedByAiIds) }}</template>
      </p>
      <div class="prose" v-html="renderMarkdown(draft.body)"></div>
      <div class="action-row">
        <button
          v-if="canRatifyRole"
          type="button"
          class="btn btn--primary"
          :disabled="busy === `ratify-${draft.id}`"
          @click="ratify(draft)"
        >
          {{ busy === `ratify-${draft.id}` ? 'Ratifying…' : 'Ratify Constitution' }}
        </button>
        <button v-if="active" type="button" class="btn" @click="tab = 'compare'">Compare with v{{ active.version }}</button>
        <span v-if="!canRatifyRole" class="meta">Only human inhabitants ratify.</span>
      </div>
    </section>

    <!-- Compare -->
    <section v-else-if="tab === 'compare' && draft && active" class="panel" role="tabpanel">
      <div class="panel-head">
        <h2>v{{ active.version }} → v{{ draft.version }}</h2>
        <div class="tabs" role="group" aria-label="Comparison mode">
          <button type="button" class="tab" :class="{ 'is-active': compareMode === 'changes' }" @click="compareMode = 'changes'">Changes</button>
          <button type="button" class="tab" :class="{ 'is-active': compareMode === 'side' }" @click="compareMode = 'side'">Side by side</button>
        </div>
      </div>

      <template v-if="compareMode === 'changes'">
        <p class="meta">
          <span class="badge badge--ok">+{{ diffStats.added }}</span>
          <span class="badge badge--warn">−{{ diffStats.removed }}</span>
          lines
        </p>
        <div class="diff" role="table" aria-label="Line changes">
          <div v-for="(row, i) in diffRows" :key="i" class="diff-line" :class="`diff-line--${row.type}`" role="row">
            <span class="diff-sign" aria-hidden="true">{{ row.type === 'add' ? '+' : row.type === 'del' ? '−' : '' }}</span>
            <span role="cell">{{ row.text || ' ' }}</span>
          </div>
        </div>
      </template>

      <div v-else class="compare">
        <div class="panel panel--sunken">
          <p class="eyebrow">Ratified · v{{ active.version }}</p>
          <div class="prose" v-html="renderMarkdown(active.body)"></div>
        </div>
        <div class="panel panel--accent">
          <p class="eyebrow">Draft · v{{ draft.version }}</p>
          <div class="prose" v-html="renderMarkdown(draft.body)"></div>
        </div>
      </div>
    </section>

    <!-- Propose -->
    <form v-else-if="tab === 'propose'" class="panel stack" role="tabpanel" @submit.prevent="propose">
      <div class="panel-head">
        <h2>Propose a new version</h2>
        <div class="tabs" role="group" aria-label="Editor mode">
          <button type="button" class="tab" :class="{ 'is-active': !preview }" @click="preview = false">Write</button>
          <button type="button" class="tab" :class="{ 'is-active': preview }" @click="preview = true">Preview</button>
        </div>
      </div>
      <div class="field">
        <label class="field-label" for="const-title">Title</label>
        <input id="const-title" v-model="form.title" class="field-control" type="text" />
      </div>
      <div v-if="!preview" class="field">
        <label class="field-label" for="const-body">Constitution (Markdown)</label>
        <textarea
          id="const-body"
          v-model="form.body"
          class="field-control field-control--serif"
          rows="16"
          placeholder="How this house governs itself: consent, roles as signatures, arrivals and departures, memory, release…"
        ></textarea>
      </div>
      <div v-else class="panel panel--sunken">
        <div v-if="form.body.trim()" class="prose" v-html="renderMarkdown(form.body)"></div>
        <p v-else class="meta">Nothing written yet.</p>
      </div>
      <div class="action-row action-row--end">
        <button type="button" class="quiet-btn" @click="tab = draft ? 'draft' : 'current'">Cancel</button>
        <button type="submit" class="btn btn--primary" :disabled="busy === 'propose' || !form.body.trim()">
          {{ busy === 'propose' ? 'Proposing…' : 'Propose draft' }}
        </button>
      </div>
    </form>

    <!-- History -->
    <section v-else-if="tab === 'history'" class="panel" role="tabpanel">
      <div v-if="!history.length" class="empty">
        <p class="serif-line">No versions yet.</p>
      </div>
      <ol v-else class="list-plain stack">
        <li v-for="c in history" :key="c.id" class="row row--wrap">
          <span class="badge" :class="c.isRatified ? 'badge--ok' : 'badge--accent'">v{{ c.version }} · {{ c.status }}</span>
          <span class="row-grow">
            <strong>{{ c.title }}</strong>
            <span class="meta"> · proposed by {{ namesOf([c.proposedByInhabitantId]) }} · {{ formatShortDate(c.createdAt) }}</span>
          </span>
          <span v-if="c.isRatified" class="meta">
            <AppIcon name="check" /> {{ namesOf(c.ratifiedByHumanIds) }}
          </span>
        </li>
      </ol>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.diff {
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  overflow: auto;
  max-height: 60vh;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  line-height: 1.6;
}

.diff-line {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  padding: 0 var(--space-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.diff-line--add {
  background: var(--success-soft);
}

.diff-line--del {
  background: var(--danger-soft);
  color: var(--text-muted);
  text-decoration: line-through;
  text-decoration-color: var(--danger);
}

.diff-sign {
  color: var(--text-muted);
  user-select: none;
}
</style>
