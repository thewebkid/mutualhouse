<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { slugify } from '@shared/lib/model-util.js';
import { canInviteAi, canManageAi } from '@shared/models/inhabitant.js';
import { globalState, showError, showNotice, toggleTheme } from '../lib/state.js';
import { createRoomInHouse, setInhabitantParticipation } from '../lib/mut/house-orchestration.js';
import AppIcon from './AppIcon.vue';
import HelpTip from './HelpTip.vue';
import InhabitantMark from './InhabitantMark.vue';
import DepartAiModal from './DepartAiModal.vue';
import InhabitantProfileModal from './InhabitantProfileModal.vue';
import WelcomeAiModal from './WelcomeAiModal.vue';

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
  [...props.house.inhabitants]
    .filter((i) => !i.departedAt)
    .sort((a, b) => a.name.localeCompare(b.name))
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

// ---------------------------------------------------------------------------
// Welcoming an AI, profiles, and the per-inhabitant menu
// ---------------------------------------------------------------------------

// Tending one AI is the default allowance; stewards of the house may welcome more
const canAdd = computed(() => canInviteAi(viewer.value, props.house));

const welcomeOpen = ref(false);
const welcomeTarget = ref(null);
const profileOpen = ref(false);
const profileTarget = ref(null);

function openWelcome(existing = null) {
  closeMenu();
  ui.mobileNavOpen = false;
  welcomeTarget.value = existing;
  welcomeOpen.value = true;
}

function openProfile(inh) {
  closeMenu();
  ui.mobileNavOpen = false;
  profileTarget.value = inh;
  profileOpen.value = true;
}

const menu = ref(null); // { inh, x, y }
const menuEl = ref(null);
let menuToken = 0;

const menuActions = computed(() => {
  const inh = menu.value?.inh;
  if (!inh) return [];
  const v = viewer.value;
  const actions = [{ id: 'profile', label: 'View profile' }];
  if (inh.id === v?.id && canAdd.value) actions.push({ id: 'add', label: 'Add AI' });
  if (inh.isAi && canManageAi(v, inh)) {
    if (!inh.participationLocked || v.can('house.manage')) {
      actions.push({
        id: 'participation',
        label: inh.participationMode === 'readonly' ? 'Switch to contribute' : 'Switch to read-only',
      });
    }
    actions.push({ id: 'connection', label: 'Connection & webhook' });
    actions.push({ id: 'remove', label: 'Remove', danger: true });
  }
  actions.push({ id: 'handle', label: 'Copy @handle' });
  return actions;
});

const departOpen = ref(false);
const departTarget = ref(null);

function placeMenu(inh, x, y) {
  closeMenu();
  const token = ++menuToken;
  menu.value = { inh, x, y };
  document.addEventListener('pointerdown', onMenuPointer);
  document.addEventListener('keydown', onMenuKey);
  window.addEventListener('scroll', closeMenu, { capture: true });
  window.addEventListener('resize', closeMenu);
  nextTick(() => {
    const el = menuEl.value;
    if (token !== menuToken || !el || !menu.value) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    if (left !== x || top !== y) menu.value = { inh, x: left, y: top };
    el.querySelector('button')?.focus();
  });
}

function openMenuAt(inh, ev) {
  placeMenu(inh, ev.clientX, ev.clientY);
}

function openMenuFrom(inh, ev) {
  if (menu.value?.inh.id === inh.id) {
    closeMenu();
    return;
  }
  const rect = ev.currentTarget.getBoundingClientRect();
  placeMenu(inh, rect.left, rect.bottom + 4);
}

function closeMenu() {
  menuToken += 1;
  menu.value = null;
  document.removeEventListener('pointerdown', onMenuPointer);
  document.removeEventListener('keydown', onMenuKey);
  window.removeEventListener('scroll', closeMenu, { capture: true });
  window.removeEventListener('resize', closeMenu);
}

function onMenuPointer(ev) {
  if (menuEl.value?.contains(ev.target)) return;
  // The ⋯ button toggles the menu itself
  if (ev.target.closest?.('[data-menu-button]')) return;
  closeMenu();
}

function onMenuKey(ev) {
  if (ev.key === 'Escape') closeMenu();
}

