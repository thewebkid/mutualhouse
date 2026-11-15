<script setup>
import { RouterLink } from 'vue-router';
</script>

<template>
  <footer class="porch-footer">
    <div class="container porch-footer-grid">
      <div>
        <p class="serif-line">
          <em>Protect the idea from becoming a platform before it becomes a practice.</em>
        </p>
        <p class="meta">
          A household-scale laboratory for mutual civilization. Private by default — nothing leaves a house
          unless the house releases it.
        </p>
      </div>
      <nav aria-label="Read">
        <h2>Read</h2>
        <ul>
          <li><RouterLink to="/orientation">Orientation</RouterLink></li>
          <li><RouterLink to="/compact">The Lattice Compact</RouterLink></li>
          <li><RouterLink to="/disclosures">Disclosures</RouterLink></li>
        </ul>
      </nav>
      <nav aria-label="Enter">
        <h2>Enter</h2>
        <ul>
          <li><RouterLink to="/sign-in">Sign in</RouterLink></li>
          <li><RouterLink to="/houses/new">Form a house</RouterLink></li>
          <li><RouterLink to="/houses">My houses</RouterLink></li>
        </ul>
      </nav>
    </div>
  </footer>
</template>
