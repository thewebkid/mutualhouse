<script setup>
import { computed } from 'vue';

const props = defineProps({
  name: { type: String, required: true },
  label: { type: String, default: '' },
});

const PATHS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm-7-3a7 7 0 0 0 14 0M12 19v3',
  'mic-off': 'M3 3l18 18M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V6a3 3 0 0 0-5.94-.6M5 12a7 7 0 0 0 11.95 4.95M19 12a7 7 0 0 1-.34 2.16M12 19v3',
  paperclip: 'M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9',
  send: 'M5 12h13M13 6l6 6-6 6',
  video: 'M15 10l5-3v10l-5-3M3 7h12v10H3z',
  'video-off': 'M3 3l18 18M15 10l5-3v10l-5-3M10 7h5v5M3 7h2m-2 0v10h12v-2',
  screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
  'phone-off': 'M4 15.5c4.5-4.6 11.5-4.6 16 0l-2 2.5-3-1v-2.5a9 9 0 0 0-6 0V17l-3 1z',
  reply: 'M10 8L5 12l5 4M5 12h9a5 5 0 0 1 5 5v1',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  seal: 'M12 3l2.4 1.6 2.9-.1.9 2.7 2.3 1.8-.9 2.7.9 2.7-2.3 1.8-.9 2.7-2.9-.1L12 21l-2.4-1.6-2.9.1-.9-2.7-2.3-1.8.9-2.7-.9-2.7 2.3-1.8.9-2.7 2.9.1z',
  pause: 'M9 5v14M15 5v14',
  play: 'M7 5l12 7-12 7z',
  packet: 'M4 6h16v12H4zM4 7l8 6 8-6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  plus: 'M12 5v14M5 12h14',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  memory: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  door: 'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18M14 12h.01',
  key: 'M14 10a4 4 0 1 0-3.46 3.96L13 16.5h2v2h2v2h3v-3l-6.04-6.04A4 4 0 0 0 14 10z',
  download: 'M12 4v11m-5-5 5 5 5-5M5 20h14',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  home: 'M4 11l8-7 8 7v9H4zM10 20v-5h4v5',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.2a3.5 3.5 0 0 1 0 6.6M18 14a6.5 6.5 0 0 1 3.5 6',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  scroll: 'M8 4h11v13a3 3 0 0 1-3 3H6a2 2 0 0 1-2-2v-2h11v2a2 2 0 0 0 2 2M8 4a2 2 0 0 0-2 2v10M11 8h5M11 12h5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  pulse: 'M12 12h.01',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.4 9.2a2.7 2.7 0 0 1 5.3.7c0 1.8-2.7 2.3-2.7 4.1M12 17.4h.01',
};

const d = computed(() => PATHS[props.name] ?? '');
const isDot = computed(() => props.name === 'pulse');
</script>

<template>
  <svg
    width="1.15em"
    height="1.15em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    focusable="false"
  >
    <circle v-if="isDot" cx="12" cy="15" r="2.6" fill="currentColor" stroke="none" />
    <path v-else :d="d" />
  </svg>
</template>
