<script>
// Pictures that failed to load (a Gravatar that does not exist, a dead avatar URL).
// Remembered for the page's lifetime so a rail of marks never retries a known miss.
const pictureMisses = new Map();
</script>

<script setup>
import { computed, ref, watch } from 'vue';
import { signatureStyle } from '../lib/signature.js';

const props = defineProps({
  inhabitant: { type: Object, default: null },
  small: { type: Boolean, default: false },
  large: { type: Boolean, default: false },
});

const initials = computed(() => props.inhabitant?.initials ?? '?');
const isAi = computed(() => props.inhabitant?.kind === 'ai');
const title = computed(() => {
  const inh = props.inhabitant;
  if (!inh) return 'Unknown inhabitant';
  return isAi.value ? `${inh.displayTitle ?? inh.name} · AI inhabitant` : `${inh.name} · human inhabitant`;
});

const missed = ref(false);
const ready = ref(false);

// An uploaded picture wins. Otherwise a human who allows it may use their Gravatar.
const candidate = computed(() => {
  const inh = props.inhabitant;
  if (!inh) return null;
  if (inh.avatarUrl) return inh.avatarUrl;
  if (!isAi.value && inh.useGravatar && inh.gravatarHash) {
    return `https://www.gravatar.com/avatar/${inh.gravatarHash}?d=404&s=160`;
  }
  return null;
});

const src = computed(() => {
  if (missed.value || !candidate.value) return null;
  return pictureMisses.has(candidate.value) ? null : candidate.value;
});

watch(candidate, () => {
  missed.value = false;
  ready.value = false;
});

function onError() {
  if (candidate.value) pictureMisses.set(candidate.value, true);
  missed.value = true;
  ready.value = false;
}
</script>

<template>
  <span
    class="monogram"
    :class="{ 'monogram--ai': isAi, 'monogram--sm': small, 'monogram--lg': large }"
    :style="signatureStyle(inhabitant)"
    :title="title"
    aria-hidden="true"
  >
    <img
      v-if="src"
      :key="src"
      class="monogram-img"
      :class="{ 'is-ready': ready }"
      :src="src"
      alt=""
      loading="lazy"
      referrerpolicy="no-referrer"
      @load="ready = true"
      @error="onError"
    />
    <template v-if="!ready">{{ initials }}</template>
  </span>
</template>
