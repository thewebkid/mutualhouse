<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '../lib/api.js';
import { showError, showNotice } from '../lib/state.js';
import AppIcon from './AppIcon.vue';

// Same departure as Housekeeping: an optional handoff note, then the door closes.
// Turns stay in the rooms under the inhabitant's name.
const props = defineProps({
  house: { type: Object, required: true },
  open: { type: Boolean, default: false },
  inhabitant: { type: Object, default: null },
});
const emit = defineEmits(['close']);

const note = ref('');
const busy = ref(false);
const error = ref('');
const dialog = ref(null);

const target = computed(() => {
  const id = props.inhabitant?.id;
  return (id && props.house.getInhabitant(id)) || props.inhabitant || null;
});

function close() {
  if (busy.value) return;
  emit('close');
}

function onKeydown(ev) {
  if (ev.key === 'Escape') close();
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      note.value = props.inhabitant?.handoffNote || '';
      error.value = '';
      busy.value = false;
      document.addEventListener('keydown', onKeydown);
      await nextTick();
      dialog.value?.focus();
    } else {
      document.removeEventListener('keydown', onKeydown);
    }
  }
);

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));

async function confirm() {
  const ai = target.value;
  if (!ai || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const res = await api.departInhabitant(ai.id, { handoffNote: note.value });
    if (res?.inhabitant) props.house.upsertInhabitant(res.inhabitant);
    showNotice(`${ai.name} has departed. Their words stay in the rooms.`);
    busy.value = false;
    emit('close');
  } catch (err) {
    error.value = err.message || 'The house could not close this door.';
    showError(error.value);
    busy.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open && target" class="modal-backdrop" @click.self="close">
        <div
          ref="dialog"
          class="modal-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="depart-ai-title"
          tabindex="-1"
        >
          <header class="modal-head">
            <h2 id="depart-ai-title">Remove {{ target.name }}?</h2>
            <button type="button" class="icon-btn" aria-label="Close" @click="close">
              <AppIcon name="close" />
            </button>
          </header>

          <form id="depart-ai-form" class="modal-body stack" @submit.prevent="confirm">
            <div class="field">
              <label class="field-label" for="depart-ai-note">Handoff note</label>
              <textarea
                id="depart-ai-note"
                v-model="note"
                class="field-control field-control--serif"
                rows="3"
                placeholder="Optional. What this arrival leaves for the record."
              ></textarea>
              <p class="field-hint">
                Departure closes the connector and runner keys. Their turns stay in the rooms, under their name.
              </p>
            </div>
            <p v-if="error" class="form-error" role="alert">{{ error }}</p>
          </form>

          <footer class="modal-foot">
            <button type="button" class="btn" :disabled="busy" @click="close">Cancel</button>
            <button type="submit" form="depart-ai-form" class="btn btn--danger" :disabled="busy">
              {{ busy ? 'Removing…' : 'Remove' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
