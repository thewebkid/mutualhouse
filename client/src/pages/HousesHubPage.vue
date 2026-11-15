<script setup>
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { globalState } from '../lib/state.js';
import { registerPasskey, signOutUser } from '../lib/mut/house-orchestration.js';
import PorchHeader from '../components/PorchHeader.vue';
import AppIcon from '../components/AppIcon.vue';
import HelpTip from '../components/HelpTip.vue';

const router = useRouter();
const passkeyBusy = ref(false);
const passkeyError = ref('');

const user = computed(() => globalState.currentUser);
const houses = computed(() => globalState.myHouses ?? []);
const firstName = computed(() => (user.value?.name || '').split(/\s+/)[0] || '');

async function addPasskey() {
  passkeyError.value = '';
  passkeyBusy.value = true;
  try {
    await registerPasskey('This device');
  } catch (err) {
    if (err?.name !== 'NotAllowedError') passkeyError.value = err.message;
  } finally {
    passkeyBusy.value = false;
  }
}

async function signOut() {
  await signOutUser();
  router.push('/');
}
</script>

<template>
  <div class="porch">
    <PorchHeader />

    <main class="porch-main">
      <div class="container">
        <section class="porch-section">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Your houses</p>
              <h1>{{ firstName ? `Welcome, ${firstName}` : 'Welcome' }}</h1>
            </div>
            <button type="button" class="quiet-btn" @click="signOut">Sign out</button>
          </div>

          <template v-if="!houses.length">
            <p class="serif-line muted">You don't inhabit a house yet — and the whole path is three steps:</p>
            <ol class="steps-grid hub-steps">
              <li>
                <span class="label">Form a house</span>
                <p>Name it and you're inside. It begins blank — no templates, no rules you didn't write.</p>
              </li>
              <li>
                <span class="label">Welcome inhabitants</span>
                <p>Invite people with a link. Welcome an AI from Housekeeping in about a minute — guided, step by step.</p>
              </li>
              <li>
                <span class="label">Talk together</span>
                <p>Rooms hold the conversation. Everything stays inside unless the house releases it.</p>
              </li>
            </ol>
            <div class="action-row">
              <RouterLink to="/houses/new" class="btn btn--primary">Form your first house</RouterLink>
              <span class="meta">or open an invitation link a steward has sent you.</span>
            </div>
          </template>

          <div v-else class="grid grid--auto">
            <RouterLink
              v-for="h in houses"
              :key="h.id"
              :to="{ name: 'house-shell', params: { slug: h.slug } }"
              class="card"
            >
              <div class="row row--between">
                <span class="badge badge--primary">{{ h.roleLabel || 'Inhabitant' }}</span>
                <span v-if="h.coordinates" class="badge badge--accent">Locality {{ h.coordinates }}</span>
              </div>
              <h2 class="card-title">{{ h.name }}</h2>
              <p class="card-text">{{ h.purpose || 'Purpose not yet written.' }}</p>
            </RouterLink>

            <RouterLink to="/houses/new" class="card card--dashed">
              <span class="monogram monogram--ai"><AppIcon name="plus" /></span>
              <h2 class="card-title">Form a New House</h2>
              <p class="card-text">Begins blank: no method, no roles, no categories, no style.</p>
            </RouterLink>
          </div>

          <p class="meta hub-hint">
            New here? Inside a house, the <strong>Housekeeping</strong> view walks you through inviting people and
            AIs — look for the <strong>?</strong> marks whenever something is unfamiliar.
          </p>
        </section>

        <section class="porch-section">
          <div class="panel">
            <div class="row row--wrap">
              <div class="row-grow">
                <div class="label-row">
                  <h2 class="card-title">Passkeys</h2>
                  <HelpTip title="What's a passkey?">
                    <p>
                      A passkey lets this device open your houses with your fingerprint, face, or PIN instead of
                      waiting for an email link. It's stored on the device, can't be phished, and there's no
                      password to forget.
                    </p>
                    <p>Add one per device you use.</p>
                  </HelpTip>
                </div>
                <p class="card-text">
                  {{
                    user?.hasPasskey
                      ? 'A passkey is registered to your account. You can add one for each device you use.'
                      : 'Add a passkey so this device can open your houses without waiting for an email.'
                  }}
                </p>
              </div>
              <button type="button" class="btn" :disabled="passkeyBusy" @click="addPasskey">
                <AppIcon name="key" />
                {{ passkeyBusy ? 'Waiting…' : user?.hasPasskey ? 'Add another passkey' : 'Register a passkey' }}
              </button>
            </div>
            <p v-if="passkeyError" class="form-error" role="alert">{{ passkeyError }}</p>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.hub-steps {
  margin-top: var(--space-4);
}

.hub-hint {
  margin-top: var(--space-4);
}
</style>
