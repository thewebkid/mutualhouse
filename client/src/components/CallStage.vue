<script setup>
import { computed, ref, toRaw, watchEffect } from 'vue';
import { globalState } from '../lib/state.js';
import {
  joinActiveRoomCall,
  leaveActiveRoomCall,
  toggleCallAudio,
  toggleCallVideo,
  toggleScreenShare,
} from '../lib/webrtc-peer.js';
import AppIcon from './AppIcon.vue';

const props = defineProps({
  house: { type: Object, required: true },
  room: { type: Object, required: true },
});

const call = globalState.call;
const collapsed = ref(false);
const localVideo = ref(null);
const remoteVideo = ref(null);

const STATUS_TEXT = {
  joining: 'Joining…',
  ringing: 'Waiting for the other inhabitant…',
  connected: 'Connected',
  failed: 'Connection failed',
};

const inThisRoom = computed(() => call.status !== 'idle' && call.roomId === props.room.id);
const elsewhere = computed(() => call.status !== 'idle' && call.roomId !== props.room.id);
const openByOther = computed(() => !inThisRoom.value && !elsewhere.value && Boolean(props.room.callSession?.isActive));
const peerName = computed(() => props.house.getInhabitant(call.peerInhabitantId)?.name ?? null);
const otherOccupant = computed(() => {
  const viewerId = props.house.viewer?.id;
  const p = props.room.callSession?.participants?.find((x) => x.inhabitantId !== viewerId);
  return p ? props.house.getInhabitant(p.inhabitantId)?.name ?? 'Someone' : 'Someone';
});
const roomIsFull = computed(() => Boolean(props.room.callSession?.isFull));
const canShareScreen = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);

// MediaStreams must reach the <video> element unproxied
watchEffect(() => {
  if (localVideo.value) localVideo.value.srcObject = call.localStream ? toRaw(call.localStream) : null;
});
watchEffect(() => {
  if (remoteVideo.value) remoteVideo.value.srcObject = call.remoteStream ? toRaw(call.remoteStream) : null;
});

function join() {
  joinActiveRoomCall({ video: true, audio: true });
}

async function share() {
  try {
    await toggleScreenShare();
  } catch (err) {
    if (err?.name !== 'NotAllowedError') globalState.errorBanner = err.message;
  }
}
</script>

<template>
  <section v-if="inThisRoom" class="call-stage" aria-label="Room call">
    <div class="call-bar">
      <span class="presence-dot" :class="call.status === 'connected' ? 'presence-dot--participating' : 'presence-dot--connected'"></span>
      <span class="label row-grow">
        {{ STATUS_TEXT[call.status] ?? call.status }}<template v-if="peerName && call.status === 'connected'"> with {{ peerName }}</template>
      </span>
      <button
        type="button"
        class="icon-btn"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? 'Show call' : 'Collapse call'"
        @click="collapsed = !collapsed"
      >
        <AppIcon :name="collapsed ? 'chevron-down' : 'chevron-up'" />
      </button>
    </div>

    <div v-show="!collapsed" class="call-tiles">
      <div class="call-tile">
        <video ref="remoteVideo" autoplay playsinline></video>
        <span v-if="call.status !== 'connected'" class="call-tile-empty">{{ STATUS_TEXT[call.status] }}</span>
        <span class="call-tile-label">{{ peerName ?? 'Waiting' }}</span>
      </div>
      <div class="call-tile is-local">
        <video ref="localVideo" autoplay playsinline muted></video>
        <span v-if="!call.videoEnabled" class="call-tile-empty">Camera off</span>
        <span class="call-tile-label">You{{ call.screenSharing ? ' · sharing screen' : '' }}</span>
      </div>
    </div>

    <p v-if="call.error" class="form-error">{{ call.error }}</p>

    <div class="call-controls">
      <button
        type="button"
        class="icon-btn icon-btn--outline"
        :class="{ 'is-active': !call.audioEnabled }"
        :aria-pressed="!call.audioEnabled"
        :aria-label="call.audioEnabled ? 'Mute microphone' : 'Unmute microphone'"
        @click="toggleCallAudio"
      >
        <AppIcon :name="call.audioEnabled ? 'mic' : 'mic-off'" />
      </button>
      <button
        type="button"
        class="icon-btn icon-btn--outline"
        :class="{ 'is-active': !call.videoEnabled }"
        :aria-pressed="!call.videoEnabled"
        :aria-label="call.videoEnabled ? 'Turn camera off' : 'Turn camera on'"
        @click="toggleCallVideo"
      >
        <AppIcon :name="call.videoEnabled ? 'video' : 'video-off'" />
      </button>
      <button
        v-if="canShareScreen"
        type="button"
        class="icon-btn icon-btn--outline"
        :class="{ 'is-active': call.screenSharing }"
        :aria-pressed="call.screenSharing"
        aria-label="Share screen"
        @click="share"
      >
        <AppIcon name="screen" />
      </button>
      <button type="button" class="btn btn--sm btn--danger" @click="leaveActiveRoomCall">
        <AppIcon name="phone-off" /> Leave
      </button>
    </div>

    <p class="call-caption">Peer-to-peer encrypted · AI inhabitants cannot hear or join room calls.</p>
  </section>

  <section v-else-if="elsewhere" class="call-stage">
    <div class="call-bar">
      <span class="presence-dot presence-dot--participating"></span>
      <span class="label row-grow">You're in a call in another room.</span>
      <button type="button" class="btn btn--sm btn--danger" @click="leaveActiveRoomCall">Leave call</button>
    </div>
  </section>

  <section v-else-if="openByOther" class="call-stage">
    <div class="call-bar">
      <span class="presence-dot presence-dot--connected"></span>
      <span class="label row-grow">
        {{ roomIsFull ? 'A call is in progress in this room.' : `${otherOccupant} has opened a call in this room.` }}
      </span>
      <button v-if="!roomIsFull" type="button" class="btn btn--sm btn--primary" @click="join">
        <AppIcon name="video" /> Join
      </button>
    </div>
  </section>
</template>
