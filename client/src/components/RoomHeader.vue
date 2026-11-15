<script setup>
import { computed, ref } from 'vue';
import { globalState } from '../lib/state.js';
import { sendTempoPulse, setRoomRoutingMode, toggleRoomPause } from '../lib/mut/house-orchestration.js';
import { joinActiveRoomCall } from '../lib/webrtc-peer.js';
import AppIcon from './AppIcon.vue';

const props = defineProps({
  house: { type: Object, required: true },
  room: { type: Object, required: true },
});

const ui = globalState.ui;
const busy = ref('');

const ROUTING_LABELS = {
  manual: 'Manual routing',
  assisted: 'Assisted routing',
  authorized_auto: 'Authorized auto',
};

const viewer = computed(() => props.house.viewer);
const canSteer = computed(() => Boolean(viewer.value?.isHuman && viewer.value.can('room.pause', props.room.id)));
const inCallHere = computed(
  () => globalState.call.status !== 'idle' && globalState.call.roomId === props.room.id
);
const hasAi = computed(() => props.house.aiInhabitants.length > 0);

async function run(key, fn) {
  busy.value = key;
  try {
    await fn();
  } catch (err) {
    globalState.errorBanner = err.message;
  } finally {
    busy.value = '';
  }
}

function onRouting(ev) {
  const mode = ev.target.value;
  run('routing', () => setRoomRoutingMode(mode, props.room.autoTurnCap || 3));
}

function togglePause() {
  run('pause', () => toggleRoomPause());
}

function pulse() {
  run('pulse', () => sendTempoPulse([]));
}

function openInspector(tab) {
  ui.inspectorTab = ui.inspectorTab === tab ? null : tab;
}

function joinCall() {
  joinActiveRoomCall({ video: true, audio: true });
}
</script>

<template>
  <header class="room-head">
    <div class="room-head-title hide-phone">
      <h1><span class="rail-hash">#</span>{{ room.slug }}</h1>
      <p>{{ room.purpose || room.name }}</p>
    </div>

    <div class="room-head-actions">
      <label class="visually-hidden" for="routing-mode">Routing mode</label>
      <select
        v-if="canSteer"
        id="routing-mode"
        class="field-control routing-select"
        :value="room.routingMode"
        :disabled="busy === 'routing'"
        @change="onRouting"
      >
        <option v-for="(label, mode) in ROUTING_LABELS" :key="mode" :value="mode">{{ label }}</option>
      </select>
      <span v-else class="badge badge--teal">{{ ROUTING_LABELS[room.routingMode] ?? room.routingMode }}</span>

      <span v-if="room.routingMode === 'authorized_auto'" class="badge" title="Consecutive AI turns before a human must speak">
        {{ room.consecutiveAiTurns }}/{{ room.autoTurnCap }} auto
      </span>

      <button
        v-if="canSteer"
        type="button"
        class="pill pill--sm"
        :class="{ 'is-active': room.paused }"
        :aria-pressed="room.paused"
        :disabled="busy === 'pause'"
        :title="room.paused ? 'AI routing is paused — resume' : 'Pause AI routing in this room'"
        @click="togglePause"
      >
        <AppIcon :name="room.paused ? 'play' : 'pause'" />
        {{ room.paused ? 'Paused' : 'Pause' }}
      </button>
      <span v-else-if="room.paused" class="badge badge--gold">Paused</span>

      <button
        v-if="hasAi"
        type="button"
        class="icon-btn icon-btn--outline"
        :disabled="busy === 'pulse'"
        title="Tempo pulse (.) — a quiet nudge to connected inhabitants"
        aria-label="Send tempo pulse"
        @click="pulse"
      >
        <AppIcon name="pulse" />
      </button>

      <button
        v-if="hasAi"
        type="button"
        class="icon-btn icon-btn--outline"
        :class="{ 'is-active': ui.inspectorTab === 'packet' }"
        title="Door 3 — manual packets"
        aria-label="Open manual packet door"
        @click="openInspector('packet')"
      >
        <AppIcon name="packet" />
      </button>

      <button
        type="button"
        class="icon-btn icon-btn--outline hide-phone"
        :class="{ 'is-active': ui.inspectorTab === 'memory' }"
        title="Quick House Memory"
        aria-label="Open quick House Memory"
        @click="openInspector('memory')"
      >
        <AppIcon name="memory" />
      </button>

      <button
        v-if="!inCallHere"
        type="button"
        class="pill pill--sm"
        :disabled="globalState.call.status === 'joining'"
        @click="joinCall"
      >
        <AppIcon name="video" />
        <span class="hide-phone">Join Audio/Video Call</span>
        <span class="only-phone">Call</span>
      </button>
    </div>
  </header>
</template>
