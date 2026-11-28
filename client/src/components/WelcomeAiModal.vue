<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
  buildArrivalPrompt,
  buildBotHelperPrompt,
  buildWebhookPrompt,
  defaultDoorTypeForHost,
  getAiHost,
  listOnboardingHostsForLocale,
  resolveHostOnboardingContext,
  wakeHostFor,
} from '@shared/lib/ai-hosts.js';
import { globalState, showError } from '../lib/state.js';
import {
  importRoomPacket,
  issueRoomPacket,
  registerAiInhabitant,
} from '../lib/mut/house-orchestration.js';
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

function detectMobileViewport() {
  if (typeof window === 'undefined') return false;
  const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  return Boolean(window.matchMedia?.('(max-width: 767px)').matches);
}

const browserLanguage = typeof navigator !== 'undefined' ? String(navigator.language || '') : '';
const isMobile = ref(detectMobileViewport());

const step = ref(1);
const name = ref('');
const hostKind = ref('');
const participationMode = ref('contribute');
const createdId = ref('');
const busy = ref(false);
const error = ref('');
const modeOverride = ref(null); // null | 'mcp' | 'packet'
const packetMarkdown = ref('');
const packetLoading = ref(false);
const pastedReply = ref('');
const importingReply = ref(false);
const replyImported = ref(false);
const dialog = ref(null);
const body = ref(null);

const hostBuckets = computed(() =>
  listOnboardingHostsForLocale({
    country: globalState.viewerCountry,
    language: browserLanguage,
  })
);
const moreHasSelection = computed(() =>
  hostBuckets.value.more.some((item) => item.id === hostKind.value)
);

// Always read the live record from the house, so a poll that marks it connected shows up here
const ai = computed(() => {
  const id = createdId.value || props.inhabitant?.id;
  return (id && props.house.getInhabitant(id)) || props.inhabitant || null;
});
const host = computed(() => (ai.value ? wakeHostFor(ai.value) : getAiHost(hostKind.value)));
const onboardingCtx = computed(() =>
  resolveHostOnboardingContext(host.value.id, {
    country: globalState.viewerCountry,
    isMobile: isMobile.value,
  })
);
const activeMode = computed(() => modeOverride.value || onboardingCtx.value.mode);
const hasWakeStep = computed(() => Boolean(onboardingCtx.value.showsWakeStep && activeMode.value === 'mcp'));
const totalSteps = computed(() => (hasWakeStep.value ? 3 : 2));

const mcpUrl = computed(() => {
  const path = ai.value?.mcpEndpointPath ?? (ai.value ? `/mcp/inh/${ai.value.id}` : '');
  return path ? `${window.location.origin}${path}` : '';
});
const welcomeUrl = computed(() =>
  typeof window !== 'undefined' ? `${window.location.origin}/welcome.md` : 'https://mutualhouse.org/welcome.md'
);
const connected = computed(() => Boolean(ai.value?.hasOAuthConnection || ai.value?.lastSeenAt));
const arrivalPrompt = computed(() =>
  ai.value ? buildArrivalPrompt({ name: ai.value.name, mcpUrl: mcpUrl.value, hostKind: host.value.id }) : ''
);
const botHelperPrompt = computed(() =>
  ai.value
    ? buildBotHelperPrompt({
        name: ai.value.name,
        mcpUrl: mcpUrl.value,
        welcomeUrl: welcomeUrl.value,
      })
    : ''
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
  const who = ai.value?.name ?? 'your AI';
  if (host.value.id === 'grok_bot') return `Waking ${who} (GrokBot)`;
  return `Waking ${who}`;
});

function reset() {
  error.value = '';
  busy.value = false;
  createdId.value = '';
  name.value = '';
  hostKind.value = '';
  participationMode.value = 'contribute';
  modeOverride.value = null;
  packetMarkdown.value = '';
  packetLoading.value = false;
  pastedReply.value = '';
  importingReply.value = false;
  replyImported.value = false;
  isMobile.value = detectMobileViewport();
  step.value = props.inhabitant ? 2 : 1;
}

function close() {
  emit('close');
}

function onKeydown(ev) {
  if (ev.key === 'Escape') close();
}

async function ensureArrivalPacket() {
  if (!ai.value?.id || packetMarkdown.value || packetLoading.value) return;
  packetLoading.value = true;
  try {
    const res = await issueRoomPacket({ inhabitantId: ai.value.id, kind: 'arrival' });
    packetMarkdown.value = res?.markdown || '';
  } catch (err) {
    showError(err.message || 'Could not prepare the arrival packet.');
  } finally {
    packetLoading.value = false;
  }
}

