<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { globalState, getActiveRoom } from '../lib/state.js';
import { openHouseBySlug, selectRoom, stopRoomPolling } from '../lib/mut/house-orchestration.js';
import { leaveActiveRoomCall } from '../lib/webrtc-peer.js';
import AppIcon from '../components/AppIcon.vue';
import HouseRail from '../components/HouseRail.vue';
import RoomHeader from '../components/RoomHeader.vue';
import CallStage from '../components/CallStage.vue';
import SealControls from '../components/SealControls.vue';
import RoomTimeline from '../components/RoomTimeline.vue';
import TurnComposer from '../components/TurnComposer.vue';
import ReceiptDrawer from '../components/ReceiptDrawer.vue';
import HouseMemoryView from '../components/HouseMemoryView.vue';
import ConstitutionView from '../components/ConstitutionView.vue';
import HousekeepingView from '../components/HousekeepingView.vue';

const route = useRoute();
const ui = globalState.ui;

const house = computed(() => {
  const h = globalState.activeHouse;
  return h && h.slug === route.params.slug ? h : null;
});
const room = computed(() => (house.value ? getActiveRoom() : null));
const view = computed(() => ui.activeHouseView);
const inspectorOpen = computed(() => Boolean(ui.inspectorTab));

const VIEW_TITLES = {
  memory: 'House Memory',
  constitution: 'Constitution',
  housekeeping: 'Housekeeping',
};

const topbarTitle = computed(() => {
  if (view.value !== 'room') return VIEW_TITLES[view.value];
  return room.value ? room.value.name : house.value?.name ?? '';
});

async function load(slug, roomSlug) {
  if (!slug) return;
  ui.inspectorTab = null;
  ui.mobileNavOpen = false;
  try {
    await openHouseBySlug(slug, roomSlug || null);
  } catch {
    // openHouseBySlug already surfaces the error banner
  }
}

onMounted(() => load(route.params.slug, route.params.roomSlug));

watch(
  () => route.params.slug,
  (slug, prev) => {
    if (slug && slug !== prev) load(slug, route.params.roomSlug);
  }
);

watch(
  () => route.params.roomSlug,
  (roomSlug) => {
    if (!house.value || !roomSlug) return;
    if (roomSlug === globalState.activeRoomSlug && ui.activeHouseView === 'room') return;
    selectRoom(roomSlug);
  }
);

function closeOverlays() {
  ui.mobileNavOpen = false;
  ui.inspectorTab = null;
}

function onKeydown(ev) {
  if (ev.key === 'Escape' && (ui.mobileNavOpen || ui.inspectorTab)) closeOverlays();
}

onMounted(() => window.addEventListener('keydown', onKeydown));

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  stopRoomPolling();
  if (globalState.call.status !== 'idle') leaveActiveRoomCall();
  closeOverlays();
  ui.replyingToTurnId = null;
});

function openQuickMemory() {
  ui.inspectorTab = ui.inspectorTab === 'memory' ? null : 'memory';
}
</script>

<template>
  <div class="shell" :class="{ 'is-nav-open': ui.mobileNavOpen, 'has-drawer': inspectorOpen && house }">
    <header class="topbar">
      <button
        type="button"
        class="icon-btn"
        aria-label="Open rooms and inhabitants"
        :aria-expanded="ui.mobileNavOpen"
        @click="ui.mobileNavOpen = true"
      >
        <AppIcon name="menu" />
      </button>
      <div class="topbar-title">
        <strong>{{ topbarTitle }}</strong>
        <span v-if="house">{{ house.name }}</span>
      </div>
      <button
        v-if="house"
        type="button"
        class="icon-btn"
        :class="{ 'is-active': ui.inspectorTab === 'memory' }"
        aria-label="Quick House Memory"
        @click="openQuickMemory"
      >
        <AppIcon name="memory" />
      </button>
    </header>

    <div class="scrim scrim--nav" :class="{ 'is-visible': ui.mobileNavOpen }" @click="ui.mobileNavOpen = false"></div>

    <aside class="rail" aria-label="House navigation">
      <HouseRail v-if="house" :house="house" />
    </aside>

    <main class="stage">
      <div v-if="!house" class="loading-veil">
        <div v-if="globalState.loadingHouse || !globalState.errorBanner">
          <p class="serif-line">Opening the house…</p>
        </div>
        <div v-else class="stack">
          <p class="serif-line">This house couldn't be opened.</p>
          <RouterLink to="/houses" class="btn">Your houses</RouterLink>
        </div>
      </div>

      <template v-else-if="view === 'room'">
        <template v-if="room">
          <RoomHeader :house="house" :room="room" />
          <div class="stage-bands">
            <CallStage :house="house" :room="room" />
            <SealControls :house="house" :room="room" />
          </div>
          <RoomTimeline :house="house" :room="room" />
          <TurnComposer :house="house" :room="room" />
        </template>
        <div v-else class="loading-veil">
          <p class="serif-line">This house has no rooms yet. Begin one from the rail.</p>
        </div>
      </template>

      <div v-else class="stage-scroll">
        <div class="view-body leaf">
          <HouseMemoryView v-if="view === 'memory'" :house="house" :room="room" />
          <ConstitutionView v-else-if="view === 'constitution'" :house="house" />
          <HousekeepingView v-else-if="view === 'housekeeping'" :house="house" />
        </div>
      </div>
    </main>

    <div class="scrim" :class="{ 'is-visible': inspectorOpen && house }" @click="ui.inspectorTab = null"></div>

    <aside class="drawer" aria-label="Inspector">
      <ReceiptDrawer v-if="house" :house="house" :room="room" />
    </aside>
  </div>
</template>
