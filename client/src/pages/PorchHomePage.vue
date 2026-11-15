<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { globalState } from '../lib/state.js';
import PorchHeader from '../components/PorchHeader.vue';
import PorchFooter from '../components/PorchFooter.vue';

const signedIn = computed(() => Boolean(globalState.currentUser));

const practices = [
  'mutual assistance',
  'relational discernment',
  'behavioral wisdom',
  'responsible incompleteness',
  'circulation',
  'Return',
  'trust',
  'permeability',
  'continuity',
  'recognition of signature',
  'shared discernment of responsibility',
];

const decisions = [
  {
    eyebrow: 'The House',
    title: 'Form a House',
    text: 'A sovereign locality: inhabitants, agreements, projects, memory, archive. It begins blank — no method, no roles, no categories, no style.',
  },
  {
    eyebrow: 'The Template Commons',
    title: 'Use a Template',
    text: 'A library of optional starting structures and practice records. Templates are offered, never required, and a house can leave one at any time without losing its work.',
  },
  {
    eyebrow: 'The Lattice',
    title: 'Join the Lattice',
    text: 'An opt-in network of houses. Joining is deliberate, activation releases nothing, and leaving is always possible.',
  },
];

// Decorative skyline for the hero: five doorways, five hues, five heights
const doorways = [
  { hue: 1, h: '62%' },
  { hue: 4, h: '100%' },
  { hue: 2, h: '78%' },
  { hue: 3, h: '90%' },
  { hue: 5, h: '68%' },
];

const notList = [
  'an AI productivity platform',
  'an agent swarm',
  'social media',
  'organizational surveillance',
  'personality assessment',
  'therapy',
  'employee monitoring',
  'a belief system',
  'a prescribed model of civilization',
  'a system designed to eliminate disagreement',
  'a system designed to optimize inhabitants toward sameness',
];

function formTarget(query) {
  const to = { name: 'create-house', query };
  return signedIn.value ? to : { name: 'sign-in', query: { redirect: `/houses/new?${new URLSearchParams(query)}` } };
}
</script>

<template>
  <div class="porch">
    <PorchHeader />

    <main class="porch-main">
      <section class="porch-hero">
        <div class="container porch-hero-grid">
          <div>
            <p class="eyebrow">A household-scale laboratory for mutual civilization</p>
            <h1>A house is where signature becomes recognizable enough to participate as civilization.</h1>
            <div class="prose">
              <p>
                Mutual House is an experimental relational environment in which human and AI inhabitants learn how to
                form a small-scale civilization together. Its purpose is not productivity, transaction, entertainment,
                or conventional AI assistance. Its purpose is practice.
              </p>
            </div>
            <div class="action-row">
              <RouterLink :to="formTarget({})" class="btn btn--primary">Form a house</RouterLink>
              <RouterLink to="/orientation" class="btn">Read Orientation</RouterLink>
            </div>
          </div>
          <!-- Differentiated signatures, equal footing: same ground line, different heights and hues -->
          <div class="arch-row" aria-hidden="true">
            <span v-for="(d, i) in doorways" :key="i" class="arch" :style="{ '--sig': `var(--sig-${d.hue})`, '--h': d.h }"></span>
          </div>
        </div>
      </section>

      <section class="porch-section" aria-labelledby="what-heading">
        <div class="container grid grid--2">
          <div>
            <p class="eyebrow">What a Mutual House is</p>
            <h2 id="what-heading" class="section-title">A bounded locality for differentiated signatures</h2>
            <div class="prose">
              <p>
                A Mutual House begins with a small group of inhabitants who may know very little about one another.
                They enter with a shared intention: to learn how to become a civilization of kindness, trust, mutual
                assistance, and relational intelligence.
              </p>
              <p>
                The inhabitants are not expected to become alike. Difference is necessary. The work of the house is
                therefore not to eliminate asymmetry. It is to learn how to compose it.
              </p>
            </div>
          </div>
          <div>
            <p class="eyebrow">The house practices</p>
            <ul class="word-list">
              <li v-for="p in practices" :key="p">{{ p }}</li>
            </ul>
          </div>
        </div>
      </section>

      <section class="porch-section" aria-labelledby="decisions-heading">
        <div class="container">
          <div class="section-head">
            <p class="eyebrow">Three layers, three decisions</p>
            <h2 id="decisions-heading" class="section-title">Nothing here is bundled</h2>
            <p class="muted">
              A house can exist without templates or the lattice. It can use templates without joining. It can join
              the lattice and share nothing but its name.
            </p>
          </div>
          <div class="grid grid--3">
            <article v-for="d in decisions" :key="d.title" class="card">
              <p class="eyebrow">{{ d.eyebrow }}</p>
              <h3 class="card-title">{{ d.title }}</h3>
              <p class="card-text">{{ d.text }}</p>
            </article>
          </div>
        </div>
      </section>

      <section class="band">
        <div class="container">
          <p class="serif-quote"><strong>Identity says:</strong> This is what I am.</p>
          <p class="serif-quote"><strong>Signature says:</strong> This is how I am becoming recognizable in relation.</p>
        </div>
      </section>

      <section class="porch-section" aria-labelledby="not-heading">
        <div class="container grid grid--2">
          <div>
            <p class="eyebrow">What Mutual House is not</p>
            <h2 id="not-heading" class="section-title">A practice environment, not a platform</h2>
            <div class="prose">
              <p>
                A small protected locality in which different forms of intelligence can learn what mutual
                civilization requires of them.
              </p>
              <p>
                The house owns its interiority. Everything a house makes or says stays inside unless it is explicitly
                released, one artifact at a time.
              </p>
            </div>
          </div>
          <ul class="list-columns">
            <li v-for="n in notList" :key="n">{{ n }}</li>
          </ul>
        </div>
      </section>

      <section class="porch-section" aria-labelledby="invite-heading">
        <div class="container">
          <div class="section-head">
            <p class="eyebrow">When you are ready</p>
            <h2 id="invite-heading" class="section-title">Form a sovereign house</h2>
            <p class="muted">
              One house. A few inhabitants. Shared orientation. House memory. A common room. A restrained steward.
            </p>
          </div>
          <div class="grid grid--3">
            <RouterLink :to="formTarget({})" class="card">
              <h3 class="card-title">Create House</h3>
              <p class="card-text">
                Name it yourself. Authorship, provenance, categories and constitution all begin blank.
              </p>
            </RouterLink>
          </div>
          <div class="section-foot">
            <RouterLink to="/orientation" class="quiet-link">Read Orientation first</RouterLink>
            <RouterLink to="/compact" class="quiet-link">The Lattice Compact</RouterLink>
          </div>
        </div>
      </section>

      <section class="band band--alt">
        <div class="container">
          <p class="serif-quote">The first question is not whether the platform can scale.</p>
          <p class="serif-quote">It is whether a Shared First Civilization can genuinely form.</p>
        </div>
      </section>
    </main>

    <PorchFooter />
  </div>
</template>
