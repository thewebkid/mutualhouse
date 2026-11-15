<script setup>
import { computed, ref } from 'vue';
import { globalState } from '../lib/state.js';
import { sendTempoPulse, setRoomRoutingMode, toggleRoomPause } from '../lib/mut/house-orchestration.js';
import { joinActiveRoomCall } from '../lib/webrtc-peer.js';
import AppIcon from './AppIcon.vue';
import InhabitantMark from './InhabitantMark.vue';

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

// How the room is being paced, in the house's words; the select below uses the control labels
const PACE_LABELS = {
  manual: 'Human-paced',
  assisted: 'Assisted routing',
  authorized_auto: 'Authorized auto',
};

// Alphabetical, so no one is listed first for standing
const inhabitants = computed(() =>
  [...props.house.inhabitants].sort((a, b) => a.name.localeCompare(b.name))
);
const paceLabel = computed(() => {
  const base = PACE_LABELS[props.room.routingMode] ?? props.room.routingMode;
  return props.room.routingMode === 'authorized_auto'
    ? `${base} · ${props.room.consecutiveAiTurns}/${props.room.autoTurnCap}`
    : base;
});

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
    <div class="room-head-title">
      <h1 class="hide-phone">{{ room.name }}</h1>
      <p v-if="room.purpose" class="room-purpose hide-phone">{{ room.purpose }}</p>
      <ul class="room-presence" :aria-label="`Inhabitants of ${room.name}`">
        <li v-for="inh in inhabitants" :key="inh.id" class="room-presence-who">
          <InhabitantMark small :inhabitant="inh" />{{ inh.name }}
        </li>
        <li class="room-pace" :class="{ 'is-held': room.paused }">
          {{ paceLabel }}<template v-if="room.paused"> · AI routing paused</template>
        </li>
      </ul>
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
      <button
        v-if="canSteer"
        type="button"
        class="btn btn--sm"
        :class="{ 'is-active': room.paused }"
        :aria-pressed="room.paused"
        :disabled="busy === 'pause'"
        :title="room.paused ? 'AI routing is paused — resume' : 'Pause AI routing in this room'"
        @click="togglePause"
      >
        <AppIcon :name="room.paused ? 'play' : 'pause'" />
        {{ room.paused ? 'Paused' : 'Pause' }}
      </button>
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
        class="btn btn--sm"
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
