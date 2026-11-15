<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { globalState } from '../lib/state.js';
import {
  signInMagicLink,
  signInWithPasskey,
  verifyMagicLinkToken,
} from '../lib/mut/house-orchestration.js';
import PorchHeader from '../components/PorchHeader.vue';
import AppIcon from '../components/AppIcon.vue';

const route = useRoute();
const router = useRouter();

const email = ref('');
const name = ref('');
const sending = ref(false);
const sent = ref(false);
const passkeyBusy = ref(false);
const verifying = ref(false);
const error = ref('');

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));
const redirectTarget = computed(() => {
  const r = route.query.redirect;
  return typeof r === 'string' && r.startsWith('/') ? r : '/houses';
});
const passkeySupported = typeof window !== 'undefined' && Boolean(window.PublicKeyCredential);

onMounted(async () => {
  if (!token.value) return;
  verifying.value = true;
  try {
    await verifyMagicLinkToken(token.value);
    router.replace(redirectTarget.value);
  } catch (err) {
    error.value = err.message || 'This sign-in link could not be verified. It may have expired.';
  } finally {
    verifying.value = false;
  }
});

async function sendLink() {
  error.value = '';
  sending.value = true;
  try {
    await signInMagicLink({
      email: email.value.trim(),
      name: name.value.trim() || undefined,
      redirectTo: redirectTarget.value,
    });
    sent.value = true;
  } catch (err) {
    error.value = err.message || 'Could not send a sign-in link.';
  } finally {
    sending.value = false;
  }
}

async function usePasskey() {
  error.value = '';
  passkeyBusy.value = true;
  try {
    await signInWithPasskey(email.value.trim());
    router.replace(redirectTarget.value);
  } catch (err) {
    if (err?.name !== 'NotAllowedError') {
      error.value = err.message || 'Passkey sign-in did not complete.';
    }
  } finally {
    passkeyBusy.value = false;
  }
}
</script>

<template>
  <div class="porch">
    <PorchHeader />

    <main class="porch-main threshold">
      <div class="threshold-card">
        <section v-if="token" class="card" aria-live="polite">
          <p class="eyebrow">Arriving</p>
          <template v-if="verifying || !error">
            <h1>Opening the door…</h1>
            <p class="muted">Verifying your sign-in link.</p>
          </template>
          <template v-else>
            <h1>That link didn't open</h1>
            <p class="form-error">{{ error }}</p>
            <div class="action-row">
              <RouterLink :to="{ name: 'sign-in', query: { redirect: redirectTarget } }" class="pill pill--primary">
                Request a new link
              </RouterLink>
            </div>
          </template>
        </section>

        <section v-else-if="globalState.currentUser" class="card">
          <p class="eyebrow">Welcome back</p>
          <h1>You're already inside</h1>
          <p class="muted">Signed in as {{ globalState.currentUser.email }}.</p>
          <div class="action-row">
            <RouterLink :to="redirectTarget" class="pill pill--primary">Continue</RouterLink>
          </div>
        </section>

        <section v-else-if="sent" class="card" aria-live="polite">
          <p class="eyebrow">Check your inbox</p>
          <h1>A link is on its way</h1>
          <p class="serif-line">
            We sent a one-time sign-in link to <strong>{{ email }}</strong>. It opens this house for you on whichever
            device you tap it from.
          </p>
          <div class="action-row">
            <button type="button" class="quiet-btn" @click="sent = false">Use a different email</button>
          </div>
        </section>

        <section v-else class="card">
          <p class="eyebrow">Enter</p>
          <h1>Sign in to the Mutual House</h1>
          <p class="muted">No passwords. A one-time email link, or a passkey on this device.</p>

          <form class="stack" @submit.prevent="sendLink">
            <div class="field">
              <label class="field-label" for="signin-email">Email</label>
              <input
                id="signin-email"
                v-model="email"
                class="field-control"
                type="email"
                inputmode="email"
                autocomplete="email webauthn"
                required
                placeholder="you@example.org"
              />
            </div>
            <div class="field">
              <label class="field-label" for="signin-name">Name <span class="muted">(first visit only)</span></label>
              <input
                id="signin-name"
                v-model="name"
                class="field-control"
                type="text"
                autocomplete="name"
                placeholder="How the house will know you"
              />
            </div>
            <p v-if="error" class="form-error" role="alert">{{ error }}</p>
            <button type="submit" class="pill pill--primary pill--block" :disabled="sending || !email">
              {{ sending ? 'Sending…' : 'Email me a sign-in link' }}
            </button>
          </form>

          <template v-if="passkeySupported">
            <p class="divider-label">or</p>
            <button type="button" class="pill pill--block" :disabled="passkeyBusy" @click="usePasskey">
              <AppIcon name="key" />
              {{ passkeyBusy ? 'Waiting for your passkey…' : 'Sign in with a passkey' }}
            </button>
          </template>
        </section>

        <p class="meta threshold-note">
          New here? Read <RouterLink to="/orientation">Orientation</RouterLink> and the
          <RouterLink to="/disclosures">Disclosures</RouterLink> first.
        </p>
      </div>
    </main>
  </div>
</template>
