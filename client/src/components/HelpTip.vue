<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';

// A small "?" that opens a plain-language note next to itself.
// Teleported to <body> so clipped containers (rail, tabs, drawers) can't cut it off;
// on phones it becomes a bottom sheet with a scrim. Escape, scroll, or tap-outside closes.
const props = defineProps({
  title: { type: String, required: true },
  label: { type: String, default: '' },
  align: { type: String, default: 'start' }, // 'start' | 'end' — which edge the card hugs
});

const root = ref(null);
const pop = ref(null);
const open = ref(false);
const pos = ref(null);

function toggle() {
  if (open.value) {
    open.value = false;
    return;
  }
  const phone = window.matchMedia('(max-width: 767px)').matches;
  if (!phone && root.value) {
    const rect = root.value.getBoundingClientRect();
    const width = Math.min(352, window.innerWidth - 16);
    let left = props.align === 'end' ? rect.right - width : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    // Open below the mark; flip above when the sill is too close to the floor
    const roomBelow = window.innerHeight - rect.bottom;
    if (roomBelow < 260 && rect.top > 280) {
      pos.value = { top: `${rect.top - 8}px`, left: `${left}px`, width: `${width}px`, flip: true };
    } else {
      pos.value = { top: `${rect.bottom + 8}px`, left: `${left}px`, width: `${width}px`, flip: false };
    }
  } else {
    pos.value = null;
  }
  open.value = true;
}

function close() {
  open.value = false;
}

function onKeydown(ev) {
  if (ev.key === 'Escape') close();
}

function onDocPointer(ev) {
  if (root.value?.contains(ev.target) || pop.value?.contains(ev.target)) return;
  close();
}

watch(open, (isOpen) => {
  const on = isOpen ? 'addEventListener' : 'removeEventListener';
  document[on]('keydown', onKeydown);
  document[on]('pointerdown', onDocPointer);
  if (isOpen) window.addEventListener('scroll', close, { capture: true, once: true });
  else window.removeEventListener('scroll', close, { capture: true });
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('pointerdown', onDocPointer);
  window.removeEventListener('scroll', close, { capture: true });
});
</script>

<template>
  <span ref="root" class="help-tip" @click.stop>
    <button
      type="button"
      class="help-btn"
      :aria-expanded="open"
      :aria-label="label || `What is this? ${title}`"
      :title="label || 'What is this?'"
      @click="toggle"
    >
      <AppIcon name="help" />
    </button>
    <Teleport to="body">
      <span v-if="open" class="help-scrim" aria-hidden="true" @click="close"></span>
      <div
        v-if="open"
        ref="pop"
        class="help-pop"
        :class="{ 'help-pop--flip': pos?.flip, 'help-pop--anchored': pos }"
        :style="pos ? { top: pos.top, left: pos.left, width: pos.width } : undefined"
        role="dialog"
        :aria-label="title"
      >
        <div class="help-pop-head">
          <p class="help-title">{{ title }}</p>
          <button type="button" class="icon-btn" aria-label="Close explanation" @click="close">
            <AppIcon name="close" />
          </button>
        </div>
        <div class="help-body">
          <slot />
        </div>
      </div>
    </Teleport>
  </span>
</template>