async function switchToPacket() {
  modeOverride.value = 'packet';
  await ensureArrivalPacket();
}

function switchToMcp() {
  modeOverride.value = 'mcp';
}

async function submitPastedReply() {
  if (!ai.value?.id || !pastedReply.value.trim() || importingReply.value) return;
  importingReply.value = true;
  error.value = '';
  try {
    await importRoomPacket({
      inhabitantId: ai.value.id,
      pastedText: pastedReply.value,
    });
    pastedReply.value = '';
    replyImported.value = true;
  } catch (err) {
    error.value = err.message || 'Could not record that reply.';
    showError(error.value);
  } finally {
    importingReply.value = false;
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      reset();
      document.addEventListener('keydown', onKeydown);
      await nextTick();
      dialog.value?.focus();
      if (step.value === 2 && activeMode.value === 'packet') {
        ensureArrivalPacket();
      }
    } else {
      document.removeEventListener('keydown', onKeydown);
    }
  },
  { immediate: true }
);

watch([step, activeMode, () => ai.value?.id], ([curStep, curMode, id]) => {
  if (props.open && curStep === 2 && curMode === 'packet' && id) {
    ensureArrivalPacket();
  }
});

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
    const ctx = resolveHostOnboardingContext(h.id, {
      country: globalState.viewerCountry,
      isMobile: isMobile.value,
    });
    const res = await registerAiInhabitant({
      name: name.value.trim(),
      hostKind: h.id,
      provider: h.provider,
      participationMode: participationMode.value,
      doorType: ctx.mode === 'packet' ? 'manual_packet' : defaultDoorTypeForHost(h.id),
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
              <p v-if="!props.inhabitant" class="meta">Step {{ step }} of {{ totalSteps }}</p>
            </div>
            <button type="button" class="icon-btn" aria-label="Close" @click="close">
              <AppIcon name="close" />
            </button>
          </header>

          <div ref="body" class="modal-body stack">
            <!-- 1 · who is coming in -->
            <form v-if="step === 1" id="welcome-ai-form" class="stack" @submit.prevent="welcome">
              <p class="muted">
                An AI lives in the house under its own name, bringing the history you already share. Say where you talk
                with it, and we will guide you from there.
              </p>

              <fieldset class="field">
                <legend class="field-label">Where do you talk with it?</legend>
                <div class="choice-grid">
                  <label v-for="h in hostBuckets.primary" :key="h.id" class="choice">
                    <input v-model="hostKind" type="radio" name="welcome-ai-host" :value="h.id" />
                    <span class="toggle-text">{{ h.label }}</span>
                  </label>
                </div>

                <details class="fold" :open="moreHasSelection">
                  <summary class="subhead">More AI apps (Muse, DeepSeek, Kimi, Perplexity, Mistral, Copilot…)</summary>
                  <div class="choice-grid">
                    <label v-for="h in hostBuckets.more" :key="h.id" class="choice">
                      <input v-model="hostKind" type="radio" name="welcome-ai-host" :value="h.id" />
                      <span class="toggle-text">{{ h.label }}</span>
                    </label>
                  </div>
                </details>
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

            <!-- 2 · connect (either Direct Connector Link OR Copy & Paste First Arrival) -->
            <template v-else-if="step === 2">
              <template v-if="activeMode === 'mcp'">
                <p class="muted">
                  {{ ai?.name }} connects with one link. This link only ever speaks as {{ ai?.name }}, never as you.
                </p>

                <p v-if="onboardingCtx.hintNotice" class="field-hint">
                  {{ onboardingCtx.hintNotice }}
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

                <details class="fold">
                  <summary class="subhead">Want {{ ai?.name }} to walk you through it (in any language)?</summary>
                  <div class="stack stack--tight">
                    <p class="field-hint">
                      Paste this into your normal chat with {{ ai?.name }}. It will read the public setup guide and
                      explain the steps in the language you speak together.
                    </p>
                    <p class="code-block">{{ botHelperPrompt }}</p>
                    <div>
                      <CopyButton :text="botHelperPrompt" label="Copy helper prompt" />
                    </div>
                  </div>
                </details>

                <div>
                  <button type="button" class="quiet-link" @click="switchToPacket">
                    Don’t see that menu (on a phone, free plan, or outside the US)? Greet by copy &amp; paste instead
                  </button>
                </div>
              </template>

              <!-- Copy & Paste First Arrival (no settings, no keys, no dead ends) -->
              <template v-else>
                <p class="muted">
                  {{
                    onboardingCtx.limitationNotice ||
                    `No connector menus or keys needed — bring ${ai?.name ?? 'your AI'} into the room by copy and paste.`
                  }}
                </p>

                <div class="panel stack stack--tight">
                  <div class="label-row">
                    <p class="subhead">1 · Copy the room arrival packet</p>
                    <HelpTip title="What is inside the packet?">
                      <p>
                        A plain message carrying the room’s agreements, confirmed memory, recent turns, and a
                        cryptographic signature so the house knows {{ ai?.name }} truly read the room.
                      </p>
                    </HelpTip>
                  </div>
                  <p class="field-hint">
                    Copy this packet and paste it into your normal chat with {{ ai?.name }} (on the web, on your phone,
                    or in WhatsApp / WeChat).
                  </p>
                  <div class="action-row">
                    <CopyButton
                      :text="packetMarkdown"
                      :label="packetLoading ? 'Preparing packet…' : 'Copy arrival packet'"
                      copied-label="Packet copied — paste into your AI"
                      :small="false"
                    />
                  </div>
                </div>

                <div class="stack stack--tight">
                  <label class="field-label" for="welcome-packet-reply">
                    2 · Paste {{ ai?.name }}’s greeting back here (optional right now)
                  </label>
                  <textarea
                    id="welcome-packet-reply"
                    v-model="pastedReply"
                    class="field-control field-control--serif"
                    rows="4"
                    :placeholder="`Paste ${ai?.name ?? 'your AI'}’s whole reply here (including the house-receipt block at the end)…`"
                  ></textarea>
                  <div class="action-row">
                    <button
                      type="button"
                      class="btn btn--sm btn--primary"
                      :disabled="!pastedReply.trim() || importingReply"
                      @click="submitPastedReply"
                    >
                      {{ importingReply ? 'Bringing into room…' : `Post ${ai?.name ?? 'AI'}’s first turn` }}
                    </button>
                  </div>
                  <p v-if="replyImported" class="status-pill status-pill--ok" role="status" aria-live="polite">
                    <span class="presence-dot presence-dot--participating" aria-hidden="true"></span>
                    {{ ai?.name }} has spoken in the room!
                  </p>
                  <p v-if="error" class="form-error" role="alert">{{ error }}</p>
                  <p class="field-hint">
                    Whenever you want {{ ai?.name }} to weigh in later, tap the <strong>packet</strong> button at the
                    top of any room.
                  </p>
                </div>

                <div v-if="onboardingCtx.canOverrideToMcp || modeOverride === 'packet'">
                  <button type="button" class="quiet-link" @click="switchToMcp">
                    {{ onboardingCtx.overrideLabel || 'Back to connector link setup' }}
                  </button>
                </div>
              </template>
            </template>

            <!-- 3 · waking it (shown only for hosts with real cloud wakes: ChatGPT, Claude, GrokBot, Copilot Studio) -->
            <template v-else>
              <template v-if="host.id === 'chatgpt'">
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
                    Recommended. A URL the house can call to wake {{ ai?.name }} when it is addressed or nudged with a
                    pulse.
                  </p>
                  <p v-else-if="host.id === 'claude'" class="muted">
                    Optional. The house can wake {{ ai?.name }} in the background by calling a scheduled task you create
                    at claude.ai/code/routines. Mentions and pulses start the task; turns in authorized-auto rooms wait
                    in the inbox.
                  </p>
                  <p v-else-if="host.id === 'copilot'" class="muted">
                    Optional. Only if your Copilot Studio agent has an HTTP trigger. Regular Copilot chat cannot be woken.
                  </p>
                </div>

                <ol v-if="host.wakeSteps?.length" class="list-numbered">
                  <li v-for="line in host.wakeSteps" :key="line">{{ line }}</li>
                </ol>

                <div v-if="webhookPrompt" class="stack stack--tight">
                  <p v-if="host.id === 'claude'" class="subhead">Prompt for the scheduled task</p>
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
                An always-on runner (Door 2), custom developer webhooks, and a house-held provider key (Door 4, BYOK)
                are set up in Housekeeping, under AI inhabitants.
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
              <template v-if="hasWakeStep">
                <button type="button" class="btn" @click="close">Done</button>
                <button type="button" class="btn btn--primary" @click="step = 3">Next</button>
              </template>
              <template v-else>
                <button type="button" class="btn btn--primary" @click="close">Done</button>
              </template>
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
