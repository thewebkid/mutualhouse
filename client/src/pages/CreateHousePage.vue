<script setup>
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { slugify } from '@shared/lib/model-util.js';
import { createNewHouse } from '../lib/mut/house-orchestration.js';
import PorchHeader from '../components/PorchHeader.vue';
import AppIcon from '../components/AppIcon.vue';

const route = useRoute();
const router = useRouter();

const name = ref(typeof route.query.name === 'string' ? route.query.name : '');
const slug = ref(slugify(name.value));
const coordinates = ref(typeof route.query.coordinates === 'string' ? route.query.coordinates : '');
const purpose = ref('');
const slugTouched = ref(false);
const busy = ref(false);
const error = ref('');

watch(name, (next) => {
  if (!slugTouched.value) slug.value = slugify(next);
});

const cleanSlug = computed(() => slugify(slug.value));
const canSubmit = computed(() => name.value.trim().length > 0 && cleanSlug.value.length > 0 && !busy.value);

function onSlugInput() {
  slugTouched.value = true;
}

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    const house = await createNewHouse({
      name: name.value.trim(),
      slug: cleanSlug.value,
      coordinates: coordinates.value.trim(),
      purpose: purpose.value.trim(),
    });
    router.push({ name: 'house-shell', params: { slug: house.slug } });
  } catch (err) {
    error.value = err.message || 'The house could not be formed.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="porch">
    <PorchHeader />

    <main class="porch-main threshold">
      <div class="threshold-card threshold-card--wide">
        <RouterLink to="/houses" class="back-link"><AppIcon name="chevron-left" /> Your houses</RouterLink>

        <section class="card">
          <p class="eyebrow">The first decision</p>
          <h1>Form a sovereign house</h1>
          <p class="muted">
            Forming a house does not use a template and does not join the lattice. Those are separate decisions, made
            later or never.
          </p>

          <form class="form-grid" @submit.prevent="submit">
            <div class="field">
              <label class="field-label" for="house-name">House name</label>
              <input
                id="house-name"
                v-model="name"
                class="field-control"
                type="text"
                required
                maxlength="80"
                placeholder="e.g. The Now"
                autocomplete="off"
              />
            </div>

            <div class="field">
              <label class="field-label" for="house-slug">URL slug</label>
              <input
                id="house-slug"
                v-model="slug"
                class="field-control field-control--mono"
                type="text"
                required
                maxlength="64"
                pattern="[a-z0-9\-]+"
                placeholder="the-now"
                autocomplete="off"
                @input="onSlugInput"
              />
              <p class="field-hint">mutualhouse.org/house/<strong>{{ cleanSlug || '…' }}</strong></p>
            </div>

            <div class="field">
              <label class="field-label" for="house-coords">Provenance coordinates <span class="muted">(optional)</span></label>
              <input
                id="house-coords"
                v-model="coordinates"
                class="field-control field-control--mono"
                type="text"
                maxlength="16"
                placeholder="e.g. 0002"
                autocomplete="off"
              />
              <p class="field-hint">Numbering is a deliberate decision, not an assumption.</p>
            </div>

            <div class="field field--full">
              <label class="field-label" for="house-purpose">Initial purpose <span class="muted">(optional)</span></label>
              <textarea
                id="house-purpose"
                v-model="purpose"
                class="field-control field-control--serif"
                rows="3"
                maxlength="600"
                placeholder="What this house gathers to practice — or leave it open."
              ></textarea>
            </div>

            <div class="panel panel--sunken field--full">
              <p class="label">Blank by default</p>
              <p class="field-hint">
                Authorship, Provenance, Categories and the House Constitution all begin empty. The house fills each
                one itself, when it is ready, from Housekeeping.
              </p>
            </div>

            <p v-if="error" class="form-error field--full" role="alert">{{ error }}</p>

            <div class="action-row action-row--end field--full">
              <RouterLink to="/houses" class="quiet-btn">Cancel</RouterLink>
              <button type="submit" class="pill pill--primary" :disabled="!canSubmit">
                {{ busy ? 'Forming…' : 'Form this house' }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  </div>
</template>
