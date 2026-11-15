<script setup>
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { slugify } from '@shared/lib/model-util.js';
import { globalState, toggleTheme } from '../lib/state.js';
import { createRoomInHouse } from '../lib/mut/house-orchestration.js';
import AppIcon from './AppIcon.vue';
import InhabitantMark from './InhabitantMark.vue';

const props = defineProps({
  house: { type: Object, required: true },
});

const router = useRouter();
const ui = globalState.ui;

const VIEWS = [
  { id: 'room', label: 'Rooms', icon: 'home' },
  { id: 'memory', label: 'House Memory', icon: 'memory' },
  { id: 'constitution', label: 'Constitution', icon: 'scroll' },
  { id: 'housekeeping', label: 'Housekeeping', icon: 'sliders' },
];

const viewer = computed(() => props.house.viewer);
const rooms = computed(() => props.house.activeRooms);
const ais = computed(() => props.house.aiInhabitants);
// Alphabetical, so no one is listed first for standing
const inhabitants = computed(() =>
  [...props.house.inhabitants].sort((a, b) => a.name.localeCompare(b.name))
);
const otherHouses = computed(() => globalState.myHouses.filter((h) => h.slug !== props.house.slug));
const isDark = computed(() => ui.theme === 'dark');

const showNewRoom = ref(false);
const newRoomName = ref('');
const newRoomKind = ref('project');
const creating = ref(false);

function setView(id) {
  ui.activeHouseView = id;
  ui.mobileNavOpen = false;
}

function openRoom(r) {
  ui.mobileNavOpen = false;
  if (r.slug === globalState.activeRoomSlug && ui.activeHouseView !== 'room') {
    ui.activeHouseView = 'room';
  }
  router.push({ name: 'house-shell', params: { slug: props.house.slug, roomSlug: r.slug } });
}

function switchHouse(ev) {
  const slug = ev.target.value;
  if (slug) router.push({ name: 'house-shell', params: { slug } });
}

async function createRoom() {
  const name = newRoomName.value.trim();
  if (!name) return;
  creating.value = true;
  try {
    const added = await createRoomInHouse({ name, slug: slugify(name), kind: newRoomKind.value });
    newRoomName.value = '';
    showNewRoom.value = false;
    if (added) {
      router.replace({ name: 'house-shell', params: { slug: props.house.slug, roomSlug: added.slug } });
    }
  } catch (err) {
    globalState.errorBanner = err.message;
  } finally {
    creating.value = false;
  }
}

function presenceClass(inh) {
  if (inh.presence === 'participating') return 'presence-dot--participating';
  if (inh.presence === 'connected') return 'presence-dot--connected';
  return '';
}

function pad(n) {
  return String(n ?? 1).padStart(3, '0');
}

function inhabitantKind(inh) {
  if (inh.isAi) return `AI · ${inh.provider}`;
  return inh.roleLabel || 'human';
}

// Arrival numbers are provenance: they live in the tooltip, not the name
function inhabitantTitle(inh) {
  return inh.isAi ? `${inh.presenceLabel} · arrival ${pad(inh.arrivalNumber)}` : inh.presenceLabel;
}
</script>

