<script setup>
import { watch } from 'vue';
import { RouterView } from 'vue-router';
import { globalState } from './lib/state.js';
import AppIcon from './components/AppIcon.vue';

const THEME_COLORS = { light: '#f8f6f3', dark: '#1a1f2e' };

watch(
  () => globalState.ui.theme,
  (theme) => {
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', THEME_COLORS[theme] ?? THEME_COLORS.light);
    }
  },
  { immediate: true }
);

function dismissError() {
  globalState.errorBanner = null;
}

function dismissNotice() {
  globalState.noticeBanner = null;
}

function dismissDevLink() {
  globalState.ui.devMagicLinkUrl = null;
}
</script>

<template>
  <RouterView />

  <div class="toast-stack" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-if="globalState.ui.devMagicLinkUrl" key="dev" class="toast toast--dev">
        <p>
          <span class="eyebrow">Local dev · no email sent</span><br />
          <a :href="globalState.ui.devMagicLinkUrl">Open your sign-in link</a>
        </p>
        <button type="button" class="icon-btn" aria-label="Dismiss" @click="dismissDevLink">
          <AppIcon name="close" />
        </button>
      </div>
      <div v-if="globalState.errorBanner" key="error" class="toast toast--error" role="alert">
        <p>{{ globalState.errorBanner }}</p>
        <button type="button" class="icon-btn" aria-label="Dismiss" @click="dismissError">
          <AppIcon name="close" />
        </button>
      </div>
      <div v-if="globalState.noticeBanner" key="notice" class="toast">
        <p>{{ globalState.noticeBanner }}</p>
        <button type="button" class="icon-btn" aria-label="Dismiss" @click="dismissNotice">
          <AppIcon name="close" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
