async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;

  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(body);
  }

  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
    body,
  });

  if (options.rawResponse) return res;

  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const err = new Error(payload?.error || payload?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

export const api = {
  // Auth (Magic Link + Passkey WebAuthn + Session)
  getSession: () => request('/api/auth/session'),
  requestMagicLink: (data) => request('/api/auth/magic-link/request', { method: 'POST', body: data }),
  verifyMagicLink: (token) => request('/api/auth/magic-link/verify', { method: 'POST', body: { token } }),
  beginPasskeyRegistration: (label) =>
    request('/api/auth/passkey/register/options', { method: 'POST', body: { label } }),
  finishPasskeyRegistration: (data) =>
    request('/api/auth/passkey/register/verify', { method: 'POST', body: data }),
  beginPasskeyLogin: (email) =>
    request('/api/auth/passkey/login/options', { method: 'POST', body: { email } }),
  finishPasskeyLogin: (data) =>
    request('/api/auth/passkey/login/verify', { method: 'POST', body: data }),
  signOut: () => request('/api/auth/sign-out', { method: 'POST' }),

  // Houses & Rooms
  listMyHouses: () => request('/api/houses'),
  createHouse: (data) => request('/api/houses', { method: 'POST', body: data }),
  getHouseBySlug: (slug) => request(`/api/houses/${encodeURIComponent(slug)}`),
  updateHouseSettings: (houseId, data) =>
    request(`/api/houses/${encodeURIComponent(houseId)}`, { method: 'PATCH', body: data }),
  createRoom: (houseId, data) =>
    request(`/api/houses/${encodeURIComponent(houseId)}/rooms`, { method: 'POST', body: data }),
  updateRoom: (roomId, data) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}`, { method: 'PATCH', body: data }),

  // Invitations & AI Inhabitants
  createInvite: (houseId, data) =>
    request(`/api/houses/${encodeURIComponent(houseId)}/invites`, { method: 'POST', body: data }),
  getInvitePreview: (token) =>
    request(`/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token, data = {}) =>
    request(`/api/invites/${encodeURIComponent(token)}/accept`, { method: 'POST', body: data }),
  createAiInhabitant: (houseId, data) =>
    request(`/api/houses/${encodeURIComponent(houseId)}/inhabitants/ai`, {
      method: 'POST',
      body: data,
    }),
  updateInhabitant: (inhabitantId, data) =>
    request(`/api/inhabitants/${encodeURIComponent(inhabitantId)}`, {
      method: 'PATCH',
      body: data,
    }),
  departInhabitant: (inhabitantId, data = {}) =>
    request(`/api/inhabitants/${encodeURIComponent(inhabitantId)}/depart`, {
      method: 'POST',
      body: data,
    }),
  mintAgentKey: (inhabitantId, label) =>
    request(`/api/inhabitants/${encodeURIComponent(inhabitantId)}/keys`, {
      method: 'POST',
      body: { label },
    }),
  revokeAgentKey: (inhabitantId, keyId) =>
    request(
      `/api/inhabitants/${encodeURIComponent(inhabitantId)}/keys/${encodeURIComponent(keyId)}`,
      { method: 'DELETE' }
    ),
  saveByokCredentials: (inhabitantId, data) =>
    request(`/api/inhabitants/${encodeURIComponent(inhabitantId)}/byok`, {
      method: 'PUT',
      body: data,
    }),
  saveWakeUrl: (inhabitantId, data) =>
    request(`/api/inhabitants/${encodeURIComponent(inhabitantId)}/wake`, {
      method: 'PUT',
      body: data,
    }),

  // OAuth 2.1 Consent screen inspection & approval
  getOAuthAuthorizeDetails: (query) =>
    request(`/api/oauth/authorize-details?${new URLSearchParams(query).toString()}`),
  approveOAuthConsent: (data) =>
    request('/oauth2/authorize/decision', { method: 'POST', body: data }),

  // Room Commands, Events & Manual Packets
  dispatchRoomCommand: (roomId, command) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/commands`, {
      method: 'POST',
      body: command,
    }),
  pollRoomEvents: (roomId, afterEventSeq = 0, waitMs = 15000, signal) =>
    request(
      `/api/rooms/${encodeURIComponent(roomId)}/events?after=${encodeURIComponent(afterEventSeq)}&waitMs=${encodeURIComponent(waitMs)}`,
      { signal }
    ),
  issueManualPacket: (roomId, data) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/packets`, { method: 'POST', body: data }),
  importManualPacket: (roomId, data) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/packets/import`, {
      method: 'POST',
      body: data,
    }),

  // House Memory (Tier 1 Episodes + Tier 2 Living Summary) & Constitutions
  createMemoryEpisode: (houseId, data) =>
    request(`/api/houses/${encodeURIComponent(houseId)}/memory/episodes`, {
      method: 'POST',
      body: data,
    }),
  proposeLivingSummary: (houseId, data) =>
    request(`/api/houses/${encodeURIComponent(houseId)}/memory/summaries`, {
      method: 'POST',
      body: data,
    }),
  confirmLivingSummary: (houseId, summaryId) =>
    request(
      `/api/houses/${encodeURIComponent(houseId)}/memory/summaries/${encodeURIComponent(summaryId)}/confirm`,
      { method: 'POST' }
    ),
  proposeConstitution: (houseId, data) =>
    request(`/api/houses/${encodeURIComponent(houseId)}/constitutions`, {
      method: 'POST',
      body: data,
    }),
  ratifyConstitution: (houseId, constitutionId) =>
    request(
      `/api/houses/${encodeURIComponent(houseId)}/constitutions/${encodeURIComponent(constitutionId)}/ratify`,
      { method: 'POST' }
    ),

  // Private R2 Presigned Media Uploads
  presignUpload: (roomId, data) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/media/presign`, {
      method: 'POST',
      body: data,
    }),
  commitUpload: (roomId, attachmentId) =>
    request(
      `/api/rooms/${encodeURIComponent(roomId)}/media/${encodeURIComponent(attachmentId)}/commit`,
      { method: 'POST' }
    ),

  // 2-Occupant Room Audio/Video Calls
  joinRoomCall: (roomId, mediaState = {}) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/call/join`, {
      method: 'POST',
      body: mediaState,
    }),
  sendCallSignal: (roomId, data) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/call/signal`, {
      method: 'POST',
      body: data,
    }),
  pollCallState: (roomId, afterSignalSeq = 0) =>
    request(
      `/api/rooms/${encodeURIComponent(roomId)}/call/state?afterSignal=${encodeURIComponent(afterSignalSeq)}`
    ),
  heartbeatCall: (roomId, mediaState = {}) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/call/heartbeat`, {
      method: 'POST',
      body: mediaState,
    }),
  leaveRoomCall: (roomId) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/call/leave`, { method: 'POST' }),

  // 1-Click House Export (.zip)
  exportHouseZip: (houseId) =>
    request(`/api/houses/${encodeURIComponent(houseId)}/export`, { rawResponse: true }),
};
