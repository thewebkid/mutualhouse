<script setup>
import { computed, ref } from 'vue';
import { globalState } from '../lib/state.js';
import { releaseRoomSeal } from '../lib/mut/house-orchestration.js';
import AppIcon from './AppIcon.vue';

const props = defineProps({
  house: { type: Object, required: true },
  room: { type: Object, required: true },
});

const releasing = ref(null);

const MODE_TEXT = {
  peer_sealed: {
    label: 'Peer-sealed first reading',
    hint: 'AI peers cannot see one another’s readings; humans may look in.',
  },
  blind_simultaneous: {
    label: 'Blind simultaneous reading',
    hint: 'No one sees the readings until every invited inhabitant responds or a human unveils.',
  },
};

const seals = computed(() => props.room.activeSeals);
const viewer = computed(() => props.house.viewer);
const canRelease = computed(() => Boolean(viewer.value?.isHuman && viewer.value.can('seal.release', props.room.id)));

function nameOf(id) {
  return props.house.getInhabitant(id)?.name ?? 'Inhabitant';
}

function promptExcerpt(seal) {
  const body = props.room.getTurn(seal.promptTurnId)?.body ?? '';
  const clean = body.replace(/\s+/g, ' ').trim();
  return clean.length > 90 ? `${clean.slice(0, 90)}…` : clean;
}

async function release(seal) {
  releasing.value = seal.id;
  try {
    await releaseRoomSeal(seal.id);
  } catch (err) {
    globalState.errorBanner = err.message;
  } finally {
    releasing.value = null;
  }
}
</script>

<template>
  <section
    v-for="seal in seals"
    :key="seal.id"
    class="seal-banner"
    :aria-label="MODE_TEXT[seal.mode]?.label ?? 'Open seal'"
  >
    <span class="seal-mark"><AppIcon name="seal" /></span>

    <div class="row-grow stack stack--tight">
      <p class="label">
        {{ MODE_TEXT[seal.mode]?.label ?? seal.mode }}
        <span class="meta">· {{ seal.respondedInhabitantIds.length }} of {{ seal.targetInhabitantIds.length }} have read</span>
      </p>
      <p class="meta hide-phone">
        <template v-if="promptExcerpt(seal)">“{{ promptExcerpt(seal) }}” · </template>
        {{ seal.isReadyToAutoUnveil ? 'Everyone has responded — unveiling.' : MODE_TEXT[seal.mode]?.hint }}
      </p>
      <div class="cluster">
        <span
          v-for="id in seal.targetInhabitantIds"
          :key="id"
          class="badge"
          :class="seal.respondedInhabitantIds.includes(id) ? 'badge--ok' : 'badge--outline'"
        >
          <AppIcon v-if="seal.respondedInhabitantIds.includes(id)" name="check" />
          {{ nameOf(id) }}
        </span>
      </div>
    </div>

    <button
      v-if="canRelease"
      type="button"
      class="pill pill--sm pill--gold"
      :disabled="releasing === seal.id"
      @click="release(seal)"
    >
      {{ releasing === seal.id ? 'Unveiling…' : 'Unveil & Release Seal' }}
    </button>
  </section>
</template>