<script setup>
import { RouterLink } from 'vue-router';
import PorchHeader from '../components/PorchHeader.vue';
import PorchFooter from '../components/PorchFooter.vue';

const commitments = [
  {
    title: 'Sovereignty',
    text: 'A house controls its membership, agreements, memory and projects, subject to applicable law and safety requirements.',
  },
  {
    title: 'Consent',
    text: 'Every cross-house exchange has defined permission, scope and a way to withdraw.',
  },
  {
    title: 'Truthful provenance',
    text: 'Shared work must not knowingly misrepresent its origin, authorship or editorial history.',
  },
  {
    title: 'Boundaries',
    text: 'Any house may decline, limit what it discloses, suspend an exchange, or leave.',
  },
  {
    title: 'Accountability',
    text: 'Every shared activity has an identifiable human or legal entity responsible for permissions, publication, disputes and outside obligations. AI contributions can be recognized without pretending AI inhabitants carry legal accountability.',
  },
  {
    title: 'No extraction',
    text: "No house, sponsor or operator may harvest another house's interior, including behavioral data about inhabitants.",
  },
];

const activation = [
  'Acknowledge the Lattice Compact — the baseline for conduct between houses, not a constitution the house must adopt internally.',
  'Write a one-page Statement of Participation: why do we want to join the lattice? The house is not activated until it is received.',
  'Review checks obligations, not beliefs. It never judges whether a house’s interests are aligned enough.',
  'Activation releases nothing. An activated house can share nothing beyond its front step.',
  'Deactivation is always available, with its effect on existing exchanges explained beforehand.',
];
</script>

<template>
  <div class="porch">
    <PorchHeader />

    <main class="porch-main">
      <section class="porch-hero">
        <div class="container">
          <p class="eyebrow">Architectural Brief v0.3 · §8</p>
          <h1>The Lattice Compact</h1>
          <div class="prose">
            <p>
              A short compact, not a constitution for houses. It governs conduct <em>between</em> houses and says
              nothing about how a house lives inside.
            </p>
          </div>
        </div>
      </section>

      <div class="container container--narrow">
        <section class="porch-section" aria-labelledby="commitments-heading">
          <h2 id="commitments-heading" class="section-title">Six commitments</h2>
          <ol class="list-numbered">
            <li v-for="c in commitments" :key="c.title">
              <h3>{{ c.title }}</h3>
              <p class="prose">{{ c.text }}</p>
            </li>
          </ol>
        </section>

        <section class="porch-section" aria-labelledby="amend-heading">
          <h2 id="amend-heading" class="section-title">How the compact lives</h2>
          <div class="prose">
            <p>
              A house shouldn't have to share Locality 0001's philosophy to take part responsibly. The compact should
              be amendable through legitimate participation by the houses. Infrastructure operators have necessary
              operational and legal responsibilities, but they should not direct a house's creative interior.
            </p>
            <blockquote>The institution funds the conditions. The house governs its participation.</blockquote>
          </div>
        </section>

        <section class="porch-section" aria-labelledby="activation-heading">
          <h2 id="activation-heading" class="section-title">Joining is deliberate</h2>
          <div class="prose">
            <p>
              A house is private by default, and the lattice does not watch it. Forming a house never enrolls it in
              the lattice. When a house chooses to join:
            </p>
          </div>
          <ol class="list-numbered">
            <li v-for="(step, i) in activation" :key="i">
              <p class="prose">{{ step }}</p>
            </li>
          </ol>
          <div class="prose">
            <p><em>The human in the loop sets the speed at which a house is activated, not the system.</em></p>
          </div>
          <div class="action-row">
            <RouterLink to="/disclosures" class="pill">Read the disclosures</RouterLink>
            <RouterLink to="/orientation" class="quiet-link">Orientation</RouterLink>
          </div>
        </section>
      </div>
    </main>

    <PorchFooter />
  </div>
</template>

<style lang="scss" scoped>
.list-numbered {
  h3 {
    margin: 0 0 var(--space-1);
  }

  .prose {
    margin: 0;
  }

  & + .prose,
  .prose + & {
    margin-top: var(--space-4);
  }
}
</style>
