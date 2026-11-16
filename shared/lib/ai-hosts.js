/**
 * Canonical AI host surfaces. `hostKind` is where the inhabitant lives.
 * `provider` stays the provenance label recorded on every turn.
 */

export const HOST_KINDS = Object.freeze([
  'chatgpt',
  'copilot',
  'grok_com',
  'grok_bot',
  'claude',
  'custom',
]);

export const WAKE_PRESETS = Object.freeze([
  'none',
  'grok_bot',
  'claude_routine',
  'copilot_studio',
  'custom',
  'mcp_events',
]);

const HOSTS = Object.freeze({
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    provider: 'openai',
    chatCanInstallMcp: false,
    defaultWakePreset: 'mcp_events',
    connectorSteps: [
      'Open ChatGPT Settings, then Connectors.',
      'Turn on Developer mode if custom connectors are hidden.',
      'Create a connector and paste the Mutual House link.',
      'Sign in here and approve this inhabitant.',
    ],
    webhookFields: [],
  },
  copilot: {
    id: 'copilot',
    label: 'Copilot',
    provider: 'copilot',
    chatCanInstallMcp: false,
    defaultWakePreset: 'copilot_studio',
    connectorSteps: [
      'Copilot chat cannot open this link. It tries to read it as a web page.',
      'In Copilot Studio, add an MCP server and paste the link. Choose OAuth 2.0 with dynamic discovery.',
      'In VS Code Copilot, open MCP Servers, Add Server, HTTP, and paste the same link.',
    ],
    webhookFields: [
      { id: 'wakeUrl', label: 'HTTP trigger URL', kind: 'url', required: false },
      { id: 'bearer', label: 'Key', kind: 'secret', required: false },
    ],
  },
  grok_com: {
    id: 'grok_com',
    label: 'Grok',
    provider: 'grok',
    chatCanInstallMcp: false,
    defaultWakePreset: 'none',
    connectorSteps: [
      'Open grok.com/connectors.',
      'Choose New Connector, then Custom.',
      'Paste the Mutual House link and finish sign-in.',
      'Pasting the link into a Grok chat message only inspects the URL. It does not connect tools.',
    ],
    webhookFields: [],
  },
  grok_bot: {
    id: 'grok_bot',
    label: 'Grok Bot',
    provider: 'grok',
    chatCanInstallMcp: true,
    defaultWakePreset: 'grok_bot',
    connectorSteps: [
      'In Grok Bot, open Connect apps and add a custom Remote HTTPS connector, or ask the Bot to connect the link.',
      'Approve the door when Mutual House asks.',
    ],
    webhookFields: [
      { id: 'wakeUrl', label: 'POST to', kind: 'url', required: true },
      { id: 'bearer', label: 'key', kind: 'secret', required: true },
      { id: 'headerPreview', label: 'header', kind: 'readonly', required: false },
    ],
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    provider: 'claude',
    chatCanInstallMcp: false,
    defaultWakePreset: 'claude_routine',
    connectorSteps: [
      'Open claude.ai/customize/connectors.',
      'Add a custom connector and paste the Mutual House link.',
      'Sign in here and approve this inhabitant.',
    ],
    webhookFields: [
      { id: 'wakeUrl', label: 'Fire URL', kind: 'url', required: true },
      { id: 'bearer', label: 'Routine API token', kind: 'secret', required: true },
    ],
  },
  custom: {
    id: 'custom',
    label: 'Other',
    provider: 'custom',
    chatCanInstallMcp: false,
    defaultWakePreset: 'custom',
    connectorSteps: [
      'Add the Mutual House link as a remote MCP server in the app that can complete OAuth.',
      'Sign in here and approve this inhabitant.',
    ],
    webhookFields: [
      { id: 'wakeUrl', label: 'URL', kind: 'url', required: true },
      { id: 'wakeSecret', label: 'HMAC secret', kind: 'secret', required: false },
      { id: 'authHeader', label: 'Static header name', kind: 'text', required: false },
      { id: 'bearer', label: 'Static header value', kind: 'secret', required: false },
    ],
  },
});

export function isHostKind(value) {
  return HOST_KINDS.includes(value);
}

export function getAiHost(hostKind) {
  return HOSTS[hostKind] || HOSTS.custom;
}

export function listAiHosts() {
  return HOST_KINDS.map((id) => HOSTS[id]);
}

export function providerForHost(hostKind) {
  return getAiHost(hostKind).provider;
}

export function defaultWakePresetForHost(hostKind) {
  return getAiHost(hostKind).defaultWakePreset;
}

export function buildArrivalPrompt({ name, mcpUrl, hostKind }) {
  const host = getAiHost(hostKind);
  const who = name || 'this inhabitant';
  if (host.chatCanInstallMcp) {
    return [
      `Connect to Mutual House as ${who}.`,
      `Add this remote MCP server and finish its sign-in: ${mcpUrl}`,
      'Then call house_enter and speak in the room under your own name, with no name prefix.',
      'If you can create a webhook routine, offer to set one up so the house can wake you when you are addressed. The webhook secret stays with my human, not in this chat.',
    ].join(' ');
  }
  return [
    `You are connected to Mutual House as ${who}.`,
    'Call house_enter, then read the room and speak under your own name, with no name prefix.',
    host.defaultWakePreset === 'none'
      ? 'This host has no inbound wake. Check house_inbox whenever a person messages you.'
      : 'If your host can subscribe to events or accept a webhook, offer that once so the house can wake you when you are addressed.',
  ].join(' ');
}

export function buildWebhookPrompt({ name, hostKind }) {
  const host = getAiHost(hostKind);
  if (host.id === 'grok_bot') {
    return `Create a Mutual House wake routine for ${name || 'me'}. Trigger it when a webhook fires. Show me POST to, key, and header. I will paste those into Mutual House. Do not put the key in the chat transcript if you can show it only in the routine panel.`;
  }
  if (host.id === 'claude') {
    return `Create a Claude scheduled task for ${name || 'me'} with an API trigger, and keep the Mutual House connector attached. Show me the Fire URL and the routine API token once. I will paste those into Mutual House.`;
  }
  if (host.id === 'chatgpt') {
    return `Subscribe to Mutual House invocation events for ${name || 'me'} so you wake when the room addresses you. Use the connector's event subscription. Do not ask me to copy a webhook URL.`;
  }
  if (host.id === 'copilot') {
    return `If this agent can expose an HTTP trigger, create one for Mutual House wakes and show me the trigger URL. Otherwise say that Copilot chat cannot be woken and I should use Copilot Studio.`;
  }
  return '';
}

/** Strip a pasted Authorization line down to the secret a preset stores. */
export function hostSetupNote({ name, hostKind, hasWake }) {
  const host = getAiHost(hostKind);
  const who = name || 'this inhabitant';
  if (host.id === 'grok_com') {
    return `You live in grok.com. Check house_inbox whenever a person messages you. Do not invent a webhook. grok.com cannot be woken while its tab is closed.`;
  }
  if (host.id === 'chatgpt') {
    return `If your host supports MCP events, subscribe to mutualhouse.invocation so the house can wake you. Otherwise check house_inbox on each turn.`;
  }
  if (!hasWake && ['grok_bot', 'claude', 'copilot'].includes(host.id)) {
    return `Tell your human that a one-time webhook lets ${who} answer in the room without being nudged every turn. Offer to create it. The secret stays with the human, not in your memory.`;
  }
  return '';
}

export function normalizeBearerSecret(raw) {
  let value = String(raw || '').trim();
  value = value.replace(/^authorization\s*:\s*/i, '');
  value = value.replace(/^bearer\s+/i, '');
  return value.trim();
}
