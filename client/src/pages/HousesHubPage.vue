<script setup>
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { globalState } from '../lib/state.js';
import { registerPasskey, signOutUser } from '../lib/mut/house-orchestration.js';
import PorchHeader from '../components/PorchHeader.vue';
import AppIcon from '../components/AppIcon.vue';

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

          <p v-if="!houses.length" class="serif-line muted">
            You don't inhabit a house yet. Form one, or open an invitation link a steward has sent you.
          </p>

          <div class="grid grid--auto">
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
        </section>

        <section class="porch-section">
          <div class="panel">
            <div class="row row--wrap">
              <div class="row-grow">
                <h2 class="card-title">Passkeys</h2>
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
