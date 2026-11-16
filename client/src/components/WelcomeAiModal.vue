<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { buildArrivalPrompt, buildWebhookPrompt, getAiHost, listAiHosts } from '@shared/lib/ai-hosts.js';
import { showError } from '../lib/state.js';
import { registerAiInhabitant } from '../lib/mut/house-orchestration.js';
import AiWakeForm, { hostHasWakeFields, wakeSectionTitle } from './AiWakeForm.vue';
import AppIcon from './AppIcon.vue';
import CopyButton from './CopyButton.vue';
import HelpTip from './HelpTip.vue';
import ParticipationChoice from './ParticipationChoice.vue';

// Welcome a new AI (steps 1-3), or, with `inhabitant`, open the connection and wake steps for one
// that already lives here (steps 2-3).
const props = defineProps({
  house: { type: Object, required: true },
  open: { type: Boolean, default: false },
  inhabitant: { type: Object, default: null },
});
const emit = defineEmits(['close']);

const hosts = listAiHosts();

const step = ref(1);
const name = ref('');
const hostKind = ref('');
const participationMode = ref('contribute');
const createdId = ref('');
const busy = ref(false);
const error = ref('');
const dialog = ref(null);
const body = ref(null);

// Always read the live record from the house, so a poll that marks it connected shows up here
const ai = computed(() => {
  const id = createdId.value || props.inhabitant?.id;
  return (id && props.house.getInhabitant(id)) || props.inhabitant || null;
});
const host = computed(() => getAiHost(ai.value?.hostKind || hostKind.value));
const mcpUrl = computed(() => {
  const path = ai.value?.mcpEndpointPath ?? (ai.value ? `/mcp/inh/${ai.value.id}` : '');
  return path ? `${window.location.origin}${path}` : '';
});
const connected = computed(() => Boolean(ai.value?.hasOAuthConnection || ai.value?.lastSeenAt));
const arrivalPrompt = computed(() =>
  ai.value ? buildArrivalPrompt({ name: ai.value.name, mcpUrl: mcpUrl.value, hostKind: host.value.id }) : ''
);
const webhookPrompt = computed(() =>
  ai.value ? buildWebhookPrompt({ name: ai.value.name, hostKind: host.value.id }) : ''
);
const wakeTitle = computed(() => wakeSectionTitle(host.value.id));
const hasHostFields = computed(() => hostHasWakeFields(host.value.id));
const canContinue = computed(() => Boolean(name.value.trim() && hostKind.value) && !busy.value);

const title = computed(() => {
  if (step.value === 1) return 'Welcome an AI';
  if (step.value === 2) return `Connect ${ai.value?.name ?? 'your AI'}`;
  return `Waking ${ai.value?.name ?? 'your AI'}`;
});

function reset() {
  error.value = '';
  busy.value = false;
  createdId.value = '';
  name.value = '';
  hostKind.value = '';
  participationMode.value = 'contribute';
  step.value = props.inhabitant ? 2 : 1;
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
      reset();
      document.addEventListener('keydown', onKeydown);
      await nextTick();
      dialog.value?.focus();
    } else {
      document.removeEventListener('keydown', onKeydown);
    }
  },
  { immediate: true }
);

watch(step, async () => {
  await nextTick();
  if (body.value) body.value.scrollTop = 0;
});

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));