<template>
  <div class="rail-head">
    <div class="row row--between">
      <RouterLink to="/houses" class="back-link"><AppIcon name="chevron-left" /> All houses</RouterLink>
      <button type="button" class="icon-btn only-phone" aria-label="Close navigation" @click="ui.mobileNavOpen = false">
        <AppIcon name="close" />
      </button>
    </div>
    <h2 class="rail-title">
      {{ house.name }}
      <span v-if="house.coordinates" class="badge badge--accent">{{ house.coordinates }}</span>
    </h2>
    <label v-if="otherHouses.length" class="field">
      <span class="visually-hidden">Switch house</span>
      <select class="field-control field-control--sm" :value="''" @change="switchHouse">
        <option value="" disabled>Switch house…</option>
        <option v-for="h in otherHouses" :key="h.slug" :value="h.slug">{{ h.name }}</option>
      </select>
    </label>
  </div>

  <nav class="rail-section" aria-label="House views">
    <button
      v-for="v in VIEWS"
      :key="v.id"
      type="button"
      class="rail-item"
      :class="{ 'is-active': ui.activeHouseView === v.id }"
      :aria-current="ui.activeHouseView === v.id ? 'page' : undefined"
      @click="setView(v.id)"
    >
      <AppIcon :name="v.icon" />
      <span class="rail-item-text"><span>{{ v.label }}</span></span>
    </button>
  </nav>

  <section class="rail-section" aria-labelledby="rail-rooms">
    <h3 id="rail-rooms" class="rail-label">
      Rooms
      <button
        type="button"
        class="quiet-btn"
        :aria-expanded="showNewRoom"
        @click="showNewRoom = !showNewRoom"
      >
        <AppIcon name="plus" /> New room
      </button>
    </h3>

    <form v-if="showNewRoom" class="stack stack--tight rail-form" @submit.prevent="createRoom">
      <input
        v-model="newRoomName"
        class="field-control field-control--sm"
        type="text"
        placeholder="Room name, e.g. Walks"
        aria-label="New room name"
        required
      />
      <div class="row">
        <select v-model="newRoomKind" class="field-control field-control--sm row-grow" aria-label="Room kind">
          <option value="project">Project</option>
          <option value="council">Council / Reflection</option>
          <option value="private">Private</option>
          <option value="common">Common</option>
        </select>
        <button type="submit" class="btn btn--sm btn--primary" :disabled="creating || !newRoomName.trim()">
          {{ creating ? '…' : 'Create' }}
        </button>
      </div>
    </form>

    <button
      v-for="r in rooms"
      :key="r.id"
      type="button"
      class="rail-item"
      :class="{ 'is-active': ui.activeHouseView === 'room' && globalState.activeRoomSlug === r.slug }"
      @click="openRoom(r)"
    >
      <span class="rail-item-text">
        <span><span class="rail-hash">#</span>{{ r.slug }}</span>
        <small v-if="r.kind !== 'common' || r.paused">
          {{ r.kind }}<template v-if="r.paused"> · paused</template>
        </small>
      </span>
    </button>
  </section>

  <!-- One list, alphabetical: kind is told by the shape of the mark, never by grouping -->
  <section class="rail-section" aria-labelledby="rail-inhabitants">
    <h3 id="rail-inhabitants" class="rail-label">Inhabitants</h3>
    <ul class="list-plain">
      <li v-for="i in inhabitants" :key="i.id" class="rail-item" :title="inhabitantTitle(i)">
        <InhabitantMark small :inhabitant="i" />
        <span class="rail-item-text">
          <span>{{ i.name }}<template v-if="viewer?.id === i.id"> (you)</template></span>
          <small>{{ inhabitantKind(i) }}</small>
        </span>
        <span class="presence-dot" :class="presenceClass(i)" :aria-label="i.presenceLabel"></span>
      </li>
    </ul>
    <p v-if="!ais.length" class="meta rail-note">
      No AI inhabitants yet. Welcome one from
      <button type="button" class="quiet-link" @click="setView('housekeeping')">Housekeeping</button>.
    </p>
    <p class="meta rail-note" aria-hidden="true">○ invocable · ◐ connected · ● participating</p>
  </section>

  <div class="rail-foot row row--between">
    <span class="meta">{{ globalState.currentUser?.email }}</span>
    <button
      type="button"
      class="icon-btn"
      :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
      @click="toggleTheme"
    >
      <AppIcon :name="isDark ? 'sun' : 'moon'" />
    </button>
  </div>
</template>

<style lang="scss" scoped>
.rail-form {
  padding: 0 var(--space-2) var(--space-2);
}

.rail-note {
  padding: var(--space-1) var(--space-2);
  margin: 0;
  font-size: 0.8125rem;
}

.rail-head .field {
  margin-top: var(--space-2);
}

.rail-foot .meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
