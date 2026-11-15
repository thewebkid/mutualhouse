<script setup>
import { ref, onBeforeUnmount } from 'vue';
import AppIcon from './AppIcon.vue';

const props = defineProps({
  text: { type: String, default: '' },
  label: { type: String, default: 'Copy' },
  copiedLabel: { type: String, default: 'Copied' },
  iconOnly: { type: Boolean, default: false },
  small: { type: Boolean, default: true },
});

const copied = ref(false);
let timer = null;

async function copy() {
  if (!props.text) return;
  try {
    await navigator.clipboard.writeText(props.text);
  } catch {
    const area = document.createElement('textarea');
    area.value = props.text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  copied.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => (copied.value = false), 1600);
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <button
    v-if="iconOnly"
    type="button"
    class="icon-btn"
    :class="{ 'is-active': copied }"
    :disabled="!text"
    :aria-label="copied ? copiedLabel : label"
    :title="copied ? copiedLabel : label"
    @click="copy"
  >
    <AppIcon :name="copied ? 'check' : 'copy'" />
  </button>
  <button
    v-else
    type="button"
    class="btn"
    :class="{ 'btn--sm': small, 'is-active': copied }"
    :disabled="!text"
    @click="copy"
  >
    <AppIcon :name="copied ? 'check' : 'copy'" />
    <span aria-live="polite">{{ copied ? copiedLabel : label }}</span>
  </button>
</template>
