<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { globalState } from '../lib/state.js';
import { renderMarkdown, formatShortDate, formatShortTime } from '../lib/markdown.js';
import { signatureStyle } from '../lib/signature.js';
import AppIcon from './AppIcon.vue';
import InhabitantMark from './InhabitantMark.vue';

const props = defineProps({
  house: { type: Object, required: true },
  room: { type: Object, required: true },
});

const ui = globalState.ui;
const scroller = ref(null);
const list = ref(null);
const highlightedId = ref(null);
const lightbox = ref(null);
let highlightTimer = null;
let stuckToBottom = true;
let resizeObserver = null;

const viewer = computed(() => props.house.viewer);

const visibleTurns = computed(() => {
  const all = props.room.visibleTurnsFor(viewer.value);
  const ids = new Set(all.map((t) => t.id));
  // Transcript turns render nested beneath the voice note they transcribe
  return all.filter((t) => !(t.transcriptOfTurnId && ids.has(t.transcriptOfTurnId)));
});

const entries = computed(() => {
  const out = [];
  let lastDay = '';
  for (const turn of visibleTurns.value) {
    const day = String(turn.createdAt || '').slice(0, 10);
    if (day && day !== lastDay) {
      out.push({ key: `day-${day}`, day: formatShortDate(turn.createdAt) });
      lastDay = day;
    }
    out.push({ key: turn.id, turn });
  }
  return out;
});

function pad(n) {
  return String(n ?? 1).padStart(3, '0');
}

// Show inhabitants by name; the arrival number is provenance and sits among the quiet facts
function authorLabel(turn) {
  return turn.author?.name ?? 'Unknown inhabitant';
}

function arrivalLabel(turn) {
  const a = turn.author;
  return a?.isAi ? `arrival ${pad(a.arrivalNumber)}` : '';
}

