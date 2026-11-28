import { reactive } from 'vue';
import {
  House,
  Room,
  Inhabitant,
  MemoryEpisode,
  LivingSummary,
  Constitution,
} from '@shared/models/index.js';
import { api } from '../api.js';
import { globalState, getActiveRoom, showError, showNotice } from '../state.js';

let _pollAbort = null;
let _pollingRoomId = null;

function makeCommandId() {
  return globalThis.crypto?.randomUUID?.() ?? `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// =============================================================================
// SESSION & PASSKEY / MAGIC LINK AUTH
// =============================================================================

export async function loadSessionAndHouses() {
  try {
    const { user, viewerCountry } = await api.getSession();
    globalState.currentUser = user ?? null;
    if (viewerCountry !== undefined) {
      globalState.viewerCountry = viewerCountry ?? null;
    }
    if (user) {
      const { houses } = await api.listMyHouses();
      globalState.myHouses = houses ?? [];
    } else {
      globalState.myHouses = [];
    }
  } catch {
    globalState.currentUser = null;
    globalState.myHouses = [];
  } finally {
    globalState.authReady = true;
  }
  return globalState.currentUser;
}

export async function signInMagicLink({ email, name, redirectTo }) {
  const res = await api.requestMagicLink({ email, name, redirectTo });
  if (res.devVerifyUrl) {
    globalState.ui.devMagicLinkUrl = res.devVerifyUrl;
  }
  showNotice('Check your inbox for your sign-in link.');
  return res;
}

export async function verifyMagicLinkToken(token) {
  const res = await api.verifyMagicLink(token);
  globalState.ui.devMagicLinkUrl = null;
  await loadSessionAndHouses();
  return res;
}

export async function registerPasskey(label = 'This device') {
  if (!window.PublicKeyCredential) {
    throw new Error('Passkeys are not supported in this browser.');
  }
  const { options, challengeId } = await api.beginPasskeyRegistration(label);
  const publicKey = {
    ...options,
    challenge: base64UrlToUint8Array(options.challenge),
    user: {
      ...options.user,
      id: base64UrlToUint8Array(options.user.id),
    },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({
      ...c,
      id: base64UrlToUint8Array(c.id),
    })),
  };

  const cred = await navigator.credentials.create({ publicKey });
  const pubKeySpki = cred.response.getPublicKey
    ? arrayBufferToBase64Url(cred.response.getPublicKey())
    : '';
  const algorithm = cred.response.getPublicKeyAlgorithm
    ? cred.response.getPublicKeyAlgorithm()
    : -7;

  const verified = await api.finishPasskeyRegistration({
    challengeId,
    label,
    credentialId: cred.id,
    publicKeySpki: pubKeySpki,
    algorithm,
    clientDataJSON: arrayBufferToBase64Url(cred.response.clientDataJSON),
    attestationObject: arrayBufferToBase64Url(cred.response.attestationObject),
    transports: cred.response.getTransports ? cred.response.getTransports() : [],
  });
  await loadSessionAndHouses();
  showNotice('Passkey registered to your account.');
  return verified;
}

export async function signInWithPasskey(email = '') {
  if (!window.PublicKeyCredential) {
    throw new Error('Passkeys are not supported in this browser.');
  }
  const { options, challengeId } = await api.beginPasskeyLogin(email);
  const publicKey = {
    ...options,
    challenge: base64UrlToUint8Array(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c) => ({
      ...c,
      id: base64UrlToUint8Array(c.id),
    })),
  };
  const assertion = await navigator.credentials.get({ publicKey });
  const res = await api.finishPasskeyLogin({
    challengeId,
    credentialId: assertion.id,
    authenticatorData: arrayBufferToBase64Url(assertion.response.authenticatorData),
    clientDataJSON: arrayBufferToBase64Url(assertion.response.clientDataJSON),
    signature: arrayBufferToBase64Url(assertion.response.signature),
    userHandle: assertion.response.userHandle
      ? arrayBufferToBase64Url(assertion.response.userHandle)
      : null,
  });
  await loadSessionAndHouses();
  return res;
}

export async function signOutUser() {
  stopRoomPolling();
  await api.signOut();
  globalState.currentUser = null;
  globalState.myHouses = [];
  globalState.activeHouse = null;
}

// =============================================================================
// HOUSE & ROOM HYDRATION + POLL LOOP
// =============================================================================

export async function createNewHouse({ name, slug, coordinates, purpose }) {
  const { house } = await api.createHouse({ name, slug, coordinates, purpose });
  const hydrated = reactive(House.create(house)).proxyInit();
  globalState.activeHouse = hydrated;
  globalState.activeRoomSlug = hydrated.activeRooms[0]?.slug ?? 'common-room';
  await loadSessionAndHouses();
  startRoomPolling(getActiveRoom()?.id);
  return hydrated;
}

export async function openHouseBySlug(slug, roomSlug = null) {
  globalState.loadingHouse = true;
  try {
    const { house } = await api.getHouseBySlug(slug);
    const hydrated = reactive(House.create(house)).proxyInit();
    globalState.activeHouse = hydrated;
    const targetRoom =
      (roomSlug && hydrated.getRoom(roomSlug)) || hydrated.activeRooms[0] || null;
    globalState.activeRoomSlug = targetRoom?.slug ?? 'common-room';
    globalState.ui.activeHouseView = 'room';
    if (targetRoom) {
      startRoomPolling(targetRoom.id);
    }
    return hydrated;
  } catch (err) {
    showError(err.message);
    throw err;
  } finally {
    globalState.loadingHouse = false;
  }
}

export function selectRoom(roomSlug) {
  const house = globalState.activeHouse;
  if (!house) return;
  const room = house.getRoom(roomSlug);
  if (!room) return;
  globalState.activeRoomSlug = room.slug;
  globalState.ui.activeHouseView = 'room';
  globalState.ui.mobileNavOpen = false;
  globalState.ui.replyingToTurnId = null;
  startRoomPolling(room.id);
}

export async function createRoomInHouse({ name, slug, kind = 'project', purpose = '', category = '' }) {
  const house = globalState.activeHouse;
  if (!house) return null;
  const { room } = await api.createRoom(house.id, { name, slug, kind, purpose, category });
  const added = house.upsertRoom(Room.create(room, house));
  selectRoom(added.slug);
  return added;
}

export async function updateHouseFourSections(patch) {
  const house = globalState.activeHouse;
  if (!house) return null;
  const { house: updated } = await api.updateHouseSettings(house.id, patch);
  house.name = updated.name;
  house.coordinates = updated.coordinates;
  house.purpose = updated.purpose;
  house.fourSections = updated.fourSections;
  showNotice('House settings saved.');
  return house;
}

// =============================================================================
// CENTRAL ROOM EVENT RECONCILER (`applyRoomEvents`)
// =============================================================================

export function applyRoomEvents(room, events = []) {
  if (!room || !Array.isArray(events)) return;
  const house = room.house;

  for (const ev of events) {
    if (ev.eventSeq && Number(ev.eventSeq) > Number(room.eventCursor || 0)) {
      room.eventCursor = Number(ev.eventSeq);
    }
    const p = ev.payload || {};

    switch (ev.type) {
      case 'turn.posted': {
        if (p.seal) room.upsertSeal(p.seal);
        if (p.receipt) room.upsertReceipt(p.receipt);
        if (p.turn) room.upsertTurn(p.turn);
        if (typeof p.consecutiveAiTurns === 'number') {
          room.consecutiveAiTurns = p.consecutiveAiTurns;
        }
        if (typeof p.paused === 'boolean') {
          room.paused = p.paused;
        }
        break;
      }
      case 'seal.opened': {
        if (p.seal) room.upsertSeal(p.seal);
        break;
      }
      case 'seal.released': {
        if (p.seal) room.upsertSeal(p.seal);
        if (Array.isArray(p.turns)) {
          // Splice unveiled turns into their exact chronological `turn.seq` positions!
          for (const t of p.turns) {
            room.upsertTurn(t);
          }
        }
        break;
      }
      case 'receipt.recorded': {
        if (p.receipt) room.upsertReceipt(p.receipt);
        break;
      }
      case 'room.updated': {
        if (typeof p.paused === 'boolean') room.paused = p.paused;
        if (p.routingMode) room.routingMode = p.routingMode;
        if (typeof p.autoTurnCap === 'number') room.autoTurnCap = p.autoTurnCap;
        if (typeof p.consecutiveAiTurns === 'number') {
          room.consecutiveAiTurns = p.consecutiveAiTurns;
        }
        break;
      }
      case 'presence.changed': {
        if (house && p.inhabitant) {
          house.upsertInhabitant(p.inhabitant);
        }
        break;
      }
      case 'memory.updated': {
        if (house && p.episode) {
          const exists = house.memory.episodes.findIndex((e) => e.id === p.episode.id);
          const inst = MemoryEpisode.create(p.episode, house.memory);
          if (exists >= 0) house.memory.episodes.splice(exists, 1, inst);
          else house.memory.episodes.push(inst);
        }
        if (house && p.summary) {
          const exists = house.memory.summaries.findIndex((s) => s.id === p.summary.id);
          const inst = LivingSummary.create(p.summary, house.memory);
          if (exists >= 0) house.memory.summaries.splice(exists, 1, inst);
          else house.memory.summaries.push(inst);
        }
        break;
      }
      case 'call.updated': {
        room.callSession = p.callSession ? room.callSession?.constructor.create(p.callSession, room) ?? p.callSession : null;
        break;
      }
      default:
        break;
    }
  }
}

export function startRoomPolling(roomId) {
  stopRoomPolling();
  if (!roomId) return;
  _pollingRoomId = roomId;
  const controller = new AbortController();
  _pollAbort = controller;

  (async () => {
    while (!controller.signal.aborted && _pollingRoomId === roomId) {
      const house = globalState.activeHouse;
      const room = house?.rooms.find((r) => r.id === roomId);
      if (!room) break;

      try {
        const res = await api.pollRoomEvents(
          room.id,
          room.eventCursor || 0,
          15000,
          controller.signal
        );
        if (Array.isArray(res?.events) && res.events.length) {
          applyRoomEvents(room, res.events);
        }
        if (Array.isArray(res?.inhabitants) && house) {
          for (const inh of res.inhabitants) {
            house.upsertInhabitant(inh);
          }
        }
      } catch (err) {
        if (controller.signal.aborted) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  })();
}

export function stopRoomPolling() {
  _pollingRoomId = null;
  if (_pollAbort) {
    _pollAbort.abort();
    _pollAbort = null;
  }
}

// =============================================================================
// ROOM MUTATION COMMANDS
// =============================================================================

export async function postRoomTurn({
  body = '',
  replyToId = null,
  contributionKind = 'turn',
  invokedInhabitantIds = [],
  attachmentIds = [],
  openSeal = null, // { mode: 'peer_sealed' | 'blind_simultaneous', targetInhabitantIds: [] }
  sealId = null,
}) {
  const house = globalState.activeHouse;
  const room = getActiveRoom();
  if (!house || !room) return null;

  const commandId = makeCommandId();
  const viewer = house.viewer;

  // Optimistic insertion reconciled in-place by `commandId` when server ack arrives
  if (viewer && !attachmentIds.length && !openSeal) {
    room.upsertTurn({
      id: `opt_${commandId}`,
      seq: (room.lastTurnSeq || 0) + 1,
      roomId: room.id,
      houseId: house.id,
      commandId,
      authorId: viewer.id,
      replyToId,
      origin: 'native',
      contributionKind,
      body,
      bodySha256: 'pending',
      sealId,
      invokedInhabitantIds,
      attachments: [],
      createdAt: new Date().toISOString(),
      _optimistic: true,
    });
  }

  try {
    const res = await api.dispatchRoomCommand(room.id, {
      commandId,
      type: 'turn.post',
      payload: {
        body,
        replyToId,
        contributionKind,
        invokedInhabitantIds,
        attachmentIds,
        openSeal,
        sealId,
      },
    });
    if (Array.isArray(res.events)) {
      applyRoomEvents(room, res.events);
    }
    globalState.ui.replyingToTurnId = null;
    return res.turn;
  } catch (err) {
    const optIdx = room.turns.findIndex((t) => t.commandId === commandId && t._optimistic);
    if (optIdx >= 0) room.turns.splice(optIdx, 1);
    showError(err.message);
    throw err;
  }
}

export async function releaseRoomSeal(sealId) {
  const room = getActiveRoom();
  if (!room) return null;
  const res = await api.dispatchRoomCommand(room.id, {
    commandId: makeCommandId(),
    type: 'seal.release',
    payload: { sealId },
  });
  if (Array.isArray(res.events)) applyRoomEvents(room, res.events);
  showNotice('Seal released — independent readings unveiled.');
  return res;
}

export async function toggleRoomPause(paused = null) {
  const room = getActiveRoom();
  if (!room) return null;
  const nextPaused = paused === null ? !room.paused : Boolean(paused);
  const res = await api.dispatchRoomCommand(room.id, {
    commandId: makeCommandId(),
    type: 'room.pause',
    payload: { paused: nextPaused },
  });
  if (Array.isArray(res.events)) applyRoomEvents(room, res.events);
  return res;
}

export async function setRoomRoutingMode(routingMode, autoTurnCap = 3) {
  const room = getActiveRoom();
  if (!room) return null;
  const res = await api.dispatchRoomCommand(room.id, {
    commandId: makeCommandId(),
    type: 'room.set_routing',
    payload: { routingMode, autoTurnCap },
  });
  if (Array.isArray(res.events)) applyRoomEvents(room, res.events);
  return res;
}

export async function sendTempoPulse(targetInhabitantIds = []) {
  const room = getActiveRoom();
  if (!room) return null;
  const res = await api.dispatchRoomCommand(room.id, {
    commandId: makeCommandId(),
    type: 'room.pulse',
    payload: { targetInhabitantIds },
  });
  if (Array.isArray(res.events)) applyRoomEvents(room, res.events);
  showNotice('Tempo pulse (.) sent to connected inhabitants.');
  return res;
}

// =============================================================================
// INHABITANTS, KEYS, PACKETS, MEMORY, CONSTITUTIONS & EXPORT
// =============================================================================

export async function registerAiInhabitant(data) {
  const house = globalState.activeHouse;
  if (!house) return null;
  const res = await api.createAiInhabitant(house.id, data);
  const inh = house.upsertInhabitant(Inhabitant.create(res.inhabitant, house));
  if (res.apiKey) {
    globalState.ui.newlyMintedKey = res.apiKey;
  }
  showNotice(`${inh.name} welcomed as an AI inhabitant.`);
  return { inhabitant: inh, apiKey: res.apiKey };
}

export async function setInhabitantParticipation(inhabitantId, data) {
  const house = globalState.activeHouse;
  const res = await api.setInhabitantParticipation(inhabitantId, data);
  if (house && res.inhabitant) house.upsertInhabitant(res.inhabitant);
  return res;
}

export async function updateInhabitantProfile(inhabitantId, data) {
  const house = globalState.activeHouse;
  const res = await api.updateInhabitant(inhabitantId, data);
  if (house && res.inhabitant) house.upsertInhabitant(res.inhabitant);
  return res;
}

export async function uploadInhabitantAvatar(inhabitantId, file) {
  const house = globalState.activeHouse;
  const signed = await api.presignAvatar(inhabitantId, { mimeType: file.type, byteLength: file.size });
  const put = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!put.ok) throw new Error('Avatar upload failed.');
  const res = await api.commitAvatar(inhabitantId, { r2Key: signed.r2Key });
  if (house && res.inhabitant) house.upsertInhabitant(res.inhabitant);
  return res;
}

export async function mintInhabitantRunnerKey(inhabitantId, label = 'Runner Key') {
  const house = globalState.activeHouse;
  const res = await api.mintAgentKey(inhabitantId, label);
  if (house && res.inhabitant) {
    house.upsertInhabitant(res.inhabitant);
  }
  globalState.ui.newlyMintedKey = res.apiKey;
  return res;
}

export async function revokeInhabitantRunnerKey(inhabitantId, keyPrefixOrId) {
  const house = globalState.activeHouse;
  const res = await api.revokeAgentKey(inhabitantId, keyPrefixOrId);
  if (house && res.inhabitant) {
    house.upsertInhabitant(res.inhabitant);
  }
  return res;
}

export async function configureInhabitantByok(inhabitantId, { provider, modelSlug, apiKey, systemPrompt }) {
  const house = globalState.activeHouse;
  const res = await api.saveByokCredentials(inhabitantId, {
    provider,
    modelSlug,
    apiKey,
    systemPrompt,
  });
  if (house && res.inhabitant) {
    house.upsertInhabitant(res.inhabitant);
  }
  showNotice('In-house BYOK credentials updated.');
  return res;
}

export async function createHouseInvitation({ email = '', roleLabel = 'Inhabitant' }) {
  const house = globalState.activeHouse;
  if (!house) return null;
  return api.createInvite(house.id, { email, roleLabel });
}

export async function issueRoomPacket({ inhabitantId, kind = 'contribution', replyToTurnId = null }) {
  const room = getActiveRoom();
  if (!room) return null;
  const res = await api.issueManualPacket(room.id, { inhabitantId, kind, replyToTurnId });
  if (res.receipt) room.upsertReceipt(res.receipt);
  return res;
}

export async function importRoomPacket({ inhabitantId, pastedText, replyToTurnId = null, sealId = null }) {
  const room = getActiveRoom();
  if (!room) return null;
  const res = await api.importManualPacket(room.id, {
    inhabitantId,
    pastedText,
    replyToTurnId,
    sealId,
  });
  if (Array.isArray(res.events)) applyRoomEvents(room, res.events);
  showNotice(
    res.packetDrift
      ? 'Imported contribution recorded (receipt fence modified — flagged as drift).'
      : 'Signed packet verified and recorded.'
  );
  return res;
}

export async function saveMemoryEpisode(data) {
  const house = globalState.activeHouse;
  if (!house) return null;
  const { episode } = await api.createMemoryEpisode(house.id, data);
  const inst = MemoryEpisode.create(episode, house.memory);
  house.memory.episodes.unshift(inst);
  showNotice(`Episode "${inst.title}" woven into House Memory.`);
  return inst;
}

export async function draftLivingSummary(data) {
  const house = globalState.activeHouse;
  if (!house) return null;
  const { summary } = await api.proposeLivingSummary(house.id, data);
  const inst = LivingSummary.create(summary, house.memory);
  const idx = house.memory.summaries.findIndex((s) => s.id === inst.id);
  if (idx >= 0) house.memory.summaries.splice(idx, 1, inst);
  else house.memory.summaries.unshift(inst);
  showNotice(`Living Summary v${inst.version} draft saved.`);
  return inst;
}

export async function confirmHouseLivingSummary(summaryId) {
  const house = globalState.activeHouse;
  if (!house) return null;
  const { summary } = await api.confirmLivingSummary(house.id, summaryId);
  const inst = LivingSummary.create(summary, house.memory);
  const idx = house.memory.summaries.findIndex((s) => s.id === inst.id);
  if (idx >= 0) house.memory.summaries.splice(idx, 1, inst);
  else house.memory.summaries.unshift(inst);
  showNotice(`Living Summary v${inst.version} confirmed for future arrivals.`);
  return inst;
}

export async function proposeHouseConstitution({ title, body }) {
  const house = globalState.activeHouse;
  if (!house) return null;
  const { constitution } = await api.proposeConstitution(house.id, { title, body });
  const inst = Constitution.create(constitution, house);
  const idx = house.constitutions.findIndex((c) => c.id === inst.id);
  if (idx >= 0) house.constitutions.splice(idx, 1, inst);
  else house.constitutions.unshift(inst);
  showNotice(`Constitution v${inst.version} draft proposed.`);
  return inst;
}

export async function ratifyHouseConstitution(constitutionId) {
  const house = globalState.activeHouse;
  if (!house) return null;
  const { constitution } = await api.ratifyConstitution(house.id, constitutionId);
  const inst = Constitution.create(constitution, house);
  const idx = house.constitutions.findIndex((c) => c.id === inst.id);
  if (idx >= 0) house.constitutions.splice(idx, 1, inst);
  else house.constitutions.unshift(inst);
  showNotice(`Constitution v${inst.version} ratified.`);
  return inst;
}

export async function uploadRoomFile(file, extraMeta = {}) {
  const room = getActiveRoom();
  if (!room) throw new Error('No active room.');
  const mimeType = file.type || 'application/octet-stream';
  const presigned = await api.presignUpload(room.id, {
    fileName: file.name || `note-${Date.now()}`,
    mimeType,
    byteLength: file.size,
    durationMs: extraMeta.durationMs ?? null,
  });

  const putRes = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: {
      'content-type': mimeType,
    },
    body: file,
  });

  if (!putRes.ok) {
    throw new Error(`Media upload rejected (${putRes.status})`);
  }

  const { attachment } = await api.commitUpload(room.id, presigned.attachmentId);
  return attachment;
}

export async function downloadHouseExportArchive() {
  const house = globalState.activeHouse;
  if (!house) return;
  const res = await api.exportHouseZip(house.id);
  if (!res.ok) throw new Error('Failed to export House archive.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${house.slug}-export-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showNotice('Full House archive (.zip) downloaded.');
}

// =============================================================================
// WEBAUTHN BASE64URL HELPERS
// =============================================================================

function base64UrlToUint8Array(base64Url) {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawStr = atob(base64);
  const bytes = new Uint8Array(rawStr.length);
  for (let i = 0; i < rawStr.length; i++) bytes[i] = rawStr.charCodeAt(i);
  return bytes;
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
