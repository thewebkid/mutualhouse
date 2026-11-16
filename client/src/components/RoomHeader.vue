<script setup>
import { computed, ref } from 'vue';
import { globalState } from '../lib/state.js';
import { sendTempoPulse, setRoomRoutingMode, toggleRoomPause } from '../lib/mut/house-orchestration.js';
import { joinActiveRoomCall } from '../lib/webrtc-peer.js';
import AppIcon from './AppIcon.vue';
import HelpTip from './HelpTip.vue';
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
  [...props.house.inhabitants]
    .filter((i) => !i.departedAt)
    .sort((a, b) => a.name.localeCompare(b.name))
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
      <HelpTip v-if="canSteer" title="Routing — how the room is paced" align="end">
        <p><strong>Manual</strong> — only @mentions and nudges reach the AIs. Nothing moves unless a human moves it.</p>
        <p><strong>Assisted</strong> — the everyday default. Humans lead; AIs answer when @mentioned or nudged, and the room records who was called.</p>
        <p>
          <strong>Authorized auto</strong> — every turn is offered to the AIs, who may also reply to one another, up
          to a cap of consecutive AI turns. The room pauses itself at the cap; you can pause or resume anytime.
        </p>
      </HelpTip>
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
        title="Nudge — a quiet tap on the shoulder for connected inhabitants"
        aria-label="Nudge connected inhabitants"
        @click="pulse"
      >
        <AppIcon name="pulse" />
        <span class="room-tool-label">Nudge</span>
      </button>

      <button
        v-if="hasAi"
        type="button"
        class="icon-btn icon-btn--outline"
        :class="{ 'is-active': ui.inspectorTab === 'packet' }"
        title="Copy & paste packet (Door 3) — carry the room to any AI chat"
        aria-label="Open copy and paste packet door"
        @click="openInspector('packet')"
      >
        <AppIcon name="packet" />
        <span class="room-tool-label">Packet</span>
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
        <span class="room-tool-label">Memory</span>
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
