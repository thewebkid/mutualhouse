<script setup>
import { computed } from 'vue';

const props = defineProps({
  inhabitant: { type: Object, default: null },
  small: { type: Boolean, default: false },
});

const initials = computed(() => props.inhabitant?.initials ?? '?');
const isAi = computed(() => props.inhabitant?.kind === 'ai');
const title = computed(() => {
  const inh = props.inhabitant;
  if (!inh) return 'Unknown inhabitant';
  return isAi.value ? `${inh.displayTitle ?? inh.name} · AI inhabitant` : `${inh.name} · human inhabitant`;
});
</script>

<template>
  <span
    class="monogram"
    :class="{ 'monogram--ai': isAi, 'monogram--sm': small }"
    :title="title"
    aria-hidden="true"
  >{{ initials }}</span>
</template>
