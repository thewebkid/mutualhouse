<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { globalState, toggleTheme } from '../lib/state.js';
import AppIcon from './AppIcon.vue';

const isDark = computed(() => globalState.ui.theme === 'dark');
const signedIn = computed(() => Boolean(globalState.currentUser));
</script>

<template>
  <header class="porch-header">
    <div class="container porch-bar">
      <RouterLink to="/" class="brand" aria-label="The Mutual House — home">
        <img src="/brand/house-mark.svg" alt="" width="32" height="32" />
        <span>The Mutual House</span>
      </RouterLink>

      <nav class="porch-nav" aria-label="Porch">
        <RouterLink to="/orientation">Orientation</RouterLink>
        <RouterLink to="/compact">Compact</RouterLink>
        <RouterLink to="/disclosures">Disclosures</RouterLink>
      </nav>

      <button
        type="button"
        class="icon-btn"
        :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
        :title="isDark ? 'Light theme' : 'Dark theme'"
        @click="toggleTheme"
      >
        <AppIcon :name="isDark ? 'sun' : 'moon'" />
      </button>

      <RouterLink v-if="signedIn" to="/houses" class="pill pill--sm pill--primary">My Houses</RouterLink>
      <RouterLink v-else to="/sign-in" class="pill pill--sm pill--primary">
        <span class="hide-phone">Enter /</span> Sign In
      </RouterLink>
    </div>
  </header>
</template>