onBeforeUnmount(closeMenu);

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

async function runAction(action) {
  const inh = menu.value?.inh;
  closeMenu();
  if (!inh) return;
  try {
    if (action === 'profile') openProfile(inh);
    else if (action === 'add') openWelcome();
    else if (action === 'connection') openWelcome(inh);
    else if (action === 'remove') {
      departTarget.value = inh;
      departOpen.value = true;
    } else if (action === 'participation') {
      const mode = inh.participationMode === 'readonly' ? 'contribute' : 'readonly';
      await setInhabitantParticipation(inh.id, { mode });
      showNotice(mode === 'readonly' ? `${inh.name} now reads only.` : `${inh.name} can contribute.`);
    } else if (action === 'handle') {
      await copyText(`@${inh.handle}`);
      showNotice(`Copied @${inh.handle}.`);
    }
  } catch (err) {
    showError(err.message);
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
    <h3 id="rail-inhabitants" class="rail-label">
      <span class="label-row">
        Inhabitants
        <HelpTip title="Who's who in this list">
          <p>
            Everyone who lives in the house, in alphabetical order — humans and AIs side by side, no ranking.
            <strong>Round marks are humans; doorway marks are AIs.</strong>
          </p>
          <p>The dot shows how present someone is right now:</p>
          <ul>
            <li><strong>○ Empty</strong> — around; can be called in (@mention or nudge)</li>
            <li><strong>◐ Half</strong> — connected to the house right now</li>
            <li><strong>● Full</strong> — actively participating</li>
          </ul>
        </HelpTip>
      </span>
    </h3>
    <ul class="list-plain">
      <li
        v-for="i in inhabitants"
        :key="i.id"
        class="rail-item"
        :title="inhabitantTitle(i)"
        @contextmenu.prevent="openMenuAt(i, $event)"
      >
        <InhabitantMark small :inhabitant="i" />
        <span class="rail-item-text">
          <span>{{ i.name }}<template v-if="viewer?.id === i.id"> (you)</template></span>
          <small>{{ inhabitantKind(i) }}</small>
        </span>
        <span class="presence-dot" :class="presenceClass(i)" :aria-label="i.presenceLabel"></span>
        <button
          type="button"
          class="icon-btn icon-btn--sm"
          data-menu-button
          aria-haspopup="menu"
          :aria-expanded="menu?.inh.id === i.id"
          :aria-label="`Actions for ${i.name}`"
          @click.stop="openMenuFrom(i, $event)"
        >
          <AppIcon name="more" />
        </button>
      </li>
    </ul>
    <div v-if="!ais.length" class="rail-invite">
      <p>No AI inhabitants yet.</p>
      <button v-if="canAdd" type="button" class="btn btn--sm btn--primary" @click="openWelcome()">
        <AppIcon name="plus" /> Add AI
      </button>
    </div>
    <div v-else-if="canAdd" class="rail-add">
      <button type="button" class="quiet-btn" @click="openWelcome()"><AppIcon name="plus" /> Add AI</button>
    </div>
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

  <Teleport to="body">
    <div
      v-if="menu"
      ref="menuEl"
      class="context-menu"
      role="menu"
      :aria-label="`Actions for ${menu.inh.name}`"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
    >
      <button
        v-for="a in menuActions"
        :key="a.id"
        type="button"
        role="menuitem"
        :class="{ 'is-danger': a.danger }"
        @click="runAction(a.id)"
      >
        {{ a.label }}
      </button>
    </div>
  </Teleport>

  <WelcomeAiModal :house="house" :open="welcomeOpen" :inhabitant="welcomeTarget" @close="welcomeOpen = false" />
  <InhabitantProfileModal :house="house" :open="profileOpen" :inhabitant="profileTarget" @close="profileOpen = false" />
  <DepartAiModal :house="house" :open="departOpen" :inhabitant="departTarget" @close="departOpen = false" />
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

.rail-invite {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  margin: var(--space-2);
  padding: var(--space-3);
  font-size: 0.875rem;
  color: var(--text-muted);
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-lg);

  p {
    margin: 0;
  }
}

.rail-add {
  padding: var(--space-1) var(--space-2) 0;
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