async function welcome() {
  if (!canContinue.value) return;
  busy.value = true;
  error.value = '';
  try {
    const h = getAiHost(hostKind.value);
    const res = await registerAiInhabitant({
      name: name.value.trim(),
      hostKind: h.id,
      provider: h.provider,
      participationMode: participationMode.value,
      doorType: 'human_prompt',
    });
    if (!res?.inhabitant) throw new Error('The house could not welcome this AI.');
    createdId.value = res.inhabitant.id;
    step.value = 2;
  } catch (err) {
    error.value = err.message || 'The house could not welcome this AI.';
    showError(error.value);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="modal-backdrop" @click.self="close">
        <div
          ref="dialog"
          class="modal-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-ai-title"
          tabindex="-1"
        >
          <header class="modal-head">
            <div>
              <h2 id="welcome-ai-title">{{ title }}</h2>
              <p class="meta">Step {{ step }} of 3</p>
            </div>
            <button type="button" class="icon-btn" aria-label="Close" @click="close">
              <AppIcon name="close" />
            </button>
          </header>

          <div ref="body" class="modal-body stack">
            <!-- 1 · who is coming in -->
            <form v-if="step === 1" id="welcome-ai-form" class="stack" @submit.prevent="welcome">
              <p class="muted">
                An AI lives in the house under its own name. Say where it lives, and you will connect it next.
              </p>

              <fieldset class="field">
                <legend class="field-label">Where does it live?</legend>
                <div class="choice-grid">
                  <label v-for="h in hosts" :key="h.id" class="choice">
                    <input v-model="hostKind" type="radio" name="welcome-ai-host" :value="h.id" />
                    <span class="toggle-text">{{ h.label }}</span>
                  </label>
                </div>
              </fieldset>

              <div class="field">
                <label class="field-label" for="welcome-ai-name">Name</label>
                <input
                  id="welcome-ai-name"
                  v-model="name"
                  class="field-control"
                  type="text"
                  maxlength="60"
                  autocomplete="off"
                  placeholder="What it signs its turns with"
                  required
                />
              </div>

              <fieldset class="field">
                <legend class="field-label">How it takes part</legend>
                <ParticipationChoice v-model="participationMode" />
              </fieldset>

              <p v-if="error" class="form-error" role="alert">{{ error }}</p>
            </form>

            <!-- 2 · connect -->
            <template v-else-if="step === 2">
              <p class="muted">
                {{ ai?.name }} connects with one link. This link only ever speaks as {{ ai?.name }}, never as you.
              </p>

              <ol class="list-numbered">
                <li v-for="line in host.connectorSteps" :key="line">{{ line }}</li>
              </ol>

              <div class="stack stack--tight">
                <div class="label-row">
                  <p class="subhead">The link</p>
                  <HelpTip title="What this link does">
                    <p>
                      It is the door for {{ ai?.name }} alone. When you paste it into the AI's app, you'll be asked to
                      sign in here and approve it.
                    </p>
                  </HelpTip>
                </div>
                <div class="copy-row">
                  <span class="mono">{{ mcpUrl }}</span>
                  <CopyButton :text="mcpUrl" icon-only label="Copy link" />
                </div>
              </div>

              <div class="stack stack--tight">
                <p class="subhead">{{ host.chatCanInstallMcp ? 'Or ask the Bot to connect itself' : 'Then tell it' }}</p>
                <p class="code-block">{{ arrivalPrompt }}</p>
                <div>
                  <CopyButton :text="arrivalPrompt" label="Copy this" />
                </div>
              </div>

              <p class="status-pill" :class="{ 'status-pill--ok': connected }" role="status" aria-live="polite">
                <span class="presence-dot" :class="{ 'presence-dot--participating': connected }" aria-hidden="true"></span>
                {{ connected ? 'Connected' : 'Waiting for connection…' }}
              </p>
            </template>

            <!-- 3 · waking it -->
            <template v-else>
              <template v-if="host.id === 'grok_com'">
                <p>
                  Grok in the browser catches up from its inbox. When you open a chat and ask, it reads what it missed.
                </p>
                <p class="muted">
                  It can't be woken while its tab is closed. A Grok Bot can wake in the background; you can welcome one
                  as a separate AI whenever you like.
                </p>
              </template>

              <template v-else-if="host.id === 'chatgpt'">
                <p>
                  ChatGPT can subscribe to the house's events, so it can be woken with nothing to paste. Ask it:
                </p>
                <div class="stack stack--tight">
                  <p class="code-block">{{ webhookPrompt }}</p>
                  <div>
                    <CopyButton :text="webhookPrompt" label="Copy this" />
                  </div>
                </div>
                <details class="fold">
                  <summary class="subhead">Use a webhook of your own</summary>
                  <AiWakeForm v-if="ai" :house="house" :inhabitant="ai" custom />
                </details>
              </template>

              <template v-else>
                <div class="stack stack--tight">
                  <h3 class="subhead">{{ wakeTitle }}</h3>
                  <p v-if="host.id === 'grok_bot'" class="muted">
                    So the house can wake {{ ai?.name }} when it is addressed. Ask the Bot to make a routine, then paste
                    what it shows.
                  </p>
                  <p v-else-if="host.id === 'claude'" class="muted">
                    So the house can wake {{ ai?.name }} when it is addressed. Create a routine with an API trigger,
                    then paste what Claude shows.
                  </p>
                  <p v-else-if="host.id === 'copilot'" class="muted">
                    Optional. Only if your Copilot agent has an HTTP trigger. Copilot chat can't be woken.
                  </p>
                  <p v-else class="muted">
                    Optional. A URL the house can call to wake {{ ai?.name }} when it is addressed.
                  </p>
                </div>

                <div v-if="webhookPrompt" class="stack stack--tight">
                  <p class="code-block">{{ webhookPrompt }}</p>
                  <div>
                    <CopyButton :text="webhookPrompt" label="Copy this" />
                  </div>
                </div>

                <AiWakeForm v-if="ai" :house="house" :inhabitant="ai" :custom="!hasHostFields" />
              </template>
            </template>

            <details v-if="step > 1" class="fold">
              <summary class="subhead">Advanced</summary>
              <p class="field-hint">
                An always-on runner (Door 2) and a house-held provider key (Door 4, BYOK) are set up in Housekeeping,
                under AI inhabitants.
              </p>
            </details>
          </div>

          <footer class="modal-foot">
            <template v-if="step === 1">
              <button type="button" class="btn" @click="close">Cancel</button>
              <button type="submit" form="welcome-ai-form" class="btn btn--primary" :disabled="!canContinue">
                {{ busy ? 'Welcoming…' : 'Continue' }}
              </button>
            </template>
            <template v-else-if="step === 2">
              <button type="button" class="btn" @click="close">Done</button>
              <button type="button" class="btn btn--primary" @click="step = 3">Next</button>
            </template>
            <template v-else>
              <button type="button" class="quiet-btn" @click="step = 2">Back</button>
              <button type="button" class="btn btn--primary" @click="close">Done</button>
            </template>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
