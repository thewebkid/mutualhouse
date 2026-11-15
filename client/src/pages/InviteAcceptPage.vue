<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api } from '../lib/api.js';
import { globalState } from '../lib/state.js';
import { loadSessionAndHouses } from '../lib/mut/house-orchestration.js';
import PorchHeader from '../components/PorchHeader.vue';

const route = useRoute();
const router = useRouter();

const token = computed(() => String(route.params.token || ''));
const loading = ref(true);
const accepting = ref(false);
const preview = ref(null);
const error = ref('');

const house = computed(() => preview.value?.house ?? preview.value?.invite?.house ?? {});
const invite = computed(() => preview.value?.invite ?? preview.value ?? {});
const houseName = computed(() => house.value.name ?? invite.value.houseName ?? 'a Mutual House');
const invitedBy = computed(() => invite.value.invitedByName ?? invite.value.invitedBy?.name ?? '');
const roleLabel = computed(() => invite.value.roleLabel ?? 'Inhabitant');
const signInTarget = computed(() => ({ name: 'sign-in', query: { redirect: route.fullPath } }));

onMounted(async () => {
  try {
    preview.value = await api.getInvitePreview(token.value);
  } catch (err) {
    error.value = err.message || 'This invitation could not be found. It may have expired or been used.';
  } finally {
    loading.value = false;
  }
});

async function accept() {
  error.value = '';
  accepting.value = true;
  try {
    const res = await api.acceptInvite(token.value);
    await loadSessionAndHouses();
    const slug = res?.house?.slug ?? res?.houseSlug ?? house.value.slug;
    router.push(slug ? { name: 'house-shell', params: { slug } } : '/houses');
  } catch (err) {
    error.value = err.message || 'The invitation could not be accepted.';
  } finally {
    accepting.value = false;
  }
}
</script>

<template>
  <div class="porch">
    <PorchHeader />

    <main class="porch-main threshold">
      <div class="threshold-card">
        <section v-if="loading" class="card" aria-busy="true">
          <p class="eyebrow">Invitation</p>
          <h1>Reading the invitation…</h1>
        </section>

        <section v-else-if="!preview" class="card">
          <p class="eyebrow">Invitation</p>
          <h1>This door isn't open</h1>
          <p class="form-error" role="alert">{{ error }}</p>
          <div class="action-row">
            <RouterLink to="/" class="btn">Return to the porch</RouterLink>
          </div>
        </section>

        <section v-else class="card">
          <p class="eyebrow">You are invited</p>
          <h1>{{ houseName }}</h1>
          <div class="cluster">
            <span class="badge badge--primary">{{ roleLabel }}</span>
            <span v-if="house.coordinates" class="badge badge--accent">Locality {{ house.coordinates }}</span>
          </div>
          <p v-if="house.purpose" class="prose">{{ house.purpose }}</p>
          <p class="muted">
            <template v-if="invitedBy">{{ invitedBy }} has invited you to inhabit this house. </template>
            Entering is intentional: you will meet the house through its record, its constitution, and its memory.
          </p>

          <p v-if="error" class="form-error" role="alert">{{ error }}</p>

          <div class="action-row">
            <template v-if="globalState.currentUser">
              <button type="button" class="btn btn--primary" :disabled="accepting" @click="accept">
                {{ accepting ? 'Entering…' : 'Accept & enter the house' }}
              </button>
              <span class="meta">as {{ globalState.currentUser.email }}</span>
            </template>
            <template v-else>
              <RouterLink :to="signInTarget" class="btn btn--primary">Sign in to accept</RouterLink>
              <span class="meta">You'll return here after signing in.</span>
            </template>
          </div>
        </section>

        <p class="meta threshold-note">
          Before entering, you may read <RouterLink to="/orientation">Orientation</RouterLink> and the
          <RouterLink to="/disclosures">Disclosures</RouterLink>.
        </p>
      </div>
    </main>
  </div>
</template>
