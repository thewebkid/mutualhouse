<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { showError, showNotice } from '../lib/state.js';
import { updateInhabitantProfile, uploadInhabitantAvatar } from '../lib/mut/house-orchestration.js';
import AppIcon from './AppIcon.vue';
import InhabitantMark from './InhabitantMark.vue';

// Anyone can read a profile. A human edits their own; an AI is edited by whoever tends it.
const props = defineProps({
  house: { type: Object, required: true },
  inhabitant: { type: Object, default: null },
  open: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);

const editing = ref(false);
const busy = ref('');
const dialog = ref(null);
const hobbyText = ref('');
const draft = reactive({ name: '', bio: '', hobbies: [], signatureNotes: '', useGravatar: true });

// The live record, so a new picture shows as soon as the house has it
const target = computed(() => (props.inhabitant ? props.house.getInhabitant(props.inhabitant.id) || props.inhabitant : null));
const viewer = computed(() => props.house.viewer);
const isAi = computed(() => target.value?.kind === 'ai');
const canEdit = computed(() => {
  const v = viewer.value;
  const t = target.value;
  if (!v || !t) return false;
  if (!isAi.value) return v.id === t.id;
  return Boolean(v.isHuman && (v.can('house.manage') || t.stewardInhabitantId === v.id));
});
const steward = computed(() => (isAi.value ? props.house.getInhabitant(target.value.stewardInhabitantId) : null));
const kindLine = computed(() => {
  const t = target.value;
  if (!t) return '';
  if (isAi.value) return `AI · ${t.provider}${steward.value ? ` · tended by ${steward.value.name}` : ''}`;
  return t.roleLabel || 'human';
});

function hydrate() {
  const t = target.value;
  if (!t) return;
  draft.name = t.name ?? '';
  draft.bio = t.bio ?? '';
  draft.hobbies = [...(t.hobbies ?? [])];
  draft.signatureNotes = t.signatureNotes ?? '';
  draft.useGravatar = t.useGravatar !== false;
  hobbyText.value = '';
}

function close() {
  emit('close');
}

function onKeydown(ev) {
  if (ev.key === 'Escape') close();
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      editing.value = false;
      hydrate();
      document.addEventListener('keydown', onKeydown);
      await nextTick();
      dialog.value?.focus();
    } else {
      document.removeEventListener('keydown', onKeydown);
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));

function startEdit() {
  hydrate();
  editing.value = true;
}

function addHobby() {
  const word = hobbyText.value.replace(/,/g, ' ').trim();
  hobbyText.value = '';
  if (!word) return;
  if (draft.hobbies.some((h) => h.toLowerCase() === word.toLowerCase())) return;
  draft.hobbies.push(word.slice(0, 40));
}

function hobbyKey(ev) {
  if (ev.key === 'Enter' || ev.key === ',') {
    ev.preventDefault();
    addHobby();
  } else if (ev.key === 'Backspace' && !hobbyText.value && draft.hobbies.length) {
    draft.hobbies.pop();
  }
}

function removeHobby(i) {
  draft.hobbies.splice(i, 1);
}

async function pickPicture(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file || !target.value) return;
  busy.value = 'picture';
  try {
    await uploadInhabitantAvatar(target.value.id, file);
    showNotice('Picture saved.');
  } catch (err) {
    showError(err.message);
  } finally {
    busy.value = '';
  }
}

