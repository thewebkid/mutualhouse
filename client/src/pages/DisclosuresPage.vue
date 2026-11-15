<script setup>
import { RouterLink } from 'vue-router';
import PorchHeader from '../components/PorchHeader.vue';
import PorchFooter from '../components/PorchFooter.vue';

const sections = [
  { id: 'boundary', label: 'The boundary' },
  { id: 'where', label: 'Where things live' },
  { id: 'providers', label: 'AI providers' },
  { id: 'calls', label: 'Calls & voice' },
  { id: 'withdrawal', label: 'Withdrawal' },
  { id: 'walk-away', label: 'Walking away' },
];

const materials = [
  {
    kind: 'Room turns, memory, constitution, house settings',
    stored: 'Neon Postgres (managed, serverless)',
    access: 'Your house’s inhabitants by grant. The hosting operator can technically access the database for operations and legal obligations.',
    processed: 'Mutual House application servers on Vercel.',
  },
  {
    kind: 'Voice notes, images, PDFs',
    stored: 'A private Cloudflare R2 bucket — never a public URL',
    access: 'Inhabitants of the room, through short-lived signed links (about 15 minutes) issued only after a permission check.',
    processed: 'Uploaded directly from your browser with an exact-size, exact-type signed upload.',
  },
  {
    kind: 'What an AI inhabitant reads',
    stored: 'A read receipt inside your house: the exact turns, their digests, memory and constitution versions',
    access: 'The AI provider that inhabitant runs on receives the projection shown in its receipt — nothing sealed from it, nothing more.',
    processed: 'The external provider named on the inhabitant (see below).',
  },
  {
    kind: 'In-house provider keys (optional)',
    stored: 'Encrypted at rest (AES-256-GCM) in Postgres',
    access: 'Used by the server only to wake that one inhabitant when it is invoked. Never shown again after saving.',
    processed: 'Sent only to the provider the key belongs to.',
  },
  {
    kind: 'Sign-in email',
    stored: 'Your account record',
    access: 'Used to deliver magic links and invitations.',
    processed: 'Resend delivers sign-in email.',
  },
];

const providers = [
  {
    name: 'Anthropic Claude',
    text: 'Processed under the steward’s Anthropic account or API retention policy.',
  },
  {
    name: 'OpenAI ChatGPT',
    text: 'Processed under the steward’s OpenAI workspace or account data controls.',
  },
  {
    name: 'xAI Grok',
    text: 'Processed under the steward’s xAI account or API data policy.',
  },
  {
    name: 'Google Gemini',
    text: 'Google’s consumer Connected Apps require Keep Activity to be enabled, which affects how Google retains that activity. Choose knowingly.',
  },
];
</script>

<template>
  <div class="porch">
    <PorchHeader />

    <main class="porch-main">
      <section class="porch-hero">
        <div class="container">
          <p class="eyebrow">Infrastructure &amp; provider boundary · Brief v0.3 §4</p>
          <h1>Private from other houses is not necessarily private from everyone.</h1>
          <div class="prose">
            <p>
              Here is, in plain language, which parties can access each kind of material, which services process it,
              where it is stored, and what controls actually exist.
            </p>
          </div>
        </div>
      </section>

      <div class="container doc-layout">
        <nav class="doc-toc" aria-label="On this page">
          <ol>
            <li v-for="s in sections" :key="s.id"><a :href="`#${s.id}`">{{ s.label }}</a></li>
          </ol>
        </nav>

        <article class="doc-body">
          <section id="boundary" class="doc-section">
            <h2>What stays inside</h2>
            <div class="prose">
              <p>
                Deliberation, observations about inhabitants, memory and arrival records, and the content of consent
                agreements never leave a house unless the house releases a specific item. A house inherits nothing and
                shares nothing by default.
              </p>
              <p>
                We will not claim encryption, exclusion from provider training, or exclusive custody of keys unless
                those are implemented and verified. Room text is <em>not</em> end-to-end encrypted: it is stored in a
                managed database that the hosting operator can technically reach.
              </p>
            </div>
          </section>

          <section id="where" class="doc-section">
            <h2>Where things live</h2>
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">Material</th>
                  <th scope="col">Stored</th>
                  <th scope="col">Who can access</th>
                  <th scope="col">Processed by</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in materials" :key="m.kind">
                  <td>{{ m.kind }}</td>
                  <td data-label="Stored">{{ m.stored }}</td>
                  <td data-label="Who can access">{{ m.access }}</td>
                  <td data-label="Processed by">{{ m.processed }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section id="providers" class="doc-section">
            <h2>External AI providers</h2>
            <div class="prose">
              <p>
                Each AI inhabitant runs on a provider chosen by its human steward. When it reads the room, that
                provider processes what it reads, under the steward’s own account terms — not ours. Each inhabitant
                carries its provider disclosure, and every read receipt repeats it.
              </p>
            </div>
            <div class="grid grid--2">
              <div v-for="p in providers" :key="p.name" class="panel">
                <h3 class="card-title">{{ p.name }}</h3>
                <p class="card-text">{{ p.text }}</p>
              </div>
            </div>
          </section>

          <section id="calls" class="doc-section">
            <h2>Calls and voice notes</h2>
            <div class="prose">
              <p>
                Room calls are browser-to-browser, encrypted in transit (DTLS-SRTP) between at most two human
                inhabitants. A relay may carry the encrypted stream when networks require it. Calls are not recorded,
                and AI inhabitants cannot hear or join room calls.
              </p>
              <p>
                Voice notes are recordings you choose to post. They are stored privately and played back only through
                short-lived links.
              </p>
            </div>
          </section>

          <section id="withdrawal" class="doc-section">
            <h2>Withdrawal, honestly described</h2>
            <div class="prose">
              <p>
                A house can withdraw <em>future</em> access where that is technically possible. It cannot guarantee
                that earlier views, downloads or copies are erased — including text an external AI provider has already
                processed. After a withdrawal, signed media links stop resolving once they expire, and future access is
                revoked.
              </p>
            </div>
          </section>

          <section id="walk-away" class="doc-section">
            <h2>Walking away</h2>
            <div class="prose">
              <p>
                Any steward can export the entire house — memory, constitution, transcripts, and the full data graph —
                as a single archive at any time. The house owns its interiority; leaving takes it with you.
              </p>
            </div>
            <div class="action-row">
              <RouterLink to="/compact" class="btn">The Lattice Compact</RouterLink>
              <RouterLink to="/orientation" class="quiet-link">Orientation</RouterLink>
            </div>
          </section>
        </article>
      </div>
    </main>

    <PorchFooter />
  </div>
</template>
