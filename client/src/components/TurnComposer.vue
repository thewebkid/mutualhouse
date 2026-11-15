<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { resolveMentionedInhabitantIds } from '@shared/lib/mentions.js';
import { globalState, showError } from '../lib/state.js';
import { postRoomTurn, sendTempoPulse, uploadRoomFile } from '../lib/mut/house-orchestration.js';
import {
  cancelVoiceRecording,
  finishAndSendVoiceRecording,
  startVoiceRecording,
} from '../lib/media-recorder.js';
import AppIcon from './AppIcon.vue';

const props = defineProps({
  house: { type: Object, required: true },
  room: { type: Object, required: true },
});

const KINDS = ['turn', 'proposal', 'draft', 'critique', 'decision'];

const ui = globalState.ui;
const voice = globalState.voice;

const input = ref(null);
const fileInput = ref(null);
const body = ref('');
const kind = ref('turn');
const invoked = ref([]);
const sealMode = ref('none');
const showSeal = ref(false);
const pending = ref([]);
const uploading = ref(false);
const sending = ref(false);

const ais = computed(() => props.house.aiInhabitants);
const activeSeal = computed(() => props.room.latestActiveSeal);
const replyTarget = computed(() => (ui.replyingToTurnId ? props.room.getTurn(ui.replyingToTurnId) : null));
const canSend = computed(
  () => !sending.value && !uploading.value && (body.value.trim().length > 0 || pending.value.length > 0)
);
const voiceBusy = computed(() => voice.recording || voice.uploading);
const voiceTime = computed(() => {
  const total = Math.floor((voice.durationMs || 0) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
});
const sealSummary = computed(() => {
  if (sealMode.value === 'peer_sealed') return 'Peer-sealed';
  if (sealMode.value === 'blind_simultaneous') return 'Blind simultaneous';
  if (sealMode.value === 'attach') return 'Inside open seal';
  return '';
});

watch(
  () => ui.replyingToTurnId,
  async (id) => {
    if (!id) return;
    await nextTick();
    input.value?.focus();
  }
);

watch(
  () => props.room.id,
  () => {
    body.value = '';
    invoked.value = [];
    sealMode.value = 'none';
    pending.value = [];
    resize();
  }
);

function resize() {
  const el = input.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function toggleInvoke(id) {
  const i = invoked.value.indexOf(id);
  if (i >= 0) invoked.value.splice(i, 1);
  else invoked.value.push(id);
}

function addressedIds() {
  const mentioned = resolveMentionedInhabitantIds(body.value, ais.value);
  return [...new Set([...invoked.value, ...mentioned])];
}

function buildRouting() {
  const aiIds = ais.value.map((a) => a.id);
  const addressed = addressedIds();
  let openSeal = null;
  let sealId = null;
  if (sealMode.value === 'peer_sealed' || sealMode.value === 'blind_simultaneous') {
    openSeal = {
      mode: sealMode.value,
      targetInhabitantIds: addressed.length ? [...addressed] : aiIds,
    };
  } else if (sealMode.value === 'attach' && activeSeal.value) {
    sealId = activeSeal.value.id;
  }
  const invokedInhabitantIds = openSeal && !addressed.length ? openSeal.targetInhabitantIds : [...addressed];
  return { openSeal, sealId, invokedInhabitantIds };
}

function resetAfterSend() {
  body.value = '';
  kind.value = 'turn';
  invoked.value = [];
  sealMode.value = 'none';
  showSeal.value = false;
  pending.value = [];
  nextTick(resize);
}

async function send() {
  if (!canSend.value) return;
  const draft = {
    body: body.value.trim(),
    kind: kind.value,
    pending: [...pending.value],
  };
  const routing = buildRouting();
  sending.value = true;
  resetAfterSend();
  try {
    await postRoomTurn({
      body: draft.body,
      replyToId: ui.replyingToTurnId,
      contributionKind: draft.kind,
      attachmentIds: draft.pending.map((a) => a.id),
      ...routing,
    });
  } catch {
    body.value = draft.body;
    kind.value = draft.kind;
    pending.value = draft.pending;
    nextTick(resize);
  } finally {
    sending.value = false;
  }
}

function onKeydown(ev) {
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    send();
  }
}

function startRecording() {
  startVoiceRecording();
}

async function finishRecording() {
  const caption = body.value.trim();
  const routing = buildRouting();
  try {
    await finishAndSendVoiceRecording({
      caption,
      replyToId: ui.replyingToTurnId,
      ...routing,
    });
    resetAfterSend();
    ui.replyingToTurnId = null;
  } catch (err) {
    showError(err.message || 'The voice note could not be sent.');
  }
}

function pickFiles() {
  fileInput.value?.click();
}

async function onFiles(ev) {
  const files = Array.from(ev.target.files || []);
  ev.target.value = '';
  if (!files.length) return;
  uploading.value = true;
  try {
    for (const file of files) {
      const att = await uploadRoomFile(file);
      pending.value.push(att);
    }
  } catch (err) {
    showError(err.message || 'Upload failed.');
  } finally {
    uploading.value = false;
  }
}

function removePending(id) {
  pending.value = pending.value.filter((a) => a.id !== id);
}

async function pulse() {
  try {
    await sendTempoPulse([...invoked.value]);
  } catch (err) {
    showError(err.message);
  }
}

function excerpt(text = '') {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > 90 ? `${clean.slice(0, 90)}…` : clean || '(attachment)';
}
</script>

<template>
  <section class="composer" aria-label="Compose a turn">
    <div class="composer-inner">
      <div v-if="replyTarget" class="composer-banner">
        <AppIcon name="reply" />
        <span>
          Replying to <strong>{{ replyTarget.author?.name ?? 'turn' }}</strong> ·
          {{ replyTarget.sealedStub ? 'sealed reading' : excerpt(replyTarget.body) }}
        </span>
        <button type="button" class="icon-btn" aria-label="Cancel reply" @click="ui.replyingToTurnId = null">
          <AppIcon name="close" />
        </button>
      </div>

      <div v-if="ais.length" class="chip-row" role="group" aria-label="Invoke AI inhabitants">
        <button
          v-for="a in ais"
          :key="a.id"
          type="button"
          class="chip"
          :class="{ 'is-active': addressedIds().includes(a.id) }"
          :aria-pressed="addressedIds().includes(a.id)"
          :title="`${a.presenceLabel} · ${a.provider}`"
          @click="toggleInvoke(a.id)"
        >
          @{{ a.name }}
        </button>
      </div>

      <fieldset v-if="showSeal && ais.length" class="composer-options">
        <legend class="visually-hidden">Seal this turn</legend>
        <label class="toggle-row">
          <input v-model="sealMode" type="radio" value="none" />
          <span class="toggle-text">No seal</span>
        </label>
        <label class="toggle-row">
          <input v-model="sealMode" type="radio" value="peer_sealed" />
          <span class="toggle-text">
            Open sealed first reading
            <small>Peer-sealed: AI peers read independently</small>
          </span>
        </label>
        <label class="toggle-row">
          <input v-model="sealMode" type="radio" value="blind_simultaneous" />
          <span class="toggle-text">
            Blind simultaneous
            <small>Hidden from everyone until all respond</small>
          </span>
        </label>
        <label v-if="activeSeal" class="toggle-row">
          <input v-model="sealMode" type="radio" value="attach" />
          <span class="toggle-text">
            Respond inside the open seal
            <small>Your turn joins the sealed readings</small>
          </span>
        </label>
        <p v-if="sealMode === 'peer_sealed' || sealMode === 'blind_simultaneous'" class="meta">
          Targets: {{ invoked.length ? 'the invoked inhabitants' : 'every AI inhabitant' }}.
        </p>
      </fieldset>

      <div v-if="voiceBusy" class="voice-bar" aria-live="polite">
        <span class="voice-dot" aria-hidden="true"></span>
        <span class="voice-time">{{ voice.uploading ? 'Sending' : voiceTime }}</span>
        <span class="level-meter" aria-hidden="true">
          <span class="level-fill" :style="{ transform: `scaleX(${Math.max(0.03, voice.level)})` }"></span>
        </span>
        <button
          type="button"
          class="icon-btn"
          aria-label="Discard voice note"
          :disabled="voice.uploading"
          @click="cancelVoiceRecording"
        >
          <AppIcon name="trash" />
        </button>
        <button
          type="button"
          class="btn btn--sm btn--primary"
          :disabled="voice.uploading"
          @click="finishRecording"
        >
          {{ voice.uploading ? 'Sending…' : 'Send voice' }}
        </button>
      </div>

      <div v-if="pending.length || uploading" class="attach-strip">
        <span v-for="a in pending" :key="a.id" class="chip is-active">
          {{ a.fileName || a.kind }}
          <button type="button" class="chip-x quiet-btn" :aria-label="`Remove ${a.fileName || 'attachment'}`" @click="removePending(a.id)">×</button>
        </span>
        <span v-if="uploading" class="meta">Uploading…</span>
      </div>

      <div class="composer-box">
        <label class="visually-hidden" for="composer-input">Your turn in {{ room.name }}</label>
        <textarea
          id="composer-input"
          ref="input"
          v-model="body"
          class="composer-input"
          rows="1"
          :placeholder="voice.recording ? 'Add a caption (optional)…' : `Add to ${room.name}…`"
          @input="resize"
          @keydown="onKeydown"
        ></textarea>

        <div class="composer-tools">
          <input
            ref="fileInput"
            type="file"
            class="visually-hidden"
            accept="image/*,application/pdf,audio/*"
            multiple
            tabindex="-1"
            aria-hidden="true"
            @change="onFiles"
          />
          <button type="button" class="icon-btn" aria-label="Attach image, PDF or audio" title="Attach" :disabled="uploading" @click="pickFiles">
            <AppIcon name="paperclip" />
          </button>
          <button
            type="button"
            class="icon-btn"
            :class="{ 'is-active': voice.recording }"
            aria-label="Record a voice note"
            title="Voice note"
            :disabled="voiceBusy"
            @click="startRecording"
          >
            <AppIcon name="mic" />
          </button>
          <button
            v-if="ais.length"
            type="button"
            class="icon-btn"
            :class="{ 'is-active': sealMode !== 'none' }"
            :aria-expanded="showSeal"
            aria-label="Seal options"
            :title="sealSummary || 'Seal options'"
            @click="showSeal = !showSeal"
          >
            <AppIcon name="seal" />
          </button>
          <label class="visually-hidden" for="composer-kind">Contribution kind</label>
          <select id="composer-kind" v-model="kind" class="field-control field-control--sm kind-select">
            <option v-for="k in KINDS" :key="k" :value="k">{{ k === 'turn' ? 'Turn' : k[0].toUpperCase() + k.slice(1) }}</option>
          </select>
          <span v-if="sealSummary" class="badge badge--accent hide-phone">{{ sealSummary }}</span>

          <div class="composer-send">
            <span class="meta hide-phone">Ctrl ↵</span>
            <button
              v-if="ais.length"
              type="button"
              class="icon-btn icon-btn--outline"
              title="Tempo pulse (.)"
              aria-label="Send tempo pulse"
              @click="pulse"
            >
              <AppIcon name="pulse" />
            </button>
            <button type="button" class="btn btn--sm btn--primary" :disabled="!canSend" @click="send">
              Send <AppIcon name="send" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