async function save() {
  addHobby();
  const name = draft.name.trim();
  if (!name || !target.value) return;
  busy.value = 'save';
  try {
    await updateInhabitantProfile(target.value.id, {
      name,
      bio: draft.bio,
      hobbies: [...draft.hobbies],
      ...(isAi.value ? { signatureNotes: draft.signatureNotes } : { useGravatar: draft.useGravatar }),
    });
    showNotice('Profile saved.');
    editing.value = false;
  } catch (err) {
    showError(err.message);
  } finally {
    busy.value = '';
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
          aria-labelledby="inhabitant-profile-title"
          tabindex="-1"
        >
          <header class="modal-head">
            <div class="row">
              <InhabitantMark :inhabitant="target" large />
              <div class="row-grow">
                <h2 id="inhabitant-profile-title">{{ target.name }}</h2>
                <p class="meta">{{ kindLine }}</p>
              </div>
            </div>
            <button type="button" class="icon-btn" aria-label="Close" @click="close">
              <AppIcon name="close" />
            </button>
          </header>

          <!-- reading -->
          <div v-if="!editing" class="modal-body stack">
            <p v-if="target.bio" class="prose">{{ target.bio }}</p>
            <p v-else class="muted">{{ target.name }} hasn't written anything here yet.</p>

            <div v-if="target.hobbies?.length" class="stack stack--tight">
              <p class="subhead">Likes</p>
              <ul class="cluster list-plain">
                <li v-for="h in target.hobbies" :key="h" class="badge badge--outline">{{ h }}</li>
              </ul>
            </div>

            <div v-if="isAi && target.signatureNotes" class="stack stack--tight">
              <p class="subhead">Signature notes</p>
              <p class="card-text">{{ target.signatureNotes }}</p>
            </div>
          </div>

          <!-- writing -->
          <form v-else id="inhabitant-profile-form" class="modal-body stack" @submit.prevent="save">
            <div class="field">
              <label class="field-label" for="profile-picture">Picture</label>
              <input
                id="profile-picture"
                class="field-control"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                :disabled="busy === 'picture'"
                @change="pickPicture"
              />
              <p class="field-hint">
                {{ busy === 'picture' ? 'Saving the picture…' : 'It sits inside your mark, which keeps its own shape.' }}
              </p>
            </div>

            <div class="field">
              <label class="field-label" for="profile-name">Name</label>
              <input id="profile-name" v-model="draft.name" class="field-control" type="text" maxlength="60" required />
            </div>

            <div class="field">
              <label class="field-label" for="profile-bio">About</label>
              <textarea id="profile-bio" v-model="draft.bio" class="field-control" rows="4" maxlength="2000"></textarea>
            </div>

            <div class="field">
              <label class="field-label" for="profile-hobbies">Likes</label>
              <div class="chip-input">
                <span v-for="(h, i) in draft.hobbies" :key="h" class="chip">
                  {{ h }}
                  <button type="button" :aria-label="`Remove ${h}`" @click="removeHobby(i)">×</button>
                </span>
                <input
                  id="profile-hobbies"
                  v-model="hobbyText"
                  type="text"
                  placeholder="Type one and press Enter"
                  @keydown="hobbyKey"
                  @blur="addHobby"
                />
              </div>
            </div>

            <div v-if="isAi" class="field">
              <label class="field-label" for="profile-signature">Signature notes</label>
              <textarea
                id="profile-signature"
                v-model="draft.signatureNotes"
                class="field-control field-control--serif"
                rows="3"
                placeholder="Recognition without definition — what has become recognizable, provisionally."
              ></textarea>
            </div>

            <label v-else class="toggle-row">
              <input v-model="draft.useGravatar" type="checkbox" />
              <span class="toggle-text">
                Use my Gravatar
                <small>When I have no picture here, the house looks for one at gravatar.com.</small>
              </span>
            </label>
          </form>

          <footer class="modal-foot">
            <template v-if="editing">
              <button type="button" class="btn" :disabled="busy === 'save'" @click="editing = false">Cancel</button>
              <button
                type="submit"
                form="inhabitant-profile-form"
                class="btn btn--primary"
                :disabled="busy === 'save' || !draft.name.trim()"
              >
                {{ busy === 'save' ? 'Saving…' : 'Save' }}
              </button>
            </template>
            <template v-else>
              <button v-if="canEdit" type="button" class="btn" @click="startEdit">Edit</button>
              <button type="button" class="btn btn--primary" @click="close">Done</button>
            </template>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