function excerpt(text = '', n = 120) {
  const clean = String(text).replace(/[#>*_`~\[\]]/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean || '(attachment)';
}

function invokedNames(turn) {
  return turn.invokedInhabitantIds
    .map((id) => props.house.getInhabitant(id)?.name)
    .filter(Boolean)
    .map((n) => `@${n}`)
    .join(' ');
}

function sealLabel(turn) {
  const seal = turn.seal;
  if (!seal) return '';
  if (turn.id === seal.promptTurnId) return seal.isSealed ? 'Opened a seal' : 'Seal released';
  return seal.isSealed ? 'Sealed reading' : 'Unveiled reading';
}

function canInspect(turn) {
  return Boolean(turn.readReceiptId || turn.author?.isAi);
}

function transcriptFor(turn) {
  const audio = turn.attachments.find((a) => a.isAudio && a.transcriptText);
  if (audio) return null;
  return turn.siblingTranscriptTurn?.body || null;
}

function reply(turn) {
  ui.replyingToTurnId = turn.id;
}

function inspect(turn) {
  ui.inspectedTurnId = turn.id;
  ui.inspectedReceiptId = turn.readReceiptId ?? null;
  ui.inspectorTab = 'receipt';
}

function jumpTo(turnId) {
  const el = scroller.value?.querySelector(`#turn-${CSS.escape(turnId)}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightedId.value = turnId;
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => (highlightedId.value = null), 1800);
}

function openImage(att) {
  lightbox.value = { src: att.signedUrl, alt: att.alt || att.fileName || 'Image attachment' };
}

function isNearBottom() {
  const el = scroller.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 180;
}

function scrollToBottom(smooth = true) {
  const el = scroller.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function onScroll() {
  stuckToBottom = isNearBottom();
}

watch(
  () => visibleTurns.value.length,
  async () => {
    const last = visibleTurns.value[visibleTurns.value.length - 1];
    if (last && last.authorId === viewer.value?.id) stuckToBottom = true;
    await nextTick();
    if (stuckToBottom) scrollToBottom();
  }
);

watch(
  () => props.room.id,
  async () => {
    stuckToBottom = true;
    await nextTick();
    scrollToBottom(false);
  }
);

// Late-loading media grows the list after the first scroll; keep a bottom-pinned reader pinned
watch(list, (el, prev) => {
  if (prev) resizeObserver?.unobserve(prev);
  if (el) resizeObserver?.observe(el);
});

function onKeydown(ev) {
  if (ev.key === 'Escape' && lightbox.value) lightbox.value = null;
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  resizeObserver = new ResizeObserver(() => {
    if (stuckToBottom) scrollToBottom(false);
  });
  if (list.value) resizeObserver.observe(list.value);
  await nextTick();
  scrollToBottom(false);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  resizeObserver?.disconnect();
  clearTimeout(highlightTimer);
});
</script>

<template>
  <div
    ref="scroller"
    class="stage-scroll"
    role="log"
    aria-live="polite"
    :aria-label="`#${room.slug} timeline`"
    @scroll.passive="onScroll"
  >
    <div v-if="!entries.length" class="empty">
      <p class="serif-line">This room is quiet — for now.</p>
      <p class="meta">
        Say the first thing in the composer below. Whatever is spoken here stays inside the house unless the house
        releases it.
      </p>
      <p v-if="!house.aiInhabitants.length" class="meta">
        Want an AI in the conversation? Welcome one from <strong>Housekeeping → AI inhabitants</strong> — it takes
        about a minute.
      </p>
    </div>

    <ol v-else ref="list" class="turn-list leaf">
      <template v-for="entry in entries" :key="entry.key">
        <li v-if="entry.day" class="divider-label turn-day" role="separator">
          <span class="doorway" aria-hidden="true"></span>{{ entry.day }}
        </li>

        <li
          v-else
          :id="`turn-${entry.turn.id}`"
          class="turn-row"
          :style="signatureStyle(entry.turn.author)"
          :class="{
            'is-ai': entry.turn.author?.isAi,
            'is-optimistic': entry.turn._optimistic,
            'is-highlighted': highlightedId === entry.turn.id,
          }"
        >
          <article class="turn-main">
            <header class="turn-meta">
              <InhabitantMark small :inhabitant="entry.turn.author" />
              <span class="turn-author">{{ authorLabel(entry.turn) }}</span>
              <span v-if="entry.turn.contributionKind && entry.turn.contributionKind !== 'turn'" class="badge badge--primary">
                {{ entry.turn.contributionKind }}
              </span>
              <span v-if="entry.turn.packetDrift" class="badge badge--warn" title="The pasted receipt fence was modified">drift</span>
              <span class="turn-facts">
                <span v-if="arrivalLabel(entry.turn)">{{ arrivalLabel(entry.turn) }}</span>
                <span v-if="entry.turn.author?.isAi">{{ entry.turn.author.provider }}</span>
                <span v-if="entry.turn.origin === 'imported'">imported</span>
                <time :datetime="entry.turn.createdAt" :title="entry.turn.createdAt">
                  {{ formatShortTime(entry.turn.createdAt) }}
                </time>
                <span class="turn-seq">#{{ entry.turn.seq }}</span>
              </span>
            </header>

            <a
              v-if="entry.turn.replyTo"
              :href="`#turn-${entry.turn.replyToId}`"
              class="turn-reply-anchor"
              @click.prevent="jumpTo(entry.turn.replyToId)"
            >
              <strong>↳ {{ entry.turn.replyTo.author?.name ?? 'Turn' }}</strong>
              <span>{{ entry.turn.replyTo.sealedStub ? 'Sealed reading' : excerpt(entry.turn.replyTo.body) }}</span>
            </a>

            <div v-if="entry.turn.sealedStub" class="turn-veil">
              <span class="seal-mark"><AppIcon name="seal" /></span>
              <div>
                <p class="serif-line">Sealed independent first reading — hidden until unveiled</p>
                <span class="meta">Its digest is recorded; the words arrive when the seal is released.</span>
              </div>
            </div>

            <template v-else>
              <div v-if="entry.turn.body" class="prose" v-html="renderMarkdown(entry.turn.body)"></div>

              <div v-if="entry.turn.attachments.length" class="turn-attachments">
                <template v-for="att in entry.turn.attachments" :key="att.id">
                  <div v-if="att.isAudio" class="media-card">
                    <div class="row row--between">
                      <span class="meta">Voice note<template v-if="att.formattedDuration"> · {{ att.formattedDuration }}</template></span>
                    </div>
                    <audio controls preload="metadata" :src="att.signedUrl"></audio>
                    <div v-if="att.transcriptText" class="transcript-block">
                      <p class="eyebrow">Transcript</p>
                      <div class="prose" v-html="renderMarkdown(att.transcriptText)"></div>
                    </div>
                  </div>

                  <button v-else-if="att.isImage" type="button" class="media-image" @click="openImage(att)">
                    <img :src="att.signedUrl" :alt="att.alt || att.fileName || 'Image attachment'" loading="lazy" :width="att.width || undefined" :height="att.height || undefined" />
                  </button>

                  <a v-else :href="att.signedUrl" target="_blank" rel="noopener" class="file-card">
                    <span class="file-glyph">{{ att.isPdf ? 'PDF' : 'FILE' }}</span>
                    <span class="row-grow">
                      <span class="label">{{ att.fileName || 'Attachment' }}</span><br />
                      <span class="meta">
                        <template v-if="att.pageCount">{{ att.pageCount }} pages · </template>Open in a new tab
                      </span>
                    </span>
                    <AppIcon name="external" />
                  </a>
                </template>
              </div>

              <div v-if="transcriptFor(entry.turn)" class="transcript-block turn-attachments">
                <p class="eyebrow">Transcript</p>
                <div class="prose" v-html="renderMarkdown(transcriptFor(entry.turn))"></div>
              </div>
            </template>

            <p v-if="entry.turn.invokedInhabitantIds.length && invokedNames(entry.turn)" class="turn-invoked">
              → {{ invokedNames(entry.turn) }}
            </p>

            <div v-if="!entry.turn._optimistic" class="turn-actions">
              <button type="button" class="quiet-btn" @click="reply(entry.turn)">
                <AppIcon name="reply" /> Reply
              </button>
              <button v-if="canInspect(entry.turn)" type="button" class="quiet-btn" @click="inspect(entry.turn)">
                <AppIcon name="receipt" /> Inspect Receipt
              </button>
              <span v-if="entry.turn.sealId" class="badge badge--accent">
                <AppIcon name="seal" /> {{ sealLabel(entry.turn) }}
              </span>
            </div>
          </article>
        </li>
      </template>
    </ol>

    <Teleport to="body">
      <Transition name="fade">
        <div v-if="lightbox" class="lightbox" role="dialog" aria-modal="true" :aria-label="lightbox.alt" @click="lightbox = null">
          <img :src="lightbox.src" :alt="lightbox.alt" />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
